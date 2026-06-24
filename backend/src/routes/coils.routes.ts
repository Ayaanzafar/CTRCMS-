import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess, requireFullAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import { upload, handleUploadError } from "../middleware/upload.js";
import {
  listCoils,
  getCoilStats,
  getCoilAuditLogs,
  getCoil,
  getCoilUsageHandler,
  createCoil,
  updateCoil,
  deleteCoil,
  archiveCoil,
  attachCoilDocument,
  deleteCoilDocument,
  serveCoilDocument,
} from "../controllers/coils.controller.js";

export const coilsRouter = Router();

coilsRouter.use(authenticate);

coilsRouter.get(
  "/documents/:documentId/file",
  requireModuleAccess(MODULES.COIL_MASTER, "READ"),
  serveCoilDocument
);
coilsRouter.delete(
  "/documents/:documentId",
  requireModuleAccess(MODULES.COIL_MASTER, "WRITE"),
  deleteCoilDocument
);

coilsRouter.get("/", requireModuleAccess(MODULES.COIL_MASTER, "READ"), listCoils);
coilsRouter.get("/stats", requireModuleAccess(MODULES.COIL_MASTER, "READ"), getCoilStats);
coilsRouter.get(
  "/:coilNumber/audit-logs",
  requireModuleAccess(MODULES.COIL_MASTER, "READ"),
  getCoilAuditLogs
);
coilsRouter.get(
  "/:coilNumber/usage",
  requireModuleAccess(MODULES.COIL_MASTER, "READ"),
  getCoilUsageHandler
);
coilsRouter.get("/:coilNumber", requireModuleAccess(MODULES.COIL_MASTER, "READ"), getCoil);
coilsRouter.post("/", requireModuleAccess(MODULES.COIL_MASTER, "WRITE"), createCoil);
coilsRouter.put("/:coilNumber", requireModuleAccess(MODULES.COIL_MASTER, "WRITE"), updateCoil);
coilsRouter.patch(
  "/:coilNumber/archive",
  requireFullAccess(MODULES.COIL_MASTER),
  archiveCoil
);
coilsRouter.delete("/:coilNumber", requireFullAccess(MODULES.COIL_MASTER), deleteCoil);

coilsRouter.post(
  "/:coilNumber/documents",
  requireModuleAccess(MODULES.COIL_MASTER, "WRITE"),
  upload.single("file"),
  handleUploadError,
  attachCoilDocument
);
