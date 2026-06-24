import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { existsSync } from "node:fs";
import { prisma } from "../lib/prisma.js";

const inspectionResultEnum = z.enum(["PENDING", "PASS", "CONDITIONAL", "FAIL"]);

const createReceiptSchema = z.object({
  slitCoilId: z.string().min(1),
  receiptDateSunrack: z.string().min(1),
  storageLocationBin: z.string().min(1),
  inspectionResult: inspectionResultEnum.optional(),
  inspectionRemarks: z.string().optional().nullable(),
  confirmedDispatchNote: z.string().optional().nullable(),
});

const updateReceiptSchema = z.object({
  receiptDateSunrack: z.string().optional(),
  storageLocationBin: z.string().min(1).optional(),
  inspectionResult: inspectionResultEnum.optional(),
  inspectionRemarks: z.string().optional().nullable(),
  confirmedDispatchNote: z.string().optional().nullable(),
});

function parseDate(value?: string | null) {
  return value ? new Date(value) : null;
}

const receiptInclude = {
  slitCoil: {
    select: {
      slitCoilId: true,
      parentCoilNumber: true,
      slitWidthSize: true,
      slitCoilWeight: true,
      slittingDate: true,
      dispatchNote: true,
      vehicleNumber: true,
      transporterName: true,
      parentCoil: { select: { coilNumber: true, grade: true, coating: true } },
    },
  },
  photos: { orderBy: { createdAt: "asc" as const } },
  _count: { select: { photos: true } },
};

export async function listSunrackReceipts(req: Request, res: Response): Promise<void> {
  const search = (req.query.search as string)?.trim();
  const status = (req.query.status as string)?.trim();
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const where: Prisma.SunrackReceiptWhereInput = {};

  if (search) {
    where.OR = [
      { slitCoilId: { contains: search, mode: "insensitive" } },
      { storageLocationBin: { contains: search, mode: "insensitive" } },
      { confirmedDispatchNote: { contains: search, mode: "insensitive" } },
      { slitCoil: { parentCoilNumber: { contains: search, mode: "insensitive" } } },
    ];
  }

  if (status && status !== "ALL") {
    where.inspectionResult = status as Prisma.EnumInspectionResultFilter["equals"];
  }

  if (from || to) {
    where.receiptDateSunrack = {};
    if (from) where.receiptDateSunrack.gte = new Date(from);
    if (to) where.receiptDateSunrack.lte = new Date(to);
  }

  const receipts = await prisma.sunrackReceipt.findMany({
    where,
    include: receiptInclude,
    orderBy: { receiptDateSunrack: "desc" },
  });

  res.json({ receipts });
}

export async function listPendingSlitCoils(req: Request, res: Response): Promise<void> {
  const search = (req.query.search as string)?.trim();

  const where: Prisma.SlittingRecordWhereInput = {
    sunrackReceipt: { is: null },
  };

  if (search) {
    where.OR = [
      { slitCoilId: { contains: search, mode: "insensitive" } },
      { parentCoilNumber: { contains: search, mode: "insensitive" } },
      { dispatchNote: { contains: search, mode: "insensitive" } },
    ];
  }

  const pending = await prisma.slittingRecord.findMany({
    where,
    include: {
      parentCoil: { select: { coilNumber: true, grade: true, coating: true } },
    },
    orderBy: { slittingDate: "desc" },
  });

  res.json({ pending });
}

export async function getSunrackReceiptStats(_req: Request, res: Response): Promise<void> {
  const [total, pendingCount, passCount, failCount] = await Promise.all([
    prisma.sunrackReceipt.count(),
    prisma.slittingRecord.count({ where: { sunrackReceipt: { is: null } } }),
    prisma.sunrackReceipt.count({ where: { inspectionResult: "PASS" } }),
    prisma.sunrackReceipt.count({ where: { inspectionResult: "FAIL" } }),
  ]);

  res.json({
    stats: {
      totalReceipts: total,
      pendingSlitCoils: pendingCount,
      passedInspections: passCount,
      failedInspections: failCount,
    },
  });
}

export async function getSunrackReceipt(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const receipt = await prisma.sunrackReceipt.findUnique({
    where: { id },
    include: receiptInclude,
  });

  if (!receipt) {
    res.status(404).json({ error: "Sunrack receipt not found" });
    return;
  }

  res.json({ receipt });
}

