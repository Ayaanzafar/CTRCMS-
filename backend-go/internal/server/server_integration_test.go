package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/config"
	"github.com/sunrack/ctrcms-go/internal/db"
	"github.com/sunrack/ctrcms-go/internal/server"
)

func testServer(t *testing.T) (*server.Server, *pgxpool.Pool, func()) {
	t.Helper()
	if os.Getenv("DATABASE_URL") == "" {
		_ = os.Setenv("DATABASE_URL", "postgresql://ctrcms:ctrcms_dev_password@127.0.0.1:5435/ctrcms?sslmode=disable")
	}
	if os.Getenv("JWT_SECRET") == "" {
		_ = os.Setenv("JWT_SECRET", "change-this-to-a-long-random-secret-in-production")
	}
	if os.Getenv("PORT") == "" {
		_ = os.Setenv("PORT", "4000")
	}

	cfg, err := config.Load()
	if err != nil {
		t.Skipf("config: %v", err)
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Skipf("database: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("database ping: %v", err)
	}

	queries := db.New(pool)
	srv := server.New(cfg, pool, queries)
	cleanup := func() { pool.Close() }
	return srv, pool, cleanup
}

func TestHealthCheck(t *testing.T) {
	srv, _, cleanup := testServer(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "ok" {
		t.Fatalf("expected status ok, got %v", body["status"])
	}
}

func TestAuthLoginAndMe(t *testing.T) {
	srv, _, cleanup := testServer(t)
	defer cleanup()

	loginBody := bytes.NewBufferString(`{"email":"admin@sunrack.local","password":"Admin@12345"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", loginBody)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("login expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var loginResp struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &loginResp); err != nil {
		t.Fatal(err)
	}
	if loginResp.Token == "" {
		t.Fatal("expected token")
	}

	meReq := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+loginResp.Token)
	meRec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(meRec, meReq)

	if meRec.Code != http.StatusOK {
		t.Fatalf("me expected 200, got %d: %s", meRec.Code, meRec.Body.String())
	}
}

func TestAuthLoginInvalid(t *testing.T) {
	srv, _, cleanup := testServer(t)
	defer cleanup()

	body := bytes.NewBufferString(`{"email":"admin@sunrack.local","password":"wrong"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}
