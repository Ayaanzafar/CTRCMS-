import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { computeAvailableQuantity, getBatchDispatchedQuantity } from "../lib/finished-goods.js";

const batchDetailInclude = {
  slitCoilConsumptions: {
    include: {
      slitCoil: {
        select: {
          slitCoilId: true,
          parentCoilNumber: true,
          slitWidthSize: true,
        },
      },
    },
  },
  qcInspections: {
    orderBy: { inspectionDate: "desc" as const },
    take: 1,
    include: { photos: { select: { id: true, originalName: true } } },
  },
};

async function mapBatchToInventoryItem(
  batch: Awaited<ReturnType<typeof prisma.productionBatch.findFirst>> & {
    slitCoilConsumptions?: unknown;
    qcInspections?: Array<{
      id: string;
      qcResult: string;
      inspectionDate: Date;
      inspectorName: string;
    }>;
  }
) {
  const latestQc = batch!.qcInspections?.[0];
  if (!latestQc || latestQc.qcResult !== "PASS") return null;

  const quantityProduced = Number(batch!.quantityProduced);
  const quantityDispatched = await getBatchDispatchedQuantity(batch!.batchNumber);
  const quantityAvailable = computeAvailableQuantity(quantityProduced, quantityDispatched);

  return {
    batchNumber: batch!.batchNumber,
    productionOrderNumber: batch!.productionOrderNumber,
    productType: batch!.productType,
    quantityProduced,
    quantityDispatched,
    quantityAvailable,
    productionDate: batch!.productionDate,
    operatorShift: batch!.operatorShift,
    qcInspection: {
      id: latestQc.id,
      qcResult: latestQc.qcResult,
      inspectionDate: latestQc.inspectionDate,
      inspectorName: latestQc.inspectorName,
    },
    slitCoilCount: (batch as { slitCoilConsumptions?: unknown[] }).slitCoilConsumptions?.length ?? 0,
  };
}

export async function listFinishedGoodsInventory(req: Request, res: Response): Promise<void> {
  const search = (req.query.search as string)?.trim();
  const productType = (req.query.productType as string)?.trim();
  const availableOnly = req.query.availableOnly === "true";

  const where: Prisma.ProductionBatchWhereInput = {};

  if (search) {
    where.OR = [
      { batchNumber: { contains: search, mode: "insensitive" } },
      { productionOrderNumber: { contains: search, mode: "insensitive" } },
      { productType: { contains: search, mode: "insensitive" } },
    ];
  }

  if (productType) {
    where.productType = { contains: productType, mode: "insensitive" };
  }

  const batches = await prisma.productionBatch.findMany({
    where,
    include: {
      slitCoilConsumptions: { select: { id: true } },
      qcInspections: {
        orderBy: { inspectionDate: "desc" },
        take: 1,
        select: {
          id: true,
          qcResult: true,
          inspectionDate: true,
          inspectorName: true,
        },
      },
    },
    orderBy: { productionDate: "desc" },
  });

  const items = [];
  for (const batch of batches) {
    const item = await mapBatchToInventoryItem(batch);
    if (!item) continue;
    if (availableOnly && item.quantityAvailable <= 0) continue;
    items.push(item);
  }

  res.json({ inventory: items });
}

export async function getFinishedGoodsStats(_req: Request, res: Response): Promise<void> {
  const batches = await prisma.productionBatch.findMany({
    include: {
      qcInspections: {
        orderBy: { inspectionDate: "desc" },
        take: 1,
        select: { qcResult: true },
      },
    },
  });

  let passBatchCount = 0;
  let totalProduced = 0;
  let totalAvailable = 0;
  let totalDispatched = 0;
  const byProductType: Record<string, { batches: number; available: number }> = {};

  for (const batch of batches) {
    const latest = batch.qcInspections[0];
    if (!latest || latest.qcResult !== "PASS") continue;

    passBatchCount++;
    const produced = Number(batch.quantityProduced);
    const dispatched = await getBatchDispatchedQuantity(batch.batchNumber);
    const available = computeAvailableQuantity(produced, dispatched);

    totalProduced += produced;
    totalAvailable += available;
    totalDispatched += dispatched;

    if (!byProductType[batch.productType]) {
      byProductType[batch.productType] = { batches: 0, available: 0 };
    }
    byProductType[batch.productType].batches++;
    byProductType[batch.productType].available += available;
  }

  res.json({
    stats: {
      qcPassedBatches: passBatchCount,
      totalUnitsProduced: totalProduced,
      totalUnitsDispatched: totalDispatched,
      totalUnitsAvailable: totalAvailable,
      byProductType,
    },
  });
}

export async function getFinishedGoodsItem(req: Request, res: Response): Promise<void> {
  const batchNumber = req.params.batchNumber.toUpperCase();

  const batch = await prisma.productionBatch.findUnique({
    where: { batchNumber },
    include: batchDetailInclude,
  });

  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }

  const item = await mapBatchToInventoryItem(batch);
  if (!item) {
    res.status(404).json({
      error: "Batch is not in finished goods inventory (QC Pass required)",
    });
    return;
  }

  res.json({
    item: {
      ...item,
      slitCoilConsumptions: batch.slitCoilConsumptions,
      qcInspection: batch.qcInspections[0] ?? null,
    },
  });
}
