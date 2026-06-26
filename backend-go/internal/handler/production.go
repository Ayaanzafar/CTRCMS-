package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/db"
	"github.com/sunrack/ctrcms-go/internal/middleware"
	"github.com/sunrack/ctrcms-go/internal/service"
)

type ProductionHandler struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
}

type consumptionLineRequest struct {
	SlitCoilId       string  `json:"slitCoilId"`
	QuantityConsumed float64 `json:"quantityConsumed"`
}

type createProductionBatchRequest struct {
	BatchNumber           *string                  `json:"batchNumber"`
	ProductionOrderNumber string                   `json:"productionOrderNumber"`
	ProductType           string                   `json:"productType"`
	QuantityProduced      float64                  `json:"quantityProduced"`
	ProductionDate        string                   `json:"productionDate"`
	OperatorShift         string                   `json:"operatorShift"`
	SlitCoilConsumptions  []consumptionLineRequest `json:"slitCoilConsumptions"`
}

type issueSlitCoilsRequest struct {
	SlitCoilConsumptions []consumptionLineRequest `json:"slitCoilConsumptions"`
}

type updateProductionBatchRequest struct {
	ProductionOrderNumber *string  `json:"productionOrderNumber"`
	ProductType           *string  `json:"productType"`
	QuantityProduced      *float64 `json:"quantityProduced"`
	ProductionDate          *string  `json:"productionDate"`
	OperatorShift         *string  `json:"operatorShift"`
}

func (h *ProductionHandler) List(c echo.Context) error {
	params := service.ProductionListParams{
		Search:      strings.TrimSpace(c.QueryParam("search")),
		ProductType: strings.TrimSpace(c.QueryParam("productType")),
		From:        c.QueryParam("from"),
		To:          c.QueryParam("to"),
	}

	ctx := c.Request().Context()
	rows, err := service.ListProductionBatches(ctx, h.Pool, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list production batches"})
	}

	batches := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		batchJSON, err := h.buildBatchListJSON(ctx, row.Batch)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list production batches"})
		}
		batches = append(batches, batchJSON)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"batches": batches})
}

func (h *ProductionHandler) Stats(c echo.Context) error {
	stats, err := service.GetProductionStats(c.Request().Context(), h.Queries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load stats"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"stats": stats})
}

func (h *ProductionHandler) AvailableSlitCoils(c echo.Context) error {
	search := strings.TrimSpace(c.QueryParam("search"))
	rows, err := service.ListAvailableSlitCoils(c.Request().Context(), h.Pool, search)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list available slit coils"})
	}

	available := make([]map[string]interface{}, 0)
	for _, row := range rows {
		total, _ := strconvParseFloat(row.SlitCoilWeight)
		consumed, _ := strconvParseFloat(row.ConsumedTotal)
		remaining := service.RoundRemaining(total, consumed)
		if remaining <= 0.0001 {
			continue
		}
		item := map[string]interface{}{
			"slitCoilId":        row.SlitCoilId,
			"parentCoilNumber":  row.ParentCoilNumber,
			"slitWidthSize":     row.SlitWidthSize,
			"slitCoilWeight":    row.SlitCoilWeight,
			"remainingQuantity": remaining,
			"parentCoil": map[string]string{
				"coilNumber": row.ParentCoilNumber,
				"grade":      row.ParentGrade,
				"coating":    row.ParentCoating,
			},
		}
		if row.StorageBin.Valid {
			item["sunrackReceipt"] = map[string]interface{}{
				"storageLocationBin": row.StorageBin.String,
				"inspectionResult": row.InspectionResult.String,
			}
		}
		available = append(available, item)
	}
	if available == nil {
		available = []map[string]interface{}{}
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"available": available})
}

