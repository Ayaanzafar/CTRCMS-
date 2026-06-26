package handler

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/db"
	"github.com/sunrack/ctrcms-go/internal/service"
)

type DocumentsHandler struct {
	Queries *db.Queries
}

func (h *DocumentsHandler) Stats(c echo.Context) error {
	stats, err := service.GetDocumentStats(c.Request().Context(), h.Queries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load document stats"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"stats": stats})
}

func (h *DocumentsHandler) List(c echo.Context) error {
	search := strings.TrimSpace(c.QueryParam("search"))
	if search == "" {
		search = strings.TrimSpace(c.QueryParam("q"))
	}
	category := strings.TrimSpace(c.QueryParam("category"))
	kind := strings.TrimSpace(c.QueryParam("kind"))

	if category != "" && category != "ALL" && !service.IsValidDocumentCategory(category) {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("Invalid category. Allowed: mtc, invoices, inspection-photos, qc-reports, installation-photos, complaint-photos"),
		})
	}

	limit := int32(50)
	offset := int32(0)
	if v := c.QueryParam("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = int32(n)
		}
	}
	if v := c.QueryParam("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			offset = int32(n)
		}
	}

	result, err := service.ListDocuments(c.Request().Context(), h.Queries, service.ListDocumentsParams{
		Search:   search,
		Category: category,
		Kind:     kind,
		Limit:    limit,
		Offset:   offset,
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list documents"})
	}
	return c.JSON(http.StatusOK, result)
}

func (h *DocumentsHandler) ByReference(c echo.Context) error {
	q := strings.TrimSpace(c.QueryParam("q"))
	if q == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Query parameter q is required"})
	}

	documents, total, err := service.ListDocumentsForReference(c.Request().Context(), h.Queries, q)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load documents for reference"})
	}
	if documents == nil {
		documents = []service.DocumentItem{}
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"query":     q,
		"documents": documents,
		"total":     total,
	})
}
