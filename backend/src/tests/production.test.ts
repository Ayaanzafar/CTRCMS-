import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

const TEST_SLIT = "V9888D000M-SC001";
const BATCH_A = "BATCH-TEST-PH4-A";
const BATCH_B = "BATCH-TEST-PH4-B";

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.token as string;
}

async function ensureSunrackReceipt(token: string) {
  const existing = await prisma.sunrackReceipt.findUnique({
    where: { slitCoilId: TEST_SLIT },
  });
  if (existing) return;

  await request(app)
    .post("/api/sunrack-receipts")
    .set("Authorization", `Bearer ${token}`)
    .send({
      slitCoilId: TEST_SLIT,
      receiptDateSunrack: "2026-02-01",
      storageLocationBin: "WH-A / Rack-01",
      inspectionResult: "PASS",
      confirmedDispatchNote: "DN-SS-2026-001",
    });
}

async function cleanupTestBatches() {
  const orphanOnSlit = ["BATCH-FG-TEST-PASS", "BATCH-FG-TEST-FAIL"];
  await prisma.batchSlitCoilMap.deleteMany({
    where: { batchNumber: { in: [...orphanOnSlit, BATCH_A, BATCH_B] } },
  });
  await prisma.productionBatch.deleteMany({
    where: { batchNumber: { in: [...orphanOnSlit, BATCH_A, BATCH_B] } },
  });
}

describe("Phase 4 — Production Tracking API", () => {
  let productionToken: string;
  let warehouseToken: string;

  beforeAll(async () => {
    productionToken = await login("production@sunrack.local", "Production@123");
    warehouseToken = await login("warehouse@sunrack.local", "Warehouse@123");
    await cleanupTestBatches();
    await ensureSunrackReceipt(warehouseToken);
  });

  afterAll(async () => {
    await cleanupTestBatches();
    await prisma.$disconnect();
  });

  it("lists available slit coils with remaining quantity", async () => {
    const res = await request(app)
      .get("/api/production/available-slit-coils")
      .set("Authorization", `Bearer ${productionToken}`);

    expect(res.status).toBe(200);
    const slit = res.body.available.find(
      (a: { slitCoilId: string }) => a.slitCoilId === TEST_SLIT
    );
    expect(slit).toBeDefined();
    expect(slit.remainingQuantity).toBeGreaterThan(0);
  });

  it("creates first batch consuming partial slit coil weight", async () => {
    const res = await request(app)
      .post("/api/production")
      .set("Authorization", `Bearer ${productionToken}`)
      .send({
        batchNumber: BATCH_A,
        productionOrderNumber: "PO-TEST-001",
        productType: "Walkway Tray",
        quantityProduced: 120,
        productionDate: "2026-02-10",
        operatorShift: "Shift A",
        slitCoilConsumptions: [{ slitCoilId: TEST_SLIT, quantityConsumed: 2.5 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.batch.batchNumber).toBe(BATCH_A);
    expect(res.body.batch.slitCoilConsumptions).toHaveLength(1);
    expect(res.body.batch.slitCoilConsumptions[0].quantityConsumed).toBe("2.5");
  });

  it("creates second batch consuming remaining slit coil (split across batches)", async () => {
    const usage = await request(app)
      .get(`/api/production/slit-coil/${TEST_SLIT}/usage`)
      .set("Authorization", `Bearer ${productionToken}`);

    const remaining = usage.body.remainingQuantity;
    expect(remaining).toBeGreaterThan(0);

    const res = await request(app)
      .post("/api/production")
      .set("Authorization", `Bearer ${productionToken}`)
      .send({
        batchNumber: BATCH_B,
        productionOrderNumber: "PO-TEST-002",
        productType: "Support Frame",
        quantityProduced: 80,
        productionDate: "2026-02-11",
        operatorShift: "Shift B",
        slitCoilConsumptions: [{ slitCoilId: TEST_SLIT, quantityConsumed: remaining }],
      });

    expect(res.status).toBe(201);
    expect(res.body.batch.slitCoilConsumptions[0].slitCoilId).toBe(TEST_SLIT);
  });

  it("rejects over-consumption beyond slit coil weight", async () => {
    const res = await request(app)
      .post("/api/production")
      .set("Authorization", `Bearer ${productionToken}`)
      .send({
        productionOrderNumber: "PO-TEST-FAIL",
        productType: "Walkway Tray",
        quantityProduced: 10,
        productionDate: "2026-02-12",
        operatorShift: "Shift A",
        slitCoilConsumptions: [{ slitCoilId: TEST_SLIT, quantityConsumed: 0.001 }],
      });

    expect(res.status).toBe(400);
  });

  it("batch detail lists slit coil and quantity consumed (acceptance criteria)", async () => {
    const resA = await request(app)
      .get(`/api/production/${BATCH_A}`)
      .set("Authorization", `Bearer ${productionToken}`);

    const resB = await request(app)
      .get(`/api/production/${BATCH_B}`)
      .set("Authorization", `Bearer ${productionToken}`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    expect(resA.body.batch.slitCoilConsumptions[0].slitCoilId).toBe(TEST_SLIT);
    expect(resB.body.batch.slitCoilConsumptions[0].slitCoilId).toBe(TEST_SLIT);

    const consumedA = Number(resA.body.batch.slitCoilConsumptions[0].quantityConsumed);
    const consumedB = Number(resB.body.batch.slitCoilConsumptions[0].quantityConsumed);
    expect(consumedA).toBe(2.5);
    expect(consumedB).toBeGreaterThan(0);
    expect(consumedA + consumedB).toBeLessThanOrEqual(4.8);
  });

  it("slit coil detail shows test batches that consumed it", async () => {
    const res = await request(app)
      .get(`/api/slitting/${TEST_SLIT}`)
      .set("Authorization", `Bearer ${productionToken}`);

    expect(res.status).toBe(200);
    const batchNumbers = res.body.record.batchConsumptions.map(
      (c: { batch: { batchNumber: string } }) => c.batch.batchNumber
    );
    expect(batchNumbers).toContain(BATCH_A);
    expect(batchNumbers).toContain(BATCH_B);
  });

  it("denies unauthenticated access", async () => {
    const res = await request(app).get("/api/production");
    expect(res.status).toBe(401);
  });
});
