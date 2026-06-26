package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
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

type CoilsHandler struct {
	Queries          *db.Queries
	Pool             *pgxpool.Pool
	UploadDir        string
	MaxFileSizeBytes int64
	AllowedMimeTypes []string
}

type coilBodyRequest struct {
	CoilNumber                string  `json:"coilNumber"`
	Grade                     string  `json:"grade"`
	Coating                   string  `json:"coating"`
	Size                      string  `json:"size"`
	Weight                    float64 `json:"weight"`
	Supplier                  *string `json:"supplier"`
	MtcNumber                 *string `json:"mtcNumber"`
	InvoiceNumber             *string `json:"invoiceNumber"`
	AmnsDispatchDate          *string `json:"amnsDispatchDate"`
	VehicleNumber             *string `json:"vehicleNumber"`
	TransporterName           *string `json:"transporterName"`
	ReceiptDateSlitter        *string `json:"receiptDateSlitter"`
	ReceivingConditionRemarks *string `json:"receivingConditionRemarks"`
}

func (h *CoilsHandler) List(c echo.Context) error {
	limit, hasLimit, offset := parsePagination(c)
	params := service.CoilListParams{
		Search:          strings.TrimSpace(c.QueryParam("search")),
		Grade:           strings.TrimSpace(c.QueryParam("grade")),
		Supplier:        strings.TrimSpace(c.QueryParam("supplier")),
		From:            c.QueryParam("from"),
		To:              c.QueryParam("to"),
		IncludeArchived: c.QueryParam("includeArchived") == "true",
		ActiveOnly:      c.QueryParam("activeOnly") == "true",
		QuickFilter:     strings.TrimSpace(c.QueryParam("quickFilter")),
		SortBy:          strings.TrimSpace(c.QueryParam("sortBy")),
		SortOrder:       c.QueryParam("sortOrder"),
		Offset:          offset,
	}
	if hasLimit {
		params.Limit = &limit
	}

	ctx := c.Request().Context()
	rows, total, err := service.ListCoils(ctx, h.Pool, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list coils"})
	}

	coilNumbers := make([]string, len(rows))
	for i, row := range rows {
		coilNumbers[i] = row.CoilNumber
	}
	docMap, err := h.listDocumentSummaries(c, coilNumbers)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list coils"})
	}

	coils := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		docs := docMap[row.CoilNumber]
		if docs == nil {
			docs = []map[string]interface{}{}
		}
		coils = append(coils, coilListRowJSON(row, docs))
	}

	resp := map[string]interface{}{
		"coils": coils,
		"total": total,
	}
	if hasLimit {
		resp["limit"] = limit
		resp["offset"] = offset
	}
	return c.JSON(http.StatusOK, resp)
}

func (h *CoilsHandler) Stats(c echo.Context) error {
	includeArchived := c.QueryParam("includeArchived") == "true"
	stats, err := service.GetCoilStats(c.Request().Context(), h.Queries, includeArchived)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load stats"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"stats": stats})
}

func (h *CoilsHandler) Get(c echo.Context) error {
	coilNumber := c.Param("coilNumber")
	reqCtx := c.Request().Context()

	coil, err := h.Queries.GetCoilByNumber(reqCtx, coilNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Coil not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load coil"})
	}

	docs, err := h.Queries.ListCoilDocuments(reqCtx, coilNumber)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load coil"})
	}
	slits, err := h.Queries.ListSlittingByCoil(reqCtx, coilNumber)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load coil"})
	}
	usage, err := service.GetCoilUsage(reqCtx, h.Queries, coilNumber)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load coil"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"coil":  coilDetailJSON(coil, docs, slits),
		"usage": usage,
	})
}

func (h *CoilsHandler) Usage(c echo.Context) error {
	coilNumber := c.Param("coilNumber")
	usage, err := service.GetCoilUsage(c.Request().Context(), h.Queries, coilNumber)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load usage"})
	}
	if usage == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Coil not found"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"usage": usage})
}

