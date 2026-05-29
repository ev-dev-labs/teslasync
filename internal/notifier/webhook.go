// Package notifier holds reusable outbound notification primitives that
// are decoupled from the historical [internal/notification] package.
//
// This package gives webhook delivery its own HMAC SHA-256 request
// signing and structured result (status + latency + body preview)
// without changing the legacy [internal/api/notification_handler]
// dispatch code used by other channel kinds.
//
// The body of every webhook delivery is a fixed JSON envelope today.
// Go text/template-based body templating is deferred because safely
// templating untrusted user input needs its own design.
package notifier

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// SignatureHeader is the HTTP header name used to convey the HMAC SHA-256
// signature of the request body. The value format mirrors GitHub's
// `X-Hub-Signature-256: sha256=<hex>` convention so existing webhook
// receivers (n8n, Home Assistant, custom scripts) can validate
// signatures with a familiar parser.
const SignatureHeader = "X-TeslaSync-Signature"

// SignaturePrefix is the prefix written before the hex digest in the
// SignatureHeader value. Receivers that strip the prefix and decode the
// remainder as hex get the raw HMAC bytes back.
const SignaturePrefix = "sha256="

// DefaultContentType is sent when [Options.ContentType] is empty.
const DefaultContentType = "application/json"

// DefaultTimeout is applied per-call when [Options.Timeout] is zero.
const DefaultTimeout = 10 * time.Second

// MaxBodyPreviewBytes caps the response-body preview returned in
// [Result.BodyPreview]. Webhook receivers occasionally return verbose
// debug payloads; truncating prevents the test endpoint from echoing
// arbitrarily large strings into the API response.
const MaxBodyPreviewBytes = 2048

// allowedMethods is the closed set of HTTP methods accepted on the
// outbound webhook delivery. Mirrors the CHECK constraint on
// notification_channel_webhook.http_method.
var allowedMethods = map[string]struct{}{
	http.MethodPost:  {},
	http.MethodPut:   {},
	http.MethodPatch: {},
}

// ErrEmptyURL is returned by [Send] when [Options.URL] is empty.
var ErrEmptyURL = errors.New("notifier/webhook: url is required")

// ErrUnsupportedMethod is returned by [Send] when [Options.Method] is
// not one of POST, PUT, PATCH (case-insensitive).
var ErrUnsupportedMethod = errors.New("notifier/webhook: unsupported http method (allowed: POST, PUT, PATCH)")

// Options describes a single outbound webhook delivery.
type Options struct {
	// URL is the absolute https://… target. Required.
	URL string

	// Method is the HTTP verb (POST/PUT/PATCH). Defaults to POST when
	// empty. Validated against [allowedMethods].
	Method string

	// Body is the request body bytes. Sent verbatim; HMAC signing (when
	// Secret is non-empty) signs exactly these bytes.
	Body []byte

	// ContentType is the value sent for the Content-Type header.
	// Defaults to [DefaultContentType] when empty.
	ContentType string

	// Headers is an optional set of extra request headers merged on top
	// of Content-Type, User-Agent, and the signature header. Existing
	// keys are overwritten — let callers force a Content-Type override
	// by setting Headers["Content-Type"].
	Headers map[string]string

	// Secret, when non-empty, enables HMAC SHA-256 request signing. The
	// computed digest is sent in the [SignatureHeader] using the
	// `sha256=<hex>` format. Empty disables signing.
	Secret string

	// Timeout applies to the whole round-trip (dial + write + read).
	// Defaults to [DefaultTimeout] when zero.
	Timeout time.Duration

	// Client is the *http.Client used for the request. When nil a fresh
	// default client honoring Timeout is constructed. Tests inject a
	// stub client targeting an httptest server.
	Client *http.Client
}

