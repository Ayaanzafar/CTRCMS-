package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sunrack/ctrcms-go/internal/db"
)

type TraceabilityReferenceType string

const (
	RefCoilNumber   TraceabilityReferenceType = "COIL_NUMBER"
	RefSlitCoilID   TraceabilityReferenceType = "SLIT_COIL_ID"
	RefBatchNumber  TraceabilityReferenceType = "BATCH_NUMBER"
	RefDispatchNote TraceabilityReferenceType = "DISPATCH_NOTE"
	RefProjectName  TraceabilityReferenceType = "PROJECT_NAME"
	RefComplaintID  TraceabilityReferenceType = "COMPLAINT_ID"
)

type TimelineStage string

const (
	StageCoilMaster       TimelineStage = "COIL_MASTER"
	StageSlitting         TimelineStage = "SLITTING"
	StageSunrackReceipt   TimelineStage = "SUNRACK_RECEIPT"
	StageProduction       TimelineStage = "PRODUCTION"
	StageQC               TimelineStage = "QC"
	StageDispatch         TimelineStage = "DISPATCH"
	StageSiteInstallation TimelineStage = "SITE_INSTALLATION"
	StageComplaint        TimelineStage = "COMPLAINT"
	StageDocument         TimelineStage = "DOCUMENT"
)

type TimelineAttachment struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Label    string `json:"label"`
	Mimetype string `json:"mimetype"`
	URL      string `json:"url"`
}

type TimelineEvent struct {
	ID          string                 `json:"id"`
	Stage       TimelineStage          `json:"stage"`
	OccurredAt  *string                `json:"occurredAt"`
	Title       string                 `json:"title"`
	EntityType  string                 `json:"entityType"`
	EntityID    string                 `json:"entityId"`
	Fields      map[string]interface{} `json:"fields"`
	Links       map[string]string      `json:"links"`
	Attachments []TimelineAttachment   `json:"attachments"`
}

type TraceabilitySearchHit struct {
	ReferenceType TraceabilityReferenceType `json:"referenceType"`
	ReferenceID   string                    `json:"referenceId"`
	Label         string                    `json:"label"`
	Subtitle      string                    `json:"subtitle"`
}

type TraceabilityTimelineSummary struct {
	SlitCoilCount  int `json:"slitCoilCount"`
	BatchCount     int `json:"batchCount"`
	DispatchCount  int `json:"dispatchCount"`
	ComplaintCount int `json:"complaintCount"`
	DocumentCount  int `json:"documentCount"`
}

type TraceabilityTimeline struct {
	Query           string                      `json:"query"`
	ReferenceType   TraceabilityReferenceType   `json:"referenceType"`
	ReferenceID     string                      `json:"referenceId"`
	RootCoilNumbers []string                    `json:"rootCoilNumbers"`
	Events          []TimelineEvent             `json:"events"`
	Summary         TraceabilityTimelineSummary `json:"summary"`
}

type resolvedReference struct {
	ReferenceType TraceabilityReferenceType
	ReferenceID   string
}

func isoDateFromTimestamp(ts pgtype.Timestamp) *string {
	if !ts.Valid {
		return nil
	}
	s := ts.Time.UTC().Format("2006-01-02")
	return &s
}

func firstNonNilDate(dates ...*string) *string {
	for _, d := range dates {
		if d != nil {
			return d
		}
	}
	return nil
}

func textOrNil(t pgtype.Text) interface{} {
	if !t.Valid {
		return nil
	}
	return t.String
}

