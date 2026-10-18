
import { emailQueue } from "./queue.js";
import { pool } from "./db.js";

export async function recoverScheduledEmails(): Promise<void> {
  console.log("Checking for scheduled emails to recover...");

  // A processing record may have been left behind by a worker crash.
  // Re-queue it on startup; SMTP delivery is not exactly-once.
  const staleResult = await pool.query(
    `UPDATE emails
     SET status = 'scheduled', updated_at = NOW()
     WHERE status = 'processing'
     RETURNING id, scheduled_at`
  );

  if (staleResult.rowCount) {
    console.log(
      `Reset ${staleResult.rowCount} processing email(s) for recovery.`
    );
  }

  const result = await pool.query(
    `SELECT id, scheduled_at
     FROM emails
     WHERE status = 'scheduled'
     ORDER BY scheduled_at ASC, id ASC`
  );

  let recoveredCount = 0;

  for (const email of result.rows) {
    const jobId = `email-${email.id}`;
    const existingJob = await emailQueue.getJob(jobId);

    if (existingJob) {
      const state = await existingJob.getState();

      if (
        state === "waiting" ||
        state === "delayed" ||
        state === "active" ||
        state === "waiting-children"
      ) {
        continue;
      }

      await existingJob.remove();
    }

    const delay = Math.max(
      0,
      new Date(email.scheduled_at).getTime() - Date.now()
    );

    await emailQueue.add(
      "send-email",
      { emailId: email.id },
      { jobId, delay }
    );

    recoveredCount++;
  }

  console.log(
    `Recovery complete. Recovered ${recoveredCount} scheduled email(s).`
  );
}
