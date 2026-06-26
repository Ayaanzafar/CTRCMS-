package upload

import (
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

type SavedFile struct {
	Filename     string
	OriginalName string
	Mimetype     string
	Size         int32
	StoragePath  string
}

func SaveToCategory(uploadRoot, category string, maxSize int64, allowedMimes []string, fh *multipart.FileHeader) (*SavedFile, error) {
	if fh == nil {
		return nil, fmt.Errorf("No file uploaded")
	}
	if fh.Size > maxSize {
		mb := maxSize / 1024 / 1024
		return nil, fmt.Errorf("File too large. Maximum size is %d MB", mb)
	}

	mimetype := fh.Header.Get("Content-Type")
	if mimetype == "" {
		mimetype = "application/octet-stream"
	}
	if !mimeAllowed(mimetype, allowedMimes) {
		return nil, fmt.Errorf("File type not allowed: %s", mimetype)
	}

	ext := filepath.Ext(fh.Filename)
	filename := uuid.New().String() + ext
	destDir := filepath.Join(uploadRoot, category)
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return nil, err
	}
	storagePath := filepath.Join(destDir, filename)

	src, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer src.Close()

	dst, err := os.Create(storagePath)
	if err != nil {
		return nil, err
	}
	defer dst.Close()

	written, err := io.Copy(dst, src)
	if err != nil {
		_ = os.Remove(storagePath)
		return nil, err
	}

	return &SavedFile{
		Filename:     filename,
		OriginalName: fh.Filename,
		Mimetype:     mimetype,
		Size:         int32(written),
		StoragePath:  storagePath,
	}, nil
}

func mimeAllowed(mimetype string, allowed []string) bool {
	for _, a := range allowed {
		if strings.EqualFold(a, mimetype) {
			return true
		}
	}
	return false
}
