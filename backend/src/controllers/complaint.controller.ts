import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma, ResolutionStatus, ResponsibleStage } from "@prisma/client";
import { existsSync } from "node:fs";
import { prisma } from "../lib/prisma.js";
import {
  generateNextComplaintId,
  getComplaintTraceability,
  listEligibleComplaintBatches,
  validateComplaintBatchLines,
} from "../lib/complaint.js";
import { notifyComplaintCreated } from "../lib/notifications.js";

const resolutionStatusEnum = z.enum(["OPEN", "UNDER_INVESTIGATION", "CLOSED"]);
const responsibleStageEnum = z.enum([
  "AMNS",
  "SLITTER",
  "SUNRACK_PRODUCTION",
  "TRANSPORT",
  "SITE_HANDLING",
]);

const createComplaintSchema = z.object({
  complaintId: z.string().min(1).max(50).optional(),
  complaintDate: z.string().min(1),
  projectName: z.string().min(1),
  clientName: z.string().min(1),
  siteLocation: z.string().min(1),
  complaintDescription: z.string().min(1),
  rootCauseRemarks: z.string().optional().nullable(),
  responsibleStage: responsibleStageEnum.optional().nullable(),
  batchNumbers: z.array(z.string().min(1)).min(1),
});

const updateComplaintSchema = z.object({
  complaintDate: z.string().optional(),
  projectName: z.string().min(1).optional(),
  clientName: z.string().min(1).optional(),
  siteLocation: z.string().min(1).optional(),
  complaintDescription: z.string().min(1).optional(),
  rootCauseRemarks: z.string().optional().nullable(),
  resolutionStatus: resolutionStatusEnum.optional(),
  resolutionDate: z.string().optional().nullable(),
  responsibleStage: responsibleStageEnum.optional().nullable(),
  batchNumbers: z.array(z.string().min(1)).min(1).optional(),
});

const resolveTraceSchema = z.object({
  batchNumbers: z.array(z.string().min(1)).min(1),
});

function parseDate(value?: string | null) {
  return value ? new Date(value) : null;
}

const complaintInclude = {
  batchLines: {
    include: {
      batch: {
        select: {
          batchNumber: true,
          productType: true,
          productionOrderNumber: true,
          quantityProduced: true,
        },
      },
    },
  },
  photos: { orderBy: { createdAt: "asc" as const } },
  _count: { select: { photos: true } },
};

