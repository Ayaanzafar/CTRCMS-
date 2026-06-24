import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

const COIL = "TRAC-COIL-001";
const SLIT = "TRAC-COIL-001-S01";
const BATCH = "BATCH-TRAC-TEST";
const DISPATCH = "DN-TRAC-TEST-001";
const COMPLAINT = "COMP-TRAC-TEST-001";
const PROJECT = "Traceability Test Project";

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.token as string;
}

async function setupTestData() {
  await prisma.complaintPhoto.deleteMany({
    where: { complaint: { complaintId: COMPLAINT } },
  });
  await prisma.complaintBatchLine.deleteMany({ where: { complaintId: COMPLAINT } });
  await prisma.complaint.deleteMany({ where: { complaintId: COMPLAINT } });
  await prisma.siteInstallationPhoto.deleteMany({
    where: { installation: { dispatchNoteNumber: DISPATCH } },
  });
  await prisma.siteInstallation.deleteMany({ where: { dispatchNoteNumber: DISPATCH } });
  await prisma.dispatchBatchLine.deleteMany({ where: { dispatchNoteNumber: DISPATCH } });
  await prisma.siteDispatch.deleteMany({ where: { dispatchNoteNumber: DISPATCH } });
  await prisma.qCInspection.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.batchSlitCoilMap.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.productionBatch.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.sunrackReceipt.deleteMany({ where: { slitCoilId: SLIT } });
  await prisma.slittingRecord.deleteMany({ where: { slitCoilId: SLIT } });
  await prisma.coilDocument.deleteMany({ where: { coilNumber: COIL } });
  await prisma.coil.deleteMany({ where: { coilNumber: COIL } });

  await prisma.coil.create({
    data: {
      coilNumber: COIL,
      grade: "AMNS550S",
      coating: "ZM150",
      size: "1250 x 0.5 mm",
      weight: 8.5,
      mtcNumber: "MTC-TRAC-001",
      invoiceNumber: "INV-TRAC-001",
      amnsDispatchDate: new Date("2026-01-05"),
      vehicleNumber: "GJ01TRAC01",
      transporterName: "AMNS Logistics",
    },
  });

  await prisma.slittingRecord.create({
    data: {
      slitCoilId: SLIT,
      parentCoilNumber: COIL,
      slitWidthSize: "1040 x 0.5 mm",
      slittingDate: new Date("2026-01-10"),
      slitCoilWeight: 4.0,
      dispatchNote: "DN-SS-TRAC-001",
    },
  });

  await prisma.sunrackReceipt.create({
    data: {
      slitCoilId: SLIT,
      receiptDateSunrack: new Date("2026-01-15"),
      storageLocationBin: "WH-TRAC / Rack-01",
      inspectionResult: "PASS",
      inspectionRemarks: "Trace test receipt",
    },
  });

  await prisma.productionBatch.create({
    data: {
      batchNumber: BATCH,
      productionOrderNumber: "PO-TRAC-001",
      productType: "Walkway Tray",
      quantityProduced: 100,
      productionDate: new Date("2026-01-20"),
      operatorShift: "Shift A",
      slitCoilConsumptions: {
        create: { slitCoilId: SLIT, quantityConsumed: 1.0 },
      },
    },
  });

  await prisma.qCInspection.create({
    data: {
      batchNumber: BATCH,
      qcResult: "PASS",
      inspectorName: "QC Trace Inspector",
      inspectionDate: new Date("2026-01-21"),
      qcRemarks: "Pass for traceability test",
    },
  });

  await prisma.siteDispatch.create({
    data: {
      dispatchNoteNumber: DISPATCH,
      dispatchDate: new Date("2026-01-25"),
      projectName: PROJECT,
      clientName: "Trace Client",
      siteLocation: "Pune",
      batchLines: {
        create: { batchNumber: BATCH, quantityDispatched: 50 },
      },
      siteInstallation: {
        create: {
          siteReceiptDate: new Date("2026-01-27"),
          installationDate: new Date("2026-01-28"),
          installerEpcPartner: "Trace EPC",
          quantityInstalled: 50,
        },
      },
    },
  });

  await prisma.complaint.create({
    data: {
      complaintId: COMPLAINT,
      complaintDate: new Date("2026-02-01"),
      projectName: PROJECT,
      clientName: "Trace Client",
      siteLocation: "Pune",
      complaintDescription: "Trace test rust complaint",
      resolutionStatus: "OPEN",
      batchLines: {
        create: { batchNumber: BATCH },
      },
    },
  });
}