func (h *ProductionHandler) PreviewBatchNumber(c echo.Context) error {
	batchNumber, err := service.GenerateNextBatchNumber(c.Request().Context(), h.Queries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to preview batch number"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"batchNumber": batchNumber})
}

func (h *ProductionHandler) Get(c echo.Context) error {
	batchNumber := strings.ToUpper(c.Param("batchNumber"))
	batch, err := h.Queries.GetProductionBatchByNumber(c.Request().Context(), batchNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Production batch not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load production batch"})
	}
	batchJSON, err := h.buildBatchDetailJSON(c.Request().Context(), batch)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load production batch"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"batch": batchJSON})
}

func (h *ProductionHandler) SlitCoilUsage(c echo.Context) error {
	slitCoilID := strings.ToUpper(c.Param("slitCoilId"))
	ctx := c.Request().Context()

	remaining, err := service.GetSlitCoilRemaining(ctx, h.Queries, slitCoilID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusOK, map[string]interface{}{
				"slitCoilId":        slitCoilID,
				"remainingQuantity": 0,
				"consumptions":      []map[string]interface{}{},
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load slit coil usage"})
	}

	rows, err := h.Queries.ListSlitCoilProductionConsumptions(ctx, slitCoilID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load slit coil usage"})
	}

	consumptions := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		consumptions = append(consumptions, map[string]interface{}{
			"id":               row.ID,
			"batchNumber":      row.BatchNumber,
			"slitCoilId":       row.SlitCoilId,
			"quantityConsumed": service.NumericToString(row.QuantityConsumed),
			"createdAt":        formatTimestamp(row.CreatedAt),
			"batch": map[string]interface{}{
				"batchNumber":           row.BatchNumber,
				"productType":           row.ProductType,
				"quantityProduced":      service.NumericToString(row.QuantityProduced),
				"productionDate":        formatTimestamp(row.ProductionDate),
				"productionOrderNumber": row.ProductionOrderNumber,
			},
		})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"slitCoilId":        slitCoilID,
		"remainingQuantity": remaining,
		"consumptions":      consumptions,
	})
}

func (h *ProductionHandler) Create(c echo.Context) error {
	var req createProductionBatchRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if req.ProductionOrderNumber == "" || req.ProductType == "" || req.ProductionDate == "" ||
		req.OperatorShift == "" || req.QuantityProduced <= 0 || len(req.SlitCoilConsumptions) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]interface{}{"error": map[string]string{"message": "Invalid batch data"}})
	}

	ctx := c.Request().Context()
	batchNumber := ""
	if req.BatchNumber != nil && strings.TrimSpace(*req.BatchNumber) != "" {
		batchNumber = strings.ToUpper(strings.TrimSpace(*req.BatchNumber))
	} else {
		generated, err := service.GenerateNextBatchNumber(ctx, h.Queries)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create production batch"})
		}
		batchNumber = generated
	}

	exists, err := h.Queries.ProductionBatchExists(ctx, batchNumber)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create production batch"})
	}
	if exists {
		return c.JSON(http.StatusConflict, map[string]string{"error": fmt.Sprintf("Batch %s already exists", batchNumber)})
	}

	lines := toConsumptionLines(req.SlitCoilConsumptions)
	ok, msg := service.ValidateSlitCoilConsumptions(ctx, h.Queries, lines, "")
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": msg})
	}

	productionDate, err := service.ParseProductionDate(req.ProductionDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid production date"})
	}

	qtyProduced, err := service.WeightFromFloat(req.QuantityProduced)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid quantity produced"})
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create production batch"})
	}
	defer tx.Rollback(ctx)

	qtx := h.Queries.WithTx(tx)
	batch, err := qtx.CreateProductionBatch(ctx, db.CreateProductionBatchParams{
		BatchNumber:           batchNumber,
		ProductionOrderNumber: req.ProductionOrderNumber,
		ProductType:           req.ProductType,
		QuantityProduced:      qtyProduced,
		ProductionDate:        pgtype.Timestamp{Time: productionDate, Valid: true},
		OperatorShift:         req.OperatorShift,
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create production batch"})
	}

	if err := h.applyConsumptions(ctx, qtx, batchNumber, lines); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create production batch"})
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create production batch"})
	}

	h.auditBatchCreate(c, batchNumber, lines)

	batchJSON, err := h.buildBatchDetailJSON(ctx, batch)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create production batch"})
	}
	return c.JSON(http.StatusCreated, map[string]interface{}{"batch": batchJSON})
}

func (h *ProductionHandler) Issue(c echo.Context) error {
	batchNumber := strings.ToUpper(c.Param("batchNumber"))
	var req issueSlitCoilsRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if len(req.SlitCoilConsumptions) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]interface{}{"error": map[string]string{"message": "Invalid issue data"}})
	}

	ctx := c.Request().Context()
	batch, err := h.Queries.GetProductionBatchByNumber(ctx, batchNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Production batch not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to issue slit coils"})
	}

	lines := toConsumptionLines(req.SlitCoilConsumptions)
	ok, msg := service.ValidateSlitCoilConsumptions(ctx, h.Queries, lines, batchNumber)
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": msg})
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to issue slit coils"})
	}
	defer tx.Rollback(ctx)

	qtx := h.Queries.WithTx(tx)
	if err := h.applyConsumptions(ctx, qtx, batchNumber, lines); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to issue slit coils"})
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to issue slit coils"})
	}

	if user, ok := middleware.GetUser(c); ok {
		newValues, _ := json.Marshal(map[string]interface{}{
			"action":       "issue_slit_coils",
			"consumptions": req.SlitCoilConsumptions,
		})
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "UPDATE",
			EntityType: textPtr("ProductionBatch"),
			EntityID:   textPtr(batchNumber),
			NewValues:  newValues,
		})
	}

	batchJSON, err := h.buildBatchDetailJSON(ctx, batch)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to issue slit coils"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"batch": batchJSON})
}

