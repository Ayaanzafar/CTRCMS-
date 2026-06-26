package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

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

type ComplaintHandler struct {
	Queries          *db.Queries
	Pool             *pgxpool.Pool
	UploadDir        string
	MaxFileSizeBytes int64
	AllowedMimeTypes []string
}

type createComplaintRequest struct {
	ComplaintId          *string  `json:"complaintId"`
	ComplaintDate        string   `json:"complaintDate"`
	ProjectName          string   `json:"projectName"`
	ClientName           string   `json:"clientName"`
	SiteLocation         string   `json:"siteLocation"`
	ComplaintDescription string   `json:"complaintDescription"`
	RootCauseRemarks     *string  `json:"rootCauseRemarks"`
	ResponsibleStage     *string  `json:"responsibleStage"`
	BatchNumbers         []string `json:"batchNumbers"`
}

type resolveTraceRequest struct {
	BatchNumbers []string `json:"batchNumbers"`
}

func (h *ComplaintHandler) Stats(c echo.Context) error {
	stats, err := service.GetComplaintStats(c.Request().Context(), h.Queries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load stats"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"stats": stats})
}

func (h *ComplaintHandler) EligibleBatches(c echo.Context) error {
	batches, err := service.ListEligibleComplaintBatches(c.Request().Context(), h.Pool)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list eligible batches"})
	}
	items := make([]map[string]interface{}, 0, len(batches))
	for _, batch := range batches {
		items = append(items, eligibleComplaintBatchJSON(batch))
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"batches": items})
}

func (h *ComplaintHandler) ResolveTrace(c echo.Context) error {
	var req resolveTraceRequest
	if err := c.Bind(&req); err != nil || len(req.BatchNumbers) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	ctx := c.Request().Context()
	ok, msg := service.ValidateComplaintBatchLines(ctx, h.Queries, req.BatchNumbers)
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": msg})
	}
	traceability, err := service.ResolveBackwardFromBatches(ctx, h.Pool, req.BatchNumbers)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to resolve traceability"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"traceability": traceabilityJSON(traceability)})
}

func (h *ComplaintHandler) PreviewComplaintID(c echo.Context) error {
	id, err := service.GenerateNextComplaintID(c.Request().Context(), h.Queries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to preview complaint id"})
	}
	return c.JSON(http.StatusOK, map[string]string{"complaintId": id})
}

func (h *ComplaintHandler) List(c echo.Context) error {
	params := service.ComplaintListParams{
		Search: strings.TrimSpace(c.QueryParam("search")),
		Status: strings.TrimSpace(c.QueryParam("status")),
		From:   c.QueryParam("from"),
		To:     c.QueryParam("to"),
	}
	complaints, err := service.ListComplaints(c.Request().Context(), h.Pool, h.Queries, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list complaints"})
	}
	items := make([]map[string]interface{}, 0, len(complaints))
	for _, detail := range complaints {
		items = append(items, complaintDetailJSON(detail))
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"complaints": items})
}

func (h *ComplaintHandler) Get(c echo.Context) error {
	complaintID := strings.ToUpper(c.Param("complaintId"))
	ctx := c.Request().Context()
	complaint, err := h.Queries.GetComplaintByID(ctx, complaintID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Complaint not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load complaint"})
	}
	detail, err := service.LoadComplaintDetail(ctx, h.Pool, h.Queries, complaint)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load complaint"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"complaint": complaintDetailJSON(detail)})
}

