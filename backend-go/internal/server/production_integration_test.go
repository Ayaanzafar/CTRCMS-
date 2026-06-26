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
	prodTestParent  = "PROD-TEST-PARENT-001"
	prodTestSlit    = "PROD-TEST-SLIT-001"
	prodTestSlit2   = "PROD-TEST-SLIT-002"
	prodBatchA      = "BATCH-TEST-PH5-A"
	prodBatchB      = "BATCH-TEST-PH5-B"
	prodBatchIssue  = "BATCH-TEST-PH5-ISSUE"
)

func setupProductionTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	cleanupProductionTestData(t, pool)

	_, err := pool.Exec(ctx, `
		INSERT INTO "Coil" ("coilNumber", grade, coating, size, weight, supplier, status, "createdAt", "updatedAt")
		VALUES ($1, 'AMNS550S', 'ZM150', '1250 x 0.5 mm', 5, 'AMNS (Hazira Plant)', 'ACTIVE', NOW(), NOW())
	`, prodTestParent)
	if err != nil {
		t.Fatalf("seed parent: %v", err)
	}

	for _, spec := range []struct {
		slit   string
		weight float64
	}{
		{prodTestSlit, 4.8},
		{prodTestSlit2, 2.0},
	} {
		_, err = pool.Exec(ctx, `
			INSERT INTO "SlittingRecord" ("slitCoilId", "parentCoilNumber", "slitWidthSize", "slittingDate", "slitCoilWeight", "slitterLocation", "dispatchNote", "createdAt", "updatedAt")
			VALUES ($1, $2, '1040 x 0.5 mm', '2026-01-15', $3, 'Shiv Sagar Slitter', 'DN-PROD-001', NOW(), NOW())
		`, spec.slit, prodTestParent, spec.weight)
		if err != nil {
			t.Fatalf("seed slit %s: %v", spec.slit, err)
		}

		_, err = pool.Exec(ctx, `
			INSERT INTO "SunrackReceipt" (id, "slitCoilId", "receiptDateSunrack", "storageLocationBin", "inspectionResult", "createdAt", "updatedAt")
			VALUES ($1, $2, '2026-02-01', 'WH-A / Rack-01', 'PASS', NOW(), NOW())
		`, "receipt-"+spec.slit, spec.slit)
		if err != nil {
			t.Fatalf("seed receipt %s: %v", spec.slit, err)
		}
	}
}

func cleanupProductionTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	batches := []string{prodBatchA, prodBatchB, prodBatchIssue, "BATCH-FG-TEST-PASS", "BATCH-FG-TEST-FAIL"}
	slits := []string{prodTestSlit, prodTestSlit2}

	_, _ = pool.Exec(ctx, `DELETE FROM "BatchSlitCoilMap" WHERE "batchNumber" = ANY($1) OR "slitCoilId" = ANY($2)`, batches, slits)
	_, _ = pool.Exec(ctx, `DELETE FROM "ProductionBatch" WHERE "batchNumber" = ANY($1)`, batches)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceiptPhoto" WHERE "receiptId" IN (SELECT id FROM "SunrackReceipt" WHERE "slitCoilId" = ANY($1))`, slits)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceipt" WHERE "slitCoilId" = ANY($1)`, slits)
	_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = ANY($1)`, slits)
	_, _ = pool.Exec(ctx, `DELETE FROM "Coil" WHERE "coilNumber" = $1`, prodTestParent)
}

