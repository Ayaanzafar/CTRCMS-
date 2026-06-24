import type { ModuleAccess } from "../types/module-access.js";
import { ROLES, type RoleCode } from "./roles.js";

export const MODULES = {
  DASHBOARD: "dashboard",
  COIL_MASTER: "coil-master",
  SLITTING: "slitting",
  SUNRACK_RECEIPT: "sunrack-receipt",
  PRODUCTION: "production",
  FINISHED_GOODS: "finished-goods",
  QC_INSPECTION: "qc-inspection",
  DISPATCH: "dispatch",
  SITE_INSTALLATION: "site-installation",
  COMPLAINT: "complaint",
  TRACEABILITY: "traceability",
  DOCUMENTS: "documents",
  USERS_ROLES: "users-roles",
} as const;

export type ModuleCode = (typeof MODULES)[keyof typeof MODULES];

export const MODULE_DEFINITIONS: Array<{
  code: ModuleCode;
  name: string;
  description: string;
  path: string;
  phase: number;
}> = [
  {
    code: MODULES.DASHBOARD,
    name: "Dashboard",
    description: "Management overview, complaint analytics, and KPIs.",
    path: "/dashboard",
    phase: 10,
  },
  {
    code: MODULES.COIL_MASTER,
    name: "Coil Master / Inward",
    description: "Original coil details received from AMNS at the slitter.",
    path: "/coil-master",
    phase: 1,
  },
  {
    code: MODULES.SLITTING,
    name: "Slitting Tracking",
    description: "Parent coil to slit coil mapping, slitting date, and yield.",
    path: "/slitting",
    phase: 2,
  },
  {
    code: MODULES.SUNRACK_RECEIPT,
    name: "Sunrack Receipt & Storage",
    description: "Receipt, storage, and inspection of slit coils at Sunrack.",
    path: "/sunrack-receipt",
    phase: 3,
  },
  {
    code: MODULES.PRODUCTION,
    name: "Production Tracking",
    description: "Issue of slit coils to production orders and batch numbers.",
    path: "/production",
    phase: 4,
  },
  {
    code: MODULES.FINISHED_GOODS,
    name: "Finished Goods",
    description: "Finished product inventory — QC-passed batches available for dispatch.",
    path: "/finished-goods",
    phase: 4,
  },
  {
    code: MODULES.QC_INSPECTION,
    name: "QC Inspection",
    description: "Quality sign-off on production batches before dispatch release.",
    path: "/qc-inspection",
    phase: 5,
  },
  {
    code: MODULES.DISPATCH,
    name: "Dispatch",
    description: "Outbound shipment of finished goods to client project sites.",
    path: "/dispatch",
    phase: 6,
  },
  {
    code: MODULES.SITE_INSTALLATION,
    name: "Site Installation",
    description: "Site receipt and installation at EPC/client locations.",
    path: "/site-installation",
    phase: 7,
  },
  {
    code: MODULES.COMPLAINT,
    name: "Complaint Management",
    description: "Rust/quality complaints with auto backward traceability.",
    path: "/complaints",
    phase: 8,
  },
  {
    code: MODULES.TRACEABILITY,
    name: "Traceability Report",
    description: "Chronological timeline from coil to complaint (core feature).",
    path: "/traceability",
    phase: 9,
  },
  {
    code: MODULES.DOCUMENTS,
    name: "Documents & Photos",
    description: "MTC, invoices, delivery notes, QC reports, and site photos.",
    path: "/documents",
    phase: 11,
  },
  {
    code: MODULES.USERS_ROLES,
    name: "Users & Roles",
    description: "User management, role permissions, and approvals.",
    path: "/users-roles",
    phase: 12,
  },
];

type PermissionMap = Record<ModuleCode, ModuleAccess>;

const fullAccess = (): PermissionMap =>
  Object.fromEntries(
    Object.values(MODULES).map((m) => [m, "FULL" as ModuleAccess])
  ) as PermissionMap;

const readAll = (): PermissionMap =>
  Object.fromEntries(
    Object.values(MODULES).map((m) => [m, "READ" as ModuleAccess])
  ) as PermissionMap;

const none = (): PermissionMap =>
  Object.fromEntries(
    Object.values(MODULES).map((m) => [m, "NONE" as ModuleAccess])
  ) as PermissionMap;

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, PermissionMap> = {
  [ROLES.ADMIN]: fullAccess(),

  [ROLES.PURCHASE_WAREHOUSE]: {
    ...none(),
    [MODULES.COIL_MASTER]: "WRITE",
    [MODULES.SLITTING]: "READ",
    [MODULES.SUNRACK_RECEIPT]: "WRITE",
    [MODULES.DOCUMENTS]: "WRITE",
    [MODULES.TRACEABILITY]: "READ",
    [MODULES.COMPLAINT]: "READ",
  },

  [ROLES.SLITTER_PROCESSING]: {
    ...none(),
    [MODULES.COIL_MASTER]: "READ",
    [MODULES.SLITTING]: "WRITE",
    [MODULES.DOCUMENTS]: "WRITE",
    [MODULES.TRACEABILITY]: "READ",
    [MODULES.COMPLAINT]: "READ",
  },

  [ROLES.PRODUCTION]: {
    ...none(),
    [MODULES.SLITTING]: "READ",
    [MODULES.SUNRACK_RECEIPT]: "READ",
    [MODULES.PRODUCTION]: "WRITE",
    [MODULES.FINISHED_GOODS]: "WRITE",
    [MODULES.DOCUMENTS]: "WRITE",
    [MODULES.TRACEABILITY]: "READ",
    [MODULES.COMPLAINT]: "READ",
  },

  [ROLES.QC]: {
    ...none(),
    [MODULES.PRODUCTION]: "READ",
    [MODULES.FINISHED_GOODS]: "READ",
    [MODULES.QC_INSPECTION]: "WRITE",
    [MODULES.DOCUMENTS]: "WRITE",
    [MODULES.TRACEABILITY]: "READ",
    [MODULES.COMPLAINT]: "READ",
  },

  [ROLES.DISPATCH]: {
    ...none(),
    [MODULES.FINISHED_GOODS]: "READ",
    [MODULES.QC_INSPECTION]: "READ",
    [MODULES.DISPATCH]: "WRITE",
    [MODULES.DOCUMENTS]: "WRITE",
    [MODULES.TRACEABILITY]: "READ",
    [MODULES.COMPLAINT]: "READ",
  },

  [ROLES.SITE_EPC]: {
    ...none(),
    [MODULES.DISPATCH]: "READ",
    [MODULES.SITE_INSTALLATION]: "WRITE",
    [MODULES.DOCUMENTS]: "WRITE",
    [MODULES.TRACEABILITY]: "READ",
    [MODULES.COMPLAINT]: "WRITE",
  },

  [ROLES.MANAGEMENT]: {
    ...readAll(),
    [MODULES.USERS_ROLES]: "NONE",
    [MODULES.DASHBOARD]: "READ",
  },
};
