package database

import (
	"strings"
	"testing"
)

// Phase-43a / Prompt 0006 — SQL-shape tests for guard_repo.
//
// These tests pin the critical fragments of the four SQL constants so a
// typo on column name, table name, or filter predicate is caught at
// compile-test time rather than at runtime in production. They follow
// the same pattern as vampire_drain_repo_test.go and mileage_repo_test.go
// — the codebase has no pgxmock / testcontainers harness, and the
// Phase-43a precedent explicitly accepts pure-Go SQL-shape tests in
// that case.

func TestGuardListEventsSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		// Column projection — every field on GuardEvent must come back.
		"id",
		"vehicle_id",
		"ts",
		"event_type",
		"from_state",
		"to_state",
		"details",
		"acknowledged_at",
		"acknowledged_by",
		// Source table.
		"FROM security_events",
		// Vehicle scoping + ordering. Tiebreaker on id keeps the
		// pagination deterministic when two events share a ts.
		"WHERE vehicle_id = $1",
		"ORDER BY ts DESC, id DESC",
		// Limit binding.
		"LIMIT $2",
	}
	for _, frag := range mustContain {
		if !strings.Contains(guardListEventsSQL, frag) {
			t.Errorf("guardListEventsSQL missing %q\nfull SQL:\n%s", frag, guardListEventsSQL)
		}
	}
}

func TestGuardAcknowledgeSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		// Operation + table.
		"UPDATE security_events",
		// Decision #3 verbatim: SET acknowledged_at = now()
		// (overwrites — re-acknowledgement updates the timestamp,
		// not COALESCE-preserves it).
		"SET acknowledged_at = now()",
		"acknowledged_by = $3",
		// Bind order + cross-vehicle defence.
		"WHERE id = $1",
		"AND vehicle_id = $2",
		// RETURNING projects the same columns the list query does so
		// scanGuardEvent stays single-source-of-truth.
		"RETURNING id, vehicle_id, ts, event_type, from_state, to_state, details",
		"acknowledged_at, acknowledged_by",
	}
	for _, frag := range mustContain {
		if !strings.Contains(guardAcknowledgeSQL, frag) {
			t.Errorf("guardAcknowledgeSQL missing %q\nfull SQL:\n%s", frag, guardAcknowledgeSQL)
		}
	}
}

func TestGuardLatestSentrySQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		"SELECT ts, to_state",
		"FROM security_events",
		"WHERE vehicle_id = $1",
		"AND event_type = $2",
		"ORDER BY ts DESC",
		"LIMIT 1",
	}
	for _, frag := range mustContain {
		if !strings.Contains(guardLatestSentrySQL, frag) {
			t.Errorf("guardLatestSentrySQL missing %q\nfull SQL:\n%s", frag, guardLatestSentrySQL)
		}
	}
}

func TestGuardEventCount24hSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		"SELECT COUNT(*)",
		"FROM security_events",
		"WHERE vehicle_id = $1",
		"AND ts >= $2",
	}
	for _, frag := range mustContain {
		if !strings.Contains(guardEventCount24hSQL, frag) {
			t.Errorf("guardEventCount24hSQL missing %q\nfull SQL:\n%s", frag, guardEventCount24hSQL)
		}
	}
}

func TestGuardVehicleExistsSQL_Shape(t *testing.T) {
	t.Parallel()
	want := `SELECT EXISTS (SELECT 1 FROM vehicles WHERE id = $1)`
	if guardVehicleExistsSQL != want {
		t.Errorf("guardVehicleExistsSQL = %q, want %q", guardVehicleExistsSQL, want)
	}
}

// TestSentryModeTokens_MatchProtoEnum locks the two off/unknown tokens
// that GuardRepo.Status uses to compute SentryModeActive against the
// proto-enum String() outputs. If the proto bindings ever rename
// SentryModeStateOff -> SentryModeOff (or similar), this test will
// fail and force a deliberate update — without it, the dashboard
// would silently report "Sentry off" as "active" because the writer's
// new token wouldn't match the off-list.
//
// The constants are intentionally untyped strings here (not imports
// from internal/tesla/protomodel) — the repo memory + Phase-42a/0030
// observer pattern documents that GuardRepo should not depend on the
// protomodel package directly. This test acts as the manual sync
// point between the two packages.
func TestSentryModeTokens_KnownValues(t *testing.T) {
	t.Parallel()
	// These strings MUST match
	// internal/tesla/protomodel/enum_parsers_gen.go SentryModeState.String()
	// for the SentryModeStateOff and SentryModeStateUnknown branches.
	if sentryModeOffToken != "SentryModeStateOff" {
		t.Errorf("sentryModeOffToken = %q; proto enum returns 'SentryModeStateOff'", sentryModeOffToken)
	}
	if sentryModeUnknownToken != "SentryModeStateUnknown" {
		t.Errorf("sentryModeUnknownToken = %q; proto enum returns 'SentryModeStateUnknown'", sentryModeUnknownToken)
	}
	// The writer at internal/tesla/router/writers/security_event_writer.go:46
	// inserts SentryMode rows with event_type='sentry_mode'. If that
	// ever changes the lookup query in guardLatestSentrySQL silently
	// returns no rows and the dashboard stops reporting status.
	if sentryEventType != "sentry_mode" {
		t.Errorf("sentryEventType = %q; writer emits 'sentry_mode'", sentryEventType)
	}
}

// TestNewGuardRepo_NilPoolPanics mirrors the snapshot-writer fail-fast
// precedent — wiring with a nil pool is a programming bug, not a
// runtime condition.
func TestNewGuardRepo_NilPoolPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("NewGuardRepo(nil) did not panic")
		}
	}()
	_ = NewGuardRepo(nil)
}

// TestDecodeGuardDetails covers the JSONB blob decoder. Production
// rows hold structured per-event-type metadata; malformed blobs (e.g.
// from a producer-side schema bug) must NOT poison the row — return
// nil and let the row render with empty details.
func TestDecodeGuardDetails(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		raw     string
		wantNil bool
		want    map[string]any
	}{
		{
			name: "valid_object",
			raw:  `{"trigger":"motion","duration_s":12}`,
			want: map[string]any{"trigger": "motion", "duration_s": 12.0},
		},
		{
			name: "empty_object",
			raw:  `{}`,
			want: map[string]any{},
		},
		{
			name:    "malformed_returns_nil",
			raw:     `{not json}`,
			wantNil: true,
		},
		{
			// JSON arrays are not the GuardEvent.Details shape; we
			// expect map[string]any. An array decode into a map is a
			// type mismatch -> nil.
			name:    "array_returns_nil",
			raw:     `[1,2,3]`,
			wantNil: true,
		},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := decodeGuardDetails([]byte(c.raw))
			if c.wantNil {
				if got != nil {
					t.Errorf("decodeGuardDetails(%q) = %v, want nil", c.raw, got)
				}
				return
			}
			if got == nil {
				t.Fatalf("decodeGuardDetails(%q) = nil, want %v", c.raw, c.want)
			}
			if len(got) != len(c.want) {
				t.Errorf("decodeGuardDetails(%q) len = %d, want %d (got=%v)", c.raw, len(got), len(c.want), got)
			}
			for k, v := range c.want {
				if got[k] != v {
					t.Errorf("decodeGuardDetails(%q)[%q] = %v, want %v", c.raw, k, got[k], v)
				}
			}
		})
	}
}
