package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/db"
	"github.com/sunrack/ctrcms-go/internal/middleware"
	"github.com/sunrack/ctrcms-go/internal/service"
	"github.com/sunrack/ctrcms-go/internal/upload"
)

type QcHandler struct {
	Queries          *db.Queries
	Pool             *pgxpool.Pool
	UploadDir        string
	MaxFileSizeBytes int64
	AllowedMimeTypes []string
}

type createQcInspectionRequest struct {
	BatchNumber    string  `json:"batchNumber"`
	QcResult       string  `json:"qcResult"`
	InspectorName  string  `json:"inspectorName"`
	InspectionDate string  `json:"inspectionDate"`
	QcRemarks      *string `json:"qcRemarks"`
}

func (h *QcHandler) List(c echo.Context) error {
	params := service.QcListParams{
		Search: strings.TrimSpace(c.QueryParam("search")),
		Status: strings.TrimSpace(c.QueryParam("status")),
		From:   c.QueryParam("from"),
		To:     c.QueryParam("to"),
	}

	ctx := c.Request().Context()
	inspections, err := service.ListQcInspections(ctx, h.Pool, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list QC inspections"})
	}

	items := make([]map[string]interface{}, 0, len(inspections))
	for _, inspection := range inspections {
		item, err := h.buildInspectionIncludeJSON(ctx, inspection)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list QC inspections"})
		}
		items = append(items, item)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"inspections": items})
}

func (h *QcHandler) Stats(c echo.Context) error {
	stats, err := service.GetQcStats(c.Request().Context(), h.Queries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load stats"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"stats": stats})
}

func (h *QcHandler) PendingBatches(c echo.Context) error {
	rows, err := service.ListPendingQcBatches(c.Request().Context(), h.Pool)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list pending batches"})
	}

	pending := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		item := map[string]interface{}{
			"batchNumber":           row.BatchNumber,
			"productionOrderNumber": row.ProductionOrderNumber,
			"productType":           row.ProductType,
			"quantityProduced":      service.NumericToString(row.QuantityProduced),
			"productionDate":        formatTimestamp(row.ProductionDate),
		}
		needsInspection := !row.LatestQcResult.Valid || row.LatestQcResult.String == string(db.QcResultREWORK)
		if row.LatestQcResult.Valid {
			item["latestQc"] = map[string]interface{}{
				"qcResult":       row.LatestQcResult.String,
				"inspectionDate": formatTimestamp(row.LatestInspectionDate),
				"inspectorName":  row.LatestInspectorName.String,
			}
		} else {
			item["latestQc"] = nil
		}
		item["needsInspection"] = needsInspection
		pending = append(pending, item)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"pending": pending})
}

func (h *QcHandler) DispatchEligibleBatches(c echo.Context) error {
	ctx := c.Request().Context()
	eligibleNumbers, err := service.ListDispatchEligibleBatchNumbers(ctx, h.Pool)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list dispatch-eligible batches"})
	}

	batches := make([]map[string]interface{}, 0, len(eligibleNumbers))
	for _, batchNumber := range eligibleNumbers {
		batch, err := h.Queries.GetProductionBatchByNumber(ctx, batchNumber)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list dispatch-eligible batches"})
		}

		passRows, err := h.Pool.Query(ctx, `
			SELECT id, "batchNumber", "qcResult", "inspectorName", "inspectionDate", "qcRemarks", "createdAt", "updatedAt"
			FROM "QCInspection"
			WHERE "batchNumber" = $1 AND "qcResult" = 'PASS'
			ORDER BY "inspectionDate" DESC
			LIMIT 1
		`, batchNumber)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list dispatch-eligible batches"})
		}
		var qcJSON []map[string]interface{}
		if passRows.Next() {
			var qi db.QCInspection
			if err := passRows.Scan(
				&qi.ID, &qi.BatchNumber, &qi.QcResult, &qi.InspectorName, &qi.InspectionDate,
				&qi.QcRemarks, &qi.CreatedAt, &qi.UpdatedAt,
			); err != nil {
				passRows.Close()
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list dispatch-eligible batches"})
			}
			qcJSON = []map[string]interface{}{qcInspectionCoreJSON(qi)}
		} else {
			qcJSON = []map[string]interface{}{}
		}
		passRows.Close()

		out := productionBatchBaseJSON(batch)
		out["qcInspections"] = qcJSON
		batches = append(batches, out)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"batches": batches})
}

