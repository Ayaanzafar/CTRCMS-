package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sunrack/ctrcms-go/internal/db"
)

type SiteInstallationListParams struct {
	Search string
	From   string
	To     string
}

type SiteInstallationDispatchLine struct {
	BatchNumber        string
	QuantityDispatched float64
	ProductType        string
}

type SiteInstallationDispatchSummary struct {
	DispatchNoteNumber string
	DispatchDate       pgtype.Timestamp
	ProjectName        string
	ClientName         string
	SiteLocation       string
	VehicleNumber      pgtype.Text
	TransporterName    pgtype.Text
	BatchLines         []SiteInstallationDispatchLine
	TotalQtyDispatched float64
}

type SiteInstallationDetail struct {
	Installation       db.SiteInstallation
	Photos             []db.SiteInstallationPhoto
	PhotoCount         int64
	TotalDispatched    float64
	QuantityInstalled  float64
	Dispatch           SiteInstallationDispatchSummary
}

type PendingDispatchRow struct {
	DispatchNoteNumber string
	DispatchDate       pgtype.Timestamp
	ProjectName        string
	ClientName         string
	SiteLocation       string
	VehicleNumber      pgtype.Text
	TransporterName    pgtype.Text
	TotalQtyDispatched float64
	BatchLines         []SiteInstallationDispatchLine
}

func GetDispatchTotalQuantity(ctx context.Context, queries *db.Queries, dispatchNoteNumber string) (float64, error) {
	total, err := queries.SumDispatchNoteQuantity(ctx, strings.ToUpper(dispatchNoteNumber))
	if err != nil {
		return 0, err
	}
	return numericFromPg(total)
}

func ValidateSiteInstallation(
	ctx context.Context,
	queries *db.Queries,
	dispatchNoteNumber string,
	quantityInstalled float64,
) (bool, string) {
	note := strings.ToUpper(dispatchNoteNumber)

	if _, err := queries.GetSiteDispatchByNoteNumber(ctx, note); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, fmt.Sprintf("Dispatch note %s not found", note)
		}
		return false, "Failed to validate site installation"
	}

	if _, err := queries.GetSiteInstallationByDispatchNote(ctx, note); err == nil {
		return false, fmt.Sprintf("Dispatch note %s already has a site installation record", note)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return false, "Failed to validate site installation"
	}

	totalDispatched, err := GetDispatchTotalQuantity(ctx, queries, note)
	if err != nil {
		return false, "Failed to validate site installation"
	}
	if totalDispatched <= 0 {
		return false, fmt.Sprintf("Dispatch note %s has no quantity to install", note)
	}
	if quantityInstalled <= 0 {
		return false, "Quantity installed must be positive"
	}
	if quantityInstalled > totalDispatched+0.0001 {
		return false, fmt.Sprintf(
			"Quantity installed (%.0f) cannot exceed dispatched total (%.3f)",
			quantityInstalled, totalDispatched,
		)
	}
	return true, ""
}

func ValidateSiteInstallationUpdate(
	ctx context.Context,
	queries *db.Queries,
	installationID, dispatchNoteNumber string,
	quantityInstalled float64,
) (bool, string) {
	note := strings.ToUpper(dispatchNoteNumber)

	totalDispatched, err := GetDispatchTotalQuantity(ctx, queries, note)
	if err != nil {
		return false, "Failed to validate site installation"
	}
	if totalDispatched <= 0 {
		return false, fmt.Sprintf("Dispatch note %s has no quantity to install", note)
	}
	if quantityInstalled <= 0 {
		return false, "Quantity installed must be positive"
	}
	if quantityInstalled > totalDispatched+0.0001 {
		return false, fmt.Sprintf(
			"Quantity installed (%.0f) cannot exceed dispatched total (%.3f)",
			quantityInstalled, totalDispatched,
		)
	}

	if _, err := queries.GetSiteInstallationByID(ctx, installationID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, "Site installation not found"
		}
		return false, "Failed to validate site installation"
	}
	return true, ""
}

