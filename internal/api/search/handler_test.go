package search

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeSearcher lets us drive the Handler without touching pgx.
//
// Each Search* method returns whatever was preloaded into the matching
// hits/err map keyed by the lowercased query string. The empty-string key
// is the catch-all default.
type fakeSearcher struct {
	mu   sync.Mutex
	hits map[string][]SearchHit
	errs map[string]error
	// callLog records which type names actually fired — used by the
	// "types filter" test to verify untouched paths.
	callLog map[string]int
}

func newFakeSearcher() *fakeSearcher {
	return &fakeSearcher{
		hits:    map[string][]SearchHit{},
		errs:    map[string]error{},
		callLog: map[string]int{},
	}
}

func (f *fakeSearcher) record(name string) {
	f.mu.Lock()
	f.callLog[name]++
	f.mu.Unlock()
}

func (f *fakeSearcher) lookup(name string) ([]SearchHit, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err, ok := f.errs[name]; ok {
		return nil, err
	}
	return f.hits[name], nil
}

func (f *fakeSearcher) SearchVehicles(_ context.Context, _ string, _ int64, _ int) ([]SearchHit, error) {
	f.record("vehicle")
	return f.lookup("vehicle")
}
func (f *fakeSearcher) SearchDrives(_ context.Context, _ string, _ int64, _ int) ([]SearchHit, error) {
	f.record("drive")
	return f.lookup("drive")
}
func (f *fakeSearcher) SearchCharging(_ context.Context, _ string, _ int64, _ int) ([]SearchHit, error) {
	f.record("charging")
	return f.lookup("charging")
}
func (f *fakeSearcher) SearchAlerts(_ context.Context, _ string, _ int64, _ int) ([]SearchHit, error) {
	f.record("alert")
	return f.lookup("alert")
}
func (f *fakeSearcher) SearchNotifications(_ context.Context, _ string, _ int64, _ int) ([]SearchHit, error) {
	f.record("notification")
	return f.lookup("notification")
}
func (f *fakeSearcher) SearchGeofences(_ context.Context, _ string, _ int64, _ int) ([]SearchHit, error) {
	f.record("geofence")
	return f.lookup("geofence")
}
func (f *fakeSearcher) SearchAutomations(_ context.Context, _ string, _ int64, _ int) ([]SearchHit, error) {
	f.record("automation")
	return f.lookup("automation")
}
func (f *fakeSearcher) SearchLocations(_ context.Context, _ string, _ int64, _ int) ([]SearchHit, error) {
	f.record("location")
	return f.lookup("location")
}
func (f *fakeSearcher) SearchTrips(_ context.Context, _ string, _ int64, _ int) ([]SearchHit, error) {
	f.record("trip")
	return f.lookup("trip")
}

// decodeSearchResp pulls {hits, query} out of a JSON response.
type searchResp struct {
	Hits  []SearchHit `json:"hits"`
	Query string      `json:"query"`
}

func decodeSearchResp(t *testing.T, body []byte) searchResp {
	t.Helper()
	var resp searchResp
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode response: %v\nbody=%s", err, string(body))
	}
	return resp
}

func newSearchTestRequest(query string, types string) *http.Request {
	url := "/api/v1/search"
	qs := []string{}
	if query != "" {
		qs = append(qs, "q="+netURLEscape(query))
	}
	if types != "" {
		qs = append(qs, "types="+netURLEscape(types))
	}
	if len(qs) > 0 {
		url += "?" + strings.Join(qs, "&")
	}
	return httptest.NewRequest(http.MethodGet, url, nil)
}

// netURLEscape is a tiny shim around net/url.QueryEscape so the tests do
// not depend on an extra import alias.
func netURLEscape(s string) string {
	return url.QueryEscape(s)
}

func TestSearchHandler_ShortQueryReturnsEmptyHits(t *testing.T) {
	cases := []string{"", " ", "a", " a "}
	for _, q := range cases {
		t.Run(fmt.Sprintf("q=%q", q), func(t *testing.T) {
			fake := newFakeSearcher()
			fake.hits["vehicle"] = []SearchHit{{Type: "vehicle", ID: 1, Title: "test"}}
			h := NewHandlerWithSearcher(fake)

			rec := httptest.NewRecorder()
			h.Search(rec, newSearchTestRequest(q, ""))

			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d", rec.Code)
			}
			resp := decodeSearchResp(t, rec.Body.Bytes())
			if len(resp.Hits) != 0 {
				t.Errorf("expected empty hits for short query, got %d", len(resp.Hits))
			}
			// Sub-searches must NOT have fired for too-short queries.
			if len(fake.callLog) != 0 {
				t.Errorf("expected no sub-search calls, got %v", fake.callLog)
			}
		})
	}
}

