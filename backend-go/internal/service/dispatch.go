package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sunrack/ctrcms-go/internal/db"
)

type DispatchListParams struct {
	Search      string
	ProjectName string
	From        string
	To          string
}

type DispatchBatchLineInput struct {
	BatchNumber        string
	QuantityDispatched float64
}

type DispatchBatchLineDetail struct {
	Line                    db.DispatchBatchLine
	Batch                   *db.ProductionBatch
	LineQuantityDispatched  float64
	BatchQuantityDispatched float64
	QuantityProduced        float64
	QuantityAvailable       float64
}

type SiteInstallationSummary struct {
	ID                  string
	DispatchNoteNumber  string
	SiteReceiptDate     pgtype.Timestamp
	InstallationDate    pgtype.Timestamp
	InstallerEpcPartner string
	QuantityInstalled   float64
	PhotoCount          int64
}

type DispatchRecord struct {
	Dispatch           db.SiteDispatch
	BatchLines         []DispatchBatchLineDetail
	TotalQtyDispatched float64
	SiteInstallation   *SiteInstallationSummary
}

func GenerateNextDispatchNoteNumber(ctx context.Context, queries *db.Queries) (string, error) {
	year := time.Now().Year()
	prefix := fmt.Sprintf("DN-SR-%d-", year)

	latest, err := queries.GetLatestDispatchNoteByPrefix(ctx, pgtype.Text{String: prefix, Valid: true})
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

func IsBatchDispatchEligible(ctx context.Context, queries *db.Queries, batchNumber string) (bool, error) {
	latest, err := queries.GetLatestQcInspectionByBatch(ctx, strings.ToUpper(batchNumber))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return latest.QcResult == db.QcResultPASS, nil
}

func ValidateDispatchBatchLines(
	ctx context.Context,
	queries *db.Queries,
	lines []DispatchBatchLineInput,
	excludeDispatchNoteNumber string,
) (bool, string) {
	if len(lines) == 0 {
		return false, "At least one batch line is required"
	}

	seen := make(map[string]struct{}, len(lines))
	for _, line := range lines {
		batchNumber := strings.ToUpper(strings.TrimSpace(line.BatchNumber))
		if batchNumber == "" {
			return false, "At least one batch line is required"
		}
		if _, dup := seen[batchNumber]; dup {
			return false, fmt.Sprintf("Duplicate batch %s in dispatch lines", batchNumber)
		}
		seen[batchNumber] = struct{}{}

		batch, err := queries.GetProductionBatchByNumber(ctx, batchNumber)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return false, fmt.Sprintf("Production batch %s not found", batchNumber)
			}
			return false, "Failed to validate dispatch lines"
		}

		eligible, err := IsBatchDispatchEligible(ctx, queries, batchNumber)
		if err != nil {
			return false, "Failed to validate dispatch lines"
		}
		if !eligible {
			return false, fmt.Sprintf("Batch %s is not QC Pass — only QC-passed batches can be dispatched", batchNumber)
		}

		if line.QuantityDispatched <= 0 {
			return false, fmt.Sprintf("Quantity dispatched for %s must be positive", batchNumber)
		}

		var alreadyDispatched float64
		if excludeDispatchNoteNumber != "" {
			total, err := queries.SumBatchDispatchedQuantityExcludingNote(ctx, db.SumBatchDispatchedQuantityExcludingNoteParams{
				BatchNumber:               batchNumber,
				ExcludeDispatchNoteNumber: strings.ToUpper(excludeDispatchNoteNumber),
			})
			if err != nil {
				return false, "Failed to validate dispatch lines"
			}
			alreadyDispatched, err = numericFromPg(total)
			if err != nil {
				return false, "Failed to validate dispatch lines"
			}
		} else {
			var err error
			alreadyDispatched, err = GetBatchDispatchedQuantity(ctx, queries, batchNumber)
			if err != nil {
				return false, "Failed to validate dispatch lines"
			}
		}

		produced, err := numericFromPg(batch.QuantityProduced)
		if err != nil {
			return false, "Failed to validate dispatch lines"
		}
		remaining := produced - alreadyDispatched
		if line.QuantityDispatched > remaining+0.0001 {
			return false, fmt.Sprintf(
				"Batch %s only has %.3f units available (%.0f produced, %.3f already dispatched)",
				batchNumber, remaining, produced, alreadyDispatched,
			)
		}
	}
	return true, ""
}

func GetDispatchStats(ctx context.Context, queries *db.Queries) (map[string]interface{}, error) {
	total, err := queries.CountSiteDispatches(ctx)
	if err != nil {
		return nil, err
	}
	sumQty, err := queries.SumAllDispatchedQuantity(ctx)
	if err != nil {
		return nil, err
	}
	projects, err := queries.CountDistinctDispatchProjects(ctx)
	if err != nil {
		return nil, err
	}
	totalUnits, err := numericFromPg(sumQty)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"totalDispatches":      total,
		"totalUnitsDispatched": totalUnits,
		"activeProjects":       projects,
	}, nil
}

