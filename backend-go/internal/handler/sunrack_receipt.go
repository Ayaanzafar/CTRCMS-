package handler

import (
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

type SunrackReceiptHandler struct {
	Queries          *db.Queries
	Pool             *pgxpool.Pool
	UploadDir        string
	MaxFileSizeBytes int64
	AllowedMimeTypes []string
}

type createSunrackReceiptRequest struct {
	SlitCoilId            string  `json:"slitCoilId"`
	ReceiptDateSunrack    string  `json:"receiptDateSunrack"`
	StorageLocationBin    string  `json:"storageLocationBin"`
	InspectionResult      *string `json:"inspectionResult"`
	InspectionRemarks     *string `json:"inspectionRemarks"`
	ConfirmedDispatchNote *string `json:"confirmedDispatchNote"`
}

type updateSunrackReceiptRequest struct {
	ReceiptDateSunrack    *string `json:"receiptDateSunrack"`
	StorageLocationBin    *string `json:"storageLocationBin"`
	InspectionResult      *string `json:"inspectionResult"`
	InspectionRemarks     *string `json:"inspectionRemarks"`
	ConfirmedDispatchNote *string `json:"confirmedDispatchNote"`
}

func (h *SunrackReceiptHandler) List(c echo.Context) error {
	params := service.SunrackReceiptListParams{
		Search: strings.TrimSpace(c.QueryParam("search")),
		Status: strings.TrimSpace(c.QueryParam("status")),
		From:   c.QueryParam("from"),
		To:     c.QueryParam("to"),
	}

	ctx := c.Request().Context()
	rows, err := service.ListSunrackReceipts(ctx, h.Pool, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list Sunrack receipts"})
	}

	receiptIDs := make([]string, len(rows))
	for i, row := range rows {
		receiptIDs[i] = row.Receipt.ID
	}
	photoMap, err := service.LoadReceiptPhotosByReceiptIDs(ctx, h.Pool, receiptIDs)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list Sunrack receipts"})
	}

	receipts := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		photos := photoMap[row.Receipt.ID]
		if photos == nil {
			photos = []db.SunrackReceiptPhoto{}
		}
		receipts = append(receipts, sunrackReceiptIncludeJSON(row, photos, int64(len(photos))))
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"receipts": receipts})
}

func (h *SunrackReceiptHandler) Pending(c echo.Context) error {
	search := strings.TrimSpace(c.QueryParam("search"))
	pending, err := service.ListPendingSlitCoils(c.Request().Context(), h.Pool, search)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list pending slit coils"})
	}

	items := make([]map[string]interface{}, 0, len(pending))
	for _, row := range pending {
		items = append(items, pendingSlitCoilJSON(row))
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"pending": items})
}

func (h *SunrackReceiptHandler) Stats(c echo.Context) error {
	stats, err := service.GetSunrackReceiptStats(c.Request().Context(), h.Queries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load stats"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"stats": stats})
}

func (h *SunrackReceiptHandler) Get(c echo.Context) error {
	return h.getReceipt(c, c.Param("id"), false)
}

func (h *SunrackReceiptHandler) GetBySlitCoil(c echo.Context) error {
	slitCoilID := strings.ToUpper(c.Param("slitCoilId"))
	receipt, err := h.Queries.GetSunrackReceiptBySlitCoilId(c.Request().Context(), slitCoilID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "No Sunrack receipt for this slit coil"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load Sunrack receipt"})
	}
	return h.respondReceipt(c, receipt)
}

func (h *SunrackReceiptHandler) getReceipt(c echo.Context, id string, bySlit bool) error {
	_ = bySlit
	receipt, err := h.Queries.GetSunrackReceiptByID(c.Request().Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Sunrack receipt not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load Sunrack receipt"})
	}
	return h.respondReceipt(c, receipt)
}

func (h *SunrackReceiptHandler) respondReceipt(c echo.Context, receipt db.SunrackReceipt) error {
	row, photos, count, err := service.LoadSunrackReceiptInclude(c.Request().Context(), h.Pool, receipt)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load Sunrack receipt"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"receipt": sunrackReceiptIncludeJSON(row, photos, count),
	})
}