func (h *ComplaintHandler) Create(c echo.Context) error {
	var req createComplaintRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if req.ComplaintDate == "" || req.ProjectName == "" || req.ClientName == "" ||
		req.SiteLocation == "" || req.ComplaintDescription == "" || len(req.BatchNumbers) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	ctx := c.Request().Context()
	complaintID := ""
	if req.ComplaintId != nil && strings.TrimSpace(*req.ComplaintId) != "" {
		complaintID = strings.ToUpper(strings.TrimSpace(*req.ComplaintId))
	} else {
		generated, err := service.GenerateNextComplaintID(ctx, h.Queries)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create complaint"})
		}
		complaintID = generated
	}

	exists, err := h.Queries.ComplaintExists(ctx, complaintID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create complaint"})
	}
	if exists {
		return c.JSON(http.StatusConflict, map[string]string{"error": fmt.Sprintf("Complaint %s already exists", complaintID)})
	}

	complaintDate, err := service.ParseSiteInstallationDate(req.ComplaintDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid complaint date"})
	}

	ok, msg := service.ValidateComplaintBatchLines(ctx, h.Queries, req.BatchNumbers)
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": msg})
	}

	var rootCause pgtype.Text
	if req.RootCauseRemarks != nil {
		rootCause = optionalText(*req.RootCauseRemarks)
	}
	var responsible db.NullResponsibleStage
	if req.ResponsibleStage != nil && *req.ResponsibleStage != "" {
		stage, valid := service.ParseResponsibleStage(*req.ResponsibleStage)
		if !valid {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid responsible stage"})
		}
		responsible = stage
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create complaint"})
	}
	defer tx.Rollback(ctx)
	qtx := h.Queries.WithTx(tx)

	complaint, err := qtx.CreateComplaint(ctx, db.CreateComplaintParams{
		ComplaintID:          complaintID,
		ComplaintDate:        complaintDate,
		ProjectName:          req.ProjectName,
		ClientName:           req.ClientName,
		SiteLocation:         req.SiteLocation,
		ComplaintDescription: req.ComplaintDescription,
		RootCauseRemarks:     rootCause,
		ResolutionStatus:     db.ResolutionStatusOPEN,
		ResponsibleStage:     responsible,
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create complaint"})
	}

	if err := createComplaintBatchLines(ctx, qtx, complaintID, req.BatchNumbers); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create complaint"})
	}
	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create complaint"})
	}

	if user, ok := middleware.GetUser(c); ok {
		batchNums := make([]string, len(req.BatchNumbers))
		for i, b := range req.BatchNumbers {
			batchNums[i] = strings.ToUpper(b)
		}
		newValues, _ := json.Marshal(map[string]interface{}{
			"complaintId":  complaintID,
			"batchNumbers": batchNums,
		})
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "CREATE",
			EntityType: textPtr("Complaint"),
			EntityID:   textPtr(complaintID),
			NewValues:  newValues,
		})
	}

	_ = service.NotifyComplaintCreated(ctx, h.Queries, complaintID, req.ProjectName, req.ClientName)

	detail, err := service.LoadComplaintDetail(ctx, h.Pool, h.Queries, complaint)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create complaint"})
	}
	return c.JSON(http.StatusCreated, map[string]interface{}{"complaint": complaintDetailJSON(detail)})
}