func (h *CoilsHandler) AuditLogs(c echo.Context) error {
	coilNumber := c.Param("coilNumber")
	reqCtx := c.Request().Context()

	if _, err := h.Queries.GetCoilByNumber(reqCtx, coilNumber); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Coil not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load audit logs"})
	}

	limit := int32(10)
	if v := c.QueryParam("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = int32(math.Min(float64(n), 25))
		}
	}

	docIDs, err := h.Queries.ListCoilDocumentIDs(reqCtx, coilNumber)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load audit logs"})
	}
	if docIDs == nil {
		docIDs = []string{}
	}

	rows, err := h.Queries.ListCoilAuditLogs(reqCtx, db.ListCoilAuditLogsParams{
		CoilNumber:  textPtr(coilNumber),
		DocumentIds: docIDs,
		RowLimit:    limit,
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load audit logs"})
	}

	logs := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		logs = append(logs, auditLogRowJSON(row))
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"logs": logs})
}

func (h *CoilsHandler) Create(c echo.Context) error {
	var req coilBodyRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if err := validateCoilBody(&req, true); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]interface{}{"error": err})
	}

	coilNumber := strings.ToUpper(strings.TrimSpace(req.CoilNumber))
	reqCtx := c.Request().Context()

	exists, err := h.Queries.CoilExists(reqCtx, coilNumber)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create coil"})
	}
	if exists {
		return c.JSON(http.StatusConflict, map[string]string{"error": fmt.Sprintf("Coil %s already exists", coilNumber)})
	}

	weight, err := weightFromFloat(req.Weight)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]interface{}{"error": err})
	}

	var supplier interface{}
	if req.Supplier != nil {
		supplier = *req.Supplier
	}

	coil, err := h.Queries.CreateCoil(reqCtx, db.CreateCoilParams{
		CoilNumber:                coilNumber,
		Grade:                     req.Grade,
		Coating:                   req.Coating,
		Size:                      req.Size,
		Weight:                    weight,
		Supplier:                  supplier,
		MtcNumber:                 optionalStringPtr(req.MtcNumber),
		InvoiceNumber:             optionalStringPtr(req.InvoiceNumber),
		AmnsDispatchDate:          parseOptionalDate(req.AmnsDispatchDate),
		VehicleNumber:             optionalStringPtr(req.VehicleNumber),
		TransporterName:           optionalStringPtr(req.TransporterName),
		ReceiptDateSlitter:        parseOptionalDate(req.ReceiptDateSlitter),
		ReceivingConditionRemarks: optionalStringPtr(req.ReceivingConditionRemarks),
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create coil"})
	}

	h.auditCoilCreate(c, coil)

	docs, _ := h.Queries.ListCoilDocuments(reqCtx, coil.CoilNumber)
	return c.JSON(http.StatusCreated, map[string]interface{}{
		"coil": coilDetailJSON(coil, docs, nil),
	})
}

