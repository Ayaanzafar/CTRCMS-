/** Mirrors Prisma enum ModuleAccess — kept local so IDE/tsc work even if client is stale. */
export const MODULE_ACCESS_VALUES = ["NONE", "READ", "WRITE", "FULL"] as const;

export type ModuleAccess = (typeof MODULE_ACCESS_VALUES)[number];
