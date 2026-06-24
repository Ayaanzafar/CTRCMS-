import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { existsSync } from "node:fs";
import { prisma } from "../lib/prisma.js";
import { getLatestQcResult, listDispatchEligibleBatchNumbers } from "../lib/qc.js";
import { notifyQcFailed } from "../lib/notifications.js";

const qcResultEnum = z.enum(["PASS", "FAIL", "REWORK"]);

const createInspectionSchema = z.object({
  batchNumber: z.string().min(1),
  qcResult: qcResultEnum,
  inspectorName: z.string().min(1),
  inspectionDate: z.string().min(1),
  qcRemarks: z.string().optional().nullable(),
});

const updateInspectionSchema = z.object({
  qcResult: qcResultEnum.optional(),
  inspectorName: z.string().min(1).optional(),
  inspectionDate: z.string().optional(),
  qcRemarks: z.string().optional().nullable(),
});

function parseDate(value?: string | null) {
  return value ? new Date(value) : null;
}

const inspectionInclude = {
  batch: {
    select: {
      batchNumber: true,
      productionOrderNumber: true,
      productType: true,
      quantityProduced: true,
      productionDate: true,
      operatorShift: true,
    },
  },
  photos: { orderBy: { createdAt: "asc" as const } },
  _count: { select: { photos: true } },
};

export async function listQcInspections(req: Request, res: Response): Promise<void> {
  const search = (req.query.search as string)?.trim();
  const status = (req.query.status as string)?.trim();
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const where: Prisma.QCInspectionWhereInput = {};

  if (search) {
    where.OR = [
      { batchNumber: { contains: search, mode: "insensitive" } },
      { inspectorName: { contains: search, mode: "insensitive" } },
      { batch: { productionOrderNumber: { contains: search, mode: "insensitive" } } },
    ];
  }

  if (status && status !== "ALL") {
    where.qcResult = status as Prisma.EnumQcResultFilter["equals"];
  }

  if (from || to) {
    where.inspectionDate = {};
    if (from) where.inspectionDate.gte = new Date(from);
    if (to) where.inspectionDate.lte = new Date(to);
  }

  const inspections = await prisma.qCInspection.findMany({
    where,
    include: inspectionInclude,
    orderBy: { inspectionDate: "desc" },
  });

  res.json({ inspections });
}

export async function getQcStats(_req: Request, res: Response): Promise<void> {
  const [total, passCount, failCount, reworkCount, pendingBatches] = await Promise.all([
    prisma.qCInspection.count(),
    prisma.qCInspection.count({ where: { qcResult: "PASS" } }),
    prisma.qCInspection.count({ where: { qcResult: "FAIL" } }),
    prisma.qCInspection.count({ where: { qcResult: "REWORK" } }),
    prisma.productionBatch.count({
      where: { qcInspections: { none: {} } },
    }),
  ]);

  res.json({
    stats: {
      totalInspections: total,
      passed: passCount,
      failed: failCount,
      rework: reworkCount,
      batchesPendingQc: pendingBatches,
    },
  });
}

export async function listPendingBatches(_req: Request, res: Response): Promise<void> {
  const batches = await prisma.productionBatch.findMany({
    include: {
      slitCoilConsumptions: { select: { slitCoilId: true, quantityConsumed: true } },
      qcInspections: {
        orderBy: { inspectionDate: "desc" },
        take: 1,
        select: { qcResult: true, inspectionDate: true, inspectorName: true },
      },
    },
    orderBy: { productionDate: "desc" },
  });

  const pending = batches
    .map((b) => {
      const latest = b.qcInspections[0];
      return {
        batchNumber: b.batchNumber,
        productionOrderNumber: b.productionOrderNumber,
        productType: b.productType,
        quantityProduced: b.quantityProduced,
        productionDate: b.productionDate,
        latestQc: latest ?? null,
        needsInspection: !latest || latest.qcResult === "REWORK",
      };
    })
    .filter((b) => b.needsInspection);

  res.json({ pending });
}

export async function listDispatchEligibleBatches(_req: Request, res: Response): Promise<void> {
  const eligibleNumbers = await listDispatchEligibleBatchNumbers();

  const batches = await prisma.productionBatch.findMany({
    where: { batchNumber: { in: eligibleNumbers } },
    include: {
      qcInspections: {
        where: { qcResult: "PASS" },
        orderBy: { inspectionDate: "desc" },
        take: 1,
      },
    },
    orderBy: { productionDate: "desc" },
  });

  res.json({ batches });
}

