import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const slitLineSchema = z.object({
  slitWidthSize: z.string().min(1),
  slitCoilWeight: z.coerce.number().positive(),
  slitCoilId: z.string().min(1).max(60).optional(),
});

const batchSlittingSchema = z.object({
  parentCoilNumber: z.string().min(1),
  slittingDate: z.string().min(1),
  slitterLocation: z.string().min(1).optional(),
  dispatchNote: z.string().optional().nullable(),
  vehicleNumber: z.string().optional().nullable(),
  transporterName: z.string().optional().nullable(),
  slitCoils: z.array(slitLineSchema).min(1),
});

const updateSlittingSchema = z.object({
  slitWidthSize: z.string().min(1).optional(),
  slittingDate: z.string().optional(),
  slitCoilWeight: z.coerce.number().positive().optional(),
  slitterLocation: z.string().min(1).optional(),
  dispatchNote: z.string().optional().nullable(),
  vehicleNumber: z.string().optional().nullable(),
  transporterName: z.string().optional().nullable(),
});

function parseDate(value?: string | null) {
  return value ? new Date(value) : null;
}

export async function generateNextSlitCoilId(
  parentCoilNumber: string,
  count = 1
): Promise<string[]> {
  const parent = parentCoilNumber.toUpperCase();
  const existing = await prisma.slittingRecord.findMany({
    where: { parentCoilNumber: parent },
    select: { slitCoilId: true },
    orderBy: { slitCoilId: "desc" },
  });

  let maxSeq = 0;
  const prefix = `${parent}-SC`;
  for (const row of existing) {
    if (row.slitCoilId.startsWith(prefix)) {
      const seq = parseInt(row.slitCoilId.slice(prefix.length), 10);
      if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    ids.push(`${prefix}${String(maxSeq + i).padStart(3, "0")}`);
  }
  return ids;
}

export async function listSlitting(req: Request, res: Response): Promise<void> {
  const search = (req.query.search as string)?.trim();
  const parentCoil = (req.query.parentCoil as string)?.trim();
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const where: Prisma.SlittingRecordWhereInput = {};

  if (parentCoil) {
    where.parentCoilNumber = { equals: parentCoil.toUpperCase(), mode: "insensitive" };
  }

  if (search) {
    where.OR = [
      { slitCoilId: { contains: search, mode: "insensitive" } },
      { parentCoilNumber: { contains: search, mode: "insensitive" } },
      { dispatchNote: { contains: search, mode: "insensitive" } },
      { vehicleNumber: { contains: search, mode: "insensitive" } },
    ];
  }

  if (from || to) {
    where.slittingDate = {};
    if (from) where.slittingDate.gte = new Date(from);
    if (to) where.slittingDate.lte = new Date(to);
  }

  const records = await prisma.slittingRecord.findMany({
    where,
    include: {
      parentCoil: {
        select: { coilNumber: true, grade: true, coating: true },
      },
      sunrackReceipt: {
        select: {
          id: true,
          receiptDateSunrack: true,
          inspectionResult: true,
          storageLocationBin: true,
          _count: { select: { photos: true } },
        },
      },
    },
    orderBy: { slittingDate: "desc" },
  });

  res.json({ records });
}

export async function getSlitting(req: Request, res: Response): Promise<void> {
  const { slitCoilId } = req.params;

  const record = await prisma.slittingRecord.findUnique({
    where: { slitCoilId: slitCoilId.toUpperCase() },
    include: {
      parentCoil: {
        select: {
          coilNumber: true,
          grade: true,
          coating: true,
          size: true,
          weight: true,
          supplier: true,
        },
      },
      sunrackReceipt: {
        include: {
          photos: { orderBy: { createdAt: "asc" } },
        },
      },
      batchConsumptions: {
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
      },
    },
  });

  if (!record) {
    res.status(404).json({ error: "Slitting record not found" });
    return;
  }

  res.json({ record });
}

export async function createSlittingBatch(req: Request, res: Response): Promise<void> {
  const parsed = batchSlittingSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const parentCoilNumber = data.parentCoilNumber.toUpperCase();

  const parent = await prisma.coil.findUnique({ where: { coilNumber: parentCoilNumber } });
  if (!parent) {
    res.status(404).json({ error: `Parent coil ${parentCoilNumber} not found` });
    return;
  }

  if (parent.status === "ARCHIVED") {
    res.status(400).json({
      error: `Parent coil ${parentCoilNumber} is archived and cannot be used for new slitting records`,
    });
    return;
  }

  const needsAutoIds = data.slitCoils.filter((s) => !s.slitCoilId).length;
  const autoIds = needsAutoIds > 0 ? await generateNextSlitCoilId(parentCoilNumber, needsAutoIds) : [];
  let autoIdx = 0;

  const slittingDate = parseDate(data.slittingDate);
  if (!slittingDate) {
    res.status(400).json({ error: "Invalid slitting date" });
    return;
  }

  const created = await prisma.$transaction(async (tx) => {
    const results = [];

    for (const line of data.slitCoils) {
      const slitCoilId = line.slitCoilId
        ? line.slitCoilId.toUpperCase()
        : autoIds[autoIdx++]!;

      const exists = await tx.slittingRecord.findUnique({ where: { slitCoilId } });
      if (exists) {
        throw new Error(`Slit coil ID ${slitCoilId} already exists`);
      }

      const record = await tx.slittingRecord.create({
        data: {
          slitCoilId,
          parentCoilNumber,
          slitWidthSize: line.slitWidthSize,
          slittingDate,
          slitCoilWeight: line.slitCoilWeight,
          slitterLocation: data.slitterLocation ?? "Shiv Sagar Slitter",
          dispatchNote: data.dispatchNote ?? null,
          vehicleNumber: data.vehicleNumber ?? null,
          transporterName: data.transporterName ?? null,
        },
        include: {
          parentCoil: { select: { coilNumber: true, grade: true, coating: true } },
        },
      });

      results.push(record);
    }

    return results;
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "CREATE",
        entityType: "SlittingRecord",
        entityId: parentCoilNumber,
        newValues: {
          parentCoilNumber,
          slitCoilIds: created.map((r) => r.slitCoilId),
        },
      },
    });
  }

  res.status(201).json({ records: created });
}

