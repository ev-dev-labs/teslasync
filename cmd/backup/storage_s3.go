package main

import (
	"context"
	"fmt"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/rs/zerolog/log"
)

// s3Uploader publishes the dump + manifest to any S3-compatible object
// store. Tested against AWS S3, MinIO, Backblaze B2 (S3 API), Cloudflare
// R2, and Wasabi. The endpoint + path-style toggles make all four work
// from the same code path.
type s3Uploader struct {
	cfg    *Config
	client *s3.Client
}

func newS3Uploader(cfg *Config) (*s3Uploader, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithRegion(cfg.S3Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.S3AccessKey, cfg.S3SecretKey, "",
		)),
	)
	if err != nil {
		return nil, fmt.Errorf("aws config: %w", err)
	}

	opts := []func(*s3.Options){}
	if cfg.S3Endpoint != "" {
		opts = append(opts, func(o *s3.Options) {
			o.BaseEndpoint = aws.String(cfg.S3Endpoint)
		})
	}
	if cfg.S3UsePathStyle {
		opts = append(opts, func(o *s3.Options) {
			o.UsePathStyle = true
		})
	}

	client := s3.NewFromConfig(awsCfg, opts...)
	return &s3Uploader{cfg: cfg, client: client}, nil
}

func (u *s3Uploader) Upload(ctx context.Context, dumpPath, manifestPath string) error {
	for _, p := range []string{dumpPath, manifestPath} {
		if err := u.putObject(ctx, p); err != nil {
			return fmt.Errorf("put %s: %w", p, err)
		}
	}
	return nil
}

func (u *s3Uploader) putObject(ctx context.Context, localPath string) error {
	f, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		return err
	}
	key := path.Join(u.cfg.S3Prefix, path.Base(localPath))
	contentType := "application/octet-stream"
	if strings.HasSuffix(localPath, ".json") {
		contentType = "application/json"
	}

	_, err = u.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(u.cfg.S3Bucket),
		Key:           aws.String(key),
		Body:          f,
		ContentLength: aws.Int64(fi.Size()),
		ContentType:   aws.String(contentType),
	})
	if err != nil {
		return err
	}
	log.Info().Str("bucket", u.cfg.S3Bucket).Str("key", key).Int64("bytes", fi.Size()).Msg("s3 put complete")
	return nil
}

func (u *s3Uploader) EnforceRetention(ctx context.Context, daily, weekly int) error {
	if daily <= 0 && weekly <= 0 {
		return nil
	}

	type obj struct {
		key  string
		mod  time.Time
		size int64
	}
	var dumps []obj
	var continuation *string
	for {
		out, err := u.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket:            aws.String(u.cfg.S3Bucket),
			Prefix:            aws.String(u.cfg.S3Prefix),
			ContinuationToken: continuation,
		})
		if err != nil {
			return fmt.Errorf("list objects: %w", err)
		}
		for _, o := range out.Contents {
			if o.Key == nil || !strings.HasSuffix(*o.Key, ".dump") {
				continue
			}
			mod := time.Now()
			if o.LastModified != nil {
				mod = *o.LastModified
			}
			size := int64(0)
			if o.Size != nil {
				size = *o.Size
			}
			dumps = append(dumps, obj{key: *o.Key, mod: mod, size: size})
		}
		if out.IsTruncated == nil || !*out.IsTruncated {
			break
		}
		continuation = out.NextContinuationToken
	}

	sort.Slice(dumps, func(i, j int) bool { return dumps[i].mod.After(dumps[j].mod) })

	keep := map[string]bool{}
	for i := 0; i < daily && i < len(dumps); i++ {
		keep[dumps[i].key] = true
	}
	seenWeek := map[string]bool{}
	weeklyKept := 0
	for i := daily; i < len(dumps) && weeklyKept < weekly; i++ {
		y, w := dumps[i].mod.ISOWeek()
		k := fmt.Sprintf("%d-%02d", y, w)
		if seenWeek[k] {
			continue
		}
		seenWeek[k] = true
		keep[dumps[i].key] = true
		weeklyKept++
	}

	var toDelete []types.ObjectIdentifier
	for _, d := range dumps {
		if keep[d.key] {
			continue
		}
		toDelete = append(toDelete, types.ObjectIdentifier{Key: aws.String(d.key)})
		// Also remove the sidecar manifest.
		toDelete = append(toDelete, types.ObjectIdentifier{Key: aws.String(d.key + ".manifest.json")})
	}
	if len(toDelete) == 0 {
		return nil
	}

	// DeleteObjects caps at 1000 keys per request.
	for i := 0; i < len(toDelete); i += 1000 {
		end := i + 1000
		if end > len(toDelete) {
			end = len(toDelete)
		}
		batch := toDelete[i:end]
		_, err := u.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(u.cfg.S3Bucket),
			Delete: &types.Delete{Objects: batch, Quiet: aws.Bool(true)},
		})
		if err != nil {
			return fmt.Errorf("delete objects batch: %w", err)
		}
		log.Info().Int("count", len(batch)).Msg("retention: pruned s3 objects")
	}
	return nil
}
