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

type SiteInstallationHandler struct {
	Queries          *db.Queries
	Pool             *pgxpool.Pool
	UploadDir        string
	MaxFileSizeBytes int64
	AllowedMimeTypes []string
}

type createSiteInstallationRequest struct {
	DispatchNoteNumber  string  `json:"dispatchNoteNumber"`
	SiteReceiptDate     string  `json:"siteReceiptDate"`
	InstallationDate    string  `json:"installationDate"`
	InstallerEpcPartner string  `json:"installerEpcPartner"`
	QuantityInstalled   float64 `json:"quantityInstalled"`
}

func (h *SiteInstallationHandler) Stats(c echo.Context) error {
	stats, err := service.GetSiteInstallationStats(c.Request().Context(), h.Queries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load stats"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"stats": stats})
}

func (h *SiteInstallationHandler) PendingDispatches(c echo.Context) error {
	pending, err := service.ListPendingDispatches(c.Request().Context(), h.Pool, h.Queries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list pending dispatches"})
	}

	items := make([]map[string]interface{}, 0, len(pending))
	for _, row := range pending {
		items = append(items, pendingDispatchJSON(row))
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"pending": items})
}

func (h *SiteInstallationHandler) List(c echo.Context) error {
	params := service.SiteInstallationListParams{
		Search: strings.TrimSpace(c.QueryParam("search")),
		From:   c.QueryParam("from"),
		To:     c.QueryParam("to"),
	}

	installations, err := service.ListSiteInstallations(c.Request().Context(), h.Pool, h.Queries, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list site installations"})
	}

	items := make([]map[string]interface{}, 0, len(installations))
	for _, detail := range installations {
		items = append(items, siteInstallationDetailJSON(detail))
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"installations": items})
}

func (h *SiteInstallationHandler) Get(c echo.Context) error {
	id := c.Param("id")
	ctx := c.Request().Context()

	installation, err := h.Queries.GetSiteInstallationByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Site installation not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load site installation"})
	}

	detail, err := service.LoadSiteInstallationDetail(ctx, h.Pool, h.Queries, installation)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load site installation"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"installation": siteInstallationDetailJSON(detail)})
}

func (h *SiteInstallationHandler) GetByDispatch(c echo.Context) error {
	dispatchNoteNumber := strings.ToUpper(c.Param("dispatchNoteNumber"))
	ctx := c.Request().Context()

	installation, err := h.Queries.GetSiteInstallationByDispatchNote(ctx, dispatchNoteNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "No site installation for this dispatch note"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load site installation"})
	}

	detail, err := service.LoadSiteInstallationDetail(ctx, h.Pool, h.Queries, installation)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load site installation"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"installation": siteInstallationDetailJSON(detail)})
}

func (h *SiteInstallationHandler) Create(c echo.Context) error {
	var req createSiteInstallationRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	req.DispatchNoteNumber = strings.TrimSpace(req.DispatchNoteNumber)
	req.InstallerEpcPartner = strings.TrimSpace(req.InstallerEpcPartner)
	if req.DispatchNoteNumber == "" || req.SiteReceiptDate == "" || req.InstallationDate == "" ||
		req.InstallerEpcPartner == "" || req.QuantityInstalled <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	dispatchNoteNumber := strings.ToUpper(req.DispatchNoteNumber)
	ctx := c.Request().Context()

	ok, msg := service.ValidateSiteInstallation(ctx, h.Queries, dispatchNoteNumber, req.QuantityInstalled)
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": msg})
	}

	siteReceiptDate, err := service.ParseSiteInstallationDate(req.SiteReceiptDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid site receipt or installation date"})
	}
	installationDate, err := service.ParseSiteInstallationDate(req.InstallationDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid site receipt or installation date"})
	}

	qtyInstalled, err := service.WeightFromFloat(req.QuantityInstalled)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid quantity installed"})
	}

	id := uuid.New().String()
	installation, err := h.Queries.CreateSiteInstallation(ctx, db.CreateSiteInstallationParams{
		ID:                  id,
		DispatchNoteNumber:  dispatchNoteNumber,
		SiteReceiptDate:     siteReceiptDate,
		InstallationDate:    installationDate,
		InstallerEpcPartner: req.InstallerEpcPartner,
		QuantityInstalled:   qtyInstalled,
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create site installation"})
	}

	if user, ok := middleware.GetUser(c); ok {
		newValues, _ := json.Marshal(map[string]interface{}{
			"dispatchNoteNumber": dispatchNoteNumber,
			"quantityInstalled":  req.QuantityInstalled,
		})
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "CREATE",
			EntityType: textPtr("SiteInstallation"),
			EntityID:   textPtr(installation.ID),
			NewValues:  newValues,
		})
	}

	detail, err := service.LoadSiteInstallationDetail(ctx, h.Pool, h.Queries, installation)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create site installation"})
	}
	return c.JSON(http.StatusCreated, map[string]interface{}{"installation": siteInstallationDetailJSON(detail)})
}

