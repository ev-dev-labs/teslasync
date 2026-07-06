package storage

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/ev-dev-labs/teslasync/internal/port/external"
)

// ── Static guarantees ──────────────────────────────────────────────────────
// These compile-time assertions are the backbone of the interface-seam
// refactor: the concrete AWS SDK types MUST keep satisfying the narrow ports,
// and S3Provider MUST keep satisfying the external.StorageProvider contract.
var (
	_ external.StorageProvider = (*S3Provider)(nil)
	_ s3PutDeleteAPI           = (*s3.Client)(nil)
	_ s3PresignAPI             = (*s3.PresignClient)(nil)
)

var errBoom = errors.New("boom")

// ── Fakes ──────────────────────────────────────────────────────────────────

// fakeS3Client is a white-box fake for s3PutDeleteAPI. It records call counts,
// the received context, the last inputs, and the drained upload body so tests
// can assert exactly what was sent to S3.
type fakeS3Client struct {
	putOut *s3.PutObjectOutput
	putErr error
	delOut *s3.DeleteObjectOutput
	delErr error

	putCalls int
	delCalls int
	lastPut  *s3.PutObjectInput
	lastDel  *s3.DeleteObjectInput
	lastCtx  context.Context
	putBody  []byte
}

func (f *fakeS3Client) PutObject(ctx context.Context, in *s3.PutObjectInput, _ ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	f.putCalls++
	f.lastPut = in
	f.lastCtx = ctx
	if in != nil && in.Body != nil {
		f.putBody, _ = io.ReadAll(in.Body)
	}
	if f.putErr != nil {
		return nil, f.putErr
	}
	if f.putOut != nil {
		return f.putOut, nil
	}
	return &s3.PutObjectOutput{}, nil
}

func (f *fakeS3Client) DeleteObject(ctx context.Context, in *s3.DeleteObjectInput, _ ...func(*s3.Options)) (*s3.DeleteObjectOutput, error) {
	f.delCalls++
	f.lastDel = in
	f.lastCtx = ctx
	if f.delErr != nil {
		return nil, f.delErr
	}
	if f.delOut != nil {
		return f.delOut, nil
	}
	return &s3.DeleteObjectOutput{}, nil
}

// fakePresigner is a white-box fake for s3PresignAPI. It applies the option
// functions to a real s3.PresignOptions so tests can assert the expiry that
// GetSignedURL forwarded.
type fakePresigner struct {
	out *v4.PresignedHTTPRequest
	err error

	calls      int
	lastGet    *s3.GetObjectInput
	lastCtx    context.Context
	lastExpiry time.Duration
}

func (f *fakePresigner) PresignGetObject(ctx context.Context, in *s3.GetObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
	f.calls++
	f.lastGet = in
	f.lastCtx = ctx
	var po s3.PresignOptions
	for _, fn := range optFns {
		fn(&po)
	}
	f.lastExpiry = po.Expires
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

func newTestProvider() (*S3Provider, *fakeS3Client, *fakePresigner) {
	c := &fakeS3Client{}
	pr := &fakePresigner{}
	return &S3Provider{client: c, presigner: pr, bucket: "test-bucket"}, c, pr
}

// ── NewS3Provider ──────────────────────────────────────────────────────────

func TestNewS3Provider(t *testing.T) {
	tests := []struct {
		name       string
		bucket     string
		region     string
		wantErr    bool
		wantBucket string
	}{
		{name: "valid", bucket: "my-bucket", region: "us-east-1", wantBucket: "my-bucket"},
		{name: "bucket trimmed", bucket: "  padded-bucket  ", region: "us-west-2", wantBucket: "padded-bucket"},
		{name: "empty region ok", bucket: "b", region: "", wantBucket: "b"},
		{name: "empty bucket rejected", bucket: "", region: "us-east-1", wantErr: true},
		{name: "whitespace bucket rejected", bucket: "   ", region: "us-east-1", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p, err := NewS3Provider(context.Background(), tc.bucket, tc.region)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (provider=%v)", p)
				}
				if p != nil {
					t.Errorf("expected nil provider on error, got %v", p)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if p == nil {
				t.Fatal("expected non-nil provider")
			}
			if p.bucket != tc.wantBucket {
				t.Errorf("bucket = %q, want %q", p.bucket, tc.wantBucket)
			}
			if p.client == nil || p.presigner == nil {
				t.Error("expected client and presigner to be wired")
			}
		})
	}
}

// ── Upload ─────────────────────────────────────────────────────────────────

