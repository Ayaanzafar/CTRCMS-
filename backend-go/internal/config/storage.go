package config

import (
	"os"
	"path/filepath"
)

var UploadSubdirs = []string{
	"mtc",
	"invoices",
	"delivery-notes",
	"qc-reports",
	"inspection-photos",
	"installation-photos",
	"complaint-photos",
	"misc",
}

func EnsureUploadDirectories(uploadDir string) (string, error) {
	root, err := filepath.Abs(uploadDir)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", err
	}
	for _, sub := range UploadSubdirs {
		if err := os.MkdirAll(filepath.Join(root, sub), 0o755); err != nil {
			return "", err
		}
	}
	return root, nil
}
