import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import { upload, handleUploadError } from "../middleware/upload.js";
import {
  listQcInspections,
  getQcStats,
  listPendingBatches,
  listDispatchEligibleBatches,
  getQcInspection,
  getQcByBatch,
  createQcInspection,
  updateQcInspection,
  attachQcPhotos,
  serveQcPhoto,
} from "../controllers/qc.controller.js";

export const qcRouter = Router();

qcRouter.use(authenticate);

qcRouter.get("/stats", requireModuleAccess(MODULES.QC_INSPECTION, "READ"), getQcStats);
qcRouter.get("/pending-batches", requireModuleAccess(MODULES.QC_INSPECTION, "READ"), listPendingBatches);
qcRouter.get(
  "/dispatch-eligible-batches",
  requireModuleAccess(MODULES.DISPATCH, "READ"),
  listDispatchEligibleBatches
);
qcRouter.get("/", requireModuleAccess(MODULES.QC_INSPECTION, "READ"), listQcInspections);
qcRouter.get(
  "/photos/:photoId/file",
  requireModuleAccess(MODULES.QC_INSPECTION, "READ"),
  serveQcPhoto
);
qcRouter.get("/batch/:batchNumber", requireModuleAccess(MODULES.QC_INSPECTION, "READ"), getQcByBatch);
qcRouter.get("/:id", requireModuleAccess(MODULES.QC_INSPECTION, "READ"), getQcInspection);
qcRouter.post("/", requireModuleAccess(MODULES.QC_INSPECTION, "WRITE"), createQcInspection);
qcRouter.put("/:id", requireModuleAccess(MODULES.QC_INSPECTION, "WRITE"), updateQcInspection);
qcRouter.post(
  "/:id/photos",
  requireModuleAccess(MODULES.QC_INSPECTION, "WRITE"),
  upload.array("photos", 10),
  handleUploadError,
  attachQcPhotos
);
