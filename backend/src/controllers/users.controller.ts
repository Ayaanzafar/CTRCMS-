import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ROLES } from "../constants/roles.js";

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  roleCode: z.string().min(1),
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  fullName: z.string().min(2).optional(),
  roleCode: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  isActive: true,
  createdAt: true,
  role: { select: { code: true, name: true } },
} as const;

export async function listUsers(_req: Request, res: Response): Promise<void> {
  const users = await prisma.user.findMany({
    select: userSelect,
    orderBy: { fullName: "asc" },
  });

  res.json({ users });
}

export async function getUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: userSelect,
  });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ user });
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const parsed = createUserSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password, fullName, roleCode } = parsed.data;

  const role = await prisma.role.findUnique({ where: { code: roleCode } });

  if (!role) {
    res.status(400).json({ error: `Unknown role: ${roleCode}` });
    return;
  }

  const existing = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash,
      fullName,
      roleId: role.id,
    },
    select: userSelect,
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "CREATE",
        entityType: "User",
        entityId: user.id,
        newValues: { email: user.email, roleCode: user.role.code },
      },
    });
  }

  res.status(201).json({ user });
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateUserSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.user.findUnique({
    where: { id },
    include: { role: true },
  });

  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const data = parsed.data;

  if (data.isActive === false && existing.id === req.user?.id) {
    res.status(400).json({ error: "You cannot deactivate your own account" });
    return;
  }

  if (data.isActive === false && existing.role.code === ROLES.ADMIN) {
    const activeAdmins = await prisma.user.count({
      where: {
        isActive: true,
        role: { code: ROLES.ADMIN },
        NOT: { id },
      },
    });
    if (activeAdmins === 0) {
      res.status(400).json({ error: "Cannot deactivate the last active admin" });
      return;
    }
  }

  let roleId = existing.roleId;
  if (data.roleCode) {
    const role = await prisma.role.findUnique({ where: { code: data.roleCode } });
    if (!role) {
      res.status(400).json({ error: `Unknown role: ${data.roleCode}` });
      return;
    }
    roleId = role.id;
  }

  if (data.email) {
    const emailTaken = await prisma.user.findFirst({
      where: {
        email: data.email.toLowerCase(),
        NOT: { id },
      },
    });
    if (emailTaken) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
  }

  const updateData: {
    email?: string;
    fullName?: string;
    isActive?: boolean;
    roleId?: string;
    passwordHash?: string;
  } = {};

  if (data.email) updateData.email = data.email.toLowerCase();
  if (data.fullName) updateData.fullName = data.fullName;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.roleCode) updateData.roleId = roleId;
  if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
    select: userSelect,
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "UPDATE",
        entityType: "User",
        entityId: user.id,
        oldValues: {
          email: existing.email,
          fullName: existing.fullName,
          isActive: existing.isActive,
          roleCode: existing.role.code,
        },
        newValues: {
          email: user.email,
          fullName: user.fullName,
          isActive: user.isActive,
          roleCode: user.role.code,
        },
      },
    });
  }

  res.json({ user });
}

export async function deactivateUser(req: Request, res: Response): Promise<void> {
  req.body = { ...req.body, isActive: false };
  await updateUser(req, res);
}
