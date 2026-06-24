import type { Request, Response } from "express";
import { z } from "zod";
import {
  buildTimeline,
  searchTraceabilityReferences,
} from "../lib/traceability-timeline.js";
import { renderTraceabilityPdf } from "../lib/traceability-pdf.js";

const querySchema = z.object({
  q: z.string().min(1),
});

export async function searchTraceability(req: Request, res: Response): Promise<void> {
  const parsed = querySchema.safeParse({ q: req.query.q });
  if (!parsed.success) {
    res.status(400).json({ error: "Query parameter q is required" });
    return;
  }

  const hits = await searchTraceabilityReferences(parsed.data.q);
  res.json({ hits });
}

export async function getTimeline(req: Request, res: Response): Promise<void> {
  const parsed = querySchema.safeParse({ q: req.query.q });
  if (!parsed.success) {
    res.status(400).json({ error: "Query parameter q is required" });
    return;
  }

  const timeline = await buildTimeline(parsed.data.q);
  if (!timeline) {
    res.status(404).json({ error: "No traceability record found for this search" });
    return;
  }

  res.json({ timeline });
}

export async function exportTimelinePdf(req: Request, res: Response): Promise<void> {
  const parsed = querySchema.safeParse({ q: req.query.q });
  if (!parsed.success) {
    res.status(400).json({ error: "Query parameter q is required" });
    return;
  }

  const timeline = await buildTimeline(parsed.data.q);
  if (!timeline) {
    res.status(404).json({ error: "No traceability record found for this search" });
    return;
  }

  const pdf = await renderTraceabilityPdf(timeline);
  const safeName = timeline.referenceId.replace(/[^a-zA-Z0-9-_]/g, "_");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="traceability-${safeName}.pdf"`
  );
  res.send(pdf);
}
