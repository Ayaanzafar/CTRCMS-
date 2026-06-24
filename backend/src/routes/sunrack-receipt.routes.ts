import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import { upload, handleUploadError } from "../middleware/upload.js";
import {
  listSunrackReceipts,
  listPendingSlitCoils,
  getSunrackReceiptStats,
  getSunrackReceipt,
  getSunrackReceiptBySlitCoil,
  createSunrackReceipt,
  updateSunrackReceipt,
  attachReceiptPhotos,
  serveReceiptPhoto,
} from "../controllers/sunrack-receipt.controller.js";

export const sunrackReceiptRouter = Router();

sunrackReceiptRouter.use(authenticate);

sunrackReceiptRouter.get(
  "/stats",
  requireModuleAccess(MODULES.SUNRACK_RECEIPT, "READ"),
  getSunrackReceiptStats
);
sunrackReceiptRouter.get(
  "/pending",
  requireModuleAccess(MODULES.SUNRACK_RECEIPT, "READ"),
  listPendingSlitCoils
);
sunrackReceiptRouter.get(
  "/",
  requireModuleAccess(MODULES.SUNRACK_RECEIPT, "READ"),
  listSunrackReceipts
);
sunrackReceiptRouter.get(
  "/by-slit/:slitCoilId",
  requireModuleAccess(MODULES.SUNRACK_RECEIPT, "READ"),
  getSunrackReceiptBySlitCoil
);
sunrackReceiptRouter.get(
  "/photos/:photoId/file",
  requireModuleAccess(MODULES.SUNRACK_RECEIPT, "READ"),
  serveReceiptPhoto
);
sunrackReceiptRouter.get(
  "/:id",
  requireModuleAccess(MODULES.SUNRACK_RECEIPT, "READ"),
  getSunrackReceipt
);
sunrackReceiptRouter.post(
  "/",
  requireModuleAccess(MODULES.SUNRACK_RECEIPT, "WRITE"),
  createSunrackReceipt
);
sunrackReceiptRouter.put(
  "/:id",
  requireModuleAccess(MODULES.SUNRACK_RECEIPT, "WRITE"),
  updateSunrackReceipt
);
sunrackReceiptRouter.post(
  "/:id/photos",
  requireModuleAccess(MODULES.SUNRACK_RECEIPT, "WRITE"),
  upload.array("photos", 10),
  handleUploadError,
  attachReceiptPhotos
);
