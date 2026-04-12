package external

import (
	"context"
	"io"
	"time"
)

// StorageProvider defines the interface for object storage operations.
type StorageProvider interface {
	Upload(ctx context.Context, key string, reader io.Reader) (string, error)
	GetSignedURL(ctx context.Context, key string, expiry time.Duration) (string, error)
	Delete(ctx context.Context, key string) error
}
