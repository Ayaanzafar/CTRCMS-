import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  generateNextBatchNumber,
  getSlitCoilRemaining,
  validateSlitCoilConsumptions,
} from "../lib/production.js";

const consumptionLineSchema = z.object({
  slitCoilId: z.string().min(1),
  quantityConsumed: z.coerce.number().positive(),
});

const createBatchSchema = z.object({
  batchNumber: z.string().min(1).max(50).optional(),
  productionOrderNumber: z.string().min(1),
  productType: z.string().min(1),
  quantityProduced: z.coerce.number().positive(),
  productionDate: z.string().min(1),
  operatorShift: z.string().min(1),
  slitCoilConsumptions: z.array(consumptionLineSchema).min(1),
});

const updateBatchSchema = z.object({
  productionOrderNumber: z.string().min(1).optional(),
  productType: z.string().min(1).optional(),
  quantityProduced: z.coerce.number().positive().optional(),
  productionDate: z.string().optional(),
  operatorShift: z.string().min(1).optional(),
});

const issueSlitCoilsSchema = z.object({
  slitCoilConsumptions: z.array(consumptionLineSchema).min(1),
});

function parseDate(value?: string | null) {
  return value ? new Date(value) : null;
}

const batchInclude = {
  slitCoilConsumptions: {
    include: {
      slitCoil: {
        select: {
          slitCoilId: true,
          parentCoilNumber: true,
          slitWidthSize: true,
          slitCoilWeight: true,
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
  qcInspections: {
    orderBy: { inspectionDate: "desc" as const },
    include: { photos: { orderBy: { createdAt: "asc" as const } } },
  },
};

export async function listProductionBatches(req: Request, res: Response): Promise<void> {
  const search = (req.query.search as string)?.trim();
  const productType = (req.query.productType as string)?.trim();
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const where: Prisma.ProductionBatchWhereInput = {};

  if (search) {
    where.OR = [
      { batchNumber: { contains: search, mode: "insensitive" } },
      { productionOrderNumber: { contains: search, mode: "insensitive" } },
      { operatorShift: { contains: search, mode: "insensitive" } },
      { slitCoilConsumptions: { some: { slitCoilId: { contains: search, mode: "insensitive" } } } },
    ];
  }

  if (productType) {
    where.productType = { contains: productType, mode: "insensitive" };
  }

  if (from || to) {
    where.productionDate = {};
    if (from) where.productionDate.gte = new Date(from);
    if (to) where.productionDate.lte = new Date(to);
  }

  const batches = await prisma.productionBatch.findMany({
    where,
    include: {
      slitCoilConsumptions: {
        select: { slitCoilId: true, quantityConsumed: true },
      },
      _count: { select: { slitCoilConsumptions: true } },
      qcInspections: {
        orderBy: { inspectionDate: "desc" as const },
        take: 1,
        select: { id: true, qcResult: true, inspectionDate: true, inspectorName: true },
      },
    },
    orderBy: { productionDate: "desc" },
  });

  res.json({ batches });
}

export async function getProductionStats(_req: Request, res: Response): Promise<void> {
  const [totalBatches, availableSlitCoils] = await Promise.all([
    prisma.productionBatch.count(),
    prisma.slittingRecord.count({
      where: {
        sunrackReceipt: { is: { inspectionResult: { not: "FAIL" } } },
      },
    }),
  ]);

  res.json({
    stats: {
      totalBatches,
      slitCoilsWithReceipt: availableSlitCoils,
    },
  });
}

export async function listAvailableSlitCoils(req: Request, res: Response): Promise<void> {
  const search = (req.query.search as string)?.trim();

  const where: Prisma.SlittingRecordWhereInput = {
    sunrackReceipt: { is: { inspectionResult: { not: "FAIL" } } },
  };

  if (search) {
    where.OR = [
      { slitCoilId: { contains: search, mode: "insensitive" } },
      { parentCoilNumber: { contains: search, mode: "insensitive" } },
    ];
  }

  const records = await prisma.slittingRecord.findMany({
    where,
    include: {
      parentCoil: { select: { coilNumber: true, grade: true, coating: true } },
      sunrackReceipt: { select: { storageLocationBin: true, inspectionResult: true } },
      batchConsumptions: { select: { quantityConsumed: true } },
    },
    orderBy: { slittingDate: "desc" },
  });

  const available = await Promise.all(
    records.map(async (r) => {
      const consumed = r.batchConsumptions.reduce(
        (sum, c) => sum + Number(c.quantityConsumed),
        0
      );
      const total = Number(r.slitCoilWeight);
      const remaining = total - consumed;
      return {
        slitCoilId: r.slitCoilId,
        parentCoilNumber: r.parentCoilNumber,
        slitWidthSize: r.slitWidthSize,
        slitCoilWeight: r.slitCoilWeight,
        remainingQuantity: remaining,
        parentCoil: r.parentCoil,
        sunrackReceipt: r.sunrackReceipt,
      };
    })
  );

  res.json({ available: available.filter((a) => a.remainingQuantity > 0.0001) });
}

export async function previewBatchNumber(_req: Request, res: Response): Promise<void> {
  const batchNumber = await generateNextBatchNumber();
  res.json({ batchNumber });
}

export async function getProductionBatch(req: Request, res: Response): Promise<void> {
  const batchNumber = req.params.batchNumber.toUpperCase();

  const batch = await prisma.productionBatch.findUnique({
    where: { batchNumber },
    include: batchInclude,
  });

  if (!batch) {
    res.status(404).json({ error: "Production batch not found" });
    return;
  }

  res.json({ batch });
}

export async function createProductionBatch(req: Request, res: Response): Promise<void> {
  const parsed = createBatchSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const batchNumber = (data.batchNumber ?? (await generateNextBatchNumber())).toUpperCase();

  const existing = await prisma.productionBatch.findUnique({ where: { batchNumber } });
  if (existing) {
    res.status(409).json({ error: `Batch ${batchNumber} already exists` });
    return;
  }

  const validation = await validateSlitCoilConsumptions(data.slitCoilConsumptions);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const productionDate = parseDate(data.productionDate);
  if (!productionDate) {
    res.status(400).json({ error: "Invalid production date" });
    return;
  }

  const batch = await prisma.productionBatch.create({
    data: {
      batchNumber,
      productionOrderNumber: data.productionOrderNumber,
      productType: data.productType,
      quantityProduced: data.quantityProduced,
      productionDate,
      operatorShift: data.operatorShift,
      slitCoilConsumptions: {
        create: data.slitCoilConsumptions.map((line) => ({
          slitCoilId: line.slitCoilId.toUpperCase(),
          quantityConsumed: line.quantityConsumed,
        })),
      },
    },
    include: batchInclude,
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "CREATE",
        entityType: "ProductionBatch",
        entityId: batch.batchNumber,
        newValues: {
          batchNumber,
          slitCoilIds: data.slitCoilConsumptions.map((l) => l.slitCoilId.toUpperCase()),
        },
      },
    });
  }

  res.status(201).json({ batch });
}

export async function issueSlitCoilsToBatch(req: Request, res: Response): Promise<void> {
  const batchNumber = req.params.batchNumber.toUpperCase();
  const parsed = issueSlitCoilsSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const batch = await prisma.productionBatch.findUnique({ where: { batchNumber } });
  if (!batch) {
    res.status(404).json({ error: "Production batch not found" });
    return;
  }

  const validation = await validateSlitCoilConsumptions(
    parsed.data.slitCoilConsumptions,
    batchNumber
  );
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const line of parsed.data.slitCoilConsumptions) {
      const slitCoilId = line.slitCoilId.toUpperCase();
      const existing = await tx.batchSlitCoilMap.findUnique({
        where: { batchNumber_slitCoilId: { batchNumber, slitCoilId } },
      });

      if (existing) {
        await tx.batchSlitCoilMap.update({
          where: { id: existing.id },
          data: {
            quantityConsumed: Number(existing.quantityConsumed) + line.quantityConsumed,
          },
        });
      } else {
        await tx.batchSlitCoilMap.create({
          data: {
            batchNumber,
            slitCoilId,
            quantityConsumed: line.quantityConsumed,
          },
        });
      }
    }
  });

  const updated = await prisma.productionBatch.findUnique({
    where: { batchNumber },
    include: batchInclude,
  });

  if (req.user && updated) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "UPDATE",
        entityType: "ProductionBatch",
        entityId: batchNumber,
        newValues: { action: "issue_slit_coils", consumptions: parsed.data.slitCoilConsumptions },
      },
    });
  }

  res.json({ batch: updated });
}