func TestS3Provider_Upload(t *testing.T) {
	tests := []struct {
		name         string
		key          string
		body         string
		nilReader    bool
		providerErr  error
		wantErr      bool
		wantErrIs    error
		wantErrHas   string
		wantURI      string
		wantSentKey  string
		wantCalled   bool
		wantSentBody string
	}{
		{
			name:         "success",
			key:          "exports/report.csv",
			body:         "id,name\n1,tesla",
			wantURI:      "s3://test-bucket/exports/report.csv",
			wantSentKey:  "exports/report.csv",
			wantCalled:   true,
			wantSentBody: "id,name\n1,tesla",
		},
		{
			name:         "key trimmed before send",
			key:          "  exports/f.json  ",
			body:         "{}",
			wantURI:      "s3://test-bucket/exports/f.json",
			wantSentKey:  "exports/f.json",
			wantCalled:   true,
			wantSentBody: "{}",
		},
		{
			name:        "empty body still uploads",
			key:         "empty.bin",
			body:        "",
			wantURI:     "s3://test-bucket/empty.bin",
			wantSentKey: "empty.bin",
			wantCalled:  true,
		},
		{
			name:       "empty key rejected without calling s3",
			key:        "",
			body:       "x",
			wantErr:    true,
			wantErrHas: "key is required",
		},
		{
			name:       "whitespace key rejected",
			key:        "   ",
			body:       "x",
			wantErr:    true,
			wantErrHas: "key is required",
		},
		{
			name:       "nil reader rejected",
			key:        "k",
			nilReader:  true,
			wantErr:    true,
			wantErrHas: "reader is nil",
		},
		{
			name:        "provider error wrapped",
			key:         "k",
			body:        "x",
			providerErr: errBoom,
			wantErr:     true,
			wantErrIs:   errBoom,
			wantErrHas:  "s3 upload key k",
			wantCalled:  true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p, client, _ := newTestProvider()
			client.putErr = tc.providerErr

			var reader io.Reader
			if !tc.nilReader {
				reader = strings.NewReader(tc.body)
			}

			uri, err := p.Upload(context.Background(), tc.key, reader)

			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (uri=%q)", uri)
				}
				if uri != "" {
					t.Errorf("expected empty uri on error, got %q", uri)
				}
				if tc.wantErrIs != nil && !errors.Is(err, tc.wantErrIs) {
					t.Errorf("error %v does not wrap %v", err, tc.wantErrIs)
				}
				if tc.wantErrHas != "" && !strings.Contains(err.Error(), tc.wantErrHas) {
					t.Errorf("error %q missing %q", err.Error(), tc.wantErrHas)
				}
			} else {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if uri != tc.wantURI {
					t.Errorf("uri = %q, want %q", uri, tc.wantURI)
				}
			}

			if tc.wantCalled {
				if client.putCalls != 1 {
					t.Fatalf("PutObject calls = %d, want 1", client.putCalls)
				}
				if got := deref(client.lastPut.Bucket); got != "test-bucket" {
					t.Errorf("bucket sent = %q, want test-bucket", got)
				}
				if tc.wantSentKey != "" {
					if got := deref(client.lastPut.Key); got != tc.wantSentKey {
						t.Errorf("key sent = %q, want %q", got, tc.wantSentKey)
					}
				}
				if tc.wantSentBody != "" && string(client.putBody) != tc.wantSentBody {
					t.Errorf("body sent = %q, want %q", string(client.putBody), tc.wantSentBody)
				}
			} else if client.putCalls != 0 {
				t.Errorf("expected S3 not called, but PutObject calls = %d", client.putCalls)
			}
		})
	}
}

