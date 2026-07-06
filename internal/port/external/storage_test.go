package external_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/port/external"
)

// fakeStorageProvider is a concurrency-safe in-memory StorageProvider test
// double. It stores uploaded bytes under their key so signed-URL and delete
// semantics can be exercised without a real S3 client.
type fakeStorageProvider struct {
	mu        sync.Mutex
	objects   map[string][]byte
	uploadErr error
	signErr   error
	deleteErr error
}

func newFakeStorage() *fakeStorageProvider {
	return &fakeStorageProvider{objects: make(map[string][]byte)}
}

func (f *fakeStorageProvider) Upload(ctx context.Context, key string, reader io.Reader) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if f.uploadErr != nil {
		return "", f.uploadErr
	}
	data, err := io.ReadAll(reader)
	if err != nil {
		return "", fmt.Errorf("read upload body for %q: %w", key, err)
	}
	f.mu.Lock()
	f.objects[key] = data
	f.mu.Unlock()
	return "mem://" + key, nil
}

func (f *fakeStorageProvider) GetSignedURL(ctx context.Context, key string, expiry time.Duration) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if f.signErr != nil {
		return "", f.signErr
	}
	f.mu.Lock()
	_, ok := f.objects[key]
	f.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("key %q not found", key)
	}
	return fmt.Sprintf("mem://%s?expiry=%s", key, expiry), nil
}

func (f *fakeStorageProvider) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if f.deleteErr != nil {
		return f.deleteErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.objects[key]; !ok {
		return fmt.Errorf("key %q not found", key)
	}
	delete(f.objects, key)
	return nil
}

func (f *fakeStorageProvider) has(key string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.objects[key]
	return ok
}

func (f *fakeStorageProvider) content(key string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return string(f.objects[key])
}

// errReader always fails, to exercise the Upload read-error branch.
type errReader struct{ err error }

func (e errReader) Read([]byte) (int, error) { return 0, e.err }

// Compile-time assertion: the fake satisfies the port.
var _ external.StorageProvider = (*fakeStorageProvider)(nil)

func TestStorageProviderContract(t *testing.T) {
	t.Parallel()
	assertInterface(t, reflect.TypeOf((*external.StorageProvider)(nil)).Elem(), []methodSig{
		{
			name: "Upload",
			in:   []reflect.Type{ctxType, stringType, ioReaderType},
			out:  []reflect.Type{stringType, errType},
		},
		{
			name: "GetSignedURL",
			in:   []reflect.Type{ctxType, stringType, durationType},
			out:  []reflect.Type{stringType, errType},
		},
		{
			name: "Delete",
			in:   []reflect.Type{ctxType, stringType},
			out:  []reflect.Type{errType},
		},
	})
}

func TestFakeStorageProviderRoundTrip(t *testing.T) {
	t.Parallel()
	s := newFakeStorage()
	ctx := context.Background()
	const key = "exports/report-2026.csv"
	const body = "vin,drive_id,distance_m\n5YJ,1,1000"

	url, err := s.Upload(ctx, key, strings.NewReader(body))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if want := "mem://" + key; url != want {
		t.Errorf("Upload url = %q, want %q", url, want)
	}
	if got := s.content(key); got != body {
		t.Errorf("stored content = %q, want %q", got, body)
	}

	signed, err := s.GetSignedURL(ctx, key, time.Minute)
	if err != nil {
		t.Fatalf("GetSignedURL: %v", err)
	}
	if !strings.HasPrefix(signed, "mem://"+key) || !strings.Contains(signed, "expiry=1m0s") {
		t.Errorf("signed url = %q, want prefix+expiry", signed)
	}

	if err := s.Delete(ctx, key); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if s.has(key) {
		t.Error("object still present after Delete")
	}
}

func TestFakeStorageProviderErrorPaths(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	t.Run("sign missing key", func(t *testing.T) {
		s := newFakeStorage()
		if _, err := s.GetSignedURL(ctx, "absent", time.Second); err == nil {
			t.Error("GetSignedURL(absent): want error, got nil")
		}
	})

	t.Run("delete missing key", func(t *testing.T) {
		s := newFakeStorage()
		if err := s.Delete(ctx, "absent"); err == nil {
			t.Error("Delete(absent): want error, got nil")
		}
	})

	t.Run("upload read error is wrapped", func(t *testing.T) {
		s := newFakeStorage()
		sentinel := errors.New("disk failure")
		_, err := s.Upload(ctx, "k", errReader{err: sentinel})
		if !errors.Is(err, sentinel) {
			t.Errorf("Upload err = %v, want wrapped %v", err, sentinel)
		}
		if s.has("k") {
			t.Error("failed upload must not persist an object")
		}
	})

	t.Run("injected upload error", func(t *testing.T) {
		s := newFakeStorage()
		sentinel := errors.New("s3 unavailable")
		s.uploadErr = sentinel
		if _, err := s.Upload(ctx, "k", strings.NewReader("x")); !errors.Is(err, sentinel) {
			t.Errorf("Upload err = %v, want %v", err, sentinel)
		}
	})

	t.Run("cancelled context aborts each op", func(t *testing.T) {
		s := newFakeStorage()
		cctx := cancelledContext()
		if _, err := s.Upload(cctx, "k", strings.NewReader("x")); !errors.Is(err, context.Canceled) {
			t.Errorf("Upload err = %v, want context.Canceled", err)
		}
		if _, err := s.GetSignedURL(cctx, "k", time.Second); !errors.Is(err, context.Canceled) {
			t.Errorf("GetSignedURL err = %v, want context.Canceled", err)
		}
		if err := s.Delete(cctx, "k"); !errors.Is(err, context.Canceled) {
			t.Errorf("Delete err = %v, want context.Canceled", err)
		}
	})
}
