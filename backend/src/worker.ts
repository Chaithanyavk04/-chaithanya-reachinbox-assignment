
import "dotenv/config";
import { Worker, DelayedError } from "bullmq";
import nodemailer from "nodemailer";
import { connection } from "./queue.js";
import { pool } from "./db.js";
import { reserveEmailSend } from "./rateLimiter.js";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.ethereal.email",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function notifySlack(message: string): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;

  if (!webhook) return;

  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: message }),
    });

    if (!response.ok) {
      console.error(
        `Slack notification failed with status ${response.status}`
      );
    }
  } catch (error) {
    console.error("Slack notification failed:", error);
  }
}

const worker = new Worker(
  "email-scheduler",
  async (job, token) => {
    const emailId = Number(job.data.emailId);

    const result = await pool.query(
      `SELECT id, sender_email, recipient_email, subject, body, status
       FROM emails
       WHERE id = $1`,
      [emailId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Email ${emailId} not found`);
    }

    const email = result.rows[0];

    // Prevent sending an email that has already been sent.
    if (email.status === "sent") {
      return { emailId, status: "already-sent" };
    }

    // Atomically check hourly limits and reserve a send slot in Redis.
    const reservation = await reserveEmailSend(email.sender_email);

    if (!reservation.allowed) {
      const retryAfterMs = Math.max(1, reservation.retryAfterMs);
      const retryAt = new Date(Date.now() + retryAfterMs);

      await notifySlack(
        `ReachInbox sending limit reached. Email ${emailId} will be retried at ${retryAt.toISOString()}.`
      );

      if (!token) {
        throw new Error(
          "Missing BullMQ lock token for delayed retry"
        );
      }

      // Defer the existing job instead of discarding it.
      await job.moveToDelayed(Date.now() + retryAfterMs, token);

      throw new DelayedError();
    }

    await pool.query(
      `UPDATE emails
       SET status = 'processing', updated_at = NOW()
       WHERE id = $1`,
      [emailId]
    );

    try {
      const info = await transporter.sendMail({
        from: email.sender_email,
        to: email.recipient_email,
        subject: email.subject,
        text: email.body,
      });

      await pool.query(
        `UPDATE emails
         SET status = 'sent',
             sent_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [emailId]
      );

      const previewUrl = nodemailer.getTestMessageUrl(info);

      console.log(`Email ${emailId} sent successfully.`);
      console.log("Ethereal preview:", previewUrl);

      return {
        emailId,
        status: "sent",
        previewUrl,
      };
    } catch (error) {
      const attemptsAllowed = Number(job.opts.attempts) || 1;
      const finalAttempt =
        job.attemptsMade + 1 >= attemptsAllowed;

      if (finalAttempt) {
        await pool.query(
          `UPDATE emails
           SET status = 'failed', updated_at = NOW()
           WHERE id = $1`,
          [emailId]
        );
      }

      throw error;
    }
  },
  {
    connection,
    concurrency: Math.max(
      1,
      Number.parseInt(
        process.env.WORKER_CONCURRENCY || "5",
        10
      ) || 5
    ),
  }
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed:`, error.message);
});

worker.on("error", (error) => {
  console.error("Worker error:", error);
});

console.log("ReachInbox email worker is running");
