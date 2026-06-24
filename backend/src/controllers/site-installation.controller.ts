import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { existsSync } from "node:fs";
import { prisma } from "../lib/prisma.js";
import {
  getDispatchTotalQuantity,
  validateSiteInstallation,
  validateSiteInstallationUpdate,
} from "../lib/site-installation.js";

const createInstallationSchema = z.object({
  dispatchNoteNumber: z.string().min(1),
  siteReceiptDate: z.string().min(1),
  installationDate: z.string().min(1),
  installerEpcPartner: z.string().min(1),
  quantityInstalled: z.coerce.number().positive(),
});

const updateInstallationSchema = z.object({
  siteReceiptDate: z.string().optional(),
  installationDate: z.string().optional(),
  installerEpcPartner: z.string().min(1).optional(),
  quantityInstalled: z.coerce.number().positive().optional(),
});

function parseDate(value?: string | null) {
  return value ? new Date(value) : null;
}

const installationInclude = {
  dispatch: {
    select: {
      dispatchNoteNumber: true,
      dispatchDate: true,
      projectName: true,
      clientName: true,
      siteLocation: true,
      vehicleNumber: true,
      transporterName: true,
      batchLines: {
        select: {
          batchNumber: true,
          quantityDispatched: true,
          batch: { select: { productType: true } },
        },
      },
    },
  },
  photos: { orderBy: { createdAt: "asc" as const } },
  _count: { select: { photos: true } },
};