func (h *ComplaintHandler) Update(c echo.Context) error {
	complaintID := strings.ToUpper(c.Param("complaintId"))
	var raw map[string]json.RawMessage
	if err := c.Bind(&raw); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	ctx := c.Request().Context()
	existing, err := h.Queries.GetComplaintByID(ctx, complaintID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Complaint not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update complaint"})
	}

	var req struct {
		ComplaintDate        *string  `json:"complaintDate"`
		ProjectName          *string  `json:"projectName"`
		ClientName           *string  `json:"clientName"`
		SiteLocation         *string  `json:"siteLocation"`
		ComplaintDescription *string  `json:"complaintDescription"`
		RootCauseRemarks     *string  `json:"rootCauseRemarks"`
		ResolutionStatus     *string  `json:"resolutionStatus"`
		ResolutionDate       *string  `json:"resolutionDate"`
		ResponsibleStage     *string  `json:"responsibleStage"`
		BatchNumbers         []string `json:"batchNumbers"`
	}
	_ = json.Unmarshal(mustMarshal(raw), &req)

	if _, ok := raw["batchNumbers"]; ok {
		if len(req.BatchNumbers) == 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		}
		valid, msg := service.ValidateComplaintBatchLines(ctx, h.Queries, req.BatchNumbers)
		if !valid {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": msg})
		}
	}

	params := db.UpdateComplaintParams{ComplaintID: complaintID}
	if _, ok := raw["complaintDate"]; ok && req.ComplaintDate != nil {
		t, err := service.ParseSiteInstallationDate(*req.ComplaintDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid complaint date"})
		}
		params.ComplaintDate = t
	}
	if _, ok := raw["projectName"]; ok && req.ProjectName != nil && strings.TrimSpace(*req.ProjectName) != "" {
		params.ProjectName = textPtr(strings.TrimSpace(*req.ProjectName))
	}
	if _, ok := raw["clientName"]; ok && req.ClientName != nil && strings.TrimSpace(*req.ClientName) != "" {
		params.ClientName = textPtr(strings.TrimSpace(*req.ClientName))
	}
	if _, ok := raw["siteLocation"]; ok && req.SiteLocation != nil && strings.TrimSpace(*req.SiteLocation) != "" {
		params.SiteLocation = textPtr(strings.TrimSpace(*req.SiteLocation))
	}
	if _, ok := raw["complaintDescription"]; ok && req.ComplaintDescription != nil && strings.TrimSpace(*req.ComplaintDescription) != "" {
		params.ComplaintDescription = textPtr(strings.TrimSpace(*req.ComplaintDescription))
	}
	if _, ok := raw["rootCauseRemarks"]; ok {
		if string(raw["rootCauseRemarks"]) == "null" {
			params.RootCauseRemarks = pgtype.Text{}
		} else if req.RootCauseRemarks != nil {
			params.RootCauseRemarks = optionalText(*req.RootCauseRemarks)
		}
	}
	if _, ok := raw["resolutionStatus"]; ok && req.ResolutionStatus != nil {
		status, valid := service.ParseResolutionStatus(*req.ResolutionStatus)
		if !valid {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid resolution status"})
		}
		params.ResolutionStatus = db.NullResolutionStatus{ResolutionStatus: status, Valid: true}
	}
	if _, ok := raw["resolutionDate"]; ok {
		if string(raw["resolutionDate"]) == "null" {
			params.ResolutionDate = pgtype.Timestamp{}
		} else if req.ResolutionDate != nil {
			t, err := service.ParseSiteInstallationDate(*req.ResolutionDate)
			if err != nil {
				return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid resolution date"})
			}
			params.ResolutionDate = t
		}
	}
	if _, ok := raw["responsibleStage"]; ok {
		if string(raw["responsibleStage"]) == "null" {
			params.ResponsibleStage = db.NullResponsibleStage{}
		} else if req.ResponsibleStage != nil {
			stage, valid := service.ParseResponsibleStage(*req.ResponsibleStage)
			if !valid {
				return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid responsible stage"})
			}
			params.ResponsibleStage = stage
		}
	}

	if params.ResolutionStatus.Valid && params.ResolutionStatus.ResolutionStatus == db.ResolutionStatusCLOSED {
		if _, ok := raw["resolutionDate"]; !ok && !existing.ResolutionDate.Valid {
			params.ResolutionDate = pgtype.Timestamp{Time: time.Now().UTC(), Valid: true}
		}
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update complaint"})
	}
	defer tx.Rollback(ctx)
	qtx := h.Queries.WithTx(tx)

	if _, ok := raw["batchNumbers"]; ok {
		if err := qtx.DeleteComplaintBatchLinesByComplaint(ctx, complaintID); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update complaint"})
		}
		if err := createComplaintBatchLines(ctx, qtx, complaintID, req.BatchNumbers); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update complaint"})
		}
	}

	complaint, err := qtx.UpdateComplaint(ctx, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update complaint"})
	}
	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update complaint"})
	}

	if user, ok := middleware.GetUser(c); ok {
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "UPDATE",
			EntityType: textPtr("Complaint"),
			EntityID:   textPtr(complaintID),
			NewValues:  mustMarshal(raw),
		})
	}

	detail, err := service.LoadComplaintDetail(ctx, h.Pool, h.Queries, complaint)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update complaint"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"complaint": complaintDetailJSON(detail)})
}

