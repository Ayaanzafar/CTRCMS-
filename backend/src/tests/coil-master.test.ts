import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

const COIL = "COIL-LIFE-TEST-001";
const COIL_LINKED = "COIL-LIFE-LINKED-001";
const SLIT = "COIL-LIFE-S01";

async function login() {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@sunrack.local", password: "Admin@12345" });
  return res.body.token as string;
}

describe("Coil Master lifecycle", () => {
  let token: string;

  beforeAll(async () => {
    token = await login();

    await prisma.slittingRecord.deleteMany({ where: { slitCoilId: SLIT } });
    await prisma.coilDocument.deleteMany({
      where: { coilNumber: { in: [COIL, COIL_LINKED] } },
    });
    await prisma.coil.deleteMany({
      where: { coilNumber: { in: [COIL, COIL_LINKED] } },
    });

    await prisma.coil.create({
      data: {
        coilNumber: COIL,
        grade: "AMNS550S",
        coating: "ZM150",
        size: "1250 x 0.5 mm",
        weight: 5,
      },
    });

    await prisma.coil.create({
      data: {
        coilNumber: COIL_LINKED,
        grade: "AMNS550S",
        coating: "ZM150",
        size: "1250 x 0.5 mm",
        weight: 4,
        slittingRecords: {
          create: {
            slitCoilId: SLIT,
            slitWidthSize: "1040 x 0.5 mm",
            slittingDate: new Date("2026-01-10"),
            slitCoilWeight: 3.5,
          },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.slittingRecord.deleteMany({ where: { slitCoilId: SLIT } });
    await prisma.coilDocument.deleteMany({
      where: { coilNumber: { in: [COIL, COIL_LINKED] } },
    });
    await prisma.coil.deleteMany({
      where: { coilNumber: { in: [COIL, COIL_LINKED] } },
    });
  });

  it("lists active coils by default and hides archived", async () => {
    const res = await request(app)
      .get("/api/coils")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.coils.some((c: { coilNumber: string }) => c.coilNumber === COIL)).toBe(true);
  });

  it("returns usage info for linked and unlinked coils", async () => {
    const unused = await request(app)
      .get(`/api/coils/${COIL}/usage`)
      .set("Authorization", `Bearer ${token}`);
    expect(unused.status).toBe(200);
    expect(unused.body.usage.canDelete).toBe(true);
    expect(unused.body.usage.canArchive).toBe(false);
    expect(unused.body.usage.canEditCriticalFields).toBe(true);

    const linked = await request(app)
      .get(`/api/coils/${COIL_LINKED}/usage`)
      .set("Authorization", `Bearer ${token}`);
    expect(linked.status).toBe(200);
    expect(linked.body.usage.canDelete).toBe(false);
    expect(linked.body.usage.canArchive).toBe(true);
    expect(linked.body.usage.canEditCriticalFields).toBe(false);
    expect(linked.body.usage.slittingRecords).toBe(1);
  });

  it("allows editing business fields on linked coil but blocks critical fields", async () => {
    const ok = await request(app)
      .put(`/api/coils/${COIL_LINKED}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ invoiceNumber: "INV-LIFE-001", transporterName: "Test Transporter" });
    expect(ok.status).toBe(200);
    expect(ok.body.coil.invoiceNumber).toBe("INV-LIFE-001");

    const blocked = await request(app)
      .put(`/api/coils/${COIL_LINKED}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ grade: "CHANGED-GRADE" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.lockedFields).toContain("grade");
  });

  it("deletes unused coil and archives linked coil", async () => {
    const delFail = await request(app)
      .delete(`/api/coils/${COIL_LINKED}`)
      .set("Authorization", `Bearer ${token}`);
    expect(delFail.status).toBe(409);

    const archive = await request(app)
      .patch(`/api/coils/${COIL_LINKED}/archive`)
      .set("Authorization", `Bearer ${token}`);
    expect(archive.status).toBe(200);
    expect(archive.body.coil.status).toBe("ARCHIVED");

    const hidden = await request(app)
      .get("/api/coils")
      .set("Authorization", `Bearer ${token}`);
    expect(
      hidden.body.coils.some((c: { coilNumber: string }) => c.coilNumber === COIL_LINKED)
    ).toBe(false);

    const visible = await request(app)
      .get("/api/coils?includeArchived=true")
      .set("Authorization", `Bearer ${token}`);
    expect(
      visible.body.coils.some((c: { coilNumber: string }) => c.coilNumber === COIL_LINKED)
    ).toBe(true);

    const getArchived = await request(app)
      .get(`/api/coils/${COIL_LINKED}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getArchived.status).toBe(200);
    expect(getArchived.body.coil.status).toBe("ARCHIVED");

    const delOk = await request(app)
      .delete(`/api/coils/${COIL}`)
      .set("Authorization", `Bearer ${token}`);
    expect(delOk.status).toBe(200);

    const audit = await prisma.auditLog.findMany({
      where: { entityType: "Coil", entityId: { in: [COIL, COIL_LINKED] } },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.some((a) => a.action === "ARCHIVE" && a.entityId === COIL_LINKED)).toBe(true);
    expect(audit.some((a) => a.action === "DELETE" && a.entityId === COIL)).toBe(true);
  });

  it("deletes an attached coil document with audit log", async () => {
    const doc = await prisma.coilDocument.create({
      data: {
        coilNumber: COIL_LINKED,
        documentType: "MTC",
        filename: "test-mtc.pdf",
        originalName: "test-mtc.pdf",
        mimetype: "application/pdf",
        size: 1024,
        storagePath: "/tmp/nonexistent-coil-doc-test.pdf",
      },
    });

    const res = await request(app)
      .delete(`/api/coils/documents/${doc.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.coilNumber).toBe(COIL_LINKED);

    const gone = await prisma.coilDocument.findUnique({ where: { id: doc.id } });
    expect(gone).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "CoilDocument", entityId: doc.id, action: "DELETE" },
    });
    expect(audit).toBeTruthy();
  });

  it("rejects slitting against archived parent coil", async () => {
    const res = await request(app)
      .post("/api/slitting/batch")
      .set("Authorization", `Bearer ${token}`)
      .send({
        parentCoilNumber: COIL_LINKED,
        slittingDate: "2026-02-01",
        slitCoils: [{ slitWidthSize: "1040 x 0.5 mm", slitCoilWeight: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/archived/i);
  });

  it("returns aggregate stats", async () => {
    const res = await request(app)
      .get("/api/coils/stats?includeArchived=true")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({
      total: expect.any(Number),
      active: expect.any(Number),
      archived: expect.any(Number),
      inTrace: expect.any(Number),
      withDocs: expect.any(Number),
    });
  });

  it("paginates and sorts coil list while preserving full list without limit", async () => {
    const paged = await request(app)
      .get("/api/coils?limit=1&offset=0&sortBy=coilNumber&sortOrder=asc")
      .set("Authorization", `Bearer ${token}`);
    expect(paged.status).toBe(200);
    expect(paged.body.coils).toHaveLength(1);
    expect(paged.body.total).toBeGreaterThanOrEqual(1);
    expect(paged.body.limit).toBe(1);
    expect(paged.body.offset).toBe(0);

    const full = await request(app)
      .get("/api/coils")
      .set("Authorization", `Bearer ${token}`);
    expect(full.status).toBe(200);
    expect(full.body.total).toBeGreaterThanOrEqual(paged.body.total);
    expect(full.body.limit).toBeUndefined();
  });

  it("filters coils by quickFilter missingMtc", async () => {
    const res = await request(app)
      .get("/api/coils?quickFilter=missingMtc&includeArchived=true")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.coils)).toBe(true);
  });

  it("returns audit logs for a coil", async () => {
    const res = await request(app)
      .get(`/api/coils/${COIL_LINKED}/audit-logs`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
  });
});