function mapInstallation(
  row: Prisma.SiteInstallationGetPayload<{ include: typeof installationInclude }>
) {
  const totalDispatched = row.dispatch.batchLines.reduce(
    (sum, line) => sum + Number(line.quantityDispatched),
    0
  );

  return {
    id: row.id,
    dispatchNoteNumber: row.dispatchNoteNumber,
    siteReceiptDate: row.siteReceiptDate,
    installationDate: row.installationDate,
    installerEpcPartner: row.installerEpcPartner,
    quantityInstalled: Number(row.quantityInstalled),
    totalDispatched,
    photoCount: row._count.photos,
    photos: row.photos,
    dispatch: {
      ...row.dispatch,
      batchLines: row.dispatch.batchLines.map((line) => ({
        batchNumber: line.batchNumber,
        quantityDispatched: Number(line.quantityDispatched),
        productType: line.batch.productType,
      })),
      totalQuantityDispatched: totalDispatched,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getSiteInstallationStats(_req: Request, res: Response): Promise<void> {
  const [totalInstallations, pendingDispatches, photoCount] = await Promise.all([
    prisma.siteInstallation.count(),
    prisma.siteDispatch.count({ where: { siteInstallation: null } }),
    prisma.siteInstallationPhoto.count(),
  ]);

  const qtyAgg = await prisma.siteInstallation.aggregate({
    _sum: { quantityInstalled: true },
  });

  res.json({
    stats: {
      totalInstallations,
      pendingDispatches,
      totalQuantityInstalled: Number(qtyAgg._sum.quantityInstalled ?? 0),
      totalPhotos: photoCount,
    },
  });
}

export async function listPendingDispatches(_req: Request, res: Response): Promise<void> {
  const dispatches = await prisma.siteDispatch.findMany({
    where: { siteInstallation: null },
    include: {
      batchLines: {
        include: {
          batch: {
            select: {
              batchNumber: true,
              productType: true,
              quantityProduced: true,
            },
          },
        },
      },
    },
    orderBy: { dispatchDate: "desc" },
  });

  const pending = await Promise.all(
    dispatches.map(async (d) => {
      const totalDispatched = await getDispatchTotalQuantity(d.dispatchNoteNumber);
      return {
        dispatchNoteNumber: d.dispatchNoteNumber,
        dispatchDate: d.dispatchDate,
        projectName: d.projectName,
        clientName: d.clientName,
        siteLocation: d.siteLocation,
        vehicleNumber: d.vehicleNumber,
        transporterName: d.transporterName,
        totalQuantityDispatched: totalDispatched,
        batchLines: d.batchLines.map((line) => ({
          batchNumber: line.batchNumber,
          quantityDispatched: Number(line.quantityDispatched),
          productType: line.batch.productType,
        })),
      };
    })
  );

  res.json({ pending });
}

export async function listSiteInstallations(req: Request, res: Response): Promise<void> {
  const search = (req.query.search as string)?.trim();
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const where: Prisma.SiteInstallationWhereInput = {};

  if (search) {
    where.OR = [
      { dispatchNoteNumber: { contains: search, mode: "insensitive" } },
      { installerEpcPartner: { contains: search, mode: "insensitive" } },
      {
        dispatch: {
          OR: [
            { projectName: { contains: search, mode: "insensitive" } },
            { clientName: { contains: search, mode: "insensitive" } },
            { siteLocation: { contains: search, mode: "insensitive" } },
          ],
        },
      },
    ];
  }

  if (from || to) {
    where.installationDate = {};
    if (from) where.installationDate.gte = new Date(from);
    if (to) where.installationDate.lte = new Date(to);
  }

  const rows = await prisma.siteInstallation.findMany({
    where,
    include: installationInclude,
    orderBy: { installationDate: "desc" },
  });

  res.json({ installations: rows.map(mapInstallation) });
}

export async function getSiteInstallation(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const row = await prisma.siteInstallation.findUnique({
    where: { id },
    include: installationInclude,
  });

  if (!row) {
    res.status(404).json({ error: "Site installation not found" });
    return;
  }

  res.json({ installation: mapInstallation(row) });
}

export async function getSiteInstallationByDispatch(req: Request, res: Response): Promise<void> {
  const dispatchNoteNumber = req.params.dispatchNoteNumber.toUpperCase();

  const row = await prisma.siteInstallation.findUnique({
    where: { dispatchNoteNumber },
    include: installationInclude,
  });

  if (!row) {
    res.status(404).json({ error: "No site installation for this dispatch note" });
    return;
  }

  res.json({ installation: mapInstallation(row) });
}

export async function createSiteInstallation(req: Request, res: Response): Promise<void> {
  const parsed = createInstallationSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const dispatchNoteNumber = data.dispatchNoteNumber.toUpperCase();

  const validation = await validateSiteInstallation(dispatchNoteNumber, data.quantityInstalled);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const siteReceiptDate = parseDate(data.siteReceiptDate);
  const installationDate = parseDate(data.installationDate);

  if (!siteReceiptDate || !installationDate) {
    res.status(400).json({ error: "Invalid site receipt or installation date" });
    return;
  }

  const row = await prisma.siteInstallation.create({
    data: {
      dispatchNoteNumber,
      siteReceiptDate,
      installationDate,
      installerEpcPartner: data.installerEpcPartner,
      quantityInstalled: data.quantityInstalled,
    },
    include: installationInclude,
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "CREATE",
        entityType: "SiteInstallation",
        entityId: row.id,
        newValues: { dispatchNoteNumber, quantityInstalled: data.quantityInstalled },
      },
    });
  }

  res.status(201).json({ installation: mapInstallation(row) });
}

export async function updateSiteInstallation(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateInstallationSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = await prisma.siteInstallation.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Site installation not found" });
    return;
  }

  const data = parsed.data;

  if (data.quantityInstalled !== undefined) {
    const validation = await validateSiteInstallationUpdate(
      id,
      existing.dispatchNoteNumber,
      data.quantityInstalled
    );
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
  }

  const siteReceiptDate = data.siteReceiptDate ? parseDate(data.siteReceiptDate) : undefined;
  const installationDate = data.installationDate ? parseDate(data.installationDate) : undefined;

  if (data.siteReceiptDate && !siteReceiptDate) {
    res.status(400).json({ error: "Invalid site receipt date" });
    return;
  }
  if (data.installationDate && !installationDate) {
    res.status(400).json({ error: "Invalid installation date" });
    return;
  }

  const row = await prisma.siteInstallation.update({
    where: { id },
    data: {
      ...(siteReceiptDate ? { siteReceiptDate } : {}),
      ...(installationDate ? { installationDate } : {}),
      ...(data.installerEpcPartner ? { installerEpcPartner: data.installerEpcPartner } : {}),
      ...(data.quantityInstalled !== undefined
        ? { quantityInstalled: data.quantityInstalled }
        : {}),
    },
    include: installationInclude,
  });

  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "UPDATE",
        entityType: "SiteInstallation",
        entityId: id,
        newValues: data as Prisma.InputJsonValue,
      },
    });
  }

  res.json({ installation: mapInstallation(row) });
}

export async function attachSiteInstallationPhotos(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const files = req.files as Express.Multer.File[] | undefined;

  if (!files?.length) {
    res.status(400).json({ error: "No photos uploaded" });
    return;
  }

  const installation = await prisma.siteInstallation.findUnique({ where: { id } });
  if (!installation) {
    res.status(404).json({ error: "Site installation not found" });
    return;
  }

  const photos = await prisma.$transaction(
    files.map((file) =>
      prisma.siteInstallationPhoto.create({
        data: {
          installationId: id,
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
        entityType: "SiteInstallationPhoto",
        entityId: id,
        newValues: { photoCount: photos.length },
      },
    });
  }

  res.status(201).json({ photos });
}

export async function serveSiteInstallationPhoto(req: Request, res: Response): Promise<void> {
  const { photoId } = req.params;

  const photo = await prisma.siteInstallationPhoto.findUnique({ where: { id: photoId } });

  if (!photo || !existsSync(photo.storagePath)) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }

  res.setHeader("Content-Type", photo.mimetype);
  res.setHeader("Content-Disposition", `inline; filename="${photo.originalName}"`);
  res.sendFile(photo.storagePath);
}