export async function getQcInspection(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const inspection = await prisma.qCInspection.findUnique({
    where: { id },
    include: inspectionInclude,
  });

  if (!inspection) {
    res.status(404).json({ error: "QC inspection not found" });
    return;
  }

  res.json({ inspection });
}

export async function getQcByBatch(req: Request, res: Response): Promise<void> {
  const batchNumber = req.params.batchNumber.toUpperCase();

  const inspections = await prisma.qCInspection.findMany({
    where: { batchNumber },
    include: inspectionInclude,
    orderBy: { inspectionDate: "desc" },
  });

  const latest = await getLatestQcResult(batchNumber);

  res.json({
    batchNumber,
    latestResult: latest?.qcResult ?? null,
    dispatchEligible: latest?.qcResult === "PASS",
    inspections,
  });
}

export async function createQcInspection(req: Request, res: Response): Promise<void> {
  const parsed = createInspectionSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const batchNumber = data.batchNumber.toUpperCase();

  const batch = await prisma.productionBatch.findUnique({ where: { batchNumber } });
  if (!batch) {
    res.status(404).json({ error: `Production batch ${batchNumber} not found` });
    return;
  }

  const inspectionDate = parseDate(data.inspectionDate);
  if (!inspectionDate) {
    res.status(400).json({ error: "Invalid inspection date" });
    return;
  }

  const inspection = await prisma.qCInspection.create({
    data: {
      batchNumber,
      qcResult: data.qcResult,
      inspectorName: data.inspectorName,
      inspectionDate,
      qcRemarks: data.qcRemarks ?? null,
    },
    include: inspectionInclude,
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "CREATE",
        entityType: "QCInspection",
        entityId: inspection.id,
        newValues: { batchNumber, qcResult: data.qcResult },
      },
    });
  }

  if (data.qcResult === "FAIL") {
    await notifyQcFailed({
      batchNumber,
      productType: batch.productType,
      inspectorName: data.inspectorName,
      qcRemarks: data.qcRemarks,
    });
  }

  res.status(201).json({ inspection });
}

export async function updateQcInspection(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateInspectionSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.qCInspection.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "QC inspection not found" });
    return;
  }

  const data = parsed.data;

  const inspection = await prisma.qCInspection.update({
    where: { id },
    data: {
      ...(data.qcResult !== undefined && { qcResult: data.qcResult }),
      ...(data.inspectorName !== undefined && { inspectorName: data.inspectorName }),
      ...(data.inspectionDate !== undefined && { inspectionDate: parseDate(data.inspectionDate) }),
      ...(data.qcRemarks !== undefined && { qcRemarks: data.qcRemarks }),
    },
    include: inspectionInclude,
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "UPDATE",
        entityType: "QCInspection",
        entityId: id,
        oldValues: existing,
        newValues: inspection,
      },
    });
  }

  const resultChangedToFail =
    data.qcResult === "FAIL" && existing.qcResult !== "FAIL";

  if (resultChangedToFail) {
    await notifyQcFailed({
      batchNumber: inspection.batchNumber,
      productType: inspection.batch.productType,
      inspectorName: inspection.inspectorName,
      qcRemarks: inspection.qcRemarks,
    });
  }

  res.json({ inspection });
}

export async function attachQcPhotos(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const files = req.files as Express.Multer.File[] | undefined;

  if (!files?.length) {
    res.status(400).json({ error: "No photos uploaded" });
    return;
  }

  const inspection = await prisma.qCInspection.findUnique({ where: { id } });
  if (!inspection) {
    res.status(404).json({ error: "QC inspection not found" });
    return;
  }

  const photos = await prisma.$transaction(
    files.map((file) =>
      prisma.qCInspectionPhoto.create({
        data: {
          inspectionId: id,
          filename: file.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          storagePath: file.path,
          uploadedById: req.user?.id,
        },
      })
    )
  );

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "UPLOAD",
        entityType: "QCInspectionPhoto",
        entityId: id,
        newValues: { photoCount: photos.length },
      },
    });
  }

  res.status(201).json({ photos });
}

export async function serveQcPhoto(req: Request, res: Response): Promise<void> {
  const { photoId } = req.params;

  const photo = await prisma.qCInspectionPhoto.findUnique({ where: { id: photoId } });

  if (!photo || !existsSync(photo.storagePath)) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }

  res.setHeader("Content-Type", photo.mimetype);
  res.setHeader("Content-Disposition", `inline; filename="${photo.originalName}"`);
  res.sendFile(photo.storagePath);
}
