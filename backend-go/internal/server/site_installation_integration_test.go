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
	siteDispatchNote = "DN-SITE-TEST-001"
	siteBatchPass    = "BATCH-SITE-TEST-PASS"
	siteTestParent   = "SITE-TEST-PARENT-001"
	siteTestSlit     = "SITE-TEST-SLIT-001"
)

func setupSiteInstallationTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	cleanupSiteInstallationTestData(t, pool)

	_, err := pool.Exec(ctx, `
		INSERT INTO "Coil" ("coilNumber", grade, coating, size, weight, supplier, status, "createdAt", "updatedAt")
		VALUES ($1, 'AMNS550S', 'ZM150', '1250 x 0.5 mm', 5, 'AMNS (Hazira Plant)', 'ACTIVE', NOW(), NOW())
	`, siteTestParent)
	if err != nil {
		t.Fatalf("seed parent: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SlittingRecord" ("slitCoilId", "parentCoilNumber", "slitWidthSize", "slittingDate", "slitCoilWeight", "slitterLocation", "dispatchNote", "createdAt", "updatedAt")
		VALUES ($1, $2, '1040 x 0.5 mm', '2026-01-15', 4.0, 'Shiv Sagar Slitter', 'DN-SITE-SEED', NOW(), NOW())
	`, siteTestSlit, siteTestParent)
	if err != nil {
		t.Fatalf("seed slit: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SunrackReceipt" (id, "slitCoilId", "receiptDateSunrack", "storageLocationBin", "inspectionResult", "createdAt", "updatedAt")
		VALUES ($1, $2, '2026-02-01', 'WH-B', 'PASS', NOW(), NOW())
	`, "receipt-"+siteTestSlit, siteTestSlit)
	if err != nil {
		t.Fatalf("seed receipt: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "ProductionBatch" ("batchNumber", "productionOrderNumber", "productType", "quantityProduced", "productionDate", "operatorShift", "createdAt", "updatedAt")
		VALUES ($1, 'PO-SITE-TEST', 'Walkway Tray', 100, '2026-02-20', 'Shift A', NOW(), NOW())
	`, siteBatchPass)
	if err != nil {
		t.Fatalf("seed batch: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "BatchSlitCoilMap" (id, "batchNumber", "slitCoilId", "quantityConsumed", "createdAt")
		VALUES ($1, $2, $3, 0.01, NOW())
	`, "site-map-"+siteBatchPass, siteBatchPass, siteTestSlit)
	if err != nil {
		t.Fatalf("seed consumption: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "QCInspection" (id, "batchNumber", "qcResult", "inspectorName", "inspectionDate", "createdAt", "updatedAt")
		VALUES ($1, $2, 'PASS', 'QC Inspector', '2026-02-21', NOW(), NOW())
	`, "site-qc-"+siteBatchPass, siteBatchPass)
	if err != nil {
		t.Fatalf("seed qc: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SiteDispatch" ("dispatchNoteNumber", "dispatchDate", "projectName", "clientName", "siteLocation", "createdAt", "updatedAt")
		VALUES ($1, '2026-03-01', 'Site Test Project', 'Test EPC', 'Pune', NOW(), NOW())
	`, siteDispatchNote)
	if err != nil {
		t.Fatalf("seed dispatch: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "DispatchBatchLine" (id, "dispatchNoteNumber", "batchNumber", "quantityDispatched", "createdAt")
		VALUES ($1, $2, $3, 75, NOW())
	`, "site-dbl-"+siteDispatchNote, siteDispatchNote, siteBatchPass)
	if err != nil {
		t.Fatalf("seed dispatch line: %v", err)
	}
}

func cleanupSiteInstallationTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	_, _ = pool.Exec(ctx, `
		DELETE FROM "SiteInstallationPhoto"
		WHERE "installationId" IN (SELECT id FROM "SiteInstallation" WHERE "dispatchNoteNumber" = $1)
	`, siteDispatchNote)
	_, _ = pool.Exec(ctx, `DELETE FROM "SiteInstallation" WHERE "dispatchNoteNumber" = $1`, siteDispatchNote)
	_, _ = pool.Exec(ctx, `DELETE FROM "DispatchBatchLine" WHERE "dispatchNoteNumber" = $1`, siteDispatchNote)
	_, _ = pool.Exec(ctx, `DELETE FROM "SiteDispatch" WHERE "dispatchNoteNumber" = $1`, siteDispatchNote)
	_, _ = pool.Exec(ctx, `DELETE FROM "QCInspection" WHERE "batchNumber" = $1`, siteBatchPass)
	_, _ = pool.Exec(ctx, `DELETE FROM "BatchSlitCoilMap" WHERE "batchNumber" = $1 OR "slitCoilId" = $2`, siteBatchPass, siteTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "ProductionBatch" WHERE "batchNumber" = $1`, siteBatchPass)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceiptPhoto" WHERE "receiptId" IN (SELECT id FROM "SunrackReceipt" WHERE "slitCoilId" = $1)`, siteTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceipt" WHERE "slitCoilId" = $1`, siteTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, siteTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "Coil" WHERE "coilNumber" = $1`, siteTestParent)
}

func TestSiteInstallationAPI(t *testing.T) {
	srv, pool, cleanup := testServer(t)
	defer cleanup()

	setupSiteInstallationTestData(t, pool)
	defer cleanupSiteInstallationTestData(t, pool)

	token := adminToken(t, srv)
	var installationID string

	t.Run("returns site installation stats", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/site-installation/stats", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("stats: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Stats map[string]interface{} `json:"stats"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if _, ok := body.Stats["pendingDispatches"]; !ok {
			t.Fatalf("missing pendingDispatches: %+v", body.Stats)
		}
		if _, ok := body.Stats["totalInstallations"]; !ok {
			t.Fatalf("missing totalInstallations: %+v", body.Stats)
		}
	})

	t.Run("lists pending dispatches including test dispatch", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/site-installation/pending-dispatches", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("pending: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Pending []struct {
				DispatchNoteNumber string `json:"dispatchNoteNumber"`
			} `json:"pending"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		found := false
		for _, p := range body.Pending {
			if p.DispatchNoteNumber == siteDispatchNote {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected %s in pending list", siteDispatchNote)
		}
	})

	t.Run("rejects over-quantity installation", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"dispatchNoteNumber":%q,
			"siteReceiptDate":"2026-03-02",
			"installationDate":"2026-03-05",
			"installerEpcPartner":"Suntrop Solar",
			"quantityInstalled":100
		}`, siteDispatchNote))
		req := httptest.NewRequest(http.MethodPost, "/api/site-installation", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(strings.ToLower(rec.Body.String()), "cannot exceed") {
			t.Fatalf("expected cannot exceed error, got %s", rec.Body.String())
		}
	})

	t.Run("creates site installation for dispatch note", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"dispatchNoteNumber":%q,
			"siteReceiptDate":"2026-03-02",
			"installationDate":"2026-03-05",
			"installerEpcPartner":"Suntrop Solar",
			"quantityInstalled":75
		}`, siteDispatchNote))
		req := httptest.NewRequest(http.MethodPost, "/api/site-installation", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Installation struct {
				ID                  string  `json:"id"`
				InstallerEpcPartner string  `json:"installerEpcPartner"`
				QuantityInstalled   float64 `json:"quantityInstalled"`
			} `json:"installation"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if res.Installation.InstallerEpcPartner != "Suntrop Solar" || res.Installation.QuantityInstalled != 75 {
			t.Fatalf("unexpected installation: %+v", res.Installation)
		}
		installationID = res.Installation.ID
	})

	t.Run("rejects duplicate installation for same dispatch", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"dispatchNoteNumber":%q,
			"siteReceiptDate":"2026-03-03",
			"installationDate":"2026-03-06",
			"installerEpcPartner":"Other EPC",
			"quantityInstalled":50
		}`, siteDispatchNote))
		req := httptest.NewRequest(http.MethodPost, "/api/site-installation", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(strings.ToLower(rec.Body.String()), "already has") {
			t.Fatalf("expected already has error, got %s", rec.Body.String())
		}
	})

	t.Run("uploads installation photo", func(t *testing.T) {
		if installationID == "" {
			t.Fatal("missing installation id")
		}
		body, contentType := multipartPhotoBody(t, "photos", "site-install.png", minPNG)
		req := httptest.NewRequest(http.MethodPost, "/api/site-installation/"+installationID+"/photos", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, contentType)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Photos []interface{} `json:"photos"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if len(res.Photos) < 1 {
			t.Fatal("expected at least one photo")
		}
	})

	t.Run("dispatch detail shows linked installation", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/dispatch/"+siteDispatchNote, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("dispatch get: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Dispatch struct {
				SiteInstallation *struct {
					InstallerEpcPartner string `json:"installerEpcPartner"`
					PhotoCount          int64  `json:"photoCount"`
				} `json:"siteInstallation"`
			} `json:"dispatch"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Dispatch.SiteInstallation == nil {
			t.Fatal("expected linked site installation on dispatch")
		}
		if body.Dispatch.SiteInstallation.InstallerEpcPartner != "Suntrop Solar" {
			t.Fatalf("unexpected installer: %s", body.Dispatch.SiteInstallation.InstallerEpcPartner)
		}
		if body.Dispatch.SiteInstallation.PhotoCount < 1 {
			t.Fatalf("expected photo count >= 1, got %d", body.Dispatch.SiteInstallation.PhotoCount)
		}
	})

	t.Run("lists installations in history", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/site-installation?search=Suntrop", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Installations []interface{} `json:"installations"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if len(body.Installations) < 1 {
			t.Fatal("expected at least one installation in history")
		}
	})

	t.Run("gets installation by dispatch note", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/site-installation/by-dispatch/"+siteDispatchNote, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("by-dispatch: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Installation struct {
				DispatchNoteNumber string `json:"dispatchNoteNumber"`
			} `json:"installation"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Installation.DispatchNoteNumber != siteDispatchNote {
			t.Fatalf("unexpected dispatch note: %s", body.Installation.DispatchNoteNumber)
		}
	})

	t.Run("denies unauthenticated access", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/site-installation/stats", nil)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rec.Code)
		}
	})
}
