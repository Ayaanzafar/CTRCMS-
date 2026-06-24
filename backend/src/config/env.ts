import { config } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

config({ path: resolve(process.cwd(), ".env") });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("8h"),
  UPLOAD_DIR: z.string().default("./uploads"),
  MAX_FILE_SIZE_MB: z.coerce.number().default(25),
  ALLOWED_MIME_TYPES: z
    .string()
    .default("image/jpeg,image/png,image/webp,application/pdf"),
  NOTIFY_EMAIL_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  NOTIFY_EMAIL_TO: z.string().optional(),
  NOTIFY_SMS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  maxFileSizeBytes: parsed.data.MAX_FILE_SIZE_MB * 1024 * 1024,
  allowedMimeTypes: parsed.data.ALLOWED_MIME_TYPES.split(",").map((t) => t.trim()),
};
