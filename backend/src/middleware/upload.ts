import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { env } from "../config/env.js";
import { ensureUploadDirectories, type UploadCategory } from "../config/storage.js";

ensureUploadDirectories();

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const category =
      (req.params.category as string) ||
      (req.path.includes("/coils/") ? "mtc" : undefined) ||
      (req.path.includes("/sunrack-receipts/") ? "inspection-photos" : undefined) ||
      (req.path.includes("/qc-inspections/") || req.path.includes("/qc/") ? "qc-reports" : undefined) ||
      (req.path.includes("/site-installation/") ? "installation-photos" : undefined) ||
      (req.path.includes("/complaints/") || req.path.includes("/complaint") ? "complaint-photos" : "misc");
    const root = ensureUploadDirectories();
    cb(null, `${root}/${category}`);
  },
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname) || "";
    cb(null, `${randomUUID()}${ext}`);
  },
});

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  if (!env.allowedMimeTypes.includes(file.mimetype)) {
    cb(new Error(`File type not allowed: ${file.mimetype}`));
    return;
  }
  cb(null, true);
}

export const upload = multer({
  storage,
  limits: { fileSize: env.maxFileSizeBytes },
  fileFilter,
});

export function handleUploadError(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({
        error: `File too large. Maximum size is ${env.MAX_FILE_SIZE_MB} MB`,
      });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }

  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }

  next(err);
}