func (h *CoilsHandler) Update(c echo.Context) error {
	coilNumber := c.Param("coilNumber")
	var raw map[string]json.RawMessage
	if err := c.Bind(&raw); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	reqCtx := c.Request().Context()
	existing, err := h.Queries.GetCoilByNumber(reqCtx, coilNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Coil not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update coil"})
	}

	usage, err := service.GetCoilUsage(reqCtx, h.Queries, coilNumber)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update coil"})
	}

	var req coilBodyRequest
	if err := json.Unmarshal(mustMarshal(raw), &req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if err := validateCoilBodyPartial(raw, &req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]interface{}{"error": err})
	}

	if usage != nil && !usage.CanEditCriticalFields {
		locked := criticalFieldsChanged(existing, raw, &req)
		if len(locked) > 0 {
			return c.JSON(http.StatusConflict, map[string]interface{}{
				"error":        "Traceability-critical fields cannot be changed after this coil is used in slitting or downstream processes.",
				"lockedFields": locked,
				"usage":        usage,
			})
		}
	}

	params := db.UpdateCoilParams{CoilNumber: coilNumber}
	if _, ok := raw["grade"]; ok {
		params.Grade = textPtr(req.Grade)
	}
	if _, ok := raw["coating"]; ok {
		params.Coating = textPtr(req.Coating)
	}
	if _, ok := raw["size"]; ok {
		params.Size = textPtr(req.Size)
	}
	if _, ok := raw["weight"]; ok {
		w, werr := weightFromFloat(req.Weight)
		if werr != nil {
			return c.JSON(http.StatusBadRequest, map[string]interface{}{"error": werr})
		}
		params.Weight = w
	}
	if _, ok := raw["supplier"]; ok && req.Supplier != nil {
		params.Supplier = textPtr(*req.Supplier)
	}
	if _, ok := raw["mtcNumber"]; ok {
		params.MtcNumber = optionalStringPtr(req.MtcNumber)
	}
	if _, ok := raw["invoiceNumber"]; ok {
		params.InvoiceNumber = optionalStringPtr(req.InvoiceNumber)
	}
	if _, ok := raw["amnsDispatchDate"]; ok {
		params.AmnsDispatchDate = parseOptionalDate(req.AmnsDispatchDate)
	}
	if _, ok := raw["vehicleNumber"]; ok {
		params.VehicleNumber = optionalStringPtr(req.VehicleNumber)
	}
	if _, ok := raw["transporterName"]; ok {
		params.TransporterName = optionalStringPtr(req.TransporterName)
	}
	if _, ok := raw["receiptDateSlitter"]; ok {
		params.ReceiptDateSlitter = parseOptionalDate(req.ReceiptDateSlitter)
	}
	if _, ok := raw["receivingConditionRemarks"]; ok {
		params.ReceivingConditionRemarks = optionalStringPtr(req.ReceivingConditionRemarks)
	}

	coil, err := h.Queries.UpdateCoil(reqCtx, params)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update coil"})
	}

	h.auditCoilUpdate(c, existing, coil)

	docs, _ := h.Queries.ListCoilDocuments(reqCtx, coil.CoilNumber)
	usage, _ = service.GetCoilUsage(reqCtx, h.Queries, coilNumber)
	return c.JSON(http.StatusOK, map[string]interface{}{
		"coil":  coilDetailJSON(coil, docs, nil),
		"usage": usage,
	})
}

func (h *CoilsHandler) Delete(c echo.Context) error {
	coilNumber := c.Param("coilNumber")
	reqCtx := c.Request().Context()

	existing, err := h.Queries.GetCoilByNumber(reqCtx, coilNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Coil not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete coil"})
	}

	usage, err := service.GetCoilUsage(reqCtx, h.Queries, coilNumber)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete coil"})
	}
	if usage == nil || !usage.CanDelete {
		return c.JSON(http.StatusConflict, map[string]interface{}{
			"error": "This coil is already part of traceability. It cannot be deleted. You can archive it instead.",
			"usage": usage,
		})
	}

	if err := h.Queries.DeleteCoil(reqCtx, coilNumber); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete coil"})
	}

	h.auditCoilDelete(c, existing)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"message":    "Coil deleted",
		"coilNumber": coilNumber,
	})
}

