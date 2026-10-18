import type { Request, Response, NextFunction } from "express";

type AuthenticatedSession = {
  user?: {
    id: string;
    name: string;
    email: string;
    picture: string;
  };
};

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authSession = req.session as typeof req.session & AuthenticatedSession;

  if (!authSession.user) {
    return res.status(401).json({
      authenticated: false,
      error: "Authentication required. Please sign in.",
    });
  }

  next();
}
