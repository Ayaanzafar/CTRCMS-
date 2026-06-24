import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

const COMPLAINT_ID = "COMP-TEST-001";
const DISPATCH_NOTE = "DN-COMP-TEST-001";
const BATCH = "BATCH-COMP-TEST";
const TEST_SLIT = "V9888D000M-SC001";
const PARENT_COIL = "V9888D000M";

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.token as string;
}

async function setupTestData() {
  await prisma.sunrackReceipt.upsert({
    where: { slitCoilId: TEST_SLIT },
    create: {
      slitCoilId: TEST_SLIT,
      receiptDateSunrack: new Date("2026-02-01"),
      storageLocationBin: "WH-A",
      inspectionResult: "PASS",
    },
    update: { inspectionResult: "PASS" },
  });

  await prisma.productionBatch.upsert({
    where: { batchNumber: BATCH },
    create: {
      batchNumber: BATCH,
      productionOrderNumber: "PO-COMP-TEST",
      productType: "Walkway Tray",
      quantityProduced: 100,
      productionDate: new Date("2026-02-20"),
      operatorShift: "Shift A",
      slitCoilConsumptions: {
        create: { slitCoilId: TEST_SLIT, quantityConsumed: 0.5 },
      },
    },
    update: {},
  });

  await prisma.qCInspection.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.qCInspection.create({
    data: {
      batchNumber: BATCH,
      qcResult: "PASS",
      inspectorName: "QC Inspector",
      inspectionDate: new Date("2026-02-21"),
    },
  });

  await prisma.complaintPhoto.deleteMany({
    where: { complaint: { complaintId: COMPLAINT_ID } },
  });
  await prisma.complaintBatchLine.deleteMany({ where: { complaintId: COMPLAINT_ID } });
  await prisma.complaint.deleteMany({ where: { complaintId: COMPLAINT_ID } });
  await prisma.siteInstallation.deleteMany({ where: { dispatchNoteNumber: DISPATCH_NOTE } });
  await prisma.dispatchBatchLine.deleteMany({ where: { dispatchNoteNumber: DISPATCH_NOTE } });
  await prisma.siteDispatch.deleteMany({ where: { dispatchNoteNumber: DISPATCH_NOTE } });

  await prisma.siteDispatch.create({
    data: {
      dispatchNoteNumber: DISPATCH_NOTE,
      dispatchDate: new Date("2026-03-01"),
      projectName: "Complaint Test Project",
      clientName: "Test Client",
      siteLocation: "Pune",
      batchLines: {
        create: { batchNumber: BATCH, quantityDispatched: 50 },
      },
    },
  });
}

async function cleanup() {
  await prisma.complaintPhoto.deleteMany({
    where: { complaint: { complaintId: COMPLAINT_ID } },
  });
  await prisma.complaintBatchLine.deleteMany({ where: { complaintId: COMPLAINT_ID } });
  await prisma.complaint.deleteMany({ where: { complaintId: COMPLAINT_ID } });
  await prisma.siteInstallation.deleteMany({ where: { dispatchNoteNumber: DISPATCH_NOTE } });
  await prisma.dispatchBatchLine.deleteMany({ where: { dispatchNoteNumber: DISPATCH_NOTE } });
  await prisma.siteDispatch.deleteMany({ where: { dispatchNoteNumber: DISPATCH_NOTE } });
  await prisma.qCInspection.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.batchSlitCoilMap.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.productionBatch.deleteMany({ where: { batchNumber: BATCH } });
}

describe("Phase 8 — Complaint Management API", () => {
  let adminToken: string;
  let siteToken: string;

  beforeAll(async () => {
    adminToken = await login("admin@sunrack.local", "Admin@12345");
    siteToken = await login("site@sunrack.local", "Site@12345");
    await cleanup();
    await setupTestData();
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("returns complaint stats", async () => {
    const res = await request(app)
      .get("/api/complaints/stats")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stats).toHaveProperty("totalComplaints");
  });

  it("lists eligible dispatched batches", async () => {
    const res = await request(app)
      .get("/api/complaints/eligible-batches")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const numbers = res.body.batches.map((b: { batchNumber: string }) => b.batchNumber);
    expect(numbers).toContain(BATCH);
  });

  it("auto-resolves originating coil numbers (acceptance criteria)", async () => {
    const res = await request(app)
      .post("/api/complaints/resolve-trace")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ batchNumbers: [BATCH] });

    expect(res.status).toBe(200);
    expect(res.body.traceability.linkedCoilNumbers).toContain(PARENT_COIL);
    expect(res.body.traceability.linkedSlitCoilIds).toContain(TEST_SLIT);
    expect(res.body.traceability.coils[0].coilNumber).toBe(PARENT_COIL);
  });

  it("creates complaint linked to batch", async () => {
    const res = await request(app)
      .post("/api/complaints")
      .set("Authorization", `Bearer ${siteToken}`)
      .send({
        complaintId: COMPLAINT_ID,
        complaintDate: "2026-03-10",
        projectName: "Complaint Test Project",
        clientName: "Test Client",
        siteLocation: "Pune",
        complaintDescription: "Rust spots observed on walkway tray surface near bolt holes",
        responsibleStage: "SITE_HANDLING",
        batchNumbers: [BATCH],
      });

    expect(res.status).toBe(201);
    expect(res.body.complaint.complaintId).toBe(COMPLAINT_ID);
    expect(res.body.complaint.linkedCoilNumbers).toContain(PARENT_COIL);
    expect(res.body.complaint.resolutionStatus).toBe("OPEN");
  });

  it("uploads rust photo to complaint", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );

    const res = await request(app)
      .post(`/api/complaints/${COMPLAINT_ID}/photos`)
      .set("Authorization", `Bearer ${siteToken}`)
      .attach("photos", png, "rust-spot.png");

    expect(res.status).toBe(201);
    expect(res.body.photos.length).toBeGreaterThanOrEqual(1);
  });

  it("updates complaint investigation status and closes", async () => {
    const investigate = await request(app)
      .put(`/api/complaints/${COMPLAINT_ID}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        resolutionStatus: "UNDER_INVESTIGATION",
        rootCauseRemarks: "Handling damage during site unloading — shoe marks visible",
        responsibleStage: "SITE_HANDLING",
      });

    expect(investigate.status).toBe(200);
    expect(investigate.body.complaint.resolutionStatus).toBe("UNDER_INVESTIGATION");

    const close = await request(app)
      .put(`/api/complaints/${COMPLAINT_ID}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        resolutionStatus: "CLOSED",
        resolutionDate: "2026-03-15",
        rootCauseRemarks: "Confirmed site handling damage, not supplied material defect",
      });

    expect(close.status).toBe(200);
    expect(close.body.complaint.resolutionStatus).toBe("CLOSED");
    expect(close.body.complaint.resolutionDate).toBeTruthy();
  });

  it("gets complaint detail with traceability", async () => {
    const res = await request(app)
      .get(`/api/complaints/${COMPLAINT_ID}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.complaint.traceability.linkedCoilNumbers).toContain(PARENT_COIL);
    expect(res.body.complaint.photoCount).toBeGreaterThanOrEqual(1);
  });

  it("lists complaints with search", async () => {
    const res = await request(app)
      .get("/api/complaints?search=rust")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.complaints.some((c: { complaintId: string }) => c.complaintId === COMPLAINT_ID)).toBe(
      true
    );
  });

  it("denies unauthenticated access", async () => {
    const res = await request(app).get("/api/complaints/stats");
    expect(res.status).toBe(401);
  });
});
