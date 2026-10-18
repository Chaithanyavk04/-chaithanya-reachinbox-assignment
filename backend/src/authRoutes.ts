import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { randomBytes, timingSafeEqual } from "node:crypto";

const router = Router();

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const callbackUrl =
  process.env.GOOGLE_CALLBACK_URL ??
  "http://localhost:3000/auth/google/callback";

if (!clientId || !clientSecret) {
  throw new Error("Missing Google OAuth environment variables");
}

const oauthClient = new OAuth2Client(
  clientId,
  clientSecret,
  callbackUrl
);

type AuthSession = {
  googleOAuthState?: string;
  user?: {
    id: string;
    name: string;
    email: string;
    picture: string;
  };
};

function sessionData(req: import("express").Request): AuthSession {
  return req.session as typeof req.session & AuthSession;
}

router.get("/google", (req, res) => {
  const state = randomBytes(32).toString("hex");
  sessionData(req).googleOAuthState = state;

  const url = oauthClient.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    state,
  });

  res.redirect(url);
});

router.get("/google/callback", async (req, res) => {
  try {
    const queryState = req.query.state;
    const savedState = sessionData(req).googleOAuthState;

    delete sessionData(req).googleOAuthState;

    if (
      typeof queryState !== "string" ||
      !savedState ||
      queryState.length !== savedState.length ||
      !timingSafeEqual(
        Buffer.from(queryState),
        Buffer.from(savedState)
      )
    ) {
      res.status(403).send("Invalid OAuth state. Please try signing in again.");
      return;
    }

    if (typeof req.query.code !== "string") {
      res.status(400).send("Google authorization code is missing.");
      return;
    }

    const { tokens } = await oauthClient.getToken(req.query.code);

    if (!tokens.access_token) {
      res.status(401).send("Google did not return an access token.");
      return;
    }

    const profileResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      }
    );

    if (!profileResponse.ok) {
      res.status(401).send("Unable to retrieve your Google profile.");
      return;
    }

    const profile = (await profileResponse.json()) as {
      id?: string;
      name?: string;
      email?: string;
      picture?: string;
      verified_email?: boolean;
    };

    if (!profile.id || !profile.email || profile.verified_email !== true) {
      res.status(401).send("A verified Google email is required.");
      return;
    }

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    sessionData(req).user = {
      id: profile.id,
      name: profile.name ?? profile.email,
      email: profile.email,
      picture: profile.picture ?? "",
    };

    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    res.redirect("http://localhost:5173");
  } catch (error) {
    console.error("Google OAuth callback failed:", error);
    res.status(500).send("Google sign-in failed. Please try again.");
  }
});

router.get("/me", (req, res) => {
  const user = sessionData(req).user;

  if (!user) {
    res.status(401).json({ authenticated: false });
    return;
  }

  res.json({ authenticated: true, user });
});

router.post("/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      res.status(500).json({ error: "Unable to log out." });
      return;
    }

    res.clearCookie("reachinbox.sid");
    res.json({ success: true });
  });
});

export default router;
