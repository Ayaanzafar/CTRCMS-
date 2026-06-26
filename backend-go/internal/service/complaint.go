package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sunrack/ctrcms-go/internal/db"
)

type ComplaintListParams struct {
	Search string
	Status string
	From   string
	To     string
}

type EligibleComplaintDispatch struct {
	DispatchNoteNumber  string
	ProjectName         string
	ClientName          string
	SiteLocation        string
	QuantityDispatched  float64
	HasSiteInstallation bool
}

type EligibleComplaintBatch struct {
	BatchNumber           string
	ProductType           string
	ProductionOrderNumber string
	QuantityProduced      float64
	Dispatches            []EligibleComplaintDispatch
}

type ComplaintBatchLineDetail struct {
	BatchNumber           string
	ProductType           string
	ProductionOrderNumber string
	QuantityProduced      float64
}

type ComplaintDetail struct {
	Complaint     db.Complaint
	BatchLines    []ComplaintBatchLineDetail
	BatchNumbers  []string
	Photos        []db.ComplaintPhoto
	PhotoCount    int64
	Traceability  BackwardTraceability
}

func GenerateNextComplaintID(ctx context.Context, queries *db.Queries) (string, error) {
	year := time.Now().Year()
	prefix := fmt.Sprintf("COMP-%d-", year)
	latest, err := queries.GetLatestComplaintIDByPrefix(ctx, pgtype.Text{String: prefix, Valid: true})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Sprintf("%s%04d", prefix, 1), nil
		}
		return "", err
	}
	seqStr := strings.TrimPrefix(latest, prefix)
	seq, err := strconv.Atoi(seqStr)
	if err != nil {
		return fmt.Sprintf("%s%04d", prefix, 1), nil
	}
	return fmt.Sprintf("%s%04d", prefix, seq+1), nil
}

func ValidateComplaintBatchLines(ctx context.Context, queries *db.Queries, batchNumbers []string) (bool, string) {
	if len(batchNumbers) == 0 {
		return false, "At least one affected batch is required"
	}
	seen := make(map[string]struct{}, len(batchNumbers))
	for _, b := range batchNumbers {
		batchNumber := strings.ToUpper(strings.TrimSpace(b))
		if batchNumber == "" {
			return false, "At least one affected batch is required"
		}
		if _, dup := seen[batchNumber]; dup {
			return false, "Duplicate batch numbers in complaint"
		}
		seen[batchNumber] = struct{}{}
		if _, err := queries.GetProductionBatchByNumber(ctx, batchNumber); err != nil {
			return false, fmt.Sprintf("Production batch %s not found", batchNumber)
		}
	}
	return true, ""
}

func GetComplaintStats(ctx context.Context, queries *db.Queries) (map[string]interface{}, error) {
	total, err := queries.CountComplaints(ctx)
	if err != nil {
		return nil, err
	}
	openCount, err := queries.CountComplaintsByStatus(ctx, db.ResolutionStatusOPEN)
	if err != nil {
		return nil, err
	}
	investigating, err := queries.CountComplaintsByStatus(ctx, db.ResolutionStatusUNDERINVESTIGATION)
	if err != nil {
		return nil, err
	}
	closed, err := queries.CountComplaintsByStatus(ctx, db.ResolutionStatusCLOSED)
	if err != nil {
		return nil, err
	}
	photos, err := queries.CountComplaintPhotos(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"totalComplaints":    total,
		"open":               openCount,
		"underInvestigation": investigating,
		"closed":             closed,
		"totalPhotos":        photos,
	}, nil
}

