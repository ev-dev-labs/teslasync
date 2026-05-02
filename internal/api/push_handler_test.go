package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// fakePushRepo is a goroutine-safe in-memory implementation of
// pushSubscriptionsRepo for handler tests.
type fakePushRepo struct {
	mu     sync.Mutex
	rows   map[string]*models.PushSubscription // key=endpoint
	nextID int64

	upsertErr error
	listErr   error
	deleteErr error
}

func newFakePushRepo() *fakePushRepo {
	return &fakePushRepo{rows: map[string]*models.PushSubscription{}, nextID: 1}
}

func (f *fakePushRepo) Upsert(_ context.Context, s *models.PushSubscription) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.upsertErr != nil {
		return f.upsertErr
	}
	if existing, ok := f.rows[s.Endpoint]; ok {
		existing.P256DH = s.P256DH
		existing.Auth = s.Auth
		if s.UserAgent != nil {
			existing.UserAgent = s.UserAgent
		}
		s.ID = existing.ID
		s.CreatedAt = existing.CreatedAt
		s.LastUsedAt = existing.LastUsedAt
		return nil
	}
	id := f.nextID
	f.nextID++
	s.ID = id
	cp := *s
	f.rows[s.Endpoint] = &cp
	return nil
}

func (f *fakePushRepo) ListAll(_ context.Context) ([]*models.PushSubscription, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.listErr != nil {
		return nil, f.listErr
	}
	out := make([]*models.PushSubscription, 0, len(f.rows))
	for _, r := range f.rows {
		cp := *r
		out = append(out, &cp)
	}
	return out, nil
}

func (f *fakePushRepo) ListForUser(_ context.Context, _ *int64) ([]*models.PushSubscription, error) {
	return f.ListAll(context.Background())
}

func (f *fakePushRepo) DeleteByEndpoint(_ context.Context, _ *int64, endpoint string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.deleteErr != nil {
		return f.deleteErr
	}
	if _, ok := f.rows[endpoint]; !ok {
		return pgx.ErrNoRows
	}
	delete(f.rows, endpoint)
	return nil
}

// fakePushSvc is a tiny in-memory pushKeySource.
type fakePushSvc struct {
	enabled bool
	pub     string
}

func (f *fakePushSvc) IsEnabled() bool   { return f.enabled }
func (f *fakePushSvc) PublicKey() string { return f.pub }

func newPushHandlerForTest(repo *fakePushRepo, svc pushKeySource) *PushHandler {
	return &PushHandler{repo: repo, svc: svc}
}

func TestPushHandler_PublicKey_Disabled404(t *testing.T) {
	h := newPushHandlerForTest(newFakePushRepo(), &fakePushSvc{enabled: false})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/push/public-key", nil)
	h.PublicKey(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
}

func TestPushHandler_PublicKey_Enabled200(t *testing.T) {
	h := newPushHandlerForTest(newFakePushRepo(), &fakePushSvc{enabled: true, pub: "TESTPUB"})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/push/public-key", nil)
	h.PublicKey(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%s)", rr.Code, rr.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["publicKey"] != "TESTPUB" {
		t.Fatalf("expected publicKey=TESTPUB, got %q", body["publicKey"])
	}
}

