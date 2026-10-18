
import "dotenv/config";
import { Worker, DelayedError } from "bullmq";
import nodemailer from "nodemailer";
import { connection } from "./queue.js";
import { pool } from "./db.js";
import { reserveEmailSend } from "./rateLimiter.js";

const SLACK_ALERT_COOLDOWN_SECONDS = 300;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.ethereal.email",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

type SlackLimitReason =
  | "global_hourly_limit"
  | "sender_hourly_limit";

async function notifySlackRateLimit(
  userId: string | null,
  emailId: number,
  reason: SlackLimitReason,
  retryAt: Date
): Promise<void> {
  // Emails without an associated application user cannot be linked
  // to a Slack connection.
  if (!userId) return;

  const cooldownKey =
    `reachinbox:slack-alert-cooldown:${userId}:${reason}`;

  try {
    // Atomically allow only one alert per user and limit type
    // during the five-minute cooldown.
    const acquired = await connection.set(
      cooldownKey,
      "1",
      "EX",
      SLACK_ALERT_COOLDOWN_SECONDS,
      "NX"
    );

    if (acquired !== "OK") return;

    const result = await pool.query(
      `SELECT access_token, slack_user_id, slack_team_name
       FROM slack_connections
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // No Slack connection. Remove the cooldown so connecting
      // Slack later does not inherit a stale cooldown.
      await connection.del(cooldownKey);
      return;
    }

    const slack = result.rows[0] as {
      access_token: string;
      slack_user_id: string | null;
      slack_team_name: string | null;
    };

    if (!slack.slack_user_id) {
      console.warn(
        `Slack alert skipped for user ${userId}: Slack user ID unavailable.`
      );
      await connection.del(cooldownKey);
      return;
    }

    const limitDescription =
      reason === "global_hourly_limit"
        ? "The global hourly email limit has been reached."
        : "The sender's hourly email limit has been reached.";

    const message = [
      "*ReachInbox rate-limit alert*",
      limitDescription,
      `Email ID: ${emailId}`,
      `Workspace: ${slack.slack_team_name || "Connected Slack workspace"}`,
      `Retry scheduled for: ${retryAt.toISOString()}`,
      "The email remains queued and will be retried.",
    ].join("\n");

    const response = await fetch(
      "https://slack.com/api/chat.postMessage",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slack.access_token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          // Send the alert to the Slack user who connected the app.
          channel: slack.slack_user_id,
          text: message,
        }),
      }
    );

    const data = (await response.json()) as {
      ok?: boolean;
      error?: string;
    };

    if (!response.ok || !data.ok) {
      console.error(
        "Slack rate-limit notification failed:",
        data.error || `HTTP ${response.status}`
      );

      // Permit a later retry if Slack rejected the notification.
      await connection.del(cooldownKey);
      return;
    }

    console.log(
      `Slack rate-limit alert sent for user ${userId} (${reason}).`
    );
  } catch (error) {
    console.error("Slack rate-limit notification failed:", error);

    // Allow another attempt after a transient failure.
    try {
      await connection.del(cooldownKey);
    } catch (redisError) {
      console.error("Unable to clear Slack alert cooldown:", redisError);
    }
  }
}

const worker = new Worker(
  "email-scheduler",
  async (job, token) => {
    const emailId = Number(job.data.emailId);

    const result = await pool.query(
      `SELECT id, user_id, sender_email, recipient_email,
              subject, body, status
       FROM emails
       WHERE id = $1`,
      [emailId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Email ${emailId} not found`);
    }

    const email = result.rows[0] as {
      id: number;
      user_id: string | null;
      sender_email: string;
      recipient_email: string;
      subject: string;
      body: string;
      status: string;
    };

    // Never send an email that has already been sent.
    if (email.status === "sent") {
      return { emailId, status: "already-sent" };
    }

    // Reserve a send slot atomically using Redis.
    const reservation = await reserveEmailSend(email.sender_email);

    if (!reservation.allowed) {
      const retryAfterMs = Math.max(1, reservation.retryAfterMs);
      const retryAt = new Date(Date.now() + retryAfterMs);

      // Only hourly-limit blocks trigger Slack notifications.
      // Minimum-delay waits are normal and remain silent.
      if (
        reservation.reason === "global_hourly_limit" ||
        reservation.reason === "sender_hourly_limit"
      ) {
        await notifySlackRateLimit(
          email.user_id,
          emailId,
          reservation.reason,
          retryAt
        );
      }

      if (!token) {
        throw new Error("Missing BullMQ lock token for delayed retry");
      }

      // Keep the existing job and delay it instead of discarding it.
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
      if (process.env.SIMULATE_SMTP_FAILURE === "true") {
        throw new Error("Simulated SMTP failure for retry testing");
      }

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
      Number.parseInt(process.env.WORKER_CONCURRENCY || "5", 10) || 5
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
