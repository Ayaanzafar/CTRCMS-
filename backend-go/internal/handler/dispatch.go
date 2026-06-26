package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/db"
	"github.com/sunrack/ctrcms-go/internal/middleware"
	"github.com/sunrack/ctrcms-go/internal/service"
)

type DispatchHandler struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
}

type dispatchBatchLineRequest struct {
	BatchNumber        string  `json:"batchNumber"`
	QuantityDispatched float64 `json:"quantityDispatched"`
}

type createDispatchRequest struct {
	DispatchNoteNumber *string                    `json:"dispatchNoteNumber"`
	DispatchDate       string                     `json:"dispatchDate"`
	VehicleNumber      *string                    `json:"vehicleNumber"`
	TransporterName    *string                    `json:"transporterName"`
	ProjectName        string                     `json:"projectName"`
	ClientName         string                     `json:"clientName"`
	SiteLocation       string                     `json:"siteLocation"`
	BatchLines         []dispatchBatchLineRequest `json:"batchLines"`
}

func (h *DispatchHandler) Stats(c echo.Context) error {
	stats, err := service.GetDispatchStats(c.Request().Context(), h.Queries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load stats"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"stats": stats})
}

func (h *DispatchHandler) PreviewDispatchNote(c echo.Context) error {
	note, err := service.GenerateNextDispatchNoteNumber(c.Request().Context(), h.Queries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to preview dispatch note"})
	}
	return c.JSON(http.StatusOK, map[string]string{"dispatchNoteNumber": note})
}

func (h *DispatchHandler) List(c echo.Context) error {
	params := service.DispatchListParams{
		Search:      strings.TrimSpace(c.QueryParam("search")),
		ProjectName: strings.TrimSpace(c.QueryParam("projectName")),
		From:        c.QueryParam("from"),
		To:          c.QueryParam("to"),
	}

	records, err := service.ListDispatches(c.Request().Context(), h.Pool, h.Queries, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list dispatches"})
	}

	dispatches := make([]map[string]interface{}, 0, len(records))
	for _, record := range records {
		dispatches = append(dispatches, dispatchRecordJSON(record))
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"dispatches": dispatches})
}

func (h *DispatchHandler) Get(c echo.Context) error {
	noteNumber := strings.ToUpper(c.Param("dispatchNoteNumber"))
	ctx := c.Request().Context()

	dispatch, err := h.Queries.GetSiteDispatchByNoteNumber(ctx, noteNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Dispatch note not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load dispatch"})
	}

	record, err := service.LoadDispatchRecord(ctx, h.Queries, dispatch)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load dispatch"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"dispatch": dispatchRecordJSON(record)})
}

func (h *DispatchHandler) Create(c echo.Context) error {
	var req createDispatchRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	if req.DispatchDate == "" || req.ProjectName == "" || req.ClientName == "" || req.SiteLocation == "" || len(req.BatchLines) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	ctx := c.Request().Context()

	dispatchNoteNumber := ""
	if req.DispatchNoteNumber != nil && strings.TrimSpace(*req.DispatchNoteNumber) != "" {
		dispatchNoteNumber = strings.ToUpper(strings.TrimSpace(*req.DispatchNoteNumber))
	} else {
		generated, err := service.GenerateNextDispatchNoteNumber(ctx, h.Queries)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create dispatch"})
		}
		dispatchNoteNumber = generated
	}

	exists, err := h.Queries.SiteDispatchExists(ctx, dispatchNoteNumber)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create dispatch"})
	}
	if exists {
		return c.JSON(http.StatusConflict, map[string]string{
			"error": fmt.Sprintf("Dispatch note %s already exists", dispatchNoteNumber),
		})
	}

	dispatchDate, err := service.ParseDispatchDate(req.DispatchDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid dispatch date"})
	}

	lines := toDispatchBatchLineInputs(req.BatchLines)
	ok, msg := service.ValidateDispatchBatchLines(ctx, h.Queries, lines, "")
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": msg})
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create dispatch"})
	}
	defer tx.Rollback(ctx)

	qtx := h.Queries.WithTx(tx)
	dispatch, err := qtx.CreateSiteDispatch(ctx, db.CreateSiteDispatchParams{
		DispatchNoteNumber: dispatchNoteNumber,
		DispatchDate:       dispatchDate,
		VehicleNumber:      optionalStringPtr(req.VehicleNumber),
		TransporterName:    optionalStringPtr(req.TransporterName),
		ProjectName:        req.ProjectName,
		ClientName:         req.ClientName,
		SiteLocation:       req.SiteLocation,
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create dispatch"})
	}

	if err := createDispatchBatchLines(ctx, qtx, dispatchNoteNumber, lines); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create dispatch"})
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create dispatch"})
	}

	h.auditDispatchCreate(c, dispatchNoteNumber, lines)

	record, err := service.LoadDispatchRecord(ctx, h.Queries, dispatch)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create dispatch"})
	}
	return c.JSON(http.StatusCreated, map[string]interface{}{"dispatch": dispatchRecordJSON(record)})
}

