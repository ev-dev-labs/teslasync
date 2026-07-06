package teslauserprofile

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

// ---------------------------------------------------------------------------
// Test doubles (ports declared in handler.go). Same-package tests can satisfy
// the unexported teslaUserProfileClient / teslaUserProfileStore interfaces
// directly, so no real Tesla HTTP client + OAuth token or pgx pool is needed.
// ---------------------------------------------------------------------------

type fakeProfileClient struct {
	hasToken bool

	body   []byte
	status int
	err    error

	tokenCalls   int
	profileCalls int
}

func (f *fakeProfileClient) HasValidToken() bool {
	f.tokenCalls++
	return f.hasToken
}

func (f *fakeProfileClient) GetUserProfile(_ context.Context) ([]byte, int, error) {
	f.profileCalls++
	return f.body, f.status, f.err
}

type fakeProfileStore struct {
	getResult *teslamodel.TeslaUserProfile
	getErr    error
	getCalls  int

	upsertErr   error
	upsertCalls int
	gotUpsert   *teslamodel.TeslaUserProfile

	// reflectUpsert, when true, makes Get return the last upserted profile,
	// mirroring the real repo's read-after-write behaviour used by the refresh
	// endpoint (which persists then re-reads through the standard Get path).
	reflectUpsert bool
	// stampFetchedAt, when non-zero, is written onto the profile by Upsert so
	// read-after-write assertions on fetched_at are deterministic. The real
	// repo stamps time.Now().UTC(); tests pin an explicit instant instead.
	stampFetchedAt time.Time
}

func (f *fakeProfileStore) Get(_ context.Context) (*teslamodel.TeslaUserProfile, error) {
	f.getCalls++
	if f.getErr != nil {
		return nil, f.getErr
	}
	if f.reflectUpsert && f.gotUpsert != nil {
		return f.gotUpsert, nil
	}
	return f.getResult, nil
}

func (f *fakeProfileStore) Upsert(_ context.Context, p *teslamodel.TeslaUserProfile) error {
	f.upsertCalls++
	f.gotUpsert = p
	if f.upsertErr != nil {
		return f.upsertErr
	}
	if !f.stampFetchedAt.IsZero() {
		p.FetchedAt = f.stampFetchedAt
	} else {
		p.FetchedAt = time.Now().UTC()
	}
	return nil
}

// Compile-time assertions the fakes implement the production ports.
var (
	_ teslaUserProfileClient = (*fakeProfileClient)(nil)
	_ teslaUserProfileStore  = (*fakeProfileStore)(nil)
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func newTestHandler(tc teslaUserProfileClient, repo teslaUserProfileStore) *Handler {
	return &Handler{teslaClient: tc, profileRepo: repo}
}

func getReq() *http.Request {
	return httptest.NewRequest(http.MethodGet, "/tesla/user/profile", nil)
}

func postReq() *http.Request {
	return httptest.NewRequest(http.MethodPost, "/tesla/user/profile/refresh", nil)
}

func sptr(s string) *string { return &s }

func decodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder) profileResp {
	t.Helper()
	var pr profileResp
	if err := json.Unmarshal(rec.Body.Bytes(), &pr); err != nil {
		t.Fatalf("decode profile envelope: %v; raw=%q", err, rec.Body.String())
	}
	return pr
}

func decodeErr(t *testing.T, rec *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode error body: %v; raw=%q", err, rec.Body.String())
	}
	return m
}

func assertJSONContentType(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}
}

// profileResp mirrors the unexported profileEnvelope wire shape.
type profileResp struct {
	Profile   *teslamodel.TeslaUserProfile `json:"profile"`
	FetchedAt *string                      `json:"fetched_at"`
}

