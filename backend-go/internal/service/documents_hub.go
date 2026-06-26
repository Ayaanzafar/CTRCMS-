package service

import (
	"context"
	"strings"
	"time"

	"github.com/sunrack/ctrcms-go/internal/db"
)

type DocumentCategory string

const (
	DocCategoryMTC                DocumentCategory = "mtc"
	DocCategoryInvoices           DocumentCategory = "invoices"
	DocCategoryInspectionPhotos   DocumentCategory = "inspection-photos"
	DocCategoryQcReports          DocumentCategory = "qc-reports"
	DocCategoryInstallationPhotos DocumentCategory = "installation-photos"
	DocCategoryComplaintPhotos    DocumentCategory = "complaint-photos"
)

type DocumentKind string

const (
	DocumentKindDocument DocumentKind = "document"
	DocumentKindPhoto    DocumentKind = "photo"
)

var ValidDocumentCategories = []DocumentCategory{
	DocCategoryMTC,
	DocCategoryInvoices,
	DocCategoryInspectionPhotos,
	DocCategoryQcReports,
	DocCategoryInstallationPhotos,
	DocCategoryComplaintPhotos,
}

type DocumentContext struct {
	CoilNumber         *string `json:"coilNumber,omitempty"`
	SlitCoilId         *string `json:"slitCoilId,omitempty"`
	BatchNumber        *string `json:"batchNumber,omitempty"`
	DispatchNoteNumber *string `json:"dispatchNoteNumber,omitempty"`
	ComplaintId        *string `json:"complaintId,omitempty"`
	DocumentType       *string `json:"documentType,omitempty"`
	ProjectName        *string `json:"projectName,omitempty"`
}

type DocumentItem struct {
	ID           string           `json:"id"`
	Category     DocumentCategory `json:"category"`
	Kind         DocumentKind     `json:"kind"`
	OriginalName string           `json:"originalName"`
	Mimetype     string           `json:"mimetype"`
	Size         int32            `json:"size"`
	CreatedAt    string           `json:"createdAt"`
	DownloadURL  string           `json:"downloadUrl"`
	Context      DocumentContext  `json:"context"`
	SourceModule string           `json:"sourceModule"`
	SourcePath   string           `json:"sourcePath"`
	SourceLabel  string           `json:"sourceLabel"`
}

type DocumentStats struct {
	Total      int                       `json:"total"`
	ByCategory map[DocumentCategory]int  `json:"byCategory"`
	Documents  int                       `json:"documents"`
	Photos     int                       `json:"photos"`
}

type ListDocumentsParams struct {
	Search   string
	Category string
	Kind     string
	Limit    int32
	Offset   int32
}

type ListDocumentsResult struct {
	Documents []DocumentItem `json:"documents"`
	Total     int            `json:"total"`
	Limit     int32          `json:"limit"`
	Offset    int32          `json:"offset"`
}

func isPDF(mimetype string) bool {
	return mimetype == "application/pdf"
}

func strPtr(s string) *string {
	return &s
}

func matchesDocumentSearch(item DocumentItem, search string) bool {
	q := strings.ToLower(strings.TrimSpace(search))
	if q == "" {
		return true
	}
	parts := []string{
		item.OriginalName,
		item.SourceLabel,
	}
	if item.Context.CoilNumber != nil {
		parts = append(parts, *item.Context.CoilNumber)
	}
	if item.Context.SlitCoilId != nil {
		parts = append(parts, *item.Context.SlitCoilId)
	}
	if item.Context.BatchNumber != nil {
		parts = append(parts, *item.Context.BatchNumber)
	}
	if item.Context.DispatchNoteNumber != nil {
		parts = append(parts, *item.Context.DispatchNoteNumber)
	}
	if item.Context.ComplaintId != nil {
		parts = append(parts, *item.Context.ComplaintId)
	}
	if item.Context.ProjectName != nil {
		parts = append(parts, *item.Context.ProjectName)
	}
	if item.Context.DocumentType != nil {
		parts = append(parts, *item.Context.DocumentType)
	}
	haystack := strings.ToLower(strings.Join(parts, " "))
	return strings.Contains(haystack, q)
}

