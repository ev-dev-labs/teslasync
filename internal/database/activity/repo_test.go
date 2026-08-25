package activity

import (
	"strings"
	"testing"
	"time"

	activitymodel "github.com/ev-dev-labs/teslasync/internal/models/activity"
)

// TestBuildQuery_AllKindsByDefault pins the default (no kind filter) shape:
// every domain's UNION ALL branch is present, in the fixed order AllKinds
// declares them, and the shared three positional filters ($1 vehicle_id,
// $2 start, $3 end) are referenced by every branch.
func TestBuildQuery_AllKindsByDefault(t *testing.T) {
	t.Parallel()
	query, args := buildQuery(Filters{})

	mustContain := []string{
		"FROM drives d",
		"FROM charging_sessions c",
		"FROM notification_logs nl",
		"FROM software_updates su",
		"FROM chart_annotations ca",
		"UNION ALL",
		"count(*) OVER() AS total_count",
		"duration_s, start_soc_pct, end_soc_pct, energy_added_wh, version",
		"ORDER BY occurred_at DESC, source_table ASC, source_id DESC",
		"LIMIT $4 OFFSET $5",
		"$1::bigint IS NULL",
		"$2::timestamptz IS NULL",
		"$3::timestamptz IS NULL",
	}
	for _, frag := range mustContain {
		if !strings.Contains(query, frag) {
			t.Errorf("buildQuery() missing %q\nfull SQL:\n%s", frag, query)
		}
	}

	// Default limit/offset land in args[3]/args[4] when Filters leaves them
	// unset (mirrors apiparams.Pagination defaults).
	if len(args) != 5 {
		t.Fatalf("expected 5 positional args, got %d: %#v", len(args), args)
	}
	if args[0] != nil {
		t.Errorf("expected nil vehicle_id arg when unset, got %v", args[0])
	}
	if args[1] != nil || args[2] != nil {
		t.Errorf("expected nil start/end args when unset, got %v / %v", args[1], args[2])
	}
	if got := args[3]; got != 50 {
		t.Errorf("expected default limit 50, got %v", got)
	}
	if got := args[4]; got != 0 {
		t.Errorf("expected default offset 0, got %v", got)
	}
}

// TestBuildQuery_KindFilterOmitsOtherBranches asserts the repository does
// not even query tables the caller didn't ask for — required for the
// "no N+1 / efficient composition" contract when a page only wants, say,
// drive + charging activity.
func TestBuildQuery_KindFilterOmitsOtherBranches(t *testing.T) {
	t.Parallel()
	query, _ := buildQuery(Filters{Kinds: []activitymodel.Kind{activitymodel.KindDrive}})

	if !strings.Contains(query, "FROM drives d") {
		t.Errorf("expected drives branch present:\n%s", query)
	}
	mustNotContain := []string{
		"FROM charging_sessions c",
		"FROM notification_logs nl",
		"FROM software_updates su",
		"FROM chart_annotations ca",
	}
	for _, frag := range mustNotContain {
		if strings.Contains(query, frag) {
			t.Errorf("expected %q to be omitted when Kinds=[drive]\nfull SQL:\n%s", frag, query)
		}
	}
}

// TestBuildQuery_VehicleAndDateArgsPropagate pins that a supplied
// VehicleID/Start/End land in args[0..2] verbatim (UTC-normalized for
// times), since every branch binds the same three placeholders.
func TestBuildQuery_VehicleAndDateArgsPropagate(t *testing.T) {
	t.Parallel()
	vehicleID := int64(42)
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.FixedZone("PST", -8*3600))
	end := time.Date(2026, 1, 31, 23, 59, 59, 0, time.UTC)

	_, args := buildQuery(Filters{
		VehicleID: &vehicleID,
		Start:     start,
		End:       end,
		Limit:     10,
		Offset:    5,
	})

	if args[0] != vehicleID {
		t.Errorf("expected vehicle_id arg %d, got %v", vehicleID, args[0])
	}
	gotStart, ok := args[1].(time.Time)
	if !ok || !gotStart.Equal(start) {
		t.Errorf("expected start arg %v, got %v", start, args[1])
	}
	if gotStart.Location() != time.UTC {
		t.Errorf("expected start arg normalized to UTC, got location %v", gotStart.Location())
	}
	if args[3] != 10 || args[4] != 5 {
		t.Errorf("expected limit=10 offset=5, got %v / %v", args[3], args[4])
	}
}

