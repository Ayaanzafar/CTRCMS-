import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roleCode: string;
  roleName: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string };

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: "Invalid or inactive user" });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roleCode: user.role.code,
      roleName: user.role.name,
    };

    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