async function mapComplaint(
  row: Prisma.ComplaintGetPayload<{ include: typeof complaintInclude }>
) {
  const batchNumbers = row.batchLines.map((l) => l.batchNumber);
  const traceability = await getComplaintTraceability(batchNumbers);

  return {
    complaintId: row.complaintId,
    complaintDate: row.complaintDate,
    projectName: row.projectName,
    clientName: row.clientName,
    siteLocation: row.siteLocation,
    complaintDescription: row.complaintDescription,
    rootCauseRemarks: row.rootCauseRemarks,
    resolutionStatus: row.resolutionStatus,
    resolutionDate: row.resolutionDate,
    responsibleStage: row.responsibleStage,
    batchNumbers,
    batchLines: row.batchLines.map((l) => ({
      batchNumber: l.batchNumber,
      productType: l.batch.productType,
      productionOrderNumber: l.batch.productionOrderNumber,
      quantityProduced: Number(l.batch.quantityProduced),
    })),
    linkedCoilNumbers: traceability.linkedCoilNumbers,
    linkedSlitCoilIds: traceability.linkedSlitCoilIds,
    traceability,
    photoCount: row._count.photos,
    photos: row.photos,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getComplaintStats(_req: Request, res: Response): Promise<void> {
  const [total, openCount, investigatingCount, closedCount, photoCount] = await Promise.all([
    prisma.complaint.count(),
    prisma.complaint.count({ where: { resolutionStatus: "OPEN" } }),
    prisma.complaint.count({ where: { resolutionStatus: "UNDER_INVESTIGATION" } }),
    prisma.complaint.count({ where: { resolutionStatus: "CLOSED" } }),
    prisma.complaintPhoto.count(),
  ]);

  res.json({
    stats: {
      totalComplaints: total,
      open: openCount,
      underInvestigation: investigatingCount,
      closed: closedCount,
      totalPhotos: photoCount,
    },
  });
}

export async function listEligibleBatches(_req: Request, res: Response): Promise<void> {
  const batches = await listEligibleComplaintBatches();
  res.json({ batches });
}

export async function resolveTrace(req: Request, res: Response): Promise<void> {
  const parsed = resolveTraceSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const validation = await validateComplaintBatchLines(parsed.data.batchNumbers);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const traceability = await getComplaintTraceability(parsed.data.batchNumbers);
  res.json({ traceability });
}

export async function previewComplaintId(_req: Request, res: Response): Promise<void> {
  const complaintId = await generateNextComplaintId();
  res.json({ complaintId });
}

export async function listComplaints(req: Request, res: Response): Promise<void> {
  const search = (req.query.search as string)?.trim();
  const status = (req.query.status as string)?.trim();
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const where: Prisma.ComplaintWhereInput = {};

  if (search) {
    where.OR = [
      { complaintId: { contains: search, mode: "insensitive" } },
      { projectName: { contains: search, mode: "insensitive" } },
      { clientName: { contains: search, mode: "insensitive" } },
      { siteLocation: { contains: search, mode: "insensitive" } },
      { complaintDescription: { contains: search, mode: "insensitive" } },
      { batchLines: { some: { batchNumber: { contains: search, mode: "insensitive" } } } },
    ];
  }

  if (status && status !== "ALL") {
    where.resolutionStatus = status as ResolutionStatus;
  }

  if (from || to) {
    where.complaintDate = {};
    if (from) where.complaintDate.gte = new Date(from);
    if (to) where.complaintDate.lte = new Date(to);
  }

  const rows = await prisma.complaint.findMany({
    where,
    include: complaintInclude,
    orderBy: { complaintDate: "desc" },
  });

  const complaints = await Promise.all(rows.map(mapComplaint));
  res.json({ complaints });
}

export async function getComplaint(req: Request, res: Response): Promise<void> {
  const complaintId = req.params.complaintId.toUpperCase();

  const row = await prisma.complaint.findUnique({
    where: { complaintId },
    include: complaintInclude,
  });

  if (!row) {
    res.status(404).json({ error: "Complaint not found" });
    return;
  }

  res.json({ complaint: await mapComplaint(row) });
}

export async function createComplaint(req: Request, res: Response): Promise<void> {
  const parsed = createComplaintSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const complaintId = (data.complaintId ?? (await generateNextComplaintId())).toUpperCase();

  const existing = await prisma.complaint.findUnique({ where: { complaintId } });
  if (existing) {
    res.status(409).json({ error: `Complaint ${complaintId} already exists` });
    return;
  }

  const complaintDate = parseDate(data.complaintDate);
  if (!complaintDate) {
    res.status(400).json({ error: "Invalid complaint date" });
    return;
  }

  const batchValidation = await validateComplaintBatchLines(data.batchNumbers);
  if (!batchValidation.ok) {
    res.status(400).json({ error: batchValidation.error });
    return;
  }

  const row = await prisma.complaint.create({
    data: {
      complaintId,
      complaintDate,
      projectName: data.projectName,
      clientName: data.clientName,
      siteLocation: data.siteLocation,
      complaintDescription: data.complaintDescription,
      rootCauseRemarks: data.rootCauseRemarks ?? null,
      responsibleStage: (data.responsibleStage as ResponsibleStage | null) ?? null,
      resolutionStatus: "OPEN",
      batchLines: {
        create: data.batchNumbers.map((b) => ({ batchNumber: b.toUpperCase() })),
      },
    },
    include: complaintInclude,
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "CREATE",
        entityType: "Complaint",
        entityId: complaintId,
        newValues: {
          complaintId,
          batchNumbers: data.batchNumbers.map((b) => b.toUpperCase()),
        },
      },
    });
  }

  await notifyComplaintCreated({
    complaintId,
    projectName: data.projectName,
    clientName: data.clientName,
  });

  res.status(201).json({ complaint: await mapComplaint(row) });
}

