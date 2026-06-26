package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SlittingListParams struct {
	Search     string
	ParentCoil string
	From       string
	To         string
}

type SlittingListRow struct {
	SlitCoilId       string
	ParentCoilNumber string
	SlitWidthSize    string
	SlittingDate     pgtype.Timestamp
	SlitCoilWeight   string
	SlitterLocation  string
	DispatchNote     pgtype.Text
	VehicleNumber    pgtype.Text
	TransporterName  pgtype.Text
	CreatedAt        pgtype.Timestamp
	UpdatedAt        pgtype.Timestamp
	ParentGrade      string
	ParentCoating    string
	SunrackID        pgtype.Text
	SunrackDate      pgtype.Timestamp
	SunrackResult    pgtype.Text
	SunrackBin       pgtype.Text
	SunrackPhotoCnt  int64
}

func ListSlitting(ctx context.Context, pool *pgxpool.Pool, p SlittingListParams) ([]SlittingListRow, error) {
	var args []interface{}
	where := []string{"1=1"}
	argN := 1

	if p.ParentCoil != "" {
		where = append(where, fmt.Sprintf(`sr."parentCoilNumber" ILIKE $%d`, argN))
		args = append(args, strings.ToUpper(p.ParentCoil))
		argN++
	}

	if p.Search != "" {
		where = append(where, fmt.Sprintf(`(
			sr."slitCoilId" ILIKE $%d OR
			sr."parentCoilNumber" ILIKE $%d OR
			sr."dispatchNote" ILIKE $%d OR
			sr."vehicleNumber" ILIKE $%d
		)`, argN, argN, argN, argN))
		args = append(args, "%"+p.Search+"%")
		argN++
	}

	if p.From != "" {
		where = append(where, fmt.Sprintf(`sr."slittingDate" >= $%d::timestamp`, argN))
		args = append(args, p.From)
		argN++
	}
	if p.To != "" {
		where = append(where, fmt.Sprintf(`sr."slittingDate" <= $%d::timestamp`, argN))
		args = append(args, p.To)
		argN++
	}

	whereSQL := strings.Join(where, " AND ")

	sql := fmt.Sprintf(`
		SELECT
			sr."slitCoilId", sr."parentCoilNumber", sr."slitWidthSize", sr."slittingDate",
			sr."slitCoilWeight"::text, sr."slitterLocation", sr."dispatchNote", sr."vehicleNumber",
			sr."transporterName", sr."createdAt", sr."updatedAt",
			c.grade, c.coating,
			srr.id, srr."receiptDateSunrack", srr."inspectionResult"::text, srr."storageLocationBin",
			COALESCE((SELECT COUNT(*)::bigint FROM "SunrackReceiptPhoto" p WHERE p."receiptId" = srr.id), 0)
		FROM "SlittingRecord" sr
		INNER JOIN "Coil" c ON c."coilNumber" = sr."parentCoilNumber"
		LEFT JOIN "SunrackReceipt" srr ON srr."slitCoilId" = sr."slitCoilId"
		WHERE %s
		ORDER BY sr."slittingDate" DESC
	`, whereSQL)

	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []SlittingListRow
	for rows.Next() {
		var row SlittingListRow
		if err := rows.Scan(
			&row.SlitCoilId, &row.ParentCoilNumber, &row.SlitWidthSize, &row.SlittingDate,
			&row.SlitCoilWeight, &row.SlitterLocation, &row.DispatchNote, &row.VehicleNumber,
			&row.TransporterName, &row.CreatedAt, &row.UpdatedAt,
			&row.ParentGrade, &row.ParentCoating,
			&row.SunrackID, &row.SunrackDate, &row.SunrackResult, &row.SunrackBin,
			&row.SunrackPhotoCnt,
		); err != nil {
			return nil, err
		}
		items = append(items, row)
	}
	if items == nil {
		items = []SlittingListRow{}
	}
	return items, rows.Err()
}

type SlittingDetail struct {
	Record            SlittingListRow
	ParentSize        string
	ParentWeight      string
	ParentSupplier    string
	SunrackPhotos     []SunrackPhotoRow
	BatchConsumptions []BatchConsumptionRow
}

type SunrackPhotoRow struct {
	ID           string
	Filename     string
	OriginalName string
	Mimetype     string
	Size         int32
	StoragePath  string
	UploadedById pgtype.Text
	CreatedAt    pgtype.Timestamp
}