func TestSearchHandler_TypesFilterRunsOnlyRequested(t *testing.T) {
	fake := newFakeSearcher()
	fake.hits["vehicle"] = []SearchHit{{Type: "vehicle", ID: 1, Title: "Model 3"}}
	fake.hits["drive"] = []SearchHit{{Type: "drive", ID: 99, Title: "Home → Work"}}
	fake.hits["charging"] = []SearchHit{{Type: "charging", ID: 5, Title: "Supercharger"}}
	h := NewHandlerWithSearcher(fake)

	rec := httptest.NewRecorder()
	h.Search(rec, newSearchTestRequest("test", "vehicle,drive"))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if _, ok := fake.callLog["vehicle"]; !ok {
		t.Error("expected vehicle sub-search to fire")
	}
	if _, ok := fake.callLog["drive"]; !ok {
		t.Error("expected drive sub-search to fire")
	}
	if _, ok := fake.callLog["charging"]; ok {
		t.Error("charging sub-search should NOT have fired")
	}
	resp := decodeSearchResp(t, rec.Body.Bytes())
	if len(resp.Hits) != 2 {
		t.Errorf("expected 2 hits, got %d", len(resp.Hits))
	}
}

func TestSearchHandler_NoTypesFilterRunsAll(t *testing.T) {
	fake := newFakeSearcher()
	h := NewHandlerWithSearcher(fake)

	rec := httptest.NewRecorder()
	h.Search(rec, newSearchTestRequest("test", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if len(fake.callLog) != len(allSearchTypes) {
		t.Errorf("expected all %d sub-searches to fire, got %v", len(allSearchTypes), fake.callLog)
	}
}

func TestSearchHandler_HitsSortedByScoreDesc(t *testing.T) {
	fake := newFakeSearcher()
	fake.hits["vehicle"] = []SearchHit{
		{Type: "vehicle", ID: 1, Title: "low", Score: 0.1},
		{Type: "vehicle", ID: 2, Title: "high", Score: 0.9},
		{Type: "vehicle", ID: 3, Title: "mid", Score: 0.5},
	}
	h := NewHandlerWithSearcher(fake)

	rec := httptest.NewRecorder()
	h.Search(rec, newSearchTestRequest("test", "vehicle"))

	resp := decodeSearchResp(t, rec.Body.Bytes())
	if len(resp.Hits) != 3 {
		t.Fatalf("expected 3 hits, got %d", len(resp.Hits))
	}
	if resp.Hits[0].Score < resp.Hits[1].Score || resp.Hits[1].Score < resp.Hits[2].Score {
		t.Errorf("hits not sorted by score desc: %v", resp.Hits)
	}
	if resp.Hits[0].ID != 2 {
		t.Errorf("expected highest-score hit (ID=2) first, got ID=%d", resp.Hits[0].ID)
	}
}

func TestSearchHandler_PartialFailureStillReturnsResults(t *testing.T) {
	fake := newFakeSearcher()
	fake.errs["drive"] = errors.New("simulated db failure")
	fake.hits["vehicle"] = []SearchHit{{Type: "vehicle", ID: 1, Title: "Model 3", Score: 0.5}}
	fake.hits["charging"] = []SearchHit{{Type: "charging", ID: 7, Title: "SC", Score: 0.3}}
	h := NewHandlerWithSearcher(fake)

	rec := httptest.NewRecorder()
	h.Search(rec, newSearchTestRequest("test", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 even on partial failure, got %d", rec.Code)
	}
	resp := decodeSearchResp(t, rec.Body.Bytes())
	if len(resp.Hits) != 2 {
		t.Errorf("expected 2 surviving hits, got %d: %v", len(resp.Hits), resp.Hits)
	}
}

func TestSearchHandler_ResponseQueryEchoed(t *testing.T) {
	fake := newFakeSearcher()
	h := NewHandlerWithSearcher(fake)

	rec := httptest.NewRecorder()
	h.Search(rec, newSearchTestRequest("supercharger", ""))

	resp := decodeSearchResp(t, rec.Body.Bytes())
	if resp.Query != "supercharger" {
		t.Errorf("expected query echo, got %q", resp.Query)
	}
}

func TestRankAndCap_StableTieBreaking(t *testing.T) {
	now := time.Now().UTC()
	older := now.Add(-1 * time.Hour)
	newer := now.Add(-10 * time.Minute)

	hits := []SearchHit{
		{Type: "drive", ID: 3, Title: "drive c", Score: 0.5, When: &older},
		{Type: "drive", ID: 1, Title: "drive a", Score: 0.5, When: &newer},
		{Type: "alert", ID: 2, Title: "alert b", Score: 0.5, When: nil},
	}
	rankAndCap(hits, 50)

	// Score ties → newer When first, then nil When, then deterministic
	// fallbacks on (Type, Title, ID).
	if hits[0].ID != 1 {
		t.Errorf("expected ID=1 (newer When) first, got ID=%d", hits[0].ID)
	}
	if hits[1].ID != 3 {
		t.Errorf("expected ID=3 (older When) second, got ID=%d", hits[1].ID)
	}
	if hits[2].ID != 2 {
		t.Errorf("expected ID=2 (nil When) last, got ID=%d", hits[2].ID)
	}
}

func TestParseTypesFilter(t *testing.T) {
	cases := []struct {
		raw        string
		wantAll    bool
		wantSubset []string
	}{
		{"", true, nil},
		{"  ", true, nil},
		{",,", true, nil},
		{"vehicle", false, []string{"vehicle"}},
		{"vehicle,drive", false, []string{"vehicle", "drive"}},
		{" vehicle , drive ", false, []string{"vehicle", "drive"}},
	}
	for _, c := range cases {
		t.Run(c.raw, func(t *testing.T) {
			got := parseTypesFilter(c.raw)
			if c.wantAll {
				if len(got) != len(allSearchTypes) {
					t.Errorf("expected all types when raw=%q, got %d entries", c.raw, len(got))
				}
				return
			}
			keys := make([]string, 0, len(got))
			for k := range got {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			want := append([]string(nil), c.wantSubset...)
			sort.Strings(want)
			if strings.Join(keys, ",") != strings.Join(want, ",") {
				t.Errorf("want %v, got %v", want, keys)
			}
		})
	}
}

func TestParseSearchLimit_ClampsToBounds(t *testing.T) {
	cases := []struct {
		raw  string
		want int
	}{
		{"", defaultPerTypeLimit},
		{"abc", defaultPerTypeLimit},
		{"0", defaultPerTypeLimit},
		{"-5", defaultPerTypeLimit},
		{"3", 3},
		{fmt.Sprint(maxPerTypeLimit), maxPerTypeLimit},
		{fmt.Sprint(maxPerTypeLimit + 100), maxPerTypeLimit},
	}
	for _, c := range cases {
		if got := parseSearchLimit(c.raw); got != c.want {
			t.Errorf("parseSearchLimit(%q) = %d, want %d", c.raw, got, c.want)
		}
	}
}

func TestRecencyBonus_DecaysOverWindow(t *testing.T) {
	now := time.Now().UTC()
	if recencyBonus(time.Time{}, now) != 0 {
		t.Error("zero time should yield zero bonus")
	}
	if recencyBonus(now.Add(-8*24*time.Hour), now) != 0 {
		t.Error("ts older than 7 days should yield zero bonus")
	}
	if got := recencyBonus(now, now); got != 0.2 {
		t.Errorf("ts == now should yield 0.2 bonus, got %v", got)
	}
	mid := recencyBonus(now.Add(-3*24*time.Hour), now)
	if mid <= 0 || mid >= 0.2 {
		t.Errorf("mid-window bonus should be between 0 and 0.2, got %v", mid)
	}
}

func TestScoreText_AppliesAllSignals(t *testing.T) {
	now := time.Now().UTC()
	// idMatch only: score == 1.0 (no title overlap, no recency).
	if got := scoreText("foo", "bar", true, time.Time{}, now); got != 1.0 {
		t.Errorf("idMatch only: got %v, want 1.0", got)
	}
	// prefix: 0.5
	if got := scoreText("Hello World", "hello", false, time.Time{}, now); got != 0.5 {
		t.Errorf("prefix: got %v, want 0.5", got)
	}
	// contains: 0.2
	if got := scoreText("Hello World", "World", false, time.Time{}, now); got != 0.2 {
		t.Errorf("contains: got %v, want 0.2", got)
	}
	// idMatch + prefix + recency
	got := scoreText("Hello World", "hello", true, now, now)
	want := 1.0 + 0.5 + 0.2
	if got != want {
		t.Errorf("idMatch+prefix+recency: got %v, want %v", got, want)
	}
}

func TestDriveTitle_FallbackChain(t *testing.T) {
	cases := []struct {
		id    int64
		start string
		end   string
		want  string
	}{
		{1, "Home", "Work", "Home → Work"},
		{2, "Home", "Home", "Home"},
		{3, "Home", "", "Home"},
		{4, "", "Work", "Work"},
		{5, "", "", "Drive #5"},
	}
	for _, c := range cases {
		if got := driveTitle(c.id, c.start, c.end); got != c.want {
			t.Errorf("driveTitle(%d, %q, %q) = %q, want %q", c.id, c.start, c.end, got, c.want)
		}
	}
}

func TestTruncate_CutsAtRuneBoundary(t *testing.T) {
	if got := truncate("hello", 10); got != "hello" {
		t.Errorf("short string: got %q", got)
	}
	if got := truncate("hello world", 5); got != "hello…" {
		t.Errorf("truncated: got %q", got)
	}
}

func TestMaskedVIN(t *testing.T) {
	cases := []struct {
		vin  string
		want string
	}{
		{"", ""},
		{"AB", "AB"},
		{"5YJ3E1EA9KF123456", "VIN ····3456"},
	}
	for _, c := range cases {
		if got := maskedVIN(c.vin); got != c.want {
			t.Errorf("maskedVIN(%q) = %q, want %q", c.vin, got, c.want)
		}
	}
}
