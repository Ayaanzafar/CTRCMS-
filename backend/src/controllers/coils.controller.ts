import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { prisma } from "../lib/prisma.js";
import {
  CRITICAL_COIL_FIELDS,
  getCoilUsage,
} from "../lib/coil-usage.js";

const coilBodySchema = z.object({
  coilNumber: z.string().min(1).max(50),
  grade: z.string().min(1),
  coating: z.string().min(1),
  size: z.string().min(1),
  weight: z.coerce.number().positive(),
  supplier: z.string().min(1).optional(),
  mtcNumber: z.string().optional().nullable(),
  invoiceNumber: z.string().optional().nullable(),
  amnsDispatchDate: z.string().optional().nullable(),
  vehicleNumber: z.string().optional().nullable(),
  transporterName: z.string().optional().nullable(),
  receiptDateSlitter: z.string().optional().nullable(),
  receivingConditionRemarks: z.string().optional().nullable(),
});

function parseDate(value?: string | null) {
  return value ? new Date(value) : null;
}

function coilSnapshot(coil: {
  coilNumber: string;
  grade: string;
  coating: string;
  size: string;
  weight: Prisma.Decimal;
  supplier: string;
  mtcNumber: string | null;
  invoiceNumber: string | null;
  amnsDispatchDate: Date | null;
  vehicleNumber: string | null;
  transporterName: string | null;
  receiptDateSlitter: Date | null;
  receivingConditionRemarks: string | null;
  status: string;
}) {
  return {
    coilNumber: coil.coilNumber,
    grade: coil.grade,
    coating: coil.coating,
    size: coil.size,
    weight: Number(coil.weight),
    supplier: coil.supplier,
    mtcNumber: coil.mtcNumber,
    invoiceNumber: coil.invoiceNumber,
    amnsDispatchDate: coil.amnsDispatchDate?.toISOString() ?? null,
    vehicleNumber: coil.vehicleNumber,
    transporterName: coil.transporterName,
    receiptDateSlitter: coil.receiptDateSlitter?.toISOString() ?? null,
    receivingConditionRemarks: coil.receivingConditionRemarks,
    status: coil.status,
  };
}

const coilInclude = {
  documents: { select: { id: true, documentType: true, originalName: true } },
  _count: { select: { documents: true, slittingRecords: true } },
} as const;

const COIL_SORT_FIELDS = [
  "createdAt",
  "coilNumber",
  "amnsDispatchDate",
  "receiptDateSlitter",
  "grade",
] as const;

type CoilSortField = (typeof COIL_SORT_FIELDS)[number];

function buildCoilListWhere(req: Request): Prisma.CoilWhereInput {
  const search = (req.query.search as string)?.trim();
  const grade = (req.query.grade as string)?.trim();
  const supplier = (req.query.supplier as string)?.trim();
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const includeArchived = req.query.includeArchived === "true";
  const activeOnly = req.query.activeOnly === "true";
  const quickFilter = (req.query.quickFilter as string)?.trim();

  const where: Prisma.CoilWhereInput = {};

  if (!includeArchived || activeOnly) {
    where.status = "ACTIVE";
  }

  if (search) {
    where.OR = [
      { coilNumber: { contains: search, mode: "insensitive" } },
      { mtcNumber: { contains: search, mode: "insensitive" } },
      { invoiceNumber: { contains: search, mode: "insensitive" } },
    ];
  }

  if (grade) where.grade = { contains: grade, mode: "insensitive" };
  if (supplier) where.supplier = { contains: supplier, mode: "insensitive" };

  if (from || to) {
    where.amnsDispatchDate = {};
    if (from) where.amnsDispatchDate.gte = new Date(from);
    if (to) where.amnsDispatchDate.lte = new Date(to);
  }

  if (quickFilter === "hasDocs") {
    where.documents = { some: {} };
  } else if (quickFilter === "inTrace") {
    where.slittingRecords = { some: {} };
  } else if (quickFilter === "missingMtc") {
    where.documents = { none: { documentType: "MTC" } };
  }

  return where;
}