export async function getSunrackReceiptBySlitCoil(req: Request, res: Response): Promise<void> {
  const slitCoilId = req.params.slitCoilId.toUpperCase();

  const receipt = await prisma.sunrackReceipt.findUnique({
    where: { slitCoilId },
    include: receiptInclude,
  });

  if (!receipt) {
    res.status(404).json({ error: "No Sunrack receipt for this slit coil" });
    return;
  }

  res.json({ receipt });
}

export async function createSunrackReceipt(req: Request, res: Response): Promise<void> {
  const parsed = createReceiptSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const slitCoilId = data.slitCoilId.toUpperCase();

  const slitCoil = await prisma.slittingRecord.findUnique({ where: { slitCoilId } });
  if (!slitCoil) {
    res.status(404).json({ error: `Slit coil ${slitCoilId} not found` });
    return;
  }

  const existing = await prisma.sunrackReceipt.findUnique({ where: { slitCoilId } });
  if (existing) {
    res.status(409).json({ error: `Receipt already exists for slit coil ${slitCoilId}` });
    return;
  }

  const receiptDate = parseDate(data.receiptDateSunrack);
  if (!receiptDate) {
    res.status(400).json({ error: "Invalid receipt date" });
    return;
  }

  const receipt = await prisma.sunrackReceipt.create({
    data: {
      slitCoilId,
      receiptDateSunrack: receiptDate,
      storageLocationBin: data.storageLocationBin,
      inspectionResult: data.inspectionResult ?? "PENDING",
      inspectionRemarks: data.inspectionRemarks ?? null,
      confirmedDispatchNote: data.confirmedDispatchNote ?? slitCoil.dispatchNote ?? null,
    },
    include: receiptInclude,
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "CREATE",
        entityType: "SunrackReceipt",
        entityId: receipt.id,
        newValues: { slitCoilId, storageLocationBin: receipt.storageLocationBin },
      },
    });
  }

  res.status(201).json({ receipt });
}

export async function updateSunrackReceipt(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateReceiptSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.sunrackReceipt.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Sunrack receipt not found" });
    return;
  }

  const data = parsed.data;

  const receipt = await prisma.sunrackReceipt.update({
    where: { id },
    data: {
      ...(data.receiptDateSunrack !== undefined && {
        receiptDateSunrack: parseDate(data.receiptDateSunrack),
      }),
      ...(data.storageLocationBin !== undefined && { storageLocationBin: data.storageLocationBin }),
      ...(data.inspectionResult !== undefined && { inspectionResult: data.inspectionResult }),
      ...(data.inspectionRemarks !== undefined && { inspectionRemarks: data.inspectionRemarks }),
      ...(data.confirmedDispatchNote !== undefined && {
        confirmedDispatchNote: data.confirmedDispatchNote,
      }),
    },
    include: receiptInclude,
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "UPDATE",
        entityType: "SunrackReceipt",
        entityId: receipt.id,
        oldValues: existing,
        newValues: receipt,
      },
    });
  }

  res.json({ receipt });
}

export async function attachReceiptPhotos(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const files = req.files as Express.Multer.File[] | undefined;

  if (!files?.length) {
    res.status(400).json({ error: "No photos uploaded" });
    return;
  }

  const receipt = await prisma.sunrackReceipt.findUnique({ where: { id } });
  if (!receipt) {
    res.status(404).json({ error: "Sunrack receipt not found" });
    return;
  }

  const photos = await prisma.$transaction(
    files.map((file) =>
      prisma.sunrackReceiptPhoto.create({
        data: {
          receiptId: id,
          filename: file.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          storagePath:  file.path,
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
        entityType: "SunrackReceiptPhoto",
        entityId: id,
        newValues: { photoCount: photos.length },
      },
    });
  }

  res.status(201).json({ photos });
}

export async function serveReceiptPhoto(req: Request, res: Response): Promise<void> {
  const { photoId } = req.params;

  const photo = await prisma.sunrackReceiptPhoto.findUnique({
    where: { id: photoId },
    include: { receipt: { select: { slitCoilId: true } } },
  });

  if (!photo || !existsSync(photo.storagePath)) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }

  res.setHeader("Content-Type", photo.mimetype);
  res.setHeader("Content-Disposition", `inline; filename="${photo.originalName}"`);
  res.sendFile(photo.storagePath);
}
