package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
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

type SlittingHandler struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
}

type slitLineRequest struct {
	SlitWidthSize  string  `json:"slitWidthSize"`
	SlitCoilWeight float64 `json:"slitCoilWeight"`
	SlitCoilId     *string `json:"slitCoilId"`
}

type batchSlittingRequest struct {
	ParentCoilNumber string            `json:"parentCoilNumber"`
	SlittingDate     string            `json:"slittingDate"`
	SlitterLocation  *string           `json:"slitterLocation"`
	DispatchNote     *string           `json:"dispatchNote"`
	VehicleNumber    *string           `json:"vehicleNumber"`
	TransporterName  *string           `json:"transporterName"`
	SlitCoils        []slitLineRequest `json:"slitCoils"`
}

type updateSlittingRequest struct {
	SlitWidthSize   *string  `json:"slitWidthSize"`
	SlittingDate    *string  `json:"slittingDate"`
	SlitCoilWeight  *float64 `json:"slitCoilWeight"`
	SlitterLocation *string  `json:"slitterLocation"`
	DispatchNote    *string  `json:"dispatchNote"`
	VehicleNumber   *string  `json:"vehicleNumber"`
	TransporterName *string  `json:"transporterName"`
}

func (h *SlittingHandler) List(c echo.Context) error {
	params := service.SlittingListParams{
		Search:     strings.TrimSpace(c.QueryParam("search")),
		ParentCoil: strings.TrimSpace(c.QueryParam("parentCoil")),
		From:       c.QueryParam("from"),
		To:         c.QueryParam("to"),
	}

	rows, err := service.ListSlitting(c.Request().Context(), h.Pool, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list slitting records"})
	}

	records := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		records = append(records, slittingListRowJSON(row))
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"records": records})
}

func (h *SlittingHandler) Get(c echo.Context) error {
	slitCoilID := strings.ToUpper(c.Param("slitCoilId"))
	detail, err := service.GetSlittingDetail(c.Request().Context(), h.Pool, slitCoilID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Slitting record not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load slitting record"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"record": slittingDetailJSON(detail),
	})
}

func (h *SlittingHandler) PreviewIDs(c echo.Context) error {
	parent := strings.TrimSpace(c.QueryParam("parentCoilNumber"))
	if parent == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "parentCoilNumber is required"})
	}

	count := 1
	if v := c.QueryParam("count"); v != "" {
		if n, err := parseIntDefault(v, 1); err == nil {
			count = int(math.Min(float64(n), 20))
		}
	}

	ids, err := service.GenerateNextSlitCoilIDs(c.Request().Context(), h.Queries, parent, count)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to preview slit coil IDs"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"slitCoilIds": ids})
}

func (h *SlittingHandler) CreateBatch(c echo.Context) error {
	var req batchSlittingRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if strings.TrimSpace(req.ParentCoilNumber) == "" || strings.TrimSpace(req.SlittingDate) == "" || len(req.SlitCoils) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]interface{}{"error": map[string]string{"message": "Invalid batch data"}})
	}
	for _, line := range req.SlitCoils {
		if strings.TrimSpace(line.SlitWidthSize) == "" || line.SlitCoilWeight <= 0 {
			return c.JSON(http.StatusBadRequest, map[string]interface{}{"error": map[string]string{"message": "Invalid slit line"}})
		}
	}

	parentCoilNumber := strings.ToUpper(strings.TrimSpace(req.ParentCoilNumber))
	ctx := c.Request().Context()

	parent, err := h.Queries.GetCoilByNumber(ctx, parentCoilNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": fmt.Sprintf("Parent coil %s not found", parentCoilNumber)})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create slitting batch"})
	}
	if parent.Status == db.CoilStatusARCHIVED {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("Parent coil %s is archived and cannot be used for new slitting records", parentCoilNumber),
		})
	}

	slittingDate, err := service.ParseSlittingDate(req.SlittingDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid slitting date"})
	}
	slittingTS := pgtype.Timestamp{Time: slittingDate, Valid: true}

	needsAuto := 0
	for _, line := range req.SlitCoils {
		if line.SlitCoilId == nil || strings.TrimSpace(*line.SlitCoilId) == "" {
			needsAuto++
		}
	}
	autoIDs, err := service.GenerateNextSlitCoilIDs(ctx, h.Queries, parentCoilNumber, needsAuto)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create slitting batch"})
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create slitting batch"})
	}
	defer tx.Rollback(ctx)

	qtx := h.Queries.WithTx(tx)
	autoIdx := 0
	var created []db.SlittingRecord

	for _, line := range req.SlitCoils {
		var slitID string
		if line.SlitCoilId != nil && strings.TrimSpace(*line.SlitCoilId) != "" {
			slitID = strings.ToUpper(strings.TrimSpace(*line.SlitCoilId))
		} else {
			slitID = autoIDs[autoIdx]
			autoIdx++
		}

		exists, err := qtx.SlittingExists(ctx, slitID)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create slitting batch"})
		}
		if exists {
			return c.JSON(http.StatusConflict, map[string]string{"error": fmt.Sprintf("Slit coil ID %s already exists", slitID)})
		}

		weight, err := weightFromFloat(line.SlitCoilWeight)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid slit coil weight"})
		}

		var slitterLoc interface{}
		if req.SlitterLocation != nil {
			slitterLoc = *req.SlitterLocation
		}

		record, err := qtx.CreateSlittingRecord(ctx, db.CreateSlittingRecordParams{
			SlitCoilID:       slitID,
			ParentCoilNumber: parentCoilNumber,
			SlitWidthSize:    line.SlitWidthSize,
			SlittingDate:     slittingTS,
			SlitCoilWeight:   weight,
			SlitterLocation:  slitterLoc,
			DispatchNote:     optionalStringPtr(req.DispatchNote),
			VehicleNumber:    optionalStringPtr(req.VehicleNumber),
			TransporterName:  optionalStringPtr(req.TransporterName),
		})
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create slitting batch"})
		}
		created = append(created, record)
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create slitting batch"})
	}

	if user, ok := middleware.GetUser(c); ok {
		ids := make([]string, len(created))
		for i, r := range created {
			ids[i] = r.SlitCoilId
		}
		newValues, _ := json.Marshal(map[string]interface{}{
			"parentCoilNumber": parentCoilNumber,
			"slitCoilIds":      ids,
		})
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "CREATE",
			EntityType: textPtr("SlittingRecord"),
			EntityID:   textPtr(parentCoilNumber),
			NewValues:  newValues,
		})
	}

	records := make([]map[string]interface{}, 0, len(created))
	for _, record := range created {
		records = append(records, slittingRecordWithParentJSON(record, parent.Grade, parent.Coating))
	}
	return c.JSON(http.StatusCreated, map[string]interface{}{"records": records})
}

