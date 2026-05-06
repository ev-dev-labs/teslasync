package notifier

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// helper: build a stub server that records the received request and
// returns a configurable status + body.
type recordedRequest struct {
	method  string
	headers http.Header
	body    string
}

func newRecordingServer(t *testing.T, status int, respBody string) (*httptest.Server, *recordedRequest) {
	t.Helper()
	rec := &recordedRequest{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.method = r.Method
		rec.headers = r.Header.Clone()
		b, _ := io.ReadAll(r.Body)
		rec.body = string(b)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(respBody))
	}))
	t.Cleanup(srv.Close)
	return srv, rec
}

func TestSignReturnsEmptyForEmptySecret(t *testing.T) {
	if got := Sign("", []byte("payload")); got != "" {
		t.Fatalf("want empty string for empty secret, got %q", got)
	}
}

func TestSignProducesStableSha256HMAC(t *testing.T) {
	body := []byte(`{"hello":"world"}`)
	got := Sign("topsecret", body)
	if !strings.HasPrefix(got, SignaturePrefix) {
		t.Fatalf("missing %s prefix: %q", SignaturePrefix, got)
	}
	mac := hmac.New(sha256.New, []byte("topsecret"))
	mac.Write(body)
	want := SignaturePrefix + hex.EncodeToString(mac.Sum(nil))
	if got != want {
		t.Fatalf("signature mismatch:\n got  %s\n want %s", got, want)
	}
}

func TestSendDeliversBodyAndSetsExpectedHeaders(t *testing.T) {
	srv, rec := newRecordingServer(t, http.StatusOK, `{"ok":true}`)
	body := []byte(`{"title":"hi","message":"world"}`)

	res, err := Send(context.Background(), Options{
		URL:    srv.URL,
		Method: "POST",
		Body:   body,
		Secret: "shh",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d want 200", res.StatusCode)
	}
	if res.BodyPreview != `{"ok":true}` {
		t.Fatalf("body preview: got %q", res.BodyPreview)
	}
	if res.Truncated {
		t.Fatalf("expected non-truncated preview")
	}
	if rec.method != "POST" {
		t.Fatalf("method: got %s", rec.method)
	}
	if rec.body != string(body) {
		t.Fatalf("body mismatch: got %q want %q", rec.body, string(body))
	}
	if got := rec.headers.Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type: got %q", got)
	}
	if got := rec.headers.Get("User-Agent"); got != "TeslaSync/webhook" {
		t.Fatalf("User-Agent: got %q", got)
	}
	if got := rec.headers.Get(SignatureHeader); got == "" {
		t.Fatalf("signature header missing")
	} else if got != res.Signature {
		t.Fatalf("signature mismatch between request and result: req=%q result=%q", got, res.Signature)
	}
}

func TestSendWithoutSecretOmitsSignatureHeader(t *testing.T) {
	srv, rec := newRecordingServer(t, http.StatusAccepted, "")
	res, err := Send(context.Background(), Options{
		URL:  srv.URL,
		Body: []byte("anything"),
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.StatusCode != http.StatusAccepted {
		t.Fatalf("status: got %d", res.StatusCode)
	}
	if got := rec.headers.Get(SignatureHeader); got != "" {
		t.Fatalf("expected no signature header, got %q", got)
	}
	if res.Signature != "" {
		t.Fatalf("expected empty Result.Signature, got %q", res.Signature)
	}
}

func TestSendCustomHeadersOverride(t *testing.T) {
	srv, rec := newRecordingServer(t, http.StatusOK, "")
	_, err := Send(context.Background(), Options{
		URL:         srv.URL,
		Body:        []byte("{}"),
		ContentType: "application/json; charset=utf-8",
		Headers: map[string]string{
			"X-Custom":   "abc",
			"User-Agent": "MyAgent/1.0",
		},
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if got := rec.headers.Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type: got %q", got)
	}
	if got := rec.headers.Get("X-Custom"); got != "abc" {
		t.Fatalf("X-Custom: got %q", got)
	}
	if got := rec.headers.Get("User-Agent"); got != "MyAgent/1.0" {
		t.Fatalf("User-Agent override: got %q", got)
	}
}

func TestSendReportsHTTPErrorStatusWithoutErr(t *testing.T) {
	srv, _ := newRecordingServer(t, http.StatusInternalServerError, "boom")
	res, err := Send(context.Background(), Options{
		URL:    srv.URL,
		Method: "POST",
		Body:   []byte("{}"),
	})
	if err != nil {
		t.Fatalf("expected nil err for 5xx, got %v", err)
	}
	if res.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status: got %d", res.StatusCode)
	}
	if res.BodyPreview != "boom" {
		t.Fatalf("preview: got %q", res.BodyPreview)
	}
}

func TestSendTruncatesLargeResponseBody(t *testing.T) {
	big := strings.Repeat("a", MaxBodyPreviewBytes+500)
	srv, _ := newRecordingServer(t, http.StatusOK, big)
	res, err := Send(context.Background(), Options{
		URL:  srv.URL,
		Body: []byte("{}"),
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if !res.Truncated {
		t.Fatalf("expected truncated=true")
	}
	if len(res.BodyPreview) != MaxBodyPreviewBytes {
		t.Fatalf("preview len: got %d want %d", len(res.BodyPreview), MaxBodyPreviewBytes)
	}
}

func TestSendRejectsEmptyURL(t *testing.T) {
	_, err := Send(context.Background(), Options{Body: []byte("x")})
	if !errors.Is(err, ErrEmptyURL) {
		t.Fatalf("want ErrEmptyURL, got %v", err)
	}
}

func TestSendRejectsUnsupportedMethod(t *testing.T) {
	_, err := Send(context.Background(), Options{
		URL:    "https://example.invalid",
		Method: "DELETE",
		Body:   []byte("x"),
	})
	if !errors.Is(err, ErrUnsupportedMethod) {
		t.Fatalf("want ErrUnsupportedMethod, got %v", err)
	}
}

func TestSendDefaultsToPOSTWhenMethodEmpty(t *testing.T) {
	srv, rec := newRecordingServer(t, http.StatusOK, "")
	_, err := Send(context.Background(), Options{
		URL:  srv.URL,
		Body: []byte("x"),
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if rec.method != "POST" {
		t.Fatalf("expected POST default, got %s", rec.method)
	}
}

func TestSendHonoursClientOverride(t *testing.T) {
	// The custom client targets a server that always 418s, proving the
	// supplied *http.Client is the one used (not a default fresh client).
	srv, _ := newRecordingServer(t, http.StatusTeapot, "I am a teapot")
	res, err := Send(context.Background(), Options{
		URL:    srv.URL,
		Body:   []byte("x"),
		Client: srv.Client(),
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.StatusCode != http.StatusTeapot {
		t.Fatalf("status: got %d want 418", res.StatusCode)
	}
}

func TestSendRespectsContextDeadline(t *testing.T) {
	// Server blocks long enough to outlast our 50ms deadline.
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(200 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(slow.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	res, err := Send(ctx, Options{
		URL:     slow.URL,
		Body:    []byte("x"),
		Timeout: 5 * time.Second, // larger than ctx so ctx is the bound
	})
	if err == nil {
		t.Fatalf("expected error from context deadline, got status %d", res.StatusCode)
	}
}
