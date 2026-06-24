import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import { upload, handleUploadError } from "../middleware/upload.js";
import { uploadConfig, uploadFile } from "../controllers/uploads.controller.js";
import { SUBDIRS } from "../config/storage.js";

export const uploadsRouter = Router();

uploadsRouter.use(authenticate);

uploadsRouter.get(
  "/config",
  requireModuleAccess(MODULES.DOCUMENTS, "READ"),
  uploadConfig
);

uploadsRouter.post(
  "/:category",
  requireModuleAccess(MODULES.DOCUMENTS, "WRITE"),
  (req, res, next) => {
    const category = req.params.category;
    if (!SUBDIRS.includes(category as (typeof SUBDIRS)[number])) {
      res.status(400).json({
        error: `Invalid category. Allowed: ${SUBDIRS.join(", ")}`,
      });
      return;
    }
    next();
  },
  upload.single("file"),
  handleUploadError,
  uploadFile
);
