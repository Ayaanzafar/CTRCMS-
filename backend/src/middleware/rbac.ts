import type { ModuleAccess } from "../types/module-access.js";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import type { ModuleCode } from "../constants/modules.js";

const ACCESS_RANK: Record<ModuleAccess, number> = {
  NONE: 0,
  READ: 1,
  WRITE: 2,
  FULL: 3,
};

export function requireModuleAccess(
  module: ModuleCode,
  minimum: ModuleAccess = "READ"
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const permission = await prisma.roleModulePermission.findFirst({
      where: {
        role: { code: req.user.roleCode },
        module,
      },
    });

    const access = permission?.access ?? "NONE";

    if (ACCESS_RANK[access] < ACCESS_RANK[minimum]) {
      res.status(403).json({
        error: `Insufficient permissions for module: ${module}`,
        required: minimum,
        actual: access,
      });
      return;
    }

    next();
  };
}

/** FULL access — required for delete operations and role permission changes. */
export function requireFullAccess(module: ModuleCode) {
  return requireModuleAccess(module, "FULL");
}