func (h *DispatchHandler) Update(c echo.Context) error {
	dispatchNoteNumber := strings.ToUpper(c.Param("dispatchNoteNumber"))
	var raw map[string]json.RawMessage
	if err := c.Bind(&raw); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	ctx := c.Request().Context()
	if _, err := h.Queries.GetSiteDispatchByNoteNumber(ctx, dispatchNoteNumber); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Dispatch note not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update dispatch"})
	}

	var req struct {
		DispatchDate    *string                    `json:"dispatchDate"`
		VehicleNumber   *string                    `json:"vehicleNumber"`
		TransporterName *string                    `json:"transporterName"`
		ProjectName     *string                    `json:"projectName"`
		ClientName      *string                    `json:"clientName"`
		SiteLocation    *string                    `json:"siteLocation"`
		BatchLines      []dispatchBatchLineRequest `json:"batchLines"`
	}
	_ = json.Unmarshal(mustMarshal(raw), &req)

	var lines []service.DispatchBatchLineInput
	if _, ok := raw["batchLines"]; ok {
		if len(req.BatchLines) == 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		}
		lines = toDispatchBatchLineInputs(req.BatchLines)
		valid, msg := service.ValidateDispatchBatchLines(ctx, h.Queries, lines, dispatchNoteNumber)
		if !valid {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": msg})
		}
	}

	params := db.UpdateSiteDispatchParams{DispatchNoteNumber: dispatchNoteNumber}
	if _, ok := raw["dispatchDate"]; ok && req.DispatchDate != nil {
		t, err := service.ParseDispatchDate(*req.DispatchDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid dispatch date"})
		}
		params.DispatchDate = t
	}
	if _, ok := raw["vehicleNumber"]; ok {
		params.VehicleNumber = optionalStringPtr(req.VehicleNumber)
	}
	if _, ok := raw["transporterName"]; ok {
		params.TransporterName = optionalStringPtr(req.TransporterName)
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

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update dispatch"})
	}
	defer tx.Rollback(ctx)

	qtx := h.Queries.WithTx(tx)
	if len(lines) > 0 {
		if err := qtx.DeleteDispatchBatchLinesByNote(ctx, dispatchNoteNumber); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update dispatch"})
		}
		if err := createDispatchBatchLines(ctx, qtx, dispatchNoteNumber, lines); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update dispatch"})
		}
	}

	dispatch, err := qtx.UpdateSiteDispatch(ctx, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update dispatch"})
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update dispatch"})
	}

	if user, ok := middleware.GetUser(c); ok {
		newValues, _ := json.Marshal(raw)
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "UPDATE",
			EntityType: textPtr("SiteDispatch"),
			EntityID:   textPtr(dispatchNoteNumber),
			NewValues:  newValues,
		})
	}

	record, err := service.LoadDispatchRecord(ctx, h.Queries, dispatch)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update dispatch"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"dispatch": dispatchRecordJSON(record)})
}

