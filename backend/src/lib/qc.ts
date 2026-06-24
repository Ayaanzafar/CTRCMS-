import { prisma } from "../lib/prisma.js";
import type { QcResult } from "@prisma/client";

export async function getLatestQcResult(batchNumber: string): Promise<{
  qcResult: QcResult;
  inspection: Awaited<ReturnType<typeof prisma.qCInspection.findFirst>>;
} | null> {
  const inspection = await prisma.qCInspection.findFirst({
    where: { batchNumber: batchNumber.toUpperCase() },
    orderBy: { inspectionDate: "desc" },
    include: { photos: true },
  });

  if (!inspection) return null;
  return { qcResult: inspection.qcResult, inspection };
}

export async function isBatchDispatchEligible(batchNumber: string): Promise<boolean> {
  const latest = await getLatestQcResult(batchNumber);
  return latest?.qcResult === "PASS";
}

export async function listDispatchEligibleBatchNumbers(): Promise<string[]> {
  const batches = await prisma.productionBatch.findMany({
    select: { batchNumber: true },
    orderBy: { productionDate: "desc" },
  });

  const eligible: string[] = [];
  for (const b of batches) {
    if (await isBatchDispatchEligible(b.batchNumber)) {
      eligible.push(b.batchNumber);
    }
  }
  return eligible;
}
