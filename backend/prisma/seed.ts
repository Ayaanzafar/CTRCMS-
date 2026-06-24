import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { ROLE_DEFINITIONS } from "../src/constants/roles.js";
import { DEFAULT_ROLE_PERMISSIONS } from "../src/constants/modules.js";
import { seedDemoData } from "./seed-demo-data.js";

const prisma = new PrismaClient();

const DEMO_USERS = [
  {
    email: "admin@sunrack.local",
    password: "Admin@12345",
    fullName: "System Administrator",
    roleCode: "ADMIN",
  },
  {
    email: "warehouse@sunrack.local",
    password: "Warehouse@123",
    fullName: "Warehouse Team Lead",
    roleCode: "PURCHASE_WAREHOUSE",
  },
  {
    email: "slitter@sunrack.local",
    password: "Slitter@123",
    fullName: "Slitter Operator",
    roleCode: "SLITTER_PROCESSING",
  },
  {
    email: "production@sunrack.local",
    password: "Production@123",
    fullName: "Production Supervisor",
    roleCode: "PRODUCTION",
  },
  {
    email: "qc@sunrack.local",
    password: "QC@12345",
    fullName: "QC Inspector",
    roleCode: "QC",
  },
  {
    email: "dispatch@sunrack.local",
    password: "Dispatch@123",
    fullName: "Dispatch Coordinator",
    roleCode: "DISPATCH",
  },
  {
    email: "site@sunrack.local",
    password: "Site@12345",
    fullName: "EPC Site Coordinator",
    roleCode: "SITE_EPC",
  },
  {
    email: "management@sunrack.local",
    password: "Management@123",
    fullName: "Plant Management",
    roleCode: "MANAGEMENT",
  },
];

async function main() {
  console.log("Seeding roles and permissions...");

  for (const roleDef of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { code: roleDef.code },
      update: {
        name: roleDef.name,
        description: roleDef.description,
      },
      create: {
        code: roleDef.code,
        name: roleDef.name,
        description: roleDef.description,
      },
    });

    const permissions = DEFAULT_ROLE_PERMISSIONS[roleDef.code];

    for (const [module, access] of Object.entries(permissions)) {
      await prisma.roleModulePermission.upsert({
        where: {
          roleId_module: {
            roleId: role.id,
            module,
          },
        },
        update: { access },
        create: {
          roleId: role.id,
          module,
          access,
        },
      });
    }
  }

  console.log("Seeding demo users (one per role)...");

  for (const demo of DEMO_USERS) {
    const role = await prisma.role.findUnique({ where: { code: demo.roleCode } });

    if (!role) {
      throw new Error(`Role not found: ${demo.roleCode}`);
    }

    const passwordHash = await bcrypt.hash(demo.password, 12);

    await prisma.user.upsert({
      where: { email: demo.email },
      update: {
        fullName: demo.fullName,
        passwordHash,
        roleId: role.id,
        isActive: true,
      },
      create: {
        email: demo.email,
        fullName: demo.fullName,
        passwordHash,
        roleId: role.id,
      },
    });
  }

  const [roleCount, userCount] = await Promise.all([
    prisma.role.count(),
    prisma.user.count(),
  ]);

  console.log(`Seed complete: ${roleCount} roles, ${userCount} users`);

  await seedDemoData();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