func createDispatchBatchLines(ctx context.Context, queries *db.Queries, dispatchNoteNumber string, lines []service.DispatchBatchLineInput) error {
	for _, line := range lines {
		qty, err := service.WeightFromFloat(line.QuantityDispatched)
		if err != nil {
			return err
		}
		_, err = queries.CreateDispatchBatchLine(ctx, db.CreateDispatchBatchLineParams{
			ID:                 uuid.New().String(),
			DispatchNoteNumber: dispatchNoteNumber,
			BatchNumber:        strings.ToUpper(line.BatchNumber),
			QuantityDispatched: qty,
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func toDispatchBatchLineInputs(lines []dispatchBatchLineRequest) []service.DispatchBatchLineInput {
	out := make([]service.DispatchBatchLineInput, len(lines))
	for i, line := range lines {
		out[i] = service.DispatchBatchLineInput{
			BatchNumber:        line.BatchNumber,
			QuantityDispatched: line.QuantityDispatched,
		}
	}
	return out
}

func (h *DispatchHandler) auditDispatchCreate(c echo.Context, dispatchNoteNumber string, lines []service.DispatchBatchLineInput) {
	user, ok := middleware.GetUser(c)
	if !ok {
		return
	}
	batchNumbers := make([]string, len(lines))
	for i, line := range lines {
		batchNumbers[i] = strings.ToUpper(line.BatchNumber)
	}
	newValues, _ := json.Marshal(map[string]interface{}{
		"dispatchNoteNumber": dispatchNoteNumber,
		"batchNumbers":       batchNumbers,
	})
	_, _ = h.Queries.CreateAuditLogWithValues(c.Request().Context(), db.CreateAuditLogWithValuesParams{
		ID:         uuid.New().String(),
		UserID:     user.ID,
		Action:     "CREATE",
		EntityType: textPtr("SiteDispatch"),
		EntityID:   textPtr(dispatchNoteNumber),
		NewValues:  newValues,
	})
}

func dispatchRecordJSON(record service.DispatchRecord) map[string]interface{} {
	lines := make([]map[string]interface{}, 0, len(record.BatchLines))
	for _, line := range record.BatchLines {
		item := map[string]interface{}{
			"id":                 line.Line.ID,
			"batchNumber":        line.Line.BatchNumber,
			"quantityDispatched": line.LineQuantityDispatched,
		}
		if line.Batch != nil {
			item["batch"] = map[string]interface{}{
				"batchNumber":           line.Batch.BatchNumber,
				"productionOrderNumber": line.Batch.ProductionOrderNumber,
				"productType":           line.Batch.ProductType,
				"quantityProduced":      line.QuantityProduced,
				"productionDate":        formatTimestamp(line.Batch.ProductionDate),
				"quantityDispatched":    line.BatchQuantityDispatched,
				"quantityAvailable":     line.QuantityAvailable,
			}
		}
		lines = append(lines, item)
	}

	out := map[string]interface{}{
		"dispatchNoteNumber":      record.Dispatch.DispatchNoteNumber,
		"dispatchDate":            formatTimestamp(record.Dispatch.DispatchDate),
		"vehicleNumber":           textValue(record.Dispatch.VehicleNumber),
		"transporterName":         textValue(record.Dispatch.TransporterName),
		"projectName":             record.Dispatch.ProjectName,
		"clientName":              record.Dispatch.ClientName,
		"siteLocation":            record.Dispatch.SiteLocation,
		"batchLines":              lines,
		"batchCount":              len(lines),
		"totalQuantityDispatched": record.TotalQtyDispatched,
		"createdAt":               formatTimestamp(record.Dispatch.CreatedAt),
		"updatedAt":               formatTimestamp(record.Dispatch.UpdatedAt),
	}

	if record.SiteInstallation != nil {
		si := record.SiteInstallation
		out["siteInstallation"] = map[string]interface{}{
			"id":                  si.ID,
			"siteReceiptDate":     formatTimestamp(si.SiteReceiptDate),
			"installationDate":    formatTimestamp(si.InstallationDate),
			"installerEpcPartner": si.InstallerEpcPartner,
			"quantityInstalled":   si.QuantityInstalled,
			"photoCount":          si.PhotoCount,
		}
	} else {
		out["siteInstallation"] = nil
	}
	return out
}