func SearchTraceabilityReferences(ctx context.Context, queries *db.Queries, query string, limit int32) ([]TraceabilitySearchHit, error) {
	q := strings.TrimSpace(query)
	if len(q) < 2 {
		return []TraceabilitySearchHit{}, nil
	}
	if limit <= 0 {
		limit = 10
	}

	hits := make([]TraceabilitySearchHit, 0, limit)
	seen := make(map[string]struct{})
	add := func(hit TraceabilitySearchHit) {
		key := string(hit.ReferenceType) + ":" + hit.ReferenceID
		if _, ok := seen[key]; ok || int32(len(hits)) >= limit {
			return
		}
		seen[key] = struct{}{}
		hits = append(hits, hit)
	}

	searchTerm := pgtype.Text{String: q, Valid: true}

	complaints, err := queries.SearchTraceabilityComplaints(ctx, db.SearchTraceabilityComplaintsParams{
		SearchTerm:  searchTerm,
		ResultLimit: limit,
	})
	if err != nil {
		return nil, err
	}
	dispatches, err := queries.SearchTraceabilityDispatches(ctx, db.SearchTraceabilityDispatchesParams{
		SearchTerm:  searchTerm,
		ResultLimit: limit,
	})
	if err != nil {
		return nil, err
	}
	batches, err := queries.SearchTraceabilityBatches(ctx, db.SearchTraceabilityBatchesParams{
		SearchTerm:  searchTerm,
		ResultLimit: limit,
	})
	if err != nil {
		return nil, err
	}
	slits, err := queries.SearchTraceabilitySlits(ctx, db.SearchTraceabilitySlitsParams{
		SearchTerm:  searchTerm,
		ResultLimit: limit,
	})
	if err != nil {
		return nil, err
	}
	coils, err := queries.SearchTraceabilityCoils(ctx, db.SearchTraceabilityCoilsParams{
		SearchTerm:  searchTerm,
		ResultLimit: limit,
	})
	if err != nil {
		return nil, err
	}
	projectsDispatch, err := queries.SearchTraceabilityDispatchesByProject(ctx, db.SearchTraceabilityDispatchesByProjectParams{
		SearchTerm:  searchTerm,
		ResultLimit: limit,
	})
	if err != nil {
		return nil, err
	}
	projectsComplaint, err := queries.SearchTraceabilityComplaintsByProject(ctx, db.SearchTraceabilityComplaintsByProjectParams{
		SearchTerm:  searchTerm,
		ResultLimit: limit,
	})
	if err != nil {
		return nil, err
	}

	for _, c := range complaints {
		add(TraceabilitySearchHit{
			ReferenceType: RefComplaintID,
			ReferenceID:   c.ComplaintId,
			Label:         c.ComplaintId,
			Subtitle:      fmt.Sprintf("%s · %s", c.ProjectName, c.ResolutionStatus),
		})
	}
	for _, d := range dispatches {
		sub := d.ProjectName
		if d.DispatchDate.Valid {
			sub = fmt.Sprintf("%s · %s", d.ProjectName, d.DispatchDate.Time.UTC().Format("2006-01-02"))
		}
		add(TraceabilitySearchHit{
			ReferenceType: RefDispatchNote,
			ReferenceID:   d.DispatchNoteNumber,
			Label:         d.DispatchNoteNumber,
			Subtitle:      sub,
		})
	}
	for _, b := range batches {
		sub := b.ProductType
		if b.ProductionDate.Valid {
			sub = fmt.Sprintf("%s · %s", b.ProductType, b.ProductionDate.Time.UTC().Format("2006-01-02"))
		}
		add(TraceabilitySearchHit{
			ReferenceType: RefBatchNumber,
			ReferenceID:   b.BatchNumber,
			Label:         b.BatchNumber,
			Subtitle:      sub,
		})
	}
	for _, s := range slits {
		add(TraceabilitySearchHit{
			ReferenceType: RefSlitCoilID,
			ReferenceID:   s.SlitCoilId,
			Label:         s.SlitCoilId,
			Subtitle:      fmt.Sprintf("Parent %s", s.ParentCoilNumber),
		})
	}
	for _, c := range coils {
		add(TraceabilitySearchHit{
			ReferenceType: RefCoilNumber,
			ReferenceID:   c.CoilNumber,
			Label:         c.CoilNumber,
			Subtitle:      fmt.Sprintf("%s · %s", c.Grade, c.Coating),
		})
	}
	for _, d := range projectsDispatch {
		add(TraceabilitySearchHit{
			ReferenceType: RefProjectName,
			ReferenceID:   d.ProjectName,
			Label:         d.ProjectName,
			Subtitle:      fmt.Sprintf("Dispatch %s", d.DispatchNoteNumber),
		})
	}
	for _, c := range projectsComplaint {
		add(TraceabilitySearchHit{
			ReferenceType: RefProjectName,
			ReferenceID:   c.ProjectName,
			Label:         c.ProjectName,
			Subtitle:      fmt.Sprintf("Complaint %s", c.ComplaintId),
		})
	}

	if hits == nil {
		hits = []TraceabilitySearchHit{}
	}
	return hits, nil
}

