package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sunrack/ctrcms-go/internal/db"
)

type ConsumptionLine struct {
	SlitCoilId       string
	QuantityConsumed float64
}

type ProductionListParams struct {
	Search      string
	ProductType string
	From        string
	To          string
}

type ProductionListRow struct {
	Batch db.ProductionBatch
}

type AvailableSlitCoilRow struct {
	SlitCoilId       string
	ParentCoilNumber string
	SlitWidthSize    string
	SlitCoilWeight   string
	ParentGrade      string
	ParentCoating    string
	StorageBin       pgtype.Text
	InspectionResult pgtype.Text
	ConsumedTotal    string
}

type BatchConsumptionDetail struct {
	Map              db.BatchSlitCoilMap
	SlitCoilId       string
	ParentCoilNumber string
	SlitWidthSize    string
	SlitCoilWeight   string
}

type QcInspectionSummary struct {
	ID             string
	QcResult       db.QcResult
	InspectionDate pgtype.Timestamp
	InspectorName  string
}

type QcInspectionDetail struct {
	ID             string
	BatchNumber    string
	QcResult       db.QcResult
	InspectorName  string
	InspectionDate pgtype.Timestamp
	QcRemarks      pgtype.Text
	CreatedAt      pgtype.Timestamp
	UpdatedAt      pgtype.Timestamp
	Photos         []QcPhotoRow
}

type QcPhotoRow struct {
	ID           string
	Filename     string
	OriginalName string
	Mimetype     string
	Size         int32
	StoragePath  string
	UploadedById pgtype.Text
	CreatedAt    pgtype.Timestamp
}

func GenerateNextBatchNumber(ctx context.Context, queries *db.Queries) (string, error) {
	year := time.Now().Year()
	prefix := fmt.Sprintf("BATCH-%d-", year)
	latest, err := queries.GetLatestBatchNumberWithPrefix(ctx, pgtype.Text{String: prefix, Valid: true})
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Sprintf("%s%04d", prefix, 1), nil
	}
	if err != nil {
		return "", err
	}

	next := 1
	seqStr := strings.TrimPrefix(latest, prefix)
	if seq, err := strconv.Atoi(seqStr); err == nil {
		next = seq + 1
	}
	return fmt.Sprintf("%s%04d", prefix, next), nil
}

func GetSlitCoilConsumedTotal(ctx context.Context, queries *db.Queries, slitCoilID string) (float64, error) {
	total, err := queries.SumConsumedBySlitCoil(ctx, db.SumConsumedBySlitCoilParams{
		SlitCoilID:   strings.ToUpper(slitCoilID),
		ExcludeBatch: pgtype.Text{},
	})
	if err != nil {
		return 0, err
	}
	return numericToFloat(total)
}

func GetSlitCoilRemaining(ctx context.Context, queries *db.Queries, slitCoilID string) (float64, error) {
	ctxRow, err := queries.GetSlitCoilProductionContext(ctx, strings.ToUpper(slitCoilID))
	if err != nil {
		return 0, err
	}
	total, err := numericToFloat(ctxRow.SlitCoilWeight)
	if err != nil {
		return 0, err
	}
	consumed, err := GetSlitCoilConsumedTotal(ctx, queries, slitCoilID)
	if err != nil {
		return 0, err
	}
	remaining := total - consumed
	if remaining < 0 {
		return 0, nil
	}
	return remaining, nil
}

func ValidateSlitCoilConsumptions(ctx context.Context, queries *db.Queries, consumptions []ConsumptionLine, excludeBatch string) (bool, string) {
	for _, line := range consumptions {
		slitCoilID := strings.ToUpper(line.SlitCoilId)

		ctxRow, err := queries.GetSlitCoilProductionContext(ctx, slitCoilID)
		if err != nil {
			return false, fmt.Sprintf("Slit coil %s not found", slitCoilID)
		}

		if !ctxRow.ReceiptID.Valid {
			return false, fmt.Sprintf("Slit coil %s has no Sunrack receipt — issue to production only after warehouse receipt", slitCoilID)
		}

		if ctxRow.InspectionResult.Valid && ctxRow.InspectionResult.InspectionResult == db.InspectionResultFAIL {
			return false, fmt.Sprintf("Slit coil %s failed warehouse inspection and cannot enter production", slitCoilID)
		}

		if line.QuantityConsumed <= 0 {
			return false, fmt.Sprintf("Quantity consumed for %s must be positive", slitCoilID)
		}

		totalWeight, err := numericToFloat(ctxRow.SlitCoilWeight)
		if err != nil {
			return false, "Invalid slit coil weight"
		}

		var exclude pgtype.Text
		if excludeBatch != "" {
			exclude = pgtype.Text{String: strings.ToUpper(excludeBatch), Valid: true}
		}
		consumedSum, err := queries.SumConsumedBySlitCoil(ctx, db.SumConsumedBySlitCoilParams{
			SlitCoilID:   slitCoilID,
			ExcludeBatch: exclude,
		})
		if err != nil {
			return false, "Failed to validate consumption"
		}
		alreadyConsumed, err := numericToFloat(consumedSum)
		if err != nil {
			return false, "Failed to validate consumption"
		}

		remaining := totalWeight - alreadyConsumed
		if line.QuantityConsumed > remaining+0.0001 {
			return false, fmt.Sprintf(
				"Slit coil %s only has %.3f MT remaining (%.3f MT total, %.3f MT already issued)",
				slitCoilID, remaining, totalWeight, alreadyConsumed,
			)
		}
	}
	return true, ""
}

