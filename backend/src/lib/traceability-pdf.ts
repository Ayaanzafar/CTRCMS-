import PDFDocument from "pdfkit";
import type { TraceabilityTimeline } from "./traceability-timeline.js";

const STAGE_LABELS: Record<string, string> = {
  COIL_MASTER: "Coil Master",
  SLITTING: "Slitting",
  SUNRACK_RECEIPT: "Sunrack Receipt",
  PRODUCTION: "Production",
  QC: "QC Inspection",
  DISPATCH: "Dispatch",
  SITE_INSTALLATION: "Site Installation",
  COMPLAINT: "Complaint",
  DOCUMENT: "Document",
};

function fieldLines(fields: Record<string, string | number | null>): string[] {
  return Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").trim()}: ${v}`);
}

export function renderTraceabilityPdf(timeline: TraceabilityTimeline): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("CTRCMS Traceability Report", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#555555").text("Sunrack Solar — Coil Traceability System", {
      align: "center",
    });
    doc.moveDown();

    doc.fillColor("#000000").fontSize(11);
    doc.text(`Query: ${timeline.query}`);
    doc.text(`Reference: ${timeline.referenceType} — ${timeline.referenceId}`);
    doc.text(`Root coil(s): ${timeline.rootCoilNumbers.join(", ")}`);
    doc.text(
      `Summary: ${timeline.summary.slitCoilCount} slits · ${timeline.summary.batchCount} batches · ${timeline.summary.dispatchCount} dispatches · ${timeline.summary.complaintCount} complaints · ${timeline.summary.documentCount} attachments`
    );
    doc.moveDown();

    doc.fontSize(13).text("Chronological Timeline", { underline: true });
    doc.moveDown(0.5);

    for (const event of timeline.events) {
      if (doc.y > 720) doc.addPage();

      doc.fontSize(11).fillColor("#0F172A").text(event.title, { continued: false });
      doc.fontSize(9).fillColor("#64748B");
      doc.text(
        `${STAGE_LABELS[event.stage] ?? event.stage}${event.occurredAt ? ` · ${event.occurredAt}` : ""}`
      );

      doc.fillColor("#000000").fontSize(9);
      for (const line of fieldLines(event.fields).slice(0, 8)) {
        doc.text(`  • ${line}`);
      }

      if (event.attachments.length > 0) {
        doc.text(`  • Attachments: ${event.attachments.map((a) => a.label).join(", ")}`);
      }

      doc.moveDown(0.75);
    }

    doc.moveDown();
    doc.fontSize(8).fillColor("#94A3B8").text(
      `Generated ${new Date().toISOString()} · CTRCMS Phase 9 Traceability Report`,
      { align: "center" }
    );

    doc.end();
  });
}