func (h *SlittingHandler) Update(c echo.Context) error {
	slitCoilID := strings.ToUpper(c.Param("slitCoilId"))
	var raw map[string]json.RawMessage
	if err := c.Bind(&raw); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	ctx := c.Request().Context()
	existing, err := h.Queries.GetSlittingBySlitCoilId(ctx, slitCoilID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Slitting record not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update slitting record"})
	}

	var req updateSlittingRequest
	_ = json.Unmarshal(mustMarshal(raw), &req)

	params := db.UpdateSlittingRecordParams{SlitCoilID: existing.SlitCoilId}
	if _, ok := raw["slitWidthSize"]; ok && req.SlitWidthSize != nil {
		params.SlitWidthSize = textPtr(*req.SlitWidthSize)
	}
	if _, ok := raw["slittingDate"]; ok && req.SlittingDate != nil {
		t, err := service.ParseSlittingDate(*req.SlittingDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid slitting date"})
		}
		params.SlittingDate = pgtype.Timestamp{Time: t, Valid: true}
	}
	if _, ok := raw["slitCoilWeight"]; ok && req.SlitCoilWeight != nil {
		w, err := weightFromFloat(*req.SlitCoilWeight)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid slit coil weight"})
		}
		params.SlitCoilWeight = w
	}
	if _, ok := raw["slitterLocation"]; ok && req.SlitterLocation != nil {
		params.SlitterLocation = textPtr(*req.SlitterLocation)
	}
	if _, ok := raw["dispatchNote"]; ok {
		params.DispatchNote = optionalStringPtr(req.DispatchNote)
	}
	if _, ok := raw["vehicleNumber"]; ok {
		params.VehicleNumber = optionalStringPtr(req.VehicleNumber)
	}
	if _, ok := raw["transporterName"]; ok {
		params.TransporterName = optionalStringPtr(req.TransporterName)
	}

	record, err := h.Queries.UpdateSlittingRecord(ctx, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update slitting record"})
	}

	parent, _ := h.Queries.GetCoilByNumber(ctx, record.ParentCoilNumber)

	if user, ok := middleware.GetUser(c); ok {
		oldValues, _ := json.Marshal(slittingRecordSnapshot(existing))
		newValues, _ := json.Marshal(slittingRecordSnapshot(record))
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "UPDATE",
			EntityType: textPtr("SlittingRecord"),
			EntityID:   textPtr(record.SlitCoilId),
			OldValues:  oldValues,
			NewValues:  newValues,
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"record": slittingRecordWithParentJSON(record, parent.Grade, parent.Coating),
	})
}

