import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

const BATCH = "BATCH-DASH-QC-FAIL";
const SLIT = "DASH-COIL-S01";
const COIL = "DASH-COIL-001";
const COMPLAINT = "COMP-DASH-TEST-001";

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.token as string;
}

async function setupTestData() {
  await prisma.systemNotification.deleteMany({});
  await prisma.complaintBatchLine.deleteMany({ where: { complaintId: COMPLAINT } });
  await prisma.complaint.deleteMany({ where: { complaintId: COMPLAINT } });
  await prisma.qCInspection.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.batchSlitCoilMap.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.productionBatch.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.sunrackReceipt.deleteMany({ where: { slitCoilId: SLIT } });
  await prisma.slittingRecord.deleteMany({ where: { slitCoilId: SLIT } });
  await prisma.coil.deleteMany({ where: { coilNumber: COIL } });

  await prisma.coil.create({
    data: {
      coilNumber: COIL,
      grade: "AMNS550S",
      coating: "ZM150",
      size: "1250 x 0.5 mm",
      weight: 5,
    },
  });

  await prisma.slittingRecord.create({
    data: {
      slitCoilId: SLIT,
      parentCoilNumber: COIL,
      slitWidthSize: "1040 x 0.5 mm",
      slittingDate: new Date("2026-01-10"),
      slitCoilWeight: 4,
    },
  });

  await prisma.sunrackReceipt.create({
    data: {
      slitCoilId: SLIT,
      receiptDateSunrack: new Date("2026-01-15"),
      storageLocationBin: "WH-DASH",
      inspectionResult: "PASS",
    },
  });

  await prisma.productionBatch.create({
    data: {
      batchNumber: BATCH,
      productionOrderNumber: "PO-DASH-001",
      productType: "Walkway Tray",
      quantityProduced: 50,
      productionDate: new Date("2026-01-20"),
      operatorShift: "Shift A",
      slitCoilConsumptions: {
        create: { slitCoilId: SLIT, quantityConsumed: 0.5 },
      },
    },
  });

  await prisma.siteDispatch.create({
    data: {
      dispatchNoteNumber: "DN-DASH-TEST-001",
      dispatchDate: new Date("2026-02-01"),
      projectName: "Dashboard Test Project",
      clientName: "Dash Client",
      siteLocation: "Pune",
      batchLines: {
        create: { batchNumber: BATCH, quantityDispatched: 10 },
      },
    },
  }).catch(() => {});
}

async function cleanup() {
  await prisma.systemNotification.deleteMany({});
  await prisma.complaintBatchLine.deleteMany({ where: { complaintId: COMPLAINT } });
  await prisma.complaint.deleteMany({ where: { complaintId: COMPLAINT } });
  await prisma.dispatchBatchLine.deleteMany({ where: { dispatchNoteNumber: "DN-DASH-TEST-001" } });
  await prisma.siteDispatch.deleteMany({ where: { dispatchNoteNumber: "DN-DASH-TEST-001" } });
  await prisma.qCInspection.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.batchSlitCoilMap.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.productionBatch.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.sunrackReceipt.deleteMany({ where: { slitCoilId: SLIT } });
  await prisma.slittingRecord.deleteMany({ where: { slitCoilId: SLIT } });
  await prisma.coil.deleteMany({ where: { coilNumber: COIL } });
}

describe("Phase 10 — Dashboard API", () => {
  let adminToken: string;
  let managementToken: string;
  let qcToken: string;
  let siteToken: string;

  beforeAll(async () => {
    adminToken = await login("admin@sunrack.local", "Admin@12345");
    managementToken = await login("management@sunrack.local", "Management@123");
    qcToken = await login("qc@sunrack.local", "QC@12345");
    siteToken = await login("site@sunrack.local", "Site@12345");
    await cleanup();
    await setupTestData();
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("returns dashboard overview for management", async () => {
    const res = await request(app)
      .get("/api/dashboard/overview")
      .set("Authorization", `Bearer ${managementToken}`);

    expect(res.status).toBe(200);
    expect(res.body.overview.kpis).toMatchObject({
      totalCoils: expect.any(Number),
      batchesPendingQc: expect.any(Number),
      openComplaints: expect.any(Number),
      totalDispatches: expect.any(Number),
    });
    expect(Array.isArray(res.body.overview.rootCauseBreakdown)).toBe(true);
    expect(Array.isArray(res.body.overview.recentDispatches)).toBe(true);
    expect(Array.isArray(res.body.overview.pendingQcBatches)).toBe(true);
    expect(Array.isArray(res.body.overview.openComplaints)).toBe(true);
  });

  it("returns audit logs with user details", async () => {
    const res = await request(app)
      .get("/api/dashboard/audit-logs?limit=5")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(0);
    if (res.body.logs.length > 0) {
      expect(res.body.logs[0].user).toHaveProperty("fullName");
      expect(res.body.logs[0]).toHaveProperty("action");
    }
  });

  it("creates notification on QC failure", async () => {
    const res = await request(app)
      .post("/api/qc")
      .set("Authorization", `Bearer ${qcToken}`)
      .send({
        batchNumber: BATCH,
        qcResult: "FAIL",
        inspectorName: "Dashboard QC Test",
        inspectionDate: "2026-01-21",
        qcRemarks: "Coating defect for dashboard test",
      });

    expect(res.status).toBe(201);

    const notifications = await request(app)
      .get("/api/dashboard/notifications?unreadOnly=true")
      .set("Authorization", `Bearer ${managementToken}`);

    expect(notifications.status).toBe(200);
    expect(
      notifications.body.notifications.some(
        (n: { type: string; entityId: string }) =>
          n.type === "QC_FAILED" && n.entityId === BATCH
      )
    ).toBe(true);
  });

  it("creates notification on complaint creation", async () => {
    const res = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${siteToken}`)
      .send({
        complaintId: COMPLAINT,
        complaintDate: "2026-03-01",
        projectName: "Dashboard Test Project",
        clientName: "Dash Client",
        siteLocation: "Pune",
        complaintDescription: "Dashboard notification test complaint",
        batchNumbers: [BATCH],
      });

    expect(res.status).toBe(201);

    const notifications = await request(app)
      .get("/api/dashboard/notifications")
      .set("Authorization", `Bearer ${managementToken}`);

    expect(
      notifications.body.notifications.some(
        (n: { type: string; entityId: string }) =>
          n.type === "COMPLAINT_CREATED" && n.entityId === COMPLAINT
      )
    ).toBe(true);
  });

  it("marks notifications as read", async () => {
    const list = await request(app)
      .get("/api/dashboard/notifications?unreadOnly=true")
      .set("Authorization", `Bearer ${managementToken}`);

    const id = list.body.notifications[0]?.id;
    expect(id).toBeTruthy();

    const mark = await request(app)
      .patch(`/api/dashboard/notifications/${id}/read`)
      .set("Authorization", `Bearer ${managementToken}`);

    expect(mark.status).toBe(200);
    expect(mark.body.unreadCount).toBeGreaterThanOrEqual(0);
  });

  it("marks all notifications read", async () => {
    const res = await request(app)
      .patch("/api/dashboard/notifications/read")
      .set("Authorization", `Bearer ${managementToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(0);
  });

  it("denies dashboard access to roles without permission", async () => {
    const res = await request(app)
      .get("/api/dashboard/overview")
      .set("Authorization", `Bearer ${qcToken}`);

    expect(res.status).toBe(403);
  });

  it("denies unauthenticated access", async () => {
    const res = await request(app).get("/api/dashboard/overview");
    expect(res.status).toBe(401);
  });
});
