import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

const BATCH_PASS = "BATCH-DISP-TEST-PASS";
const BATCH_PASS_2 = "BATCH-DISP-TEST-PASS2";
const BATCH_FAIL = "BATCH-DISP-TEST-FAIL";
const TEST_SLIT = "V9888D000M-SC003";

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.token as string;
}

async function setupTestData() {
  const slit = await prisma.slittingRecord.findUnique({ where: { slitCoilId: TEST_SLIT } });
  if (!slit) {
    throw new Error(`Test slit coil ${TEST_SLIT} not found`);
  }

  await prisma.sunrackReceipt.upsert({
    where: { slitCoilId: TEST_SLIT },
    create: {
      slitCoilId: TEST_SLIT,
      receiptDateSunrack: new Date("2026-02-01"),
      storageLocationBin: "WH-B",
      inspectionResult: "PASS",
    },
    update: { inspectionResult: "PASS" },
  });

  for (const [batchNumber, po, qty] of [
    [BATCH_PASS, "PO-DISP-1", 100],
    [BATCH_PASS_2, "PO-DISP-2", 80],
    [BATCH_FAIL, "PO-DISP-FAIL", 60],
  ] as const) {
    await prisma.productionBatch.upsert({
      where: { batchNumber },
      create: {
        batchNumber,
        productionOrderNumber: po,
        productType: "Walkway Tray",
        quantityProduced: qty,
        productionDate: new Date("2026-02-20"),
        operatorShift: "Shift A",
        slitCoilConsumptions: {
          create: { slitCoilId: TEST_SLIT, quantityConsumed: 0.01 },
        },
      },
      update: {},
    });

    await prisma.qCInspection.deleteMany({ where: { batchNumber } });
    await prisma.qCInspection.create({
      data: {
        batchNumber,
        qcResult: batchNumber === BATCH_FAIL ? "FAIL" : "PASS",
        inspectorName: "QC Inspector",
        inspectionDate: new Date("2026-02-21"),
      },
    });
  }
}

async function cleanup() {
  await prisma.dispatchBatchLine.deleteMany({
    where: {
      batchNumber: { in: [BATCH_PASS, BATCH_PASS_2, BATCH_FAIL] },
    },
  });
  await prisma.siteDispatch.deleteMany({
    where: {
      OR: [
        { dispatchNoteNumber: { startsWith: "DN-DISP-TEST" } },
        { batchLines: { some: { batchNumber: { in: [BATCH_PASS, BATCH_PASS_2, BATCH_FAIL] } } } },
      ],
    },
  });
  await prisma.qCInspection.deleteMany({
    where: { batchNumber: { in: [BATCH_PASS, BATCH_PASS_2, BATCH_FAIL] } },
  });
  await prisma.batchSlitCoilMap.deleteMany({
    where: { batchNumber: { in: [BATCH_PASS, BATCH_PASS_2, BATCH_FAIL] } },
  });
  await prisma.productionBatch.deleteMany({
    where: { batchNumber: { in: [BATCH_PASS, BATCH_PASS_2, BATCH_FAIL] } },
  });
}