func TestS3Provider_Upload_ContextPropagated(t *testing.T) {
	p, client, _ := newTestProvider()
	type ctxKey string
	ctx := context.WithValue(context.Background(), ctxKey("k"), "v")

	if _, err := p.Upload(ctx, "k", strings.NewReader("x")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client.lastCtx == nil || client.lastCtx.Value(ctxKey("k")) != "v" {
		t.Error("Upload did not forward the caller context to PutObject")
	}
}

// ── GetSignedURL ───────────────────────────────────────────────────────────

func TestS3Provider_GetSignedURL(t *testing.T) {
	tests := []struct {
		name        string
		key         string
		expiry      time.Duration
		presignURL  string
		nilResult   bool
		providerErr error
		wantErr     bool
		wantErrIs   error
		wantErrHas  string
		wantURL     string
		wantSentKey string
		wantCalled  bool
	}{
		{
			name:        "success",
			key:         "exports/report.csv",
			expiry:      15 * time.Minute,
			presignURL:  "https://s3.example/signed?sig=abc",
			wantURL:     "https://s3.example/signed?sig=abc",
			wantSentKey: "exports/report.csv",
			wantCalled:  true,
		},
		{
			name:        "key trimmed before send",
			key:         "  a/b.csv  ",
			expiry:      time.Hour,
			presignURL:  "https://signed",
			wantURL:     "https://signed",
			wantSentKey: "a/b.csv",
			wantCalled:  true,
		},
		{
			name:       "empty key rejected",
			key:        "",
			expiry:     time.Minute,
			wantErr:    true,
			wantErrHas: "key is required",
		},
		{
			name:       "zero expiry rejected",
			key:        "k",
			expiry:     0,
			wantErr:    true,
			wantErrHas: "expiry must be positive",
		},
		{
			name:       "negative expiry rejected",
			key:        "k",
			expiry:     -5 * time.Second,
			wantErr:    true,
			wantErrHas: "expiry must be positive",
		},
		{
			name:        "provider error wrapped",
			key:         "k",
			expiry:      time.Minute,
			providerErr: errBoom,
			wantErr:     true,
			wantErrIs:   errBoom,
			wantErrHas:  "s3 signed url key k",
			wantCalled:  true,
		},
		{
			name:       "nil presign result rejected",
			key:        "k",
			expiry:     time.Minute,
			nilResult:  true,
			wantErr:    true,
			wantErrHas: "nil presign result",
			wantCalled: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p, _, presigner := newTestProvider()
			presigner.err = tc.providerErr
			if !tc.nilResult && tc.providerErr == nil {
				presigner.out = &v4.PresignedHTTPRequest{URL: tc.presignURL}
			}

			url, err := p.GetSignedURL(context.Background(), tc.key, tc.expiry)

			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (url=%q)", url)
				}
				if url != "" {
					t.Errorf("expected empty url on error, got %q", url)
				}
				if tc.wantErrIs != nil && !errors.Is(err, tc.wantErrIs) {
					t.Errorf("error %v does not wrap %v", err, tc.wantErrIs)
				}
				if tc.wantErrHas != "" && !strings.Contains(err.Error(), tc.wantErrHas) {
					t.Errorf("error %q missing %q", err.Error(), tc.wantErrHas)
				}
			} else {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if url != tc.wantURL {
					t.Errorf("url = %q, want %q", url, tc.wantURL)
				}
			}

			if tc.wantCalled {
				if presigner.calls != 1 {
					t.Fatalf("PresignGetObject calls = %d, want 1", presigner.calls)
				}
				if got := deref(presigner.lastGet.Bucket); got != "test-bucket" {
					t.Errorf("bucket sent = %q, want test-bucket", got)
				}
				if tc.wantSentKey != "" {
					if got := deref(presigner.lastGet.Key); got != tc.wantSentKey {
						t.Errorf("key sent = %q, want %q", got, tc.wantSentKey)
					}
					if presigner.lastExpiry != tc.expiry {
						t.Errorf("expiry forwarded = %s, want %s", presigner.lastExpiry, tc.expiry)
					}
				}
			} else if presigner.calls != 0 {
				t.Errorf("expected presigner not called, but calls = %d", presigner.calls)
			}
		})
	}
}

// ── Delete ─────────────────────────────────────────────────────────────────

func TestS3Provider_Delete(t *testing.T) {
	tests := []struct {
		name        string
		key         string
		providerErr error
		wantErr     bool
		wantErrIs   error
		wantErrHas  string
		wantSentKey string
		wantCalled  bool
	}{
		{
			name:        "success",
			key:         "exports/old.csv",
			wantSentKey: "exports/old.csv",
			wantCalled:  true,
		},
		{
			name:        "key trimmed before send",
			key:         "  exports/old.csv  ",
			wantSentKey: "exports/old.csv",
			wantCalled:  true,
		},
		{
			name:       "empty key rejected",
			key:        "",
			wantErr:    true,
			wantErrHas: "key is required",
		},
		{
			name:       "whitespace key rejected",
			key:        "  ",
			wantErr:    true,
			wantErrHas: "key is required",
		},
		{
			name:        "provider error wrapped",
			key:         "k",
			providerErr: errBoom,
			wantErr:     true,
			wantErrIs:   errBoom,
			wantErrHas:  "s3 delete key k",
			wantSentKey: "k",
			wantCalled:  true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p, client, _ := newTestProvider()
			client.delErr = tc.providerErr

			err := p.Delete(context.Background(), tc.key)

			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				if tc.wantErrIs != nil && !errors.Is(err, tc.wantErrIs) {
					t.Errorf("error %v does not wrap %v", err, tc.wantErrIs)
				}
				if tc.wantErrHas != "" && !strings.Contains(err.Error(), tc.wantErrHas) {
					t.Errorf("error %q missing %q", err.Error(), tc.wantErrHas)
				}
			} else if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if tc.wantCalled {
				if client.delCalls != 1 {
					t.Fatalf("DeleteObject calls = %d, want 1", client.delCalls)
				}
				if got := deref(client.lastDel.Bucket); got != "test-bucket" {
					t.Errorf("bucket sent = %q, want test-bucket", got)
				}
				if got := deref(client.lastDel.Key); got != tc.wantSentKey {
					t.Errorf("key sent = %q, want %q", got, tc.wantSentKey)
				}
			} else if client.delCalls != 0 {
				t.Errorf("expected S3 not called, but DeleteObject calls = %d", client.delCalls)
			}
		})
	}
}

// aws dereferences an *string returned by aws.String, tolerating nil.
func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
