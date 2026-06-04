package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	"github.com/ev-dev-labs/teslasync/internal/notifier"
)

// fakeWebhookConfigStore is an in-memory stub of
// notificationChannelWebhookConfigStore so handler tests can exercise
// the webhook-test endpoint without standing up Postgres.
type fakeWebhookConfigStore struct {
	cfg *dbnotif.WebhookConfig
	err error

	calls int
}

func (f *fakeWebhookConfigStore) GetWebhookConfig(_ context.Context, _ int64) (*dbnotif.WebhookConfig, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.cfg, nil
}

// recordedSend captures every call routed through the webhookSender
// hook so tests can assert on the options the handler built.
type recordedSend struct {
	opts notifier.Options
	res  notifier.Result
	err  error
	hits int
}

func (r *recordedSend) hook(_ context.Context, opts notifier.Options) (notifier.Result, error) {
	r.hits++
	r.opts = opts
	return r.res, r.err
}

// newWebhookHandlerForTest builds a ChannelHandler around
// the supplied stub store and recorded sender, returning the handler
// plus a chi.Router pre-mounted at the same paths the production
// router uses (so tests exercise the URL parameter extraction too).
func newWebhookHandlerForTest(store notificationChannelWebhookConfigStore, send webhookSender) (*ChannelHandler, http.Handler) {
	h := &ChannelHandler{store: store, sender: send}
	r := chi.NewRouter()
	r.Route("/api/v1/notifications", func(r chi.Router) {
		r.Post("/webhooks/preview-signature", h.WebhookSignaturePreview)
		r.Route("/{channelID}", func(r chi.Router) {
			r.Post("/webhook-test", h.WebhookTest)
		})
	})
	return h, r
}

func TestWebhookSignaturePreviewReturnsHMAC(t *testing.T) {
	_, srv := newWebhookHandlerForTest(&fakeWebhookConfigStore{}, nil)

	body := bytes.NewBufferString(`{"secret":"shh","body":"hello"}`)
	req := httptest.NewRequest("POST", "/api/v1/notifications/webhooks/preview-signature", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d body=%s", w.Code, w.Body.String())
	}
	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := notifier.Sign("shh", []byte("hello"))
	if resp["signature"] != want {
		t.Fatalf("signature mismatch:\n got  %s\n want %s", resp["signature"], want)
	}
}

func TestWebhookSignaturePreviewRejectsEmptySecret(t *testing.T) {
	_, srv := newWebhookHandlerForTest(&fakeWebhookConfigStore{}, nil)

	body := bytes.NewBufferString(`{"secret":"","body":"x"}`)
	req := httptest.NewRequest("POST", "/api/v1/notifications/webhooks/preview-signature", body)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d", w.Code)
	}
}

func TestWebhookSignaturePreviewRejectsUnknownFields(t *testing.T) {
	_, srv := newWebhookHandlerForTest(&fakeWebhookConfigStore{}, nil)

	body := bytes.NewBufferString(`{"secret":"x","body":"y","extra":1}`)
	req := httptest.NewRequest("POST", "/api/v1/notifications/webhooks/preview-signature", body)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d", w.Code)
	}
}

func TestWebhookSignaturePreviewRejectsTooLargeBody(t *testing.T) {
	_, srv := newWebhookHandlerForTest(&fakeWebhookConfigStore{}, nil)

	huge := strings.Repeat("a", MaxWebhookSignaturePreviewBodyBytes+10)
	body := bytes.NewBufferString(`{"secret":"s","body":"` + huge + `"}`)
	req := httptest.NewRequest("POST", "/api/v1/notifications/webhooks/preview-signature", body)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d body=%s", w.Code, w.Body.String())
	}
}

func TestWebhookTestForwardsConfigToSender(t *testing.T) {
	store := &fakeWebhookConfigStore{
		cfg: &dbnotif.WebhookConfig{
			ChannelID:  42,
			Name:       "Discord ops",
			Enabled:    true,
			URL:        "https://example.com/hook",
			HTTPMethod: "POST",
			Secret:     "shh",
		},
	}
	rec := &recordedSend{
		res: notifier.Result{
			StatusCode:  204,
			LatencyMs:   12,
			BodyPreview: "",
			Signature:   notifier.Sign("shh", []byte(`{"x":1}`)),
		},
	}
	_, srv := newWebhookHandlerForTest(store, rec.hook)

	req := httptest.NewRequest("POST", "/api/v1/notifications/42/webhook-test", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d body=%s", w.Code, w.Body.String())
	}
	if rec.hits != 1 {
		t.Fatalf("sender invocations: got %d want 1", rec.hits)
	}
	if rec.opts.URL != "https://example.com/hook" {
		t.Fatalf("URL passed: got %q", rec.opts.URL)
	}
	if rec.opts.Method != "POST" {
		t.Fatalf("Method passed: got %q", rec.opts.Method)
	}
	if rec.opts.Secret != "shh" {
		t.Fatalf("Secret passed: got %q", rec.opts.Secret)
	}
	// Default body should be a JSON envelope with title+message+source+test.
	var env map[string]any
	if err := json.Unmarshal(rec.opts.Body, &env); err != nil {
		t.Fatalf("body not JSON: %v body=%s", err, string(rec.opts.Body))
	}
	if env["test"] != true {
		t.Fatalf("test flag not true: %v", env["test"])
	}
	if env["source"] != "teslasync" {
		t.Fatalf("source not teslasync: %v", env["source"])
	}
	if _, ok := env["timestamp"].(string); !ok {
		t.Fatalf("timestamp not a string: %v", env["timestamp"])
	}

	var resp webhookTestResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.Success {
		t.Fatalf("expected success=true, got %+v", resp)
	}
	if resp.StatusCode != 204 {
		t.Fatalf("status_code: got %d", resp.StatusCode)
	}
	if resp.Signature == "" {
		t.Fatalf("signature missing from response")
	}
}

