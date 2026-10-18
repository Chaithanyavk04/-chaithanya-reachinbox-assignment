
import { Router } from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { emailQueue } from "./queue.js";
import { indexEmail, searchEmails } from "./elasticsearch.js";

const router = Router();

const emailSchema = z.object({
  senderEmail: z.string().email(),
  recipientEmail: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  scheduledAt: z.string().refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "Invalid scheduledAt datetime"
  ),
  idempotencyKey: z.string().min(1).optional(),
});

const bulkEmailSchema = z.object({
  senderEmail: z.string().email(),
  recipientEmails: z.array(z.string().email()).min(1).max(1000),
  subject: z.string().min(1),
  body: z.string().min(1),
  scheduledAt: z.string().refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "Invalid scheduledAt datetime"
  ),
  idempotencyKey: z.string().min(1),
});

// Search emails using Elasticsearch.
// GET /api/emails/search?q=meeting
router.get("/search", async (req, res) => {
  const query =
    typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!query) {
    return res.status(400).json({
      error: "A search query is required. Use ?q=your-search-term",
    });
  }

  try {
    const results = await searchEmails(query);

    return res.json({
      query,
      count: results.length,
      emails: results,
    });
  } catch (error) {
    console.error("Failed to search emails:", error);

    return res.status(503).json({
      error: "Email search is temporarily unavailable",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// Reindex existing PostgreSQL emails into Elasticsearch.
// POST /api/emails/reindex
router.post("/reindex", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, sender_email, recipient_email, subject,
              body, scheduled_at, sent_at, status, created_at
       FROM emails
       ORDER BY id ASC`
    );

    let indexed = 0;
    const failures: Array<{ id: number; error: string }> = [];

    for (const email of result.rows) {
      try {
        await indexEmail({
          ...email,
          id: Number(email.id),
        });
        indexed++;
      } catch (error) {
        failures.push({
          id: Number(email.id),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return res.json({
      total: result.rows.length,
      indexed,
      failed: failures.length,
      failures,
    });
  } catch (error) {
    console.error("Email reindex failed:", error);

    return res.status(500).json({
      error: "Failed to reindex emails",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// List recent emails.
// GET /api/emails
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, sender_email, recipient_email, subject,
              body, scheduled_at, sent_at, status, created_at
       FROM emails
       ORDER BY scheduled_at ASC
       LIMIT 100`
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Failed to list emails:", error);

    return res.status(500).json({
      error: "Failed to retrieve emails",
    });
  }
});

// Schedule emails for multiple recipients.
// POST /api/emails/bulk
router.post("/bulk", async (req, res) => {
  const parsed = bulkEmailSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid bulk email data",
      details: parsed.error.issues,
    });
  }

  const data = parsed.data;
  const recipients = [
    ...new Set(
      data.recipientEmails.map((email) => email.trim().toLowerCase())
    ),
  ];

  const scheduledTime = new Date(data.scheduledAt).getTime();

  if (!Number.isFinite(scheduledTime)) {
    return res.status(400).json({
      error: "Invalid scheduled delivery time",
    });
  }

  const client = await pool.connect();

  const createdEmails: Array<{
    id: number;
    sender_email: string;
    recipient_email: string;
    subject: string;
    body: string;
    scheduled_at: string | Date;
    status: string;
  }> = [];

  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    for (const recipientEmail of recipients) {
      const idempotencyKey = `${data.idempotencyKey}:${recipientEmail}`;

      const result = await client.query(
        `INSERT INTO emails
          (sender_email, recipient_email, subject, body,
           scheduled_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id, sender_email, recipient_email, subject,
                   body, scheduled_at, status`,
        [
          data.senderEmail,
          recipientEmail,
          data.subject,
          data.body,
          data.scheduledAt,
          idempotencyKey,
        ]
      );

      if (result.rows.length > 0) {
        createdEmails.push({
          ...result.rows[0],
          id: Number(result.rows[0].id),
        });
      }
    }

    await client.query("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }

    console.error("Failed to save bulk emails:", error);

    return res.status(500).json({
      error: "Failed to save bulk emails",
    });
  } finally {
    client.release();
  }

  let queuedCount = 0;
  let queueFailures = 0;
  let indexingFailures = 0;

  for (const email of createdEmails) {
    try {
      const delay = Math.max(0, scheduledTime - Date.now());

      await emailQueue.add(
        "send-email",
        { emailId: email.id },
        {
          jobId: `email-${email.id}`,
          delay,
        }
      );

      queuedCount++;
    } catch (error) {
      queueFailures++;
      console.error(`Failed to queue email ${email.id}:`, error);
    }

    try {
      await indexEmail(email);
    } catch (error) {
      indexingFailures++;
      console.error(`Failed to index email ${email.id}:`, error);
    }
  }

  return res.status(201).json({
    message: "Bulk scheduling processed",
    recipientCount: recipients.length,
    scheduledCount: createdEmails.length,
    queuedCount,
    skippedDuplicates: recipients.length - createdEmails.length,
    queueFailures,
    indexingFailures,
  });
});

// Schedule a single email.
// POST /api/emails
router.post("/", async (req, res) => {
  const parsed = emailSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid email data",
      details: parsed.error.issues,
    });
  }

  const email = parsed.data;

  try {
    const result = await pool.query(
      `INSERT INTO emails
        (sender_email, recipient_email, subject, body,
         scheduled_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, sender_email, recipient_email, subject,
                 body, scheduled_at, sent_at, status, created_at`,
      [
        email.senderEmail,
        email.recipientEmail.trim().toLowerCase(),
        email.subject,
        email.body,
        email.scheduledAt,
        email.idempotencyKey ?? null,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({
        error: "This idempotency key has already been used",
      });
    }

    const savedEmail = {
      ...result.rows[0],
      id: Number(result.rows[0].id),
    };

    const scheduledTime = new Date(savedEmail.scheduled_at).getTime();
    const delay = Math.max(0, scheduledTime - Date.now());

    let queueStatus = "queued";

    try {
      await emailQueue.add(
        "send-email",
        { emailId: savedEmail.id },
        {
          jobId: `email-${savedEmail.id}`,
          delay,
        }
      );
    } catch (error) {
      queueStatus = "queue_failed";
      console.error(`Failed to queue email ${savedEmail.id}:`, error);
    }

    let indexed = true;

    try {
      await indexEmail(savedEmail);
    } catch (error) {
      indexed = false;
      console.error(`Failed to index email ${savedEmail.id}:`, error);
    }

    return res.status(queueStatus === "queued" ? 201 : 202).json({
      ...savedEmail,
      queueStatus,
      indexed,
      delayMs: delay,
    });
  } catch (error) {
    console.error("Failed to schedule email:", error);

    return res.status(500).json({
      error: "Failed to schedule email",
    });
  }
});

export default router;
