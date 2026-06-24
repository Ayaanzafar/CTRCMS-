import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess, requireFullAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deactivateUser,
} from "../controllers/users.controller.js";

export const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter.get("/", requireModuleAccess(MODULES.USERS_ROLES, "READ"), listUsers);
usersRouter.get("/:id", requireModuleAccess(MODULES.USERS_ROLES, "READ"), getUser);
usersRouter.post("/", requireFullAccess(MODULES.USERS_ROLES), createUser);
usersRouter.put("/:id", requireFullAccess(MODULES.USERS_ROLES), updateUser);
usersRouter.patch("/:id/deactivate", requireFullAccess(MODULES.USERS_ROLES), deactivateUser);