// teslaProfileBody marshals the Tesla /api/1/users/me envelope shape the
// refresh handler unmarshals. A nil imageURL omits profile_image_url so the
// pointer-round-trip (null) path is exercised.
func teslaProfileBody(t *testing.T, email, fullName string, imageURL *string) []byte {
	t.Helper()
	inner := map[string]any{"email": email, "full_name": fullName}
	if imageURL != nil {
		inner["profile_image_url"] = *imageURL
	}
	b, err := json.Marshal(map[string]any{"response": inner})
	if err != nil {
		t.Fatalf("marshal tesla profile body: %v", err)
	}
	return b
}

func sampleProfile() *teslamodel.TeslaUserProfile {
	return &teslamodel.TeslaUserProfile{
		ID:              7,
		Email:           "ada@example.com",
		FullName:        "Ada Lovelace",
		ProfileImageURL: sptr("https://tesla.example/pic.png"),
		FetchedAt:       time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC),
		CreatedAt:       time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC),
		UpdatedAt:       time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC),
	}
}

// ---------------------------------------------------------------------------
// Constructor wiring
// ---------------------------------------------------------------------------

// TestNewHandler is a wiring smoke test: the constructor must populate both
// ports and never panic, even with nil dependencies (it only stores them).
// Behavioural coverage lives in the Profile/RefreshProfile tests via the ports.
func TestNewHandler(t *testing.T) {
	h := NewHandler(nil, &database.DB{})
	if h == nil {
		t.Fatal("constructor returned nil handler")
	}
	if h.profileRepo == nil {
		t.Fatal("profileRepo port not wired")
	}
}

// ---------------------------------------------------------------------------
// Profile (GET)
// ---------------------------------------------------------------------------

func TestHandler_Profile(t *testing.T) {
	tests := []struct {
		name          string
		store         *fakeProfileStore
		wantStatus    int
		wantErr       bool
		wantErrCode   string
		wantProfile   bool
		wantFetchedAt bool
	}{
		{
			name:          "profile exists renders profile and fetched_at",
			store:         &fakeProfileStore{getResult: sampleProfile()},
			wantStatus:    http.StatusOK,
			wantProfile:   true,
			wantFetchedAt: true,
		},
		{
			name:          "no profile row renders null profile and null fetched_at",
			store:         &fakeProfileStore{getResult: nil},
			wantStatus:    http.StatusOK,
			wantProfile:   false,
			wantFetchedAt: false,
		},
		{
			name:        "repo error yields 500",
			store:       &fakeProfileStore{getErr: errors.New("db down")},
			wantStatus:  http.StatusInternalServerError,
			wantErr:     true,
			wantErrCode: "INTERNAL_ERROR",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := newTestHandler(&fakeProfileClient{}, tc.store)
			rec := httptest.NewRecorder()

			h.Profile(rec, getReq())

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			assertJSONContentType(t, rec)

			if tc.wantErr {
				got := decodeErr(t, rec)
				if got["error"] == "" {
					t.Fatalf("expected error message in body, got %q", rec.Body.String())
				}
				if got["code"] != tc.wantErrCode {
					t.Fatalf("error code = %q, want %q", got["code"], tc.wantErrCode)
				}
				return
			}

			// The envelope must always carry both keys so the SPA can rely on
			// their presence regardless of whether a profile exists.
			if !strings.Contains(rec.Body.String(), `"profile"`) ||
				!strings.Contains(rec.Body.String(), `"fetched_at"`) {
				t.Fatalf("envelope missing profile/fetched_at keys: %s", rec.Body.String())
			}

			pr := decodeEnvelope(t, rec)
			if tc.wantProfile {
				if pr.Profile == nil {
					t.Fatalf("expected profile in body, got null: %s", rec.Body.String())
				}
				if pr.Profile.Email != "ada@example.com" {
					t.Fatalf("email = %q, want ada@example.com", pr.Profile.Email)
				}
				if pr.Profile.FullName != "Ada Lovelace" {
					t.Fatalf("full_name = %q, want Ada Lovelace", pr.Profile.FullName)
				}
			} else if pr.Profile != nil {
				t.Fatalf("expected null profile, got %+v", pr.Profile)
			}

			if tc.wantFetchedAt {
				if pr.FetchedAt == nil {
					t.Fatalf("expected fetched_at, got null: %s", rec.Body.String())
				}
				if *pr.FetchedAt != "2026-03-01T10:00:00Z" {
					t.Fatalf("fetched_at = %q, want 2026-03-01T10:00:00Z", *pr.FetchedAt)
				}
			} else if pr.FetchedAt != nil {
				t.Fatalf("expected null fetched_at, got %q", *pr.FetchedAt)
			}
		})
	}
}

