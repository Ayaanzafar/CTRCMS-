package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	docHubCoil      = "DOC-HUB-COIL-001"
	docHubSlit      = "DOC-HUB-COIL-001-S01"
	docHubBatch     = "BATCH-DOC-HUB"
	docHubComplaint = "COMP-DOC-HUB-001"
	docHubDispatch  = "DN-DOC-HUB-001"
	docHubReceiptID = "receipt-doc-hub"
	docHubQCID      = "qc-doc-hub"
	docHubInstallID = "install-doc-hub"
)

func setupDocumentsHubTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	cleanupDocumentsHubTestData(t, pool)

	_, err := pool.Exec(ctx, `
		INSERT INTO "Coil" ("coilNumber", grade, coating, size, weight, "mtcNumber", supplier, status, "createdAt", "updatedAt")
		VALUES ($1, 'AMNS550S', 'ZM150', '1250 x 0.5 mm', 5, 'MTC-DOC-HUB', 'AMNS (Hazira Plant)', 'ACTIVE', NOW(), NOW())
	`, docHubCoil)
	if err != nil {
		t.Fatalf("seed coil: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "CoilDocument" (id, "coilNumber", "documentType", filename, "originalName", mimetype, size, "storagePath", "createdAt")
		VALUES ($1, $2, 'MTC', 'test-mtc.pdf', 'doc-hub-mtc.pdf', 'application/pdf', 1024, 'uploads/mtc/test-mtc.pdf', NOW())
	`, "doc-hub-mtc", docHubCoil)
	if err != nil {
		t.Fatalf("seed coil doc: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SlittingRecord" ("slitCoilId", "parentCoilNumber", "slitWidthSize", "slittingDate", "slitCoilWeight", "createdAt", "updatedAt")
		VALUES ($1, $2, '1040 x 0.5 mm', '2026-01-10', 4, NOW(), NOW())
	`, docHubSlit, docHubCoil)
	if err != nil {
		t.Fatalf("seed slit: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SunrackReceipt" (id, "slitCoilId", "receiptDateSunrack", "storageLocationBin", "inspectionResult", "createdAt", "updatedAt")
		VALUES ($1, $2, '2026-01-15', 'WH-DOC', 'PASS', NOW(), NOW())
	`, docHubReceiptID, docHubSlit)
	if err != nil {
		t.Fatalf("seed receipt: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SunrackReceiptPhoto" (id, "receiptId", filename, "originalName", mimetype, size, "storagePath", "createdAt")
		VALUES ($1, $2, 'inspect.png', 'doc-hub-inspect.png', 'image/png', 512, 'uploads/inspection-photos/inspect.png', NOW())
	`, "doc-hub-receipt-photo", docHubReceiptID)
	if err != nil {
		t.Fatalf("seed receipt photo: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "ProductionBatch" ("batchNumber", "productionOrderNumber", "productType", "quantityProduced", "productionDate", "operatorShift", "createdAt", "updatedAt")
		VALUES ($1, 'PO-DOC-HUB', 'Walkway Tray', 50, '2026-01-20', 'Shift A', NOW(), NOW())
	`, docHubBatch)
	if err != nil {
		t.Fatalf("seed batch: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "BatchSlitCoilMap" (id, "batchNumber", "slitCoilId", "quantityConsumed", "createdAt")
		VALUES ($1, $2, $3, 0.5, NOW())
	`, "doc-hub-map", docHubBatch, docHubSlit)
	if err != nil {
		t.Fatalf("seed consumption: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "QCInspection" (id, "batchNumber", "qcResult", "inspectorName", "inspectionDate", "createdAt", "updatedAt")
		VALUES ($1, $2, 'PASS', 'Doc Hub QC', '2026-01-21', NOW(), NOW())
	`, docHubQCID, docHubBatch)
	if err != nil {
		t.Fatalf("seed qc: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "QCInspectionPhoto" (id, "inspectionId", filename, "originalName", mimetype, size, "storagePath", "createdAt")
		VALUES ($1, $2, 'qc.png', 'doc-hub-qc.png', 'image/png', 512, 'uploads/qc-reports/qc.png', NOW())
	`, "doc-hub-qc-photo", docHubQCID)
	if err != nil {
		t.Fatalf("seed qc photo: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SiteDispatch" ("dispatchNoteNumber", "dispatchDate", "projectName", "clientName", "siteLocation", "createdAt", "updatedAt")
		VALUES ($1, '2026-02-01', 'Doc Hub Project', 'Doc Client', 'Pune', NOW(), NOW())
	`, docHubDispatch)
	if err != nil {
		t.Fatalf("seed dispatch: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "DispatchBatchLine" (id, "dispatchNoteNumber", "batchNumber", "quantityDispatched", "createdAt")
		VALUES ($1, $2, $3, 10, NOW())
	`, "doc-hub-dbl", docHubDispatch, docHubBatch)
	if err != nil {
		t.Fatalf("seed dispatch line: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SiteInstallation" (id, "dispatchNoteNumber", "siteReceiptDate", "installationDate", "installerEpcPartner", "quantityInstalled", "createdAt", "updatedAt")
		VALUES ($1, $2, '2026-02-02', '2026-02-03', 'Doc EPC', 10, NOW(), NOW())
	`, docHubInstallID, docHubDispatch)
	if err != nil {
		t.Fatalf("seed installation: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SiteInstallationPhoto" (id, "installationId", filename, "originalName", mimetype, size, "storagePath", "createdAt")
		VALUES ($1, $2, 'site.png', 'doc-hub-site.png', 'image/png', 512, 'uploads/installation-photos/site.png', NOW())
	`, "doc-hub-site-photo", docHubInstallID)
	if err != nil {
		t.Fatalf("seed site photo: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "Complaint" ("complaintId", "complaintDate", "projectName", "clientName", "siteLocation",
			"complaintDescription", "resolutionStatus", "createdAt", "updatedAt")
		VALUES ($1, '2026-03-01', 'Doc Hub Project', 'Doc Client', 'Pune', 'Doc hub test complaint', 'OPEN', NOW(), NOW())
	`, docHubComplaint)
	if err != nil {
		t.Fatalf("seed complaint: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "ComplaintBatchLine" (id, "complaintId", "batchNumber", "createdAt")
		VALUES ($1, $2, $3, NOW())
	`, "doc-hub-cbl", docHubComplaint, docHubBatch)
	if err != nil {
		t.Fatalf("seed complaint line: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "ComplaintPhoto" (id, "complaintId", filename, "originalName", mimetype, size, "storagePath", "createdAt")
		VALUES ($1, $2, 'rust.png', 'doc-hub-rust.png', 'image/png', 512, 'uploads/complaint-photos/rust.png', NOW())
	`, "doc-hub-complaint-photo", docHubComplaint)
	if err != nil {
		t.Fatalf("seed complaint photo: %v", err)
	}
}

func cleanupDocumentsHubTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `DELETE FROM "ComplaintPhoto" WHERE "complaintId" = $1`, docHubComplaint)
	_, _ = pool.Exec(ctx, `DELETE FROM "ComplaintBatchLine" WHERE "complaintId" = $1`, docHubComplaint)
	_, _ = pool.Exec(ctx, `DELETE FROM "Complaint" WHERE "complaintId" = $1`, docHubComplaint)
	_, _ = pool.Exec(ctx, `DELETE FROM "SiteInstallationPhoto" WHERE "installationId" = $1`, docHubInstallID)
	_, _ = pool.Exec(ctx, `DELETE FROM "SiteInstallation" WHERE id = $1`, docHubInstallID)
	_, _ = pool.Exec(ctx, `DELETE FROM "DispatchBatchLine" WHERE "dispatchNoteNumber" = $1`, docHubDispatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "SiteDispatch" WHERE "dispatchNoteNumber" = $1`, docHubDispatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "QCInspectionPhoto" WHERE "inspectionId" = $1`, docHubQCID)
	_, _ = pool.Exec(ctx, `DELETE FROM "QCInspection" WHERE id = $1`, docHubQCID)
	_, _ = pool.Exec(ctx, `DELETE FROM "CoilDocument" WHERE "coilNumber" = $1`, docHubCoil)
	_, _ = pool.Exec(ctx, `DELETE FROM "BatchSlitCoilMap" WHERE "batchNumber" = $1`, docHubBatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "ProductionBatch" WHERE "batchNumber" = $1`, docHubBatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceiptPhoto" WHERE "receiptId" = $1`, docHubReceiptID)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceipt" WHERE id = $1`, docHubReceiptID)
	_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, docHubSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "Coil" WHERE "coilNumber" = $1`, docHubCoil)
}

func TestDocumentsHubAPI(t *testing.T) {
	srv, pool, cleanup := testServer(t)
	defer cleanup()

	setupDocumentsHubTestData(t, pool)
	defer cleanupDocumentsHubTestData(t, pool)

	adminToken := adminToken(t, srv)

	t.Run("returns document stats by category", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/documents/stats", nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("stats: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Stats struct {
				Total      int `json:"total"`
				ByCategory map[string]int `json:"byCategory"`
			} `json:"stats"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Stats.Total < 5 {
			t.Fatalf("expected total >= 5, got %d", body.Stats.Total)
		}
		if body.Stats.ByCategory["mtc"] < 1 {
			t.Fatal("expected mtc count >= 1")
		}
		if body.Stats.ByCategory["complaint-photos"] < 1 {
			t.Fatal("expected complaint-photos count >= 1")
		}
	})

	t.Run("lists all documents", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/documents", nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Total     int `json:"total"`
			Documents []struct {
				DownloadURL string `json:"downloadUrl"`
				SourcePath  string `json:"sourcePath"`
			} `json:"documents"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Total < 5 {
			t.Fatalf("expected total >= 5, got %d", body.Total)
		}
		if len(body.Documents) == 0 || body.Documents[0].DownloadURL == "" || body.Documents[0].SourcePath == "" {
			t.Fatal("expected document with downloadUrl and sourcePath")
		}
	})

	t.Run("searches documents by coil number", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/documents?search="+docHubCoil, nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("search: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Documents []struct {
				Context struct {
					CoilNumber string `json:"coilNumber"`
				} `json:"context"`
			} `json:"documents"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		found := false
		for _, d := range body.Documents {
			if d.Context.CoilNumber == docHubCoil {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected documents for coil %s", docHubCoil)
		}
	})

	t.Run("filters by category", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/documents?category=complaint-photos", nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("filter: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Documents []struct {
				Category string `json:"category"`
			} `json:"documents"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		for _, d := range body.Documents {
			if d.Category != "complaint-photos" {
				t.Fatalf("unexpected category %s", d.Category)
			}
		}
	})

	t.Run("returns documents by traceability reference", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/documents/by-reference?q="+docHubCoil, nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("by-reference: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Query string `json:"query"`
			Total int    `json:"total"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Query != docHubCoil {
			t.Fatalf("expected query %s, got %s", docHubCoil, body.Query)
		}
		if body.Total < 2 {
			t.Fatalf("expected total >= 2, got %d", body.Total)
		}
	})

	t.Run("allows warehouse read access to document hub", func(t *testing.T) {
		warehouseToken := loginToken(t, srv, "warehouse@sunrack.local", "Warehouse@123")
		req := httptest.NewRequest(http.MethodGet, "/api/documents/stats", nil)
		req.Header.Set("Authorization", "Bearer "+warehouseToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("warehouse stats: %d %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("denies unauthenticated access", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/documents/stats", nil)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rec.Code)
		}
	})
}