func (h *QcHandler) Get(c echo.Context) error {
	id := c.Param("id")
	ctx := c.Request().Context()

	inspection, err := h.Queries.GetQcInspectionByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "QC inspection not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load QC inspection"})
	}

	item, err := h.buildInspectionIncludeJSON(ctx, inspection)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load QC inspection"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"inspection": item})
}

func (h *QcHandler) GetByBatch(c echo.Context) error {
	batchNumber := strings.ToUpper(c.Param("batchNumber"))
	ctx := c.Request().Context()

	inspections, err := h.Queries.ListQcInspectionsByBatch(ctx, batchNumber)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load batch QC status"})
	}

	items := make([]map[string]interface{}, 0, len(inspections))
	for _, inspection := range inspections {
		item, err := h.buildInspectionIncludeJSON(ctx, inspection)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load batch QC status"})
		}
		items = append(items, item)
	}

	var latestResult interface{}
	dispatchEligible := false
	latest, err := h.Queries.GetLatestQcInspectionByBatch(ctx, batchNumber)
	if err == nil {
		latestResult = string(latest.QcResult)
		dispatchEligible = latest.QcResult == db.QcResultPASS
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load batch QC status"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"batchNumber":      batchNumber,
		"latestResult":     latestResult,
		"dispatchEligible": dispatchEligible,
		"inspections":      items,
	})
}

func (h *QcHandler) Create(c echo.Context) error {
	var req createQcInspectionRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	req.BatchNumber = strings.TrimSpace(req.BatchNumber)
	req.InspectorName = strings.TrimSpace(req.InspectorName)
	req.InspectionDate = strings.TrimSpace(req.InspectionDate)
	if req.BatchNumber == "" || req.InspectorName == "" || req.InspectionDate == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	qcResult, ok := service.ParseQcResult(req.QcResult)
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid QC result"})
	}

	batchNumber := strings.ToUpper(req.BatchNumber)
	ctx := c.Request().Context()

	batch, err := h.Queries.GetProductionBatchByNumber(ctx, batchNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": fmt.Sprintf("Production batch %s not found", batchNumber)})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create QC inspection"})
	}

	inspectionDate, err := service.ParseInspectionDate(req.InspectionDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid inspection date"})
	}

	var qcRemarks pgtype.Text
	if req.QcRemarks != nil {
		qcRemarks = optionalText(*req.QcRemarks)
	}

	inspection, err := h.Queries.CreateQcInspection(ctx, db.CreateQcInspectionParams{
		ID:             uuid.New().String(),
		BatchNumber:    batchNumber,
		QcResult:       qcResult,
		InspectorName:  req.InspectorName,
		InspectionDate: inspectionDate,
		QcRemarks:      qcRemarks,
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create QC inspection"})
	}

	if user, ok := middleware.GetUser(c); ok {
		newValues, _ := json.Marshal(map[string]string{
			"batchNumber": batchNumber,
			"qcResult":    string(qcResult),
		})
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "CREATE",
			EntityType: textPtr("QCInspection"),
			EntityID:   textPtr(inspection.ID),
			NewValues:  newValues,
		})
	}

	if qcResult == db.QcResultFAIL {
		var remarks *string
		if req.QcRemarks != nil {
			remarks = req.QcRemarks
		}
		_ = service.NotifyQcFailed(ctx, h.Queries, batchNumber, batch.ProductType, req.InspectorName, remarks)
	}

	item, err := h.buildInspectionIncludeJSON(ctx, inspection)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create QC inspection"})
	}
	return c.JSON(http.StatusCreated, map[string]interface{}{"inspection": item})
}

