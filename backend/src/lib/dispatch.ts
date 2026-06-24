import { prisma } from "./prisma.js";
import { isBatchDispatchEligible } from "./qc.js";

export async function getBatchDispatchedQuantity(batchNumber: string): Promise<number> {
  const result = await prisma.dispatchBatchLine.aggregate({
    where: { batchNumber: batchNumber.toUpperCase() },
    _sum: { quantityDispatched: true },
  });
  return Number(result._sum.quantityDispatched ?? 0);
}

export async function generateNextDispatchNoteNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `DN-SR-${year}-`;
  const existing = await prisma.siteDispatch.findMany({
    where: { dispatchNoteNumber: { startsWith: prefix } },
    select: { dispatchNoteNumber: true },
    orderBy: { dispatchNoteNumber: "desc" },
    take: 1,
  });

  let next = 1;
  if (existing[0]) {
    const seq = parseInt(existing[0].dispatchNoteNumber.slice(prefix.length), 10);
    if (!Number.isNaN(seq)) next = seq + 1;
  }

  return `${prefix}${String(next).padStart(4, "0")}`;
}

export async function validateDispatchBatchLines(
  lines: Array<{ batchNumber: string; quantityDispatched: number }>,
  excludeDispatchNoteNumber?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (lines.length === 0) {
    return { ok: false, error: "At least one batch line is required" };
  }

  const seen = new Set<string>();
  for (const line of lines) {
    const batchNumber = line.batchNumber.toUpperCase();

    if (seen.has(batchNumber)) {
      return { ok: false, error: `Duplicate batch ${batchNumber} in dispatch lines` };
    }
    seen.add(batchNumber);

    const batch = await prisma.productionBatch.findUnique({ where: { batchNumber } });
    if (!batch) {
      return { ok: false, error: `Production batch ${batchNumber} not found` };
    }

    const eligible = await isBatchDispatchEligible(batchNumber);
    if (!eligible) {
      return {
        ok: false,
        error: `Batch ${batchNumber} is not QC Pass — only QC-passed batches can be dispatched`,
      };
    }

    if (line.quantityDispatched <= 0) {
      return { ok: false, error: `Quantity dispatched for ${batchNumber} must be positive` };
    }

    const consumedAgg = await prisma.dispatchBatchLine.aggregate({
      where: {
        batchNumber,
        ...(excludeDispatchNoteNumber
          ? { dispatchNoteNumber: { not: excludeDispatchNoteNumber.toUpperCase() } }
          : {}),
      },
      _sum: { quantityDispatched: true },
    });

    const alreadyDispatched = Number(consumedAgg._sum.quantityDispatched ?? 0);
    const produced = Number(batch.quantityProduced);
    const remaining = produced - alreadyDispatched;

    if (line.quantityDispatched > remaining + 0.0001) {
      return {
        ok: false,
        error: `Batch ${batchNumber} only has ${remaining.toFixed(3)} units available (${produced} produced, ${alreadyDispatched.toFixed(3)} already dispatched)`,
      };
    }
  }

  return { ok: true };
}