// TestBuildQuery_LimitClampedToDefault pins the >500 / <=0 clamp behavior.
func TestBuildQuery_LimitClampedToDefault(t *testing.T) {
	t.Parallel()
	for _, limit := range []int{0, -1, 501, 10000} {
		_, args := buildQuery(Filters{Limit: limit})
		if args[3] != 50 {
			t.Errorf("limit=%d: expected clamp to default 50, got %v", limit, args[3])
		}
	}
}

// TestBuildQuery_NoUnitSuffixedFields guards against regressing Phase-48's
// SI-canonical rule: the composed query must never reference legacy
// unit-suffixed column names on the SI tables it reads from.
func TestBuildQuery_NoUnitSuffixedFields(t *testing.T) {
	t.Parallel()
	query, _ := buildQuery(Filters{})
	mustNotContain := []string{
		"distance_mi", "duration_min", "energy_used_kwh", "avg_speed_mph",
		"max_speed_mph", "avg_power_kw", "energy_added_kwh",
	}
	for _, frag := range mustNotContain {
		if strings.Contains(query, frag) {
			t.Errorf("buildQuery() must not reference legacy unit-suffixed column %q\nfull SQL:\n%s", frag, query)
		}
	}
}

func TestBuildQuery_KeepsSessionMeasurementsTypedAndSI(t *testing.T) {
	t.Parallel()
	query, _ := buildQuery(Filters{})
	for _, fragment := range []string{
		"d.duration_s AS duration_s",
		"c.total_energy_added_wh::double precision AS energy_added_wh",
		"su.version::text AS version",
	} {
		if !strings.Contains(query, fragment) {
			t.Errorf("buildQuery() missing typed activity projection %q\nfull SQL:\n%s", fragment, query)
		}
	}
	for _, fragment := range []string{"' min'", "' kWh'", " / 60.0", " / 1000.0"} {
		if strings.Contains(query, fragment) {
			t.Errorf("buildQuery() must not pre-format SI values at the API boundary; found %q\nfull SQL:\n%s", fragment, query)
		}
	}
}

func TestBuildQuery_AlertVehicleProjectionIsNotArbitrary(t *testing.T) {
	t.Parallel()
	query, _ := buildQuery(Filters{Kinds: []activitymodel.Kind{activitymodel.KindAlert}})
	for _, fragment := range []string{
		"WHEN $1::bigint IS NOT NULL AND ar.id IS NOT NULL THEN $1::bigint",
		"CASE WHEN COUNT(*) = 1 THEN MIN(arv.vehicle_id)",
		"COALESCE(NULLIF(nl.severity, ''), ar.severity, 'info')",
	} {
		if !strings.Contains(query, fragment) {
			t.Errorf("alert activity query missing %q\nfull SQL:\n%s", fragment, query)
		}
	}
	if strings.Contains(query, "LIMIT 1) AS vehicle_id") {
		t.Errorf("alert activity must not attribute a multi-vehicle rule to an arbitrary first target\nfull SQL:\n%s", query)
	}
}

// TestBuildQuery_NeverLeaksAddressOrCoordinateColumns pins the "avoid
// leaking sensitive location data" requirement: none of the address/lat/
// lng columns from drives or charging_sessions may be selected.
func TestBuildQuery_NeverLeaksAddressOrCoordinateColumns(t *testing.T) {
	t.Parallel()
	query, _ := buildQuery(Filters{})
	mustNotContain := []string{
		"start_place", "end_place", "start_lat", "start_lng", "start_lon",
		"end_lat", "end_lng", "end_lon",
	}
	for _, frag := range mustNotContain {
		if strings.Contains(query, frag) {
			t.Errorf("buildQuery() must not select location column %q\nfull SQL:\n%s", frag, query)
		}
	}
}