func ListDispatches(ctx context.Context, pool *pgxpool.Pool, queries *db.Queries, p DispatchListParams) ([]DispatchRecord, error) {
	dispatches, err := listSiteDispatchesFiltered(ctx, pool, p)
	if err != nil {
		return nil, err
	}

	records := make([]DispatchRecord, 0, len(dispatches))
	for _, dispatch := range dispatches {
		record, err := LoadDispatchRecord(ctx, queries, dispatch)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if records == nil {
		records = []DispatchRecord{}
	}
	return records, nil
}

func LoadDispatchRecord(ctx context.Context, queries *db.Queries, dispatch db.SiteDispatch) (DispatchRecord, error) {
	lines, err := queries.ListDispatchBatchLinesByNote(ctx, dispatch.DispatchNoteNumber)
	if err != nil {
		return DispatchRecord{}, err
	}

	lineDetails := make([]DispatchBatchLineDetail, 0, len(lines))
	var totalQty float64
	for _, line := range lines {
		detail, err := buildDispatchBatchLineDetail(ctx, queries, line)
		if err != nil {
			return DispatchRecord{}, err
		}
		qty, err := numericFromPg(line.QuantityDispatched)
		if err != nil {
			return DispatchRecord{}, err
		}
		totalQty += qty
		lineDetails = append(lineDetails, detail)
	}

	var siteInstall *SiteInstallationSummary
	summary, err := queries.GetSiteInstallationSummaryByDispatchNote(ctx, dispatch.DispatchNoteNumber)
	if err == nil {
		qtyInstalled, err := numericFromPg(summary.QuantityInstalled)
		if err != nil {
			return DispatchRecord{}, err
		}
		siteInstall = &SiteInstallationSummary{
			ID:                  summary.ID,
			DispatchNoteNumber:  summary.DispatchNoteNumber,
			SiteReceiptDate:     summary.SiteReceiptDate,
			InstallationDate:    summary.InstallationDate,
			InstallerEpcPartner: summary.InstallerEpcPartner,
			QuantityInstalled:   qtyInstalled,
			PhotoCount:          summary.PhotoCount,
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return DispatchRecord{}, err
	}

	return DispatchRecord{
		Dispatch:           dispatch,
		BatchLines:         lineDetails,
		TotalQtyDispatched: totalQty,
		SiteInstallation:   siteInstall,
	}, nil
}

func buildDispatchBatchLineDetail(ctx context.Context, queries *db.Queries, line db.DispatchBatchLine) (DispatchBatchLineDetail, error) {
	lineQty, err := numericFromPg(line.QuantityDispatched)
	if err != nil {
		return DispatchBatchLineDetail{}, err
	}

	detail := DispatchBatchLineDetail{
		Line:                   line,
		LineQuantityDispatched: lineQty,
	}

	batch, err := queries.GetProductionBatchByNumber(ctx, line.BatchNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return detail, nil
		}
		return DispatchBatchLineDetail{}, err
	}

	produced, err := numericFromPg(batch.QuantityProduced)
	if err != nil {
		return DispatchBatchLineDetail{}, err
	}
	totalDispatched, err := GetBatchDispatchedQuantity(ctx, queries, line.BatchNumber)
	if err != nil {
		return DispatchBatchLineDetail{}, err
	}

	detail.Batch = &batch
	detail.QuantityProduced = produced
	detail.BatchQuantityDispatched = totalDispatched
	detail.QuantityAvailable = ComputeAvailableQuantity(produced, totalDispatched)
	return detail, nil
}

func listSiteDispatchesFiltered(ctx context.Context, pool *pgxpool.Pool, p DispatchListParams) ([]db.SiteDispatch, error) {
	var args []interface{}
	where := []string{"1=1"}
	argN := 1

	if p.Search != "" {
		where = append(where, fmt.Sprintf(`(
			sd."dispatchNoteNumber" ILIKE $%d OR
			sd."projectName" ILIKE $%d OR
			sd."clientName" ILIKE $%d OR
			sd."siteLocation" ILIKE $%d OR
			sd."vehicleNumber" ILIKE $%d OR
			sd."transporterName" ILIKE $%d OR
			EXISTS (
				SELECT 1 FROM "DispatchBatchLine" dbl
				WHERE dbl."dispatchNoteNumber" = sd."dispatchNoteNumber"
				  AND dbl."batchNumber" ILIKE $%d
			)
		)`, argN, argN, argN, argN, argN, argN, argN))
		args = append(args, "%"+p.Search+"%")
		argN++
	}
	if p.ProjectName != "" {
		where = append(where, fmt.Sprintf(`sd."projectName" ILIKE $%d`, argN))
		args = append(args, "%"+p.ProjectName+"%")
		argN++
	}
	if p.From != "" {
		where = append(where, fmt.Sprintf(`sd."dispatchDate" >= $%d::timestamp`, argN))
		args = append(args, p.From)
		argN++
	}
	if p.To != "" {
		where = append(where, fmt.Sprintf(`sd."dispatchDate" <= $%d::timestamp`, argN))
		args = append(args, p.To)
	}

	sql := fmt.Sprintf(`
		SELECT sd."dispatchNoteNumber", sd."dispatchDate", sd."vehicleNumber", sd."transporterName",
			sd."projectName", sd."clientName", sd."siteLocation", sd."createdAt", sd."updatedAt"
		FROM "SiteDispatch" sd
		WHERE %s
		ORDER BY sd."dispatchDate" DESC
	`, strings.Join(where, " AND "))

	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var dispatches []db.SiteDispatch
	for rows.Next() {
		var d db.SiteDispatch
		if err := rows.Scan(
			&d.DispatchNoteNumber, &d.DispatchDate, &d.VehicleNumber, &d.TransporterName,
			&d.ProjectName, &d.ClientName, &d.SiteLocation, &d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			return nil, err
		}
		dispatches = append(dispatches, d)
	}
	return dispatches, rows.Err()
}

func ParseDispatchDate(value string) (pgtype.Timestamp, error) {
	t, err := ParseProductionDate(value)
	if err != nil {
		return pgtype.Timestamp{}, err
	}
	return pgtype.Timestamp{Time: t, Valid: true}, nil
}
