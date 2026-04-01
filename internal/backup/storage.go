package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// StorageProvider abstracts backup file storage across different backends.
type StorageProvider interface {
	Upload(ctx context.Context, key string, data io.Reader, size int64) error
	Download(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
	List(ctx context.Context, prefix string) ([]string, error)
	Name() string
}

// NewProvider creates a storage provider from config.
func NewProvider(providerType string, configJSON json.RawMessage) (StorageProvider, error) {
	switch providerType {
	case "local":
		var cfg LocalConfig
		if len(configJSON) > 0 {
			if err := json.Unmarshal(configJSON, &cfg); err != nil {
				return nil, fmt.Errorf("parse local config: %w", err)
			}
		}
		if cfg.Path == "" {
			cfg.Path = "/data/backups"
		}
		return NewLocalStorage(cfg), nil
	case "s3":
		var cfg S3Config
		if err := json.Unmarshal(configJSON, &cfg); err != nil {
			return nil, fmt.Errorf("parse s3 config: %w", err)
		}
		return NewS3Storage(cfg)
	case "azure":
		var cfg AzureConfig
		if err := json.Unmarshal(configJSON, &cfg); err != nil {
			return nil, fmt.Errorf("parse azure config: %w", err)
		}
		return NewAzureStorage(cfg)
	case "gcs":
		var cfg GCSConfig
		if err := json.Unmarshal(configJSON, &cfg); err != nil {
			return nil, fmt.Errorf("parse gcs config: %w", err)
		}
		return NewGCSStorage(cfg)
	default:
		return nil, fmt.Errorf("unsupported provider: %s", providerType)
	}
}

// ── Local Storage ──────────────────────────────────────────────

type LocalConfig struct {
	Path string `json:"path"`
}

type LocalStorage struct {
	basePath string
}

func NewLocalStorage(cfg LocalConfig) *LocalStorage {
	return &LocalStorage{basePath: cfg.Path}
}

func (s *LocalStorage) Name() string { return "local" }

func (s *LocalStorage) Upload(ctx context.Context, key string, data io.Reader, size int64) error {
	fullPath := filepath.Join(s.basePath, key)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0750); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	f, err := os.Create(fullPath)
	if err != nil {
		return fmt.Errorf("create file: %w", err)
	}
	defer f.Close()
	if _, err := io.Copy(f, data); err != nil {
		return fmt.Errorf("write file: %w", err)
	}
	return nil
}

func (s *LocalStorage) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	return os.Open(filepath.Join(s.basePath, key))
}

func (s *LocalStorage) Delete(ctx context.Context, key string) error {
	return os.Remove(filepath.Join(s.basePath, key))
}

func (s *LocalStorage) List(ctx context.Context, prefix string) ([]string, error) {
	var files []string
	dir := filepath.Join(s.basePath, prefix)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return files, nil
		}
		return nil, err
	}
	for _, e := range entries {
		if !e.IsDir() {
			files = append(files, filepath.Join(prefix, e.Name()))
		}
	}
	return files, nil
}

// ── S3 Storage (stub — real impl needs AWS SDK) ─────────────

type S3Config struct {
	Bucket    string `json:"bucket"`
	Region    string `json:"region"`
	AccessKey string `json:"access_key"`
	SecretKey string `json:"secret_key"`
	Endpoint  string `json:"endpoint,omitempty"` // for MinIO/R2
	Prefix    string `json:"prefix,omitempty"`
}

type S3Storage struct {
	cfg S3Config
}

func NewS3Storage(cfg S3Config) (*S3Storage, error) {
	return &S3Storage{cfg: cfg}, nil
}

func (s *S3Storage) Name() string { return "s3" }

func (s *S3Storage) Upload(ctx context.Context, key string, data io.Reader, size int64) error {
	// TODO: Implement with AWS SDK v2
	return fmt.Errorf("S3 upload not yet implemented — install aws-sdk-go-v2 and configure")
}

func (s *S3Storage) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	return nil, fmt.Errorf("S3 download not yet implemented")
}

func (s *S3Storage) Delete(ctx context.Context, key string) error {
	return fmt.Errorf("S3 delete not yet implemented")
}

func (s *S3Storage) List(ctx context.Context, prefix string) ([]string, error) {
	return nil, fmt.Errorf("S3 list not yet implemented")
}

// ── Azure Blob Storage (stub) ──────────────────────────────

type AzureConfig struct {
	AccountName   string `json:"account_name"`
	AccountKey    string `json:"account_key"`
	ContainerName string `json:"container_name"`
	Prefix        string `json:"prefix,omitempty"`
}

type AzureStorage struct {
	cfg AzureConfig
}

func NewAzureStorage(cfg AzureConfig) (*AzureStorage, error) {
	return &AzureStorage{cfg: cfg}, nil
}

func (s *AzureStorage) Name() string { return "azure" }

func (s *AzureStorage) Upload(ctx context.Context, key string, data io.Reader, size int64) error {
	return fmt.Errorf("Azure Blob upload not yet implemented — install azblob SDK")
}

func (s *AzureStorage) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	return nil, fmt.Errorf("Azure Blob download not yet implemented")
}

func (s *AzureStorage) Delete(ctx context.Context, key string) error {
	return fmt.Errorf("Azure Blob delete not yet implemented")
}

func (s *AzureStorage) List(ctx context.Context, prefix string) ([]string, error) {
	return nil, fmt.Errorf("Azure Blob list not yet implemented")
}

// ── Google Cloud Storage (stub) ────────────────────────────

type GCSConfig struct {
	Bucket          string `json:"bucket"`
	CredentialsJSON string `json:"credentials_json,omitempty"` // service account JSON
	Prefix          string `json:"prefix,omitempty"`
}

type GCSStorage struct {
	cfg GCSConfig
}

func NewGCSStorage(cfg GCSConfig) (*GCSStorage, error) {
	return &GCSStorage{cfg: cfg}, nil
}

func (s *GCSStorage) Name() string { return "gcs" }

func (s *GCSStorage) Upload(ctx context.Context, key string, data io.Reader, size int64) error {
	return fmt.Errorf("GCS upload not yet implemented — install cloud.google.com/go/storage")
}

func (s *GCSStorage) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	return nil, fmt.Errorf("GCS download not yet implemented")
}

func (s *GCSStorage) Delete(ctx context.Context, key string) error {
	return fmt.Errorf("GCS delete not yet implemented")
}

func (s *GCSStorage) List(ctx context.Context, prefix string) ([]string, error) {
	return nil, fmt.Errorf("GCS list not yet implemented")
}
