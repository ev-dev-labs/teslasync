package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awscfg "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob"

	gcStorage "cloud.google.com/go/storage"
	"google.golang.org/api/option"
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

// ── S3 Storage ─────────────────────────────────────────────────

type S3Config struct {
	Bucket    string `json:"bucket"`
	Region    string `json:"region"`
	AccessKey string `json:"access_key"`
	SecretKey string `json:"secret_key"`
	Endpoint  string `json:"endpoint,omitempty"` // for MinIO/R2
	Prefix    string `json:"prefix,omitempty"`
}

type S3Storage struct {
	client *s3.Client
	bucket string
	prefix string
}

func NewS3Storage(cfg S3Config) (*S3Storage, error) {
	ctx := context.Background()
	optFns := []func(*awscfg.LoadOptions) error{
		awscfg.WithRegion(cfg.Region),
		awscfg.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, "")),
	}
	awsCfg, err := awscfg.LoadDefaultConfig(ctx, optFns...)
	if err != nil {
		return nil, fmt.Errorf("s3: load config: %w", err)
	}

	var s3Opts []func(*s3.Options)
	if cfg.Endpoint != "" {
		s3Opts = append(s3Opts, func(o *s3.Options) {
			o.BaseEndpoint = aws.String(cfg.Endpoint)
			o.UsePathStyle = true // required for MinIO
		})
	}

	return &S3Storage{
		client: s3.NewFromConfig(awsCfg, s3Opts...),
		bucket: cfg.Bucket,
		prefix: cfg.Prefix,
	}, nil
}

func (s *S3Storage) Name() string { return "s3" }

func (s *S3Storage) fullKey(key string) string {
	if s.prefix != "" {
		return s.prefix + "/" + key
	}
	return key
}

func (s *S3Storage) Upload(ctx context.Context, key string, data io.Reader, size int64) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(s.fullKey(key)),
		Body:          data,
		ContentLength: aws.Int64(size),
	})
	if err != nil {
		return fmt.Errorf("s3 upload: %w", err)
	}
	return nil
}

func (s *S3Storage) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.fullKey(key)),
	})
	if err != nil {
		return nil, fmt.Errorf("s3 download: %w", err)
	}
	return out.Body, nil
}

func (s *S3Storage) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.fullKey(key)),
	})
	if err != nil {
		return fmt.Errorf("s3 delete: %w", err)
	}
	return nil
}

func (s *S3Storage) List(ctx context.Context, prefix string) ([]string, error) {
	fullPrefix := s.fullKey(prefix)
	out, err := s.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket: aws.String(s.bucket),
		Prefix: aws.String(fullPrefix),
	})
	if err != nil {
		return nil, fmt.Errorf("s3 list: %w", err)
	}
	var keys []string
	for _, obj := range out.Contents {
		key := *obj.Key
		if s.prefix != "" {
			key = strings.TrimPrefix(key, s.prefix+"/")
		}
		keys = append(keys, key)
	}
	return keys, nil
}

// ── Azure Blob Storage ─────────────────────────────────────────

type AzureConfig struct {
	AccountName   string `json:"account_name"`
	AccountKey    string `json:"account_key"`
	ContainerName string `json:"container_name"`
	Prefix        string `json:"prefix,omitempty"`
}

type AzureStorage struct {
	client    *azblob.Client
	container string
	prefix    string
}

func NewAzureStorage(cfg AzureConfig) (*AzureStorage, error) {
	cred, err := azblob.NewSharedKeyCredential(cfg.AccountName, cfg.AccountKey)
	if err != nil {
		return nil, fmt.Errorf("azure: credential: %w", err)
	}
	serviceURL := fmt.Sprintf("https://%s.blob.core.windows.net", cfg.AccountName)
	client, err := azblob.NewClientWithSharedKeyCredential(serviceURL, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("azure: client: %w", err)
	}
	return &AzureStorage{
		client:    client,
		container: cfg.ContainerName,
		prefix:    cfg.Prefix,
	}, nil
}

func (s *AzureStorage) Name() string { return "azure" }

func (s *AzureStorage) fullKey(key string) string {
	if s.prefix != "" {
		return s.prefix + "/" + key
	}
	return key
}

