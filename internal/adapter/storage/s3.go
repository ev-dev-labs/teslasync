package storage

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// S3Provider implements external.StorageProvider using AWS S3.
type S3Provider struct {
	client    *s3.Client
	presigner *s3.PresignClient
	bucket    string
}

// NewS3Provider creates a new S3 storage provider.
func NewS3Provider(ctx context.Context, bucket, region string) (*S3Provider, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("loading AWS config: %w", err)
	}

	client := s3.NewFromConfig(cfg)
	return &S3Provider{
		client:    client,
		presigner: s3.NewPresignClient(client),
		bucket:    bucket,
	}, nil
}

func (p *S3Provider) Upload(ctx context.Context, key string, reader io.Reader) (string, error) {
	_, err := p.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
		Body:   reader,
	})
	if err != nil {
		return "", fmt.Errorf("uploading to S3 key %s: %w", key, err)
	}
	return fmt.Sprintf("s3://%s/%s", p.bucket, key), nil
}

func (p *S3Provider) GetSignedURL(ctx context.Context, key string, expiry time.Duration) (string, error) {
	result, err := p.presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("generating signed URL for %s: %w", key, err)
	}
	return result.URL, nil
}

func (p *S3Provider) Delete(ctx context.Context, key string) error {
	_, err := p.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(p.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("deleting S3 key %s: %w", key, err)
	}
	return nil
}
