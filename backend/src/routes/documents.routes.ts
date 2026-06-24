import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import {
  getDocumentsStats,
  listAllDocuments,
  getDocumentsByReference,
} from "../controllers/documents.controller.js";

export const documentsRouter = Router();

documentsRouter.use(authenticate);

documentsRouter.get(
  "/stats",
  requireModuleAccess(MODULES.DOCUMENTS, "READ"),
  getDocumentsStats
);

documentsRouter.get(
  "/by-reference",
  requireModuleAccess(MODULES.DOCUMENTS, "READ"),
  getDocumentsByReference
);

documentsRouter.get("/", requireModuleAccess(MODULES.DOCUMENTS, "READ"), listAllDocuments);
