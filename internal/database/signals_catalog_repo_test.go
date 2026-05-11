package database

import (
	"strings"
	"testing"
	"time"
)

// Phase-43a / Prompt 0007 — pure-Go tests for the signals_catalog repo.
//
// These tests pin SQL shape (column names, GROUP BY clause, ORDER BY,
// dynamic WHERE assembly), the value-decoder dispatch, and the
// construction-time fail-fast. The repo's actual SQL execution requires
// a live PostgreSQL instance + signal_log hypertable from mig 000186;
// the codebase has no pgxmock / testcontainers harness (see repo
// memories from earlier phase-43a prompts) and the prompt's escape
// hatch accepts pure-Go test coverage in that case.

// ---------- catalogAggregateSelectSQL shape ----------

// TestCatalogAggregateSelectSQL_Shape pins critical SQL fragments so a
// columnname/typo regression is caught at test time rather than at
// runtime in production. mig 000186 created signal_log with
// (vehicle_id, ts, field, value_kind, str_value, bool_value, int_value,
// float_value, time_value); a future migration that renames any of
// these columns must be paired with an update here.
func TestCatalogAggregateSelectSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		"FROM signal_log",
		"GROUP BY field",
		"MAX(ts)",
		"COUNT(*)",
		"COUNT(DISTINCT vehicle_id)",
		"AS last_seen_at",
		"AS sample_count_total",
		"AS vehicle_count",
	}
	for _, frag := range mustContain {
		if !strings.Contains(catalogAggregateSelectSQL, frag) {
			t.Errorf("catalogAggregateSelectSQL missing %q\nfull SQL:\n%s", frag, catalogAggregateSelectSQL)
		}
	}
	mustNotContain := []string{
		// Decision #2 explicitly chose Go-side merge instead of a
		// SQL JOIN against routing.yaml (no such table) or vehicles
		// (catalog is fleet-wide, no per-vehicle disambiguation).
		"JOIN",
		// vehicle_id LIMIT clause would silently bias the aggregate;
		// catalog must reflect every observed signal across the fleet.
		"WHERE vehicle_id",
	}
	for _, frag := range mustNotContain {
		if strings.Contains(catalogAggregateSelectSQL, frag) {
			t.Errorf("catalogAggregateSelectSQL must not contain %q (would bias the aggregate)\nfull SQL:\n%s", frag, catalogAggregateSelectSQL)
		}
	}
}

// TestObservationsSelectColumns_Shape pins the column projection so
// scanObservation's argument order stays in lock-step with the SELECT
// list. A column reorder here without a paired scan-order update
// would silently corrupt the typed-column dispatch.
func TestObservationsSelectColumns_Shape(t *testing.T) {
	t.Parallel()
	wantOrdered := []string{
		"vehicle_id",
		"ts",
		"field",
		"value_kind",
		"str_value",
		"bool_value",
		"int_value",
		"float_value",
		"time_value",
	}
	for i, col := range wantOrdered {
		idx := strings.Index(observationsSelectColumns, col)
		if idx < 0 {
			t.Errorf("observationsSelectColumns missing column %q (position %d)", col, i)
		}
		if i > 0 {
			prev := wantOrdered[i-1]
			if strings.Index(observationsSelectColumns, prev) > idx {
				t.Errorf("column %q must appear after %q in observationsSelectColumns", col, prev)
			}
		}
	}
}

// ---------- buildObservationsWhere ----------

// TestBuildObservationsWhere_NoFilters confirms the empty-filter case
// still produces valid SQL (`WHERE 1=1`) so the assembled COUNT and
// SELECT statements parse without an awkward WHERE-presence check.
func TestBuildObservationsWhere_NoFilters(t *testing.T) {
	t.Parallel()
	where, args := buildObservationsWhere(ObservationsParams{})
	if where != "WHERE 1=1" {
		t.Errorf("where = %q, want %q", where, "WHERE 1=1")
	}
	if len(args) != 0 {
		t.Errorf("args = %v, want empty", args)
	}
}

// TestBuildObservationsWhere_AllFilters confirms every supported filter
// appears in the assembled clause with sequential placeholder
// numbering. This is the canonical full-fan-out shape; the per-filter
// sub-tests below cover individual presence/absence combinations.
func TestBuildObservationsWhere_AllFilters(t *testing.T) {
	t.Parallel()
	since := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	until := time.Date(2026, 5, 6, 0, 0, 0, 0, time.UTC)

	where, args := buildObservationsWhere(ObservationsParams{
		VehicleIDs: []int64{42, 7},
		Fields:     []string{"BatteryLevel", "Gear"},
		Since:      &since,
		Until:      &until,
	})

	wantFragments := []string{
		"WHERE 1=1",
		"AND vehicle_id = ANY($1::bigint[])",
		"AND field = ANY($2::text[])",
		"AND ts >= $3",
		"AND ts <= $4",
	}
	for _, frag := range wantFragments {
		if !strings.Contains(where, frag) {
			t.Errorf("where missing %q\nfull where: %s", frag, where)
		}
	}
	if len(args) != 4 {
		t.Fatalf("len(args) = %d, want 4 (vehicle_ids slice + fields slice + since + until)", len(args))
	}
}