// TestHandler_Profile_FetchedAtNormalizedToUTC locks the .UTC() normalization:
// a FetchedAt carried in a non-UTC zone must serialize as the equivalent UTC
// RFC3339 instant (Z suffix), never the original offset.
func TestHandler_Profile_FetchedAtNormalizedToUTC(t *testing.T) {
	zone := time.FixedZone("IST", 5*3600+30*60) // +05:30
	p := sampleProfile()
	p.FetchedAt = time.Date(2026, 3, 1, 15, 30, 0, 0, zone) // == 10:00:00Z

	h := newTestHandler(&fakeProfileClient{}, &fakeProfileStore{getResult: p})
	rec := httptest.NewRecorder()
	h.Profile(rec, getReq())

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	pr := decodeEnvelope(t, rec)
	if pr.FetchedAt == nil {
		t.Fatalf("fetched_at missing: %s", rec.Body.String())
	}
	if *pr.FetchedAt != "2026-03-01T10:00:00Z" {
		t.Fatalf("fetched_at = %q, want normalized UTC 2026-03-01T10:00:00Z", *pr.FetchedAt)
	}
}

// ---------------------------------------------------------------------------
// RefreshProfile (POST) — error / status branches
// ---------------------------------------------------------------------------

func TestHandler_RefreshProfile_ErrorBranches(t *testing.T) {
	tests := []struct {
		name       string
		client     *fakeProfileClient
		store      *fakeProfileStore
		wantStatus int
		wantMsg    string
		// expected call counts to prove the handler short-circuits correctly.
		wantProfileCalls int
		wantUpsertCalls  int
		wantGetCalls     int
	}{
		{
			name:             "no valid token yields 401 and no downstream calls",
			client:           &fakeProfileClient{hasToken: false},
			store:            &fakeProfileStore{},
			wantStatus:       http.StatusUnauthorized,
			wantMsg:          "not authenticated with Tesla",
			wantProfileCalls: 0,
			wantUpsertCalls:  0,
			wantGetCalls:     0,
		},
		{
			name:             "tesla transport error yields 502 and no write",
			client:           &fakeProfileClient{hasToken: true, err: errors.New("dial tcp: connection refused")},
			store:            &fakeProfileStore{},
			wantStatus:       http.StatusBadGateway,
			wantMsg:          "failed to fetch from Tesla",
			wantProfileCalls: 1,
			wantUpsertCalls:  0,
			wantGetCalls:     0,
		},
		{
			name:             "tesla 401 (err+status) yields 502 and no write",
			client:           &fakeProfileClient{hasToken: true, status: http.StatusUnauthorized, err: errors.New("unauthorized"), body: []byte(`{}`)},
			store:            &fakeProfileStore{},
			wantStatus:       http.StatusBadGateway,
			wantMsg:          "failed to fetch from Tesla",
			wantProfileCalls: 1,
			wantUpsertCalls:  0,
			wantGetCalls:     0,
		},
		{
			name:             "tesla 500 non-2xx yields 502 and no write",
			client:           &fakeProfileClient{hasToken: true, status: http.StatusInternalServerError, body: []byte(`{"error":"boom"}`)},
			store:            &fakeProfileStore{},
			wantStatus:       http.StatusBadGateway,
			wantMsg:          "Tesla API returned non-success status",
			wantProfileCalls: 1,
			wantUpsertCalls:  0,
			wantGetCalls:     0,
		},
		{
			name:             "tesla 403 non-2xx yields 502 and no write",
			client:           &fakeProfileClient{hasToken: true, status: http.StatusForbidden, body: []byte(`{}`)},
			store:            &fakeProfileStore{},
			wantStatus:       http.StatusBadGateway,
			wantMsg:          "Tesla API returned non-success status",
			wantProfileCalls: 1,
			wantUpsertCalls:  0,
			wantGetCalls:     0,
		},
		{
			name:             "malformed json body yields 500 and no write",
			client:           &fakeProfileClient{hasToken: true, status: http.StatusOK, body: []byte(`{"response":`)},
			store:            &fakeProfileStore{},
			wantStatus:       http.StatusInternalServerError,
			wantMsg:          "failed to parse Tesla response",
			wantProfileCalls: 1,
			wantUpsertCalls:  0,
			wantGetCalls:     0,
		},
		{
			name:             "empty body (2xx) yields 500 parse error",
			client:           &fakeProfileClient{hasToken: true, status: http.StatusOK, body: nil},
			store:            &fakeProfileStore{},
			wantStatus:       http.StatusInternalServerError,
			wantMsg:          "failed to parse Tesla response",
			wantProfileCalls: 1,
			wantUpsertCalls:  0,
			wantGetCalls:     0,
		},
		{
			name:             "upsert failure yields 500 after fetch",
			client:           &fakeProfileClient{hasToken: true, status: http.StatusOK, body: []byte(`{"response":{"email":"a@b.com","full_name":"A B"}}`)},
			store:            &fakeProfileStore{upsertErr: errors.New("insert profile: constraint")},
			wantStatus:       http.StatusInternalServerError,
			wantMsg:          "failed to save profile",
			wantProfileCalls: 1,
			wantUpsertCalls:  1,
			wantGetCalls:     0,
		},
		{
			name:             "read-after-write failure yields 500 from read path",
			client:           &fakeProfileClient{hasToken: true, status: http.StatusOK, body: []byte(`{"response":{"email":"a@b.com","full_name":"A B"}}`)},
			store:            &fakeProfileStore{getErr: errors.New("db down")},
			wantStatus:       http.StatusInternalServerError,
			wantMsg:          "failed to fetch profile",
			wantProfileCalls: 1,
			wantUpsertCalls:  1,
			wantGetCalls:     1,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := newTestHandler(tc.client, tc.store)
			rec := httptest.NewRecorder()

			h.RefreshProfile(rec, postReq())

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			assertJSONContentType(t, rec)

			got := decodeErr(t, rec)
			if got["error"] != tc.wantMsg {
				t.Fatalf("error message = %q, want %q", got["error"], tc.wantMsg)
			}
			if got["code"] == "" {
				t.Fatalf("expected machine code in error body, got %q", rec.Body.String())
			}

			if tc.client.profileCalls != tc.wantProfileCalls {
				t.Fatalf("GetUserProfile calls = %d, want %d", tc.client.profileCalls, tc.wantProfileCalls)
			}
			if tc.store.upsertCalls != tc.wantUpsertCalls {
				t.Fatalf("Upsert calls = %d, want %d", tc.store.upsertCalls, tc.wantUpsertCalls)
			}
			if tc.store.getCalls != tc.wantGetCalls {
				t.Fatalf("Get calls = %d, want %d", tc.store.getCalls, tc.wantGetCalls)
			}
		})
	}
}