func ListProductionBatches(ctx context.Context, pool *pgxpool.Pool, p ProductionListParams) ([]ProductionListRow, error) {
	var args []interface{}
	where := []string{"1=1"}
	argN := 1

	if p.Search != "" {
		where = append(where, fmt.Sprintf(`(
			b."batchNumber" ILIKE $%d OR
			b."productionOrderNumber" ILIKE $%d OR
			b."operatorShift" ILIKE $%d OR
			EXISTS (
				SELECT 1 FROM "BatchSlitCoilMap" m
				WHERE m."batchNumber" = b."batchNumber" AND m."slitCoilId" ILIKE $%d
			)
		)`, argN, argN, argN, argN))
		args = append(args, "%"+p.Search+"%")
		argN++
	}
	if p.ProductType != "" {
		where = append(where, fmt.Sprintf(`b."productType" ILIKE $%d`, argN))
		args = append(args, "%"+p.ProductType+"%")
		argN++
	}
	if p.From != "" {
		where = append(where, fmt.Sprintf(`b."productionDate" >= $%d::timestamp`, argN))
		args = append(args, p.From)
		argN++
	}
	if p.To != "" {
		where = append(where, fmt.Sprintf(`b."productionDate" <= $%d::timestamp`, argN))
		args = append(args, p.To)
		argN++
	}

	whereSQL := strings.Join(where, " AND ")
	sql := fmt.Sprintf(`
		SELECT
			b."batchNumber", b."productionOrderNumber", b."productType", b."quantityProduced",
			b."productionDate", b."operatorShift", b."createdAt", b."updatedAt"
		FROM "ProductionBatch" b
		WHERE %s
		ORDER BY b."productionDate" DESC
	`, whereSQL)

	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []ProductionListRow
	for rows.Next() {
		var row ProductionListRow
		if err := rows.Scan(
			&row.Batch.BatchNumber, &row.Batch.ProductionOrderNumber, &row.Batch.ProductType,
			&row.Batch.QuantityProduced, &row.Batch.ProductionDate, &row.Batch.OperatorShift,
			&row.Batch.CreatedAt, &row.Batch.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, row)
	}
	if items == nil {
		items = []ProductionListRow{}
	}
	return items, rows.Err()
}

func ListAvailableSlitCoils(ctx context.Context, pool *pgxpool.Pool, search string) ([]AvailableSlitCoilRow, error) {
	var args []interface{}
	where := []string{`srr."inspectionResult" != 'FAIL'`}
	argN := 1

	if search != "" {
		where = append(where, fmt.Sprintf(`(
			sr."slitCoilId" ILIKE $%d OR sr."parentCoilNumber" ILIKE $%d
		)`, argN, argN))
		args = append(args, "%"+search+"%")
	}

	whereSQL := strings.Join(where, " AND ")
	sql := fmt.Sprintf(`
		SELECT
			sr."slitCoilId", sr."parentCoilNumber", sr."slitWidthSize", sr."slitCoilWeight"::text,
			c.grade, c.coating,
			srr."storageLocationBin", srr."inspectionResult"::text,
			COALESCE((
				SELECT SUM(m."quantityConsumed")::text
				FROM "BatchSlitCoilMap" m WHERE m."slitCoilId" = sr."slitCoilId"
			), '0')
		FROM "SlittingRecord" sr
		INNER JOIN "Coil" c ON c."coilNumber" = sr."parentCoilNumber"
		INNER JOIN "SunrackReceipt" srr ON srr."slitCoilId" = sr."slitCoilId"
		WHERE %s
		ORDER BY sr."slittingDate" DESC
	`, whereSQL)

	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []AvailableSlitCoilRow
	for rows.Next() {
		var row AvailableSlitCoilRow
		if err := rows.Scan(
			&row.SlitCoilId, &row.ParentCoilNumber, &row.SlitWidthSize, &row.SlitCoilWeight,
			&row.ParentGrade, &row.ParentCoating,
			&row.StorageBin, &row.InspectionResult, &row.ConsumedTotal,
		); err != nil {
			return nil, err
		}
		items = append(items, row)
	}
	return items, rows.Err()
}

