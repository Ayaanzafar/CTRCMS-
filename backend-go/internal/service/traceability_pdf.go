package service

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/phpdave11/gofpdf"
)

var stageLabels = map[string]string{
	"COIL_MASTER":       "Coil Master",
	"SLITTING":          "Slitting",
	"SUNRACK_RECEIPT":   "Sunrack Receipt",
	"PRODUCTION":        "Production",
	"QC":                "QC Inspection",
	"DISPATCH":          "Dispatch",
	"SITE_INSTALLATION": "Site Installation",
	"COMPLAINT":         "Complaint",
	"DOCUMENT":          "Document",
}

func fieldLines(fields map[string]interface{}) []string {
	lines := make([]string, 0, len(fields))
	for key, value := range fields {
		if value == nil {
			continue
		}
		s := strings.TrimSpace(fmt.Sprint(value))
		if s == "" {
			continue
		}
		label := camelToWords(key)
		lines = append(lines, fmt.Sprintf("%s: %s", label, s))
	}
	return lines
}

func camelToWords(s string) string {
	re := regexp.MustCompile(`([a-z])([A-Z])`)
	return strings.TrimSpace(re.ReplaceAllString(s, `$1 $2`))
}

func RenderTraceabilityPDF(timeline TraceabilityTimeline) ([]byte, error) {
	doc := gofpdf.New("P", "mm", "A4", "")
	doc.SetMargins(20, 20, 20)
	doc.AddPage()

	doc.SetFont("Helvetica", "B", 18)
	doc.CellFormat(0, 10, "CTRCMS Traceability Report", "", 1, "C", false, 0, "")

	doc.SetFont("Helvetica", "", 10)
	doc.SetTextColor(85, 85, 85)
	doc.CellFormat(0, 6, "Sunrack Solar — Coil Traceability System", "", 1, "C", false, 0, "")
	doc.Ln(4)

	doc.SetTextColor(0, 0, 0)
	doc.SetFont("Helvetica", "", 11)
	doc.CellFormat(0, 6, fmt.Sprintf("Query: %s", timeline.Query), "", 1, "L", false, 0, "")
	doc.CellFormat(0, 6, fmt.Sprintf("Reference: %s — %s", timeline.ReferenceType, timeline.ReferenceID), "", 1, "L", false, 0, "")
	doc.CellFormat(0, 6, fmt.Sprintf("Root coil(s): %s", strings.Join(timeline.RootCoilNumbers, ", ")), "", 1, "L", false, 0, "")
	doc.CellFormat(0, 6, fmt.Sprintf(
		"Summary: %d slits · %d batches · %d dispatches · %d complaints · %d attachments",
		timeline.Summary.SlitCoilCount,
		timeline.Summary.BatchCount,
		timeline.Summary.DispatchCount,
		timeline.Summary.ComplaintCount,
		timeline.Summary.DocumentCount,
	), "", 1, "L", false, 0, "")
	doc.Ln(4)

	doc.SetFont("Helvetica", "B", 13)
	doc.CellFormat(0, 8, "Chronological Timeline", "", 1, "L", false, 0, "")
	doc.Ln(2)

	for _, event := range timeline.Events {
		if doc.GetY() > 250 {
			doc.AddPage()
		}

		doc.SetFont("Helvetica", "B", 11)
		doc.SetTextColor(15, 23, 42)
		doc.CellFormat(0, 6, event.Title, "", 1, "L", false, 0, "")

		stageLabel := stageLabels[string(event.Stage)]
		if stageLabel == "" {
			stageLabel = string(event.Stage)
		}
		subtitle := stageLabel
		if event.OccurredAt != nil {
			subtitle = fmt.Sprintf("%s · %s", stageLabel, *event.OccurredAt)
		}

		doc.SetFont("Helvetica", "", 9)
		doc.SetTextColor(100, 116, 139)
		doc.CellFormat(0, 5, subtitle, "", 1, "L", false, 0, "")

		doc.SetTextColor(0, 0, 0)
		doc.SetFont("Helvetica", "", 9)
		lines := fieldLines(event.Fields)
		if len(lines) > 8 {
			lines = lines[:8]
		}
		for _, line := range lines {
			doc.CellFormat(0, 5, "  • "+line, "", 1, "L", false, 0, "")
		}

		if len(event.Attachments) > 0 {
			labels := make([]string, 0, len(event.Attachments))
			for _, a := range event.Attachments {
				labels = append(labels, a.Label)
			}
			doc.CellFormat(0, 5, fmt.Sprintf("  • Attachments: %s", strings.Join(labels, ", ")), "", 1, "L", false, 0, "")
		}

		doc.Ln(3)
	}

	doc.Ln(4)
	doc.SetFont("Helvetica", "", 8)
	doc.SetTextColor(148, 163, 184)
	doc.CellFormat(0, 5, fmt.Sprintf("Generated %s · CTRCMS Phase 9 Traceability Report", time.Now().UTC().Format(time.RFC3339)), "", 1, "C", false, 0, "")

	var buf bytes.Buffer
	if err := doc.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func SafeTraceabilityFilename(referenceID string) string {
	re := regexp.MustCompile(`[^a-zA-Z0-9-_]`)
	return re.ReplaceAllString(referenceID, "_")
}
