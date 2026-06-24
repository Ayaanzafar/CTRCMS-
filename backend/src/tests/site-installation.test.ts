import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

const DISPATCH_NOTE = "DN-SITE-TEST-001";
const BATCH_PASS = "BATCH-SITE-TEST-PASS";
const TEST_SLIT = "V9888D000M-SC003";

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
      storageLocationBin: "WH-B",
      inspectionResult: "PASS",
    },
    update: { inspectionResult: "PASS" },
  });

  await prisma.productionBatch.upsert({
    where: { batchNumber: BATCH_PASS },
    create: {
      batchNumber: BATCH_PASS,
      productionOrderNumber: "PO-SITE-TEST",
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

  await prisma.qCInspection.deleteMany({ where: { batchNumber: BATCH_PASS } });
  await prisma.qCInspection.create({
    data: {
      batchNumber: BATCH_PASS,
      qcResult: "PASS",
      inspectorName: "QC Inspector",
      inspectionDate: new Date("2026-02-21"),
    },
  });

  await prisma.siteInstallationPhoto.deleteMany({
    where: { installation: { dispatchNoteNumber: DISPATCH_NOTE } },
  });
  await prisma.siteInstallation.deleteMany({ where: { dispatchNoteNumber: DISPATCH_NOTE } });
  await prisma.dispatchBatchLine.deleteMany({ where: { dispatchNoteNumber: DISPATCH_NOTE } });
  await prisma.siteDispatch.deleteMany({ where: { dispatchNoteNumber: DISPATCH_NOTE } });

  await prisma.siteDispatch.create({
    data: {
      dispatchNoteNumber: DISPATCH_NOTE,
      dispatchDate: new Date("2026-03-01"),
      projectName: "Site Test Project",
      clientName: "Test EPC",
      siteLocation: "Pune",
      batchLines: {
        create: { batchNumber: BATCH_PASS, quantityDispatched: 75 },
      },
    },
  });
}

async function cleanup() {
  await prisma.siteInstallationPhoto.deleteMany({
    where: { installation: { dispatchNoteNumber: DISPATCH_NOTE } },
  });
  await prisma.siteInstallation.deleteMany({ where: { dispatchNoteNumber: DISPATCH_NOTE } });
  await prisma.dispatchBatchLine.deleteMany({ where: { dispatchNoteNumber: DISPATCH_NOTE } });
  await prisma.siteDispatch.deleteMany({ where: { dispatchNoteNumber: DISPATCH_NOTE } });
  await prisma.qCInspection.deleteMany({ where: { batchNumber: BATCH_PASS } });
  await prisma.batchSlitCoilMap.deleteMany({ where: { batchNumber: BATCH_PASS } });
  await prisma.productionBatch.deleteMany({ where: { batchNumber: BATCH_PASS } });
}

describe("Phase 7 — Site Installation API", () => {
  let siteToken: string;
  let dispatchToken: string;
  let installationId: string;

  beforeAll(async () => {
    siteToken = await login("site@sunrack.local", "Site@12345");
    dispatchToken = await login("dispatch@sunrack.local", "Dispatch@123");
    await cleanup();
    await setupTestData();
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("returns site installation stats", async () => {
    const res = await request(app)
      .get("/api/site-installation/stats")
      .set("Authorization", `Bearer ${siteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stats).toHaveProperty("pendingDispatches");
    expect(res.body.stats).toHaveProperty("totalInstallations");
  });

  it("lists pending dispatches including test dispatch", async () => {
    const res = await request(app)
      .get("/api/site-installation/pending-dispatches")
      .set("Authorization", `Bearer ${siteToken}`);

    expect(res.status).toBe(200);
    const numbers = res.body.pending.map(
      (d: { dispatchNoteNumber: string }) => d.dispatchNoteNumber
    );
    expect(numbers).toContain(DISPATCH_NOTE);
  });

  it("rejects over-quantity installation", async () => {
    const res = await request(app)
      .post("/api/site-installation")
      .set("Authorization", `Bearer ${siteToken}`)
      .send({
        dispatchNoteNumber: DISPATCH_NOTE,
        siteReceiptDate: "2026-03-02",
        installationDate: "2026-03-05",
        installerEpcPartner: "Suntrop Solar",
        quantityInstalled: 100,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot exceed/i);
  });

  it("creates site installation for dispatch note", async () => {
    const res = await request(app)
      .post("/api/site-installation")
      .set("Authorization", `Bearer ${siteToken}`)
      .send({
        dispatchNoteNumber: DISPATCH_NOTE,
        siteReceiptDate: "2026-03-02",
        installationDate: "2026-03-05",
        installerEpcPartner: "Suntrop Solar",
        quantityInstalled: 75,
      });

    expect(res.status).toBe(201);
    expect(res.body.installation.installerEpcPartner).toBe("Suntrop Solar");
    expect(res.body.installation.quantityInstalled).toBe(75);
    installationId = res.body.installation.id;
  });

  it("rejects duplicate installation for same dispatch", async () => {
    const res = await request(app)
      .post("/api/site-installation")
      .set("Authorization", `Bearer ${siteToken}`)
      .send({
        dispatchNoteNumber: DISPATCH_NOTE,
        siteReceiptDate: "2026-03-03",
        installationDate: "2026-03-06",
        installerEpcPartner: "Other EPC",
        quantityInstalled: 50,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already has/i);
  });

  it("uploads installation photo (acceptance criteria)", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );

    const res = await request(app)
      .post(`/api/site-installation/${installationId}/photos`)
      .set("Authorization", `Bearer ${siteToken}`)
      .attach("photos", png, "site-install.png");

    expect(res.status).toBe(201);
    expect(res.body.photos.length).toBeGreaterThanOrEqual(1);
  });

  it("dispatch detail shows linked installation (acceptance criteria)", async () => {
    const res = await request(app)
      .get(`/api/dispatch/${DISPATCH_NOTE}`)
      .set("Authorization", `Bearer ${dispatchToken}`);

    expect(res.status).toBe(200);
    expect(res.body.dispatch.siteInstallation).not.toBeNull();
    expect(res.body.dispatch.siteInstallation.installerEpcPartner).toBe("Suntrop Solar");
    expect(res.body.dispatch.siteInstallation.photoCount).toBeGreaterThanOrEqual(1);
  });

  it("lists installations in history", async () => {
    const res = await request(app)
      .get("/api/site-installation?search=Suntrop")
      .set("Authorization", `Bearer ${siteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.installations.length).toBeGreaterThanOrEqual(1);
  });

  it("gets installation by dispatch note", async () => {
    const res = await request(app)
      .get(`/api/site-installation/by-dispatch/${DISPATCH_NOTE}`)
      .set("Authorization", `Bearer ${siteToken}`);

    expect(res.status).toBe(200);
    expect(res.body.installation.dispatchNoteNumber).toBe(DISPATCH_NOTE);
  });

  it("denies unauthenticated access", async () => {
    const res = await request(app).get("/api/site-installation/stats");
    expect(res.status).toBe(401);
  });
});