export async function updateSlitting(req: Request, res: Response): Promise<void> {
  const { slitCoilId } = req.params;
  const parsed = updateSlittingSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.slittingRecord.findUnique({
    where: { slitCoilId: slitCoilId.toUpperCase() },
  });

  if (!existing) {
    res.status(404).json({ error: "Slitting record not found" });
    return;
  }

  const data = parsed.data;

  const record = await prisma.slittingRecord.update({
    where: { slitCoilId: existing.slitCoilId },
    data: {
      ...(data.slitWidthSize !== undefined && { slitWidthSize: data.slitWidthSize }),
      ...(data.slittingDate !== undefined && { slittingDate: parseDate(data.slittingDate) }),
      ...(data.slitCoilWeight !== undefined && { slitCoilWeight: data.slitCoilWeight }),
      ...(data.slitterLocation !== undefined && { slitterLocation: data.slitterLocation }),
      ...(data.dispatchNote !== undefined && { dispatchNote: data.dispatchNote }),
      ...(data.vehicleNumber !== undefined && { vehicleNumber: data.vehicleNumber }),
      ...(data.transporterName !== undefined && { transporterName: data.transporterName }),
    },
    include: {
      parentCoil: { select: { coilNumber: true, grade: true, coating: true } },
    },
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "UPDATE",
        entityType: "SlittingRecord",
        entityId: record.slitCoilId,
        oldValues: existing,
        newValues: record,
      },
    });
  }

  res.json({ record });
}

export async function previewSlitCoilIds(req: Request, res: Response): Promise<void> {
  const parentCoilNumber = (req.query.parentCoilNumber as string)?.trim();
  const count = Math.min(parseInt(req.query.count as string, 10) || 1, 20);

  if (!parentCoilNumber) {
    res.status(400).json({ error: "parentCoilNumber is required" });
    return;
  }

  const ids = await generateNextSlitCoilId(parentCoilNumber.toUpperCase(), count);
  res.json({ slitCoilIds: ids });
}