func (h *CoilsHandler) Archive(c echo.Context) error {
	coilNumber := c.Param("coilNumber")
	reqCtx := c.Request().Context()

	existing, err := h.Queries.GetCoilByNumber(reqCtx, coilNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Coil not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to archive coil"})
	}

	usage, err := service.GetCoilUsage(reqCtx, h.Queries, coilNumber)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to archive coil"})
	}

	if existing.Status == db.CoilStatusARCHIVED {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Coil is already archived"})
	}

	if usage == nil || !usage.CanArchive {
		msg := "This coil cannot be archived."
		if usage != nil && usage.CanDelete {
			msg = "This coil has no linked traceability records. Delete it instead of archiving."
		}
		return c.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": msg,
			"usage": usage,
		})
	}

	var archivedBy pgtype.Text
	if user, ok := middleware.GetUser(c); ok {
		archivedBy = textPtr(user.ID)
	}

	coil, err := h.Queries.ArchiveCoil(reqCtx, db.ArchiveCoilParams{
		CoilNumber:   coilNumber,
		ArchivedByID: archivedBy,
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to archive coil"})
	}

	h.auditCoilArchive(c, coil)

	docs, _ := h.Queries.ListCoilDocuments(reqCtx, coil.CoilNumber)
	docCount, _ := h.Queries.CountDocumentsByCoil(reqCtx, coil.CoilNumber)
	slitCount, _ := h.Queries.CountSlittingByCoil(reqCtx, coil.CoilNumber)
	usage, _ = service.GetCoilUsage(reqCtx, h.Queries, coilNumber)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"coil":  coilIncludeJSON(coil, docs, docCount, slitCount),
		"usage": usage,
	})
}

func (h *CoilsHandler) AttachDocument(c echo.Context) error {
	coilNumber := c.Param("coilNumber")
	documentType := c.FormValue("documentType")
	if documentType == "" {
		documentType = "MTC"
	}
	if documentType != "MTC" && documentType != "INVOICE" && documentType != "OTHER" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid document type"})
	}

	fh, err := c.FormFile("file")
	if err != nil || fh == nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "No file uploaded"})
	}

	reqCtx := c.Request().Context()
	if _, err := h.Queries.GetCoilByNumber(reqCtx, coilNumber); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Coil not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to upload document"})
	}

	saved, err := upload.SaveToCategory(h.UploadDir, "mtc", h.MaxFileSizeBytes, h.AllowedMimeTypes, fh)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	var uploadedBy pgtype.Text
	if user, ok := middleware.GetUser(c); ok {
		uploadedBy = textPtr(user.ID)
	}

	doc, err := h.Queries.CreateCoilDocument(reqCtx, db.CreateCoilDocumentParams{
		ID:           uuid.New().String(),
		CoilNumber:   coilNumber,
		DocumentType: db.CoilDocumentType(documentType),
		Filename:     saved.Filename,
		OriginalName: saved.OriginalName,
		Mimetype:     saved.Mimetype,
		Size:         saved.Size,
		StoragePath:  saved.StoragePath,
		UploadedByID: uploadedBy,
	})
	if err != nil {
		_ = os.Remove(saved.StoragePath)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to upload document"})
	}

	if user, ok := middleware.GetUser(c); ok {
		newValues, _ := json.Marshal(map[string]interface{}{
			"coilNumber":   coilNumber,
			"documentType": doc.DocumentType,
			"originalName": doc.OriginalName,
		})
		_, _ = h.Queries.CreateAuditLogWithValues(reqCtx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "CREATE",
			EntityType: textPtr("CoilDocument"),
			EntityID:   textPtr(doc.ID),
			NewValues:  newValues,
		})
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{"document": coilDocumentJSON(doc)})
}

func (h *CoilsHandler) DeleteDocument(c echo.Context) error {
	documentID := c.Param("documentId")
	reqCtx := c.Request().Context()

	doc, err := h.Queries.GetCoilDocumentByID(reqCtx, documentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Document not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete document"})
	}

	snapshot, _ := json.Marshal(map[string]interface{}{
		"coilNumber":   doc.CoilNumber,
		"documentType": doc.DocumentType,
		"originalName": doc.OriginalName,
		"mimetype":     doc.Mimetype,
		"size":         doc.Size,
	})

	if err := h.Queries.DeleteCoilDocument(reqCtx, documentID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete document"})
	}

	if _, err := os.Stat(doc.StoragePath); err == nil {
		_ = os.Remove(doc.StoragePath)
	}

	if user, ok := middleware.GetUser(c); ok {
		_, _ = h.Queries.CreateAuditLogWithValues(reqCtx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     user.ID,
			Action:     "DELETE",
			EntityType: textPtr("CoilDocument"),
			EntityID:   textPtr(documentID),
			OldValues:  snapshot,
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"message":    "Document removed",
		"documentId": documentID,
		"coilNumber": doc.CoilNumber,
	})
}

