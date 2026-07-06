package geocode

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/geocoding"
)

// ── Test doubles ───────────────────────────────────────────────────────────────
//
// The handler depends only on the geocoding.Searcher and geocoding.Geocoder
// ports, so these in-memory fakes fully exercise it without touching the
// network, Nominatim, Google, or Azure. Each fake records what the handler
// passed through (query, limit, coordinates, and whether the context carried a
// deadline) so the tests can assert the handler's plumbing and hardening.

type fakeSearcher struct {
	results []geocoding.SearchResult
	err     error

	calls       int
	gotQuery    string
	gotLimit    int
	gotDeadline bool
}

func (f *fakeSearcher) Search(ctx context.Context, query string, limit int) ([]geocoding.SearchResult, error) {
	f.calls++
	f.gotQuery = query
	f.gotLimit = limit
	_, f.gotDeadline = ctx.Deadline()
	return f.results, f.err
}

type fakeGeocoder struct {
	result *geocoding.GeoResult
	err    error

	calls       int
	gotLat      float64
	gotLon      float64
	gotDeadline bool
}

func (f *fakeGeocoder) ReverseGeocode(ctx context.Context, lat, lon float64) (*geocoding.GeoResult, error) {
	f.calls++
	f.gotLat = lat
	f.gotLon = lon
	_, f.gotDeadline = ctx.Deadline()
	return f.result, f.err
}

// decodeErr pulls {error, code} out of an httpx error envelope.
func decodeErr(t *testing.T, body []byte) map[string]string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("decode error body: %v\nbody=%s", err, string(body))
	}
	return m
}

// ── Constructor ────────────────────────────────────────────────────────────────

func TestNewHandler_WiresDependencies(t *testing.T) {
	s := &fakeSearcher{}
	g := &fakeGeocoder{}
	h := NewHandler(s, g)

	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
	if h.searcher != s {
		t.Error("searcher not wired through constructor")
	}
	if h.geocoder != g {
		t.Error("geocoder not wired through constructor")
	}
}

// ── parseSearchLimit ───────────────────────────────────────────────────────────

func TestParseSearchLimit_ClampsToRange(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want int
	}{
		{"missing", "", defaultSearchLimit},
		{"non-numeric", "abc", defaultSearchLimit},
		{"float", "3.5", defaultSearchLimit},
		{"leading space", " 3", defaultSearchLimit},
		{"trailing space", "3 ", defaultSearchLimit},
		{"zero", "0", defaultSearchLimit},
		{"negative", "-1", defaultSearchLimit},
		{"very negative", "-999", defaultSearchLimit},
		{"one", "1", 1},
		{"mid", "3", 3},
		{"default value", "5", 5},
		{"max inclusive", "10", maxSearchLimit},
		{"just over max", "11", defaultSearchLimit},
		{"way over max", "1000", defaultSearchLimit},
		{"overflow", "99999999999999999999", defaultSearchLimit},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := parseSearchLimit(tc.raw); got != tc.want {
				t.Errorf("parseSearchLimit(%q) = %d, want %d", tc.raw, got, tc.want)
			}
		})
	}
}

// ── Search: empty query short-circuit ──────────────────────────────────────────