func (h *SunrackReceiptHandler) Create(c echo.Context) error {
	var req createSunrackReceiptRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if strings.TrimSpace(req.SlitCoilId) == "" || strings.TrimSpace(req.ReceiptDateSunrack) == "" || strings.TrimSpace(req.StorageLocationBin) == "" {
		return c.JSON(http.StatusBadRequest, map[string]interface{}{"error": map[string]string{"message": "Invalid receipt data"}})
	}

	slitCoilID := strings.ToUpper(strings.TrimSpace(req.SlitCoilId))
	ctx := c.Request().Context()

	if _, err := h.Queries.GetSlittingBySlitCoilId(ctx, slitCoilID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": fmt.Sprintf("Slit coil %s not found", slitCoilID)})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create Sunrack receipt"})
	}

	exists, err := h.Queries.SunrackReceiptExistsForSlitCoil(ctx, slitCoilID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create Sunrack receipt"})
	}
	if exists {
		return c.JSON(http.StatusConflict, map[string]string{"error": fmt.Sprintf("Receipt already exists for slit coil %s", slitCoilID)})
	}

	receiptDate, err := service.ParseSlittingDate(req.ReceiptDateSunrack)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid receipt date"})
	}

	inspectionResult := db.InspectionResultPENDING
	if req.InspectionResult != nil && *req.InspectionResult != "" {
		parsed, ok := parseInspectionResult(*req.InspectionResult)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid inspection result"})
		}
		inspectionResult = parsed
	}

	var confirmedDispatch pgtype.Text
	if req.ConfirmedDispatchNote != nil {
		confirmedDispatch = optionalStringPtr(req.ConfirmedDispatchNote)
	} else {
		dispatchNote, err := h.Queries.GetSlittingDispatchNote(ctx, slitCoilID)
		if err == nil && dispatchNote.Valid {
			confirmedDispatch = dispatchNote
		}
	}

	receipt, err := h.Queries.CreateSunrackReceipt(ctx, db.CreateSunrackReceiptParams{
		ID:                    uuid.New().String(),
		SlitCoilID:            slitCoilID,
		ReceiptDateSunrack:    pgtype.Timestamp{Time: receiptDate, Valid: true},
		StorageLocationBin:    req.StorageLocationBin,
		InspectionResult:      inspectionResult,
		InspectionRemarks:     optionalStringPtr(req.InspectionRemarks),
		ConfirmedDispatchNote: confirmedDispatch,
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create Sunrack receipt"})
	}

	if user, ok := middleware.GetUser(c); ok {
		newValues, _ := json.Marshal(map[string]interface{}{
			"slitCoilId":         slitCoilID,
			"storageLocationBin": receipt.StorageLocationBin,
		})
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "CREATE",
			EntityType: textPtr("SunrackReceipt"),
			EntityID:   textPtr(receipt.ID),
			NewValues:  newValues,
		})
	}

	return h.respondReceiptCreated(c, receipt)
}

func (h *SunrackReceiptHandler) respondReceiptCreated(c echo.Context, receipt db.SunrackReceipt) error {
	row, photos, count, err := service.LoadSunrackReceiptInclude(c.Request().Context(), h.Pool, receipt)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load Sunrack receipt"})
	}
	return c.JSON(http.StatusCreated, map[string]interface{}{
		"receipt": sunrackReceiptIncludeJSON(row, photos, count),
	})
}

func (h *SunrackReceiptHandler) Update(c echo.Context) error {
	id := c.Param("id")
	var raw map[string]json.RawMessage
	if err := c.Bind(&raw); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	ctx := c.Request().Context()
	existing, err := h.Queries.GetSunrackReceiptByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Sunrack receipt not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update Sunrack receipt"})
	}

	var req updateSunrackReceiptRequest
	_ = json.Unmarshal(mustMarshal(raw), &req)

	params := db.UpdateSunrackReceiptParams{ID: id}
	if _, ok := raw["receiptDateSunrack"]; ok && req.ReceiptDateSunrack != nil {
		t, err := service.ParseSlittingDate(*req.ReceiptDateSunrack)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid receipt date"})
		}
		params.ReceiptDateSunrack = pgtype.Timestamp{Time: t, Valid: true}
	}
	if _, ok := raw["storageLocationBin"]; ok && req.StorageLocationBin != nil {
		params.StorageLocationBin = textPtr(*req.StorageLocationBin)
	}
	if _, ok := raw["inspectionResult"]; ok && req.InspectionResult != nil {
		parsed, ok := parseInspectionResult(*req.InspectionResult)
		if !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid inspection result"})
		}
		params.InspectionResult = db.NullInspectionResult{InspectionResult: parsed, Valid: true}
	}
	if _, ok := raw["inspectionRemarks"]; ok {
		params.InspectionRemarks = optionalStringPtr(req.InspectionRemarks)
	}
	if _, ok := raw["confirmedDispatchNote"]; ok {
		params.ConfirmedDispatchNote = optionalStringPtr(req.ConfirmedDispatchNote)
	}

	receipt, err := h.Queries.UpdateSunrackReceipt(ctx, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update Sunrack receipt"})
	}

	if user, ok := middleware.GetUser(c); ok {
		oldValues, _ := json.Marshal(sunrackReceiptSnapshot(existing))
		newValues, _ := json.Marshal(sunrackReceiptSnapshot(receipt))
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "UPDATE",
			EntityType: textPtr("SunrackReceipt"),
			EntityID:   textPtr(receipt.ID),
			OldValues:  oldValues,
			NewValues:  newValues,
		})
	}

	row, photos, count, err := service.LoadSunrackReceiptInclude(ctx, h.Pool, receipt)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update Sunrack receipt"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"receipt": sunrackReceiptIncludeJSON(row, photos, count),
	})
}

