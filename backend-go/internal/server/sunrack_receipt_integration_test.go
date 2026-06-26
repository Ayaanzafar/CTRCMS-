package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

const (
	sunrackTestParent = "SUNRACK-TEST-PARENT-001"
	sunrackTestSlit   = "SUNRACK-TEST-SLIT-001"
)

var minPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82,
}

func setupSunrackTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceiptPhoto" WHERE "receiptId" IN (
		SELECT id FROM "SunrackReceipt" WHERE "slitCoilId" = $1
	)`, sunrackTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceipt" WHERE "slitCoilId" = $1`, sunrackTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, sunrackTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "Coil" WHERE "coilNumber" = $1`, sunrackTestParent)

	_, err := pool.Exec(ctx, `
		INSERT INTO "Coil" ("coilNumber", grade, coating, size, weight, supplier, status, "createdAt", "updatedAt")
		VALUES ($1, 'AMNS550S', 'ZM150', '1250 x 0.5 mm', 5, 'AMNS (Hazira Plant)', 'ACTIVE', NOW(), NOW())
	`, sunrackTestParent)
	if err != nil {
		t.Fatalf("seed parent coil: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SlittingRecord" ("slitCoilId", "parentCoilNumber", "slitWidthSize", "slittingDate", "slitCoilWeight", "slitterLocation", "dispatchNote", "createdAt", "updatedAt")
		VALUES ($1, $2, '1040 x 0.5 mm', '2026-01-15', 3.5, 'Shiv Sagar Slitter', 'DN-TEST-001', NOW(), NOW())
	`, sunrackTestSlit, sunrackTestParent)
	if err != nil {
		t.Fatalf("seed slit coil: %v", err)
	}
}

func teardownSunrackTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceiptPhoto" WHERE "receiptId" IN (
		SELECT id FROM "SunrackReceipt" WHERE "slitCoilId" = $1
	)`, sunrackTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceipt" WHERE "slitCoilId" = $1`, sunrackTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, sunrackTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "Coil" WHERE "coilNumber" = $1`, sunrackTestParent)
}

func multipartPhotoBody(t *testing.T, field, filename string, content []byte) (*bytes.Buffer, string) {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile(field, filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(part, bytes.NewReader(content)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return body, writer.FormDataContentType()
}

func TestSunrackReceiptAPI(t *testing.T) {
	srv, pool, cleanup := testServer(t)
	defer cleanup()

	setupSunrackTestData(t, pool)
	defer teardownSunrackTestData(t, pool)

	token := adminToken(t, srv)
	var receiptID string

	t.Run("returns stats with pending slit coils", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/sunrack-receipts/stats", nil)
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
		for _, key := range []string{"totalReceipts", "pendingSlitCoils", "passedInspections", "failedInspections"} {
			if _, ok := body.Stats[key]; !ok {
				t.Fatalf("missing stats key %s", key)
			}
		}
		if body.Stats["pendingSlitCoils"] < 1 {
			t.Fatalf("expected pending slit coils >= 1")
		}
	})

	t.Run("lists pending slit coils", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/sunrack-receipts/pending", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("pending: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Pending []struct {
				SlitCoilId string `json:"slitCoilId"`
			} `json:"pending"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		found := false
		for _, p := range body.Pending {
			if p.SlitCoilId == sunrackTestSlit {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected pending slit %s in list", sunrackTestSlit)
		}
	})

	t.Run("creates Sunrack receipt", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"slitCoilId":%q,
			"receiptDateSunrack":"2026-02-01",
			"storageLocationBin":"WH-A / Rack-12 / Bin-04",
			"inspectionResult":"PASS",
			"inspectionRemarks":"Coating intact, no edge damage",
			"confirmedDispatchNote":"DN-SS-2026-001"
		}`, sunrackTestSlit))
		req := httptest.NewRequest(http.MethodPost, "/api/sunrack-receipts", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Receipt struct {
				ID                 string `json:"id"`
				SlitCoilId         string `json:"slitCoilId"`
				StorageLocationBin string `json:"storageLocationBin"`
				InspectionResult   string `json:"inspectionResult"`
			} `json:"receipt"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if res.Receipt.SlitCoilId != sunrackTestSlit {
			t.Fatalf("unexpected slit coil id: %s", res.Receipt.SlitCoilId)
		}
		if res.Receipt.InspectionResult != "PASS" {
			t.Fatalf("expected PASS, got %s", res.Receipt.InspectionResult)
		}
		receiptID = res.Receipt.ID
	})

	t.Run("rejects duplicate receipt", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"slitCoilId":%q,
			"receiptDateSunrack":"2026-02-01",
			"storageLocationBin":"WH-B"
		}`, sunrackTestSlit))
		req := httptest.NewRequest(http.MethodPost, "/api/sunrack-receipts", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d", rec.Code)
		}
	})

	t.Run("uploads inspection photos", func(t *testing.T) {
		if receiptID == "" {
			t.Fatal("receipt id required")
		}
		body, contentType := multipartPhotoBody(t, "photos", "inspection-test.png", minPNG)
		req := httptest.NewRequest(http.MethodPost, "/api/sunrack-receipts/"+receiptID+"/photos", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, contentType)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("upload photos: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Photos []map[string]interface{} `json:"photos"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if len(res.Photos) == 0 {
			t.Fatal("expected uploaded photos")
		}
	})

	t.Run("serves inspection photo file", func(t *testing.T) {
		getReq := httptest.NewRequest(http.MethodGet, "/api/sunrack-receipts/"+receiptID, nil)
		getReq.Header.Set("Authorization", "Bearer "+token)
		getRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(getRec, getReq)
		var getBody struct {
			Receipt struct {
				Photos []struct {
					ID string `json:"id"`
				} `json:"photos"`
			} `json:"receipt"`
		}
		_ = json.Unmarshal(getRec.Body.Bytes(), &getBody)
		if len(getBody.Receipt.Photos) == 0 {
			t.Fatal("expected photos on receipt")
		}
		photoID := getBody.Receipt.Photos[0].ID

		req := httptest.NewRequest(http.MethodGet, "/api/sunrack-receipts/photos/"+photoID+"/file", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("serve photo: %d", rec.Code)
		}
		if !strings.HasPrefix(rec.Header().Get("Content-Type"), "image/") {
			t.Fatalf("expected image content type, got %s", rec.Header().Get("Content-Type"))
		}
	})

	t.Run("includes Sunrack receipt on slit coil detail", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/slitting/"+sunrackTestSlit, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("slitting get: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Record struct {
				SunrackReceipt *struct {
					InspectionResult   string `json:"inspectionResult"`
					ReceiptDateSunrack string `json:"receiptDateSunrack"`
					Photos             []map[string]interface{} `json:"photos"`
				} `json:"sunrackReceipt"`
			} `json:"record"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Record.SunrackReceipt == nil {
			t.Fatal("expected sunrackReceipt on slit detail")
		}
		if body.Record.SunrackReceipt.InspectionResult != "PASS" {
			t.Fatalf("expected PASS on linked receipt")
		}
		if len(body.Record.SunrackReceipt.Photos) == 0 {
			t.Fatal("expected photos on linked receipt")
		}
	})

	t.Run("denies access without authentication", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/sunrack-receipts/stats", nil)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rec.Code)
		}
	})
}