func AggregateAllDocuments(ctx context.Context, queries *db.Queries) ([]DocumentItem, error) {
	items := make([]DocumentItem, 0)

	coilDocs, err := queries.ListAllCoilDocumentsForHub(ctx)
	if err != nil {
		return nil, err
	}
	for _, doc := range coilDocs {
		category := DocCategoryMTC
		if doc.DocumentType == "INVOICE" {
			category = DocCategoryInvoices
		}
		docType := doc.DocumentType
		items = append(items, DocumentItem{
			ID:           doc.ID,
			Category:     category,
			Kind:         DocumentKindDocument,
			OriginalName: doc.OriginalName,
			Mimetype:     doc.Mimetype,
			Size:         doc.Size,
			CreatedAt:    doc.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
			DownloadURL:  "/api/coils/documents/" + doc.ID + "/file",
			Context: DocumentContext{
				CoilNumber:   strPtr(doc.CoilNumber),
				DocumentType: &docType,
			},
			SourceModule: "coil-master",
			SourcePath:   "/coil-master",
			SourceLabel:  "Coil " + doc.CoilNumber,
		})
	}

	receiptPhotos, err := queries.ListAllSunrackReceiptPhotosForHub(ctx)
	if err != nil {
		return nil, err
	}
	for _, photo := range receiptPhotos {
		items = append(items, DocumentItem{
			ID:           photo.ID,
			Category:     DocCategoryInspectionPhotos,
			Kind:         DocumentKindPhoto,
			OriginalName: photo.OriginalName,
			Mimetype:     photo.Mimetype,
			Size:         photo.Size,
			CreatedAt:    photo.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
			DownloadURL:  "/api/sunrack-receipts/photos/" + photo.ID + "/file",
			Context: DocumentContext{
				SlitCoilId: strPtr(photo.SlitCoilId),
				CoilNumber: strPtr(photo.ParentCoilNumber),
			},
			SourceModule: "sunrack-receipt",
			SourcePath:   "/sunrack-receipt",
			SourceLabel:  "Receipt " + photo.SlitCoilId,
		})
	}

	qcPhotos, err := queries.ListAllQcPhotosForHub(ctx)
	if err != nil {
		return nil, err
	}
	for _, photo := range qcPhotos {
		kind := DocumentKindPhoto
		if isPDF(photo.Mimetype) {
			kind = DocumentKindDocument
		}
		items = append(items, DocumentItem{
			ID:           photo.ID,
			Category:     DocCategoryQcReports,
			Kind:         kind,
			OriginalName: photo.OriginalName,
			Mimetype:     photo.Mimetype,
			Size:         photo.Size,
			CreatedAt:    photo.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
			DownloadURL:  "/api/qc/photos/" + photo.ID + "/file",
			Context: DocumentContext{
				BatchNumber: strPtr(photo.BatchNumber),
			},
			SourceModule: "qc-inspection",
			SourcePath:   "/qc-inspection",
			SourceLabel:  "QC " + photo.BatchNumber,
		})
	}

	installPhotos, err := queries.ListAllSiteInstallationPhotosForHub(ctx)
	if err != nil {
		return nil, err
	}
	for _, photo := range installPhotos {
		items = append(items, DocumentItem{
			ID:           photo.ID,
			Category:     DocCategoryInstallationPhotos,
			Kind:         DocumentKindPhoto,
			OriginalName: photo.OriginalName,
			Mimetype:     photo.Mimetype,
			Size:         photo.Size,
			CreatedAt:    photo.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
			DownloadURL:  "/api/site-installation/photos/" + photo.ID + "/file",
			Context: DocumentContext{
				DispatchNoteNumber: strPtr(photo.DispatchNoteNumber),
				ProjectName:        strPtr(photo.ProjectName),
			},
			SourceModule: "site-installation",
			SourcePath:   "/site-installation",
			SourceLabel:  "Site " + photo.DispatchNoteNumber,
		})
	}

	complaintPhotos, err := queries.ListAllComplaintPhotosForHub(ctx)
	if err != nil {
		return nil, err
	}
	for _, photo := range complaintPhotos {
		items = append(items, DocumentItem{
			ID:           photo.ID,
			Category:     DocCategoryComplaintPhotos,
			Kind:         DocumentKindPhoto,
			OriginalName: photo.OriginalName,
			Mimetype:     photo.Mimetype,
			Size:         photo.Size,
			CreatedAt:    photo.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
			DownloadURL:  "/api/complaints/photos/" + photo.ID + "/file",
			Context: DocumentContext{
				ComplaintId: strPtr(photo.ComplaintId),
				ProjectName: strPtr(photo.ProjectName),
			},
			SourceModule: "complaint",
			SourcePath:   "/complaints",
			SourceLabel:  "Complaint " + photo.ComplaintId,
		})
	}

	sortDocumentsByCreatedAtDesc(items)
	return items, nil
}

