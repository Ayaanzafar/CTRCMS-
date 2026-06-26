package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/server"
)

const (
	tracCoil      = "TRAC-COIL-001"
	tracSlit      = "TRAC-COIL-001-S01"
	tracBatch     = "BATCH-TRAC-TEST"
	tracDispatch  = "DN-TRAC-TEST-001"
	tracComplaint = "COMP-TRAC-TEST-001"
	tracProject   = "Traceability Test Project"
)

func loginToken(t *testing.T, srv *server.Server, email, password string) string {
	t.Helper()
	body := bytes.NewBufferString(fmt.Sprintf(`{"email":%q,"password":%q}`, email, password))
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login %s: %d %s", email, rec.Code, rec.Body.String())
	}
	var res struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Token == "" {
		t.Fatalf("empty token for %s", email)
	}
	return res.Token
}

func setupTraceabilityTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	cleanupTraceabilityTestData(t, pool)

	_, err := pool.Exec(ctx, `
		INSERT INTO "Coil" ("coilNumber", grade, coating, size, weight, "mtcNumber", "invoiceNumber", supplier,
			"amnsDispatchDate", "vehicleNumber", "transporterName", status, "createdAt", "updatedAt")
		VALUES ($1, 'AMNS550S', 'ZM150', '1250 x 0.5 mm', 8.5, 'MTC-TRAC-001', 'INV-TRAC-001', 'AMNS (Hazira Plant)',
			'2026-01-05', 'GJ01TRAC01', 'AMNS Logistics', 'ACTIVE', NOW(), NOW())
	`, tracCoil)
	if err != nil {
		t.Fatalf("seed coil: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SlittingRecord" ("slitCoilId", "parentCoilNumber", "slitWidthSize", "slittingDate", "slitCoilWeight", "dispatchNote", "createdAt", "updatedAt")
		VALUES ($1, $2, '1040 x 0.5 mm', '2026-01-10', 4.0, 'DN-SS-TRAC-001', NOW(), NOW())
	`, tracSlit, tracCoil)
	if err != nil {
		t.Fatalf("seed slit: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SunrackReceipt" (id, "slitCoilId", "receiptDateSunrack", "storageLocationBin", "inspectionResult", "inspectionRemarks", "createdAt", "updatedAt")
		VALUES ($1, $2, '2026-01-15', 'WH-TRAC / Rack-01', 'PASS', 'Trace test receipt', NOW(), NOW())
	`, "receipt-"+tracSlit, tracSlit)
	if err != nil {
		t.Fatalf("seed receipt: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "ProductionBatch" ("batchNumber", "productionOrderNumber", "productType", "quantityProduced", "productionDate", "operatorShift", "createdAt", "updatedAt")
		VALUES ($1, 'PO-TRAC-001', 'Walkway Tray', 100, '2026-01-20', 'Shift A', NOW(), NOW())
	`, tracBatch)
	if err != nil {
		t.Fatalf("seed batch: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "BatchSlitCoilMap" (id, "batchNumber", "slitCoilId", "quantityConsumed", "createdAt")
		VALUES ($1, $2, $3, 1.0, NOW())
	`, "trac-map-"+tracBatch, tracBatch, tracSlit)
	if err != nil {
		t.Fatalf("seed consumption: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "QCInspection" (id, "batchNumber", "qcResult", "inspectorName", "inspectionDate", "qcRemarks", "createdAt", "updatedAt")
		VALUES ($1, $2, 'PASS', 'QC Trace Inspector', '2026-01-21', 'Pass for traceability test', NOW(), NOW())
	`, "trac-qc-"+tracBatch, tracBatch)
	if err != nil {
		t.Fatalf("seed qc: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SiteDispatch" ("dispatchNoteNumber", "dispatchDate", "projectName", "clientName", "siteLocation", "createdAt", "updatedAt")
		VALUES ($1, '2026-01-25', $2, 'Trace Client', 'Pune', NOW(), NOW())
	`, tracDispatch, tracProject)
	if err != nil {
		t.Fatalf("seed dispatch: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "DispatchBatchLine" (id, "dispatchNoteNumber", "batchNumber", "quantityDispatched", "createdAt")
		VALUES ($1, $2, $3, 50, NOW())
	`, "trac-dbl-"+tracDispatch, tracDispatch, tracBatch)
	if err != nil {
		t.Fatalf("seed dispatch line: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SiteInstallation" (id, "dispatchNoteNumber", "siteReceiptDate", "installationDate", "installerEpcPartner", "quantityInstalled", "createdAt", "updatedAt")
		VALUES ($1, $2, '2026-01-27', '2026-01-28', 'Trace EPC', 50, NOW(), NOW())
	`, "trac-install-"+tracDispatch, tracDispatch)
	if err != nil {
		t.Fatalf("seed installation: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "Complaint" ("complaintId", "complaintDate", "projectName", "clientName", "siteLocation",
			"complaintDescription", "resolutionStatus", "createdAt", "updatedAt")
		VALUES ($1, '2026-02-01', $2, 'Trace Client', 'Pune', 'Trace test rust complaint', 'OPEN', NOW(), NOW())
	`, tracComplaint, tracProject)
	if err != nil {
		t.Fatalf("seed complaint: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "ComplaintBatchLine" (id, "complaintId", "batchNumber", "createdAt")
		VALUES ($1, $2, $3, NOW())
	`, "trac-cbl-"+tracComplaint, tracComplaint, tracBatch)
	if err != nil {
		t.Fatalf("seed complaint line: %v", err)
	}
}

func cleanupTraceabilityTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `DELETE FROM "ComplaintPhoto" WHERE "complaintId" = $1`, tracComplaint)
	_, _ = pool.Exec(ctx, `DELETE FROM "ComplaintBatchLine" WHERE "complaintId" = $1`, tracComplaint)
	_, _ = pool.Exec(ctx, `DELETE FROM "Complaint" WHERE "complaintId" = $1`, tracComplaint)
	_, _ = pool.Exec(ctx, `DELETE FROM "SiteInstallationPhoto" WHERE "installationId" IN (SELECT id FROM "SiteInstallation" WHERE "dispatchNoteNumber" = $1)`, tracDispatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "SiteInstallation" WHERE "dispatchNoteNumber" = $1`, tracDispatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "DispatchBatchLine" WHERE "dispatchNoteNumber" = $1`, tracDispatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "SiteDispatch" WHERE "dispatchNoteNumber" = $1`, tracDispatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "QCInspection" WHERE "batchNumber" = $1`, tracBatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "BatchSlitCoilMap" WHERE "batchNumber" = $1`, tracBatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "ProductionBatch" WHERE "batchNumber" = $1`, tracBatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceipt" WHERE "slitCoilId" = $1`, tracSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, tracSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "CoilDocument" WHERE "coilNumber" = $1`, tracCoil)
	_, _ = pool.Exec(ctx, `DELETE FROM "Coil" WHERE "coilNumber" = $1`, tracCoil)
}

func TestTraceabilityAPI(t *testing.T) {
	srv, pool, cleanup := testServer(t)
	defer cleanup()

	setupTraceabilityTestData(t, pool)
	defer cleanupTraceabilityTestData(t, pool)

	adminToken := adminToken(t, srv)
	managementToken := loginToken(t, srv, "management@sunrack.local", "Management@123")

	t.Run("returns search suggestions for coil number", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/traceability/search?q=TRAC-COIL", nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("search: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Hits []struct {
				ReferenceId string `json:"referenceId"`
			} `json:"hits"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		found := false
		for _, h := range body.Hits {
			if h.ReferenceId == tracCoil {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected %s in search hits: %+v", tracCoil, body.Hits)
		}
	})

	t.Run("builds full timeline from coil number", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/traceability/timeline?q="+tracCoil, nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("timeline: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Timeline struct {
				RootCoilNumbers []string `json:"rootCoilNumbers"`
				Events          []struct {
					Stage string `json:"stage"`
				} `json:"events"`
			} `json:"timeline"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if !contains(body.Timeline.RootCoilNumbers, tracCoil) {
			t.Fatalf("expected root coil %s", tracCoil)
		}
		stages := make(map[string]bool)
		for _, e := range body.Timeline.Events {
			stages[e.Stage] = true
		}
		for _, stage := range []string{
			"COIL_MASTER", "SLITTING", "SUNRACK_RECEIPT", "PRODUCTION",
			"QC", "DISPATCH", "SITE_INSTALLATION", "COMPLAINT",
		} {
			if !stages[stage] {
				t.Fatalf("missing stage %s in timeline", stage)
			}
		}
	})

	t.Run("resolves timeline from complaint ID back to coil", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/traceability/timeline?q="+tracComplaint, nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("timeline complaint: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Timeline struct {
				ReferenceType   string   `json:"referenceType"`
				RootCoilNumbers []string `json:"rootCoilNumbers"`
			} `json:"timeline"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Timeline.ReferenceType != "COMPLAINT_ID" {
			t.Fatalf("expected COMPLAINT_ID, got %s", body.Timeline.ReferenceType)
		}
		if !contains(body.Timeline.RootCoilNumbers, tracCoil) {
			t.Fatalf("expected root coil %s from complaint", tracCoil)
		}
	})

	t.Run("resolves timeline from batch dispatch slit and project", func(t *testing.T) {
		for _, q := range []string{tracBatch, tracDispatch, tracSlit, tracProject} {
			req := httptest.NewRequest(http.MethodGet, "/api/traceability/timeline?q="+q, nil)
			req.Header.Set("Authorization", "Bearer "+adminToken)
			rec := httptest.NewRecorder()
			srv.Echo.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("timeline %s: %d %s", q, rec.Code, rec.Body.String())
			}
			var body struct {
				Timeline struct {
					RootCoilNumbers []string `json:"rootCoilNumbers"`
				} `json:"timeline"`
			}
			_ = json.Unmarshal(rec.Body.Bytes(), &body)
			if !contains(body.Timeline.RootCoilNumbers, tracCoil) {
				t.Fatalf("query %s: expected root coil %s", q, tracCoil)
			}
		}
	})

	t.Run("exports PDF report", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/traceability/export/pdf?q="+tracCoil, nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("pdf: %d %s", rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/pdf" {
			t.Fatalf("expected application/pdf, got %s", ct)
		}
		if len(rec.Body.Bytes()) < 500 {
			t.Fatalf("expected pdf > 500 bytes, got %d", len(rec.Body.Bytes()))
		}
		if rec.Body.String()[:4] != "%PDF" {
			t.Fatal("expected PDF magic bytes")
		}
	})

	t.Run("returns 404 for unknown reference", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/traceability/timeline?q=UNKNOWN-XYZ-999", nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", rec.Code)
		}
	})

	t.Run("allows management read-only access", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/traceability/timeline?q="+tracCoil, nil)
		req.Header.Set("Authorization", "Bearer "+managementToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("management timeline: %d %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("denies unauthenticated access", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/traceability/timeline?q="+tracCoil, nil)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rec.Code)
		}
	})
}