export async function updateProductionBatch(req: Request, res: Response): Promise<void> {
  const batchNumber = req.params.batchNumber.toUpperCase();
  const parsed = updateBatchSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.productionBatch.findUnique({ where: { batchNumber } });
  if (!existing) {
    res.status(404).json({ error: "Production batch not found" });
    return;
  }

  const data = parsed.data;

  const batch = await prisma.productionBatch.update({
    where: { batchNumber },
    data: {
      ...(data.productionOrderNumber !== undefined && {
        productionOrderNumber: data.productionOrderNumber,
      }),
      ...(data.productType !== undefined && { productType: data.productType }),
      ...(data.quantityProduced !== undefined && { quantityProduced: data.quantityProduced }),
      ...(data.productionDate !== undefined && { productionDate: parseDate(data.productionDate) }),
      ...(data.operatorShift !== undefined && { operatorShift: data.operatorShift }),
    },
    include: batchInclude,
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "UPDATE",
        entityType: "ProductionBatch",
        entityId: batchNumber,
        oldValues: existing,
        newValues: batch,
      },
    });
  }

  res.json({ batch });
}

export async function getSlitCoilProductionUsage(req: Request, res: Response): Promise<void> {
  const slitCoilId = req.params.slitCoilId.toUpperCase();
  const remaining = await getSlitCoilRemaining(slitCoilId);

  const consumptions = await prisma.batchSlitCoilMap.findMany({
    where: { slitCoilId },
    include: {
      batch: {
        select: {
          batchNumber: true,
          productType: true,
          quantityProduced: true,
          productionDate: true,
          productionOrderNumber: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  res.json({ slitCoilId, remainingQuantity: remaining, consumptions });
}