export async function updateComplaint(req: Request, res: Response): Promise<void> {
  const complaintId = req.params.complaintId.toUpperCase();
  const parsed = updateComplaintSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.complaint.findUnique({ where: { complaintId } });
  if (!existing) {
    res.status(404).json({ error: "Complaint not found" });
    return;
  }

  const data = parsed.data;

  if (data.batchNumbers) {
    const batchValidation = await validateComplaintBatchLines(data.batchNumbers);
    if (!batchValidation.ok) {
      res.status(400).json({ error: batchValidation.error });
      return;
    }
  }

  const complaintDate = data.complaintDate ? parseDate(data.complaintDate) : undefined;
  if (data.complaintDate && !complaintDate) {
    res.status(400).json({ error: "Invalid complaint date" });
    return;
  }

  let resolutionDate: Date | null | undefined;
  if (data.resolutionDate !== undefined) {
    resolutionDate = data.resolutionDate ? parseDate(data.resolutionDate) : null;
    if (data.resolutionDate && !resolutionDate) {
      res.status(400).json({ error: "Invalid resolution date" });
      return;
    }
  }

  if (data.resolutionStatus === "CLOSED" && resolutionDate === undefined && !existing.resolutionDate) {
    resolutionDate = new Date();
  }

  const row = await prisma.$transaction(async (tx) => {
    if (data.batchNumbers) {
      await tx.complaintBatchLine.deleteMany({ where: { complaintId } });
    }

    return tx.complaint.update({
      where: { complaintId },
      data: {
        ...(complaintDate ? { complaintDate } : {}),
        ...(data.projectName ? { projectName: data.projectName } : {}),
        ...(data.clientName ? { clientName: data.clientName } : {}),
        ...(data.siteLocation ? { siteLocation: data.siteLocation } : {}),
        ...(data.complaintDescription ? { complaintDescription: data.complaintDescription } : {}),
        ...(data.rootCauseRemarks !== undefined
          ? { rootCauseRemarks: data.rootCauseRemarks }
          : {}),
        ...(data.resolutionStatus
          ? { resolutionStatus: data.resolutionStatus as ResolutionStatus }
          : {}),
        ...(resolutionDate !== undefined ? { resolutionDate } : {}),
        ...(data.responsibleStage !== undefined
          ? { responsibleStage: data.responsibleStage as ResponsibleStage | null }
          : {}),
        ...(data.batchNumbers
          ? {
              batchLines: {
                create: data.batchNumbers.map((b) => ({ batchNumber: b.toUpperCase() })),
              },
            }
          : {}),
      },
      include: complaintInclude,
    });
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "UPDATE",
        entityType: "Complaint",
        entityId: complaintId,
        newValues: data as Prisma.InputJsonValue,
      },
    });
  }

  res.json({ complaint: await mapComplaint(row) });
}

export async function attachComplaintPhotos(req: Request, res: Response): Promise<void> {
  const complaintId = req.params.complaintId.toUpperCase();
  const files = req.files as Express.Multer.File[] | undefined;

  if (!files?.length) {
    res.status(400).json({ error: "No photos uploaded" });
    return;
  }

  const complaint = await prisma.complaint.findUnique({ where: { complaintId } });
  if (!complaint) {
    res.status(404).json({ error: "Complaint not found" });
    return;
  }

  const photos = await prisma.$transaction(
    files.map((file) =>
      prisma.complaintPhoto.create({
        data: {
          complaintId,
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
        entityType: "ComplaintPhoto",
        entityId: complaintId,
        newValues: { photoCount: photos.length },
      },
    });
  }

  res.status(201).json({ photos });
}

export async function serveComplaintPhoto(req: Request, res: Response): Promise<void> {
  const { photoId } = req.params;

  const photo = await prisma.complaintPhoto.findUnique({ where: { id: photoId } });

  if (!photo || !existsSync(photo.storagePath)) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }

  res.setHeader("Content-Type", photo.mimetype);
  res.setHeader("Content-Disposition", `inline; filename="${photo.originalName}"`);
  res.sendFile(photo.storagePath);
}
