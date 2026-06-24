import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import {
  searchTraceability,
  getTimeline,
  exportTimelinePdf,
} from "../controllers/traceability.controller.js";

export const traceabilityRouter = Router();

traceabilityRouter.use(authenticate);

traceabilityRouter.get(
  "/search",
  requireModuleAccess(MODULES.TRACEABILITY, "READ"),
  searchTraceability
);
traceabilityRouter.get(
  "/timeline",
  requireModuleAccess(MODULES.TRACEABILITY, "READ"),
  getTimeline
);
traceabilityRouter.get(
  "/export/pdf",
  requireModuleAccess(MODULES.TRACEABILITY, "READ"),
  exportTimelinePdf
);
