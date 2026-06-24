import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

const TEST_SLIT = "V9888D000M-SC002";
const MIN_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function login(email: string, password: string) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password });
  return res.body.token as string;
}

describe("Phase 3 — Sunrack Receipt API", () => {
  let warehouseToken: string;
  let receiptId: string;

  beforeAll(async () => {
    warehouseToken = await login("warehouse@sunrack.local", "Warehouse@123");

    const existing = await prisma.sunrackReceipt.findUnique({
      where: { slitCoilId: TEST_SLIT },
    });
    if (existing) {
      await prisma.sunrackReceiptPhoto.deleteMany({ where: { receiptId: existing.id } });
      await prisma.sunrackReceipt.delete({ where: { id: existing.id } });
    }
  });

  afterAll(async () => {
    if (receiptId) {
      await prisma.sunrackReceiptPhoto.deleteMany({ where: { receiptId } });
      await prisma.sunrackReceipt.delete({ where: { id: receiptId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it("returns stats with pending slit coils", async () => {
    const res = await request(app)
      .get("/api/sunrack-receipts/stats")
      .set("Authorization", `Bearer ${warehouseToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({
      totalReceipts: expect.any(Number),
      pendingSlitCoils: expect.any(Number),
      passedInspections: expect.any(Number),
      failedInspections: expect.any(Number),
    });
    expect(res.body.stats.pendingSlitCoils).toBeGreaterThan(0);
  });

  it("lists pending slit coils awaiting receipt", async () => {
    const res = await request(app)
      .get("/api/sunrack-receipts/pending")
      .set("Authorization", `Bearer ${warehouseToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.pending)).toBe(true);
    expect(res.body.pending.some((p: { slitCoilId: string }) => p.slitCoilId === TEST_SLIT)).toBe(
      true
    );
  });

  it("creates a Sunrack receipt for a slit coil", async () => {
    const res = await request(app)
      .post("/api/sunrack-receipts")
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({
        slitCoilId: TEST_SLIT,
        receiptDateSunrack: "2026-02-01",
        storageLocationBin: "WH-A / Rack-12 / Bin-04",
        inspectionResult: "PASS",
        inspectionRemarks: "Coating intact, no edge damage",
        confirmedDispatchNote: "DN-SS-2026-001",
      });

    expect(res.status).toBe(201);
    expect(res.body.receipt.slitCoilId).toBe(TEST_SLIT);
    expect(res.body.receipt.storageLocationBin).toBe("WH-A / Rack-12 / Bin-04");
    expect(res.body.receipt.inspectionResult).toBe("PASS");
    receiptId = res.body.receipt.id;
  });

  it("rejects duplicate receipt for same slit coil", async () => {
    const res = await request(app)
      .post("/api/sunrack-receipts")
      .set("Authorization", `Bearer ${warehouseToken}`)
      .send({
        slitCoilId: TEST_SLIT,
        receiptDateSunrack: "2026-02-01",
        storageLocationBin: "WH-B",
      });

    expect(res.status).toBe(409);
  });

  it("uploads inspection photos to receipt", async () => {
    const res = await request(app)
      .post(`/api/sunrack-receipts/${receiptId}/photos`)
      .set("Authorization", `Bearer ${warehouseToken}`)
      .attach("photos", MIN_PNG, "inspection-test.png");

    expect(res.status).toBe(201);
    expect(res.body.photos.length).toBeGreaterThanOrEqual(1);
  });

  it("serves inspection photo file", async () => {
    const receipt = await request(app)
      .get(`/api/sunrack-receipts/${receiptId}`)
      .set("Authorization", `Bearer ${warehouseToken}`);

    const photoId = receipt.body.receipt.photos[0].id;

    const res = await request(app)
      .get(`/api/sunrack-receipts/photos/${photoId}/file`)
      .set("Authorization", `Bearer ${warehouseToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image/);
  });

  it("includes Sunrack receipt on slit coil detail (acceptance criteria)", async () => {
    const res = await request(app)
      .get(`/api/slitting/${TEST_SLIT}`)
      .set("Authorization", `Bearer ${warehouseToken}`);

    expect(res.status).toBe(200);
    expect(res.body.record.sunrackReceipt).toBeDefined();
    expect(res.body.record.sunrackReceipt.receiptDateSunrack).toBeTruthy();
    expect(res.body.record.sunrackReceipt.inspectionResult).toBe("PASS");
    expect(res.body.record.sunrackReceipt.photos.length).toBeGreaterThanOrEqual(1);
  });

  it("denies access without authentication", async () => {
    const res = await request(app).get("/api/sunrack-receipts/stats");
    expect(res.status).toBe(401);
  });
});
