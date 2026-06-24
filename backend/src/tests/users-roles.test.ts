import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { MODULES } from "../constants/modules.js";

const TEST_EMAIL = "users-roles-test@sunrack.local";

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.token as string;
}

describe("Users & Roles API", () => {
  let adminToken: string;
  let createdUserId: string;

  beforeAll(async () => {
    adminToken = await login("admin@sunrack.local", "Admin@12345");
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  });

  it("lists users and roles for admin", async () => {
    const usersRes = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(usersRes.status).toBe(200);
    expect(Array.isArray(usersRes.body.users)).toBe(true);
    expect(usersRes.body.users.length).toBeGreaterThan(0);

    const rolesRes = await request(app)
      .get("/api/roles")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(rolesRes.status).toBe(200);
    expect(rolesRes.body.roles.length).toBe(8);
  });

  it("returns admin permissions as FULL on all modules grouped by phase", async () => {
    const res = await request(app)
      .get("/api/roles/ADMIN/permissions")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.modulesByPhase.length).toBeGreaterThan(0);

    for (const mod of Object.values(MODULES)) {
      expect(res.body.role.permissions[mod]).toBe("FULL");
    }
  });

  it("creates, updates, and deactivates a user", async () => {
    const createRes = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: TEST_EMAIL,
        password: "Test@12345",
        fullName: "Users Roles Test",
        roleCode: "QC",
      });

    expect(createRes.status).toBe(201);
    createdUserId = createRes.body.user.id;
    expect(createRes.body.user.role.code).toBe("QC");

    const getRes = await request(app)
      .get(`/api/users/${createdUserId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.user.email).toBe(TEST_EMAIL);

    const updateRes = await request(app)
      .put(`/api/users/${createdUserId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fullName: "Users Roles Updated", roleCode: "PRODUCTION" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.user.fullName).toBe("Users Roles Updated");
    expect(updateRes.body.user.role.code).toBe("PRODUCTION");

    const deactivateRes = await request(app)
      .patch(`/api/users/${createdUserId}/deactivate`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.user.isActive).toBe(false);
  });

  it("updates non-admin role permissions and resets to defaults", async () => {
    const getRes = await request(app)
      .get("/api/roles/QC/permissions")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(getRes.status).toBe(200);

    const updated = { ...getRes.body.role.permissions, [MODULES.COMPLAINT]: "FULL" };

    const saveRes = await request(app)
      .put("/api/roles/QC/permissions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ permissions: updated });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.role.permissions[MODULES.COMPLAINT]).toBe("FULL");

    const resetRes = await request(app)
      .post("/api/roles/QC/permissions/reset")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.role.permissions[MODULES.COMPLAINT]).toBe("READ");
  });

  it("rejects modifying admin role permissions", async () => {
    const res = await request(app)
      .put("/api/roles/ADMIN/permissions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        permissions: { [MODULES.COIL_MASTER]: "READ" },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Admin role/i);
  });
});