func (h *SunrackReceiptHandler) AttachPhotos(c echo.Context) error {
	id := c.Param("id")
	ctx := c.Request().Context()

	if _, err := h.Queries.GetSunrackReceiptByID(ctx, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Sunrack receipt not found"})
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

	var photos []db.SunrackReceiptPhoto
	for _, fh := range files {
		saved, err := upload.SaveToCategory(h.UploadDir, "inspection-photos", h.MaxFileSizeBytes, h.AllowedMimeTypes, fh)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}

		photo, err := h.Queries.CreateSunrackReceiptPhoto(ctx, db.CreateSunrackReceiptPhotoParams{
			ID:           uuid.New().String(),
			ReceiptID:    id,
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
			EntityType: textPtr("SunrackReceiptPhoto"),
			EntityID:   textPtr(id),
			NewValues:  newValues,
		})
	}

	photoJSON := make([]map[string]interface{}, 0, len(photos))
	for _, p := range photos {
		photoJSON = append(photoJSON, sunrackReceiptPhotoJSON(p))
	}
	return c.JSON(http.StatusCreated, map[string]interface{}{"photos": photoJSON})
}

func (h *SunrackReceiptHandler) ServePhoto(c echo.Context) error {
	photoID := c.Param("photoId")
	photo, err := h.Queries.GetSunrackReceiptPhotoByID(c.Request().Context(), photoID)
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

func sunrackReceiptIncludeJSON(row service.SunrackReceiptRow, photos []db.SunrackReceiptPhoto, photoCount int64) map[string]interface{} {
	photoJSON := make([]map[string]interface{}, 0, len(photos))
	for _, p := range photos {
		photoJSON = append(photoJSON, sunrackReceiptPhotoJSON(p))
	}
	out := sunrackReceiptBaseJSON(row.Receipt)
	out["slitCoil"] = slitCoilSummaryJSON(row.Slit)
	out["photos"] = photoJSON
	out["_count"] = map[string]int64{"photos": photoCount}
	return out
}

func sunrackReceiptBaseJSON(receipt db.SunrackReceipt) map[string]interface{} {
	return map[string]interface{}{
		"id":                    receipt.ID,
		"slitCoilId":            receipt.SlitCoilId,
		"receiptDateSunrack":    formatTimestamp(receipt.ReceiptDateSunrack),
		"storageLocationBin":    receipt.StorageLocationBin,
		"inspectionResult":      string(receipt.InspectionResult),
		"inspectionRemarks":     textValue(receipt.InspectionRemarks),
		"confirmedDispatchNote": textValue(receipt.ConfirmedDispatchNote),
		"createdAt":             formatTimestamp(receipt.CreatedAt),
		"updatedAt":             formatTimestamp(receipt.UpdatedAt),
	}
}

func sunrackReceiptSnapshot(receipt db.SunrackReceipt) map[string]interface{} {
	return sunrackReceiptBaseJSON(receipt)
}

func sunrackReceiptPhotoJSON(p db.SunrackReceiptPhoto) map[string]interface{} {
	return map[string]interface{}{
		"id":           p.ID,
		"receiptId":    p.ReceiptId,
		"filename":     p.Filename,
		"originalName": p.OriginalName,
		"mimetype":     p.Mimetype,
		"size":         p.Size,
		"createdAt":    formatTimestamp(p.CreatedAt),
	}
}

func slitCoilSummaryJSON(row service.SlitCoilSummary) map[string]interface{} {
	return map[string]interface{}{
		"slitCoilId":       row.SlitCoilId,
		"parentCoilNumber": row.ParentCoilNumber,
		"slitWidthSize":    row.SlitWidthSize,
		"slitCoilWeight":   row.SlitCoilWeight,
		"slittingDate":     formatTimestamp(row.SlittingDate),
		"dispatchNote":     textValue(row.DispatchNote),
		"vehicleNumber":    textValue(row.VehicleNumber),
		"transporterName":  textValue(row.TransporterName),
		"parentCoil": map[string]string{
			"coilNumber": row.ParentCoilNumber,
			"grade":      row.ParentGrade,
			"coating":    row.ParentCoating,
		},
	}
}

func pendingSlitCoilJSON(row service.SlitCoilSummary) map[string]interface{} {
	return slitCoilSummaryJSON(row)
}

func parseInspectionResult(value string) (db.InspectionResult, bool) {
	switch strings.ToUpper(value) {
	case "PENDING":
		return db.InspectionResultPENDING, true
	case "PASS":
		return db.InspectionResultPASS, true
	case "CONDITIONAL":
		return db.InspectionResultCONDITIONAL, true
	case "FAIL":
		return db.InspectionResultFAIL, true
	default:
		return "", false
	}
}
