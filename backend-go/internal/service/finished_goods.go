package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sunrack/ctrcms-go/internal/db"
)

type FinishedGoodsListParams struct {
	Search        string
	ProductType   string
	AvailableOnly bool
}

type FinishedGoodsInventoryRow struct {
	Batch              db.ProductionBatch
	LatestQc           db.QCInspection
	SlitCoilCount      int64
	QuantityDispatched float64
	QuantityAvailable  float64
	QuantityProduced   float64
}

type FinishedGoodsStatsResult struct {
	QcPassedBatches     int64
	TotalUnitsProduced  float64
	TotalUnitsDispatched float64
	TotalUnitsAvailable float64
	ByProductType       map[string]ProductTypeStats
}

type ProductTypeStats struct {
	Batches   int64
	Available float64
}

func GetBatchDispatchedQuantity(ctx context.Context, queries *db.Queries, batchNumber string) (float64, error) {
	total, err := queries.SumBatchDispatchedQuantity(ctx, strings.ToUpper(batchNumber))
	if err != nil {
		return 0, err
	}
	return numericFromPg(total)
}

func ComputeAvailableQuantity(quantityProduced, quantityDispatched float64) float64 {
	return math.Max(0, quantityProduced-quantityDispatched)
}

func ListFinishedGoodsInventory(ctx context.Context, pool *pgxpool.Pool, queries *db.Queries, p FinishedGoodsListParams) ([]FinishedGoodsInventoryRow, error) {
	batches, err := listProductionBatchesForFinishedGoods(ctx, pool, p)
	if err != nil {
		return nil, err
	}

	var items []FinishedGoodsInventoryRow
	for _, batch := range batches {
		row, ok, err := buildFinishedGoodsRow(ctx, pool, queries, batch)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		if p.AvailableOnly && row.QuantityAvailable <= 0 {
			continue
		}
		items = append(items, row)
	}
	if items == nil {
		items = []FinishedGoodsInventoryRow{}
	}
	return items, nil
}

