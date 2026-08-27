package apiparams

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/go-chi/chi/v5"
)

// Pagination extracts limit/offset from query params with safe defaults.
//
// Defaults: limit=50, offset=0. Limit is capped at 1000 (over-cap
// fallback returns the default 50, not the cap). Negative or
// non-integer values are silently ignored — handlers get safe defaults
// rather than 400s for malformed pagination. This trade-off keeps
// dashboards from breaking on bookmark-rewriting browser extensions
// while still rejecting payloads that intentionally probe for limits.
//
// New code MUST call apiparams.Pagination directly. The lowercase
// pagination wrapper in internal/api/helpers.go is a transitional
// shim drained by the R2a-R2e waves.
func Pagination(r *http.Request) (limit, offset int) {
	limit = 50
	offset = 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if l, err := strconv.Atoi(v); err == nil && l > 0 && l <= 1000 {
			limit = l
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if o, err := strconv.Atoi(v); err == nil && o >= 0 {
			offset = o
		}
	}
	return
}

// URLParamInt64 extracts a chi URL param and parses it as int64.
//
// Returns 0 + a strconv.ParseInt error if the param is missing,
// non-numeric, or out of range. Callers MUST check the error and
// respond with a 400 — silently treating a parse error as zero is a
// security footgun (URL `/vehicles/abc/state` would otherwise fetch
// vehicle 0).
//
// Must be called from a handler mounted behind a chi router that
// declares the matching {key} URL param. Tests use
// chi.NewRouteContext + req.WithContext to inject the param.
func URLParamInt64(r *http.Request, key string) (int64, error) {
	return strconv.ParseInt(chi.URLParam(r, key), 10, 64)
}

// HTTPStatusCode maps an HTTP status code to the shared machine-readable error code.
func HTTPStatusCode(status int) string {
	return httpx.HTTPStatusCode(status)
}

// ParseDateRange extracts optional start/end date query params.
//
// Two formats are accepted, in this order of precedence per parameter:
//
//  1. RFC 3339 instants (e.g. "2026-05-13T07:00:00Z") — used verbatim
//     for `start`. For `end`, the FE convention is to send the next
//     local midnight (i.e. an EXCLUSIVE upper bound) so the window
//     spans `[start, end)` in calendar-day terms. Existing handlers
//     filter with `ts BETWEEN $2 AND $3` (inclusive); to keep that
//     contract working we subtract 1 microsecond from the RFC 3339
//     end so the boundary instant itself is excluded. Net effect:
//     callers get correct `[start, next_local_midnight)` semantics
//     regardless of which SQL operator they use. This is the form
//     the React `useRangeState` hook produces via its
//     `startInstant` / `endInstantExclusive` outputs and is the
//     recommended shape for all new UI surfaces.
//
//  2. Date-only "YYYY-MM-DD" — backward-compatible legacy form. Parsed
//     as UTC midnight (start) / UTC end-of-day (end, inclusive).
//     Suitable for fixed-window reports and audit endpoints that
//     don't care about timezone. New UI surfaces should switch to
//     RFC 3339 instants — the legacy form silently dropped today's
//     local rows for any user east or west of UTC (e.g. a PST user's
//     evening drives recorded at next-day UTC).
//
// Missing or unparseable values return zero times; callers detect
// "filter unspecified" via .IsZero() and typically combine with
// NullableTime + a `$N::timestamptz IS NULL OR ts >= $N` SQL guard.
func ParseDateRange(r *http.Request) (startTime, endTime time.Time) {
	startTime, _, _ = ParseDateRangeValues(r.URL.Query().Get("start"), "")
	_, endTime, _ = ParseDateRangeValues("", r.URL.Query().Get("end"))
	return
}

// ParseDateRangeValues parses optional start/end bounds while rejecting invalid
// supplied values. It preserves ParseDateRange's inclusive SQL semantics:
// RFC3339 end values are exclusive API boundaries converted to inclusive SQL
// values, while date-only end values include the full UTC calendar day.
//
// ParseDateRange remains available for legacy handlers that intentionally
// treat malformed optional filters as absent. New bounded endpoints should
// use this function and return its validation error to callers.
func ParseDateRangeValues(startRaw, endRaw string) (startTime, endTime time.Time, err error) {
	if raw := strings.TrimSpace(startRaw); raw != "" {
		startTime, err = parseDateBound(raw, false)
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("start must be an RFC3339 timestamp or YYYY-MM-DD date")
		}
	}
	if raw := strings.TrimSpace(endRaw); raw != "" {
		endTime, err = parseDateBound(raw, true)
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("end must be an RFC3339 timestamp or YYYY-MM-DD date")
		}
	}
	if err := ValidateDateRange(startTime, endTime, 0); err != nil {
		return time.Time{}, time.Time{}, err
	}
	return startTime, endTime, nil
}

func parseDateBound(raw string, isEnd bool) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		if isEnd {
			return t.Add(-time.Microsecond), nil
		}
		return t, nil
	}
	t, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return time.Time{}, err
	}
	if isEnd {
		return t.Add(24*time.Hour - time.Second), nil
	}
	return t, nil
}

// ValidateDateRange verifies chronological ordering and, when maxSpan is
// non-zero, caps a fully bounded range. Callers that accept one-sided ranges
// should materialize the missing boundary first so expensive reads are also
// bounded before calling this helper.
func ValidateDateRange(startTime, endTime time.Time, maxSpan time.Duration) error {
	if !startTime.IsZero() && !endTime.IsZero() && startTime.After(endTime) {
		return fmt.Errorf("start must not be after end")
	}
	if maxSpan > 0 && !startTime.IsZero() && !endTime.IsZero() && endTime.Sub(startTime) > maxSpan {
		return fmt.Errorf("requested date range exceeds maximum of %d days", int(maxSpan.Hours()/24))
	}
	return nil
}

// SetPaginationHeaders publishes additive pagination metadata for endpoints
// that retain their historical top-level JSON array response. This avoids a
// breaking envelope migration while letting clients reliably reconstruct the
// page request. A full page is conservatively marked as possibly truncated;
// callers must not treat it as proof that another page exists.
func SetPaginationHeaders(w http.ResponseWriter, limit, offset, returned int) {
	w.Header().Set("X-Pagination-Limit", strconv.Itoa(limit))
	w.Header().Set("X-Pagination-Offset", strconv.Itoa(offset))
	w.Header().Set("X-Pagination-Returned", strconv.Itoa(returned))
	w.Header().Set("X-Result-Possibly-Truncated", strconv.FormatBool(limit > 0 && returned >= limit))
}

// NullableTime returns t when use is true, otherwise an interface-typed
// nil suitable for passing to pgx.Query. Combined with `$N::timestamptz
// IS NULL` SQL guards this lets a single prepared statement express
// "scope by [start, end] when supplied; full-history when not".
//
// The typed-interface nil (instead of a typed `time.Time` zero) is
// essential: pgx's `$N::timestamptz IS NULL` only matches when the
// value is interface{}(nil), NOT when it's a zero time.Time. Passing
// the zero value would silently produce queries like
// `WHERE ts >= '0001-01-01'` and match every row.
func NullableTime(use bool, t time.Time) interface{} {
	if !use {
		return nil
	}
	return t
}