async function cleanup() {
  await prisma.complaintPhoto.deleteMany({
    where: { complaint: { complaintId: COMPLAINT } },
  });
  await prisma.complaintBatchLine.deleteMany({ where: { complaintId: COMPLAINT } });
  await prisma.complaint.deleteMany({ where: { complaintId: COMPLAINT } });
  await prisma.siteInstallationPhoto.deleteMany({
    where: { installation: { dispatchNoteNumber: DISPATCH } },
  });
  await prisma.siteInstallation.deleteMany({ where: { dispatchNoteNumber: DISPATCH } });
  await prisma.dispatchBatchLine.deleteMany({ where: { dispatchNoteNumber: DISPATCH } });
  await prisma.siteDispatch.deleteMany({ where: { dispatchNoteNumber: DISPATCH } });
  await prisma.qCInspection.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.batchSlitCoilMap.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.productionBatch.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.sunrackReceipt.deleteMany({ where: { slitCoilId: SLIT } });
  await prisma.slittingRecord.deleteMany({ where: { slitCoilId: SLIT } });
  await prisma.coilDocument.deleteMany({ where: { coilNumber: COIL } });
  await prisma.coil.deleteMany({ where: { coilNumber: COIL } });
}

describe("Phase 9 — Traceability Report API", () => {
  let adminToken: string;
  let managementToken: string;

  beforeAll(async () => {
    adminToken = await login("admin@sunrack.local", "Admin@12345");
    managementToken = await login("management@sunrack.local", "Management@123");
    await cleanup();
    await setupTestData();
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("returns search suggestions for coil number", async () => {
    const res = await request(app)
      .get("/api/traceability/search?q=TRAC-COIL")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.hits.some((h: { referenceId: string }) => h.referenceId === COIL)).toBe(true);
  });

  it("builds full timeline from coil number (acceptance criteria)", async () => {
    const res = await request(app)
      .get(`/api/traceability/timeline?q=${COIL}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.timeline.rootCoilNumbers).toContain(COIL);

    const stages = res.body.timeline.events.map((e: { stage: string }) => e.stage);
    expect(stages).toContain("COIL_MASTER");
    expect(stages).toContain("SLITTING");
    expect(stages).toContain("SUNRACK_RECEIPT");
    expect(stages).toContain("PRODUCTION");
    expect(stages).toContain("QC");
    expect(stages).toContain("DISPATCH");
    expect(stages).toContain("SITE_INSTALLATION");
    expect(stages).toContain("COMPLAINT");
  });

  it("resolves timeline from complaint ID back to coil", async () => {
    const res = await request(app)
      .get(`/api/traceability/timeline?q=${COMPLAINT}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.timeline.referenceType).toBe("COMPLAINT_ID");
    expect(res.body.timeline.rootCoilNumbers).toContain(COIL);
  });

  it("resolves timeline from batch, dispatch, slit, and project", async () => {
    for (const q of [BATCH, DISPATCH, SLIT, PROJECT]) {
      const res = await request(app)
        .get(`/api/traceability/timeline?q=${encodeURIComponent(q)}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.timeline.rootCoilNumbers).toContain(COIL);
    }
  });

  it("exports PDF report", async () => {
    const res = await request(app)
      .get(`/api/traceability/export/pdf?q=${COIL}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.body.length).toBeGreaterThan(500);
    expect(res.body.slice(0, 4).toString()).toBe("%PDF");
  });

  it("returns 404 for unknown reference", async () => {
    const res = await request(app)
      .get("/api/traceability/timeline?q=UNKNOWN-XYZ-999")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it("allows management read-only access", async () => {
    const res = await request(app)
      .get(`/api/traceability/timeline?q=${COIL}`)
      .set("Authorization", `Bearer ${managementToken}`);

    expect(res.status).toBe(200);
  });

  it("denies unauthenticated access", async () => {
    const res = await request(app).get(`/api/traceability/timeline?q=${COIL}`);
    expect(res.status).toBe(401);
  });
});