func TestPushHandler_Subscribe_Created(t *testing.T) {
	repo := newFakePushRepo()
	h := newPushHandlerForTest(repo, &fakePushSvc{enabled: true, pub: "TESTPUB"})
	body := []byte(`{
		"endpoint": "https://fcm.googleapis.com/fcm/send/abc-123",
		"keys": {"p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=", "auth": "tBHItJI5svbpez7KI4CCXg=="}
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/push/subscribe", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Test)")
	rr := httptest.NewRecorder()
	h.Subscribe(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (body=%s)", rr.Code, rr.Body.String())
	}
	if len(repo.rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(repo.rows))
	}
	for _, row := range repo.rows {
		if row.Endpoint != "https://fcm.googleapis.com/fcm/send/abc-123" {
			t.Fatalf("unexpected endpoint: %s", row.Endpoint)
		}
		if row.UserAgent == nil || *row.UserAgent != "Mozilla/5.0 (Test)" {
			t.Fatalf("user-agent not captured: %v", row.UserAgent)
		}
	}
}

func TestPushHandler_Subscribe_Idempotent(t *testing.T) {
	repo := newFakePushRepo()
	h := newPushHandlerForTest(repo, &fakePushSvc{enabled: true, pub: "TESTPUB"})
	body := `{"endpoint":"https://example.com/sub/abc","keys":{"p256dh":"k1","auth":"a1"}}`
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/push/subscribe", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		h.Subscribe(rr, req)
		if rr.Code != http.StatusCreated {
			t.Fatalf("iter %d: expected 201, got %d", i, rr.Code)
		}
	}
	if len(repo.rows) != 1 {
		t.Fatalf("idempotent upsert should leave 1 row, got %d", len(repo.rows))
	}
}

func TestPushHandler_Subscribe_RejectsNonHTTPS(t *testing.T) {
	repo := newFakePushRepo()
	h := newPushHandlerForTest(repo, &fakePushSvc{enabled: true, pub: "TESTPUB"})
	body := `{"endpoint":"http://insecure.example.com/x","keys":{"p256dh":"k1","auth":"a1"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/push/subscribe", strings.NewReader(body))
	rr := httptest.NewRecorder()
	h.Subscribe(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for non-https endpoint, got %d", rr.Code)
	}
	if len(repo.rows) != 0 {
		t.Fatalf("expected 0 rows after rejected subscribe, got %d", len(repo.rows))
	}
}

func TestPushHandler_Subscribe_RejectsMissingKeys(t *testing.T) {
	repo := newFakePushRepo()
	h := newPushHandlerForTest(repo, &fakePushSvc{enabled: true, pub: "TESTPUB"})
	body := `{"endpoint":"https://example.com/sub","keys":{"p256dh":"","auth":""}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/push/subscribe", strings.NewReader(body))
	rr := httptest.NewRecorder()
	h.Subscribe(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing keys, got %d", rr.Code)
	}
}

func TestPushHandler_Subscribe_DisabledSvc404(t *testing.T) {
	h := newPushHandlerForTest(newFakePushRepo(), &fakePushSvc{enabled: false})
	body := `{"endpoint":"https://example.com/sub","keys":{"p256dh":"k1","auth":"a1"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/push/subscribe", strings.NewReader(body))
	rr := httptest.NewRecorder()
	h.Subscribe(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when svc disabled, got %d", rr.Code)
	}
}

func TestPushHandler_List_ReturnsRows(t *testing.T) {
	repo := newFakePushRepo()
	repo.rows["https://a/x"] = &models.PushSubscription{ID: 1, Endpoint: "https://a/x", P256DH: "p1", Auth: "a1"}
	repo.rows["https://b/y"] = &models.PushSubscription{ID: 2, Endpoint: "https://b/y", P256DH: "p2", Auth: "a2"}
	h := newPushHandlerForTest(repo, &fakePushSvc{enabled: true, pub: "TESTPUB"})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/push/subscribe", nil)
	rr := httptest.NewRecorder()
	h.List(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var rows []*models.PushSubscription
	if err := json.Unmarshal(rr.Body.Bytes(), &rows); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}
}

func TestPushHandler_List_DisabledReturnsEmpty(t *testing.T) {
	repo := newFakePushRepo()
	repo.rows["https://a/x"] = &models.PushSubscription{ID: 1, Endpoint: "https://a/x", P256DH: "p1", Auth: "a1"}
	h := newPushHandlerForTest(repo, &fakePushSvc{enabled: false})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/push/subscribe", nil)
	rr := httptest.NewRecorder()
	h.List(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "[]") {
		t.Fatalf("expected empty array, got %s", rr.Body.String())
	}
}

func TestPushHandler_Unsubscribe_DeletesRow(t *testing.T) {
	repo := newFakePushRepo()
	repo.rows["https://a/x"] = &models.PushSubscription{ID: 1, Endpoint: "https://a/x", P256DH: "p1", Auth: "a1"}
	h := newPushHandlerForTest(repo, &fakePushSvc{enabled: true, pub: "TESTPUB"})
	body := `{"endpoint":"https://a/x"}`
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/push/subscribe", strings.NewReader(body))
	rr := httptest.NewRecorder()
	h.Unsubscribe(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d (body=%s)", rr.Code, rr.Body.String())
	}
	if len(repo.rows) != 0 {
		t.Fatalf("expected 0 rows after unsubscribe, got %d", len(repo.rows))
	}
}

func TestPushHandler_Unsubscribe_NotFound(t *testing.T) {
	repo := newFakePushRepo()
	h := newPushHandlerForTest(repo, &fakePushSvc{enabled: true, pub: "TESTPUB"})
	body := `{"endpoint":"https://a/missing"}`
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/push/subscribe", strings.NewReader(body))
	rr := httptest.NewRecorder()
	h.Unsubscribe(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
}

func TestValidatePushEndpoint(t *testing.T) {
	cases := []struct {
		name   string
		input  string
		wantOK bool
	}{
		{"empty", "", false},
		{"https valid", "https://fcm.googleapis.com/fcm/send/abc", true},
		{"http invalid", "http://x/y", false},
		{"javascript: invalid", "javascript:alert(1)", false},
		{"relative invalid", "/sub/abc", false},
		{"too long", "https://x/" + strings.Repeat("a", 2050), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := validatePushEndpoint(tc.input)
			if tc.wantOK && err != nil {
				t.Fatalf("expected ok, got error: %v", err)
			}
			if !tc.wantOK && err == nil {
				t.Fatalf("expected error, got nil")
			}
		})
	}
}

func TestEndpointFingerprint_Stable(t *testing.T) {
	// Same input -> same hash.
	a := endpointFingerprint("https://fcm.googleapis.com/fcm/send/abc")
	b := endpointFingerprint("https://fcm.googleapis.com/fcm/send/abc")
	if a != b {
		t.Fatalf("fingerprint not stable: %s vs %s", a, b)
	}
	if len(a) != 16 {
		t.Fatalf("expected 16 hex chars, got %d", len(a))
	}
	// Different input -> different hash.
	c := endpointFingerprint("https://fcm.googleapis.com/fcm/send/xyz")
	if a == c {
		t.Fatalf("fingerprint should differ for different endpoints")
	}
}

func TestPushAuditDetail_DoesNotIncludeRawEndpoint(t *testing.T) {
	endpoint := "https://fcm.googleapis.com/fcm/send/SECRETTOKEN12345"
	detail := pushAuditDetail(endpoint, nil)
	if strings.Contains(detail, "SECRETTOKEN") {
		t.Fatalf("audit detail leaks raw endpoint: %s", detail)
	}
	if !strings.Contains(detail, "host=fcm.googleapis.com") {
		t.Fatalf("audit detail should include host: %s", detail)
	}
}
