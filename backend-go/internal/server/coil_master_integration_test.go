package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/db"
)

const (
	coilLifeTest   = "COIL-LIFE-TEST-001"
	coilLifeLinked = "COIL-LIFE-LINKED-001"
	coilLifeSlit   = "COIL-LIFE-S01"
)

func setupCoilLifecycleData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, coilLifeSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "CoilDocument" WHERE "coilNumber" = ANY($1)`, []string{coilLifeTest, coilLifeLinked})
	_, _ = pool.Exec(ctx, `DELETE FROM "Coil" WHERE "coilNumber" = ANY($1)`, []string{coilLifeTest, coilLifeLinked})

	_, err := pool.Exec(ctx, `
		INSERT INTO "Coil" ("coilNumber", grade, coating, size, weight, supplier, status, "createdAt", "updatedAt")
		VALUES ($1, 'AMNS550S', 'ZM150', '1250 x 0.5 mm', 5, 'AMNS (Hazira Plant)', 'ACTIVE', NOW(), NOW())
	`, coilLifeTest)
	if err != nil {
		t.Fatalf("seed coil: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "Coil" ("coilNumber", grade, coating, size, weight, supplier, status, "createdAt", "updatedAt")
		VALUES ($1, 'AMNS550S', 'ZM150', '1250 x 0.5 mm', 4, 'AMNS (Hazira Plant)', 'ACTIVE', NOW(), NOW())
	`, coilLifeLinked)
	if err != nil {
		t.Fatalf("seed linked coil: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SlittingRecord" ("slitCoilId", "parentCoilNumber", "slitWidthSize", "slittingDate", "slitCoilWeight", "slitterLocation", "createdAt", "updatedAt")
		VALUES ($1, $2, '1040 x 0.5 mm', '2026-01-10', 3.5, 'Default', NOW(), NOW())
	`, coilLifeSlit, coilLifeLinked)
	if err != nil {
		t.Fatalf("seed slitting: %v", err)
	}
}

func teardownCoilLifecycleData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, coilLifeSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "CoilDocument" WHERE "coilNumber" = ANY($1)`, []string{coilLifeTest, coilLifeLinked})
	_, _ = pool.Exec(ctx, `DELETE FROM "Coil" WHERE "coilNumber" = ANY($1)`, []string{coilLifeTest, coilLifeLinked})
}

func coilHasNumber(coils []map[string]interface{}, number string) bool {
	for _, c := range coils {
		if c["coilNumber"] == number {
			return true
		}
	}
	return false
}