func (h *ProductionHandler) Update(c echo.Context) error {
	batchNumber := strings.ToUpper(c.Param("batchNumber"))
	var raw map[string]json.RawMessage
	if err := c.Bind(&raw); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	ctx := c.Request().Context()
	existing, err := h.Queries.GetProductionBatchByNumber(ctx, batchNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Production batch not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update production batch"})
	}

	var req updateProductionBatchRequest
	_ = json.Unmarshal(mustMarshal(raw), &req)

	params := db.UpdateProductionBatchParams{BatchNumber: batchNumber}
	if _, ok := raw["productionOrderNumber"]; ok && req.ProductionOrderNumber != nil {
		params.ProductionOrderNumber = textPtr(*req.ProductionOrderNumber)
	}
	if _, ok := raw["productType"]; ok && req.ProductType != nil {
		params.ProductType = textPtr(*req.ProductType)
	}
	if _, ok := raw["quantityProduced"]; ok && req.QuantityProduced != nil {
		qty, err := service.WeightFromFloat(*req.QuantityProduced)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid quantity produced"})
		}
		params.QuantityProduced = qty
	}
	if _, ok := raw["productionDate"]; ok && req.ProductionDate != nil {
		t, err := service.ParseProductionDate(*req.ProductionDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid production date"})
		}
		params.ProductionDate = pgtype.Timestamp{Time: t, Valid: true}
	}
	if _, ok := raw["operatorShift"]; ok && req.OperatorShift != nil {
		params.OperatorShift = textPtr(*req.OperatorShift)
	}

	batch, err := h.Queries.UpdateProductionBatch(ctx, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update production batch"})
	}

	if user, ok := middleware.GetUser(c); ok {
		oldValues, _ := json.Marshal(productionBatchSnapshot(existing))
		newValues, _ := json.Marshal(productionBatchSnapshot(batch))
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "UPDATE",
			EntityType: textPtr("ProductionBatch"),
			EntityID:   textPtr(batchNumber),
			OldValues:  oldValues,
			NewValues:  newValues,
		})
	}

	batchJSON, err := h.buildBatchDetailJSON(ctx, batch)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update production batch"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"batch": batchJSON})
}