func (h *QcHandler) Update(c echo.Context) error {
	id := c.Param("id")
	var raw map[string]json.RawMessage
	if err := c.Bind(&raw); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	ctx := c.Request().Context()
	existing, err := h.Queries.GetQcInspectionByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "QC inspection not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update QC inspection"})
	}

	params := db.UpdateQcInspectionParams{ID: id}
	if v, ok := raw["qcResult"]; ok {
		var qcResult string
		if err := json.Unmarshal(v, &qcResult); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		}
		parsed, valid := service.ParseQcResult(qcResult)
		if !valid {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid QC result"})
		}
		params.QcResult = db.NullQcResult{QcResult: parsed, Valid: true}
	}
	if v, ok := raw["inspectorName"]; ok {
		var name string
		if err := json.Unmarshal(v, &name); err != nil || strings.TrimSpace(name) == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		}
		params.InspectorName = textPtr(strings.TrimSpace(name))
	}
	if v, ok := raw["inspectionDate"]; ok {
		var dateStr string
		if err := json.Unmarshal(v, &dateStr); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		}
		t, err := service.ParseInspectionDate(dateStr)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid inspection date"})
		}
		params.InspectionDate = t
	}
	if v, ok := raw["qcRemarks"]; ok {
		if string(v) == "null" {
			params.QcRemarks = pgtype.Text{}
		} else {
			var remarks string
			if err := json.Unmarshal(v, &remarks); err != nil {
				return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
			}
			params.QcRemarks = optionalText(remarks)
		}
	}

	inspection, err := h.Queries.UpdateQcInspection(ctx, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update QC inspection"})
	}

	if user, ok := middleware.GetUser(c); ok {
		oldValues, _ := json.Marshal(qcInspectionSnapshot(existing))
		newValues, _ := json.Marshal(qcInspectionSnapshot(inspection))
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "UPDATE",
			EntityType: textPtr("QCInspection"),
			EntityID:   textPtr(id),
			OldValues:  oldValues,
			NewValues:  newValues,
		})
	}

	resultChangedToFail := params.QcResult.Valid && params.QcResult.QcResult == db.QcResultFAIL && existing.QcResult != db.QcResultFAIL
	if resultChangedToFail {
		batch, err := h.Queries.GetProductionBatchByNumber(ctx, inspection.BatchNumber)
		if err == nil {
			var remarks *string
			if inspection.QcRemarks.Valid {
				r := inspection.QcRemarks.String
				remarks = &r
			}
			_ = service.NotifyQcFailed(ctx, h.Queries, inspection.BatchNumber, batch.ProductType, inspection.InspectorName, remarks)
		}
	}

	item, err := h.buildInspectionIncludeJSON(ctx, inspection)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update QC inspection"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"inspection": item})
}

func (h *QcHandler) AttachPhotos(c echo.Context) error {
	id := c.Param("id")
	ctx := c.Request().Context()

	if _, err := h.Queries.GetQcInspectionByID(ctx, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "QC inspection not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to upload photos"})
	}

	form, err := c.MultipartForm()
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "No photos uploaded"})
	}
	files := form.File["photos"]
	if len(files) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "No photos uploaded"})
	}
	if len(files) > 10 {
		files = files[:10]
	}

	var uploadedBy pgtype.Text
	if user, ok := middleware.GetUser(c); ok {
		uploadedBy = textPtr(user.ID)
	}

	var photos []db.QCInspectionPhoto
	for _, fh := range files {
		saved, err := upload.SaveToCategory(h.UploadDir, "qc-reports", h.MaxFileSizeBytes, h.AllowedMimeTypes, fh)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}

		photo, err := h.Queries.CreateQcInspectionPhoto(ctx, db.CreateQcInspectionPhotoParams{
			ID:           uuid.New().String(),
			InspectionID: id,
			Filename:     saved.Filename,
			OriginalName: saved.OriginalName,
			Mimetype:     saved.Mimetype,
			Size:         saved.Size,
			StoragePath:  saved.StoragePath,
			UploadedByID: uploadedBy,
		})
		if err != nil {
			_ = os.Remove(saved.StoragePath)
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to upload photos"})
		}
		photos = append(photos, photo)
	}

	if user, ok := middleware.GetUser(c); ok {
		newValues, _ := json.Marshal(map[string]int{"photoCount": len(photos)})
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "UPLOAD",
			EntityType: textPtr("QCInspectionPhoto"),
			EntityID:   textPtr(id),
			NewValues:  newValues,
		})
	}

	photoJSON := make([]map[string]interface{}, 0, len(photos))
	for _, p := range photos {
		photoJSON = append(photoJSON, qcInspectionPhotoJSON(p))
	}
	return c.JSON(http.StatusCreated, map[string]interface{}{"photos": photoJSON})
}

