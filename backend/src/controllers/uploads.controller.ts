import type { Request, Response } from "express";
import { SUBDIRS } from "../config/storage.js";
import { env } from "../config/env.js";

export async function uploadConfig(_req: Request, res: Response): Promise<void> {
  res.json({
    categories: SUBDIRS,
    maxFileSizeMb: env.MAX_FILE_SIZE_MB,
    allowedMimeTypes: env.allowedMimeTypes,
  });
}

export async function uploadFile(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const category = req.params.category;

  res.status(201).json({
    message: "File uploaded successfully (Phase 0 stub — linking to records comes in later phases)",
    file: {
      originalName: req.file.originalname,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
      category,
      path: req.file.path,
    },
  });
}
