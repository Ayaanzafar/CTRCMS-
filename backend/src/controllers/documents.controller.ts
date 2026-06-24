import type { Request, Response } from "express";
import type { DocumentCategory, DocumentKind } from "../lib/documents.js";
import {
  getDocumentStats,
  listDocuments,
  listDocumentsForReference,
} from "../lib/documents.js";

const CATEGORIES: DocumentCategory[] = [
  "mtc",
  "invoices",
  "inspection-photos",
  "qc-reports",
  "installation-photos",
  "complaint-photos",
];

export async function getDocumentsStats(_req: Request, res: Response): Promise<void> {
  const stats = await getDocumentStats();
  res.json({ stats });
}

export async function listAllDocuments(req: Request, res: Response): Promise<void> {
  const search = (req.query.search as string)?.trim() || (req.query.q as string)?.trim();
  const category = (req.query.category as string)?.trim() as DocumentCategory | "ALL" | undefined;
  const kind = (req.query.kind as string)?.trim() as DocumentKind | "ALL" | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const offset = req.query.offset ? Number(req.query.offset) : undefined;

  if (category && category !== "ALL" && !CATEGORIES.includes(category as DocumentCategory)) {
    res.status(400).json({ error: `Invalid category. Allowed: ${CATEGORIES.join(", ")}` });
    return;
  }

  const result = await listDocuments({
    search,
    category: category ?? "ALL",
    kind: kind ?? "ALL",
    limit,
    offset,
  });

  res.json(result);
}

export async function getDocumentsByReference(req: Request, res: Response): Promise<void> {
  const q = (req.query.q as string)?.trim();
  if (!q) {
    res.status(400).json({ error: "Query parameter q is required" });
    return;
  }

  const documents = await listDocumentsForReference(q);
  res.json({ query: q, documents, total: documents.length });
}
