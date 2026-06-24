import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

const BATCH_PASS = "BATCH-FG-TEST-PASS";
const BATCH_FAIL = "BATCH-FG-TEST-FAIL";
const TEST_SLIT = "V9888D000M-SC002";

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.token as string;
}

async function setupTestData() {
  const slit = await prisma.slittingRecord.findUnique({ where: { slitCoilId: TEST_SLIT } });
  if (!slit) {
    throw new Error(`Test slit coil ${TEST_SLIT} not found — run production/slitting tests seed data first`);
  }

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

  for (const [batchNumber, po] of [
    [BATCH_PASS, "PO-FG-PASS"],
    [BATCH_FAIL, "PO-FG-FAIL"],
  ] as const) {
    await prisma.productionBatch.upsert({
      where: { batchNumber },
      create: {
        batchNumber,
        productionOrderNumber: po,
        productType: "Walkway Tray",
        quantityProduced: 100,
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
        qcResult: batchNumber === BATCH_PASS ? "PASS" : "FAIL",
        inspectorName: "QC Inspector",
        inspectionDate: new Date("2026-02-21"),
      },
    });
  }
}

async function cleanup() {
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

describe("Finished Goods Inventory API", () => {
  let dispatchToken: string;

  beforeAll(async () => {
    dispatchToken = await login("dispatch@sunrack.local", "Dispatch@123");
    await cleanup();
    await setupTestData();
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("returns stats for QC-passed inventory only", async () => {
    const res = await request(app)
      .get("/api/finished-goods/stats")
      .set("Authorization", `Bearer ${dispatchToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stats.qcPassedBatches).toBeGreaterThanOrEqual(1);
    expect(res.body.stats.totalUnitsAvailable).toBeGreaterThanOrEqual(100);
  });

  it("lists only QC-passed batches in inventory", async () => {
    const res = await request(app)
      .get("/api/finished-goods")
      .set("Authorization", `Bearer ${dispatchToken}`);

    expect(res.status).toBe(200);
    const numbers = res.body.inventory.map((i: { batchNumber: string }) => i.batchNumber);
    expect(numbers).toContain(BATCH_PASS);
    expect(numbers).not.toContain(BATCH_FAIL);
  });

  it("inventory item shows available quantity equal to produced (no dispatch yet)", async () => {
    const res = await request(app)
      .get(`/api/finished-goods/${BATCH_PASS}`)
      .set("Authorization", `Bearer ${dispatchToken}`);

    expect(res.status).toBe(200);
    expect(res.body.item.quantityProduced).toBe(100);
    expect(res.body.item.quantityDispatched).toBe(0);
    expect(res.body.item.quantityAvailable).toBe(100);
    expect(res.body.item.qcInspection.qcResult).toBe("PASS");
  });

  it("returns 404 for QC-failed batch", async () => {
    const res = await request(app)
      .get(`/api/finished-goods/${BATCH_FAIL}`)
      .set("Authorization", `Bearer ${dispatchToken}`);

    expect(res.status).toBe(404);
  });

  it("filters by product type", async () => {
    const res = await request(app)
      .get("/api/finished-goods?productType=Walkway")
      .set("Authorization", `Bearer ${dispatchToken}`);

    expect(res.status).toBe(200);
    expect(res.body.inventory.every((i: { productType: string }) => i.productType.includes("Walkway"))).toBe(
      true
    );
  });

  it("matches dispatch-eligible batches from QC module", async () => {
    const fg = await request(app)
      .get("/api/finished-goods")
      .set("Authorization", `Bearer ${dispatchToken}`);

    const eligible = await request(app)
      .get("/api/qc/dispatch-eligible-batches")
      .set("Authorization", `Bearer ${dispatchToken}`);

    const fgNumbers = fg.body.inventory.map((i: { batchNumber: string }) => i.batchNumber);
    const eligibleNumbers = eligible.body.batches.map((b: { batchNumber: string }) => b.batchNumber);

    for (const n of fgNumbers) {
      expect(eligibleNumbers).toContain(n);
    }
  });

  it("denies unauthenticated access", async () => {
    const res = await request(app).get("/api/finished-goods/stats");
    expect(res.status).toBe(401);
  });
});
