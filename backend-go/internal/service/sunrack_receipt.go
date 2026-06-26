package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sunrack/ctrcms-go/internal/db"
)

type SunrackReceiptListParams struct {
	Search string
	Status string
	From   string
	To     string
}

type SlitCoilSummary struct {
	SlitCoilId       string
	ParentCoilNumber string
	SlitWidthSize    string
	SlitCoilWeight   string
	SlittingDate     pgtype.Timestamp
	DispatchNote     pgtype.Text
	VehicleNumber    pgtype.Text
	TransporterName  pgtype.Text
	ParentGrade      string
	ParentCoating    string
}

type SunrackReceiptRow struct {
	Receipt db.SunrackReceipt
	Slit    SlitCoilSummary
}

func ListSunrackReceipts(ctx context.Context, pool *pgxpool.Pool, p SunrackReceiptListParams) ([]SunrackReceiptRow, error) {
	var args []interface{}
	where := []string{"1=1"}
	argN := 1

	if p.Search != "" {
		where = append(where, fmt.Sprintf(`(
			srr."slitCoilId" ILIKE $%d OR
			srr."storageLocationBin" ILIKE $%d OR
			srr."confirmedDispatchNote" ILIKE $%d OR
			sr."parentCoilNumber" ILIKE $%d
		)`, argN, argN, argN, argN))
		args = append(args, "%"+p.Search+"%")
		argN++
	}

	if p.Status != "" && p.Status != "ALL" {
		where = append(where, fmt.Sprintf(`srr."inspectionResult" = $%d::"InspectionResult"`, argN))
		args = append(args, p.Status)
		argN++
	}

	if p.From != "" {
		where = append(where, fmt.Sprintf(`srr."receiptDateSunrack" >= $%d::timestamp`, argN))
		args = append(args, p.From)
		argN++
	}
	if p.To != "" {
		where = append(where, fmt.Sprintf(`srr."receiptDateSunrack" <= $%d::timestamp`, argN))
		args = append(args, p.To)
		argN++
	}

	whereSQL := strings.Join(where, " AND ")
	sql := fmt.Sprintf(`
		SELECT
			srr.id, srr."slitCoilId", srr."receiptDateSunrack", srr."storageLocationBin",
			srr."inspectionResult", srr."inspectionRemarks", srr."confirmedDispatchNote",
			srr."createdAt", srr."updatedAt",
			sr."slitCoilId", sr."parentCoilNumber", sr."slitWidthSize", sr."slittingDate",
			sr."slitCoilWeight"::text, sr."dispatchNote", sr."vehicleNumber", sr."transporterName",
			c.grade, c.coating, c."coilNumber"
		FROM "SunrackReceipt" srr
		INNER JOIN "SlittingRecord" sr ON sr."slitCoilId" = srr."slitCoilId"
		INNER JOIN "Coil" c ON c."coilNumber" = sr."parentCoilNumber"
		WHERE %s
		ORDER BY srr."receiptDateSunrack" DESC
	`, whereSQL)

	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []SunrackReceiptRow
	for rows.Next() {
		var row SunrackReceiptRow
		if err := rows.Scan(
			&row.Receipt.ID, &row.Receipt.SlitCoilId, &row.Receipt.ReceiptDateSunrack, &row.Receipt.StorageLocationBin,
			&row.Receipt.InspectionResult, &row.Receipt.InspectionRemarks, &row.Receipt.ConfirmedDispatchNote,
			&row.Receipt.CreatedAt, &row.Receipt.UpdatedAt,
			&row.Slit.SlitCoilId, &row.Slit.ParentCoilNumber, &row.Slit.SlitWidthSize, &row.Slit.SlittingDate,
			&row.Slit.SlitCoilWeight, &row.Slit.DispatchNote, &row.Slit.VehicleNumber, &row.Slit.TransporterName,
			&row.Slit.ParentGrade, &row.Slit.ParentCoating,
		); err != nil {
			return nil, err
		}
		items = append(items, row)
	}
	if items == nil {
		items = []SunrackReceiptRow{}
	}
	return items, rows.Err()
}

func ListPendingSlitCoils(ctx context.Context, pool *pgxpool.Pool, search string) ([]SlitCoilSummary, error) {
	var args []interface{}
	where := []string{`srr.id IS NULL`}
	argN := 1

	if search != "" {
		where = append(where, fmt.Sprintf(`(
			sr."slitCoilId" ILIKE $%d OR
			sr."parentCoilNumber" ILIKE $%d OR
			sr."dispatchNote" ILIKE $%d
		)`, argN, argN, argN))
		args = append(args, "%"+search+"%")
	}

	whereSQL := strings.Join(where, " AND ")
	sql := fmt.Sprintf(`
		SELECT
			sr."slitCoilId", sr."parentCoilNumber", sr."slitWidthSize", sr."slittingDate",
			sr."slitCoilWeight"::text, sr."dispatchNote", sr."vehicleNumber", sr."transporterName",
			c.grade, c.coating, c."coilNumber"
		FROM "SlittingRecord" sr
		LEFT JOIN "SunrackReceipt" srr ON srr."slitCoilId" = sr."slitCoilId"
		INNER JOIN "Coil" c ON c."coilNumber" = sr."parentCoilNumber"
		WHERE %s
		ORDER BY sr."slittingDate" DESC
	`, whereSQL)

	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []SlitCoilSummary
	for rows.Next() {
		var row SlitCoilSummary
		if err := rows.Scan(
			&row.SlitCoilId, &row.ParentCoilNumber, &row.SlitWidthSize, &row.SlittingDate,
			&row.SlitCoilWeight, &row.DispatchNote, &row.VehicleNumber, &row.TransporterName,
			&row.ParentGrade, &row.ParentCoating,
		); err != nil {
			return nil, err
		}
		items = append(items, row)
	}
	if items == nil {
		items = []SlitCoilSummary{}
	}
	return items, rows.Err()
}

