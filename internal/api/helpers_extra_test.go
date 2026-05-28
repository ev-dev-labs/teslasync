package api

import (
	"net/http/httptest"
	"testing"
	"time"
)

// Tests that complement the existing api_test.go coverage.
//
// Phase R2.0a (2026-05-28): TestWriteJSONContentType,
// TestWriteErrorAllStatusCodes, and TestHttpStatusCodeMapping were
// relocated to internal/api/httpx/json_test.go alongside the
// canonical exported helpers they exercise. The pagination /
// parseDateRange tests remain here for now and move with the
// apiparams carve (Phase R2.0b).

func TestPaginationBoundary(t *testing.T) {
	r := httptest.NewRequest("GET", "/test?limit=1000", nil)
	limit, _ := pagination(r)
	if limit != 1000 {
		t.Errorf("limit = %d, want 1000 (max allowed)", limit)
	}

	r2 := httptest.NewRequest("GET", "/test?limit=1001", nil)
	limit2, _ := pagination(r2)
	if limit2 != 50 {
		t.Errorf("limit = %d, want 50 (fallback for over-max)", limit2)
	}
}

func TestParseDateRangePartial(t *testing.T) {
	r := httptest.NewRequest("GET", "/test?start=2024-06-15", nil)
	start, end := parseDateRange(r)
	if start.IsZero() {
		t.Error("start should not be zero")
	}
	if !end.IsZero() {
		t.Error("end should be zero when not provided")
	}
}

func TestParseDateRangeInvalid(t *testing.T) {
	r := httptest.NewRequest("GET", "/test?start=invalid&end=also-invalid", nil)
	start, end := parseDateRange(r)
	if !start.IsZero() {
		t.Error("start should be zero for invalid format")
	}
	if !end.IsZero() {
		t.Error("end should be zero for invalid format")
	}
}

// TestParseDateRangeRFC3339 verifies the RFC 3339 instant path used by
// new UI surfaces (FSM Debugger and incrementally other range pickers).
// The FE convention is: send `start` as the local midnight of the first
// calendar day and `end` as the local midnight of the day AFTER the last
// calendar day (exclusive). The handler subtracts one microsecond from
// the end so the existing `ts BETWEEN $2 AND $3` SQL filter picks the
// rows in `[start, exclusiveEnd)` without including the boundary
// instant itself. This is the bug-fix path for "missing today's
// transitions" — a PST user's evening rows landed in next-day UTC and
// were dropped by the legacy YYYY-MM-DD/UTC interpretation.
func TestParseDateRangeRFC3339(t *testing.T) {
	r := httptest.NewRequest("GET",
		"/test?start=2026-05-06T00:00:00-07:00&end=2026-05-13T00:00:00-07:00", nil)
	start, end := parseDateRange(r)
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

// TestParseDateRangeRFC3339IncludesPSTEvening proves the bug fix: a row
// at 2026-05-13T02:54Z (a PST user's 19:54 today drive) must fall
// inside a `[2026-05-06 PST, 2026-05-13 PST)` filter, which the legacy
// UTC-only interpretation excluded.
func TestParseDateRangeRFC3339IncludesPSTEvening(t *testing.T) {
	r := httptest.NewRequest("GET",
		"/test?start=2026-05-06T00:00:00-07:00&end=2026-05-13T00:00:00-07:00", nil)
	start, end := parseDateRange(r)
	row, _ := time.Parse(time.RFC3339, "2026-05-13T02:54:12Z")
	if row.Before(start) || row.After(end) {
		t.Errorf("PST-evening row %s should fall within [%s, %s]", row, start, end)
	}
}

// TestParseDateRangeLegacyEndOfDay verifies the YYYY-MM-DD path keeps
// its inclusive end-of-day UTC semantics so existing callers (audit,
// fixed reports) are not affected by the RFC 3339 enhancement.
func TestParseDateRangeLegacyEndOfDay(t *testing.T) {
	r := httptest.NewRequest("GET", "/test?start=2024-06-15&end=2024-06-15", nil)
	start, end := parseDateRange(r)
	if start.Hour() != 0 || start.Minute() != 0 || start.Second() != 0 {
		t.Errorf("legacy start should be 00:00:00, got %s", start)
	}
	if end.Hour() != 23 || end.Minute() != 59 || end.Second() != 59 {
		t.Errorf("legacy end should be 23:59:59, got %s", end)
	}
}

// Phase R2.0a (2026-05-28): TestHttpStatusCodeMapping was relocated to
// internal/api/httpx/json_test.go.
