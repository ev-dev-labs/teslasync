package feedback

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	dbuser "github.com/ev-dev-labs/teslasync/internal/database/user"
)

// fakeFeedbackStore is an in-memory FeedbackStore used by these unit
// tests. It tracks the last Insert payload + the count returned by
// CountSubmittedSince so the rate-limit branches can be exercised
// without a real database.
type fakeFeedbackStore struct {
	insertResult dbuser.UserFeedback
	insertErr    error
	insertCalls  int
	lastInsert   dbuser.FeedbackInsert

	countResult int64
	countErr    error
	lastSubject string
	lastIP      string
}

func (f *fakeFeedbackStore) Insert(_ context.Context, in dbuser.FeedbackInsert) (dbuser.UserFeedback, error) {
	f.insertCalls++
	f.lastInsert = in
	if f.insertErr != nil {
		return dbuser.UserFeedback{}, f.insertErr
	}
	if f.insertResult.ID == 0 {
		return dbuser.UserFeedback{
			ID:        1,
			CreatedAt: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
			Category:  in.Category,
			Title:     in.Title,
			Body:      in.Body,
			Status:    dbuser.FeedbackStatusNew,
		}, nil
	}
	return f.insertResult, nil
}

func (f *fakeFeedbackStore) CountSubmittedSince(_ context.Context, subject, ip string, _ time.Time) (int64, error) {
	f.lastSubject = subject
	f.lastIP = ip
	return f.countResult, f.countErr
}

func feedbackTestCfg() *config.Config {
	return &config.Config{Auth: config.AuthConfig{ForwardAuthHeader: "X-User"}}
}

func newTestHandler(store FeedbackStore) *Handler {
	h := NewHandler(store, feedbackTestCfg())
	h.now = func() time.Time { return time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC) }
	return h
}