func (h *CoilsHandler) ServeDocument(c echo.Context) error {
	documentID := c.Param("documentId")
	reqCtx := c.Request().Context()

	doc, err := h.Queries.GetCoilDocumentByID(reqCtx, documentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Document not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load document"})
	}

	if _, err := os.Stat(doc.StoragePath); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Document not found"})
	}

	asDownload := c.QueryParam("download") == "true" || c.QueryParam("download") == "1"
	disposition := "inline"
	if asDownload {
		disposition = "attachment"
	}
	c.Response().Header().Set("Content-Type", doc.Mimetype)
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf(`%s; filename="%s"`, disposition, doc.OriginalName))
	return c.File(doc.StoragePath)
}

func (h *CoilsHandler) listDocumentSummaries(ctx echo.Context, coilNumbers []string) (map[string][]map[string]interface{}, error) {
	out := make(map[string][]map[string]interface{})
	if len(coilNumbers) == 0 {
		return out, nil
	}
	rows, err := h.Pool.Query(ctx.Request().Context(), `
		SELECT id, "coilNumber", "documentType", "originalName"
		FROM "CoilDocument"
		WHERE "coilNumber" = ANY($1)
	`, coilNumbers)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, coilNumber, originalName string
		var docType string
		if err := rows.Scan(&id, &coilNumber, &docType, &originalName); err != nil {
			return nil, err
		}
		out[coilNumber] = append(out[coilNumber], map[string]interface{}{
			"id":           id,
			"documentType": docType,
			"originalName": originalName,
		})
	}
	return out, rows.Err()
}

func (h *CoilsHandler) auditCoilCreate(c echo.Context, coil db.Coil) {
	user, ok := middleware.GetUser(c)
	if !ok {
		return
	}
	newValues, _ := json.Marshal(coilSnapshot(coil))
	_, _ = h.Queries.CreateAuditLogWithValues(c.Request().Context(), db.CreateAuditLogWithValuesParams{
		ID:         uuid.New().String(),
		UserID:     user.ID,
		Action:     "CREATE",
		EntityType: textPtr("Coil"),
		EntityID:   textPtr(coil.CoilNumber),
		NewValues:  newValues,
	})
}

func (h *CoilsHandler) auditCoilUpdate(c echo.Context, old, new db.Coil) {
	user, ok := middleware.GetUser(c)
	if !ok {
		return
	}
	oldSnap := coilSnapshot(old)
	newSnap := coilSnapshot(new)
	changedOld := map[string]interface{}{}
	changedNew := map[string]interface{}{}
	for k, nv := range newSnap {
		if ov, exists := oldSnap[k]; !exists || ov != nv {
			changedOld[k] = ov
			changedNew[k] = nv
		}
	}
	oldBytes, _ := json.Marshal(changedOld)
	newBytes, _ := json.Marshal(changedNew)
	_, _ = h.Queries.CreateAuditLogWithValues(c.Request().Context(), db.CreateAuditLogWithValuesParams{
		ID:         uuid.New().String(),
		UserID:     user.ID,
		Action:     "UPDATE",
		EntityType: textPtr("Coil"),
		EntityID:   textPtr(new.CoilNumber),
		OldValues:  oldBytes,
		NewValues:  newBytes,
	})
}

