import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "./env.js";

const uploadRoot = resolve(process.cwd(), env.UPLOAD_DIR);

const SUBDIRS = [
  "mtc",
  "invoices",
  "delivery-notes",
  "qc-reports",
  "inspection-photos",
  "installation-photos",
  "complaint-photos",
  "misc",
] as const;

export type UploadCategory = (typeof SUBDIRS)[number];

export function ensureUploadDirectories(): string {
  if (!existsSync(uploadRoot)) {
    mkdirSync(uploadRoot, { recursive: true });
  }

  for (const subdir of SUBDIRS) {
    const path = resolve(uploadRoot, subdir);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }

  return uploadRoot;
}

export function getUploadPath(category: UploadCategory, filename: string): string {
  return resolve(uploadRoot, category, filename);
}

export { uploadRoot, SUBDIRS };
