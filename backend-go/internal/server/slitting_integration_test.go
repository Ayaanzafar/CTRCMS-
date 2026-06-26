package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

const (
	slitTestParent = "SLIT-TEST-PARENT-001"
	slitTestLinked = "SLIT-TEST-LINKED-001"
	slitTestSlit   = "SLIT-TEST-S01"
	slitTestNew    = "SLIT-TEST-NEW-001"
)

func setupSlittingTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = ANY($1)`, []string{slitTestSlit, slitTestNew})
	_, _ = pool.Exec(ctx, `DELETE FROM "Coil" WHERE "coilNumber" = ANY($1)`, []string{slitTestParent, slitTestLinked})

	_, err := pool.Exec(ctx, `
		INSERT INTO "Coil" ("coilNumber", grade, coating, size, weight, supplier, status, "createdAt", "updatedAt")
		VALUES ($1, 'AMNS550S', 'ZM150', '1250 x 0.5 mm', 5, 'AMNS (Hazira Plant)', 'ACTIVE', NOW(), NOW())
	`, slitTestParent)
	if err != nil {
		t.Fatalf("seed parent coil: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "Coil" ("coilNumber", grade, coating, size, weight, supplier, status, "archivedAt", "createdAt", "updatedAt")
		VALUES ($1, 'AMNS550S', 'ZM150', '1250 x 0.5 mm', 4, 'AMNS (Hazira Plant)', 'ARCHIVED', NOW(), NOW(), NOW())
	`, slitTestLinked)
	if err != nil {
		t.Fatalf("seed archived coil: %v", err)
	}
}

func teardownSlittingTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "parentCoilNumber" = ANY($1) OR "slitCoilId" = ANY($2)`,
		[]string{slitTestParent, slitTestLinked}, []string{slitTestSlit, slitTestNew})
	_, _ = pool.Exec(ctx, `DELETE FROM "Coil" WHERE "coilNumber" = ANY($1)`, []string{slitTestParent, slitTestLinked})
}

func TestSlittingAPI(t *testing.T) {
	srv, pool, cleanup := testServer(t)
	defer cleanup()

	setupSlittingTestData(t, pool)
	defer teardownSlittingTestData(t, pool)

	token := adminToken(t, srv)

	t.Run("previews slit coil IDs", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/slitting/preview-ids?parentCoilNumber="+slitTestParent+"&count=2", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("preview: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			SlitCoilIds []string `json:"slitCoilIds"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if len(body.SlitCoilIds) != 2 {
			t.Fatalf("expected 2 ids, got %v", body.SlitCoilIds)
		}
		if !strings.HasPrefix(body.SlitCoilIds[0], slitTestParent+"-SC") {
			t.Fatalf("unexpected id format: %s", body.SlitCoilIds[0])
		}
	})

	t.Run("creates slitting batch", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"parentCoilNumber":%q,
			"slittingDate":"2026-02-01",
			"slitCoils":[{"slitWidthSize":"1040 x 0.5 mm","slitCoilWeight":3.5,"slitCoilId":%q}]
		}`, slitTestParent, slitTestSlit))
		req := httptest.NewRequest(http.MethodPost, "/api/slitting/batch", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create batch: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Records []struct {
				SlitCoilId       string `json:"slitCoilId"`
				ParentCoilNumber string `json:"parentCoilNumber"`
				ParentCoil       struct {
					Grade string `json:"grade"`
				} `json:"parentCoil"`
			} `json:"records"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if len(res.Records) != 1 || res.Records[0].SlitCoilId != slitTestSlit {
			t.Fatalf("unexpected records: %+v", res.Records)
		}
		if res.Records[0].ParentCoil.Grade != "AMNS550S" {
			t.Fatal("expected parent coil in response")
		}
	})

	t.Run("lists and gets slitting records", func(t *testing.T) {
		listReq := httptest.NewRequest(http.MethodGet, "/api/slitting?parentCoil="+slitTestParent, nil)
		listReq.Header.Set("Authorization", "Bearer "+token)
		listRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(listRec, listReq)
		if listRec.Code != http.StatusOK {
			t.Fatalf("list: %d %s", listRec.Code, listRec.Body.String())
		}
		var listBody struct {
			Records []map[string]interface{} `json:"records"`
		}
		_ = json.Unmarshal(listRec.Body.Bytes(), &listBody)
		if len(listBody.Records) == 0 {
			t.Fatal("expected records")
		}

		getReq := httptest.NewRequest(http.MethodGet, "/api/slitting/"+slitTestSlit, nil)
		getReq.Header.Set("Authorization", "Bearer "+token)
		getRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(getRec, getReq)
		if getRec.Code != http.StatusOK {
			t.Fatalf("get: %d %s", getRec.Code, getRec.Body.String())
		}
		var getBody struct {
			Record struct {
				SlitCoilId         string                   `json:"slitCoilId"`
				BatchConsumptions  []map[string]interface{} `json:"batchConsumptions"`
				SunrackReceipt     interface{}              `json:"sunrackReceipt"`
			} `json:"record"`
		}
		_ = json.Unmarshal(getRec.Body.Bytes(), &getBody)
		if getBody.Record.SlitCoilId != slitTestSlit {
			t.Fatalf("unexpected record: %+v", getBody.Record)
		}
		if getBody.Record.BatchConsumptions == nil {
			t.Fatal("expected batchConsumptions array")
		}
	})

	t.Run("updates slitting record", func(t *testing.T) {
		body := bytes.NewBufferString(`{"dispatchNote":"DN-SLIT-001"}`)
		req := httptest.NewRequest(http.MethodPut, "/api/slitting/"+slitTestSlit, body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Record struct {
				DispatchNote *string `json:"dispatchNote"`
			} `json:"record"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if res.Record.DispatchNote == nil || *res.Record.DispatchNote != "DN-SLIT-001" {
			t.Fatalf("expected dispatch note update, got %+v", res.Record.DispatchNote)
		}
	})

	t.Run("rejects slitting against archived parent coil", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"parentCoilNumber":%q,
			"slittingDate":"2026-02-01",
			"slitCoils":[{"slitWidthSize":"1040 x 0.5 mm","slitCoilWeight":1}]
		}`, slitTestLinked))
		req := httptest.NewRequest(http.MethodPost, "/api/slitting/batch", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(strings.ToLower(rec.Body.String()), "archived") {
			t.Fatalf("expected archived error, got %s", rec.Body.String())
		}
	})

	t.Run("rejects duplicate slit coil ID", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"parentCoilNumber":%q,
			"slittingDate":"2026-02-02",
			"slitCoils":[{"slitWidthSize":"1040 x 0.5 mm","slitCoilWeight":1,"slitCoilId":%q}]
		}`, slitTestParent, slitTestSlit))
		req := httptest.NewRequest(http.MethodPost, "/api/slitting/batch", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d", rec.Code)
		}
	})
}
