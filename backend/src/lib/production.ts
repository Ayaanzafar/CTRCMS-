import { prisma } from "../lib/prisma.js";

export async function getSlitCoilConsumedTotal(slitCoilId: string): Promise<number> {
  const result = await prisma.batchSlitCoilMap.aggregate({
    where: { slitCoilId: slitCoilId.toUpperCase() },
    _sum: { quantityConsumed: true },
  });
  return Number(result._sum.quantityConsumed ?? 0);
}

export async function getSlitCoilRemaining(slitCoilId: string): Promise<number> {
  const slit = await prisma.slittingRecord.findUnique({
    where: { slitCoilId: slitCoilId.toUpperCase() },
    select: { slitCoilWeight: true },
  });
  if (!slit) return 0;
  const consumed = await getSlitCoilConsumedTotal(slitCoilId);
  return Math.max(0, Number(slit.slitCoilWeight) - consumed);
}

export async function generateNextBatchNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `BATCH-${year}-`;
  const existing = await prisma.productionBatch.findMany({
    where: { batchNumber: { startsWith: prefix } },
    select: { batchNumber: true },
    orderBy: { batchNumber: "desc" },
    take: 1,
  });

  let next = 1;
  if (existing[0]) {
    const seq = parseInt(existing[0].batchNumber.slice(prefix.length), 10);
    if (!Number.isNaN(seq)) next = seq + 1;
  }

  return `${prefix}${String(next).padStart(4, "0")}`;
}

export async function validateSlitCoilConsumptions(
  consumptions: Array<{ slitCoilId: string; quantityConsumed: number }>,
  excludeBatchNumber?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const line of consumptions) {
    const slitCoilId = line.slitCoilId.toUpperCase();

    const slit = await prisma.slittingRecord.findUnique({
      where: { slitCoilId },
      include: { sunrackReceipt: true },
    });

    if (!slit) {
      return { ok: false, error: `Slit coil ${slitCoilId} not found` };
    }

    if (!slit.sunrackReceipt) {
      return { ok: false, error: `Slit coil ${slitCoilId} has no Sunrack receipt — issue to production only after warehouse receipt` };
    }

    if (slit.sunrackReceipt.inspectionResult === "FAIL") {
      return { ok: false, error: `Slit coil ${slitCoilId} failed warehouse inspection and cannot enter production` };
    }

    const consumedAgg = await prisma.batchSlitCoilMap.aggregate({
      where: {
        slitCoilId,
        ...(excludeBatchNumber ? { batchNumber: { not: excludeBatchNumber.toUpperCase() } } : {}),
      },
      _sum: { quantityConsumed: true },
    });

    const alreadyConsumed = Number(consumedAgg._sum.quantityConsumed ?? 0);
    const totalWeight = Number(slit.slitCoilWeight);
    const remaining = totalWeight - alreadyConsumed;

    if (line.quantityConsumed <= 0) {
      return { ok: false, error: `Quantity consumed for ${slitCoilId} must be positive` };
    }

    if (line.quantityConsumed > remaining + 0.0001) {
      return {
        ok: false,
        error: `Slit coil ${slitCoilId} only has ${remaining.toFixed(3)} MT remaining (${totalWeight} MT total, ${alreadyConsumed.toFixed(3)} MT already issued)`,
      };
    }
  }

  return { ok: true };
}