// Result carries everything the test endpoint surfaces in its JSON
// response: HTTP status, wall-clock latency, response body preview,
// and the signature that was actually sent on the request (so the UI
// can show the user a copy-paste-ready value).
type Result struct {
	// StatusCode is the HTTP status returned by the receiver. Zero
	// indicates the request never completed (DNS failure, TLS error,
	// timeout); pair with the returned err to disambiguate.
	StatusCode int

	// LatencyMs is the wall-clock duration from request build to
	// response body close, in milliseconds.
	LatencyMs int64

	// BodyPreview is the first [MaxBodyPreviewBytes] bytes of the
	// response body, decoded as a string. Truncation is silent — the UI
	// shows a "(truncated)" suffix when len(BodyPreview) hits the cap.
	BodyPreview string

	// Truncated reports whether BodyPreview was cut at MaxBodyPreviewBytes.
	Truncated bool

	// Signature is the raw value sent in the [SignatureHeader] when
	// signing was enabled (empty otherwise). Useful for UI confirmation
	// that the receiver should validate against the same input.
	Signature string
}

// Sign computes the HMAC SHA-256 of body using secret and returns the
// `sha256=<hex>` value suitable for the [SignatureHeader].
//
// An empty secret returns the empty string — callers should treat that
// as "signing disabled" rather than erroring, so the Settings UI can
// preview the signature before the user has typed a secret.
func Sign(secret string, body []byte) string {
	if secret == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return SignaturePrefix + hex.EncodeToString(mac.Sum(nil))
}

// Send delivers a single webhook request described by opts and returns
// a structured Result. Network/transport errors are returned as the
// second value with a zero StatusCode; HTTP-level errors (4xx/5xx)
// populate StatusCode but do NOT set err — the caller decides whether
// to treat them as failures based on the use case (the test endpoint
// reports them as `success=false` while the real dispatch path would
// schedule a retry).
func Send(ctx context.Context, opts Options) (Result, error) {
	if strings.TrimSpace(opts.URL) == "" {
		return Result{}, ErrEmptyURL
	}

	method := strings.ToUpper(strings.TrimSpace(opts.Method))
	if method == "" {
		method = http.MethodPost
	}
	if _, ok := allowedMethods[method]; !ok {
		return Result{}, fmt.Errorf("%w: %q", ErrUnsupportedMethod, method)
	}

	contentType := opts.ContentType
	if contentType == "" {
		contentType = DefaultContentType
	}

	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}

	client := opts.Client
	if client == nil {
		client = &http.Client{
			Timeout:   timeout,
			Transport: otelhttp.NewTransport(http.DefaultTransport),
		}
	}

	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	body := opts.Body
	if body == nil {
		body = []byte{}
	}
	signature := Sign(opts.Secret, body)

	req, err := http.NewRequestWithContext(reqCtx, method, opts.URL, bytes.NewReader(body))
	if err != nil {
		return Result{}, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("User-Agent", "TeslaSync/webhook")
	if signature != "" {
		req.Header.Set(SignatureHeader, signature)
	}
	for k, v := range opts.Headers {
		req.Header.Set(k, v)
	}

	start := time.Now()
	resp, err := client.Do(req)
	latency := time.Since(start)
	if err != nil {
		return Result{LatencyMs: latency.Milliseconds(), Signature: signature}, err
	}
	defer resp.Body.Close()

	preview, truncated := readPreview(resp.Body, MaxBodyPreviewBytes)
	return Result{
		StatusCode:  resp.StatusCode,
		LatencyMs:   latency.Milliseconds(),
		BodyPreview: preview,
		Truncated:   truncated,
		Signature:   signature,
	}, nil
}

// readPreview reads up to limit bytes from r and reports whether the
// underlying reader still had bytes available beyond the cap. The +1
// probe byte is intentional: it lets the caller distinguish "exactly
// at the cap" from "truncated".
func readPreview(r io.Reader, limit int) (string, bool) {
	if limit <= 0 {
		return "", false
	}
	buf, err := io.ReadAll(io.LimitReader(r, int64(limit)+1))
	if err != nil && !errors.Is(err, io.EOF) {
		// Best-effort: return whatever we managed to read so the UI
		// still surfaces a partial preview when the receiver disconnects
		// mid-body.
	}
	if len(buf) > limit {
		return string(buf[:limit]), true
	}
	return string(buf), false
}
