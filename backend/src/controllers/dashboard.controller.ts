import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  getDashboardOverview,
  listAuditLogs,
  listNotifications,
} from "../lib/dashboard.js";

export async function getOverview(_req: Request, res: Response): Promise<void> {
  const overview = await getDashboardOverview();
  res.json({ overview });
}

export async function getAuditLogs(req: Request, res: Response): Promise<void> {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const offset = req.query.offset ? Number(req.query.offset) : undefined;
  const entityType = (req.query.entityType as string)?.trim() || undefined;
  const action = (req.query.action as string)?.trim() || undefined;

  const result = await listAuditLogs({ limit, offset, entityType, action });
  res.json(result);
}

export async function getNotifications(req: Request, res: Response): Promise<void> {
  const unreadOnly = req.query.unreadOnly === "true";
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const result = await listNotifications({ unreadOnly, limit });
  res.json(result);
}

const markReadSchema = z.object({
  ids: z.array(z.string()).optional(),
});

export async function markNotificationsRead(req: Request, res: Response): Promise<void> {
  const parsed = markReadSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const ids = parsed.data.ids;

  if (ids && ids.length > 0) {
    await prisma.systemNotification.updateMany({
      where: { id: { in: ids } },
      data: { isRead: true },
    });
  } else {
    await prisma.systemNotification.updateMany({
      where: { isRead: false },
      data: { isRead: true },
    });
  }

  const unreadCount = await prisma.systemNotification.count({ where: { isRead: false } });
  res.json({ unreadCount });
}

export async function markNotificationRead(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  await prisma.systemNotification.update({
    where: { id },
    data: { isRead: true },
  });

  const unreadCount = await prisma.systemNotification.count({ where: { isRead: false } });
  res.json({ unreadCount });
}