func GetSiteInstallationStats(ctx context.Context, queries *db.Queries) (map[string]interface{}, error) {
	totalInstallations, err := queries.CountSiteInstallations(ctx)
	if err != nil {
		return nil, err
	}
	pendingDispatches, err := queries.CountPendingDispatches(ctx)
	if err != nil {
		return nil, err
	}
	photoCount, err := queries.CountSiteInstallationPhotos(ctx)
	if err != nil {
		return nil, err
	}
	sumQty, err := queries.SumQuantityInstalled(ctx)
	if err != nil {
		return nil, err
	}
	totalQtyInstalled, err := numericFromPg(sumQty)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"totalInstallations":     totalInstallations,
		"pendingDispatches":      pendingDispatches,
		"totalQuantityInstalled": totalQtyInstalled,
		"totalPhotos":            photoCount,
	}, nil
}

func ListPendingDispatches(ctx context.Context, pool *pgxpool.Pool, queries *db.Queries) ([]PendingDispatchRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT sd."dispatchNoteNumber", sd."dispatchDate", sd."projectName", sd."clientName",
			sd."siteLocation", sd."vehicleNumber", sd."transporterName"
		FROM "SiteDispatch" sd
		WHERE NOT EXISTS (
			SELECT 1 FROM "SiteInstallation" si WHERE si."dispatchNoteNumber" = sd."dispatchNoteNumber"
		)
		ORDER BY sd."dispatchDate" DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pending []PendingDispatchRow
	for rows.Next() {
		var row PendingDispatchRow
		if err := rows.Scan(
			&row.DispatchNoteNumber, &row.DispatchDate, &row.ProjectName, &row.ClientName,
			&row.SiteLocation, &row.VehicleNumber, &row.TransporterName,
		); err != nil {
			return nil, err
		}

		lines, total, err := loadDispatchLinesForSite(ctx, pool, row.DispatchNoteNumber)
		if err != nil {
			return nil, err
		}
		row.BatchLines = lines
		row.TotalQtyDispatched = total
		pending = append(pending, row)
	}
	if pending == nil {
		pending = []PendingDispatchRow{}
	}
	return pending, rows.Err()
}

func ListSiteInstallations(ctx context.Context, pool *pgxpool.Pool, queries *db.Queries, p SiteInstallationListParams) ([]SiteInstallationDetail, error) {
	ids, err := listSiteInstallationIDsFiltered(ctx, pool, p)
	if err != nil {
		return nil, err
	}

	installations := make([]SiteInstallationDetail, 0, len(ids))
	for _, id := range ids {
		installation, err := queries.GetSiteInstallationByID(ctx, id)
		if err != nil {
			return nil, err
		}
		detail, err := LoadSiteInstallationDetail(ctx, pool, queries, installation)
		if err != nil {
			return nil, err
		}
		installations = append(installations, detail)
	}
	if installations == nil {
		installations = []SiteInstallationDetail{}
	}
	return installations, nil
}

func LoadSiteInstallationDetail(ctx context.Context, pool *pgxpool.Pool, queries *db.Queries, installation db.SiteInstallation) (SiteInstallationDetail, error) {
	photos, err := queries.ListSiteInstallationPhotosByInstallationID(ctx, installation.ID)
	if err != nil {
		return SiteInstallationDetail{}, err
	}
	if photos == nil {
		photos = []db.SiteInstallationPhoto{}
	}

	photoCount, err := queries.CountSiteInstallationPhotosByInstallationID(ctx, installation.ID)
	if err != nil {
		return SiteInstallationDetail{}, err
	}

	qtyInstalled, err := numericFromPg(installation.QuantityInstalled)
	if err != nil {
		return SiteInstallationDetail{}, err
	}

	dispatchSummary, totalDispatched, err := loadSiteInstallationDispatchSummary(ctx, pool, queries, installation.DispatchNoteNumber)
	if err != nil {
		return SiteInstallationDetail{}, err
	}

	return SiteInstallationDetail{
		Installation:      installation,
		Photos:            photos,
		PhotoCount:        photoCount,
		TotalDispatched:   totalDispatched,
		QuantityInstalled: qtyInstalled,
		Dispatch:          dispatchSummary,
	}, nil
}

