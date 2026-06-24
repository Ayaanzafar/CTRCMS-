import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

const COIL = "DOC-HUB-COIL-001";
const SLIT = "DOC-HUB-COIL-001-S01";
const BATCH = "BATCH-DOC-HUB";
const COMPLAINT = "COMP-DOC-HUB-001";

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.token as string;
}

async function setup() {
  await prisma.complaintPhoto.deleteMany({
    where: { complaint: { complaintId: COMPLAINT } },
  });
  await prisma.complaintBatchLine.deleteMany({ where: { complaintId: COMPLAINT } });
  await prisma.complaint.deleteMany({ where: { complaintId: COMPLAINT } });
  await prisma.qCInspectionPhoto.deleteMany({
    where: { inspection: { batchNumber: BATCH } },
  });
  await prisma.qCInspection.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.coilDocument.deleteMany({ where: { coilNumber: COIL } });
  await prisma.batchSlitCoilMap.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.productionBatch.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.sunrackReceiptPhoto.deleteMany({
    where: { receipt: { slitCoilId: SLIT } },
  });
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
      mtcNumber: "MTC-DOC-HUB",
    },
  });

  await prisma.coilDocument.create({
    data: {
      coilNumber: COIL,
      documentType: "MTC",
      filename: "test-mtc.pdf",
      originalName: "doc-hub-mtc.pdf",
      mimetype: "application/pdf",
      size: 1024,
      storagePath: "uploads/mtc/test-mtc.pdf",
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

  const receipt = await prisma.sunrackReceipt.create({
    data: {
      slitCoilId: SLIT,
      receiptDateSunrack: new Date("2026-01-15"),
      storageLocationBin: "WH-DOC",
      inspectionResult: "PASS",
    },
  });

  await prisma.sunrackReceiptPhoto.create({
    data: {
      receiptId: receipt.id,
      filename: "inspect.png",
      originalName: "doc-hub-inspect.png",
      mimetype: "image/png",
      size: 512,
      storagePath: "uploads/inspection-photos/inspect.png",
    },
  });

  await prisma.productionBatch.create({
    data: {
      batchNumber: BATCH,
      productionOrderNumber: "PO-DOC-HUB",
      productType: "Walkway Tray",
      quantityProduced: 50,
      productionDate: new Date("2026-01-20"),
      operatorShift: "Shift A",
      slitCoilConsumptions: {
        create: { slitCoilId: SLIT, quantityConsumed: 0.5 },
      },
    },
  });

  const qc = await prisma.qCInspection.create({
    data: {
      batchNumber: BATCH,
      qcResult: "PASS",
      inspectorName: "Doc Hub QC",
      inspectionDate: new Date("2026-01-21"),
    },
  });

  await prisma.qCInspectionPhoto.create({
    data: {
      inspectionId: qc.id,
      filename: "qc.png",
      originalName: "doc-hub-qc.png",
      mimetype: "image/png",
      size: 512,
      storagePath: "uploads/qc-reports/qc.png",
    },
  });

  await prisma.siteDispatch.create({
    data: {
      dispatchNoteNumber: "DN-DOC-HUB-001",
      dispatchDate: new Date("2026-02-01"),
      projectName: "Doc Hub Project",
      clientName: "Doc Client",
      siteLocation: "Pune",
      batchLines: { create: { batchNumber: BATCH, quantityDispatched: 10 } },
      siteInstallation: {
        create: {
          siteReceiptDate: new Date("2026-02-02"),
          installationDate: new Date("2026-02-03"),
          installerEpcPartner: "Doc EPC",
          quantityInstalled: 10,
          photos: {
            create: {
              filename: "site.png",
              originalName: "doc-hub-site.png",
              mimetype: "image/png",
              size: 512,
              storagePath: "uploads/installation-photos/site.png",
            },
          },
        },
      },
    },
  });

  await prisma.complaint.create({
    data: {
      complaintId: COMPLAINT,
      complaintDate: new Date("2026-03-01"),
      projectName: "Doc Hub Project",
      clientName: "Doc Client",
      siteLocation: "Pune",
      complaintDescription: "Doc hub test complaint",
      batchLines: { create: { batchNumber: BATCH } },
      photos: {
        create: {
          filename: "rust.png",
          originalName: "doc-hub-rust.png",
          mimetype: "image/png",
          size: 512,
          storagePath: "uploads/complaint-photos/rust.png",
        },
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
    where: { installation: { dispatchNoteNumber: "DN-DOC-HUB-001" } },
  });
  await prisma.siteInstallation.deleteMany({ where: { dispatchNoteNumber: "DN-DOC-HUB-001" } });
  await prisma.dispatchBatchLine.deleteMany({ where: { dispatchNoteNumber: "DN-DOC-HUB-001" } });
  await prisma.siteDispatch.deleteMany({ where: { dispatchNoteNumber: "DN-DOC-HUB-001" } });
  await prisma.qCInspectionPhoto.deleteMany({
    where: { inspection: { batchNumber: BATCH } },
  });
  await prisma.qCInspection.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.coilDocument.deleteMany({ where: { coilNumber: COIL } });
  await prisma.batchSlitCoilMap.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.productionBatch.deleteMany({ where: { batchNumber: BATCH } });
  await prisma.sunrackReceiptPhoto.deleteMany({
    where: { receipt: { slitCoilId: SLIT } },
  });
  await prisma.sunrackReceipt.deleteMany({ where: { slitCoilId: SLIT } });
  await prisma.slittingRecord.deleteMany({ where: { slitCoilId: SLIT } });
  await prisma.coil.deleteMany({ where: { coilNumber: COIL } });
}

describe("Documents Hub API", () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await login("admin@sunrack.local", "Admin@12345");
    await cleanup();
    await setup();
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("returns document stats by category", async () => {
    const res = await request(app)
      .get("/api/documents/stats")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stats.total).toBeGreaterThanOrEqual(5);
    expect(res.body.stats.byCategory.mtc).toBeGreaterThanOrEqual(1);
    expect(res.body.stats.byCategory["complaint-photos"]).toBeGreaterThanOrEqual(1);
  });

  it("lists all documents", async () => {
    const res = await request(app)
      .get("/api/documents")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(5);
    expect(res.body.documents[0]).toHaveProperty("downloadUrl");
    expect(res.body.documents[0]).toHaveProperty("sourcePath");
  });

  it("searches documents by coil number", async () => {
    const res = await request(app)
      .get(`/api/documents?search=${COIL}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.documents.some((d: { context: { coilNumber?: string } }) => d.context.coilNumber === COIL)).toBe(
      true
    );
  });

  it("filters by category", async () => {
    const res = await request(app)
      .get("/api/documents?category=complaint-photos")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.documents.every((d: { category: string }) => d.category === "complaint-photos")).toBe(
      true
    );
  });

  it("returns documents by traceability reference (Option B)", async () => {
    const res = await request(app)
      .get(`/api/documents/by-reference?q=${COIL}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.query).toBe(COIL);
  });

  it("allows warehouse read access to document hub", async () => {
    const warehouseToken = await login("warehouse@sunrack.local", "Warehouse@123");
    const res = await request(app)
      .get("/api/documents/stats")
      .set("Authorization", `Bearer ${warehouseToken}`);

    expect(res.status).toBe(200);
  });

  it("denies unauthenticated access", async () => {
    const res = await request(app).get("/api/documents/stats");
    expect(res.status).toBe(401);
  });
});
