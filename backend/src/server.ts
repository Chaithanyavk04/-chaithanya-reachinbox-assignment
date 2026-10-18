
import "dotenv/config";

import express from "express";
import cors from "cors";
import session from "express-session";
import { createBullBoard } from "@bull-board/api";
import { ExpressAdapter } from "@bull-board/express";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import slackRoutes from "./slackRoutes.js";

import { pool } from "./db.js";
import { emailQueue } from "./queue.js";
import emailRoutes from "./emailRoutes.js";
import settingsRoutes from "./settingsRoutes.js";
import { recoverScheduledEmails } from "./recovery.js";
import authRoutes from "./authRoutes.js";
import { requireAuth } from "./authMiddleware.js";

// Validate required configuration before starting the server.
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error(
    "SESSION_SECRET must be configured with at least 32 characters."
  );
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";

const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:5173";

// Required when deployed behind a trusted HTTPS reverse proxy.
if (isProduction) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

// Session configuration.
app.use(
  session({
    name: "reachinbox.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);

// Authentication endpoints must remain accessible before login.
app.use("/auth", authRoutes);
app.use("/slack", slackRoutes);

// Health endpoint for checking database connectivity.
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    console.error("Health check failed:", error);

    res.status(503).json({
      status: "error",
      database: "disconnected",
    });
  }
});

// Bull Board queue dashboard.
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

// Only authenticated users can view or operate the queue dashboard.
app.use(
  "/admin/queues",
  requireAuth,
  serverAdapter.getRouter()
);

// All email and settings API endpoints require authentication.
app.use("/api/emails", requireAuth, emailRoutes);
app.use("/api/settings", requireAuth, settingsRoutes);

// Start only after recovering scheduled jobs.
async function startServer() {
  try {
    await recoverScheduledEmails();

    app.listen(PORT, () => {
      console.log(`ReachInbox backend running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (error) {
    console.error("Failed to start ReachInbox backend:", error);
    process.exitCode = 1;
  }
}

void startServer();