func loadSiteInstallationDispatchSummary(ctx context.Context, pool *pgxpool.Pool, queries *db.Queries, dispatchNoteNumber string) (SiteInstallationDispatchSummary, float64, error) {
	dispatch, err := queries.GetSiteDispatchByNoteNumber(ctx, dispatchNoteNumber)
	if err != nil {
		return SiteInstallationDispatchSummary{}, 0, err
	}

	lines, total, err := loadDispatchLinesForSite(ctx, pool, dispatchNoteNumber)
	if err != nil {
		return SiteInstallationDispatchSummary{}, 0, err
	}

	return SiteInstallationDispatchSummary{
		DispatchNoteNumber: dispatch.DispatchNoteNumber,
		DispatchDate:       dispatch.DispatchDate,
		ProjectName:          dispatch.ProjectName,
		ClientName:           dispatch.ClientName,
		SiteLocation:         dispatch.SiteLocation,
		VehicleNumber:        dispatch.VehicleNumber,
		TransporterName:      dispatch.TransporterName,
		BatchLines:           lines,
		TotalQtyDispatched:   total,
	}, total, nil
}

func loadDispatchLinesForSite(ctx context.Context, pool *pgxpool.Pool, dispatchNoteNumber string) ([]SiteInstallationDispatchLine, float64, error) {
	rows, err := pool.Query(ctx, `
		SELECT dbl."batchNumber", dbl."quantityDispatched", pb."productType"
		FROM "DispatchBatchLine" dbl
		INNER JOIN "ProductionBatch" pb ON pb."batchNumber" = dbl."batchNumber"
		WHERE dbl."dispatchNoteNumber" = $1
		ORDER BY dbl."createdAt" ASC
	`, dispatchNoteNumber)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var lines []SiteInstallationDispatchLine
	var total float64
	for rows.Next() {
		var line SiteInstallationDispatchLine
		var qty pgtype.Numeric
		if err := rows.Scan(&line.BatchNumber, &qty, &line.ProductType); err != nil {
			return nil, 0, err
		}
		q, err := numericFromPg(qty)
		if err != nil {
			return nil, 0, err
		}
		line.QuantityDispatched = q
		total += q
		lines = append(lines, line)
	}
	if lines == nil {
		lines = []SiteInstallationDispatchLine{}
	}
	return lines, total, rows.Err()
}

func listSiteInstallationIDsFiltered(ctx context.Context, pool *pgxpool.Pool, p SiteInstallationListParams) ([]string, error) {
	var args []interface{}
	where := []string{"1=1"}
	argN := 1

	if p.Search != "" {
		where = append(where, fmt.Sprintf(`(
			si."dispatchNoteNumber" ILIKE $%d OR
			si."installerEpcPartner" ILIKE $%d OR
			sd."projectName" ILIKE $%d OR
			sd."clientName" ILIKE $%d OR
			sd."siteLocation" ILIKE $%d
		)`, argN, argN, argN, argN, argN))
		args = append(args, "%"+p.Search+"%")
		argN++
	}
	if p.From != "" {
		where = append(where, fmt.Sprintf(`si."installationDate" >= $%d::timestamp`, argN))
		args = append(args, p.From)
		argN++
	}
	if p.To != "" {
		where = append(where, fmt.Sprintf(`si."installationDate" <= $%d::timestamp`, argN))
		args = append(args, p.To)
	}

	sql := fmt.Sprintf(`
		SELECT si.id
		FROM "SiteInstallation" si
		INNER JOIN "SiteDispatch" sd ON sd."dispatchNoteNumber" = si."dispatchNoteNumber"
		WHERE %s
		ORDER BY si."installationDate" DESC
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

func ParseSiteInstallationDate(value string) (pgtype.Timestamp, error) {
	t, err := ParseProductionDate(value)
	if err != nil {
		return pgtype.Timestamp{}, err
	}
	return pgtype.Timestamp{Time: t, Valid: true}, nil
}
