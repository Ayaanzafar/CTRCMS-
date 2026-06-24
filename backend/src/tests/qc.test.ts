import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

const BATCH_PASS = "BATCH-QC-TEST-PASS";
const BATCH_FAIL = "BATCH-QC-TEST-FAIL";
const TEST_SLIT = "V9888D000M-SC002";

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.token as string;
}

async function ensurePrerequisites(warehouseToken: string, productionToken: string) {
  const receipt = await prisma.sunrackReceipt.findUnique({ where: { slitCoilId: TEST_SLIT } });
  if (!receipt) {
    await request(app)
      .post("/api/sunrack-receipts")
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({
        slitCoilId: TEST_SLIT,
        receiptDateSunrack: "2026-02-01",
        storageLocationBin: "WH-A",
        inspectionResult: "PASS",
      });
  }

  for (const batchNumber of [BATCH_PASS, BATCH_FAIL]) {
    const exists = await prisma.productionBatch.findUnique({ where: { batchNumber } });
    if (!exists) {
      await request(app)
        .post("/api/production")
        .set("Authorization", `Bearer ${productionToken}`)
        .send({
          batchNumber,
          productionOrderNumber: `PO-${batchNumber}`,
          productType: "Walkway Tray",
          quantityProduced: 50,
          productionDate: "2026-02-15",
          operatorShift: "Shift A",
          slitCoilConsumptions: [{ slitCoilId: TEST_SLIT, quantityConsumed: 0.5 }],
        });
    }
  }
}

async function cleanupQcTests() {
  await prisma.qCInspectionPhoto.deleteMany({
    where: { inspection: { batchNumber: { in: [BATCH_PASS, BATCH_FAIL] } } },
  });
  await prisma.qCInspection.deleteMany({
    where: { batchNumber: { in: [BATCH_PASS, BATCH_FAIL] } },
  });
  await prisma.batchSlitCoilMap.deleteMany({
    where: { batchNumber: { in: [BATCH_PASS, BATCH_FAIL] } },
  });
  await prisma.productionBatch.deleteMany({
    where: { batchNumber: { in: [BATCH_PASS, BATCH_FAIL] } },
  });
}

describe("Phase 5 — QC Inspection API", () => {
  let qcToken: string;
  let dispatchToken: string;
  let warehouseToken: string;
  let productionToken: string;
  let passInspectionId: string;
  let failInspectionId: string;

  beforeAll(async () => {
    qcToken = await login("qc@sunrack.local", "QC@12345");
    dispatchToken = await login("dispatch@sunrack.local", "Dispatch@123");
    warehouseToken = await login("warehouse@sunrack.local", "Warehouse@123");
    productionToken = await login("production@sunrack.local", "Production@123");

    await cleanupQcTests();
    await ensurePrerequisites(warehouseToken, productionToken);
  });

  afterAll(async () => {
    await cleanupQcTests();
    await prisma.$disconnect();
  });

  it("returns QC stats", async () => {
    const res = await request(app)
      .get("/api/qc/stats")
      .set("Authorization", `Bearer ${qcToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stats.batchesPendingQc).toBeGreaterThanOrEqual(0);
  });

  it("lists pending batches including test batches", async () => {
    const res = await request(app)
      .get("/api/qc/pending-batches")
      .set("Authorization", `Bearer ${qcToken}`);

    expect(res.status).toBe(200);
    const numbers = res.body.pending.map((b: { batchNumber: string }) => b.batchNumber);
    expect(numbers).toContain(BATCH_PASS);
    expect(numbers).toContain(BATCH_FAIL);
  });

  it("creates PASS inspection for one batch", async () => {
    const res = await request(app)
      .post("/api/qc")
      .set("Authorization", `Bearer ${qcToken}`)
      .send({
        batchNumber: BATCH_PASS,
        qcResult: "PASS",
        inspectorName: "QC Inspector",
        inspectionDate: "2026-02-16",
        qcRemarks: "All dimensions within tolerance",
      });

    expect(res.status).toBe(201);
    expect(res.body.inspection.qcResult).toBe("PASS");
    passInspectionId = res.body.inspection.id;
  });

  it("creates FAIL inspection for another batch", async () => {
    const res = await request(app)
      .post("/api/qc")
      .set("Authorization", `Bearer ${qcToken}`)
      .send({
        batchNumber: BATCH_FAIL,
        qcResult: "FAIL",
        inspectorName: "QC Inspector",
        inspectionDate: "2026-02-16",
        qcRemarks: "Coating defect found",
      });

    expect(res.status).toBe(201);
    expect(res.body.inspection.qcResult).toBe("FAIL");
    failInspectionId = res.body.inspection.id;
  });

  it("uploads QC photo to inspection", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );

    const res = await request(app)
      .post(`/api/qc/${passInspectionId}/photos`)
      .set("Authorization", `Bearer ${qcToken}`)
      .attach("photos", png, "qc-test.png");

    expect(res.status).toBe(201);
    expect(res.body.photos.length).toBeGreaterThanOrEqual(1);
  });

  it("dispatch-eligible list includes PASS batch only (acceptance criteria)", async () => {
    const res = await request(app)
      .get("/api/qc/dispatch-eligible-batches")
      .set("Authorization", `Bearer ${dispatchToken}`);

    expect(res.status).toBe(200);
    const numbers = res.body.batches.map((b: { batchNumber: string }) => b.batchNumber);
    expect(numbers).toContain(BATCH_PASS);
    expect(numbers).not.toContain(BATCH_FAIL);
  });

  it("batch QC status shows dispatchEligible for pass only", async () => {
    const passRes = await request(app)
      .get(`/api/qc/batch/${BATCH_PASS}`)
      .set("Authorization", `Bearer ${qcToken}`);

    const failRes = await request(app)
      .get(`/api/qc/batch/${BATCH_FAIL}`)
      .set("Authorization", `Bearer ${qcToken}`);

    expect(passRes.body.dispatchEligible).toBe(true);
    expect(passRes.body.latestResult).toBe("PASS");
    expect(failRes.body.dispatchEligible).toBe(false);
    expect(failRes.body.latestResult).toBe("FAIL");
  });

  it("denies unauthenticated access", async () => {
    const res = await request(app).get("/api/qc/stats");
    expect(res.status).toBe(401);
  });
});
