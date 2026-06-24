import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  generateNextDispatchNoteNumber,
  validateDispatchBatchLines,
} from "../lib/dispatch.js";
import { computeAvailableQuantity, getBatchDispatchedQuantity } from "../lib/finished-goods.js";

const batchLineSchema = z.object({
  batchNumber: z.string().min(1),
  quantityDispatched: z.coerce.number().positive(),
});

const createDispatchSchema = z.object({
  dispatchNoteNumber: z.string().min(1).max(50).optional(),
  dispatchDate: z.string().min(1),
  vehicleNumber: z.string().optional().nullable(),
  transporterName: z.string().optional().nullable(),
  projectName: z.string().min(1),
  clientName: z.string().min(1),
  siteLocation: z.string().min(1),
  batchLines: z.array(batchLineSchema).min(1),
});

const updateDispatchSchema = z.object({
  dispatchDate: z.string().optional(),
  vehicleNumber: z.string().optional().nullable(),
  transporterName: z.string().optional().nullable(),
  projectName: z.string().min(1).optional(),
  clientName: z.string().min(1).optional(),
  siteLocation: z.string().min(1).optional(),
  batchLines: z.array(batchLineSchema).min(1).optional(),
});

function parseDate(value?: string | null) {
  return value ? new Date(value) : null;
}

