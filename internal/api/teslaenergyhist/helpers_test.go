package teslaenergyhist

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// siteIDRequest builds a GET request whose chi route context carries the
// given {siteID} URL param, mirroring how the router injects it.
func siteIDRequest(siteID string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/tesla/energy-sites/x/energy-history", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("siteID", siteID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

// queryRequest builds a GET request with the given raw query string.
func queryRequest(rawQuery string) *http.Request {
	return httptest.NewRequest(http.MethodGet, "/x?"+rawQuery, nil)
}

// ---------------------------------------------------------------------------
// parseSiteID
// ---------------------------------------------------------------------------

func TestParseSiteID(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		siteID  string
		want    int64
		wantErr bool
	}{
		{"valid", "12345", 12345, false},
		{"valid_large", "9007199254740993", 9007199254740993, false},
		{"empty", "", 0, true},
		{"non_numeric", "abc", 0, true},
		{"float", "12.5", 0, true},
		{"zero_rejected", "0", 0, true},
		{"negative_rejected", "-5", 0, true},
		{"overflow", "99999999999999999999999999", 0, true},
		{"whitespace", " 5 ", 0, true},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := parseSiteID(siteIDRequest(tt.siteID))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error for %q, got id=%d", tt.siteID, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for %q: %v", tt.siteID, err)
			}
			if got != tt.want {
				t.Errorf("got %d, want %d", got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// energyDateRange
// ---------------------------------------------------------------------------

func TestEnergyDateRange_Defaults(t *testing.T) {
	t.Parallel()

	before := time.Now().UTC()
	since, until := energyDateRange(queryRequest(""))
	after := time.Now().UTC()

	// until defaults to "now" — must land within the call window.
	if until.Before(before) || until.After(after.Add(time.Second)) {
		t.Errorf("until = %v, want within [%v, %v]", until, before, after)
	}
	// since defaults to now-1month.
	wantSinceLo := before.AddDate(0, -1, 0).Add(-time.Second)
	wantSinceHi := after.AddDate(0, -1, 0).Add(time.Second)
	if since.Before(wantSinceLo) || since.After(wantSinceHi) {
		t.Errorf("since = %v, want ~1 month before now", since)
	}
	if !since.Before(until) {
		t.Errorf("since (%v) must be before until (%v)", since, until)
	}
}

func TestEnergyDateRange_ExplicitValues(t *testing.T) {
	t.Parallel()

	since, until := energyDateRange(queryRequest("since=2026-01-15&until=2026-02-20"))

	wantSince := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)
	if !since.Equal(wantSince) {
		t.Errorf("since = %v, want %v", since, wantSince)
	}
	// until is pushed to the last second of the requested day.
	wantUntil := time.Date(2026, 2, 20, 23, 59, 59, 0, time.UTC)
	if !until.Equal(wantUntil) {
		t.Errorf("until = %v, want %v", until, wantUntil)
	}
}

func TestEnergyDateRange_MalformedFallsBackToDefault(t *testing.T) {
	t.Parallel()

	before := time.Now().UTC()
	since, until := energyDateRange(queryRequest("since=notadate&until=alsobad"))
	after := time.Now().UTC()

	// Malformed until → keeps default "now".
	if until.Before(before) || until.After(after.Add(time.Second)) {
		t.Errorf("until = %v, want default now on malformed input", until)
	}
	// Malformed since → keeps default now-1month, NOT the zero time.
	if since.IsZero() {
		t.Errorf("since is zero — malformed input should fall back to default, not zero")
	}
	if !since.Before(until) {
		t.Errorf("since (%v) must be before until (%v)", since, until)
	}
}

func TestEnergyDateRange_OnlySince(t *testing.T) {
	t.Parallel()
	before := time.Now().UTC()
	since, until := energyDateRange(queryRequest("since=2026-03-01"))
	after := time.Now().UTC()

	if !since.Equal(time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("since = %v, want 2026-03-01", since)
	}
	if until.Before(before) || until.After(after.Add(time.Second)) {
		t.Errorf("until = %v, want default now", until)
	}
}

// ---------------------------------------------------------------------------
// energyLimit
// ---------------------------------------------------------------------------

func TestEnergyLimit(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		query string
		want  int
	}{
		{"default_absent", "", 500},
		{"valid", "limit=250", 250},
		{"lower_boundary_1", "limit=1", 1},
		{"upper_boundary_1000", "limit=1000", 1000},
		{"zero_uses_default", "limit=0", 500},
		{"negative_uses_default", "limit=-5", 500},
		{"above_max_uses_default", "limit=1001", 500},
		{"way_above_max", "limit=1000000", 500},
		{"non_numeric_uses_default", "limit=abc", 500},
		{"empty_value_uses_default", "limit=", 500},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := energyLimit(queryRequest(tt.query))
			if got != tt.want {
				t.Errorf("energyLimit(%q) = %d, want %d", tt.query, got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// refreshDateParams
// ---------------------------------------------------------------------------

func TestRefreshDateParams_Defaults(t *testing.T) {
	t.Parallel()

	beforeDate := time.Now().UTC().Format("2006-01-02")
	start, end, tz := refreshDateParams(queryRequest(""))
	afterDate := time.Now().UTC().Format("2006-01-02")

	if tz != "UTC" {
		t.Errorf("tz = %q, want UTC", tz)
	}
	if end != beforeDate && end != afterDate {
		t.Errorf("end = %q, want today (%q/%q)", end, beforeDate, afterDate)
	}
	// start defaults to a month before end; just assert it parses and precedes end.
	st, err := time.Parse("2006-01-02", start)
	if err != nil {
		t.Fatalf("start %q not a valid date: %v", start, err)
	}
	en, _ := time.Parse("2006-01-02", end)
	if !st.Before(en) {
		t.Errorf("start (%q) must be before end (%q)", start, end)
	}
}

func TestRefreshDateParams_ExplicitAndPartial(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		query     string
		wantStart string // "" means "assert non-empty / default"
		wantEnd   string
		wantTZ    string
	}{
		{
			name:      "all_explicit",
			query:     "start_date=2026-01-01&end_date=2026-06-30&time_zone=America/Los_Angeles",
			wantStart: "2026-01-01",
			wantEnd:   "2026-06-30",
			wantTZ:    "America/Los_Angeles",
		},
		{
			name:      "only_start",
			query:     "start_date=2026-01-01",
			wantStart: "2026-01-01",
			wantEnd:   "", // defaulted
			wantTZ:    "UTC",
		},
		{
			name:      "only_tz",
			query:     "time_zone=Europe/Berlin",
			wantStart: "", // defaulted
			wantEnd:   "", // defaulted
			wantTZ:    "Europe/Berlin",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			start, end, tz := refreshDateParams(queryRequest(tt.query))
			if tt.wantStart != "" && start != tt.wantStart {
				t.Errorf("start = %q, want %q", start, tt.wantStart)
			}
			if tt.wantEnd != "" && end != tt.wantEnd {
				t.Errorf("end = %q, want %q", end, tt.wantEnd)
			}
			if tz != tt.wantTZ {
				t.Errorf("tz = %q, want %q", tz, tt.wantTZ)
			}
			// Defaulted fields must never be empty.
			if start == "" || end == "" {
				t.Errorf("start/end must never be empty: start=%q end=%q", start, end)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// truncateBody
// ---------------------------------------------------------------------------

func TestTruncateBody(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		in      []byte
		wantLen int
	}{
		{"nil", nil, 0},
		{"empty", []byte{}, 0},
		{"short", []byte("hello"), 5},
		{"exactly_500", []byte(strings.Repeat("a", 500)), 500},
		{"just_over_500", []byte(strings.Repeat("a", 501)), 500},
		{"way_over_500", []byte(strings.Repeat("b", 5000)), 500},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := truncateBody(tt.in)
			if len(got) != tt.wantLen {
				t.Errorf("len(truncateBody) = %d, want %d", len(got), tt.wantLen)
			}
		})
	}
}

func TestTruncateBody_PreservesShortContent(t *testing.T) {
	t.Parallel()
	got := truncateBody([]byte(`{"error":"boom"}`))
	if got != `{"error":"boom"}` {
		t.Errorf("truncateBody altered short content: %q", got)
	}
}
