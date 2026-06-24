import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import {
  listProductionBatches,
  getProductionStats,
  listAvailableSlitCoils,
  previewBatchNumber,
  getProductionBatch,
  createProductionBatch,
  issueSlitCoilsToBatch,
  updateProductionBatch,
  getSlitCoilProductionUsage,
} from "../controllers/production.controller.js";

export const productionRouter = Router();

productionRouter.use(authenticate);

productionRouter.get("/stats", requireModuleAccess(MODULES.PRODUCTION, "READ"), getProductionStats);
productionRouter.get(
  "/available-slit-coils",
  requireModuleAccess(MODULES.PRODUCTION, "READ"),
  listAvailableSlitCoils
);
productionRouter.get(
  "/preview-batch-number",
  requireModuleAccess(MODULES.PRODUCTION, "WRITE"),
  previewBatchNumber
);
productionRouter.get(
  "/slit-coil/:slitCoilId/usage",
  requireModuleAccess(MODULES.PRODUCTION, "READ"),
  getSlitCoilProductionUsage
);
productionRouter.get("/", requireModuleAccess(MODULES.PRODUCTION, "READ"), listProductionBatches);
productionRouter.get(
  "/:batchNumber",
  requireModuleAccess(MODULES.PRODUCTION, "READ"),
  getProductionBatch
);
productionRouter.post("/", requireModuleAccess(MODULES.PRODUCTION, "WRITE"), createProductionBatch);
productionRouter.post(
  "/:batchNumber/issue",
  requireModuleAccess(MODULES.PRODUCTION, "WRITE"),
  issueSlitCoilsToBatch
);
productionRouter.put(
  "/:batchNumber",
  requireModuleAccess(MODULES.PRODUCTION, "WRITE"),
  updateProductionBatch
);