type BatchConsumptionRow struct {
	ID               string
	BatchNumber      string
	SlitCoilId       string
	QuantityConsumed string
	CreatedAt        pgtype.Timestamp
	BatchProductType string
	BatchQty         string
	BatchDate        pgtype.Timestamp
	BatchOrderNo     string
}

func GetSlittingDetail(ctx context.Context, pool *pgxpool.Pool, slitCoilID string) (*SlittingDetail, error) {
	id := strings.ToUpper(slitCoilID)

	var detail SlittingDetail
	err := pool.QueryRow(ctx, `
		SELECT
			sr."slitCoilId", sr."parentCoilNumber", sr."slitWidthSize", sr."slittingDate",
			sr."slitCoilWeight"::text, sr."slitterLocation", sr."dispatchNote", sr."vehicleNumber",
			sr."transporterName", sr."createdAt", sr."updatedAt",
			c.grade, c.coating, c.size, c.weight::text, c.supplier,
			srr.id, srr."receiptDateSunrack", srr."inspectionResult"::text, srr."storageLocationBin",
			COALESCE((SELECT COUNT(*)::bigint FROM "SunrackReceiptPhoto" p WHERE p."receiptId" = srr.id), 0)
		FROM "SlittingRecord" sr
		INNER JOIN "Coil" c ON c."coilNumber" = sr."parentCoilNumber"
		LEFT JOIN "SunrackReceipt" srr ON srr."slitCoilId" = sr."slitCoilId"
		WHERE sr."slitCoilId" = $1
	`, id).Scan(
		&detail.Record.SlitCoilId, &detail.Record.ParentCoilNumber, &detail.Record.SlitWidthSize, &detail.Record.SlittingDate,
		&detail.Record.SlitCoilWeight, &detail.Record.SlitterLocation, &detail.Record.DispatchNote, &detail.Record.VehicleNumber,
		&detail.Record.TransporterName, &detail.Record.CreatedAt, &detail.Record.UpdatedAt,
		&detail.Record.ParentGrade, &detail.Record.ParentCoating, &detail.ParentSize, &detail.ParentWeight, &detail.ParentSupplier,
		&detail.Record.SunrackID, &detail.Record.SunrackDate, &detail.Record.SunrackResult, &detail.Record.SunrackBin,
		&detail.Record.SunrackPhotoCnt,
	)
	if err != nil {
		return nil, err
	}

	if detail.Record.SunrackID.Valid {
		photoRows, err := pool.Query(ctx, `
			SELECT id, filename, "originalName", mimetype, size, "storagePath", "uploadedById", "createdAt"
			FROM "SunrackReceiptPhoto"
			WHERE "receiptId" = $1
			ORDER BY "createdAt" ASC
		`, detail.Record.SunrackID.String)
		if err != nil {
			return nil, err
		}
		defer photoRows.Close()
		for photoRows.Next() {
			var p SunrackPhotoRow
			if err := photoRows.Scan(&p.ID, &p.Filename, &p.OriginalName, &p.Mimetype, &p.Size, &p.StoragePath, &p.UploadedById, &p.CreatedAt); err != nil {
				return nil, err
			}
			detail.SunrackPhotos = append(detail.SunrackPhotos, p)
		}
		if err := photoRows.Err(); err != nil {
			return nil, err
		}
	}

	batchRows, err := pool.Query(ctx, `
		SELECT
			m.id, m."batchNumber", m."slitCoilId", m."quantityConsumed"::text, m."createdAt",
			b."productType", b."quantityProduced"::text, b."productionDate", b."productionOrderNumber"
		FROM "BatchSlitCoilMap" m
		INNER JOIN "ProductionBatch" b ON b."batchNumber" = m."batchNumber"
		WHERE m."slitCoilId" = $1
		ORDER BY m."createdAt" ASC
	`, id)
	if err != nil {
		return nil, err
	}
	defer batchRows.Close()
	for batchRows.Next() {
		var row BatchConsumptionRow
		if err := batchRows.Scan(
			&row.ID, &row.BatchNumber, &row.SlitCoilId, &row.QuantityConsumed, &row.CreatedAt,
			&row.BatchProductType, &row.BatchQty, &row.BatchDate, &row.BatchOrderNo,
		); err != nil {
			return nil, err
		}
		detail.BatchConsumptions = append(detail.BatchConsumptions, row)
	}
	if detail.BatchConsumptions == nil {
		detail.BatchConsumptions = []BatchConsumptionRow{}
	}
	return &detail, batchRows.Err()
}

// ParseSlittingDate parses ISO or date-only strings.
func ParseSlittingDate(value string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse("2006-01-02", value); err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, fmt.Errorf("invalid slitting date")
}
