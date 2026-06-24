/**
 * Persistent UI demo data — uses DEMO- / BATCH-DEMO- / DN-DEMO- prefixes only.
 * Automated tests use BATCH-*-TEST* and never delete these records.
 *
 * Run: npm run db:seed:demo
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const DEMO = {
  coil: "DEMO-COIL-001",
  slits: ["DEMO-COIL-001-S01", "DEMO-COIL-001-S02", "DEMO-COIL-001-S03"] as const,
  batches: {
    pendingQc: "BATCH-DEMO-2026-001",
    passFull: "BATCH-DEMO-2026-002",
    passPartial: "BATCH-DEMO-2026-003",
    fail: "BATCH-DEMO-2026-004",
  },
  dispatch: "DN-DEMO-2026-0001",
  dispatchPendingSite: "DN-DEMO-2026-0002",
  complaint: "COMP-DEMO-2026-0001",
} as const;

const DEMO_BATCH_NUMBERS = Object.values(DEMO.batches);

async function clearDemoData() {
  await prisma.complaintPhoto.deleteMany({
    where: { complaint: { complaintId: { startsWith: "COMP-DEMO-" } } },
  });

  await prisma.complaintBatchLine.deleteMany({
    where: { complaint: { complaintId: { startsWith: "COMP-DEMO-" } } },
  });

  await prisma.complaint.deleteMany({
    where: { complaintId: { startsWith: "COMP-DEMO-" } },
  });

  await prisma.siteInstallationPhoto.deleteMany({
    where: { installation: { dispatchNoteNumber: { startsWith: "DN-DEMO-" } } },
  });

  await prisma.siteInstallation.deleteMany({
    where: { dispatchNoteNumber: { startsWith: "DN-DEMO-" } },
  });

  await prisma.dispatchBatchLine.deleteMany({
    where: {
      OR: [
        { dispatchNoteNumber: { startsWith: "DN-DEMO-" } },
        { batchNumber: { startsWith: "BATCH-DEMO-" } },
      ],
    },
  });

  await prisma.siteDispatch.deleteMany({
    where: { dispatchNoteNumber: { startsWith: "DN-DEMO-" } },
  });

  await prisma.qCInspection.deleteMany({
    where: { batchNumber: { startsWith: "BATCH-DEMO-" } },
  });

  await prisma.batchSlitCoilMap.deleteMany({
    where: { batchNumber: { startsWith: "BATCH-DEMO-" } },
  });

  await prisma.productionBatch.deleteMany({
    where: { batchNumber: { startsWith: "BATCH-DEMO-" } },
  });

  await prisma.sunrackReceipt.deleteMany({
    where: { slitCoilId: { startsWith: "DEMO-COIL-" } },
  });

  await prisma.slittingRecord.deleteMany({
    where: { slitCoilId: { startsWith: "DEMO-COIL-" } },
  });

  await prisma.coil.deleteMany({
    where: { coilNumber: { startsWith: "DEMO-COIL-" } },
  });
}

async function seedDemoData() {
  console.log("Resetting DEMO-* records (safe — tests never touch these)...");

  await clearDemoData();

  console.log("Creating demo coil and slitting records...");

  await prisma.coil.create({
    data: {
      coilNumber: DEMO.coil,
      grade: "AMNS550S",
      coating: "ZM150",
      size: "1250 x 0.5 mm",
      weight: 10.0,
      supplier: "AMNS (Hazira Plant)",
      mtcNumber: "MTC-DEMO-2026-001",
      invoiceNumber: "INV-DEMO-2026-001",
      amnsDispatchDate: new Date("2026-01-10"),
      vehicleNumber: "GJ01AB9999",
      transporterName: "AMNS Logistics",
      receiptDateSlitter: new Date("2026-01-12"),
      receivingConditionRemarks: "Demo coil — good condition, no edge damage",
    },
  });

  const slitDefs = [
    {
      slitCoilId: DEMO.slits[0],
      slitWidthSize: "1040 x 0.5 mm",
      slitCoilWeight: 5.0,
      dispatchNote: "DN-SS-DEMO-001",
    },
    {
      slitCoilId: DEMO.slits[1],
      slitWidthSize: "520 x 0.5 mm",
      slitCoilWeight: 4.5,
      dispatchNote: "DN-SS-DEMO-001",
    },
    {
      slitCoilId: DEMO.slits[2],
      slitWidthSize: "1080 x 0.5 mm",
      slitCoilWeight: 0.5,
      dispatchNote: "DN-SS-DEMO-002",
    },
  ] as const;

  for (const slit of slitDefs) {
    await prisma.slittingRecord.create({
      data: {
        slitCoilId: slit.slitCoilId,
        parentCoilNumber: DEMO.coil,
        slitWidthSize: slit.slitWidthSize,
        slittingDate: new Date("2026-01-15"),
        slitCoilWeight: slit.slitCoilWeight,
        slitterLocation: "Shiv Sagar Slitter",
        dispatchNote: slit.dispatchNote,
        vehicleNumber: "MH04DEMO01",
        transporterName: "Shiv Sagar Logistics",
      },
    });
  }

  console.log("Creating Sunrack warehouse receipts...");

  for (const [i, slitCoilId] of DEMO.slits.entries()) {
    await prisma.sunrackReceipt.create({
      data: {
        slitCoilId,
        receiptDateSunrack: new Date("2026-01-20"),
        storageLocationBin: `WH-DEMO / Rack-0${i + 1}`,
        inspectionResult: "PASS",
        inspectionRemarks: "Demo receipt — coating OK",
        confirmedDispatchNote: slitDefs[i].dispatchNote,
      },
    });
  }

  console.log("Creating production batches...");

  await prisma.productionBatch.create({
    data: {
      batchNumber: DEMO.batches.pendingQc,
      productionOrderNumber: "PO-DEMO-2026-001",
      productType: "Walkway Tray",
      quantityProduced: 120,
      productionDate: new Date("2026-02-05"),
      operatorShift: "Shift A",
      slitCoilConsumptions: {
        create: { slitCoilId: DEMO.slits[0], quantityConsumed: 1.2 },
      },
    },
  });

  await prisma.productionBatch.create({
    data: {
      batchNumber: DEMO.batches.passFull,
      productionOrderNumber: "PO-DEMO-2026-002",
      productType: "Support Frame",
      quantityProduced: 200,
      productionDate: new Date("2026-02-08"),
      operatorShift: "Shift B",
      slitCoilConsumptions: {
        create: { slitCoilId: DEMO.slits[1], quantityConsumed: 1.0 },
      },
    },
  });

  await prisma.productionBatch.create({
    data: {
      batchNumber: DEMO.batches.passPartial,
      productionOrderNumber: "PO-DEMO-2026-003",
      productType: "Walkway Tray",
      quantityProduced: 150,
      productionDate: new Date("2026-02-10"),
      operatorShift: "Shift A",
      slitCoilConsumptions: {
        create: { slitCoilId: DEMO.slits[1], quantityConsumed: 0.8 },
      },
    },
  });

  await prisma.productionBatch.create({
    data: {
      batchNumber: DEMO.batches.fail,
      productionOrderNumber: "PO-DEMO-2026-004",
      productType: "Cable Tray",
      quantityProduced: 80,
      productionDate: new Date("2026-02-12"),
      operatorShift: "Shift C",
      slitCoilConsumptions: {
        create: { slitCoilId: DEMO.slits[2], quantityConsumed: 0.05 },
      },
    },
  });

  console.log("Creating QC inspections...");

  await prisma.qCInspection.create({
    data: {
      batchNumber: DEMO.batches.passFull,
      qcResult: "PASS",
      inspectorName: "QC Inspector (Demo)",
      inspectionDate: new Date("2026-02-09"),
      qcRemarks: "All dimensions within tolerance — release for dispatch",
    },
  });

  await prisma.qCInspection.create({
    data: {
      batchNumber: DEMO.batches.passPartial,
      qcResult: "PASS",
      inspectorName: "QC Inspector (Demo)",
      inspectionDate: new Date("2026-02-11"),
      qcRemarks: "Pass — partial dispatch demo",
    },
  });

  await prisma.qCInspection.create({
    data: {
      batchNumber: DEMO.batches.fail,
      qcResult: "FAIL",
      inspectorName: "QC Inspector (Demo)",
      inspectionDate: new Date("2026-02-13"),
      qcRemarks: "Coating defect — blocked from dispatch",
    },
  });

  console.log("Creating dispatch record...");

  await prisma.siteDispatch.create({
    data: {
      dispatchNoteNumber: DEMO.dispatch,
      dispatchDate: new Date("2026-02-20"),
      vehicleNumber: "MH12DEMO99",
      transporterName: "Sunrack Logistics",
      projectName: "Solar Park Demo Alpha",
      clientName: "Suntrop Solar (Demo)",
      siteLocation: "Nashik, Maharashtra",
      batchLines: {
        create: {
          batchNumber: DEMO.batches.passPartial,
          quantityDispatched: 60,
        },
      },
      siteInstallation: {
        create: {
          siteReceiptDate: new Date("2026-02-22"),
          installationDate: new Date("2026-02-25"),
          installerEpcPartner: "Suntrop Solar",
          quantityInstalled: 60,
        },
      },
    },
  });

  await prisma.siteDispatch.create({
    data: {
      dispatchNoteNumber: DEMO.dispatchPendingSite,
      dispatchDate: new Date("2026-02-28"),
      vehicleNumber: "MH04DEMO02",
      transporterName: "Sunrack Logistics",
      projectName: "Solar Park Demo Beta",
      clientName: "EPC Partner (Demo)",
      siteLocation: "Aurangabad, Maharashtra",
      batchLines: {
        create: {
          batchNumber: DEMO.batches.passFull,
          quantityDispatched: 50,
        },
      },
    },
  });

  console.log("Creating demo complaint...");

  await prisma.complaint.create({
    data: {
      complaintId: DEMO.complaint,
      complaintDate: new Date("2026-03-01"),
      projectName: "Solar Park Demo Alpha",
      clientName: "Suntrop Solar (Demo)",
      siteLocation: "Nashik, Maharashtra",
      complaintDescription:
        "Rust spots on walkway tray near bolt holes — reported after 2 weeks at site",
      rootCauseRemarks: "Under investigation — initial photos suggest handling damage at site",
      resolutionStatus: "UNDER_INVESTIGATION",
      responsibleStage: "SITE_HANDLING",
      batchLines: {
        create: { batchNumber: DEMO.batches.passPartial },
      },
    },
  });

  console.log("");
  console.log("Demo data ready for UI testing:");
  console.log(`  Coil:       ${DEMO.coil}`);
  console.log(`  Slit coils: ${DEMO.slits.join(", ")}`);
  console.log(`  Pending QC: ${DEMO.batches.pendingQc} (120 units — inspect in QC module)`);
  console.log(`  FG full:    ${DEMO.batches.passFull} (200 available)`);
  console.log(`  FG partial: ${DEMO.batches.passPartial} (90 available, 60 dispatched + installed)`);
  console.log(`  QC fail:    ${DEMO.batches.fail} (not in Finished Goods)`);
  console.log(`  Dispatch:   ${DEMO.dispatch} (site installed)`);
  console.log(`  Pending site: ${DEMO.dispatchPendingSite} (50 units — confirm in Site Installation)`);
  console.log(`  Complaint:    ${DEMO.complaint} (links to ${DEMO.coil} via batch ${DEMO.batches.passPartial})`);
  console.log(`  Traceability: search "${DEMO.coil}" or "${DEMO.complaint}" in Traceability Report`);
  console.log("");
  console.log("Re-run anytime: npm run db:seed:demo");
}

async function main() {
  await seedDemoData();
}

const isDirectRun = process.argv[1]?.includes("seed-demo-data");

if (isDirectRun) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { seedDemoData, clearDemoData };