func GetFinishedGoodsStats(ctx context.Context, pool *pgxpool.Pool, queries *db.Queries) (FinishedGoodsStatsResult, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			pb."batchNumber", pb."productionOrderNumber", pb."productType", pb."quantityProduced",
			pb."productionDate", pb."operatorShift", pb."createdAt", pb."updatedAt",
			latest.id, latest."qcResult", latest."inspectorName", latest."inspectionDate",
			latest."qcRemarks", latest."createdAt", latest."updatedAt"
		FROM "ProductionBatch" pb
		LEFT JOIN LATERAL (
			SELECT qi.*
			FROM "QCInspection" qi
			WHERE qi."batchNumber" = pb."batchNumber"
			ORDER BY qi."inspectionDate" DESC
			LIMIT 1
		) latest ON true
	`)
	if err != nil {
		return FinishedGoodsStatsResult{}, err
	}
	defer rows.Close()

	result := FinishedGoodsStatsResult{ByProductType: map[string]ProductTypeStats{}}
	for rows.Next() {
		var batch db.ProductionBatch
		var latestID, latestInspector pgtype.Text
		var latestResult db.NullQcResult
		var latestInspectionDate, latestCreatedAt, latestUpdatedAt pgtype.Timestamp
		var latestRemarks pgtype.Text

		if err := rows.Scan(
			&batch.BatchNumber, &batch.ProductionOrderNumber, &batch.ProductType, &batch.QuantityProduced,
			&batch.ProductionDate, &batch.OperatorShift, &batch.CreatedAt, &batch.UpdatedAt,
			&latestID, &latestResult, &latestInspector, &latestInspectionDate,
			&latestRemarks, &latestCreatedAt, &latestUpdatedAt,
		); err != nil {
			return FinishedGoodsStatsResult{}, err
		}
		if !latestResult.Valid || latestResult.QcResult != db.QcResultPASS {
			continue
		}

		produced, err := numericFromPg(batch.QuantityProduced)
		if err != nil {
			return FinishedGoodsStatsResult{}, err
		}
		dispatched, err := GetBatchDispatchedQuantity(ctx, queries, batch.BatchNumber)
		if err != nil {
			return FinishedGoodsStatsResult{}, err
		}
		available := ComputeAvailableQuantity(produced, dispatched)

		result.QcPassedBatches++
		result.TotalUnitsProduced += produced
		result.TotalUnitsDispatched += dispatched
		result.TotalUnitsAvailable += available

		pt := result.ByProductType[batch.ProductType]
		pt.Batches++
		pt.Available += available
		result.ByProductType[batch.ProductType] = pt
	}
	return result, rows.Err()
}

func GetFinishedGoodsInventoryRow(ctx context.Context, pool *pgxpool.Pool, queries *db.Queries, batchNumber string) (FinishedGoodsInventoryRow, bool, error) {
	var batch db.ProductionBatch
	err := pool.QueryRow(ctx, `
		SELECT "batchNumber", "productionOrderNumber", "productType", "quantityProduced",
			"productionDate", "operatorShift", "createdAt", "updatedAt"
		FROM "ProductionBatch"
		WHERE "batchNumber" = $1
	`, batchNumber).Scan(
		&batch.BatchNumber, &batch.ProductionOrderNumber, &batch.ProductType, &batch.QuantityProduced,
		&batch.ProductionDate, &batch.OperatorShift, &batch.CreatedAt, &batch.UpdatedAt,
	)
	if err != nil {
		return FinishedGoodsInventoryRow{}, false, err
	}
	return buildFinishedGoodsRow(ctx, pool, queries, batch)
}

func buildFinishedGoodsRow(ctx context.Context, pool *pgxpool.Pool, queries *db.Queries, batch db.ProductionBatch) (FinishedGoodsInventoryRow, bool, error) {
	latest, err := queries.GetLatestQcInspectionByBatch(ctx, batch.BatchNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return FinishedGoodsInventoryRow{}, false, nil
		}
		return FinishedGoodsInventoryRow{}, false, err
	}
	if latest.QcResult != db.QcResultPASS {
		return FinishedGoodsInventoryRow{}, false, nil
	}

	produced, err := numericFromPg(batch.QuantityProduced)
	if err != nil {
		return FinishedGoodsInventoryRow{}, false, err
	}
	dispatched, err := GetBatchDispatchedQuantity(ctx, queries, batch.BatchNumber)
	if err != nil {
		return FinishedGoodsInventoryRow{}, false, err
	}

	var slitCoilCount int64
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM "BatchSlitCoilMap" WHERE "batchNumber" = $1
	`, batch.BatchNumber).Scan(&slitCoilCount); err != nil {
		return FinishedGoodsInventoryRow{}, false, err
	}

	return FinishedGoodsInventoryRow{
		Batch:              batch,
		LatestQc:           latest,
		SlitCoilCount:      slitCoilCount,
		QuantityProduced:   produced,
		QuantityDispatched: dispatched,
		QuantityAvailable:  ComputeAvailableQuantity(produced, dispatched),
	}, true, nil
}

func listProductionBatchesForFinishedGoods(ctx context.Context, pool *pgxpool.Pool, p FinishedGoodsListParams) ([]db.ProductionBatch, error) {
	var args []interface{}
	where := []string{"1=1"}
	argN := 1

	if p.Search != "" {
		where = append(where, fmt.Sprintf(`(
			pb."batchNumber" ILIKE $%d OR
			pb."productionOrderNumber" ILIKE $%d OR
			pb."productType" ILIKE $%d
		)`, argN, argN, argN))
		args = append(args, "%"+p.Search+"%")
		argN++
	}
	if p.ProductType != "" {
		where = append(where, fmt.Sprintf(`pb."productType" ILIKE $%d`, argN))
		args = append(args, "%"+p.ProductType+"%")
		argN++
	}

	sql := fmt.Sprintf(`
		SELECT pb."batchNumber", pb."productionOrderNumber", pb."productType", pb."quantityProduced",
			pb."productionDate", pb."operatorShift", pb."createdAt", pb."updatedAt"
		FROM "ProductionBatch" pb
		WHERE %s
		ORDER BY pb."productionDate" DESC
	`, strings.Join(where, " AND "))

	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var batches []db.ProductionBatch
	for rows.Next() {
		var batch db.ProductionBatch
		if err := rows.Scan(
			&batch.BatchNumber, &batch.ProductionOrderNumber, &batch.ProductType, &batch.QuantityProduced,
			&batch.ProductionDate, &batch.OperatorShift, &batch.CreatedAt, &batch.UpdatedAt,
		); err != nil {
			return nil, err
		}
		batches = append(batches, batch)
	}
	return batches, rows.Err()
}

func numericFromPg(n pgtype.Numeric) (float64, error) {
	f, err := n.Float64Value()
	if err == nil && f.Valid {
		return f.Float64, nil
	}
	v, err := strconv.ParseFloat(NumericToString(n), 64)
	if err != nil {
		return 0, err
	}
	return v, nil
}