func (s *AzureStorage) Upload(ctx context.Context, key string, data io.Reader, size int64) error {
	buf, err := io.ReadAll(data)
	if err != nil {
		return fmt.Errorf("azure: read data: %w", err)
	}
	_, err = s.client.UploadBuffer(ctx, s.container, s.fullKey(key), buf, nil)
	if err != nil {
		return fmt.Errorf("azure upload: %w", err)
	}
	return nil
}

func (s *AzureStorage) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	resp, err := s.client.DownloadStream(ctx, s.container, s.fullKey(key), nil)
	if err != nil {
		return nil, fmt.Errorf("azure download: %w", err)
	}
	return resp.Body, nil
}

func (s *AzureStorage) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteBlob(ctx, s.container, s.fullKey(key), nil)
	if err != nil {
		return fmt.Errorf("azure delete: %w", err)
	}
	return nil
}

func (s *AzureStorage) List(ctx context.Context, prefix string) ([]string, error) {
	fullPrefix := s.fullKey(prefix)
	pager := s.client.NewListBlobsFlatPager(s.container, &azblob.ListBlobsFlatOptions{
		Prefix: &fullPrefix,
	})
	var keys []string
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("azure list: %w", err)
		}
		for _, blob := range page.Segment.BlobItems {
			key := *blob.Name
			if s.prefix != "" {
				key = strings.TrimPrefix(key, s.prefix+"/")
			}
			keys = append(keys, key)
		}
	}
	return keys, nil
}

// ── Google Cloud Storage ───────────────────────────────────────

type GCSConfig struct {
	Bucket          string `json:"bucket"`
	CredentialsJSON string `json:"credentials_json,omitempty"`
	Prefix          string `json:"prefix,omitempty"`
}

type GCSStorage struct {
	client *gcStorage.Client
	bucket string
	prefix string
}

func NewGCSStorage(cfg GCSConfig) (*GCSStorage, error) {
	ctx := context.Background()
	var opts []option.ClientOption
	if cfg.CredentialsJSON != "" {
		opts = append(opts, option.WithCredentialsJSON([]byte(cfg.CredentialsJSON))) //nolint:staticcheck // WithCredentialsJSON works fine for service account JSON
	}
	client, err := gcStorage.NewClient(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("gcs: client: %w", err)
	}
	return &GCSStorage{
		client: client,
		bucket: cfg.Bucket,
		prefix: cfg.Prefix,
	}, nil
}

func (s *GCSStorage) Name() string { return "gcs" }

func (s *GCSStorage) fullKey(key string) string {
	if s.prefix != "" {
		return s.prefix + "/" + key
	}
	return key
}

func (s *GCSStorage) Upload(ctx context.Context, key string, data io.Reader, _ int64) error {
	wc := s.client.Bucket(s.bucket).Object(s.fullKey(key)).NewWriter(ctx)
	if _, err := io.Copy(wc, data); err != nil {
		wc.Close()
		return fmt.Errorf("gcs upload write: %w", err)
	}
	if err := wc.Close(); err != nil {
		return fmt.Errorf("gcs upload close: %w", err)
	}
	return nil
}

func (s *GCSStorage) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	r, err := s.client.Bucket(s.bucket).Object(s.fullKey(key)).NewReader(ctx)
	if err != nil {
		return nil, fmt.Errorf("gcs download: %w", err)
	}
	return r, nil
}

func (s *GCSStorage) Delete(ctx context.Context, key string) error {
	if err := s.client.Bucket(s.bucket).Object(s.fullKey(key)).Delete(ctx); err != nil {
		return fmt.Errorf("gcs delete: %w", err)
	}
	return nil
}

func (s *GCSStorage) List(ctx context.Context, prefix string) ([]string, error) {
	fullPrefix := s.fullKey(prefix)
	it := s.client.Bucket(s.bucket).Objects(ctx, &gcStorage.Query{Prefix: fullPrefix})
	var keys []string
	for {
		attrs, err := it.Next()
		if err != nil {
			break
		}
		key := attrs.Name
		if s.prefix != "" {
			key = strings.TrimPrefix(key, s.prefix+"/")
		}
		keys = append(keys, key)
	}
	return keys, nil
}
