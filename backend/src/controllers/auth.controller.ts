import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { MODULE_DEFINITIONS } from "../constants/modules.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email or password format" });
    return;
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      role: {
        include: { permissions: true },
      },
    },
  });

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = jwt.sign(
    { sub: user.id, role: user.role.code },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
  );

  const permissions = Object.fromEntries(
    user.role.permissions.map((p) => [p.module, p.access])
  );

  const accessibleModules = MODULE_DEFINITIONS.filter((m) => {
    const access = permissions[m.code];
    return access && access !== "NONE";
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
    },
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: {
        code: user.role.code,
        name: user.role.name,
      },
      permissions,
      accessibleModules,
    },
  });
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: {
      role: {
        include: { permissions: true },
      },
    },
  });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const permissions = Object.fromEntries(
    user.role.permissions.map((p) => [p.module, p.access])
  );

  const accessibleModules = MODULE_DEFINITIONS.filter((m) => {
    const access = permissions[m.code];
    return access && access !== "NONE";
  });

  res.json({
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: {
      code: user.role.code,
      name: user.role.name,
    },
    permissions,
    accessibleModules,
  });
}

export async function logout(req: Request, res: Response): Promise<void> {
  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "LOGOUT",
        entityType: "User",
        entityId: req.user.id,
      },
    });
  }

  res.json({ message: "Logged out successfully" });
}