func slittingListRowJSON(row service.SlittingListRow) map[string]interface{} {
	out := slittingBaseJSON(
		row.SlitCoilId, row.ParentCoilNumber, row.SlitWidthSize, row.SlittingDate,
		row.SlitCoilWeight, row.SlitterLocation, row.DispatchNote, row.VehicleNumber,
		row.TransporterName, row.CreatedAt, row.UpdatedAt,
	)
	out["parentCoil"] = map[string]string{
		"coilNumber": row.ParentCoilNumber,
		"grade":      row.ParentGrade,
		"coating":    row.ParentCoating,
	}
	if row.SunrackID.Valid {
		out["sunrackReceipt"] = map[string]interface{}{
			"id":                 row.SunrackID.String,
			"receiptDateSunrack": tsValue(row.SunrackDate),
			"inspectionResult":   row.SunrackResult.String,
			"storageLocationBin": row.SunrackBin.String,
			"_count": map[string]int64{
				"photos": row.SunrackPhotoCnt,
			},
		}
	} else {
		out["sunrackReceipt"] = nil
	}
	return out
}

func slittingDetailJSON(d *service.SlittingDetail) map[string]interface{} {
	out := slittingListRowJSON(d.Record)
	out["parentCoil"] = map[string]interface{}{
		"coilNumber": d.Record.ParentCoilNumber,
		"grade":      d.Record.ParentGrade,
		"coating":    d.Record.ParentCoating,
		"size":       d.ParentSize,
		"weight":     d.ParentWeight,
		"supplier":   d.ParentSupplier,
	}

	if d.Record.SunrackID.Valid {
		receipt := map[string]interface{}{
			"id":                 d.Record.SunrackID.String,
			"receiptDateSunrack": tsValue(d.Record.SunrackDate),
			"inspectionResult":   d.Record.SunrackResult.String,
			"storageLocationBin": d.Record.SunrackBin.String,
		}
		photos := make([]map[string]interface{}, 0, len(d.SunrackPhotos))
		for _, p := range d.SunrackPhotos {
			photos = append(photos, map[string]interface{}{
				"id":           p.ID,
				"filename":     p.Filename,
				"originalName": p.OriginalName,
				"mimetype":     p.Mimetype,
				"size":         p.Size,
				"storagePath":  p.StoragePath,
				"uploadedById": textValue(p.UploadedById),
				"createdAt":    formatTimestamp(p.CreatedAt),
			})
		}
		receipt["photos"] = photos
		out["sunrackReceipt"] = receipt
	} else {
		out["sunrackReceipt"] = nil
	}

	consumptions := make([]map[string]interface{}, 0, len(d.BatchConsumptions))
	for _, row := range d.BatchConsumptions {
		consumptions = append(consumptions, map[string]interface{}{
			"id":               row.ID,
			"batchNumber":      row.BatchNumber,
			"slitCoilId":       row.SlitCoilId,
			"quantityConsumed": row.QuantityConsumed,
			"createdAt":        formatTimestamp(row.CreatedAt),
			"batch": map[string]interface{}{
				"batchNumber":           row.BatchNumber,
				"productType":           row.BatchProductType,
				"quantityProduced":      row.BatchQty,
				"productionDate":        tsValue(row.BatchDate),
				"productionOrderNumber": row.BatchOrderNo,
			},
		})
	}
	out["batchConsumptions"] = consumptions
	return out
}

func slittingRecordWithParentJSON(record db.SlittingRecord, grade, coating string) map[string]interface{} {
	out := slittingRecordMap(record)
	out["parentCoil"] = map[string]string{
		"coilNumber": record.ParentCoilNumber,
		"grade":      grade,
		"coating":    coating,
	}
	return out
}

func slittingRecordMap(record db.SlittingRecord) map[string]interface{} {
	return slittingBaseJSON(
		record.SlitCoilId, record.ParentCoilNumber, record.SlitWidthSize, record.SlittingDate,
		service.NumericToString(record.SlitCoilWeight), record.SlitterLocation, record.DispatchNote,
		record.VehicleNumber, record.TransporterName, record.CreatedAt, record.UpdatedAt,
	)
}

func slittingBaseJSON(
	slitCoilID, parentCoilNumber, slitWidthSize string,
	slittingDate pgtype.Timestamp,
	slitCoilWeight interface{},
	slitterLocation string,
	dispatchNote, vehicleNumber, transporterName pgtype.Text,
	createdAt, updatedAt pgtype.Timestamp,
) map[string]interface{} {
	return map[string]interface{}{
		"slitCoilId":       slitCoilID,
		"parentCoilNumber": parentCoilNumber,
		"slitWidthSize":    slitWidthSize,
		"slittingDate":     formatTimestamp(slittingDate),
		"slitCoilWeight":   slitCoilWeight,
		"slitterLocation":  slitterLocation,
		"dispatchNote":     textValue(dispatchNote),
		"vehicleNumber":    textValue(vehicleNumber),
		"transporterName":  textValue(transporterName),
		"createdAt":        formatTimestamp(createdAt),
		"updatedAt":        formatTimestamp(updatedAt),
	}
}

func slittingRecordSnapshot(record db.SlittingRecord) map[string]interface{} {
	return slittingRecordMap(record)
}

func parseIntDefault(s string, fallback int) (int, error) {
	var n int
	_, err := fmt.Sscanf(s, "%d", &n)
	if err != nil {
		return fallback, err
	}
	return n, nil
}
