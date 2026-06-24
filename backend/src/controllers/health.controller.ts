import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { ensureUploadDirectories } from "../config/storage.js";

export async function healthCheck(_req: Request, res: Response): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    ensureUploadDirectories();

    const [userCount, roleCount] = await Promise.all([
      prisma.user.count(),
      prisma.role.count(),
    ]);

    res.json({
      status: "ok",
      database: "connected",
      storage: "ready",
      tables: {
        users: userCount,
        roles: roleCount,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "error",
      database: "disconnected",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
