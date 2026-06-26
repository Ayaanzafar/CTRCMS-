package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/db"
	"github.com/sunrack/ctrcms-go/internal/service"
)

type FinishedGoodsHandler struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
}

func (h *FinishedGoodsHandler) List(c echo.Context) error {
	params := service.FinishedGoodsListParams{
		Search:        strings.TrimSpace(c.QueryParam("search")),
		ProductType:   strings.TrimSpace(c.QueryParam("productType")),
		AvailableOnly: c.QueryParam("availableOnly") == "true",
	}

	ctx := c.Request().Context()
	rows, err := service.ListFinishedGoodsInventory(ctx, h.Pool, h.Queries, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list finished goods inventory"})
	}

	inventory := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		inventory = append(inventory, finishedGoodsInventoryJSON(row))
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"inventory": inventory})
}

func (h *FinishedGoodsHandler) Stats(c echo.Context) error {
	stats, err := service.GetFinishedGoodsStats(c.Request().Context(), h.Pool, h.Queries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load stats"})
	}

	byProductType := make(map[string]map[string]interface{}, len(stats.ByProductType))
	for productType, pt := range stats.ByProductType {
		byProductType[productType] = map[string]interface{}{
			"batches":   pt.Batches,
			"available": pt.Available,
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"stats": map[string]interface{}{
			"qcPassedBatches":     stats.QcPassedBatches,
			"totalUnitsProduced":  stats.TotalUnitsProduced,
			"totalUnitsDispatched": stats.TotalUnitsDispatched,
			"totalUnitsAvailable": stats.TotalUnitsAvailable,
			"byProductType":       byProductType,
		},
	})
}

func (h *FinishedGoodsHandler) Get(c echo.Context) error {
	batchNumber := strings.ToUpper(c.Param("batchNumber"))
	ctx := c.Request().Context()

	row, ok, err := service.GetFinishedGoodsInventoryRow(ctx, h.Pool, h.Queries, batchNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Batch not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load finished goods item"})
	}
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Batch is not in finished goods inventory (QC Pass required)",
		})
	}

	item := finishedGoodsInventoryJSON(row)

	consumptions, err := service.LoadBatchConsumptionsDetail(ctx, h.Pool, batchNumber)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load finished goods item"})
	}
	consJSON := make([]map[string]interface{}, 0, len(consumptions))
	for _, c := range consumptions {
		consJSON = append(consJSON, map[string]interface{}{
			"id":               c.Map.ID,
			"batchNumber":      c.Map.BatchNumber,
			"slitCoilId":       c.Map.SlitCoilId,
			"quantityConsumed": service.NumericToString(c.Map.QuantityConsumed),
			"createdAt":        formatTimestamp(c.Map.CreatedAt),
			"slitCoil": map[string]interface{}{
				"slitCoilId":       c.SlitCoilId,
				"parentCoilNumber": c.ParentCoilNumber,
				"slitWidthSize":    c.SlitWidthSize,
			},
		})
	}

	photos, err := service.LoadQcPhotos(ctx, h.Queries, row.LatestQc.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load finished goods item"})
	}
	photoJSON := make([]map[string]interface{}, 0, len(photos))
	for _, p := range photos {
		photoJSON = append(photoJSON, map[string]interface{}{
			"id":           p.ID,
			"originalName": p.OriginalName,
		})
	}

	item["slitCoilConsumptions"] = consJSON
	item["qcInspection"] = map[string]interface{}{
		"id":             row.LatestQc.ID,
		"batchNumber":    row.LatestQc.BatchNumber,
		"qcResult":       string(row.LatestQc.QcResult),
		"inspectorName":  row.LatestQc.InspectorName,
		"inspectionDate": formatTimestamp(row.LatestQc.InspectionDate),
		"qcRemarks":      textValue(row.LatestQc.QcRemarks),
		"createdAt":      formatTimestamp(row.LatestQc.CreatedAt),
		"updatedAt":      formatTimestamp(row.LatestQc.UpdatedAt),
		"photos":         photoJSON,
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"item": item})
}

func finishedGoodsInventoryJSON(row service.FinishedGoodsInventoryRow) map[string]interface{} {
	return map[string]interface{}{
		"batchNumber":           row.Batch.BatchNumber,
		"productionOrderNumber": row.Batch.ProductionOrderNumber,
		"productType":           row.Batch.ProductType,
		"quantityProduced":        row.QuantityProduced,
		"quantityDispatched":      row.QuantityDispatched,
		"quantityAvailable":       row.QuantityAvailable,
		"productionDate":          formatTimestamp(row.Batch.ProductionDate),
		"operatorShift":           row.Batch.OperatorShift,
		"qcInspection": map[string]interface{}{
			"id":             row.LatestQc.ID,
			"qcResult":       string(row.LatestQc.QcResult),
			"inspectionDate": formatTimestamp(row.LatestQc.InspectionDate),
			"inspectorName":  row.LatestQc.InspectorName,
		},
		"slitCoilCount": row.SlitCoilCount,
	}
}
