package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL      string
	Port             int
	Environment      string
	CORSOrigin       string
	JWTSecret        string
	JWTExpiresIn     string
	UploadDir        string
	MaxFileSizeBytes int64
	AllowedMimeTypes []string
}

func Load() (*Config, error) {
	_ = godotenv.Load("../backend/.env")
	_ = godotenv.Overload(".env")

	cfg := &Config{
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		Environment:  getEnv("NODE_ENV", "development"),
		CORSOrigin:   getEnv("CORS_ORIGIN", "http://localhost:5173"),
		JWTSecret:    os.Getenv("JWT_SECRET"),
		JWTExpiresIn: getEnv("JWT_EXPIRES_IN", "8h"),
		UploadDir:    getEnv("UPLOAD_DIR", "../backend/uploads"),
	}

	portStr := getEnv("PORT", "4000")
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return nil, fmt.Errorf("invalid PORT: %w", err)
	}
	cfg.Port = port

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if len(cfg.JWTSecret) < 16 {
		return nil, fmt.Errorf("JWT_SECRET must be at least 16 characters")
	}

	maxMB, err := strconv.Atoi(getEnv("MAX_FILE_SIZE_MB", "25"))
	if err != nil {
		return nil, fmt.Errorf("invalid MAX_FILE_SIZE_MB: %w", err)
	}
	cfg.MaxFileSizeBytes = int64(maxMB) * 1024 * 1024

	mimes := getEnv("ALLOWED_MIME_TYPES", "image/jpeg,image/png,image/webp,application/pdf")
	parts := strings.Split(mimes, ",")
	cfg.AllowedMimeTypes = make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			cfg.AllowedMimeTypes = append(cfg.AllowedMimeTypes, t)
		}
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