func ListEligibleComplaintBatches(ctx context.Context, pool *pgxpool.Pool) ([]EligibleComplaintBatch, error) {
	rows, err := pool.Query(ctx, `
		SELECT dbl."batchNumber", dbl."quantityDispatched", dbl."dispatchNoteNumber",
			pb."productType", pb."productionOrderNumber", pb."quantityProduced",
			sd."projectName", sd."clientName", sd."siteLocation",
			(si.id IS NOT NULL) AS has_site_installation
		FROM "DispatchBatchLine" dbl
		INNER JOIN "ProductionBatch" pb ON pb."batchNumber" = dbl."batchNumber"
		INNER JOIN "SiteDispatch" sd ON sd."dispatchNoteNumber" = dbl."dispatchNoteNumber"
		LEFT JOIN "SiteInstallation" si ON si."dispatchNoteNumber" = sd."dispatchNoteNumber"
		ORDER BY dbl."createdAt" DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byBatch := make(map[string]*EligibleComplaintBatch)
	var order []string
	for rows.Next() {
		var batchNumber, dispatchNote, productType, po, projectName, clientName, siteLocation string
		var qtyDispatched, qtyProduced pgtype.Numeric
		var hasSite bool
		if err := rows.Scan(
			&batchNumber, &qtyDispatched, &dispatchNote,
			&productType, &po, &qtyProduced,
			&projectName, &clientName, &siteLocation,
			&hasSite,
		); err != nil {
			return nil, err
		}
		dispatched, err := numericFromPg(qtyDispatched)
		if err != nil {
			return nil, err
		}
		produced, err := numericFromPg(qtyProduced)
		if err != nil {
			return nil, err
		}

		entry, ok := byBatch[batchNumber]
		if !ok {
			entry = &EligibleComplaintBatch{
				BatchNumber:           batchNumber,
				ProductType:           productType,
				ProductionOrderNumber: po,
				QuantityProduced:      produced,
				Dispatches:            []EligibleComplaintDispatch{},
			}
			byBatch[batchNumber] = entry
			order = append(order, batchNumber)
		}
		entry.Dispatches = append(entry.Dispatches, EligibleComplaintDispatch{
			DispatchNoteNumber:  dispatchNote,
			ProjectName:         projectName,
			ClientName:          clientName,
			SiteLocation:        siteLocation,
			QuantityDispatched:  dispatched,
			HasSiteInstallation: hasSite,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	batches := make([]EligibleComplaintBatch, 0, len(order))
	for _, key := range order {
		batches = append(batches, *byBatch[key])
	}
	if batches == nil {
		batches = []EligibleComplaintBatch{}
	}
	return batches, nil
}

func ListComplaints(ctx context.Context, pool *pgxpool.Pool, queries *db.Queries, p ComplaintListParams) ([]ComplaintDetail, error) {
	ids, err := listComplaintIDsFiltered(ctx, pool, p)
	if err != nil {
		return nil, err
	}
	details := make([]ComplaintDetail, 0, len(ids))
	for _, id := range ids {
		complaint, err := queries.GetComplaintByID(ctx, id)
		if err != nil {
			return nil, err
		}
		detail, err := LoadComplaintDetail(ctx, pool, queries, complaint)
		if err != nil {
			return nil, err
		}
		details = append(details, detail)
	}
	if details == nil {
		details = []ComplaintDetail{}
	}
	return details, nil
}

func LoadComplaintDetail(ctx context.Context, pool *pgxpool.Pool, queries *db.Queries, complaint db.Complaint) (ComplaintDetail, error) {
	lines, err := queries.ListComplaintBatchLinesByComplaint(ctx, complaint.ComplaintId)
	if err != nil {
		return ComplaintDetail{}, err
	}

	batchNumbers := make([]string, 0, len(lines))
	lineDetails := make([]ComplaintBatchLineDetail, 0, len(lines))
	for _, line := range lines {
		batchNumbers = append(batchNumbers, line.BatchNumber)
		detail := ComplaintBatchLineDetail{BatchNumber: line.BatchNumber}
		batch, err := queries.GetProductionBatchByNumber(ctx, line.BatchNumber)
		if err == nil {
			detail.ProductType = batch.ProductType
			detail.ProductionOrderNumber = batch.ProductionOrderNumber
			qty, _ := numericFromPg(batch.QuantityProduced)
			detail.QuantityProduced = qty
		}
		lineDetails = append(lineDetails, detail)
	}

	photos, err := queries.ListComplaintPhotosByComplaintID(ctx, complaint.ComplaintId)
	if err != nil {
		return ComplaintDetail{}, err
	}
	if photos == nil {
		photos = []db.ComplaintPhoto{}
	}
	photoCount, err := queries.CountComplaintPhotosByComplaintID(ctx, complaint.ComplaintId)
	if err != nil {
		return ComplaintDetail{}, err
	}

	traceability, err := ResolveBackwardFromBatches(ctx, pool, batchNumbers)
	if err != nil {
		return ComplaintDetail{}, err
	}

	return ComplaintDetail{
		Complaint:    complaint,
		BatchLines:   lineDetails,
		BatchNumbers: batchNumbers,
		Photos:       photos,
		PhotoCount:   photoCount,
		Traceability: traceability,
	}, nil
}

func NotifyComplaintCreated(ctx context.Context, queries *db.Queries, complaintID, projectName, clientName string) error {
	message := fmt.Sprintf("%s · %s — review and assign investigation", projectName, clientName)
	_, err := queries.CreateSystemNotification(ctx, db.CreateSystemNotificationParams{
		ID:               uuid.New().String(),
		NotificationType: db.NotificationTypeCOMPLAINTCREATED,
		Title:            fmt.Sprintf("New complaint %s", complaintID),
		Message:          message,
		EntityType:       pgtype.Text{String: "Complaint", Valid: true},
		EntityID:         pgtype.Text{String: complaintID, Valid: true},
	})
	return err
}

func ParseResponsibleStage(value string) (db.NullResponsibleStage, bool) {
	switch strings.ToUpper(value) {
	case "AMNS":
		return db.NullResponsibleStage{ResponsibleStage: db.ResponsibleStageAMNS, Valid: true}, true
	case "SLITTER":
		return db.NullResponsibleStage{ResponsibleStage: db.ResponsibleStageSLITTER, Valid: true}, true
	case "SUNRACK_PRODUCTION":
		return db.NullResponsibleStage{ResponsibleStage: db.ResponsibleStageSUNRACKPRODUCTION, Valid: true}, true
	case "TRANSPORT":
		return db.NullResponsibleStage{ResponsibleStage: db.ResponsibleStageTRANSPORT, Valid: true}, true
	case "SITE_HANDLING":
		return db.NullResponsibleStage{ResponsibleStage: db.ResponsibleStageSITEHANDLING, Valid: true}, true
	default:
		return db.NullResponsibleStage{}, false
	}
}

func ParseResolutionStatus(value string) (db.ResolutionStatus, bool) {
	switch strings.ToUpper(value) {
	case "OPEN":
		return db.ResolutionStatusOPEN, true
	case "UNDER_INVESTIGATION":
		return db.ResolutionStatusUNDERINVESTIGATION, true
	case "CLOSED":
		return db.ResolutionStatusCLOSED, true
	default:
		return "", false
	}
}

func listComplaintIDsFiltered(ctx context.Context, pool *pgxpool.Pool, p ComplaintListParams) ([]string, error) {
	var args []interface{}
	where := []string{"1=1"}
	argN := 1

	if p.Search != "" {
		where = append(where, fmt.Sprintf(`(
			c."complaintId" ILIKE $%d OR
			c."projectName" ILIKE $%d OR
			c."clientName" ILIKE $%d OR
			c."siteLocation" ILIKE $%d OR
			c."complaintDescription" ILIKE $%d OR
			EXISTS (
				SELECT 1 FROM "ComplaintBatchLine" cbl
				WHERE cbl."complaintId" = c."complaintId"
				  AND cbl."batchNumber" ILIKE $%d
			)
		)`, argN, argN, argN, argN, argN, argN))
		args = append(args, "%"+p.Search+"%")
		argN++
	}
	if p.Status != "" && p.Status != "ALL" {
		where = append(where, fmt.Sprintf(`c."resolutionStatus" = $%d::"ResolutionStatus"`, argN))
		args = append(args, p.Status)
		argN++
	}
	if p.From != "" {
		where = append(where, fmt.Sprintf(`c."complaintDate" >= $%d::timestamp`, argN))
		args = append(args, p.From)
		argN++
	}
	if p.To != "" {
		where = append(where, fmt.Sprintf(`c."complaintDate" <= $%d::timestamp`, argN))
		args = append(args, p.To)
	}

	sql := fmt.Sprintf(`
		SELECT c."complaintId"
		FROM "Complaint" c
		WHERE %s
		ORDER BY c."complaintDate" DESC
	`, strings.Join(where, " AND "))

	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
