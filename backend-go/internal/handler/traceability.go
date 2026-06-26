package handler

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/db"
	"github.com/sunrack/ctrcms-go/internal/service"
)

type TraceabilityHandler struct {
	Queries *db.Queries
}

func (h *TraceabilityHandler) Search(c echo.Context) error {
	q := strings.TrimSpace(c.QueryParam("q"))
	if q == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Query parameter q is required"})
	}

	hits, err := service.SearchTraceabilityReferences(c.Request().Context(), h.Queries, q, 10)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to search traceability references"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"hits": hits})
}

func (h *TraceabilityHandler) Timeline(c echo.Context) error {
	q := strings.TrimSpace(c.QueryParam("q"))
	if q == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Query parameter q is required"})
	}

	timeline, err := service.BuildTimeline(c.Request().Context(), h.Queries, q)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to build traceability timeline"})
	}
	if timeline == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "No traceability record found for this search"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"timeline": timeline})
}

func (h *TraceabilityHandler) ExportPDF(c echo.Context) error {
	q := strings.TrimSpace(c.QueryParam("q"))
	if q == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Query parameter q is required"})
	}

	timeline, err := service.BuildTimeline(c.Request().Context(), h.Queries, q)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to export traceability report"})
	}
	if timeline == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "No traceability record found for this search"})
	}

	pdf, err := service.RenderTraceabilityPDF(*timeline)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to export traceability report"})
	}

	safeName := service.SafeTraceabilityFilename(timeline.ReferenceID)
	c.Response().Header().Set("Content-Type", "application/pdf")
	c.Response().Header().Set("Content-Disposition", `attachment; filename="traceability-`+safeName+`.pdf"`)
	return c.Blob(http.StatusOK, "application/pdf", pdf)
}