func (h *CoilsHandler) auditCoilDelete(c echo.Context, coil db.Coil) {
	user, ok := middleware.GetUser(c)
	if !ok {
		return
	}
	oldValues, _ := json.Marshal(coilSnapshot(coil))
	_, _ = h.Queries.CreateAuditLogWithValues(c.Request().Context(), db.CreateAuditLogWithValuesParams{
		ID:         uuid.New().String(),
		UserID:     user.ID,
		Action:     "DELETE",
		EntityType: textPtr("Coil"),
		EntityID:   textPtr(coil.CoilNumber),
		OldValues:  oldValues,
	})
}

func (h *CoilsHandler) auditCoilArchive(c echo.Context, coil db.Coil) {
	user, ok := middleware.GetUser(c)
	if !ok {
		return
	}
	newValues, _ := json.Marshal(map[string]interface{}{
		"status":     "ARCHIVED",
		"archivedAt": formatTimestamp(coil.ArchivedAt),
	})
	oldValues, _ := json.Marshal(map[string]string{"status": "ACTIVE"})
	_, _ = h.Queries.CreateAuditLogWithValues(c.Request().Context(), db.CreateAuditLogWithValuesParams{
		ID:         uuid.New().String(),
		UserID:     user.ID,
		Action:     "ARCHIVE",
		EntityType: textPtr("Coil"),
		EntityID:   textPtr(coil.CoilNumber),
		OldValues:  oldValues,
		NewValues:  newValues,
	})
}

func coilListRowJSON(row service.CoilListRow, docs []map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"coilNumber":                row.CoilNumber,
		"grade":                     row.Grade,
		"coating":                   row.Coating,
		"size":                      row.Size,
		"weight":                    row.Weight,
		"supplier":                  row.Supplier,
		"mtcNumber":                 textValue(row.MtcNumber),
		"invoiceNumber":             textValue(row.InvoiceNumber),
		"amnsDispatchDate":          tsValue(row.AmnsDispatchDate),
		"vehicleNumber":             textValue(row.VehicleNumber),
		"transporterName":           textValue(row.TransporterName),
		"receiptDateSlitter":        tsValue(row.ReceiptDateSlitter),
		"receivingConditionRemarks": textValue(row.ReceivingConditionRemarks),
		"status":                    string(row.Status),
		"archivedAt":                tsValue(row.ArchivedAt),
		"archivedById":              textValue(row.ArchivedById),
		"createdAt":                 formatTimestamp(row.CreatedAt),
		"updatedAt":                 formatTimestamp(row.UpdatedAt),
		"documents":                 docs,
		"_count": map[string]int64{
			"documents":       row.DocCount,
			"slittingRecords": row.SlitCount,
		},
	}
}

func coilDetailJSON(coil db.Coil, docs []db.CoilDocument, slits []db.SlittingRecord) map[string]interface{} {
	docJSON := make([]map[string]interface{}, 0, len(docs))
	for _, d := range docs {
		docJSON = append(docJSON, coilDocumentJSON(d))
	}
	slitJSON := make([]map[string]interface{}, 0, len(slits))
	for _, s := range slits {
		slitJSON = append(slitJSON, slittingRecordJSON(s))
	}
	base := coilBaseJSON(coil)
	base["documents"] = docJSON
	if slits != nil {
		base["slittingRecords"] = slitJSON
	}
	return base
}

func coilIncludeJSON(coil db.Coil, docs []db.CoilDocument, docCount, slitCount int64) map[string]interface{} {
	docJSON := make([]map[string]interface{}, 0, len(docs))
	for _, d := range docs {
		docJSON = append(docJSON, map[string]interface{}{
			"id":           d.ID,
			"documentType": d.DocumentType,
			"originalName": d.OriginalName,
		})
	}
	base := coilBaseJSON(coil)
	base["documents"] = docJSON
	base["_count"] = map[string]int64{
		"documents":       docCount,
		"slittingRecords": slitCount,
	}
	return base
}