func TestProductionAPI(t *testing.T) {
	srv, pool, cleanup := testServer(t)
	defer cleanup()

	setupProductionTestData(t, pool)
	defer cleanupProductionTestData(t, pool)

	token := adminToken(t, srv)

	t.Run("returns stats and preview batch number", func(t *testing.T) {
		statsReq := httptest.NewRequest(http.MethodGet, "/api/production/stats", nil)
		statsReq.Header.Set("Authorization", "Bearer "+token)
		statsRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(statsRec, statsReq)
		if statsRec.Code != http.StatusOK {
			t.Fatalf("stats: %d %s", statsRec.Code, statsRec.Body.String())
		}
		var statsBody struct {
			Stats map[string]int64 `json:"stats"`
		}
		_ = json.Unmarshal(statsRec.Body.Bytes(), &statsBody)
		if statsBody.Stats["totalBatches"] < 0 || statsBody.Stats["slitCoilsWithReceipt"] < 1 {
			t.Fatalf("unexpected stats: %+v", statsBody.Stats)
		}

		previewReq := httptest.NewRequest(http.MethodGet, "/api/production/preview-batch-number", nil)
		previewReq.Header.Set("Authorization", "Bearer "+token)
		previewRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(previewRec, previewReq)
		if previewRec.Code != http.StatusOK {
			t.Fatalf("preview: %d", previewRec.Code)
		}
		var previewBody struct {
			BatchNumber string `json:"batchNumber"`
		}
		_ = json.Unmarshal(previewRec.Body.Bytes(), &previewBody)
		if !strings.HasPrefix(previewBody.BatchNumber, "BATCH-") {
			t.Fatalf("unexpected preview batch: %s", previewBody.BatchNumber)
		}
	})

	t.Run("lists available slit coils with remaining quantity", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/production/available-slit-coils", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("available: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Available []struct {
				SlitCoilId        string  `json:"slitCoilId"`
				RemainingQuantity float64 `json:"remainingQuantity"`
			} `json:"available"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		found := false
		for _, a := range body.Available {
			if a.SlitCoilId == prodTestSlit && a.RemainingQuantity > 0 {
				found = true
			}
		}
		if !found {
			t.Fatal("expected available slit with remaining quantity")
		}
	})

	t.Run("creates first batch consuming partial slit coil weight", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"batchNumber":%q,
			"productionOrderNumber":"PO-TEST-001",
			"productType":"Walkway Tray",
			"quantityProduced":120,
			"productionDate":"2026-02-10",
			"operatorShift":"Shift A",
			"slitCoilConsumptions":[{"slitCoilId":%q,"quantityConsumed":2.5}]
		}`, prodBatchA, prodTestSlit))
		req := httptest.NewRequest(http.MethodPost, "/api/production", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create A: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Batch struct {
				BatchNumber           string `json:"batchNumber"`
				SlitCoilConsumptions  []struct {
					SlitCoilId       string `json:"slitCoilId"`
					QuantityConsumed string `json:"quantityConsumed"`
				} `json:"slitCoilConsumptions"`
			} `json:"batch"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if res.Batch.BatchNumber != prodBatchA || len(res.Batch.SlitCoilConsumptions) != 1 {
			t.Fatalf("unexpected batch A: %+v", res.Batch)
		}
		if res.Batch.SlitCoilConsumptions[0].QuantityConsumed != "2.5" {
			t.Fatalf("expected 2.5 consumed, got %s", res.Batch.SlitCoilConsumptions[0].QuantityConsumed)
		}
	})

	t.Run("creates second batch consuming remaining slit coil", func(t *testing.T) {
		usageReq := httptest.NewRequest(http.MethodGet, "/api/production/slit-coil/"+prodTestSlit+"/usage", nil)
		usageReq.Header.Set("Authorization", "Bearer "+token)
		usageRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(usageRec, usageReq)
		var usageBody struct {
			RemainingQuantity float64 `json:"remainingQuantity"`
		}
		_ = json.Unmarshal(usageRec.Body.Bytes(), &usageBody)
		if usageBody.RemainingQuantity <= 0 {
			t.Fatalf("expected remaining > 0, got %v", usageBody.RemainingQuantity)
		}

		body := bytes.NewBufferString(fmt.Sprintf(`{
			"batchNumber":%q,
			"productionOrderNumber":"PO-TEST-002",
			"productType":"Support Frame",
			"quantityProduced":80,
			"productionDate":"2026-02-11",
			"operatorShift":"Shift B",
			"slitCoilConsumptions":[{"slitCoilId":%q,"quantityConsumed":%v}]
		}`, prodBatchB, prodTestSlit, usageBody.RemainingQuantity))
		req := httptest.NewRequest(http.MethodPost, "/api/production", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create B: %d %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("issues additional slit coils to existing batch", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"batchNumber":%q,
			"productionOrderNumber":"PO-ISSUE-001",
			"productType":"Purlin",
			"quantityProduced":50,
			"productionDate":"2026-02-12",
			"operatorShift":"Shift A",
			"slitCoilConsumptions":[{"slitCoilId":%q,"quantityConsumed":0.5}]
		}`, prodBatchIssue, prodTestSlit2))
		createReq := httptest.NewRequest(http.MethodPost, "/api/production", body)
		createReq.Header.Set("Authorization", "Bearer "+token)
		createReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		createRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(createRec, createReq)
		if createRec.Code != http.StatusCreated {
			t.Fatalf("create issue batch: %d %s", createRec.Code, createRec.Body.String())
		}

		issueBody := bytes.NewBufferString(fmt.Sprintf(`{
			"slitCoilConsumptions":[{"slitCoilId":%q,"quantityConsumed":0.3}]
		}`, prodTestSlit2))
		issueReq := httptest.NewRequest(http.MethodPost, "/api/production/"+prodBatchIssue+"/issue", issueBody)
		issueReq.Header.Set("Authorization", "Bearer "+token)
		issueReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		issueRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(issueRec, issueReq)
		if issueRec.Code != http.StatusOK {
			t.Fatalf("issue: %d %s", issueRec.Code, issueRec.Body.String())
		}
		var issueRes struct {
			Batch struct {
				SlitCoilConsumptions []struct {
					QuantityConsumed string `json:"quantityConsumed"`
				} `json:"slitCoilConsumptions"`
			} `json:"batch"`
		}
		_ = json.Unmarshal(issueRec.Body.Bytes(), &issueRes)
		if len(issueRes.Batch.SlitCoilConsumptions) != 1 {
			t.Fatal("expected one consumption line after issue")
		}
	})

	t.Run("rejects over-consumption beyond slit coil weight", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"productionOrderNumber":"PO-TEST-FAIL",
			"productType":"Walkway Tray",
			"quantityProduced":10,
			"productionDate":"2026-02-12",
			"operatorShift":"Shift A",
			"slitCoilConsumptions":[{"slitCoilId":%q,"quantityConsumed":0.001}]
		}`, prodTestSlit))
		req := httptest.NewRequest(http.MethodPost, "/api/production", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("rejects duplicate batch number", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"batchNumber":%q,
			"productionOrderNumber":"PO-DUP",
			"productType":"Walkway Tray",
			"quantityProduced":10,
			"productionDate":"2026-02-12",
			"operatorShift":"Shift A",
			"slitCoilConsumptions":[{"slitCoilId":%q,"quantityConsumed":0.001}]
		}`, prodBatchA, prodTestSlit2))
		req := httptest.NewRequest(http.MethodPost, "/api/production", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d", rec.Code)
		}
	})

	t.Run("batch detail lists slit coil consumptions", func(t *testing.T) {
		for _, batch := range []string{prodBatchA, prodBatchB} {
			req := httptest.NewRequest(http.MethodGet, "/api/production/"+batch, nil)
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			srv.Echo.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("get %s: %d", batch, rec.Code)
			}
			var body struct {
				Batch struct {
					SlitCoilConsumptions []struct {
						SlitCoilId       string `json:"slitCoilId"`
						QuantityConsumed string `json:"quantityConsumed"`
						SlitCoil         struct {
							SlitCoilId string `json:"slitCoilId"`
						} `json:"slitCoil"`
					} `json:"slitCoilConsumptions"`
				} `json:"batch"`
			}
			_ = json.Unmarshal(rec.Body.Bytes(), &body)
			if len(body.Batch.SlitCoilConsumptions) == 0 {
				t.Fatalf("expected consumptions on %s", batch)
			}
			if body.Batch.SlitCoilConsumptions[0].SlitCoilId != prodTestSlit {
				t.Fatalf("unexpected slit on %s", batch)
			}
			if body.Batch.SlitCoilConsumptions[0].SlitCoil.SlitCoilId == "" {
				t.Fatalf("expected nested slitCoil on %s", batch)
			}
		}
	})

	t.Run("updates batch metadata", func(t *testing.T) {
		body := bytes.NewBufferString(`{"operatorShift":"Shift C"}`)
		req := httptest.NewRequest(http.MethodPut, "/api/production/"+prodBatchA, body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Batch struct {
				OperatorShift string `json:"operatorShift"`
			} `json:"batch"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if res.Batch.OperatorShift != "Shift C" {
			t.Fatalf("expected Shift C, got %s", res.Batch.OperatorShift)
		}
	})

	t.Run("lists production batches with consumptions summary", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/production?search="+prodBatchA, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("list: %d", rec.Code)
		}
		var body struct {
			Batches []struct {
				BatchNumber          string `json:"batchNumber"`
				SlitCoilConsumptions []map[string]interface{} `json:"slitCoilConsumptions"`
				Count                struct {
					SlitCoilConsumptions int64 `json:"slitCoilConsumptions"`
				} `json:"_count"`
			} `json:"batches"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if len(body.Batches) == 0 {
			t.Fatal("expected batches in list")
		}
	})

	t.Run("slit coil detail shows batches that consumed it", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/slitting/"+prodTestSlit, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("slitting get: %d", rec.Code)
		}
		var body struct {
			Record struct {
				BatchConsumptions []struct {
					Batch struct {
						BatchNumber string `json:"batchNumber"`
					} `json:"batch"`
				} `json:"batchConsumptions"`
			} `json:"record"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		numbers := map[string]bool{}
		for _, c := range body.Record.BatchConsumptions {
			numbers[c.Batch.BatchNumber] = true
		}
		if !numbers[prodBatchA] || !numbers[prodBatchB] {
			t.Fatalf("expected batches A and B on slit detail, got %v", numbers)
		}
	})

	t.Run("rejects slit coil without Sunrack receipt", func(t *testing.T) {
		ctx := context.Background()
		noReceiptSlit := "PROD-TEST-NORECEIPT"
		_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, noReceiptSlit)
		_, err := pool.Exec(ctx, `
			INSERT INTO "SlittingRecord" ("slitCoilId", "parentCoilNumber", "slitWidthSize", "slittingDate", "slitCoilWeight", "slitterLocation", "createdAt", "updatedAt")
			VALUES ($1, $2, '1040 x 0.5 mm', '2026-01-15', 1.0, 'Shiv Sagar Slitter', NOW(), NOW())
		`, noReceiptSlit, prodTestParent)
		if err != nil {
			t.Fatal(err)
		}
		defer func() {
			_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, noReceiptSlit)
		}()

		body := bytes.NewBufferString(fmt.Sprintf(`{
			"productionOrderNumber":"PO-NORECEIPT",
			"productType":"Walkway Tray",
			"quantityProduced":10,
			"productionDate":"2026-02-12",
			"operatorShift":"Shift A",
			"slitCoilConsumptions":[{"slitCoilId":%q,"quantityConsumed":0.5}]
		}`, noReceiptSlit))
		req := httptest.NewRequest(http.MethodPost, "/api/production", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "Sunrack receipt") {
			t.Fatalf("expected Sunrack receipt error, got %s", rec.Body.String())
		}
	})

	t.Run("rejects slit coil that failed warehouse inspection", func(t *testing.T) {
		ctx := context.Background()
		failSlit := "PROD-TEST-FAILSLIT"
		_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceipt" WHERE "slitCoilId" = $1`, failSlit)
		_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, failSlit)
		_, err := pool.Exec(ctx, `
			INSERT INTO "SlittingRecord" ("slitCoilId", "parentCoilNumber", "slitWidthSize", "slittingDate", "slitCoilWeight", "slitterLocation", "createdAt", "updatedAt")
			VALUES ($1, $2, '1040 x 0.5 mm', '2026-01-15', 1.0, 'Shiv Sagar Slitter', NOW(), NOW())
		`, failSlit, prodTestParent)
		if err != nil {
			t.Fatal(err)
		}
		_, err = pool.Exec(ctx, `
			INSERT INTO "SunrackReceipt" (id, "slitCoilId", "receiptDateSunrack", "storageLocationBin", "inspectionResult", "createdAt", "updatedAt")
			VALUES ($1, $2, '2026-02-01', 'WH-FAIL', 'FAIL', NOW(), NOW())
		`, "receipt-"+failSlit, failSlit)
		if err != nil {
			t.Fatal(err)
		}
		defer func() {
			_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceipt" WHERE "slitCoilId" = $1`, failSlit)
			_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, failSlit)
		}()

		body := bytes.NewBufferString(fmt.Sprintf(`{
			"productionOrderNumber":"PO-FAILSLIT",
			"productType":"Walkway Tray",
			"quantityProduced":10,
			"productionDate":"2026-02-12",
			"operatorShift":"Shift A",
			"slitCoilConsumptions":[{"slitCoilId":%q,"quantityConsumed":0.5}]
		}`, failSlit))
		req := httptest.NewRequest(http.MethodPost, "/api/production", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "failed warehouse inspection") {
			t.Fatalf("expected inspection fail error, got %s", rec.Body.String())
		}
	})

	t.Run("rejects unknown slit coil", func(t *testing.T) {
		body := bytes.NewBufferString(`{
			"productionOrderNumber":"PO-UNKNOWN",
			"productType":"Walkway Tray",
			"quantityProduced":10,
			"productionDate":"2026-02-12",
			"operatorShift":"Shift A",
			"slitCoilConsumptions":[{"slitCoilId":"UNKNOWN-SLIT-999","quantityConsumed":0.5}]
		}`)
		req := httptest.NewRequest(http.MethodPost, "/api/production", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("denies unauthenticated access", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/production", nil)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rec.Code)
		}
	})
}
