
import { Router, type Request, type Response } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "./db.js";
import { requireAuth } from "./authMiddleware.js";

const router = Router();

const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:5173";

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}

function getUserId(req: Request): string | undefined {
  return req.session.user?.id;
}

router.get("/status", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const result = await pool.query(
      `SELECT slack_team_id, slack_team_name, slack_user_id, connected_at
       FROM slack_connections
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      res.json({ connected: false });
      return;
    }

    res.json({
      connected: true,
      teamId: result.rows[0].slack_team_id,
      teamName: result.rows[0].slack_team_name,
      slackUserId: result.rows[0].slack_user_id,
      connectedAt: result.rows[0].connected_at,
    });
  } catch (error) {
    console.error("Unable to read Slack connection status:", error);
    res.status(500).json({ error: "Unable to read Slack status" });
  }
});

router.get("/connect", requireAuth, (req, res) => {
  if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
    res.status(503).send("Slack OAuth is not configured on the server.");
    return;
  }

  const state = randomBytes(32).toString("hex");
  req.session.slackOAuthState = state;

  req.session.save((error) => {
    if (error) {
      console.error("Unable to save Slack OAuth session:", error);
      res.status(500).send("Unable to start Slack authorization.");
      return;
    }

    const params = new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      scope: "chat:write",
      redirect_uri: "http://localhost:3000/slack/callback",
      state,
    });

    res.redirect(
      `https://slack.com/oauth/v2/authorize?${params.toString()}`
    );
  });
});

router.get("/callback", requireAuth, async (req, res) => {
  const returnedState =
    typeof req.query.state === "string" ? req.query.state : "";
  const expectedState = req.session.slackOAuthState;

  delete req.session.slackOAuthState;

  if (
    !returnedState ||
    !expectedState ||
    !safeEqual(returnedState, expectedState)
  ) {
    res.status(400).send("Invalid Slack OAuth state. Please reconnect.");
    return;
  }

  if (typeof req.query.error === "string") {
    res.redirect(
      `${FRONTEND_URL}/?slack=denied`
    );
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const userId = getUserId(req);

  if (!code || !userId || !SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
    res.status(400).send("Missing OAuth code or Slack configuration.");
    return;
  }

  try {
    const tokenResponse = await fetch(
      "https://slack.com/api/oauth.v2.access",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          client_id: SLACK_CLIENT_ID,
          client_secret: SLACK_CLIENT_SECRET,
          redirect_uri: "http://localhost:3000/slack/callback",
        }),
      }
    );

    const tokenData = (await tokenResponse.json()) as {
      ok?: boolean;
      error?: string;
      access_token?: string;
      team?: { id?: string; name?: string };
      authed_user?: { id?: string };
      bot_user_id?: string;
    };

    if (
      !tokenResponse.ok ||
      !tokenData.ok ||
      !tokenData.access_token ||
      !tokenData.team?.id
    ) {
      console.error("Slack OAuth exchange failed:", tokenData.error);
      res.status(502).send("Slack authorization failed. Please try again.");
      return;
    }

    await pool.query(
      `INSERT INTO slack_connections
         (user_id, slack_team_id, slack_team_name, slack_user_id,
          access_token, bot_user_id, connected_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         slack_team_id = EXCLUDED.slack_team_id,
         slack_team_name = EXCLUDED.slack_team_name,
         slack_user_id = EXCLUDED.slack_user_id,
         access_token = EXCLUDED.access_token,
         bot_user_id = EXCLUDED.bot_user_id,
         connected_at = NOW(),
         updated_at = NOW()`,
      [
        userId,
        tokenData.team.id,
        tokenData.team.name ?? null,
        tokenData.authed_user?.id ?? null,
        tokenData.access_token,
        tokenData.bot_user_id ?? null,
      ]
    );

    res.redirect(`${FRONTEND_URL}/?slack=connected`);
  } catch (error) {
    console.error("Slack OAuth callback failed:", error);
    res.status(500).send("Unable to save the Slack connection.");
  }
});

router.post("/disconnect", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    await pool.query(
      "DELETE FROM slack_connections WHERE user_id = $1",
      [userId]
    );

    res.json({ connected: false, message: "Slack disconnected" });
  } catch (error) {
    console.error("Unable to disconnect Slack:", error);
    res.status(500).json({ error: "Unable to disconnect Slack" });
  }
});

export default router;