// TestHandler_RefreshProfile_401Code pins the wire-level machine code the SPA
// matches on for the unauthenticated branch.
func TestHandler_RefreshProfile_401Code(t *testing.T) {
	h := newTestHandler(&fakeProfileClient{hasToken: false}, &fakeProfileStore{})
	rec := httptest.NewRecorder()
	h.RefreshProfile(rec, postReq())

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	got := decodeErr(t, rec)
	if got["code"] != "UNAUTHORIZED" {
		t.Fatalf("code = %q, want UNAUTHORIZED", got["code"])
	}
}

// ---------------------------------------------------------------------------
// RefreshProfile (POST) — success
// ---------------------------------------------------------------------------

func TestHandler_RefreshProfile_Success(t *testing.T) {
	stamp := time.Date(2026, 7, 4, 16, 30, 0, 0, time.UTC)
	client := &fakeProfileClient{
		hasToken: true,
		status:   http.StatusOK,
		body:     teslaProfileBody(t, "grace@example.com", "Grace Hopper", sptr("https://tesla.example/g.png")),
	}
	store := &fakeProfileStore{reflectUpsert: true, stampFetchedAt: stamp}
	h := newTestHandler(client, store)

	rec := httptest.NewRecorder()
	h.RefreshProfile(rec, postReq())

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	assertJSONContentType(t, rec)

	// The Tesla fields must be mapped onto the persisted model verbatim.
	if store.upsertCalls != 1 {
		t.Fatalf("Upsert calls = %d, want 1", store.upsertCalls)
	}
	if store.gotUpsert == nil {
		t.Fatal("nothing was upserted")
	}
	if store.gotUpsert.Email != "grace@example.com" {
		t.Fatalf("upserted email = %q, want grace@example.com", store.gotUpsert.Email)
	}
	if store.gotUpsert.FullName != "Grace Hopper" {
		t.Fatalf("upserted full_name = %q, want Grace Hopper", store.gotUpsert.FullName)
	}
	if store.gotUpsert.ProfileImageURL == nil || *store.gotUpsert.ProfileImageURL != "https://tesla.example/g.png" {
		t.Fatalf("upserted profile_image_url = %v, want https://tesla.example/g.png", store.gotUpsert.ProfileImageURL)
	}

	// The refresh response reuses the read path, so it must echo the freshly
	// saved data plus the stamped fetched_at.
	pr := decodeEnvelope(t, rec)
	if pr.Profile == nil {
		t.Fatalf("response profile is null: %s", rec.Body.String())
	}
	if pr.Profile.Email != "grace@example.com" {
		t.Fatalf("response email = %q, want grace@example.com", pr.Profile.Email)
	}
	if pr.Profile.ProfileImageURL == nil || *pr.Profile.ProfileImageURL != "https://tesla.example/g.png" {
		t.Fatalf("response profile_image_url = %v, want set", pr.Profile.ProfileImageURL)
	}
	if pr.FetchedAt == nil || *pr.FetchedAt != "2026-07-04T16:30:00Z" {
		t.Fatalf("response fetched_at = %v, want 2026-07-04T16:30:00Z", pr.FetchedAt)
	}
	if store.getCalls != 1 {
		t.Fatalf("Get calls = %d, want 1 (refresh re-reads once)", store.getCalls)
	}
}

// TestHandler_RefreshProfile_NullImage verifies an absent profile_image_url in
// the Tesla payload round-trips as a nil pointer (JSON null), not "".
func TestHandler_RefreshProfile_NullImage(t *testing.T) {
	client := &fakeProfileClient{
		hasToken: true,
		status:   http.StatusOK,
		body:     teslaProfileBody(t, "linus@example.com", "Linus T", nil),
	}
	store := &fakeProfileStore{reflectUpsert: true, stampFetchedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	h := newTestHandler(client, store)

	rec := httptest.NewRecorder()
	h.RefreshProfile(rec, postReq())

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if store.gotUpsert == nil {
		t.Fatal("nothing was upserted")
	}
	if store.gotUpsert.ProfileImageURL != nil {
		t.Fatalf("upserted profile_image_url = %q, want nil", *store.gotUpsert.ProfileImageURL)
	}
	if !strings.Contains(rec.Body.String(), `"profile_image_url":null`) {
		t.Fatalf("expected null profile_image_url in body: %s", rec.Body.String())
	}
}