// TestBuildObservationsWhere_PartialFilters_Renumbering covers the
// trickier case: when an earlier-declared filter is omitted, later
// filters MUST renumber their placeholders so the args slice and
// placeholders stay in lock-step. A bug here would silently feed the
// wrong arg into the wrong placeholder in production.
func TestBuildObservationsWhere_PartialFilters_Renumbering(t *testing.T) {
	t.Parallel()
	since := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)

	cases := []struct {
		name       string
		params     ObservationsParams
		wantWhere  []string
		wantArgLen int
	}{
		{
			name:       "vehicle_only",
			params:     ObservationsParams{VehicleIDs: []int64{42}},
			wantWhere:  []string{"AND vehicle_id = ANY($1::bigint[])"},
			wantArgLen: 1,
		},
		{
			name:       "field_only",
			params:     ObservationsParams{Fields: []string{"BatteryLevel"}},
			wantWhere:  []string{"AND field = ANY($1::text[])"},
			wantArgLen: 1,
		},
		{
			name:       "since_only",
			params:     ObservationsParams{Since: &since},
			wantWhere:  []string{"AND ts >= $1"},
			wantArgLen: 1,
		},
		{
			name:       "vehicle_and_since_skipping_field",
			params:     ObservationsParams{VehicleIDs: []int64{42}, Since: &since},
			wantWhere:  []string{"AND vehicle_id = ANY($1::bigint[])", "AND ts >= $2"},
			wantArgLen: 2,
		},
		{
			name:       "field_and_since_skipping_vehicle",
			params:     ObservationsParams{Fields: []string{"BatteryLevel"}, Since: &since},
			wantWhere:  []string{"AND field = ANY($1::text[])", "AND ts >= $2"},
			wantArgLen: 2,
		},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			where, args := buildObservationsWhere(c.params)
			for _, frag := range c.wantWhere {
				if !strings.Contains(where, frag) {
					t.Errorf("where missing %q\nfull where: %s", frag, where)
				}
			}
			if len(args) != c.wantArgLen {
				t.Errorf("len(args) = %d, want %d", len(args), c.wantArgLen)
			}
		})
	}
}

// ---------- decodeObservationValue ----------

// TestDecodeObservationValue_AllKinds covers every value_kind branch.
// The mapping mirrors mig 000186 lines 79-89; a future renaming must
// be paired with a corresponding update here.
func TestDecodeObservationValue_AllKinds(t *testing.T) {
	t.Parallel()
	str := "ShiftStateD"
	b := true
	i := int64(7)
	f := 78.5
	ts := time.Date(2026, 5, 6, 11, 0, 0, 0, time.UTC)

	cases := []struct {
		name string
		kind int16
		want any
	}{
		{"string", 1, str},
		{"bool", 2, b},
		{"int32", 3, i},
		{"int64", 4, i},
		{"float", 5, f},
		{"double", 6, f},
		{"enum", 7, i},
		{"time", 9, ts},
		{"unknown_zero", 0, nil},
		{"compound_eight", 8, nil},
		{"invalid_ten", 10, nil},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := decodeObservationValue(c.kind, &str, &b, &i, &f, &ts)
			if got != c.want {
				t.Errorf("decodeObservationValue(%d) = %v, want %v", c.kind, got, c.want)
			}
		})
	}
}

// TestDecodeObservationValue_NilColumnsForKindReturnNil confirms the
// repo defends against malformed rows: if value_kind says "string" but
// str_value is NULL, the decoder returns nil rather than dereferencing
// the nil pointer. signal_log's column constraints prevent this in
// principle, but a partial migration or hand-edited row could surface
// the case.
func TestDecodeObservationValue_NilColumnsForKindReturnNil(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		kind int16
	}{
		{"string_kind_nil_str", 1},
		{"bool_kind_nil_bool", 2},
		{"int32_kind_nil_int", 3},
		{"float_kind_nil_float", 5},
		{"time_kind_nil_time", 9},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := decodeObservationValue(c.kind, nil, nil, nil, nil, nil)
			if got != nil {
				t.Errorf("got %v, want nil for kind=%d with all-nil columns", got, c.kind)
			}
		})
	}
}

// ---------- construction-time fail-fast ----------

// TestNewSignalsCatalogRepo_NilPoolPanics defends the construction-
// time fail-fast: a nil pool is a wiring bug, not a runtime condition.
func TestNewSignalsCatalogRepo_NilPoolPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("NewSignalsCatalogRepo(nil) did not panic")
		}
	}()
	_ = NewSignalsCatalogRepo(nil)
}
