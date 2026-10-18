
import "dotenv/config";
import express from "express";
import cors from "cors";
import { createBullBoard } from "@bull-board/api";
import { ExpressAdapter } from "@bull-board/express";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { pool } from "./db.js";
import { emailQueue } from "./queue.js";
import emailRoutes from "./emailRoutes.js";
import settingsRoutes from "./settingsRoutes.js";
import { recoverScheduledEmails } from "./recovery.js";
import session from "express-session";
import authRoutes from "./authRoutes.js";
import { requireAuth } from "./authMiddleware.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors({
  origin: "http://localhost:5173",
  credentials: true,
}));

app.use(session({
  name: "reachinbox.sid",
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 8 * 60 * 60 * 1000,
  },
}));
app.use("/auth", authRoutes);
app.use(express.json());

// Bull Board dashboard
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

app.use("/admin/queues", requireAuth, serverAdapter.getRouter());

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Database health check failed:", error);
    res.status(503).json({
      status: "error",
      database: "disconnected",
    });
  }
});

app.use("/api/emails", requireAuth, emailRoutes);
app.use("/api/settings", requireAuth, settingsRoutes);

async function startServer() {
  try {
    await recoverScheduledEmails();

    app.listen(PORT, () => {
      console.log(`ReachInbox API running at http://localhost:${PORT}`);
      console.log(
        `Bull Board dashboard at http://localhost:${PORT}/admin/queues`
      );
    });
  } catch (error) {
    console.error("Startup recovery failed:", error);
    process.exitCode = 1;
  }
}

startServer();
