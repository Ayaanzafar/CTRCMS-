import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import { upload, handleUploadError } from "../middleware/upload.js";
import {
  getSiteInstallationStats,
  listPendingDispatches,
  listSiteInstallations,
  getSiteInstallation,
  getSiteInstallationByDispatch,
  createSiteInstallation,
  updateSiteInstallation,
  attachSiteInstallationPhotos,
  serveSiteInstallationPhoto,
} from "../controllers/site-installation.controller.js";

export const siteInstallationRouter = Router();

siteInstallationRouter.use(authenticate);

siteInstallationRouter.get(
  "/stats",
  requireModuleAccess(MODULES.SITE_INSTALLATION, "READ"),
  getSiteInstallationStats
);
siteInstallationRouter.get(
  "/pending-dispatches",
  requireModuleAccess(MODULES.SITE_INSTALLATION, "READ"),
  listPendingDispatches
);
siteInstallationRouter.get(
  "/photos/:photoId/file",
  requireModuleAccess(MODULES.SITE_INSTALLATION, "READ"),
  serveSiteInstallationPhoto
);
siteInstallationRouter.get(
  "/by-dispatch/:dispatchNoteNumber",
  requireModuleAccess(MODULES.SITE_INSTALLATION, "READ"),
  getSiteInstallationByDispatch
);
siteInstallationRouter.get(
  "/",
  requireModuleAccess(MODULES.SITE_INSTALLATION, "READ"),
  listSiteInstallations
);
siteInstallationRouter.get(
  "/:id",
  requireModuleAccess(MODULES.SITE_INSTALLATION, "READ"),
  getSiteInstallation
);
siteInstallationRouter.post(
  "/",
  requireModuleAccess(MODULES.SITE_INSTALLATION, "WRITE"),
  createSiteInstallation
);
siteInstallationRouter.put(
  "/:id",
  requireModuleAccess(MODULES.SITE_INSTALLATION, "WRITE"),
  updateSiteInstallation
);
siteInstallationRouter.post(
  "/:id/photos",
  requireModuleAccess(MODULES.SITE_INSTALLATION, "WRITE"),
  upload.array("photos", 10),
  handleUploadError,
  attachSiteInstallationPhotos
);
