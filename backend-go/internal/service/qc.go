package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sunrack/ctrcms-go/internal/db"
)

type QcListParams struct {
	Search string
	Status string
	From   string
	To     string
}

type PendingQcBatchRow struct {
	BatchNumber           string
	ProductionOrderNumber string
	ProductType           string
	QuantityProduced      pgtype.Numeric
	ProductionDate        pgtype.Timestamp
	LatestQcResult        pgtype.Text
	LatestInspectionDate  pgtype.Timestamp
	LatestInspectorName   pgtype.Text
}

type QcBatchSummary struct {
	BatchNumber           string
	ProductionOrderNumber string
	ProductType           string
	QuantityProduced      pgtype.Numeric
	ProductionDate        pgtype.Timestamp
	OperatorShift         string
}

func ListQcInspections(ctx context.Context, pool *pgxpool.Pool, p QcListParams) ([]db.QCInspection, error) {
	var args []interface{}
	where := []string{"1=1"}
	argN := 1

	if p.Search != "" {
		where = append(where, fmt.Sprintf(`(
			qi."batchNumber" ILIKE $%d OR
			qi."inspectorName" ILIKE $%d OR
			pb."productionOrderNumber" ILIKE $%d
		)`, argN, argN, argN))
		args = append(args, "%"+p.Search+"%")
		argN++
	}
	if p.Status != "" && p.Status != "ALL" {
		where = append(where, fmt.Sprintf(`qi."qcResult" = $%d::"QcResult"`, argN))
		args = append(args, p.Status)
		argN++
	}
	if p.From != "" {
		where = append(where, fmt.Sprintf(`qi."inspectionDate" >= $%d::timestamp`, argN))
		args = append(args, p.From)
		argN++
	}
	if p.To != "" {
		where = append(where, fmt.Sprintf(`qi."inspectionDate" <= $%d::timestamp`, argN))
		args = append(args, p.To)
	}

	whereSQL := strings.Join(where, " AND ")
	sql := fmt.Sprintf(`
		SELECT qi.id, qi."batchNumber", qi."qcResult", qi."inspectorName", qi."inspectionDate",
			qi."qcRemarks", qi."createdAt", qi."updatedAt"
		FROM "QCInspection" qi
		INNER JOIN "ProductionBatch" pb ON pb."batchNumber" = qi."batchNumber"
		WHERE %s
		ORDER BY qi."inspectionDate" DESC
	`, whereSQL)

	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []db.QCInspection
	for rows.Next() {
		var i db.QCInspection
		if err := rows.Scan(
			&i.ID, &i.BatchNumber, &i.QcResult, &i.InspectorName, &i.InspectionDate,
			&i.QcRemarks, &i.CreatedAt, &i.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if items == nil {
		items = []db.QCInspection{}
	}
	return items, rows.Err()
}

func GetQcStats(ctx context.Context, queries *db.Queries) (map[string]int64, error) {
	total, err := queries.CountQcInspections(ctx)
	if err != nil {
		return nil, err
	}
	pass, err := queries.CountQcInspectionsByResult(ctx, db.QcResultPASS)
	if err != nil {
		return nil, err
	}
	fail, err := queries.CountQcInspectionsByResult(ctx, db.QcResultFAIL)
	if err != nil {
		return nil, err
	}
	rework, err := queries.CountQcInspectionsByResult(ctx, db.QcResultREWORK)
	if err != nil {
		return nil, err
	}
	pending, err := queries.CountBatchesWithNoQc(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]int64{
		"totalInspections": total,
		"passed":           pass,
		"failed":           fail,
		"rework":           rework,
		"batchesPendingQc": pending,
	}, nil
}

func ListPendingQcBatches(ctx context.Context, pool *pgxpool.Pool) ([]PendingQcBatchRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			pb."batchNumber", pb."productionOrderNumber", pb."productType", pb."quantityProduced",
			pb."productionDate",
			latest."qcResult"::text, latest."inspectionDate", latest."inspectorName"
		FROM "ProductionBatch" pb
		LEFT JOIN LATERAL (
			SELECT qi."qcResult", qi."inspectionDate", qi."inspectorName"
			FROM "QCInspection" qi
			WHERE qi."batchNumber" = pb."batchNumber"
			ORDER BY qi."inspectionDate" DESC
			LIMIT 1
		) latest ON true
		ORDER BY pb."productionDate" DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var all []PendingQcBatchRow
	for rows.Next() {
		var row PendingQcBatchRow
		if err := rows.Scan(
			&row.BatchNumber, &row.ProductionOrderNumber, &row.ProductType, &row.QuantityProduced,
			&row.ProductionDate,
			&row.LatestQcResult, &row.LatestInspectionDate, &row.LatestInspectorName,
		); err != nil {
			return nil, err
		}
		needsInspection := !row.LatestQcResult.Valid || row.LatestQcResult.String == string(db.QcResultREWORK)
		if needsInspection {
			all = append(all, row)
		}
	}
	if all == nil {
		all = []PendingQcBatchRow{}
	}
	return all, rows.Err()
}

func ListDispatchEligibleBatchNumbers(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	rows, err := pool.Query(ctx, `
		SELECT pb."batchNumber"
		FROM "ProductionBatch" pb
		ORDER BY pb."productionDate" DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var eligible []string
	for rows.Next() {
		var batchNumber string
		if err := rows.Scan(&batchNumber); err != nil {
			return nil, err
		}
		var qcResult db.QcResult
		err := pool.QueryRow(ctx, `
			SELECT "qcResult"
			FROM "QCInspection"
			WHERE "batchNumber" = $1
			ORDER BY "inspectionDate" DESC
			LIMIT 1
		`, batchNumber).Scan(&qcResult)
		if err == nil && qcResult == db.QcResultPASS {
			eligible = append(eligible, batchNumber)
		}
	}
	if eligible == nil {
		eligible = []string{}
	}
	return eligible, rows.Err()
}

func LoadProductionBatchSummary(ctx context.Context, pool *pgxpool.Pool, batchNumber string) (QcBatchSummary, error) {
	var s QcBatchSummary
	err := pool.QueryRow(ctx, `
		SELECT "batchNumber", "productionOrderNumber", "productType", "quantityProduced", "productionDate", "operatorShift"
		FROM "ProductionBatch"
		WHERE "batchNumber" = $1
	`, batchNumber).Scan(
		&s.BatchNumber, &s.ProductionOrderNumber, &s.ProductType, &s.QuantityProduced,
		&s.ProductionDate, &s.OperatorShift,
	)
	return s, err
}

func LoadQcPhotos(ctx context.Context, queries *db.Queries, inspectionID string) ([]db.QCInspectionPhoto, error) {
	photos, err := queries.ListQcInspectionPhotosByInspectionID(ctx, inspectionID)
	if err != nil {
		return nil, err
	}
	if photos == nil {
		photos = []db.QCInspectionPhoto{}
	}
	return photos, nil
}

func NotifyQcFailed(ctx context.Context, queries *db.Queries, batchNumber, productType, inspectorName string, qcRemarks *string) error {
	message := fmt.Sprintf("%s · Inspector %s", productType, inspectorName)
	if qcRemarks != nil && *qcRemarks != "" {
		message += " — " + *qcRemarks
	}
	_, err := queries.CreateSystemNotification(ctx, db.CreateSystemNotificationParams{
		ID:               uuid.New().String(),
		NotificationType: db.NotificationTypeQCFAILED,
		Title:            fmt.Sprintf("QC failed — %s", batchNumber),
		Message:          message,
		EntityType:       pgtype.Text{String: "ProductionBatch", Valid: true},
		EntityID:         pgtype.Text{String: batchNumber, Valid: true},
	})
	return err
}

func ParseInspectionDate(value string) (pgtype.Timestamp, error) {
	t, err := ParseProductionDate(value)
	if err != nil {
		return pgtype.Timestamp{}, err
	}
	return pgtype.Timestamp{Time: t, Valid: true}, nil
}

func ParseQcResult(value string) (db.QcResult, bool) {
	switch strings.ToUpper(value) {
	case "PASS":
		return db.QcResultPASS, true
	case "FAIL":
		return db.QcResultFAIL, true
	case "REWORK":
		return db.QcResultREWORK, true
	default:
		return "", false
	}
}
