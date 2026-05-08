package database

import (
	"strings"
	"testing"
)

// Phase-49 / Slice 0002 — SQL-shape tests for alert_rule_state_repo.
//
// The codebase has no pgxmock / testcontainers harness (see
// guard_repo_test.go, vampire_drain_repo_test.go, mileage_repo_test.go
// for the established precedent). These tests pin the critical SQL
// fragments so a typo on column name, table name, or — in particular —
// the race-protection WHERE clause is caught at test time rather than
// at runtime in production.
//
// The integration assertions live in internal/api/rule_engine_test.go
// where the engine is exercised through an in-memory fake of the
// AlertRuleStateRepo interface.

func TestAlertRuleStateRepo_LoadAllSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		// Source table.
		"FROM alert_rule_state",
		// Every persisted column must be projected so scanAlertRuleState
		// stays in sync.
		"rule_id",
		"vehicle_id",
		"latched_at",
		"last_fired_at",
		"fire_count_since_reset",
		"updated_at",
		// Deterministic ordering keeps the boot-time hydration repeatable
		// for any tests that snapshot the cache.
		"ORDER BY rule_id, vehicle_id",
		// Bounded fetch — production deployments are well below 100k pairs
		// and an unbounded query at startup is a foot-gun.
		"LIMIT",
	}
	for _, frag := range mustContain {
		if !strings.Contains(alertRuleStateLoadAllSQL, frag) {
			t.Errorf("alertRuleStateLoadAllSQL missing %q\nfull SQL:\n%s", frag, alertRuleStateLoadAllSQL)
		}
	}
}

func TestAlertRuleStateRepo_MarkFiredSQL_RaceSafe(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		// Operation + table.
		"INSERT INTO alert_rule_state",
		// Race-safety pivot: WHERE clause on ON CONFLICT DO UPDATE
		// suppresses concurrent once-mode fires from peer pods.
		// Without this clause two pods can both fire the same rule.
		"ON CONFLICT (rule_id, vehicle_id) DO UPDATE",
		"WHERE alert_rule_state.latched_at IS NULL",
		// Once-mode latch is conditional on the isOnce parameter; the
		// CASE expression is the contract that distinguishes once-mode
		// from repeat-mode at the SQL boundary.
		"CASE WHEN $3 THEN $4",
		// last_fired_at always updates regardless of mode — feeds the
		// cooldown gate (slice 0004 will use this column).
		"last_fired_at",
		// Counter increments every fire — feeds the
		// max_fires_per_resolution cap (slice 0003).
		"fire_count_since_reset = alert_rule_state.fire_count_since_reset + 1",
		// (xmax = 0) AS inserted distinguishes INSERT from UPDATE in
		// the same round trip. Future audits may use this signal.
		"RETURNING (xmax = 0) AS inserted",
	}
	for _, frag := range mustContain {
		if !strings.Contains(alertRuleStateMarkFiredSQL, frag) {
			t.Errorf("alertRuleStateMarkFiredSQL missing %q\nfull SQL:\n%s", frag, alertRuleStateMarkFiredSQL)
		}
	}
}

func TestAlertRuleStateRepo_ClearLatchSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		// Operation + table.
		"UPDATE alert_rule_state",
		// Must clear BOTH latched_at and the resolution counter — the
		// pair is the "rule has fully reset to its armed state" signal.
		"latched_at             = NULL",
		"fire_count_since_reset = 0",
		// Targeting clause — no broadcast updates.
		"WHERE rule_id    = $1",
		"AND vehicle_id = $2",
		// No-op skip predicate so updated_at only changes on real
		// state transitions.
		"latched_at IS NOT NULL OR fire_count_since_reset > 0",
	}
	for _, frag := range mustContain {
		if !strings.Contains(alertRuleStateClearLatchSQL, frag) {
			t.Errorf("alertRuleStateClearLatchSQL missing %q\nfull SQL:\n%s", frag, alertRuleStateClearLatchSQL)
		}
	}
}
