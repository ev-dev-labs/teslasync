package storage

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// s3PutDeleteAPI is the narrow subset of *s3.Client that S3Provider needs.
// Depending on this interface (rather than the concrete client) keeps the
// adapter unit-testable with in-package fakes and no network — *s3.Client
// satisfies it.
type s3PutDeleteAPI interface {
	PutObject(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.Options)) (*s3.PutObjectOutput, error)
	DeleteObject(ctx context.Context, params *s3.DeleteObjectInput, optFns ...func(*s3.Options)) (*s3.DeleteObjectOutput, error)
}

// s3PresignAPI is the narrow subset of *s3.PresignClient that S3Provider needs.
// *s3.PresignClient satisfies it.
type s3PresignAPI interface {
	PresignGetObject(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error)
}

// S3Provider implements external.StorageProvider using AWS S3.
type S3Provider struct {
	client    s3PutDeleteAPI
	presigner s3PresignAPI
	bucket    string
}

// NewS3Provider builds an S3-backed StorageProvider for the given bucket and
// region. The bucket must be non-empty. Outbound requests are traced via
// otelhttp so S3 calls appear in the distributed trace (ADR-008 #3).
func NewS3Provider(ctx context.Context, bucket, region string) (*S3Provider, error) {
	bucket = strings.TrimSpace(bucket)
	if bucket == "" {
		return nil, fmt.Errorf("s3 provider: bucket is required")
	}

	cfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(strings.TrimSpace(region)),
		awsconfig.WithHTTPClient(&http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}),
	)
	if err != nil {
		return nil, fmt.Errorf("s3 provider: load AWS config: %w", err)
	}

	client := s3.NewFromConfig(cfg)
	return &S3Provider{
		client:    client,
		presigner: s3.NewPresignClient(client),
		bucket:    bucket,
	}, nil
}

// Upload streams reader to the object at key and returns its s3:// URI.
func (p *S3Provider) Upload(ctx context.Context, key string, reader io.Reader) (string, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return "", fmt.Errorf("s3 upload: key is required")
	}
	if reader == nil {
		return "", fmt.Errorf("s3 upload key %s: reader is nil", key)
	}

	if _, err := p.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
		Body:   reader,
	}); err != nil {
		return "", fmt.Errorf("s3 upload key %s: %w", key, err)
	}

	uri := fmt.Sprintf("s3://%s/%s", p.bucket, key)
	log.Debug().Str("bucket", p.bucket).Str("key", key).Msg("s3 provider: object uploaded")
	return uri, nil
}

// GetSignedURL returns a time-limited presigned GET URL for key. expiry must
// be positive.
func (p *S3Provider) GetSignedURL(ctx context.Context, key string, expiry time.Duration) (string, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return "", fmt.Errorf("s3 signed url: key is required")
	}
	if expiry <= 0 {
		return "", fmt.Errorf("s3 signed url key %s: expiry must be positive, got %s", key, expiry)
	}

	result, err := p.presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("s3 signed url key %s: %w", key, err)
	}
	if result == nil {
		return "", fmt.Errorf("s3 signed url key %s: nil presign result", key)
	}

	log.Debug().Str("bucket", p.bucket).Str("key", key).Dur("expiry", expiry).Msg("s3 provider: signed url generated")
	return result.URL, nil
}

// Delete removes the object at key. Deleting a missing key is a no-op on S3.
func (p *S3Provider) Delete(ctx context.Context, key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return fmt.Errorf("s3 delete: key is required")
	}

	if _, err := p.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
	}); err != nil {
		return fmt.Errorf("s3 delete key %s: %w", key, err)
	}

	log.Debug().Str("bucket", p.bucket).Str("key", key).Msg("s3 provider: object deleted")
	return nil
}