describe("Phase 6 — Dispatch API", () => {
  let dispatchToken: string;
  let notePartial: string;
  let noteMulti: string;

  beforeAll(async () => {
    dispatchToken = await login("dispatch@sunrack.local", "Dispatch@123");
    await cleanup();
    await setupTestData();
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("returns dispatch stats", async () => {
    const res = await request(app)
      .get("/api/dispatch/stats")
      .set("Authorization", `Bearer ${dispatchToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stats).toHaveProperty("totalDispatches");
    expect(res.body.stats).toHaveProperty("totalUnitsDispatched");
  });

  it("previews next dispatch note number", async () => {
    const res = await request(app)
      .get("/api/dispatch/preview-dispatch-note")
      .set("Authorization", `Bearer ${dispatchToken}`);

    expect(res.status).toBe(200);
    expect(res.body.dispatchNoteNumber).toMatch(/^DN-SR-\d{4}-\d{4}$/);
  });

  it("rejects dispatch for QC-failed batch", async () => {
    const res = await request(app)
      .post("/api/dispatch")
      .set("Authorization", `Bearer ${dispatchToken}`)
      .send({
        dispatchNoteNumber: "DN-DISP-TEST-FAIL",
        dispatchDate: "2026-03-01",
        projectName: "Test Project",
        clientName: "Test Client",
        siteLocation: "Pune",
        batchLines: [{ batchNumber: BATCH_FAIL, quantityDispatched: 10 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/QC Pass/i);
  });

  it("creates partial dispatch for one batch", async () => {
    const res = await request(app)
      .post("/api/dispatch")
      .set("Authorization", `Bearer ${dispatchToken}`)
      .send({
        dispatchNoteNumber: "DN-DISP-TEST-001",
        dispatchDate: "2026-03-01",
        vehicleNumber: "MH12XY9999",
        transporterName: "Sunrack Logistics",
        projectName: "Solar Park Alpha",
        clientName: "Suntrop Solar",
        siteLocation: "Nashik, Maharashtra",
        batchLines: [{ batchNumber: BATCH_PASS, quantityDispatched: 40 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.dispatch.batchLines).toHaveLength(1);
    expect(res.body.dispatch.totalQuantityDispatched).toBe(40);
    notePartial = res.body.dispatch.dispatchNoteNumber;
  });

  it("rejects over-quantity dispatch", async () => {
    const res = await request(app)
      .post("/api/dispatch")
      .set("Authorization", `Bearer ${dispatchToken}`)
      .send({
        dispatchNoteNumber: "DN-DISP-TEST-OVER",
        dispatchDate: "2026-03-02",
        projectName: "Solar Park Alpha",
        clientName: "Suntrop Solar",
        siteLocation: "Nashik",
        batchLines: [{ batchNumber: BATCH_PASS, quantityDispatched: 70 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only has/i);
  });

  it("creates multi-batch dispatch note (acceptance criteria)", async () => {
    const res = await request(app)
      .post("/api/dispatch")
      .set("Authorization", `Bearer ${dispatchToken}`)
      .send({
        dispatchNoteNumber: "DN-DISP-TEST-002",
        dispatchDate: "2026-03-03",
        projectName: "Solar Park Beta",
        clientName: "EPC Partner",
        siteLocation: "Aurangabad",
        batchLines: [
          { batchNumber: BATCH_PASS, quantityDispatched: 50 },
          { batchNumber: BATCH_PASS_2, quantityDispatched: 30 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.dispatch.batchLines).toHaveLength(2);
    expect(res.body.dispatch.totalQuantityDispatched).toBe(80);
    noteMulti = res.body.dispatch.dispatchNoteNumber;
  });

  it("lists dispatches with search", async () => {
    const res = await request(app)
      .get("/api/dispatch?search=Solar Park")
      .set("Authorization", `Bearer ${dispatchToken}`);

    expect(res.status).toBe(200);
    expect(res.body.dispatches.length).toBeGreaterThanOrEqual(2);
  });

  it("gets dispatch detail by note number", async () => {
    const res = await request(app)
      .get(`/api/dispatch/${notePartial}`)
      .set("Authorization", `Bearer ${dispatchToken}`);

    expect(res.status).toBe(200);
    expect(res.body.dispatch.projectName).toBe("Solar Park Alpha");
    expect(res.body.dispatch.batchLines[0].batchNumber).toBe(BATCH_PASS);
  });

  it("finished goods reflects dispatched quantities", async () => {
    const res = await request(app)
      .get(`/api/finished-goods/${BATCH_PASS}`)
      .set("Authorization", `Bearer ${dispatchToken}`);

    expect(res.status).toBe(200);
    expect(res.body.item.quantityProduced).toBe(100);
    expect(res.body.item.quantityDispatched).toBe(90);
    expect(res.body.item.quantityAvailable).toBe(10);
  });

  it("updates dispatch header", async () => {
    const res = await request(app)
      .put(`/api/dispatch/${notePartial}`)
      .set("Authorization", `Bearer ${dispatchToken}`)
      .send({
        vehicleNumber: "MH04UPDATED",
        transporterName: "Updated Transporter",
      });

    expect(res.status).toBe(200);
    expect(res.body.dispatch.vehicleNumber).toBe("MH04UPDATED");
  });

  it("denies unauthenticated access", async () => {
    const res = await request(app).get("/api/dispatch/stats");
    expect(res.status).toBe(401);
  });
});