func TestCoilMasterLifecycle(t *testing.T) {
	srv, pool, cleanup := testServer(t)
	defer cleanup()

	setupCoilLifecycleData(t, pool)
	defer teardownCoilLifecycleData(t, pool)

	token := adminToken(t, srv)

	t.Run("lists active coils by default", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/coils", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Coils []map[string]interface{} `json:"coils"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if !coilHasNumber(body.Coils, coilLifeTest) {
			t.Fatal("expected test coil in list")
		}
	})

	t.Run("returns usage info", func(t *testing.T) {
		unusedReq := httptest.NewRequest(http.MethodGet, "/api/coils/"+coilLifeTest+"/usage", nil)
		unusedReq.Header.Set("Authorization", "Bearer "+token)
		unusedRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(unusedRec, unusedReq)
		if unusedRec.Code != http.StatusOK {
			t.Fatalf("unused usage: %d %s", unusedRec.Code, unusedRec.Body.String())
		}
		var unusedBody struct {
			Usage struct {
				CanDelete             bool  `json:"canDelete"`
				CanArchive            bool  `json:"canArchive"`
				CanEditCriticalFields bool  `json:"canEditCriticalFields"`
				SlittingRecords       int64 `json:"slittingRecords"`
			} `json:"usage"`
		}
		_ = json.Unmarshal(unusedRec.Body.Bytes(), &unusedBody)
		if !unusedBody.Usage.CanDelete || unusedBody.Usage.CanArchive || !unusedBody.Usage.CanEditCriticalFields {
			t.Fatalf("unexpected unused usage: %+v", unusedBody.Usage)
		}

		linkedReq := httptest.NewRequest(http.MethodGet, "/api/coils/"+coilLifeLinked+"/usage", nil)
		linkedReq.Header.Set("Authorization", "Bearer "+token)
		linkedRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(linkedRec, linkedReq)
		var linkedBody struct {
			Usage struct {
				CanDelete             bool  `json:"canDelete"`
				CanArchive            bool  `json:"canArchive"`
				CanEditCriticalFields bool  `json:"canEditCriticalFields"`
				SlittingRecords       int64 `json:"slittingRecords"`
			} `json:"usage"`
		}
		_ = json.Unmarshal(linkedRec.Body.Bytes(), &linkedBody)
		if linkedBody.Usage.CanDelete || !linkedBody.Usage.CanArchive || linkedBody.Usage.CanEditCriticalFields || linkedBody.Usage.SlittingRecords != 1 {
			t.Fatalf("unexpected linked usage: %+v", linkedBody.Usage)
		}
	})

	t.Run("edits business fields but blocks critical fields on linked coil", func(t *testing.T) {
		okBody := bytes.NewBufferString(`{"invoiceNumber":"INV-LIFE-001","transporterName":"Test Transporter"}`)
		okReq := httptest.NewRequest(http.MethodPut, "/api/coils/"+coilLifeLinked, okBody)
		okReq.Header.Set("Authorization", "Bearer "+token)
		okReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		okRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(okRec, okReq)
		if okRec.Code != http.StatusOK {
			t.Fatalf("update ok: %d %s", okRec.Code, okRec.Body.String())
		}
		var okRes struct {
			Coil struct {
				InvoiceNumber string `json:"invoiceNumber"`
			} `json:"coil"`
		}
		_ = json.Unmarshal(okRec.Body.Bytes(), &okRes)
		if okRes.Coil.InvoiceNumber != "INV-LIFE-001" {
			t.Fatalf("expected invoice update, got %q", okRes.Coil.InvoiceNumber)
		}

		blockedBody := bytes.NewBufferString(`{"grade":"CHANGED-GRADE"}`)
		blockedReq := httptest.NewRequest(http.MethodPut, "/api/coils/"+coilLifeLinked, blockedBody)
		blockedReq.Header.Set("Authorization", "Bearer "+token)
		blockedReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		blockedRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(blockedRec, blockedReq)
		if blockedRec.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d", blockedRec.Code)
		}
		var blockedRes struct {
			LockedFields []string `json:"lockedFields"`
		}
		_ = json.Unmarshal(blockedRec.Body.Bytes(), &blockedRes)
		found := false
		for _, f := range blockedRes.LockedFields {
			if f == "grade" {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected grade in lockedFields: %v", blockedRes.LockedFields)
		}
	})

	t.Run("deletes unused coil and archives linked coil", func(t *testing.T) {
		delFailReq := httptest.NewRequest(http.MethodDelete, "/api/coils/"+coilLifeLinked, nil)
		delFailReq.Header.Set("Authorization", "Bearer "+token)
		delFailRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(delFailRec, delFailReq)
		if delFailRec.Code != http.StatusConflict {
			t.Fatalf("delete linked expected 409, got %d", delFailRec.Code)
		}

		archiveReq := httptest.NewRequest(http.MethodPatch, "/api/coils/"+coilLifeLinked+"/archive", nil)
		archiveReq.Header.Set("Authorization", "Bearer "+token)
		archiveRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(archiveRec, archiveReq)
		if archiveRec.Code != http.StatusOK {
			t.Fatalf("archive: %d %s", archiveRec.Code, archiveRec.Body.String())
		}
		var archiveRes struct {
			Coil struct {
				Status string `json:"status"`
			} `json:"coil"`
		}
		_ = json.Unmarshal(archiveRec.Body.Bytes(), &archiveRes)
		if archiveRes.Coil.Status != "ARCHIVED" {
			t.Fatalf("expected ARCHIVED, got %s", archiveRes.Coil.Status)
		}

		hiddenReq := httptest.NewRequest(http.MethodGet, "/api/coils", nil)
		hiddenReq.Header.Set("Authorization", "Bearer "+token)
		hiddenRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(hiddenRec, hiddenReq)
		var hiddenBody struct {
			Coils []map[string]interface{} `json:"coils"`
		}
		_ = json.Unmarshal(hiddenRec.Body.Bytes(), &hiddenBody)
		if coilHasNumber(hiddenBody.Coils, coilLifeLinked) {
			t.Fatal("archived coil should be hidden from default list")
		}

		visibleReq := httptest.NewRequest(http.MethodGet, "/api/coils?includeArchived=true", nil)
		visibleReq.Header.Set("Authorization", "Bearer "+token)
		visibleRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(visibleRec, visibleReq)
		var visibleBody struct {
			Coils []map[string]interface{} `json:"coils"`
		}
		_ = json.Unmarshal(visibleRec.Body.Bytes(), &visibleBody)
		if !coilHasNumber(visibleBody.Coils, coilLifeLinked) {
			t.Fatal("archived coil should appear when includeArchived=true")
		}

		getArchivedReq := httptest.NewRequest(http.MethodGet, "/api/coils/"+coilLifeLinked, nil)
		getArchivedReq.Header.Set("Authorization", "Bearer "+token)
		getArchivedRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(getArchivedRec, getArchivedReq)
		if getArchivedRec.Code != http.StatusOK {
			t.Fatalf("get archived: %d", getArchivedRec.Code)
		}
		var getArchivedRes struct {
			Coil struct {
				Status string `json:"status"`
			} `json:"coil"`
		}
		_ = json.Unmarshal(getArchivedRec.Body.Bytes(), &getArchivedRes)
		if getArchivedRes.Coil.Status != "ARCHIVED" {
			t.Fatalf("expected ARCHIVED on get")
		}

		delOkReq := httptest.NewRequest(http.MethodDelete, "/api/coils/"+coilLifeTest, nil)
		delOkReq.Header.Set("Authorization", "Bearer "+token)
		delOkRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(delOkRec, delOkReq)
		if delOkRec.Code != http.StatusOK {
			t.Fatalf("delete unused: %d %s", delOkRec.Code, delOkRec.Body.String())
		}

		queries := db.New(pool)
		logs, err := queries.ListCoilAuditLogs(context.Background(), db.ListCoilAuditLogsParams{
			CoilNumber:  pgtypeText(coilLifeLinked),
			DocumentIds: []string{},
			RowLimit:    25,
		})
		if err != nil {
			t.Fatal(err)
		}
		hasArchive := false
		for _, log := range logs {
			if log.Action == "ARCHIVE" {
				hasArchive = true
			}
		}
		if !hasArchive {
			t.Fatal("expected ARCHIVE audit log for linked coil")
		}

		delLogs, _ := pool.Query(context.Background(), `
			SELECT action FROM "AuditLog"
			WHERE "entityType" = 'Coil' AND "entityId" = $1 AND action = 'DELETE'
		`, coilLifeTest)
		defer delLogs.Close()
		if !delLogs.Next() {
			t.Fatal("expected DELETE audit log for unused coil")
		}
	})

	t.Run("deletes attached coil document with audit log", func(t *testing.T) {
		docID := uuid.New().String()
		_, err := pool.Exec(context.Background(), `
			INSERT INTO "CoilDocument" (id, "coilNumber", "documentType", filename, "originalName", mimetype, size, "storagePath", "createdAt")
			VALUES ($1, $2, 'MTC', 'test-mtc.pdf', 'test-mtc.pdf', 'application/pdf', 1024, '/tmp/nonexistent-coil-doc-test.pdf', NOW())
		`, docID, coilLifeLinked)
		if err != nil {
			t.Fatal(err)
		}

		req := httptest.NewRequest(http.MethodDelete, "/api/coils/documents/"+docID, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("delete doc: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			CoilNumber string `json:"coilNumber"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if res.CoilNumber != coilLifeLinked {
			t.Fatalf("expected coilNumber %s", coilLifeLinked)
		}

		var count int
		_ = pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM "CoilDocument" WHERE id = $1`, docID).Scan(&count)
		if count != 0 {
			t.Fatal("document should be deleted")
		}

		var auditCount int
		_ = pool.QueryRow(context.Background(), `
			SELECT COUNT(*) FROM "AuditLog"
			WHERE "entityType" = 'CoilDocument' AND "entityId" = $1 AND action = 'DELETE'
		`, docID).Scan(&auditCount)
		if auditCount == 0 {
			t.Fatal("expected document DELETE audit log")
		}
	})

	t.Run("returns aggregate stats", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/coils/stats?includeArchived=true", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("stats: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Stats map[string]int64 `json:"stats"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		for _, key := range []string{"total", "active", "archived", "inTrace", "withDocs"} {
			if _, ok := body.Stats[key]; !ok {
				t.Fatalf("missing stats key %s", key)
			}
		}
	})

	t.Run("paginates coil list", func(t *testing.T) {
		pagedReq := httptest.NewRequest(http.MethodGet, "/api/coils?limit=1&offset=0&sortBy=coilNumber&sortOrder=asc", nil)
		pagedReq.Header.Set("Authorization", "Bearer "+token)
		pagedRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(pagedRec, pagedReq)
		if pagedRec.Code != http.StatusOK {
			t.Fatalf("paged: %d", pagedRec.Code)
		}
		var paged struct {
			Coils  []map[string]interface{} `json:"coils"`
			Total  int64                    `json:"total"`
			Limit  int                      `json:"limit"`
			Offset int                      `json:"offset"`
		}
		_ = json.Unmarshal(pagedRec.Body.Bytes(), &paged)
		if len(paged.Coils) != 1 || paged.Limit != 1 {
			t.Fatalf("unexpected paged response: %+v", paged)
		}

		fullReq := httptest.NewRequest(http.MethodGet, "/api/coils", nil)
		fullReq.Header.Set("Authorization", "Bearer "+token)
		fullRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(fullRec, fullReq)
		var full struct {
			Total int64 `json:"total"`
			Limit *int  `json:"limit"`
		}
		_ = json.Unmarshal(fullRec.Body.Bytes(), &full)
		if full.Limit != nil {
			t.Fatal("full list should not include limit")
		}
		if full.Total < paged.Total {
			t.Fatalf("full total %d < paged total %d", full.Total, paged.Total)
		}
	})

	t.Run("filters by quickFilter missingMtc", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/coils?quickFilter=missingMtc&includeArchived=true", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("quickFilter: %d", rec.Code)
		}
		var body struct {
			Coils []map[string]interface{} `json:"coils"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Coils == nil {
			t.Fatal("expected coils array")
		}
	})

	t.Run("returns audit logs for a coil", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/coils/%s/audit-logs", coilLifeLinked), nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("audit logs: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Logs []map[string]interface{} `json:"logs"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Logs == nil {
			t.Fatal("expected logs array")
		}
	})
}

func pgtypeText(s string) pgtype.Text {
	return pgtype.Text{String: s, Valid: true}
}