func LoadSunrackReceiptInclude(ctx context.Context, pool *pgxpool.Pool, receipt db.SunrackReceipt) (SunrackReceiptRow, []db.SunrackReceiptPhoto, int64, error) {
	var row SunrackReceiptRow
	row.Receipt = receipt
	err := pool.QueryRow(ctx, `
		SELECT
			sr."slitCoilId", sr."parentCoilNumber", sr."slitWidthSize", sr."slittingDate",
			sr."slitCoilWeight"::text, sr."dispatchNote", sr."vehicleNumber", sr."transporterName",
			c.grade, c.coating, c."coilNumber"
		FROM "SlittingRecord" sr
		INNER JOIN "Coil" c ON c."coilNumber" = sr."parentCoilNumber"
		WHERE sr."slitCoilId" = $1
	`, receipt.SlitCoilId).Scan(
		&row.Slit.SlitCoilId, &row.Slit.ParentCoilNumber, &row.Slit.SlitWidthSize, &row.Slit.SlittingDate,
		&row.Slit.SlitCoilWeight, &row.Slit.DispatchNote, &row.Slit.VehicleNumber, &row.Slit.TransporterName,
		&row.Slit.ParentGrade, &row.Slit.ParentCoating,
	)
	if err != nil {
		return row, nil, 0, err
	}

	photoRows, err := pool.Query(ctx, `
		SELECT id, "receiptId", filename, "originalName", mimetype, size, "storagePath", "uploadedById", "createdAt"
		FROM "SunrackReceiptPhoto"
		WHERE "receiptId" = $1
		ORDER BY "createdAt" ASC
	`, receipt.ID)
	if err != nil {
		return row, nil, 0, err
	}
	defer photoRows.Close()

	var photos []db.SunrackReceiptPhoto
	for photoRows.Next() {
		var p db.SunrackReceiptPhoto
		if err := photoRows.Scan(&p.ID, &p.ReceiptId, &p.Filename, &p.OriginalName, &p.Mimetype, &p.Size, &p.StoragePath, &p.UploadedById, &p.CreatedAt); err != nil {
			return row, nil, 0, err
		}
		photos = append(photos, p)
	}
	if photos == nil {
		photos = []db.SunrackReceiptPhoto{}
	}
	return row, photos, int64(len(photos)), photoRows.Err()
}

func GetSunrackReceiptStats(ctx context.Context, queries *db.Queries) (map[string]int64, error) {
	total, err := queries.CountSunrackReceiptsTotal(ctx)
	if err != nil {
		return nil, err
	}
	pending, err := queries.CountPendingSlitCoils(ctx)
	if err != nil {
		return nil, err
	}
	pass, err := queries.CountSunrackReceiptsByInspection(ctx, db.InspectionResultPASS)
	if err != nil {
		return nil, err
	}
	fail, err := queries.CountSunrackReceiptsByInspection(ctx, db.InspectionResultFAIL)
	if err != nil {
		return nil, err
	}
	return map[string]int64{
		"totalReceipts":       total,
		"pendingSlitCoils":  pending,
		"passedInspections": pass,
		"failedInspections": fail,
	}, nil
}

func LoadReceiptPhotosByReceiptIDs(ctx context.Context, pool *pgxpool.Pool, receiptIDs []string) (map[string][]db.SunrackReceiptPhoto, error) {
	out := make(map[string][]db.SunrackReceiptPhoto)
	if len(receiptIDs) == 0 {
		return out, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT id, "receiptId", filename, "originalName", mimetype, size, "storagePath", "uploadedById", "createdAt"
		FROM "SunrackReceiptPhoto"
		WHERE "receiptId" = ANY($1)
		ORDER BY "createdAt" ASC
	`, receiptIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p db.SunrackReceiptPhoto
		if err := rows.Scan(&p.ID, &p.ReceiptId, &p.Filename, &p.OriginalName, &p.Mimetype, &p.Size, &p.StoragePath, &p.UploadedById, &p.CreatedAt); err != nil {
			return nil, err
		}
		out[p.ReceiptId] = append(out[p.ReceiptId], p)
	}
	return out, rows.Err()
}

// Ensure pgx used
var _ = pgx.ErrNoRows