func coilBaseJSON(coil db.Coil) map[string]interface{} {
	return map[string]interface{}{
		"coilNumber":                coil.CoilNumber,
		"grade":                     coil.Grade,
		"coating":                   coil.Coating,
		"size":                      coil.Size,
		"weight":                    service.NumericToString(coil.Weight),
		"supplier":                  coil.Supplier,
		"mtcNumber":                 textValue(coil.MtcNumber),
		"invoiceNumber":             textValue(coil.InvoiceNumber),
		"amnsDispatchDate":          tsValue(coil.AmnsDispatchDate),
		"vehicleNumber":             textValue(coil.VehicleNumber),
		"transporterName":           textValue(coil.TransporterName),
		"receiptDateSlitter":        tsValue(coil.ReceiptDateSlitter),
		"receivingConditionRemarks": textValue(coil.ReceivingConditionRemarks),
		"status":                    string(coil.Status),
		"archivedAt":                tsValue(coil.ArchivedAt),
		"archivedById":              textValue(coil.ArchivedById),
		"createdAt":                 formatTimestamp(coil.CreatedAt),
		"updatedAt":                 formatTimestamp(coil.UpdatedAt),
	}
}

func coilDocumentJSON(d db.CoilDocument) map[string]interface{} {
	return map[string]interface{}{
		"id":           d.ID,
		"coilNumber":   d.CoilNumber,
		"documentType": d.DocumentType,
		"filename":     d.Filename,
		"originalName": d.OriginalName,
		"mimetype":     d.Mimetype,
		"size":         d.Size,
		"storagePath":  d.StoragePath,
		"uploadedById": textValue(d.UploadedById),
		"createdAt":    formatTimestamp(d.CreatedAt),
	}
}

func slittingRecordJSON(s db.SlittingRecord) map[string]interface{} {
	return map[string]interface{}{
		"slitCoilId":       s.SlitCoilId,
		"parentCoilNumber": s.ParentCoilNumber,
		"slitWidthSize":    s.SlitWidthSize,
		"slittingDate":     formatTimestamp(s.SlittingDate),
		"slitCoilWeight":   service.NumericToString(s.SlitCoilWeight),
		"slitterLocation":  s.SlitterLocation,
		"dispatchNote":     textValue(s.DispatchNote),
		"vehicleNumber":    textValue(s.VehicleNumber),
		"transporterName":  textValue(s.TransporterName),
		"createdAt":        formatTimestamp(s.CreatedAt),
		"updatedAt":        formatTimestamp(s.UpdatedAt),
	}
}

func auditLogRowJSON(row db.ListCoilAuditLogsRow) map[string]interface{} {
	return map[string]interface{}{
		"id":         row.ID,
		"action":     row.Action,
		"entityType": textValue(row.EntityType),
		"entityId":   textValue(row.EntityId),
		"oldValues":  rawJSON(row.OldValues),
		"newValues":  rawJSON(row.NewValues),
		"createdAt":  formatTimestamp(row.CreatedAt),
		"user": map[string]interface{}{
			"fullName": row.FullName,
			"email":    row.Email,
			"role": map[string]string{
				"name": row.RoleName,
			},
		},
	}
}

func coilSnapshot(coil db.Coil) map[string]interface{} {
	snap := coilBaseJSON(coil)
	w, _ := strconv.ParseFloat(service.NumericToString(coil.Weight), 64)
	snap["weight"] = w
	return snap
}

func criticalFieldsChanged(existing db.Coil, raw map[string]json.RawMessage, req *coilBodyRequest) []string {
	var locked []string
	for _, field := range service.CriticalCoilFields {
		if _, ok := raw[field]; !ok {
			continue
		}
		switch field {
		case "grade":
			if req.Grade != existing.Grade {
				locked = append(locked, field)
			}
		case "coating":
			if req.Coating != existing.Coating {
				locked = append(locked, field)
			}
		case "size":
			if req.Size != existing.Size {
				locked = append(locked, field)
			}
		case "weight":
			existingW, _ := strconv.ParseFloat(service.NumericToString(existing.Weight), 64)
			if math.Abs(existingW-req.Weight) > 0.0001 {
				locked = append(locked, field)
			}
		case "mtcNumber":
			newMtc := textValue(optionalStringPtr(req.MtcNumber))
			oldMtc := textValue(existing.MtcNumber)
			if newMtc != oldMtc {
				locked = append(locked, field)
			}
		}
	}
	return locked
}