func TestSearch_EmptyQueryReturnsEmptyArray(t *testing.T) {
	cases := []struct {
		name string
		url  string
	}{
		{"no q param", "/geocode/search"},
		{"empty q", "/geocode/search?q="},
		{"empty q with limit", "/geocode/search?q=&limit=7"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &fakeSearcher{results: []geocoding.SearchResult{{DisplayName: "should not surface"}}}
			h := NewHandler(s, &fakeGeocoder{})

			rec := httptest.NewRecorder()
			h.Search(rec, httptest.NewRequest(http.MethodGet, tc.url, nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != "[]" {
				t.Errorf("body = %q, want []", got)
			}
			if s.calls != 0 {
				t.Errorf("searcher called %d times for empty query, want 0", s.calls)
			}
		})
	}
}

// ── Search: limit forwarding / clamping end-to-end ─────────────────────────────

func TestSearch_ForwardsQueryAndClampedLimit(t *testing.T) {
	cases := []struct {
		name      string
		url       string
		wantQuery string
		wantLimit int
	}{
		{"default when absent", "/geocode/search?q=seattle", "seattle", defaultSearchLimit},
		{"explicit valid", "/geocode/search?q=seattle&limit=3", "seattle", 3},
		{"max", "/geocode/search?q=seattle&limit=10", "seattle", maxSearchLimit},
		{"over max clamps to default", "/geocode/search?q=seattle&limit=50", "seattle", defaultSearchLimit},
		{"zero clamps to default", "/geocode/search?q=seattle&limit=0", "seattle", defaultSearchLimit},
		{"negative clamps to default", "/geocode/search?q=seattle&limit=-4", "seattle", defaultSearchLimit},
		{"garbage clamps to default", "/geocode/search?q=seattle&limit=abc", "seattle", defaultSearchLimit},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &fakeSearcher{results: []geocoding.SearchResult{}}
			h := NewHandler(s, &fakeGeocoder{})

			rec := httptest.NewRecorder()
			h.Search(rec, httptest.NewRequest(http.MethodGet, tc.url, nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			if s.calls != 1 {
				t.Fatalf("searcher calls = %d, want 1", s.calls)
			}
			if s.gotQuery != tc.wantQuery {
				t.Errorf("forwarded query = %q, want %q", s.gotQuery, tc.wantQuery)
			}
			if s.gotLimit != tc.wantLimit {
				t.Errorf("forwarded limit = %d, want %d", s.gotLimit, tc.wantLimit)
			}
		})
	}
}

// ── Search: success payload shape ──────────────────────────────────────────────

func TestSearch_SuccessReturnsResults(t *testing.T) {
	want := []geocoding.SearchResult{
		{DisplayName: "Seattle, WA, USA", Lat: 47.6062, Lng: -122.3321},
		{DisplayName: "Seattle, Missouri, USA", Lat: 40.4051, Lng: -92.0763},
	}
	s := &fakeSearcher{results: want}
	h := NewHandler(s, &fakeGeocoder{})

	rec := httptest.NewRecorder()
	h.Search(rec, httptest.NewRequest(http.MethodGet, "/geocode/search?q=seattle", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var got []geocoding.SearchResult
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode body: %v\nbody=%s", err, rec.Body.String())
	}
	if len(got) != len(want) {
		t.Fatalf("got %d results, want %d", len(got), len(want))
	}
	if got[0].DisplayName != want[0].DisplayName || got[0].Lat != want[0].Lat || got[0].Lng != want[0].Lng {
		t.Errorf("result[0] = %+v, want %+v", got[0], want[0])
	}
}

// ── Search: nil result normalises to an empty JSON array ───────────────────────

func TestSearch_NilResultsBecomesEmptyArray(t *testing.T) {
	// A searcher returning (nil, nil) must serialise as "[]" and never as
	// "null", so the SPA can always .map() over the payload.
	s := &fakeSearcher{results: nil}
	h := NewHandler(s, &fakeGeocoder{})

	rec := httptest.NewRecorder()
	h.Search(rec, httptest.NewRequest(http.MethodGet, "/geocode/search?q=nowhere", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != "[]" {
		t.Errorf("body = %q, want [] (never null)", got)
	}
}

// ── Search: upstream error surfaces as 500 ─────────────────────────────────────

func TestSearch_SearcherErrorReturns500(t *testing.T) {
	s := &fakeSearcher{err: errors.New("nominatim unavailable")}
	h := NewHandler(s, &fakeGeocoder{})

	rec := httptest.NewRecorder()
	h.Search(rec, httptest.NewRequest(http.MethodGet, "/geocode/search?q=seattle", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	body := decodeErr(t, rec.Body.Bytes())
	if body["error"] != "geocode search failed" {
		t.Errorf("error = %q, want %q", body["error"], "geocode search failed")
	}
	if body["code"] != "INTERNAL_ERROR" {
		t.Errorf("code = %q, want INTERNAL_ERROR", body["code"])
	}
}

// ── Search: hardening — external call is bounded by a deadline ──────────────────

func TestSearch_AppliesContextDeadline(t *testing.T) {
	s := &fakeSearcher{results: []geocoding.SearchResult{}}
	h := NewHandler(s, &fakeGeocoder{})

	rec := httptest.NewRecorder()
	h.Search(rec, httptest.NewRequest(http.MethodGet, "/geocode/search?q=seattle", nil))

	if !s.gotDeadline {
		t.Error("expected searcher to receive a context with a deadline (timeout hardening)")
	}
}

// ── Reverse: invalid coordinates → 400 without touching the geocoder ───────────

func TestReverse_InvalidCoordinatesReturns400(t *testing.T) {
	cases := []struct {
		name string
		url  string
	}{
		{"both missing", "/geocode/reverse"},
		{"lat missing", "/geocode/reverse?lon=-122.33"},
		{"lon missing", "/geocode/reverse?lat=47.60"},
		{"lat empty", "/geocode/reverse?lat=&lon=-122.33"},
		{"lon empty", "/geocode/reverse?lat=47.60&lon="},
		{"lat non-numeric", "/geocode/reverse?lat=north&lon=-122.33"},
		{"lon non-numeric", "/geocode/reverse?lat=47.60&lon=west"},
		{"both non-numeric", "/geocode/reverse?lat=x&lon=y"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			g := &fakeGeocoder{result: &geocoding.GeoResult{City: "should not surface"}}
			h := NewHandler(&fakeSearcher{}, g)

			rec := httptest.NewRecorder()
			h.Reverse(rec, httptest.NewRequest(http.MethodGet, tc.url, nil))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", rec.Code)
			}
			body := decodeErr(t, rec.Body.Bytes())
			if body["code"] != "BAD_REQUEST" {
				t.Errorf("code = %q, want BAD_REQUEST", body["code"])
			}
			if !strings.Contains(body["error"], "lat and lon") {
				t.Errorf("error = %q, want mention of lat and lon", body["error"])
			}
			if g.calls != 0 {
				t.Errorf("geocoder called %d times on invalid input, want 0", g.calls)
			}
		})
	}
}

// ── Reverse: success payload shape + coordinate parsing ────────────────────────

func TestReverse_SuccessReturnsMappedFields(t *testing.T) {
	g := &fakeGeocoder{result: &geocoding.GeoResult{
		DisplayName: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
		Road:        "Amphitheatre Pkwy",
		City:        "Mountain View",
		State:       "California",
		Country:     "United States",
		PostCode:    "94043",
	}}
	h := NewHandler(&fakeSearcher{}, g)

	rec := httptest.NewRecorder()
	h.Reverse(rec, httptest.NewRequest(http.MethodGet, "/geocode/reverse?lat=37.4224&lon=-122.0841", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	// Coordinates must be parsed and forwarded verbatim.
	if g.gotLat != 37.4224 || g.gotLon != -122.0841 {
		t.Errorf("forwarded coords = (%v, %v), want (37.4224, -122.0841)", g.gotLat, g.gotLon)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v\nbody=%s", err, rec.Body.String())
	}
	// display_name is derived from GeoResult.ShortName() (road + city here).
	if body["display_name"] != "Amphitheatre Pkwy, Mountain View" {
		t.Errorf("display_name = %v, want %q", body["display_name"], "Amphitheatre Pkwy, Mountain View")
	}
	if body["road"] != "Amphitheatre Pkwy" {
		t.Errorf("road = %v", body["road"])
	}
	if body["city"] != "Mountain View" {
		t.Errorf("city = %v", body["city"])
	}
	if body["state"] != "California" {
		t.Errorf("state = %v", body["state"])
	}
	if body["country"] != "United States" {
		t.Errorf("country = %v", body["country"])
	}
	if body["postcode"] != "94043" {
		t.Errorf("postcode = %v", body["postcode"])
	}
}

// ── Reverse: display_name follows ShortName()'s fallback chain ──────────────────

func TestReverse_DisplayNameFollowsShortName(t *testing.T) {
	longName := strings.Repeat("x", 80)
	cases := []struct {
		name   string
		result geocoding.GeoResult
		want   string
	}{
		{"road and city", geocoding.GeoResult{Road: "Main St", City: "Springfield"}, "Main St, Springfield"},
		{"city only", geocoding.GeoResult{City: "Springfield"}, "Springfield"},
		{"road without city falls to display name", geocoding.GeoResult{Road: "Main St", DisplayName: "Fallback"}, "Fallback"},
		{"display name short", geocoding.GeoResult{DisplayName: "Just A Place"}, "Just A Place"},
		{"display name truncated", geocoding.GeoResult{DisplayName: longName}, longName[:60] + "..."},
		{"all empty", geocoding.GeoResult{}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := tc.result
			g := &fakeGeocoder{result: &res}
			h := NewHandler(&fakeSearcher{}, g)

			rec := httptest.NewRecorder()
			h.Reverse(rec, httptest.NewRequest(http.MethodGet, "/geocode/reverse?lat=1&lon=2", nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			var body map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if body["display_name"] != tc.want {
				t.Errorf("display_name = %v, want %q", body["display_name"], tc.want)
			}
		})
	}
}

// ── Reverse: coordinate boundary values are accepted verbatim ──────────────────

func TestReverse_CoordinateBoundariesReachGeocoder(t *testing.T) {
	cases := []struct {
		name    string
		url     string
		wantLat float64
		wantLon float64
	}{
		{"origin", "/geocode/reverse?lat=0&lon=0", 0, 0},
		{"max nw", "/geocode/reverse?lat=90&lon=-180", 90, -180},
		{"max se", "/geocode/reverse?lat=-90&lon=180", -90, 180},
		{"high precision", "/geocode/reverse?lat=47.606210&lon=-122.332069", 47.606210, -122.332069},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			g := &fakeGeocoder{result: &geocoding.GeoResult{City: "Somewhere"}}
			h := NewHandler(&fakeSearcher{}, g)

			rec := httptest.NewRecorder()
			h.Reverse(rec, httptest.NewRequest(http.MethodGet, tc.url, nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			if g.calls != 1 {
				t.Fatalf("geocoder calls = %d, want 1", g.calls)
			}
			if g.gotLat != tc.wantLat || g.gotLon != tc.wantLon {
				t.Errorf("forwarded coords = (%v, %v), want (%v, %v)", g.gotLat, g.gotLon, tc.wantLat, tc.wantLon)
			}
		})
	}
}

// ── Reverse: geocoder error surfaces as 500 ────────────────────────────────────

func TestReverse_GeocoderErrorReturns500(t *testing.T) {
	g := &fakeGeocoder{err: errors.New("all geocoders failed")}
	h := NewHandler(&fakeSearcher{}, g)

	rec := httptest.NewRecorder()
	h.Reverse(rec, httptest.NewRequest(http.MethodGet, "/geocode/reverse?lat=47.6&lon=-122.3", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	body := decodeErr(t, rec.Body.Bytes())
	if body["error"] != "reverse geocode failed" {
		t.Errorf("error = %q, want %q", body["error"], "reverse geocode failed")
	}
	if body["code"] != "INTERNAL_ERROR" {
		t.Errorf("code = %q, want INTERNAL_ERROR", body["code"])
	}
}

// ── Reverse: the nil-result guard (regression for a nil-deref panic) ───────────

func TestReverse_NilResultReturns500NoPanic(t *testing.T) {
	// A geocoder that reports success (err == nil) but returns a nil
	// *GeoResult previously caused ShortName() to dereference nil and panic.
	// The handler must now translate that contract violation into a clean 500.
	g := &fakeGeocoder{result: nil, err: nil}
	h := NewHandler(&fakeSearcher{}, g)

	rec := httptest.NewRecorder()
	h.Reverse(rec, httptest.NewRequest(http.MethodGet, "/geocode/reverse?lat=47.6&lon=-122.3", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if g.calls != 1 {
		t.Errorf("geocoder calls = %d, want 1", g.calls)
	}
	body := decodeErr(t, rec.Body.Bytes())
	if body["code"] != "INTERNAL_ERROR" {
		t.Errorf("code = %q, want INTERNAL_ERROR", body["code"])
	}
}

// ── Reverse: hardening — external call is bounded by a deadline ─────────────────

func TestReverse_AppliesContextDeadline(t *testing.T) {
	g := &fakeGeocoder{result: &geocoding.GeoResult{City: "Seattle"}}
	h := NewHandler(&fakeSearcher{}, g)

	rec := httptest.NewRecorder()
	h.Reverse(rec, httptest.NewRequest(http.MethodGet, "/geocode/reverse?lat=47.6&lon=-122.3", nil))

	if !g.gotDeadline {
		t.Error("expected geocoder to receive a context with a deadline (timeout hardening)")
	}
}

// ── Reverse: a cancelled parent context propagates to the geocoder ─────────────

func TestReverse_PropagatesRequestCancellation(t *testing.T) {
	// The handler derives its bounded context from r.Context(); a cancelled
	// request context must still cancel the derived one so the provider can
	// abort promptly.
	var providerSawCancel bool
	g := &fakeGeocoder{result: &geocoding.GeoResult{City: "Seattle"}}
	h := NewHandler(&fakeSearcher{}, g)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel before dispatch
	req := httptest.NewRequest(http.MethodGet, "/geocode/reverse?lat=47.6&lon=-122.3", nil).WithContext(ctx)

	// Wrap the geocoder to observe the derived context's Done channel.
	observing := &observingGeocoder{inner: g, saw: &providerSawCancel}
	h = NewHandler(&fakeSearcher{}, observing)

	rec := httptest.NewRecorder()
	h.Reverse(rec, req)

	if !providerSawCancel {
		t.Error("expected derived context to be cancelled when the request context is cancelled")
	}
}

type observingGeocoder struct {
	inner *fakeGeocoder
	saw   *bool
}

func (o *observingGeocoder) ReverseGeocode(ctx context.Context, lat, lon float64) (*geocoding.GeoResult, error) {
	select {
	case <-ctx.Done():
		*o.saw = true
	default:
	}
	return o.inner.ReverseGeocode(ctx, lat, lon)
}