func (h *ComplaintHandler) AttachPhotos(c echo.Context) error {
	complaintID := strings.ToUpper(c.Param("complaintId"))
	ctx := c.Request().Context()

	if _, err := h.Queries.GetComplaintByID(ctx, complaintID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Complaint not found"})
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

	var photos []db.ComplaintPhoto
	for _, fh := range files {
		saved, err := upload.SaveToCategory(h.UploadDir, "complaint-photos", h.MaxFileSizeBytes, h.AllowedMimeTypes, fh)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}
		photo, err := h.Queries.CreateComplaintPhoto(ctx, db.CreateComplaintPhotoParams{
			ID:           uuid.New().String(),
			ComplaintID:  complaintID,
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
			EntityType: textPtr("ComplaintPhoto"),
			EntityID:   textPtr(complaintID),
			NewValues:  newValues,
		})
	}

	photoJSON := make([]map[string]interface{}, 0, len(photos))
	for _, p := range photos {
		photoJSON = append(photoJSON, complaintPhotoJSON(p))
	}
	return c.JSON(http.StatusCreated, map[string]interface{}{"photos": photoJSON})
}

func (h *ComplaintHandler) ServePhoto(c echo.Context) error {
	photoID := c.Param("photoId")
	photo, err := h.Queries.GetComplaintPhotoByID(c.Request().Context(), photoID)
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

func createComplaintBatchLines(ctx context.Context, queries *db.Queries, complaintID string, batchNumbers []string) error {
	for _, b := range batchNumbers {
		_, err := queries.CreateComplaintBatchLine(ctx, db.CreateComplaintBatchLineParams{
			ID:          uuid.New().String(),
			ComplaintID: complaintID,
			BatchNumber: strings.ToUpper(strings.TrimSpace(b)),
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func complaintDetailJSON(detail service.ComplaintDetail) map[string]interface{} {
	photos := make([]map[string]interface{}, 0, len(detail.Photos))
	for _, p := range detail.Photos {
		photos = append(photos, complaintPhotoJSON(p))
	}
	lineJSON := make([]map[string]interface{}, 0, len(detail.BatchLines))
	for _, line := range detail.BatchLines {
		lineJSON = append(lineJSON, map[string]interface{}{
			"batchNumber":           line.BatchNumber,
			"productType":           line.ProductType,
			"productionOrderNumber": line.ProductionOrderNumber,
			"quantityProduced":      line.QuantityProduced,
		})
	}
	trace := traceabilityJSON(detail.Traceability)
	return map[string]interface{}{
		"complaintId":          detail.Complaint.ComplaintId,
		"complaintDate":        formatTimestamp(detail.Complaint.ComplaintDate),
		"projectName":          detail.Complaint.ProjectName,
		"clientName":           detail.Complaint.ClientName,
		"siteLocation":         detail.Complaint.SiteLocation,
		"complaintDescription": detail.Complaint.ComplaintDescription,
		"rootCauseRemarks":     textValue(detail.Complaint.RootCauseRemarks),
		"resolutionStatus":     string(detail.Complaint.ResolutionStatus),
		"resolutionDate":       tsValue(detail.Complaint.ResolutionDate),
		"responsibleStage":     nullResponsibleStageValue(detail.Complaint.ResponsibleStage),
		"batchNumbers":         detail.BatchNumbers,
		"batchLines":           lineJSON,
		"linkedCoilNumbers":    trace["linkedCoilNumbers"],
		"linkedSlitCoilIds":    trace["linkedSlitCoilIds"],
		"traceability":         trace,
		"photoCount":           detail.PhotoCount,
		"photos":               photos,
		"createdAt":            formatTimestamp(detail.Complaint.CreatedAt),
		"updatedAt":            formatTimestamp(detail.Complaint.UpdatedAt),
	}
}

func traceabilityJSON(trace service.BackwardTraceability) map[string]interface{} {
	coils := make([]map[string]interface{}, 0, len(trace.Coils))
	for _, coil := range trace.Coils {
		coils = append(coils, map[string]interface{}{
			"coilNumber":    coil.CoilNumber,
			"grade":         coil.Grade,
			"coating":       coil.Coating,
			"size":          coil.Size,
			"mtcNumber":     coil.MtcNumber,
			"invoiceNumber": coil.InvoiceNumber,
			"supplier":      coil.Supplier,
			"slitCoilIds":   coil.SlitCoilIds,
		})
	}
	batches := make([]map[string]interface{}, 0, len(trace.Batches))
	for _, batch := range trace.Batches {
		slits := make([]map[string]interface{}, 0, len(batch.SlitCoils))
		for _, slit := range batch.SlitCoils {
			slits = append(slits, map[string]interface{}{
				"slitCoilId":       slit.SlitCoilId,
				"parentCoilNumber": slit.ParentCoilNumber,
				"slitWidthSize":    slit.SlitWidthSize,
				"quantityConsumed": slit.QuantityConsumed,
			})
		}
		dispatches := make([]map[string]interface{}, 0, len(batch.Dispatches))
		for _, d := range batch.Dispatches {
			item := map[string]interface{}{
				"dispatchNoteNumber": d.DispatchNoteNumber,
				"projectName":        d.ProjectName,
				"quantityDispatched": d.QuantityDispatched,
				"siteInstallation": d.SiteInstallation,
			}
			dispatches = append(dispatches, item)
		}
		batches = append(batches, map[string]interface{}{
			"batchNumber":           batch.BatchNumber,
			"productType":           batch.ProductType,
			"productionOrderNumber": batch.ProductionOrderNumber,
			"quantityProduced":      batch.QuantityProduced,
			"latestQcResult":        batch.LatestQcResult,
			"slitCoils":             slits,
			"dispatches":            dispatches,
		})
	}
	return map[string]interface{}{
		"linkedCoilNumbers": trace.LinkedCoilNumbers,
		"linkedSlitCoilIds": trace.LinkedSlitCoilIds,
		"coils":             coils,
		"batches":           batches,
		"missingBatches":    trace.MissingBatches,
	}
}

func eligibleComplaintBatchJSON(batch service.EligibleComplaintBatch) map[string]interface{} {
	dispatches := make([]map[string]interface{}, 0, len(batch.Dispatches))
	for _, d := range batch.Dispatches {
		dispatches = append(dispatches, map[string]interface{}{
			"dispatchNoteNumber":  d.DispatchNoteNumber,
			"projectName":         d.ProjectName,
			"clientName":          d.ClientName,
			"siteLocation":        d.SiteLocation,
			"quantityDispatched":  d.QuantityDispatched,
			"hasSiteInstallation": d.HasSiteInstallation,
		})
	}
	return map[string]interface{}{
		"batchNumber":           batch.BatchNumber,
		"productType":           batch.ProductType,
		"productionOrderNumber": batch.ProductionOrderNumber,
		"quantityProduced":      batch.QuantityProduced,
		"dispatches":            dispatches,
	}
}

func complaintPhotoJSON(p db.ComplaintPhoto) map[string]interface{} {
	return map[string]interface{}{
		"id":           p.ID,
		"filename":     p.Filename,
		"originalName": p.OriginalName,
		"mimetype":     p.Mimetype,
		"size":         p.Size,
		"createdAt":    formatTimestamp(p.CreatedAt),
	}
}

func nullResponsibleStageValue(stage db.NullResponsibleStage) interface{} {
	if !stage.Valid {
		return nil
	}
	return string(stage.ResponsibleStage)
}
