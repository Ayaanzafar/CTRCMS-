export const ROLES = {
  ADMIN: "ADMIN",
  PURCHASE_WAREHOUSE: "PURCHASE_WAREHOUSE",
  SLITTER_PROCESSING: "SLITTER_PROCESSING",
  PRODUCTION: "PRODUCTION",
  QC: "QC",
  DISPATCH: "DISPATCH",
  SITE_EPC: "SITE_EPC",
  MANAGEMENT: "MANAGEMENT",
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_DEFINITIONS: Array<{
  code: RoleCode;
  name: string;
  description: string;
}> = [
  {
    code: ROLES.ADMIN,
    name: "Admin",
    description:
      "Full access; manages users, roles, master data, and system configuration.",
  },
  {
    code: ROLES.PURCHASE_WAREHOUSE,
    name: "Purchase / Warehouse Team",
    description:
      "Creates Coil Master records; uploads MTC/invoice; manages storage/inspection entries.",
  },
  {
    code: ROLES.SLITTER_PROCESSING,
    name: "Slitter / Processing Team",
    description:
      "Records slitting events, slit coil generation, and dispatch to Sunrack.",
  },
  {
    code: ROLES.PRODUCTION,
    name: "Production Team",
    description:
      "Records issue of slit coils to production, production orders, batch numbers, and quantities produced.",
  },
  {
    code: ROLES.QC,
    name: "QC Team",
    description:
      "Records QC inspection results, remarks, and photos; approves/rejects batches.",
  },
  {
    code: ROLES.DISPATCH,
    name: "Dispatch Team",
    description:
      "Creates dispatch records to project sites; manages vehicle/transporter details.",
  },
  {
    code: ROLES.SITE_EPC,
    name: "Site Team / EPC Coordinator",
    description:
      "Confirms site receipt and installation details; uploads installation photos.",
  },
  {
    code: ROLES.MANAGEMENT,
    name: "Management",
    description:
      "Read-only access to all modules; views dashboards, traceability reports, and complaint analytics.",
  },
];