func (h *ProductionHandler) applyConsumptions(ctx context.Context, queries *db.Queries, batchNumber string, lines []service.ConsumptionLine) error {
	for _, line := range lines {
		slitCoilID := strings.ToUpper(line.SlitCoilId)
		qty, err := service.WeightFromFloat(line.QuantityConsumed)
		if err != nil {
			return err
		}

		existing, err := queries.GetBatchSlitCoilMapByBatchAndSlit(ctx, db.GetBatchSlitCoilMapByBatchAndSlitParams{
			BatchNumber: batchNumber,
			SlitCoilID:  slitCoilID,
		})
		if err == nil {
			_, err = queries.AddBatchSlitCoilConsumption(ctx, db.AddBatchSlitCoilConsumptionParams{
				ID:          existing.ID,
				AddQuantity: qty,
			})
			if err != nil {
				return err
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		_, err = queries.CreateBatchSlitCoilMap(ctx, db.CreateBatchSlitCoilMapParams{
			ID:               uuid.New().String(),
			BatchNumber:      batchNumber,
			SlitCoilID:       slitCoilID,
			QuantityConsumed: qty,
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func (h *ProductionHandler) buildBatchListJSON(ctx context.Context, batch db.ProductionBatch) (map[string]interface{}, error) {
	reqCtx := ctx
	consumptions, err := service.LoadBatchListConsumptions(reqCtx, h.Pool, batch.BatchNumber)
	if err != nil {
		return nil, err
	}

	consJSON := make([]map[string]interface{}, 0, len(consumptions))
	for _, c := range consumptions {
		consJSON = append(consJSON, map[string]interface{}{
			"slitCoilId":       c.SlitCoilId,
			"quantityConsumed": service.NumericToString(c.QuantityConsumed),
		})
	}

	out := productionBatchBaseJSON(batch)
	out["slitCoilConsumptions"] = consJSON
	out["_count"] = map[string]int64{"slitCoilConsumptions": int64(len(consumptions))}

	qc, err := service.LoadLatestQcForBatch(reqCtx, h.Pool, batch.BatchNumber)
	if err == nil {
		out["qcInspections"] = []map[string]interface{}{{
			"id":             qc.ID,
			"qcResult":       string(qc.QcResult),
			"inspectionDate": formatTimestamp(qc.InspectionDate),
			"inspectorName":  qc.InspectorName,
		}}
	} else if errors.Is(err, pgx.ErrNoRows) {
		out["qcInspections"] = []map[string]interface{}{}
	} else {
		return nil, err
	}
	return out, nil
}

func (h *ProductionHandler) buildBatchDetailJSON(ctx context.Context, batch db.ProductionBatch) (map[string]interface{}, error) {
	reqCtx := ctx
	consumptions, err := service.LoadBatchConsumptionsDetail(reqCtx, h.Pool, batch.BatchNumber)
	if err != nil {
		return nil, err
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
				"slitCoilWeight":   c.SlitCoilWeight,
			},
		})
	}

	inspections, err := service.LoadQcInspectionsForBatch(reqCtx, h.Pool, batch.BatchNumber)
	if err != nil {
		return nil, err
	}
	qcJSON := make([]map[string]interface{}, 0, len(inspections))
	for _, q := range inspections {
		photos := make([]map[string]interface{}, 0, len(q.Photos))
		for _, p := range q.Photos {
			photos = append(photos, map[string]interface{}{
				"id":           p.ID,
				"filename":     p.Filename,
				"originalName": p.OriginalName,
				"mimetype":     p.Mimetype,
				"size":         p.Size,
				"createdAt":    formatTimestamp(p.CreatedAt),
			})
		}
		qcJSON = append(qcJSON, map[string]interface{}{
			"id":             q.ID,
			"batchNumber":    q.BatchNumber,
			"qcResult":       string(q.QcResult),
			"inspectorName":  q.InspectorName,
			"inspectionDate": formatTimestamp(q.InspectionDate),
			"qcRemarks":      textValue(q.QcRemarks),
			"createdAt":      formatTimestamp(q.CreatedAt),
			"updatedAt":      formatTimestamp(q.UpdatedAt),
			"photos":         photos,
		})
	}

	out := productionBatchBaseJSON(batch)
	out["slitCoilConsumptions"] = consJSON
	out["qcInspections"] = qcJSON
	return out, nil
}

func productionBatchBaseJSON(batch db.ProductionBatch) map[string]interface{} {
	return map[string]interface{}{
		"batchNumber":           batch.BatchNumber,
		"productionOrderNumber": batch.ProductionOrderNumber,
		"productType":           batch.ProductType,
		"quantityProduced":      service.NumericToString(batch.QuantityProduced),
		"productionDate":        formatTimestamp(batch.ProductionDate),
		"operatorShift":         batch.OperatorShift,
		"createdAt":             formatTimestamp(batch.CreatedAt),
		"updatedAt":             formatTimestamp(batch.UpdatedAt),
	}
}

func productionBatchSnapshot(batch db.ProductionBatch) map[string]interface{} {
	return productionBatchBaseJSON(batch)
}

func (h *ProductionHandler) auditBatchCreate(c echo.Context, batchNumber string, lines []service.ConsumptionLine) {
	user, ok := middleware.GetUser(c)
	if !ok {
		return
	}
	ids := make([]string, len(lines))
	for i, line := range lines {
		ids[i] = strings.ToUpper(line.SlitCoilId)
	}
	newValues, _ := json.Marshal(map[string]interface{}{
		"batchNumber": batchNumber,
		"slitCoilIds": ids,
	})
	_, _ = h.Queries.CreateAuditLogWithValues(c.Request().Context(), db.CreateAuditLogWithValuesParams{
		ID:         uuid.New().String(),
		UserID:     user.ID,
		Action:     "CREATE",
		EntityType: textPtr("ProductionBatch"),
		EntityID:   textPtr(batchNumber),
		NewValues:  newValues,
	})
}

func toConsumptionLines(lines []consumptionLineRequest) []service.ConsumptionLine {
	out := make([]service.ConsumptionLine, len(lines))
	for i, line := range lines {
		out[i] = service.ConsumptionLine{
			SlitCoilId:       line.SlitCoilId,
			QuantityConsumed: line.QuantityConsumed,
		}
	}
	return out
}

func strconvParseFloat(s string) (float64, error) {
	return strconv.ParseFloat(s, 64)
}
