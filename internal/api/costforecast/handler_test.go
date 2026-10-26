package costforecast

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResolveTimezone(t *testing.T) {
	t.Parallel()

	t.Run("empty_defaults_to_utc", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		zone, ok := resolveTimezone(rec, "")
		if !ok || zone != "UTC" {
			t.Fatalf("resolveTimezone(\"\") = %q, %v; want UTC, true", zone, ok)
		}
	})

	t.Run("valid_zone_passes_through", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		zone, ok := resolveTimezone(rec, "America/Los_Angeles")
		if !ok || zone != "America/Los_Angeles" {
			t.Fatalf("resolveTimezone(LA) = %q, %v; want LA, true", zone, ok)
		}
	})

	t.Run("invalid_zone_is_bad_request", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		zone, ok := resolveTimezone(rec, "Not/AZone")
		if ok || zone != "" {
			t.Fatalf("resolveTimezone(bad) = %q, %v; want \"\", false", zone, ok)
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})

	t.Run("absurd_zone_is_bad_request", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		_, ok := resolveTimezone(rec, strings.Repeat("x", maxTimezoneLen+1))
		if ok {
			t.Fatal("overlong zone accepted, want rejection")
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})
}

func TestCostHistoricalSQLUsesCallerTimezone(t *testing.T) {
	t.Parallel()
	for _, frag := range []string{
		"DATE_TRUNC('month', started_at AT TIME ZONE $2)",
		"vehicle_id = $1",
		"cost_decimal > 0",
		"GROUP BY month",
	} {
		if !strings.Contains(costHistoricalSQL, frag) {
			t.Errorf("costHistoricalSQL missing %q\nSQL: %s", frag, costHistoricalSQL)
		}
	}
	if strings.Contains(costHistoricalSQL, "DATE_TRUNC('month', started_at)") {
		t.Error("costHistoricalSQL still buckets in the session timezone")
	}
}
