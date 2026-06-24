import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess, requireFullAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import {
  listRoles,
  listModules,
  getRolePermissions,
  updateRolePermissions,
  resetRolePermissions,
} from "../controllers/roles.controller.js";

export const rolesRouter = Router();

rolesRouter.use(authenticate);

rolesRouter.get("/modules", requireModuleAccess(MODULES.USERS_ROLES, "READ"), listModules);
rolesRouter.get("/", requireModuleAccess(MODULES.USERS_ROLES, "READ"), listRoles);
rolesRouter.get(
  "/:code/permissions",
  requireModuleAccess(MODULES.USERS_ROLES, "READ"),
  getRolePermissions
);
rolesRouter.put(
  "/:code/permissions",
  requireFullAccess(MODULES.USERS_ROLES),
  updateRolePermissions
);
rolesRouter.post(
  "/:code/permissions/reset",
  requireFullAccess(MODULES.USERS_ROLES),
  resetRolePermissions
);