func LoadBatchConsumptionsDetail(ctx context.Context, pool *pgxpool.Pool, batchNumber string) ([]BatchConsumptionDetail, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			m.id, m."batchNumber", m."slitCoilId", m."quantityConsumed", m."createdAt",
			sr."slitCoilId", sr."parentCoilNumber", sr."slitWidthSize", sr."slitCoilWeight"::text
		FROM "BatchSlitCoilMap" m
		INNER JOIN "SlittingRecord" sr ON sr."slitCoilId" = m."slitCoilId"
		WHERE m."batchNumber" = $1
		ORDER BY m."createdAt" ASC
	`, batchNumber)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []BatchConsumptionDetail
	for rows.Next() {
		var item BatchConsumptionDetail
		if err := rows.Scan(
			&item.Map.ID, &item.Map.BatchNumber, &item.Map.SlitCoilId, &item.Map.QuantityConsumed, &item.Map.CreatedAt,
			&item.SlitCoilId, &item.ParentCoilNumber, &item.SlitWidthSize, &item.SlitCoilWeight,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if items == nil {
		items = []BatchConsumptionDetail{}
	}
	return items, rows.Err()
}

func LoadBatchListConsumptions(ctx context.Context, pool *pgxpool.Pool, batchNumber string) ([]db.BatchSlitCoilMap, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, "batchNumber", "slitCoilId", "quantityConsumed", "createdAt"
		FROM "BatchSlitCoilMap"
		WHERE "batchNumber" = $1
		ORDER BY "createdAt" ASC
	`, batchNumber)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []db.BatchSlitCoilMap
	for rows.Next() {
		var m db.BatchSlitCoilMap
		if err := rows.Scan(&m.ID, &m.BatchNumber, &m.SlitCoilId, &m.QuantityConsumed, &m.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, m)
	}
	if items == nil {
		items = []db.BatchSlitCoilMap{}
	}
	return items, rows.Err()
}

func LoadLatestQcForBatch(ctx context.Context, pool *pgxpool.Pool, batchNumber string) (*QcInspectionSummary, error) {
	var summary QcInspectionSummary
	err := pool.QueryRow(ctx, `
		SELECT id, "qcResult", "inspectionDate", "inspectorName"
		FROM "QCInspection"
		WHERE "batchNumber" = $1
		ORDER BY "inspectionDate" DESC
		LIMIT 1
	`, batchNumber).Scan(&summary.ID, &summary.QcResult, &summary.InspectionDate, &summary.InspectorName)
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func LoadQcInspectionsForBatch(ctx context.Context, pool *pgxpool.Pool, batchNumber string) ([]QcInspectionDetail, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, "batchNumber", "qcResult", "inspectorName", "inspectionDate", "qcRemarks", "createdAt", "updatedAt"
		FROM "QCInspection"
		WHERE "batchNumber" = $1
		ORDER BY "inspectionDate" DESC
	`, batchNumber)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var inspections []QcInspectionDetail
	for rows.Next() {
		var q QcInspectionDetail
		if err := rows.Scan(
			&q.ID, &q.BatchNumber, &q.QcResult, &q.InspectorName, &q.InspectionDate,
			&q.QcRemarks, &q.CreatedAt, &q.UpdatedAt,
		); err != nil {
			return nil, err
		}
		inspections = append(inspections, q)
	}
	if inspections == nil {
		inspections = []QcInspectionDetail{}
	}

	for i := range inspections {
		photoRows, err := pool.Query(ctx, `
			SELECT id, filename, "originalName", mimetype, size, "storagePath", "uploadedById", "createdAt"
			FROM "QCInspectionPhoto"
			WHERE "inspectionId" = $1
			ORDER BY "createdAt" ASC
		`, inspections[i].ID)
		if err != nil {
			return nil, err
		}
		for photoRows.Next() {
			var p QcPhotoRow
			if err := photoRows.Scan(&p.ID, &p.Filename, &p.OriginalName, &p.Mimetype, &p.Size, &p.StoragePath, &p.UploadedById, &p.CreatedAt); err != nil {
				photoRows.Close()
				return nil, err
			}
			inspections[i].Photos = append(inspections[i].Photos, p)
		}
		photoRows.Close()
		if inspections[i].Photos == nil {
			inspections[i].Photos = []QcPhotoRow{}
		}
	}
	return inspections, nil
}

func GetProductionStats(ctx context.Context, queries *db.Queries) (map[string]int64, error) {
	total, err := queries.CountProductionBatches(ctx)
	if err != nil {
		return nil, err
	}
	slitCoils, err := queries.CountSlitCoilsWithNonFailReceipt(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]int64{
		"totalBatches":         total,
		"slitCoilsWithReceipt": slitCoils,
	}, nil
}

func numericToFloat(n pgtype.Numeric) (float64, error) {
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		s := NumericToString(n)
		v, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return 0, err
		}
		return v, nil
	}
	return f.Float64, nil
}

func ParseProductionDate(value string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse("2006-01-02", value); err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, fmt.Errorf("invalid production date")
}

func WeightFromFloat(v float64) (pgtype.Numeric, error) {
	var n pgtype.Numeric
	if err := n.Scan(fmt.Sprintf("%g", v)); err != nil {
		return n, err
	}
	return n, nil
}

func RoundRemaining(total, consumed float64) float64 {
	return math.Max(0, total-consumed)
}