func TestFeedbackSubmitHappyPath(t *testing.T) {
	store := &fakeFeedbackStore{}
	h := newTestHandler(store)

	body := `{
		"category":"bug",
		"title":"Battery widget glitch",
		"body":"The battery widget shows NaN after returning from sleep mode for an hour or so.",
		"page_route":"/dashboard",
		"app_version":"1.2.3"
	}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/feedback", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User", "alice@example.com")
	rec := httptest.NewRecorder()

	h.Submit(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status: got %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if store.insertCalls != 1 {
		t.Fatalf("insert calls: got %d", store.insertCalls)
	}
	if store.lastInsert.SubmitterSubject != "alice@example.com" {
		t.Fatalf("subject not threaded: %q", store.lastInsert.SubmitterSubject)
	}
	if store.lastInsert.PageRoute != "/dashboard" {
		t.Fatalf("page_route lost: %q", store.lastInsert.PageRoute)
	}
	if store.lastInsert.AppVersion != "1.2.3" {
		t.Fatalf("app_version lost: %q", store.lastInsert.AppVersion)
	}

	var got dbuser.UserFeedback
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.ID != 1 || got.Status != dbuser.FeedbackStatusNew {
		t.Fatalf("unexpected response: %+v", got)
	}
}

// TestFeedbackSubmitNormalizesPageRoute pins the privacy boundary on the
// stored route label.
//
// A feedback row is durable, is visible to every admin with queue access, and
// can be forwarded verbatim into a GitHub issue. Anything identifying in
// page_route lands in all three places at once, so the handler templates the
// value itself rather than trusting whatever the client sent — an older SPA
// build, a scripted POST, or a future caller must not be able to bypass it.
func TestFeedbackSubmitNormalizesPageRoute(t *testing.T) {
	cases := []struct {
		name  string
		route string
		want  string
		deny  string
	}{
		{
			name:  "numeric record id",
			route: "/drives/91827",
			want:  "/drives/:id",
			deny:  "91827",
		},
		{
			name:  "vin in path",
			route: "/vehicles/5YJ3E1EA7KF317654",
			deny:  "5YJ3E1EA7KF317654",
		},
		{
			name:  "opaque share token",
			route: "/s/private-share-slug-xyz",
			deny:  "private-share-slug-xyz",
		},
		{
			name:  "query string carrying a token",
			route: "/settings?access_token=supersecretvalue",
			want:  "/settings",
			deny:  "supersecretvalue",
		},
		{
			name:  "absolute url with host and fragment",
			route: "https://tenant.example.com/drives/42#section",
			want:  "/drives/:id",
			deny:  "tenant.example.com",
		},
		{
			name:  "plain page survives intact",
			route: "/system-status",
			want:  "/system-status",
		},
		{
			name:  "empty stays empty rather than claiming the dashboard",
			route: "",
			want:  "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeFeedbackStore{}
			h := newTestHandler(store)

			payload := map[string]string{
				"category":   "bug",
				"title":      "valid title here",
				"body":       "this body is more than twenty characters long for sure",
				"page_route": tc.route,
			}
			raw, err := json.Marshal(payload)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}

			req := httptest.NewRequest(http.MethodPost, "/api/v1/feedback", strings.NewReader(string(raw)))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()

			h.Submit(rec, req)

			if rec.Code != http.StatusCreated {
				t.Fatalf("status: got %d, want 201; body=%s", rec.Code, rec.Body.String())
			}
			got := store.lastInsert.PageRoute
			if tc.want != "" && got != tc.want {
				t.Fatalf("page_route: got %q, want %q", got, tc.want)
			}
			if tc.want == "" && tc.deny == "" && got != "" {
				t.Fatalf("page_route: got %q, want empty", got)
			}
			if tc.deny != "" && strings.Contains(got, tc.deny) {
				t.Fatalf("page_route leaked %q: %q", tc.deny, got)
			}
		})
	}
}

func TestFeedbackSubmitRateLimited(t *testing.T) {
	store := &fakeFeedbackStore{countResult: 3}
	h := newTestHandler(store)

	body := `{"category":"bug","title":"valid title here","body":"this body is more than twenty characters long for sure"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/feedback", strings.NewReader(body))
	req.Header.Set("X-User", "alice@example.com")
	rec := httptest.NewRecorder()

	h.Submit(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status: got %d, want 429; body=%s", rec.Code, rec.Body.String())
	}
	if store.insertCalls != 0 {
		t.Fatalf("insert called despite rate limit: %d", store.insertCalls)
	}
}

func TestFeedbackSubmitRateLimitFailsOpen(t *testing.T) {
	// Repo lookup error must NOT block legitimate submissions — fail open
	// per the handler contract (logged but allowed).
	store := &fakeFeedbackStore{countErr: errors.New("db down")}
	h := newTestHandler(store)

	body := `{"category":"bug","title":"valid title here","body":"this body is more than twenty characters long for sure"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/feedback", strings.NewReader(body))
	req.Header.Set("X-User", "alice@example.com")
	rec := httptest.NewRecorder()

	h.Submit(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status: got %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if store.insertCalls != 1 {
		t.Fatalf("insert not called despite fail-open: %d", store.insertCalls)
	}
}

func TestFeedbackSubmitInvalidCategory(t *testing.T) {
	store := &fakeFeedbackStore{insertErr: dbuser.ErrFeedbackInvalidCategory}
	h := newTestHandler(store)

	body := `{"category":"spam","title":"valid title here","body":"this body is more than twenty characters long for sure"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/feedback", strings.NewReader(body))
	rec := httptest.NewRecorder()

	h.Submit(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestFeedbackSubmitTitleTooShort(t *testing.T) {
	store := &fakeFeedbackStore{insertErr: dbuser.ErrFeedbackTitleTooShort}
	h := newTestHandler(store)

	body := `{"category":"bug","title":"hi","body":"this body is more than twenty characters long for sure"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/feedback", strings.NewReader(body))
	rec := httptest.NewRecorder()

	h.Submit(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestFeedbackSubmitBodyTooShort(t *testing.T) {
	store := &fakeFeedbackStore{insertErr: dbuser.ErrFeedbackBodyTooShort}
	h := newTestHandler(store)

	body := `{"category":"bug","title":"valid title here","body":"short"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/feedback", strings.NewReader(body))
	rec := httptest.NewRecorder()

	h.Submit(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestFeedbackSubmitRejectsUnknownFields(t *testing.T) {
	store := &fakeFeedbackStore{}
	h := newTestHandler(store)

	body := `{"category":"bug","title":"valid title here","body":"this body is more than twenty characters long for sure","x_extra":"lol"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/feedback", strings.NewReader(body))
	rec := httptest.NewRecorder()

	h.Submit(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestFeedbackSubmitFallsBackToHTTPUserAgent(t *testing.T) {
	store := &fakeFeedbackStore{}
	h := newTestHandler(store)

	body := `{"category":"bug","title":"valid title here","body":"this body is more than twenty characters long for sure"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/feedback", strings.NewReader(body))
	req.Header.Set("User-Agent", "Mozilla/5.0 (Mock)")
	rec := httptest.NewRecorder()

	h.Submit(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status: got %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if store.lastInsert.UserAgent != "Mozilla/5.0 (Mock)" {
		t.Fatalf("UA fallback failed: got %q", store.lastInsert.UserAgent)
	}
}

func TestFeedbackSubmitInvalidJSON(t *testing.T) {
	store := &fakeFeedbackStore{}
	h := newTestHandler(store)

	body := `{this is not json`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/feedback", strings.NewReader(body))
	rec := httptest.NewRecorder()

	h.Submit(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}
