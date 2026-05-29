package apiparams_test

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
)

// Pagination tests were relocated from parent API tests.

func TestPagination_DefaultsAndBounds(t *testing.T) {
	tests := []struct {
		query     string
		wantLimit int
		wantOff   int
	}{
		{"", 50, 0},
		{"?limit=10", 10, 0},
		{"?limit=10&offset=20", 10, 20},
		{"?limit=2000", 50, 0}, // exceeds max, uses default
		{"?limit=-5", 50, 0},   // negative, uses default
		{"?limit=abc", 50, 0},  // invalid, uses default
		{"?offset=-1", 50, 0},  // negative offset, uses default
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/test"+tt.query, nil)
			limit, offset := apiparams.Pagination(r)
			if limit != tt.wantLimit {
				t.Errorf("limit = %d, want %d", limit, tt.wantLimit)
			}
			if offset != tt.wantOff {
				t.Errorf("offset = %d, want %d", offset, tt.wantOff)
			}
		})
	}
}

func TestPagination_Defaults(t *testing.T) {
	req := httptest.NewRequest("GET", "/test", nil)
	limit, offset := apiparams.Pagination(req)
	if limit != 50 {
		t.Errorf("expected default limit 50, got %d", limit)
	}
	if offset != 0 {
		t.Errorf("expected default offset 0, got %d", offset)
	}
}

func TestPagination_CustomValues(t *testing.T) {
	req := httptest.NewRequest("GET", "/test?limit=25&offset=10", nil)
	limit, offset := apiparams.Pagination(req)
	if limit != 25 {
		t.Errorf("expected limit 25, got %d", limit)
	}
	if offset != 10 {
		t.Errorf("expected offset 10, got %d", offset)
	}
}

func TestPagination_InvalidValues(t *testing.T) {
	req := httptest.NewRequest("GET", "/test?limit=abc&offset=-5", nil)
	limit, offset := apiparams.Pagination(req)
	if limit != 50 {
		t.Errorf("expected default limit 50 for invalid input, got %d", limit)
	}
	if offset != 0 {
		t.Errorf("expected default offset 0 for negative input, got %d", offset)
	}
}

func TestPagination_ExceedsMax(t *testing.T) {
	req := httptest.NewRequest("GET", "/test?limit=5000", nil)
	limit, _ := apiparams.Pagination(req)
	if limit != 50 {
		t.Errorf("expected default limit 50 for over-max input, got %d", limit)
	}
}

// TestPagination_BoundaryAtMax pins the 1000 cap (the largest value
// that is NOT rejected). Reducing this cap would silently truncate
// dashboard table page sizes for power users.
func TestPagination_BoundaryAtMax(t *testing.T) {
	r := httptest.NewRequest("GET", "/test?limit=1000", nil)
	limit, _ := apiparams.Pagination(r)
	if limit != 1000 {
		t.Errorf("limit = %d, want 1000 (max allowed)", limit)
	}

	r2 := httptest.NewRequest("GET", "/test?limit=1001", nil)
	limit2, _ := apiparams.Pagination(r2)
	if limit2 != 50 {
		t.Errorf("limit = %d, want 50 (fallback for over-max)", limit2)
	}
}

// ParseDateRange tests were relocated from parent API tests.

func TestParseDateRange_Partial(t *testing.T) {
	r := httptest.NewRequest("GET", "/test?start=2024-06-15", nil)
	start, end := apiparams.ParseDateRange(r)
	if start.IsZero() {
		t.Error("start should not be zero")
	}
	if !end.IsZero() {
		t.Error("end should be zero when not provided")
	}
}

func TestParseDateRange_Invalid(t *testing.T) {
	r := httptest.NewRequest("GET", "/test?start=invalid&end=also-invalid", nil)
	start, end := apiparams.ParseDateRange(r)
	if !start.IsZero() {
		t.Error("start should be zero for invalid format")
	}
	if !end.IsZero() {
		t.Error("end should be zero for invalid format")
	}
}

