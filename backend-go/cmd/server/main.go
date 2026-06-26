package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sunrack/ctrcms-go/internal/config"
	"github.com/sunrack/ctrcms-go/internal/db"
	"github.com/sunrack/ctrcms-go/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	if _, err := config.EnsureUploadDirectories(cfg.UploadDir); err != nil {
		log.Fatalf("storage: %v", err)
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("database ping: %v", err)
	}

	queries := db.New(pool)
	srv := server.New(cfg, pool, queries)

	go func() {
		addr := fmt.Sprintf(":%d", cfg.Port)
		log.Printf("CTRCMS Go API running on http://localhost%s", addr)
		if err := srv.Echo.Start(addr); err != nil {
			log.Printf("server stopped: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Echo.Shutdown(shutdownCtx)
}