func ResolveReference(ctx context.Context, queries *db.Queries, query string) (*resolvedReference, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, nil
	}

	hits, err := SearchTraceabilityReferences(ctx, queries, q, 20)
	if err != nil {
		return nil, err
	}
	if len(hits) == 0 {
		return nil, nil
	}

	lowerQ := strings.ToLower(q)
	for _, hit := range hits {
		if strings.ToLower(hit.ReferenceID) == lowerQ || strings.ToLower(hit.Label) == lowerQ {
			return &resolvedReference{
				ReferenceType: hit.ReferenceType,
				ReferenceID:   hit.ReferenceID,
			}, nil
		}
	}

	first := hits[0]
	return &resolvedReference{
		ReferenceType: first.ReferenceType,
		ReferenceID:   first.ReferenceID,
	}, nil
}

func RootCoilsFromReference(ctx context.Context, queries *db.Queries, referenceType TraceabilityReferenceType, referenceID string) ([]string, error) {
	coilSet := make(map[string]struct{})

	switch referenceType {
	case RefCoilNumber:
		_, err := queries.GetCoilByNumber(ctx, referenceID)
		if err == nil {
			coilSet[referenceID] = struct{}{}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	case RefSlitCoilID:
		slit, err := queries.GetSlittingBySlitCoilId(ctx, referenceID)
		if err == nil {
			coilSet[slit.ParentCoilNumber] = struct{}{}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	case RefBatchNumber:
		rows, err := queries.ListParentCoilsForBatch(ctx, referenceID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			coilSet[row] = struct{}{}
		}
	case RefDispatchNote:
		rows, err := queries.ListParentCoilsForDispatch(ctx, referenceID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			coilSet[row] = struct{}{}
		}
	case RefComplaintID:
		rows, err := queries.ListParentCoilsForComplaint(ctx, referenceID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			coilSet[row] = struct{}{}
		}
	case RefProjectName:
		fromDispatch, err := queries.ListParentCoilsForProjectFromDispatch(ctx, referenceID)
		if err != nil {
			return nil, err
		}
		for _, row := range fromDispatch {
			coilSet[row] = struct{}{}
		}
		fromComplaint, err := queries.ListParentCoilsForProjectFromComplaint(ctx, referenceID)
		if err != nil {
			return nil, err
		}
		for _, row := range fromComplaint {
			coilSet[row] = struct{}{}
		}
	}

	coils := make([]string, 0, len(coilSet))
	for coil := range coilSet {
		coils = append(coils, coil)
	}
	sort.Strings(coils)
	return coils, nil
}

func BuildTimeline(ctx context.Context, queries *db.Queries, query string) (*TraceabilityTimeline, error) {
	resolved, err := ResolveReference(ctx, queries, query)
	if err != nil {
		return nil, err
	}
	if resolved == nil {
		return nil, nil
	}

	rootCoilNumbers, err := RootCoilsFromReference(ctx, queries, resolved.ReferenceType, resolved.ReferenceID)
	if err != nil {
		return nil, err
	}
	if len(rootCoilNumbers) == 0 {
		return nil, nil
	}

	events := make([]TimelineEvent, 0)
	slitCoilIDs := make(map[string]struct{})
	batchNumbers := make(map[string]struct{})
	dispatchNotes := make(map[string]struct{})
	complaintIDs := make(map[string]struct{})
	documentCount := 0

	for _, coilNumber := range rootCoilNumbers {
		coil, err := queries.GetCoilByNumber(ctx, coilNumber)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return nil, err
		}

		docs, err := queries.ListCoilDocuments(ctx, coilNumber)
		if err != nil {
			return nil, err
		}

		coilAttachments := make([]TimelineAttachment, 0, len(docs))
		for _, doc := range docs {
			coilAttachments = append(coilAttachments, TimelineAttachment{
				ID:       doc.ID,
				Kind:     "document",
				Label:    fmt.Sprintf("%s: %s", doc.DocumentType, doc.OriginalName),
				Mimetype: doc.Mimetype,
				URL:      fmt.Sprintf("/api/coils/documents/%s/file", doc.ID),
			})
		}
		documentCount += len(coilAttachments)

		weight, _ := numericFromPg(coil.Weight)
		events = append(events, TimelineEvent{
			ID:         fmt.Sprintf("coil:%s", coil.CoilNumber),
			Stage:      StageCoilMaster,
			OccurredAt: firstNonNilDate(isoDateFromTimestamp(coil.AmnsDispatchDate), isoDateFromTimestamp(coil.ReceiptDateSlitter), isoDateFromTimestamp(coil.CreatedAt)),
			Title:      fmt.Sprintf("Coil Master — %s", coil.CoilNumber),
			EntityType: "Coil",
			EntityID:   coil.CoilNumber,
			Fields: map[string]interface{}{
				"grade":                     coil.Grade,
				"coating":                   coil.Coating,
				"size":                      coil.Size,
				"weight":                    weight,
				"supplier":                  coil.Supplier,
				"mtcNumber":                 textOrNil(coil.MtcNumber),
				"status":                    string(coil.Status),
				"invoiceNumber":             textOrNil(coil.InvoiceNumber),
				"amnsDispatchDate":          textOrNilDate(coil.AmnsDispatchDate),
				"vehicleNumber":             textOrNil(coil.VehicleNumber),
				"transporterName":           textOrNil(coil.TransporterName),
				"receiptDateSlitter":        textOrNilDate(coil.ReceiptDateSlitter),
				"receivingConditionRemarks": textOrNil(coil.ReceivingConditionRemarks),
			},
			Links:       map[string]string{"coilNumber": coil.CoilNumber},
			Attachments: coilAttachments,
		})

		for _, doc := range docs {
			events = append(events, TimelineEvent{
				ID:         fmt.Sprintf("doc:%s", doc.ID),
				Stage:      StageDocument,
				OccurredAt: isoDateFromTimestamp(doc.CreatedAt),
				Title:      fmt.Sprintf("Document — %s", doc.DocumentType),
				EntityType: "CoilDocument",
				EntityID:   doc.ID,
				Fields: map[string]interface{}{
					"coilNumber":   coil.CoilNumber,
					"documentType": string(doc.DocumentType),
					"originalName": doc.OriginalName,
				},
				Links: map[string]string{"coilNumber": coil.CoilNumber},
				Attachments: []TimelineAttachment{{
					ID:       doc.ID,
					Kind:     "document",
					Label:    doc.OriginalName,
					Mimetype: doc.Mimetype,
					URL:      fmt.Sprintf("/api/coils/documents/%s/file", doc.ID),
				}},
			})
		}

		slits, err := queries.ListSlittingByCoil(ctx, coilNumber)
		if err != nil {
			return nil, err
		}
		sort.Slice(slits, func(i, j int) bool {
			if !slits[i].SlittingDate.Valid {
				return false
			}
			if !slits[j].SlittingDate.Valid {
				return true
			}
			return slits[i].SlittingDate.Time.Before(slits[j].SlittingDate.Time)
		})

		for _, slit := range slits {
			slitCoilIDs[slit.SlitCoilId] = struct{}{}
			slitWeight, _ := numericFromPg(slit.SlitCoilWeight)

			events = append(events, TimelineEvent{
				ID:         fmt.Sprintf("slit:%s", slit.SlitCoilId),
				Stage:      StageSlitting,
				OccurredAt: isoDateFromTimestamp(slit.SlittingDate),
				Title:      fmt.Sprintf("Slitting — %s", slit.SlitCoilId),
				EntityType: "SlittingRecord",
				EntityID:   slit.SlitCoilId,
				Fields: map[string]interface{}{
					"parentCoilNumber": slit.ParentCoilNumber,
					"slitWidthSize":    slit.SlitWidthSize,
					"slitCoilWeight":   slitWeight,
					"slitterLocation":  slit.SlitterLocation,
					"dispatchNote":     textOrNil(slit.DispatchNote),
					"vehicleNumber":    textOrNil(slit.VehicleNumber),
					"transporterName":  textOrNil(slit.TransporterName),
				},
				Links: map[string]string{
					"coilNumber":  coil.CoilNumber,
					"slitCoilId": slit.SlitCoilId,
				},
				Attachments: []TimelineAttachment{},
			})

			receipt, err := queries.GetSunrackReceiptBySlitCoilId(ctx, slit.SlitCoilId)
			if err == nil {
				photos, err := queries.ListSunrackReceiptPhotosByReceiptID(ctx, receipt.ID)
				if err != nil {
					return nil, err
				}
				photoAttachments := make([]TimelineAttachment, 0, len(photos))
				for _, p := range photos {
					photoAttachments = append(photoAttachments, TimelineAttachment{
						ID:       p.ID,
						Kind:     "photo",
						Label:    p.OriginalName,
						Mimetype: p.Mimetype,
						URL:      fmt.Sprintf("/api/sunrack-receipts/photos/%s/file", p.ID),
					})
				}
				documentCount += len(photoAttachments)

				events = append(events, TimelineEvent{
					ID:         fmt.Sprintf("receipt:%s", receipt.ID),
					Stage:      StageSunrackReceipt,
					OccurredAt: isoDateFromTimestamp(receipt.ReceiptDateSunrack),
					Title:      fmt.Sprintf("Sunrack Receipt — %s", slit.SlitCoilId),
					EntityType: "SunrackReceipt",
					EntityID:   receipt.ID,
					Fields: map[string]interface{}{
						"slitCoilId":            slit.SlitCoilId,
						"storageLocationBin":    receipt.StorageLocationBin,
						"inspectionResult":      string(receipt.InspectionResult),
						"inspectionRemarks":     textOrNil(receipt.InspectionRemarks),
						"confirmedDispatchNote": textOrNil(receipt.ConfirmedDispatchNote),
					},
					Links: map[string]string{
						"coilNumber":  coil.CoilNumber,
						"slitCoilId": slit.SlitCoilId,
					},
					Attachments: photoAttachments,
				})
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return nil, err
			}

			consumptions, err := queries.ListSlitCoilProductionConsumptions(ctx, slit.SlitCoilId)
			if err != nil {
				return nil, err
			}

			for _, cons := range consumptions {
				batchNumbers[cons.BatchNumber] = struct{}{}
				qtyProduced, _ := numericFromPg(cons.QuantityProduced)
				qtyConsumed, _ := numericFromPg(cons.QuantityConsumed)

				batch, err := queries.GetProductionBatchByNumber(ctx, cons.BatchNumber)
				if err != nil {
					return nil, err
				}

				events = append(events, TimelineEvent{
					ID:         fmt.Sprintf("batch:%s", batch.BatchNumber),
					Stage:      StageProduction,
					OccurredAt: isoDateFromTimestamp(batch.ProductionDate),
					Title:      fmt.Sprintf("Production — %s", batch.BatchNumber),
					EntityType: "ProductionBatch",
					EntityID:   batch.BatchNumber,
					Fields: map[string]interface{}{
						"productionOrderNumber": batch.ProductionOrderNumber,
						"productType":           batch.ProductType,
						"quantityProduced":      qtyProduced,
						"operatorShift":         batch.OperatorShift,
						"slitCoilId":            slit.SlitCoilId,
						"quantityConsumed":      qtyConsumed,
					},
					Links: map[string]string{
						"coilNumber":   coil.CoilNumber,
						"slitCoilId":   slit.SlitCoilId,
						"batchNumber":  batch.BatchNumber,
					},
					Attachments: []TimelineAttachment{},
				})

				qcs, err := queries.ListQcInspectionsByBatch(ctx, batch.BatchNumber)
				if err != nil {
					return nil, err
				}
				sort.Slice(qcs, func(i, j int) bool {
					if !qcs[i].InspectionDate.Valid {
						return false
					}
					if !qcs[j].InspectionDate.Valid {
						return true
					}
					return qcs[i].InspectionDate.Time.Before(qcs[j].InspectionDate.Time)
				})

				for _, qc := range qcs {
					photos, err := queries.ListQcInspectionPhotosByInspectionID(ctx, qc.ID)
					if err != nil {
						return nil, err
					}
					qcPhotos := make([]TimelineAttachment, 0, len(photos))
					for _, p := range photos {
						qcPhotos = append(qcPhotos, TimelineAttachment{
							ID:       p.ID,
							Kind:     "photo",
							Label:    p.OriginalName,
							Mimetype: p.Mimetype,
							URL:      fmt.Sprintf("/api/qc/photos/%s/file", p.ID),
						})
					}
					documentCount += len(qcPhotos)

					events = append(events, TimelineEvent{
						ID:         fmt.Sprintf("qc:%s", qc.ID),
						Stage:      StageQC,
						OccurredAt: isoDateFromTimestamp(qc.InspectionDate),
						Title:      fmt.Sprintf("QC Inspection — %s", batch.BatchNumber),
						EntityType: "QCInspection",
						EntityID:   qc.ID,
						Fields: map[string]interface{}{
							"batchNumber":  batch.BatchNumber,
							"qcResult":     string(qc.QcResult),
							"inspectorName": qc.InspectorName,
							"qcRemarks":    textOrNil(qc.QcRemarks),
						},
						Links: map[string]string{
							"batchNumber": batch.BatchNumber,
							"slitCoilId":  slit.SlitCoilId,
						},
						Attachments: qcPhotos,
					})
				}

				dispLines, err := queries.ListDispatchBatchLinesByBatchForTraceability(ctx, batch.BatchNumber)
				if err != nil {
					return nil, err
				}
				for _, line := range dispLines {
					dispatchNotes[line.DispatchNoteNumber] = struct{}{}
					qtyDispatched, _ := numericFromPg(line.QuantityDispatched)

					events = append(events, TimelineEvent{
						ID:         fmt.Sprintf("dispatch:%s:%s", line.DispatchNoteNumber, batch.BatchNumber),
						Stage:      StageDispatch,
						OccurredAt: isoDateFromTimestamp(line.DispatchDate),
						Title:      fmt.Sprintf("Dispatch — %s", line.DispatchNoteNumber),
						EntityType: "SiteDispatch",
						EntityID:   line.DispatchNoteNumber,
						Fields: map[string]interface{}{
							"batchNumber":        batch.BatchNumber,
							"quantityDispatched": qtyDispatched,
							"projectName":        line.ProjectName,
							"clientName":         line.ClientName,
							"siteLocation":       line.SiteLocation,
							"vehicleNumber":      textOrNil(line.VehicleNumber),
							"transporterName":    textOrNil(line.TransporterName),
						},
						Links: map[string]string{
							"batchNumber":        batch.BatchNumber,
							"dispatchNoteNumber": line.DispatchNoteNumber,
						},
						Attachments: []TimelineAttachment{},
					})

					install, err := queries.GetSiteInstallationSummaryByDispatchNote(ctx, line.DispatchNoteNumber)
					if err == nil {
						installPhotos, err := queries.ListSiteInstallationPhotosByInstallationID(ctx, install.ID)
						if err != nil {
							return nil, err
						}
						photoAttachments := make([]TimelineAttachment, 0, len(installPhotos))
						for _, p := range installPhotos {
							photoAttachments = append(photoAttachments, TimelineAttachment{
								ID:       p.ID,
								Kind:     "photo",
								Label:    p.OriginalName,
								Mimetype: p.Mimetype,
								URL:      fmt.Sprintf("/api/site-installation/photos/%s/file", p.ID),
							})
						}
						documentCount += len(photoAttachments)
						qtyInstalled, _ := numericFromPg(install.QuantityInstalled)

						events = append(events, TimelineEvent{
							ID:         fmt.Sprintf("install:%s", install.ID),
							Stage:      StageSiteInstallation,
							OccurredAt: isoDateFromTimestamp(install.InstallationDate),
							Title:      fmt.Sprintf("Site Installation — %s", line.DispatchNoteNumber),
							EntityType: "SiteInstallation",
							EntityID:   install.ID,
							Fields: map[string]interface{}{
								"dispatchNoteNumber":  line.DispatchNoteNumber,
								"siteReceiptDate":     textOrNilDate(install.SiteReceiptDate),
								"installationDate":    textOrNilDate(install.InstallationDate),
								"installerEpcPartner": install.InstallerEpcPartner,
								"quantityInstalled":   qtyInstalled,
							},
							Links: map[string]string{
								"dispatchNoteNumber": line.DispatchNoteNumber,
								"batchNumber":        batch.BatchNumber,
							},
							Attachments: photoAttachments,
						})
					} else if !errors.Is(err, pgx.ErrNoRows) {
						return nil, err
					}
				}

				complaints, err := queries.ListComplaintsForBatchTraceability(ctx, batch.BatchNumber)
				if err != nil {
					return nil, err
				}
				for _, complaint := range complaints {
					complaintIDs[complaint.ComplaintId] = struct{}{}
					photos, err := queries.ListComplaintPhotosByComplaintID(ctx, complaint.ComplaintId)
					if err != nil {
						return nil, err
					}
					complaintPhotos := make([]TimelineAttachment, 0, len(photos))
					for _, p := range photos {
						complaintPhotos = append(complaintPhotos, TimelineAttachment{
							ID:       p.ID,
							Kind:     "photo",
							Label:    p.OriginalName,
							Mimetype: p.Mimetype,
							URL:      fmt.Sprintf("/api/complaints/photos/%s/file", p.ID),
						})
					}
					documentCount += len(complaintPhotos)

					events = append(events, TimelineEvent{
						ID:         fmt.Sprintf("complaint:%s", complaint.ComplaintId),
						Stage:      StageComplaint,
						OccurredAt: isoDateFromTimestamp(complaint.ComplaintDate),
						Title:      fmt.Sprintf("Complaint — %s", complaint.ComplaintId),
						EntityType: "Complaint",
						EntityID:   complaint.ComplaintId,
						Fields: map[string]interface{}{
							"batchNumber":          batch.BatchNumber,
							"projectName":          complaint.ProjectName,
							"clientName":           complaint.ClientName,
							"siteLocation":         complaint.SiteLocation,
							"complaintDescription": complaint.ComplaintDescription,
							"rootCauseRemarks":     textOrNil(complaint.RootCauseRemarks),
							"resolutionStatus":     complaint.ResolutionStatus,
							"resolutionDate":       textOrNilDate(complaint.ResolutionDate),
							"responsibleStage":     textOrNilString(complaint.ResponsibleStage),
						},
						Links: map[string]string{
							"complaintId": complaint.ComplaintId,
							"batchNumber": batch.BatchNumber,
						},
						Attachments: complaintPhotos,
					})
				}
			}
		}
	}

	return &TraceabilityTimeline{
		Query:           strings.TrimSpace(query),
		ReferenceType:   resolved.ReferenceType,
		ReferenceID:     resolved.ReferenceID,
		RootCoilNumbers: rootCoilNumbers,
		Events:          sortTimelineEvents(events),
		Summary: TraceabilityTimelineSummary{
			SlitCoilCount:  len(slitCoilIDs),
			BatchCount:     len(batchNumbers),
			DispatchCount:  len(dispatchNotes),
			ComplaintCount: len(complaintIDs),
			DocumentCount:  documentCount,
		},
	}, nil
}

func textOrNilDate(ts pgtype.Timestamp) interface{} {
	if !ts.Valid {
		return nil
	}
	return ts.Time.UTC().Format("2006-01-02")
}

func textOrNilString(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func sortTimelineEvents(events []TimelineEvent) []TimelineEvent {
	sorted := make([]TimelineEvent, len(events))
	copy(sorted, events)
	sort.Slice(sorted, func(i, j int) bool {
		a, b := sorted[i].OccurredAt, sorted[j].OccurredAt
		if a == nil && b == nil {
			return sorted[i].Title < sorted[j].Title
		}
		if a == nil {
			return false
		}
		if b == nil {
			return true
		}
		if *a == *b {
			return sorted[i].Title < sorted[j].Title
		}
		return *a < *b
	})
	if sorted == nil {
		return []TimelineEvent{}
	}
	return sorted
}