// TestParseDateRange_RFC3339 verifies the RFC 3339 instant path used
// by new UI surfaces (FSM Debugger and incrementally other range
// pickers). FE convention: `start` is local midnight of the first
// calendar day; `end` is local midnight of the day AFTER the last
// calendar day (exclusive). Handler subtracts one microsecond from
// `end` so existing `ts BETWEEN $2 AND $3` SQL picks rows in
// `[start, exclusiveEnd)` without including the boundary instant.
// This is the bug-fix path for "missing today's transitions" — a PST
// user's evening rows landed in next-day UTC and were dropped by the
// legacy YYYY-MM-DD/UTC interpretation.
func TestParseDateRange_RFC3339(t *testing.T) {
	r := httptest.NewRequest("GET",
		"/test?start=2026-05-06T00:00:00-07:00&end=2026-05-13T00:00:00-07:00", nil)
	start, end := apiparams.ParseDateRange(r)
	wantStart, _ := time.Parse(time.RFC3339, "2026-05-06T00:00:00-07:00")
	if !start.Equal(wantStart) {
		t.Errorf("start = %s, want %s", start, wantStart)
	}
	wantEnd, _ := time.Parse(time.RFC3339, "2026-05-13T00:00:00-07:00")
	wantEnd = wantEnd.Add(-time.Microsecond)
	if !end.Equal(wantEnd) {
		t.Errorf("end = %s, want %s (exclusive minus 1µs)", end, wantEnd)
	}
}

// TestParseDateRange_RFC3339IncludesPSTEvening proves the bug fix:
// a row at 2026-05-13T02:54Z (a PST user's 19:54 today drive) must
// fall inside a `[2026-05-06 PST, 2026-05-13 PST)` filter, which the
// legacy UTC-only interpretation excluded.
func TestParseDateRange_RFC3339IncludesPSTEvening(t *testing.T) {
	r := httptest.NewRequest("GET",
		"/test?start=2026-05-06T00:00:00-07:00&end=2026-05-13T00:00:00-07:00", nil)
	start, end := apiparams.ParseDateRange(r)
	row, _ := time.Parse(time.RFC3339, "2026-05-13T02:54:12Z")
	if row.Before(start) || row.After(end) {
		t.Errorf("PST-evening row %s should fall within [%s, %s]", row, start, end)
	}
}

// TestParseDateRange_LegacyEndOfDay verifies the YYYY-MM-DD path keeps
// its inclusive end-of-day UTC semantics so existing callers (audit,
// fixed reports) are not affected by the RFC 3339 enhancement.
func TestParseDateRange_LegacyEndOfDay(t *testing.T) {
	r := httptest.NewRequest("GET", "/test?start=2024-06-15&end=2024-06-15", nil)
	start, end := apiparams.ParseDateRange(r)
	if start.Hour() != 0 || start.Minute() != 0 || start.Second() != 0 {
		t.Errorf("legacy start should be 00:00:00, got %s", start)
	}
	if end.Hour() != 23 || end.Minute() != 59 || end.Second() != 59 {
		t.Errorf("legacy end should be 23:59:59, got %s", end)
	}
}

// NullableTime pins the subtle pgx interface-nil contract.

func TestNullableTime_FalseReturnsTypedNil(t *testing.T) {
	got := apiparams.NullableTime(false, time.Now())
	if got != nil {
		t.Errorf("NullableTime(false, ...) = %v, want nil interface", got)
	}
}

func TestNullableTime_TrueReturnsTime(t *testing.T) {
	ts := time.Date(2026, 5, 28, 12, 0, 0, 0, time.UTC)
	got := apiparams.NullableTime(true, ts)
	gotTs, ok := got.(time.Time)
	if !ok {
		t.Fatalf("NullableTime(true, ...) = %T, want time.Time", got)
	}
	if !gotTs.Equal(ts) {
		t.Errorf("NullableTime(true, %s) = %s, want %s", ts, gotTs, ts)
	}
}
