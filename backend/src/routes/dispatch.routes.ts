import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import {
  getDispatchStats,
  listDispatches,
  previewDispatchNote,
  getDispatch,
  createDispatch,
  updateDispatch,
} from "../controllers/dispatch.controller.js";

export const dispatchRouter = Router();

dispatchRouter.use(authenticate);

dispatchRouter.get("/stats", requireModuleAccess(MODULES.DISPATCH, "READ"), getDispatchStats);
dispatchRouter.get(
  "/preview-dispatch-note",
  requireModuleAccess(MODULES.DISPATCH, "WRITE"),
  previewDispatchNote
);
dispatchRouter.get("/", requireModuleAccess(MODULES.DISPATCH, "READ"), listDispatches);
dispatchRouter.get(
  "/:dispatchNoteNumber",
  requireModuleAccess(MODULES.DISPATCH, "READ"),
  getDispatch
);
dispatchRouter.post("/", requireModuleAccess(MODULES.DISPATCH, "WRITE"), createDispatch);
dispatchRouter.put(
  "/:dispatchNoteNumber",
  requireModuleAccess(MODULES.DISPATCH, "WRITE"),
  updateDispatch
);
