import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ROLE_DEFINITIONS, ROLES } from "../constants/roles.js";
import {
  DEFAULT_ROLE_PERMISSIONS,
  MODULE_DEFINITIONS,
  MODULES,
  type ModuleCode,
} from "../constants/modules.js";
import type { ModuleAccess } from "../types/module-access.js";

const accessLevelSchema = z.enum(["NONE", "READ", "WRITE", "FULL"]);

const updatePermissionsSchema = z.object({
  permissions: z.record(accessLevelSchema),
});

export async function listRoles(_req: Request, res: Response): Promise<void> {
  const roles = await prisma.role.findMany({
    include: {
      _count: { select: { users: true } },
      permissions: true,
    },
    orderBy: { name: "asc" },
  });

  res.json({ roles, definitions: ROLE_DEFINITIONS });
}

export async function listModules(_req: Request, res: Response): Promise<void> {
  res.json({ modules: MODULE_DEFINITIONS });
}

export async function getRolePermissions(req: Request, res: Response): Promise<void> {
  const { code } = req.params;

  const role = await prisma.role.findUnique({
    where: { code },
    include: { permissions: true },
  });

  if (!role) {
    res.status(404).json({ error: "Role not found" });
    return;
  }

  const permissions = Object.fromEntries(
    role.permissions.map((p) => [p.module, p.access])
  ) as Record<string, ModuleAccess>;

  res.json({
    role: {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      permissions,
    },
    modulesByPhase: groupModulesByPhase(),
  });
}

function groupModulesByPhase() {
  const groups = new Map<number, typeof MODULE_DEFINITIONS>();

  for (const mod of MODULE_DEFINITIONS) {
    const phase = mod.phase;
    if (!groups.has(phase)) groups.set(phase, []);
    groups.get(phase)!.push(mod);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([phase, modules]) => ({ phase, modules }));
}

export async function updateRolePermissions(req: Request, res: Response): Promise<void> {
  const { code } = req.params;
  const parsed = updatePermissionsSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const role = await prisma.role.findUnique({
    where: { code },
    include: { permissions: true },
  });

  if (!role) {
    res.status(404).json({ error: "Role not found" });
    return;
  }

  if (role.code === ROLES.ADMIN) {
    res.status(400).json({
      error: "Admin role always has FULL access on all modules and cannot be modified",
    });
    return;
  }

  const validModules = new Set(Object.values(MODULES));
  const incoming = parsed.data.permissions;

  for (const key of Object.keys(incoming)) {
    if (!validModules.has(key as ModuleCode)) {
      res.status(400).json({ error: `Unknown module: ${key}` });
      return;
    }
  }

  const oldPermissions = Object.fromEntries(
    role.permissions.map((p) => [p.module, p.access])
  );

  await prisma.$transaction(async (tx) => {
    for (const moduleCode of Object.values(MODULES)) {
      const access = (incoming[moduleCode] ?? "NONE") as ModuleAccess;

      await tx.roleModulePermission.upsert({
        where: {
          roleId_module: {
            roleId: role.id,
            module: moduleCode,
          },
        },
        update: { access },
        create: {
          roleId: role.id,
          module: moduleCode,
          access,
        },
      });
    }
  });

  const updated = await prisma.role.findUnique({
    where: { code },
    include: { permissions: true },
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "UPDATE",
        entityType: "RolePermissions",
        entityId: role.code,
        oldValues: oldPermissions,
        newValues: incoming,
      },
    });
  }

  const permissions = Object.fromEntries(
    updated!.permissions.map((p) => [p.module, p.access])
  );

  res.json({
    role: {
      code: updated!.code,
      name: updated!.name,
      permissions,
    },
  });
}

export async function resetRolePermissions(req: Request, res: Response): Promise<void> {
  const { code } = req.params;

  if (code === ROLES.ADMIN) {
    res.status(400).json({ error: "Admin role permissions are fixed at FULL" });
    return;
  }

  const roleCode = code as keyof typeof DEFAULT_ROLE_PERMISSIONS;
  const defaults = DEFAULT_ROLE_PERMISSIONS[roleCode];

  if (!defaults) {
    res.status(404).json({ error: "Role not found" });
    return;
  }

  req.body = { permissions: defaults };
  await updateRolePermissions(req, res);
}