export async function getCoilStats(req: Request, res: Response): Promise<void> {
  const includeArchived = req.query.includeArchived === "true";
  const baseWhere: Prisma.CoilWhereInput = includeArchived ? {} : { status: "ACTIVE" };

  const [total, active, archived, inTrace, withDocs] = await Promise.all([
    prisma.coil.count({ where: baseWhere }),
    prisma.coil.count({ where: { ...baseWhere, status: "ACTIVE" } }),
    prisma.coil.count({ where: { status: "ARCHIVED" } }),
    prisma.coil.count({
      where: { ...baseWhere, slittingRecords: { some: {} } },
    }),
    prisma.coil.count({
      where: { ...baseWhere, documents: { some: {} } },
    }),
  ]);

  res.json({
    stats: { total, active, archived, inTrace, withDocs },
  });
}

export async function listCoils(req: Request, res: Response): Promise<void> {
  const where = buildCoilListWhere(req);

  const sortByParam = (req.query.sortBy as string)?.trim() || "createdAt";
  const sortBy: CoilSortField = COIL_SORT_FIELDS.includes(sortByParam as CoilSortField)
    ? (sortByParam as CoilSortField)
    : "createdAt";
  const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";

  const limitParam = req.query.limit ? Number(req.query.limit) : undefined;
  const offsetParam = req.query.offset ? Number(req.query.offset) : 0;
  const limit =
    limitParam !== undefined && !Number.isNaN(limitParam)
      ? Math.min(Math.max(limitParam, 1), 100)
      : undefined;

  const [coils, total] = await Promise.all([
    prisma.coil.findMany({
      where,
      include: coilInclude,
      orderBy: { [sortBy]: sortOrder },
      ...(limit !== undefined ? { take: limit, skip: offsetParam } : {}),
    }),
    prisma.coil.count({ where }),
  ]);

  res.json({
    coils,
    total,
    ...(limit !== undefined ? { limit, offset: offsetParam } : {}),
  });
}

export async function getCoilAuditLogs(req: Request, res: Response): Promise<void> {
  const { coilNumber } = req.params;
  const limit = Math.min(Number(req.query.limit) || 10, 25);

  const coil = await prisma.coil.findUnique({ where: { coilNumber } });
  if (!coil) {
    res.status(404).json({ error: "Coil not found" });
    return;
  }

  const documents = await prisma.coilDocument.findMany({
    where: { coilNumber },
    select: { id: true },
  });
  const documentIds = documents.map((d) => d.id);

  const logs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: "Coil", entityId: coilNumber },
        ...(documentIds.length > 0
          ? [{ entityType: "CoilDocument", entityId: { in: documentIds } }]
          : []),
      ],
    },
    include: {
      user: { select: { fullName: true, email: true, role: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  res.json({
    logs: logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      oldValues: log.oldValues,
      newValues: log.newValues,
      createdAt: log.createdAt,
      user: log.user,
    })),
  });
}

export async function getCoil(req: Request, res: Response): Promise<void> {
  const { coilNumber } = req.params;

  const coil = await prisma.coil.findUnique({
    where: { coilNumber },
    include: {
      documents: { orderBy: { createdAt: "desc" } },
      slittingRecords: { orderBy: { slittingDate: "desc" } },
    },
  });

  if (!coil) {
    res.status(404).json({ error: "Coil not found" });
    return;
  }

  const usage = await getCoilUsage(coilNumber);

  res.json({ coil, usage });
}

export async function getCoilUsageHandler(req: Request, res: Response): Promise<void> {
  const { coilNumber } = req.params;
  const usage = await getCoilUsage(coilNumber);

  if (!usage) {
    res.status(404).json({ error: "Coil not found" });
    return;
  }

  res.json({ usage });
}

