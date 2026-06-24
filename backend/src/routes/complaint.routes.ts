import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import { upload, handleUploadError } from "../middleware/upload.js";
import {
  getComplaintStats,
  listEligibleBatches,
  resolveTrace,
  previewComplaintId,
  listComplaints,
  getComplaint,
  createComplaint,
  updateComplaint,
  attachComplaintPhotos,
  serveComplaintPhoto,
} from "../controllers/complaint.controller.js";

export const complaintRouter = Router();

complaintRouter.use(authenticate);

complaintRouter.get("/stats", requireModuleAccess(MODULES.COMPLAINT, "READ"), getComplaintStats);
complaintRouter.get(
  "/eligible-batches",
  requireModuleAccess(MODULES.COMPLAINT, "READ"),
  listEligibleBatches
);
complaintRouter.post(
  "/resolve-trace",
  requireModuleAccess(MODULES.COMPLAINT, "READ"),
  resolveTrace
);
complaintRouter.get(
  "/preview-complaint-id",
  requireModuleAccess(MODULES.COMPLAINT, "WRITE"),
  previewComplaintId
);
complaintRouter.get(
  "/photos/:photoId/file",
  requireModuleAccess(MODULES.COMPLAINT, "READ"),
  serveComplaintPhoto
);
complaintRouter.get("/", requireModuleAccess(MODULES.COMPLAINT, "READ"), listComplaints);
complaintRouter.get(
  "/:complaintId",
  requireModuleAccess(MODULES.COMPLAINT, "READ"),
  getComplaint
);
complaintRouter.post("/", requireModuleAccess(MODULES.COMPLAINT, "WRITE"), createComplaint);
complaintRouter.put(
  "/:complaintId",
  requireModuleAccess(MODULES.COMPLAINT, "WRITE"),
  updateComplaint
);
complaintRouter.post(
  "/:complaintId/photos",
  requireModuleAccess(MODULES.COMPLAINT, "WRITE"),
  upload.array("photos", 10),
  handleUploadError,
  attachComplaintPhotos
);
