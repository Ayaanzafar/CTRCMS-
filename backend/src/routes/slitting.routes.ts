import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import {
  listSlitting,
  getSlitting,
  createSlittingBatch,
  updateSlitting,
  previewSlitCoilIds,
} from "../controllers/slitting.controller.js";

export const slittingRouter = Router();

slittingRouter.use(authenticate);

slittingRouter.get("/", requireModuleAccess(MODULES.SLITTING, "READ"), listSlitting);
slittingRouter.get("/preview-ids", requireModuleAccess(MODULES.SLITTING, "WRITE"), previewSlitCoilIds);
slittingRouter.get("/:slitCoilId", requireModuleAccess(MODULES.SLITTING, "READ"), getSlitting);
slittingRouter.post("/batch", requireModuleAccess(MODULES.SLITTING, "WRITE"), createSlittingBatch);
slittingRouter.put("/:slitCoilId", requireModuleAccess(MODULES.SLITTING, "WRITE"), updateSlitting);