export async function createCoil(req: Request, res: Response): Promise<void> {
  const parsed = coilBodySchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const coilNumber = data.coilNumber.toUpperCase();

  const existing = await prisma.coil.findUnique({ where: { coilNumber } });
  if (existing) {
    res.status(409).json({ error: `Coil ${coilNumber} already exists` });
    return;
  }

  const coil = await prisma.coil.create({
    data: {
      coilNumber,
      grade: data.grade,
      coating: data.coating,
      size: data.size,
      weight: data.weight,
      supplier: data.supplier ?? "AMNS (Hazira Plant)",
      mtcNumber: data.mtcNumber ?? null,
      invoiceNumber: data.invoiceNumber ?? null,
      amnsDispatchDate: parseDate(data.amnsDispatchDate),
      vehicleNumber: data.vehicleNumber ?? null,
      transporterName: data.transporterName ?? null,
      receiptDateSlitter: parseDate(data.receiptDateSlitter),
      receivingConditionRemarks: data.receivingConditionRemarks ?? null,
    },
    include: { documents: true },
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "CREATE",
        entityType: "Coil",
        entityId: coil.coilNumber,
        newValues: coilSnapshot(coil),
      },
    });
  }

  res.status(201).json({ coil });
}

function criticalFieldChanged(
  field: (typeof CRITICAL_COIL_FIELDS)[number],
  existing: {
    grade: string;
    coating: string;
    size: string;
    weight: Prisma.Decimal;
    mtcNumber: string | null;
  },
  data: z.infer<typeof coilBodySchema>
): boolean {
  if (data[field] === undefined) return false;

  if (field === "weight") {
    return Number(existing.weight) !== data.weight;
  }

  if (field === "mtcNumber") {
    return (data.mtcNumber ?? null) !== existing.mtcNumber;
  }

  return data[field] !== existing[field];
}

export async function updateCoil(req: Request, res: Response): Promise<void> {
  const { coilNumber } = req.params;
  const parsed = coilBodySchema.partial().omit({ coilNumber: true }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.coil.findUnique({ where: { coilNumber } });
  if (!existing) {
    res.status(404).json({ error: "Coil not found" });
    return;
  }

  const usage = await getCoilUsage(coilNumber);
  const data = parsed.data;

  if (usage && !usage.canEditCriticalFields) {
    const lockedChanges = CRITICAL_COIL_FIELDS.filter((field) =>
      criticalFieldChanged(field, existing, data)
    );

    if (lockedChanges.length > 0) {
      res.status(409).json({
        error:
          "Traceability-critical fields cannot be changed after this coil is used in slitting or downstream processes.",
        lockedFields: lockedChanges,
        usage,
      });
      return;
    }
  }

  const coil = await prisma.coil.update({
    where: { coilNumber },
    data: {
      ...(data.grade !== undefined && { grade: data.grade }),
      ...(data.coating !== undefined && { coating: data.coating }),
      ...(data.size !== undefined && { size: data.size }),
      ...(data.weight !== undefined && { weight: data.weight }),
      ...(data.supplier !== undefined && { supplier: data.supplier }),
      ...(data.mtcNumber !== undefined && { mtcNumber: data.mtcNumber }),
      ...(data.invoiceNumber !== undefined && { invoiceNumber: data.invoiceNumber }),
      ...(data.amnsDispatchDate !== undefined && {
        amnsDispatchDate: parseDate(data.amnsDispatchDate),
      }),
      ...(data.vehicleNumber !== undefined && { vehicleNumber: data.vehicleNumber }),
      ...(data.transporterName !== undefined && { transporterName: data.transporterName }),
      ...(data.receiptDateSlitter !== undefined && {
        receiptDateSlitter: parseDate(data.receiptDateSlitter),
      }),
      ...(data.receivingConditionRemarks !== undefined && {
        receivingConditionRemarks: data.receivingConditionRemarks,
      }),
    },
    include: { documents: true },
  });

  if (req.user) {
    const oldSnapshot = coilSnapshot(existing);
    const newSnapshot = coilSnapshot(coil);
    const changedOld: Record<string, unknown> = {};
    const changedNew: Record<string, unknown> = {};

    for (const key of Object.keys(newSnapshot) as Array<keyof typeof newSnapshot>) {
      if (oldSnapshot[key] !== newSnapshot[key]) {
        changedOld[key] = oldSnapshot[key];
        changedNew[key] = newSnapshot[key];
      }
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "UPDATE",
        entityType: "Coil",
        entityId: coil.coilNumber,
        oldValues: changedOld,
        newValues: changedNew,
      },
    });
  }

  res.json({ coil, usage: await getCoilUsage(coilNumber) });
}