func validateCoilBody(req *coilBodyRequest, requireAll bool) map[string]interface{} {
	if requireAll {
		if strings.TrimSpace(req.CoilNumber) == "" || len(req.CoilNumber) > 50 {
			return map[string]interface{}{"fieldErrors": map[string][]string{"coilNumber": {"Invalid"}}}
		}
		if strings.TrimSpace(req.Grade) == "" {
			return map[string]interface{}{"fieldErrors": map[string][]string{"grade": {"Required"}}}
		}
		if strings.TrimSpace(req.Coating) == "" {
			return map[string]interface{}{"fieldErrors": map[string][]string{"coating": {"Required"}}}
		}
		if strings.TrimSpace(req.Size) == "" {
			return map[string]interface{}{"fieldErrors": map[string][]string{"size": {"Required"}}}
		}
		if req.Weight <= 0 {
			return map[string]interface{}{"fieldErrors": map[string][]string{"weight": {"Must be positive"}}}
		}
	}
	return nil
}

func validateCoilBodyPartial(raw map[string]json.RawMessage, req *coilBodyRequest) map[string]interface{} {
	if _, ok := raw["grade"]; ok && strings.TrimSpace(req.Grade) == "" {
		return map[string]interface{}{"fieldErrors": map[string][]string{"grade": {"Required"}}}
	}
	if _, ok := raw["coating"]; ok && strings.TrimSpace(req.Coating) == "" {
		return map[string]interface{}{"fieldErrors": map[string][]string{"coating": {"Required"}}}
	}
	if _, ok := raw["size"]; ok && strings.TrimSpace(req.Size) == "" {
		return map[string]interface{}{"fieldErrors": map[string][]string{"size": {"Required"}}}
	}
	if _, ok := raw["weight"]; ok && req.Weight <= 0 {
		return map[string]interface{}{"fieldErrors": map[string][]string{"weight": {"Must be positive"}}}
	}
	return nil
}

func parsePagination(c echo.Context) (limit int, hasLimit bool, offset int) {
	offset = 0
	if v := c.QueryParam("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			offset = n
		}
	}
	if v := c.QueryParam("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = int(math.Min(math.Max(float64(n), 1), 100))
			return limit, true, offset
		}
	}
	return 0, false, offset
}

func parseOptionalDate(s *string) pgtype.Timestamp {
	if s == nil || *s == "" {
		return pgtype.Timestamp{}
	}
	t, err := time.Parse(time.RFC3339, *s)
	if err != nil {
		t, err = time.Parse("2006-01-02", *s)
		if err != nil {
			return pgtype.Timestamp{}
		}
	}
	return pgtype.Timestamp{Time: t.UTC(), Valid: true}
}

func optionalStringPtr(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

func weightFromFloat(v float64) (pgtype.Numeric, error) {
	var n pgtype.Numeric
	if err := n.Scan(fmt.Sprintf("%g", v)); err != nil {
		return n, err
	}
	return n, nil
}

func textValue(t pgtype.Text) interface{} {
	if !t.Valid {
		return nil
	}
	return t.String
}

func tsValue(t pgtype.Timestamp) interface{} {
	if !t.Valid {
		return nil
	}
	return t.Time.UTC().Format(time.RFC3339Nano)
}

func rawJSON(b []byte) interface{} {
	if len(b) == 0 {
		return nil
	}
	var v interface{}
	if err := json.Unmarshal(b, &v); err != nil {
		return nil
	}
	return v
}

func mustMarshal(v interface{}) []byte {
	b, _ := json.Marshal(v)
	return b
}