func (h *SiteInstallationHandler) Update(c echo.Context) error {
	id := c.Param("id")
	var raw map[string]json.RawMessage
	if err := c.Bind(&raw); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	ctx := c.Request().Context()
	existing, err := h.Queries.GetSiteInstallationByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Site installation not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update site installation"})
	}

	var req struct {
		SiteReceiptDate     *string  `json:"siteReceiptDate"`
		InstallationDate    *string  `json:"installationDate"`
		InstallerEpcPartner *string  `json:"installerEpcPartner"`
		QuantityInstalled   *float64 `json:"quantityInstalled"`
	}
	_ = json.Unmarshal(mustMarshal(raw), &req)

	params := db.UpdateSiteInstallationParams{ID: id}
	if _, ok := raw["quantityInstalled"]; ok && req.QuantityInstalled != nil {
		valid, msg := service.ValidateSiteInstallationUpdate(ctx, h.Queries, id, existing.DispatchNoteNumber, *req.QuantityInstalled)
		if !valid {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": msg})
		}
		qty, err := service.WeightFromFloat(*req.QuantityInstalled)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid quantity installed"})
		}
		params.QuantityInstalled = qty
	}
	if _, ok := raw["siteReceiptDate"]; ok && req.SiteReceiptDate != nil {
		t, err := service.ParseSiteInstallationDate(*req.SiteReceiptDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid site receipt date"})
		}
		params.SiteReceiptDate = t
	}
	if _, ok := raw["installationDate"]; ok && req.InstallationDate != nil {
		t, err := service.ParseSiteInstallationDate(*req.InstallationDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid installation date"})
		}
		params.InstallationDate = t
	}
	if _, ok := raw["installerEpcPartner"]; ok && req.InstallerEpcPartner != nil && strings.TrimSpace(*req.InstallerEpcPartner) != "" {
		params.InstallerEpcPartner = textPtr(strings.TrimSpace(*req.InstallerEpcPartner))
	}

	installation, err := h.Queries.UpdateSiteInstallation(ctx, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update site installation"})
	}

	if user, ok := middleware.GetUser(c); ok {
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "UPDATE",
			EntityType: textPtr("SiteInstallation"),
			EntityID:   textPtr(id),
			NewValues:  mustMarshal(raw),
		})
	}

	detail, err := service.LoadSiteInstallationDetail(ctx, h.Pool, h.Queries, installation)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update site installation"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"installation": siteInstallationDetailJSON(detail)})
}

func (h *SiteInstallationHandler) AttachPhotos(c echo.Context) error {
	id := c.Param("id")
	ctx := c.Request().Context()

	if _, err := h.Queries.GetSiteInstallationByID(ctx, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Site installation not found"})
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

	var photos []db.SiteInstallationPhoto
	for _, fh := range files {
		saved, err := upload.SaveToCategory(h.UploadDir, "installation-photos", h.MaxFileSizeBytes, h.AllowedMimeTypes, fh)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}

		photo, err := h.Queries.CreateSiteInstallationPhoto(ctx, db.CreateSiteInstallationPhotoParams{
			ID:             uuid.New().String(),
			InstallationID: id,
			Filename:       saved.Filename,
			OriginalName:   saved.OriginalName,
			Mimetype:       saved.Mimetype,
			Size:           saved.Size,
			StoragePath:    saved.StoragePath,
			UploadedByID:   uploadedBy,
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
			EntityType: textPtr("SiteInstallationPhoto"),
			EntityID:   textPtr(id),
			NewValues:  newValues,
		})
	}

	photoJSON := make([]map[string]interface{}, 0, len(photos))
	for _, p := range photos {
		photoJSON = append(photoJSON, siteInstallationPhotoJSON(p))
	}
	return c.JSON(http.StatusCreated, map[string]interface{}{"photos": photoJSON})
}