export async function deleteCoil(req: Request, res: Response): Promise<void> {
  const { coilNumber } = req.params;

  const existing = await prisma.coil.findUnique({ where: { coilNumber } });
  if (!existing) {
    res.status(404).json({ error: "Coil not found" });
    return;
  }

  const usage = await getCoilUsage(coilNumber);
  if (!usage?.canDelete) {
    res.status(409).json({
      error:
        "This coil is already part of traceability. It cannot be deleted. You can archive it instead.",
      usage,
    });
    return;
  }

  await prisma.coil.delete({ where: { coilNumber } });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "DELETE",
        entityType: "Coil",
        entityId: coilNumber,
        oldValues: coilSnapshot(existing),
      },
    });
  }

  res.json({ message: "Coil deleted", coilNumber });
}

export async function archiveCoil(req: Request, res: Response): Promise<void> {
  const { coilNumber } = req.params;

  const existing = await prisma.coil.findUnique({ where: { coilNumber } });
  if (!existing) {
    res.status(404).json({ error: "Coil not found" });
    return;
  }

  const usage = await getCoilUsage(coilNumber);

  if (existing.status === "ARCHIVED") {
    res.status(400).json({ error: "Coil is already archived" });
    return;
  }

  if (!usage?.canArchive) {
    res.status(400).json({
      error: usage?.canDelete
        ? "This coil has no linked traceability records. Delete it instead of archiving."
        : "This coil cannot be archived.",
      usage,
    });
    return;
  }

  const coil = await prisma.coil.update({
    where: { coilNumber },
    data: {
      status: "ARCHIVED",
      archivedAt: new Date(),
      archivedById: req.user?.id ?? null,
    },
    include: coilInclude,
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "ARCHIVE",
        entityType: "Coil",
        entityId: coil.coilNumber,
        oldValues: { status: "ACTIVE" },
        newValues: { status: "ARCHIVED", archivedAt: coil.archivedAt?.toISOString() },
      },
    });
  }

  res.json({ coil, usage: await getCoilUsage(coilNumber) });
}

export async function attachCoilDocument(req: Request, res: Response): Promise<void> {
  const { coilNumber } = req.params;
  const documentType = (req.body.documentType as string) || "MTC";

  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const coil = await prisma.coil.findUnique({ where: { coilNumber } });
  if (!coil) {
    res.status(404).json({ error: "Coil not found" });
    return;
  }

  const doc = await prisma.coilDocument.create({
    data: {
      coilNumber,
      documentType: documentType as "MTC" | "INVOICE" | "OTHER",
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      storagePath: req.file.path,
      uploadedById: req.user?.id,
    },
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "CREATE",
        entityType: "CoilDocument",
        entityId: doc.id,
        newValues: {
          coilNumber,
          documentType: doc.documentType,
          originalName: doc.originalName,
        },
      },
    });
  }

  res.status(201).json({ document: doc });
}

export async function deleteCoilDocument(req: Request, res: Response): Promise<void> {
  const { documentId } = req.params;

  const doc = await prisma.coilDocument.findUnique({ where: { id: documentId } });

  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const snapshot = {
    coilNumber: doc.coilNumber,
    documentType: doc.documentType,
    originalName: doc.originalName,
    mimetype: doc.mimetype,
    size: doc.size,
  };

  await prisma.coilDocument.delete({ where: { id: documentId } });

  if (existsSync(doc.storagePath)) {
    try {
      await unlink(doc.storagePath);
    } catch {
      /* file may already be missing on disk */
    }
  }

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "DELETE",
        entityType: "CoilDocument",
        entityId: documentId,
        oldValues: snapshot,
      },
    });
  }

  res.json({ message: "Document removed", documentId, coilNumber: doc.coilNumber });
}

export async function serveCoilDocument(req: Request, res: Response): Promise<void> {
  const { documentId } = req.params;

  const doc = await prisma.coilDocument.findUnique({ where: { id: documentId } });

  if (!doc || !existsSync(doc.storagePath)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  res.setHeader("Content-Type", doc.mimetype);
  const asDownload = req.query.download === "true" || req.query.download === "1";
  res.setHeader(
    "Content-Disposition",
    `${asDownload ? "attachment" : "inline"}; filename="${doc.originalName}"`
  );
  res.sendFile(doc.storagePath);
}
