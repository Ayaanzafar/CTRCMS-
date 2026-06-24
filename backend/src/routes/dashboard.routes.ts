import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import {
  getOverview,
  getAuditLogs,
  getNotifications,
  markNotificationsRead,
  markNotificationRead,
} from "../controllers/dashboard.controller.js";

export const dashboardRouter = Router();

dashboardRouter.use(authenticate);

dashboardRouter.get("/overview", requireModuleAccess(MODULES.DASHBOARD, "READ"), getOverview);
dashboardRouter.get("/audit-logs", requireModuleAccess(MODULES.DASHBOARD, "READ"), getAuditLogs);
dashboardRouter.get(
  "/notifications",
  requireModuleAccess(MODULES.DASHBOARD, "READ"),
  getNotifications
);
dashboardRouter.patch(
  "/notifications/read",
  requireModuleAccess(MODULES.DASHBOARD, "READ"),
  markNotificationsRead
);
dashboardRouter.patch(
  "/notifications/:id/read",
  requireModuleAccess(MODULES.DASHBOARD, "READ"),
  markNotificationRead
);