func (h *SiteInstallationHandler) ServePhoto(c echo.Context) error {
	photoID := c.Param("photoId")
	photo, err := h.Queries.GetSiteInstallationPhotoByID(c.Request().Context(), photoID)
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

func siteInstallationDetailJSON(detail service.SiteInstallationDetail) map[string]interface{} {
	photos := make([]map[string]interface{}, 0, len(detail.Photos))
	for _, p := range detail.Photos {
		photos = append(photos, siteInstallationPhotoJSON(p))
	}

	return map[string]interface{}{
		"id":                  detail.Installation.ID,
		"dispatchNoteNumber":  detail.Installation.DispatchNoteNumber,
		"siteReceiptDate":     formatTimestamp(detail.Installation.SiteReceiptDate),
		"installationDate":    formatTimestamp(detail.Installation.InstallationDate),
		"installerEpcPartner": detail.Installation.InstallerEpcPartner,
		"quantityInstalled":   detail.QuantityInstalled,
		"totalDispatched":     detail.TotalDispatched,
		"photoCount":          detail.PhotoCount,
		"photos":              photos,
		"dispatch":            siteInstallationDispatchJSON(detail.Dispatch),
		"createdAt":           formatTimestamp(detail.Installation.CreatedAt),
		"updatedAt":           formatTimestamp(detail.Installation.UpdatedAt),
	}
}

func siteInstallationDispatchJSON(dispatch service.SiteInstallationDispatchSummary) map[string]interface{} {
	lines := make([]map[string]interface{}, 0, len(dispatch.BatchLines))
	for _, line := range dispatch.BatchLines {
		lines = append(lines, map[string]interface{}{
			"batchNumber":        line.BatchNumber,
			"quantityDispatched": line.QuantityDispatched,
			"productType":        line.ProductType,
		})
	}
	return map[string]interface{}{
		"dispatchNoteNumber":      dispatch.DispatchNoteNumber,
		"dispatchDate":            formatTimestamp(dispatch.DispatchDate),
		"projectName":             dispatch.ProjectName,
		"clientName":              dispatch.ClientName,
		"siteLocation":            dispatch.SiteLocation,
		"vehicleNumber":           textValue(dispatch.VehicleNumber),
		"transporterName":         textValue(dispatch.TransporterName),
		"batchLines":              lines,
		"totalQuantityDispatched": dispatch.TotalQtyDispatched,
	}
}

func pendingDispatchJSON(row service.PendingDispatchRow) map[string]interface{} {
	lines := make([]map[string]interface{}, 0, len(row.BatchLines))
	for _, line := range row.BatchLines {
		lines = append(lines, map[string]interface{}{
			"batchNumber":        line.BatchNumber,
			"quantityDispatched": line.QuantityDispatched,
			"productType":        line.ProductType,
		})
	}
	return map[string]interface{}{
		"dispatchNoteNumber":      row.DispatchNoteNumber,
		"dispatchDate":            formatTimestamp(row.DispatchDate),
		"projectName":             row.ProjectName,
		"clientName":              row.ClientName,
		"siteLocation":            row.SiteLocation,
		"vehicleNumber":           textValue(row.VehicleNumber),
		"transporterName":         textValue(row.TransporterName),
		"totalQuantityDispatched": row.TotalQtyDispatched,
		"batchLines":              lines,
	}
}

func siteInstallationPhotoJSON(p db.SiteInstallationPhoto) map[string]interface{} {
	return map[string]interface{}{
		"id":           p.ID,
		"filename":     p.Filename,
		"originalName": p.OriginalName,
		"mimetype":     p.Mimetype,
		"size":         p.Size,
		"createdAt":    formatTimestamp(p.CreatedAt),
	}
}