func TestWebhookTestRespectsTitleAndMessageOverrides(t *testing.T) {
	store := &fakeWebhookConfigStore{
		cfg: &dbnotif.WebhookConfig{
			ChannelID: 1, URL: "https://example.com", HTTPMethod: "POST",
		},
	}
	rec := &recordedSend{res: notifier.Result{StatusCode: 200}}
	_, srv := newWebhookHandlerForTest(store, rec.hook)

	body := bytes.NewBufferString(`{"title":"Custom","message":"Hello world"}`)
	req := httptest.NewRequest("POST", "/api/v1/notifications/1/webhook-test", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d body=%s", w.Code, w.Body.String())
	}
	var env map[string]any
	if err := json.Unmarshal(rec.opts.Body, &env); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if env["title"] != "Custom" {
		t.Fatalf("title: got %v", env["title"])
	}
	if env["message"] != "Hello world" {
		t.Fatalf("message: got %v", env["message"])
	}
}

func TestWebhookTestReturns404WhenNotWebhookKind(t *testing.T) {
	store := &fakeWebhookConfigStore{err: dbnotif.ErrChannelNotFound}
	rec := &recordedSend{}
	_, srv := newWebhookHandlerForTest(store, rec.hook)

	req := httptest.NewRequest("POST", "/api/v1/notifications/99/webhook-test", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("status: got %d", w.Code)
	}
	if rec.hits != 0 {
		t.Fatalf("sender should not be called when channel missing")
	}
}

func TestWebhookTestSurfacesSendError(t *testing.T) {
	store := &fakeWebhookConfigStore{
		cfg: &dbnotif.WebhookConfig{ChannelID: 1, URL: "https://x", HTTPMethod: "POST"},
	}
	rec := &recordedSend{
		res: notifier.Result{LatencyMs: 5},
		err: errors.New("dial tcp: i/o timeout"),
	}
	_, srv := newWebhookHandlerForTest(store, rec.hook)

	req := httptest.NewRequest("POST", "/api/v1/notifications/1/webhook-test", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d", w.Code)
	}
	var resp webhookTestResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Success {
		t.Fatalf("expected success=false")
	}
	if !strings.Contains(resp.Error, "i/o timeout") {
		t.Fatalf("error not surfaced: got %q", resp.Error)
	}
}

func TestWebhookTestReportsNon2xxAsFailure(t *testing.T) {
	store := &fakeWebhookConfigStore{
		cfg: &dbnotif.WebhookConfig{ChannelID: 1, URL: "https://x", HTTPMethod: "POST"},
	}
	rec := &recordedSend{res: notifier.Result{StatusCode: 500, BodyPreview: "boom"}}
	_, srv := newWebhookHandlerForTest(store, rec.hook)

	req := httptest.NewRequest("POST", "/api/v1/notifications/1/webhook-test", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	var resp webhookTestResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Success {
		t.Fatalf("expected success=false for 500")
	}
	if resp.StatusCode != 500 {
		t.Fatalf("status_code: got %d", resp.StatusCode)
	}
	if resp.BodyPreview != "boom" {
		t.Fatalf("body preview: got %q", resp.BodyPreview)
	}
}

func TestWebhookTestRejectsInvalidChannelID(t *testing.T) {
	store := &fakeWebhookConfigStore{}
	_, srv := newWebhookHandlerForTest(store, nil)

	req := httptest.NewRequest("POST", "/api/v1/notifications/not-a-number/webhook-test", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d", w.Code)
	}
}

// End-to-end sanity check: route a real notifier.Send through an
// httptest server to confirm the handler + signing + recorder all
// agree on the bytes being signed.
func TestWebhookTestRoundTripWithRealNotifier(t *testing.T) {
	receivedSignature := ""
	receivedBody := []byte(nil)
	srvBackend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedSignature = r.Header.Get(notifier.SignatureHeader)
		receivedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte("ok"))
	}))
	defer srvBackend.Close()

	store := &fakeWebhookConfigStore{
		cfg: &dbnotif.WebhookConfig{
			ChannelID: 7, URL: srvBackend.URL, HTTPMethod: "POST", Secret: "topsecret",
		},
	}
	_, srv := newWebhookHandlerForTest(store, notifier.Send)

	req := httptest.NewRequest("POST", "/api/v1/notifications/7/webhook-test", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d body=%s", w.Code, w.Body.String())
	}
	var resp webhookTestResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.Success || resp.StatusCode != http.StatusAccepted {
		t.Fatalf("expected success=true status=202, got %+v", resp)
	}
	if receivedSignature == "" || receivedSignature != resp.Signature {
		t.Fatalf("signature header on receiver (%q) did not match handler response (%q)",
			receivedSignature, resp.Signature)
	}
	wantSig := notifier.Sign("topsecret", receivedBody)
	if wantSig != receivedSignature {
		t.Fatalf("recomputed signature mismatch:\n got %q\n want %q", receivedSignature, wantSig)
	}
}