func (h *QcHandler) ServePhoto(c echo.Context) error {
	photoID := c.Param("photoId")
	photo, err := h.Queries.GetQcInspectionPhotoByID(c.Request().Context(), photoID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Photo not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load photo"})
	}

	if _, err := os.Stat(photo.StoragePath); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Photo not found"})
	}

	c.Response().Header().Set("Content-Type", photo.Mimetype)
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, photo.OriginalName))
	return c.File(photo.StoragePath)
}

func (h *QcHandler) buildInspectionIncludeJSON(reqCtx context.Context, inspection db.QCInspection) (map[string]interface{}, error) {
	summary, err := service.LoadProductionBatchSummary(reqCtx, h.Pool, inspection.BatchNumber)
	if err != nil {
		return nil, err
	}

	photos, err := service.LoadQcPhotos(reqCtx, h.Queries, inspection.ID)
	if err != nil {
		return nil, err
	}

	photoJSON := make([]map[string]interface{}, 0, len(photos))
	for _, p := range photos {
		photoJSON = append(photoJSON, qcInspectionPhotoJSON(p))
	}

	out := qcInspectionCoreJSON(inspection)
	out["batch"] = qcBatchSummaryJSON(summary)
	out["photos"] = photoJSON
	out["_count"] = map[string]int64{"photos": int64(len(photos))}
	return out, nil
}

func qcInspectionCoreJSON(inspection db.QCInspection) map[string]interface{} {
	return map[string]interface{}{
		"id":             inspection.ID,
		"batchNumber":    inspection.BatchNumber,
		"qcResult":       string(inspection.QcResult),
		"inspectorName":  inspection.InspectorName,
		"inspectionDate": formatTimestamp(inspection.InspectionDate),
		"qcRemarks":      textValue(inspection.QcRemarks),
		"createdAt":      formatTimestamp(inspection.CreatedAt),
		"updatedAt":      formatTimestamp(inspection.UpdatedAt),
	}
}

func qcBatchSummaryJSON(summary service.QcBatchSummary) map[string]interface{} {
	return map[string]interface{}{
		"batchNumber":           summary.BatchNumber,
		"productionOrderNumber": summary.ProductionOrderNumber,
		"productType":           summary.ProductType,
		"quantityProduced":      service.NumericToString(summary.QuantityProduced),
		"productionDate":        formatTimestamp(summary.ProductionDate),
		"operatorShift":         summary.OperatorShift,
	}
}

func qcInspectionPhotoJSON(p db.QCInspectionPhoto) map[string]interface{} {
	return map[string]interface{}{
		"id":           p.ID,
		"filename":     p.Filename,
		"originalName": p.OriginalName,
		"mimetype":     p.Mimetype,
		"size":         p.Size,
		"createdAt":    formatTimestamp(p.CreatedAt),
	}
}

func qcInspectionSnapshot(inspection db.QCInspection) map[string]interface{} {
	return qcInspectionCoreJSON(inspection)
}