func sortDocumentsByCreatedAtDesc(items []DocumentItem) {
	for i := 0; i < len(items); i++ {
		for j := i + 1; j < len(items); j++ {
			if items[j].CreatedAt > items[i].CreatedAt {
				items[i], items[j] = items[j], items[i]
			}
		}
	}
}

func GetDocumentStats(ctx context.Context, queries *db.Queries) (DocumentStats, error) {
	all, err := AggregateAllDocuments(ctx, queries)
	if err != nil {
		return DocumentStats{}, err
	}

	byCategory := map[DocumentCategory]int{
		DocCategoryMTC:                0,
		DocCategoryInvoices:           0,
		DocCategoryInspectionPhotos:   0,
		DocCategoryQcReports:          0,
		DocCategoryInstallationPhotos: 0,
		DocCategoryComplaintPhotos:    0,
	}
	documents := 0
	photos := 0
	for _, item := range all {
		byCategory[item.Category]++
		if item.Kind == DocumentKindDocument {
			documents++
		} else {
			photos++
		}
	}
	return DocumentStats{
		Total:      len(all),
		ByCategory: byCategory,
		Documents:  documents,
		Photos:     photos,
	}, nil
}

func ListDocuments(ctx context.Context, queries *db.Queries, params ListDocumentsParams) (ListDocumentsResult, error) {
	limit := params.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	offset := params.Offset
	if offset < 0 {
		offset = 0
	}

	items, err := AggregateAllDocuments(ctx, queries)
	if err != nil {
		return ListDocumentsResult{}, err
	}

	filtered := make([]DocumentItem, 0, len(items))
	for _, item := range items {
		if params.Category != "" && params.Category != "ALL" && string(item.Category) != params.Category {
			continue
		}
		if params.Kind != "" && params.Kind != "ALL" && string(item.Kind) != params.Kind {
			continue
		}
		if params.Search != "" && !matchesDocumentSearch(item, params.Search) {
			continue
		}
		filtered = append(filtered, item)
	}

	total := len(filtered)
	end := int(offset) + int(limit)
	if end > total {
		end = total
	}
	start := int(offset)
	if start > total {
		start = total
	}
	page := filtered[start:end]
	if page == nil {
		page = []DocumentItem{}
	}

	return ListDocumentsResult{
		Documents: page,
		Total:     total,
		Limit:     limit,
		Offset:    offset,
	}, nil
}

func ListDocumentsForReference(ctx context.Context, queries *db.Queries, referenceQuery string) ([]DocumentItem, int, error) {
	result, err := ListDocuments(ctx, queries, ListDocumentsParams{
		Search: referenceQuery,
		Limit:  100,
		Offset: 0,
	})
	if err != nil {
		return nil, 0, err
	}
	return result.Documents, result.Total, nil
}

func IsValidDocumentCategory(category string) bool {
	for _, c := range ValidDocumentCategories {
		if string(c) == category {
			return true
		}
	}
	return false
}