const dispatchInclude = {
  batchLines: {
    include: {
      batch: {
        select: {
          batchNumber: true,
          productionOrderNumber: true,
          productType: true,
          quantityProduced: true,
          productionDate: true,
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
  siteInstallation: {
    select: {
      id: true,
      siteReceiptDate: true,
      installationDate: true,
      installerEpcPartner: true,
      quantityInstalled: true,
      _count: { select: { photos: true } },
    },
  },
};

async function mapDispatchRecord(
  dispatch: Awaited<ReturnType<typeof prisma.siteDispatch.findFirst>> & {
    batchLines?: Array<{
      id: string;
      batchNumber: string;
      quantityDispatched: Prisma.Decimal;
      batch?: {
        batchNumber: string;
        productionOrderNumber: string;
        productType: string;
        quantityProduced: Prisma.Decimal;
        productionDate: Date;
      };
    }>;
  }
) {
  const lines = await Promise.all(
    (dispatch!.batchLines ?? []).map(async (line) => {
      const quantityProduced = Number(line.batch?.quantityProduced ?? 0);
      const totalDispatched = await getBatchDispatchedQuantity(line.batchNumber);
      const quantityAvailable = computeAvailableQuantity(quantityProduced, totalDispatched);

      return {
        id: line.id,
        batchNumber: line.batchNumber,
        quantityDispatched: Number(line.quantityDispatched),
        batch: line.batch
          ? {
              ...line.batch,
              quantityProduced: Number(line.batch.quantityProduced),
              quantityDispatched: totalDispatched,
              quantityAvailable,
            }
          : undefined,
      };
    })
  );

  const totalQuantityDispatched = lines.reduce((sum, l) => sum + l.quantityDispatched, 0);

  return {
    dispatchNoteNumber: dispatch!.dispatchNoteNumber,
    dispatchDate: dispatch!.dispatchDate,
    vehicleNumber: dispatch!.vehicleNumber,
    transporterName: dispatch!.transporterName,
    projectName: dispatch!.projectName,
    clientName: dispatch!.clientName,
    siteLocation: dispatch!.siteLocation,
    batchLines: lines,
    batchCount: lines.length,
    totalQuantityDispatched,
    siteInstallation: dispatch!.siteInstallation
      ? {
          id: dispatch!.siteInstallation.id,
          siteReceiptDate: dispatch!.siteInstallation.siteReceiptDate,
          installationDate: dispatch!.siteInstallation.installationDate,
          installerEpcPartner: dispatch!.siteInstallation.installerEpcPartner,
          quantityInstalled: Number(dispatch!.siteInstallation.quantityInstalled),
          photoCount: dispatch!.siteInstallation._count.photos,
        }
      : null,
    createdAt: dispatch!.createdAt,
    updatedAt: dispatch!.updatedAt,
  };
}

export async function getDispatchStats(_req: Request, res: Response): Promise<void> {
  const [totalDispatches, lineAgg, distinctProjects] = await Promise.all([
    prisma.siteDispatch.count(),
    prisma.dispatchBatchLine.aggregate({ _sum: { quantityDispatched: true } }),
    prisma.siteDispatch.findMany({ select: { projectName: true }, distinct: ["projectName"] }),
  ]);

  res.json({
    stats: {
      totalDispatches,
      totalUnitsDispatched: Number(lineAgg._sum.quantityDispatched ?? 0),
      activeProjects: distinctProjects.length,
    },
  });
}

export async function listDispatches(req: Request, res: Response): Promise<void> {
  const search = (req.query.search as string)?.trim();
  const projectName = (req.query.projectName as string)?.trim();
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const where: Prisma.SiteDispatchWhereInput = {};

  if (search) {
    where.OR = [
      { dispatchNoteNumber: { contains: search, mode: "insensitive" } },
      { projectName: { contains: search, mode: "insensitive" } },
      { clientName: { contains: search, mode: "insensitive" } },
      { siteLocation: { contains: search, mode: "insensitive" } },
      { vehicleNumber: { contains: search, mode: "insensitive" } },
      { transporterName: { contains: search, mode: "insensitive" } },
      { batchLines: { some: { batchNumber: { contains: search, mode: "insensitive" } } } },
    ];
  }

  if (projectName) {
    where.projectName = { contains: projectName, mode: "insensitive" };
  }

  if (from || to) {
    where.dispatchDate = {};
    if (from) where.dispatchDate.gte = new Date(from);
    if (to) where.dispatchDate.lte = new Date(to);
  }

  const records = await prisma.siteDispatch.findMany({
    where,
    include: dispatchInclude,
    orderBy: { dispatchDate: "desc" },
  });

  const dispatches = await Promise.all(records.map((d) => mapDispatchRecord(d)));
  res.json({ dispatches });
}

export async function previewDispatchNote(_req: Request, res: Response): Promise<void> {
  const dispatchNoteNumber = await generateNextDispatchNoteNumber();
  res.json({ dispatchNoteNumber });
}

export async function getDispatch(req: Request, res: Response): Promise<void> {
  const dispatchNoteNumber = req.params.dispatchNoteNumber.toUpperCase();

  const dispatch = await prisma.siteDispatch.findUnique({
    where: { dispatchNoteNumber },
    include: dispatchInclude,
  });

  if (!dispatch) {
    res.status(404).json({ error: "Dispatch note not found" });
    return;
  }

  res.json({ dispatch: await mapDispatchRecord(dispatch) });
}

export async function createDispatch(req: Request, res: Response): Promise<void> {
  const parsed = createDispatchSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const dispatchNoteNumber = (
    data.dispatchNoteNumber ?? (await generateNextDispatchNoteNumber())
  ).toUpperCase();

  const existing = await prisma.siteDispatch.findUnique({ where: { dispatchNoteNumber } });
  if (existing) {
    res.status(409).json({ error: `Dispatch note ${dispatchNoteNumber} already exists` });
    return;
  }

  const dispatchDate = parseDate(data.dispatchDate);
  if (!dispatchDate) {
    res.status(400).json({ error: "Invalid dispatch date" });
    return;
  }

  const validation = await validateDispatchBatchLines(data.batchLines);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const dispatch = await prisma.siteDispatch.create({
    data: {
      dispatchNoteNumber,
      dispatchDate,
      vehicleNumber: data.vehicleNumber ?? null,
      transporterName: data.transporterName ?? null,
      projectName: data.projectName,
      clientName: data.clientName,
      siteLocation: data.siteLocation,
      batchLines: {
        create: data.batchLines.map((line) => ({
          batchNumber: line.batchNumber.toUpperCase(),
          quantityDispatched: line.quantityDispatched,
        })),
      },
    },
    include: dispatchInclude,
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "CREATE",
        entityType: "SiteDispatch",
        entityId: dispatchNoteNumber,
        newValues: {
          dispatchNoteNumber,
          batchNumbers: data.batchLines.map((l) => l.batchNumber.toUpperCase()),
        },
      },
    });
  }

  res.status(201).json({ dispatch: await mapDispatchRecord(dispatch) });
}

export async function updateDispatch(req: Request, res: Response): Promise<void> {
  const dispatchNoteNumber = req.params.dispatchNoteNumber.toUpperCase();
  const parsed = updateDispatchSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.siteDispatch.findUnique({
    where: { dispatchNoteNumber },
    include: { batchLines: true },
  });

  if (!existing) {
    res.status(404).json({ error: "Dispatch note not found" });
    return;
  }

  const data = parsed.data;

  if (data.batchLines) {
    const validation = await validateDispatchBatchLines(data.batchLines, dispatchNoteNumber);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
  }

  const dispatchDate = data.dispatchDate ? parseDate(data.dispatchDate) : undefined;
  if (data.dispatchDate && !dispatchDate) {
    res.status(400).json({ error: "Invalid dispatch date" });
    return;
  }

  const dispatch = await prisma.$transaction(async (tx) => {
    if (data.batchLines) {
      await tx.dispatchBatchLine.deleteMany({ where: { dispatchNoteNumber } });
    }

    return tx.siteDispatch.update({
      where: { dispatchNoteNumber },
      data: {
        ...(dispatchDate ? { dispatchDate } : {}),
        ...(data.vehicleNumber !== undefined ? { vehicleNumber: data.vehicleNumber } : {}),
        ...(data.transporterName !== undefined ? { transporterName: data.transporterName } : {}),
        ...(data.projectName ? { projectName: data.projectName } : {}),
        ...(data.clientName ? { clientName: data.clientName } : {}),
        ...(data.siteLocation ? { siteLocation: data.siteLocation } : {}),
        ...(data.batchLines
          ? {
              batchLines: {
                create: data.batchLines.map((line) => ({
                  batchNumber: line.batchNumber.toUpperCase(),
                  quantityDispatched: line.quantityDispatched,
                })),
              },
            }
          : {}),
      },
      include: dispatchInclude,
    });
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "UPDATE",
        entityType: "SiteDispatch",
        entityId: dispatchNoteNumber,
        newValues: data as Prisma.InputJsonValue,
      },
    });
  }

  res.json({ dispatch: await mapDispatchRecord(dispatch) });
}
