package settings

// Per-section and global settings reset.
//
// Lets the user reset a single section (alert rules, geofences,
// quiet-hours windows, notification channels, dashboard layouts,
// automations, or the typed settings rows that back GeneralSettings /
// AppearanceSettings) or the whole user-discoverable preference
// surface in one transaction. Per-vehicle settings are NOT touched
// here; the per-vehicle "reset overrides" flow has its own endpoint.
//
// Section taxonomy
// ----------------
//   - general               → settings rows backing GeneralSettings.tsx
//   - appearance            → settings rows backing AppearanceSettings.tsx
//   - alert_rules           → DELETE FROM alert_rules
//   - geofences             → DELETE FROM geofences
//                             (CASCADE → geofence_electricity_rates;
//                              SET NULL → vehicle_guard.home_geofence_id)
//   - notification_channels → DELETE FROM notification_logs first
//                             (RESTRICT FK on channel_id) then
//                             DELETE FROM notification_channels
//                             (CASCADE handles channel-config
//                             sub-tables and notification_schedules).
//   - dashboard_layout      → DELETE FROM dashboard_layouts AND drop
//                             the legacy `dashboard_layouts` row in
//                             the typed settings table.
//   - automations           → DELETE cross-ref rows that hold
//                             ON DELETE RESTRICT against automations
//                             (call_automation, condition_other_…)
//                             then DELETE FROM automations.
//   - quiet_hours           → DELETE FROM notification_quiet_hours
//                             scoped to the request's userID. The
//                             only per-user table in the catalog.
//
// Deny-list
// ---------
// Sections whose backing data is shared with non-user state, lives
// somewhere we can't touch (browser localStorage), or simply has no
// table at all are refused with a 400 + machine-readable reason. The
// SPA renders the reason inline so the user knows which UI path to
// follow instead.
//
//   - tariffs       → no `tariffs` table; charge_cost_tariff_id is a
//                     per-vehicle setting. The vehicle settings page
//                     exposes a per-row reset.
//   - sound_prefs   → notification sound prefs live in browser
//                     localStorage; reset via the browser's site-data
//                     controls.

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
)

// SettingsResetSection is the canonical name of a resettable section.
// Always lower_snake_case to match the JSON wire shape and the
// per-section anchors on SettingsPage.tsx.
type SettingsResetSection string

// The eight whitelisted sections. Order is the order ResetSections
// applies them inside the transaction; child-table dependencies are
// handled inside each section's reset function so this top-level order
// is just an aesthetic preference (general/appearance settings first,
// then user-authored data, then automations last because they reach
// the most other tables).
const (
	ResetSectionGeneral              SettingsResetSection = "general"
	ResetSectionAppearance           SettingsResetSection = "appearance"
	ResetSectionAlertRules           SettingsResetSection = "alert_rules"
	ResetSectionGeofences            SettingsResetSection = "geofences"
	ResetSectionNotificationChannels SettingsResetSection = "notification_channels"
	ResetSectionDashboardLayout      SettingsResetSection = "dashboard_layout"
	ResetSectionAutomations          SettingsResetSection = "automations"
	ResetSectionQuietHours           SettingsResetSection = "quiet_hours"
)

// allSettingsResetSections is the ordered whitelist used by the
// global reset path. Kept as a private slice so callers must use
// AllSettingsResetSections() and can't accidentally mutate it.
var allSettingsResetSections = []SettingsResetSection{
	ResetSectionGeneral,
	ResetSectionAppearance,
	ResetSectionAlertRules,
	ResetSectionGeofences,
	ResetSectionNotificationChannels,
	ResetSectionDashboardLayout,
	ResetSectionAutomations,
	ResetSectionQuietHours,
}

// AllSettingsResetSections returns a defensive copy of the canonical
// whitelist. Used by the global reset path and by handler tests that
// need to assert the full set was applied.
func AllSettingsResetSections() []SettingsResetSection {
	out := make([]SettingsResetSection, len(allSettingsResetSections))
	copy(out, allSettingsResetSections)
	return out
}

// settingsResetWhitelist mirrors allSettingsResetSections as a set
// for O(1) name validation in CanonicalResetSection.
var settingsResetWhitelist = func() map[string]SettingsResetSection {
	m := make(map[string]SettingsResetSection, len(allSettingsResetSections))
	for _, s := range allSettingsResetSections {
		m[string(s)] = s
	}
	return m
}()

// settingsResetDenyList maps a denied section name to the user-facing
// reason. The handler returns this string verbatim so it can show up
// in the error toast / inline message.
var settingsResetDenyList = map[string]string{
	"tariffs":     "tariffs are stored per-vehicle (charge_cost_tariff_id); reset from the Vehicle Settings page",
	"sound_prefs": "notification sound preferences live in your browser; clear via the browser's site data controls",
}

// IsResetSectionDenied reports whether `name` is on the deny-list and
// returns the user-facing reason if it is. Callers should check this
// BEFORE CanonicalResetSection so the more specific error wins.
func IsResetSectionDenied(name string) (reason string, denied bool) {
	r, ok := settingsResetDenyList[strings.ToLower(strings.TrimSpace(name))]
	return r, ok
}

// SettingsResetDenyListReasons returns a defensive copy of the
// deny-list keyed by section name. Used by the SPA to render an
// "unsupported sections" panel (and by handler tests to assert
// coverage). Iterating the returned map is safe.
func SettingsResetDenyListReasons() map[string]string {
	out := make(map[string]string, len(settingsResetDenyList))
	for k, v := range settingsResetDenyList {
		out[k] = v
	}
	return out
}

// Sentinel errors raised by the reset orchestrator. Handlers map
// these to specific 4xx responses; anything else is a 500.
var (
	// ErrSettingsResetUnknownSection is returned when CanonicalResetSection
	// is called with a name that's not in the whitelist AND not in the
	// deny-list. Maps to 400 BAD_REQUEST.
	ErrSettingsResetUnknownSection = errors.New("settings reset: unknown section")

	// ErrSettingsResetDenied is returned when a denied section is
	// requested. Maps to 400 with the deny-list reason in the body.
	ErrSettingsResetDenied = errors.New("settings reset: section is not user-resettable")

	// ErrSettingsResetQuietHoursRequiresUser is returned when the
	// quiet_hours section is part of the request but the principal
	// header was empty (open mode). Maps to 401 MISSING_IDENTITY in
	// the handler. Other sections are install-global and don't care.
	ErrSettingsResetQuietHoursRequiresUser = errors.New("settings reset: quiet_hours requires an authenticated user")
)

// CanonicalResetSection normalises a wire string to the typed
// constant. Returns ErrSettingsResetDenied when the name appears on
// the deny-list, ErrSettingsResetUnknownSection otherwise. The
// returned reason is empty unless the deny-list error is returned.
func CanonicalResetSection(name string) (SettingsResetSection, string, error) {
	key := strings.ToLower(strings.TrimSpace(name))
	if reason, denied := settingsResetDenyList[key]; denied {
		return "", reason, ErrSettingsResetDenied
	}
	if s, ok := settingsResetWhitelist[key]; ok {
		return s, "", nil
	}
	return "", "", ErrSettingsResetUnknownSection
}

// SettingsResetSectionResult is the per-section row count surfaced to
// the SPA. `Reset` is the number of database rows physically deleted
// (or, for the typed settings sections, the number of typed-key rows
// removed from the `settings` table — defaults are filled back in by
// the SettingsRepo's settingsDefaults helper on the next read).
type SettingsResetSectionResult struct {
	Section string `json:"section"`
	Reset   int64  `json:"reset"`
}

// SettingsResetResult is the JSON contract returned by the handler.
// `Reset` is the total of the per-section counts; `Sections` is the
// applied order so the SPA can render a step-by-step receipt.
type SettingsResetResult struct {
	Reset    int64                        `json:"reset"`
	Sections []SettingsResetSectionResult `json:"sections"`
}

// SettingsResetTxRunner is the test seam between the orchestrator and
// pgx. Production wires *database.DB.Pool which satisfies the interface via
// pgx's BeginTx. Tests substitute a stub that records each section
// call without touching a database.
//
// The interface is intentionally narrow — the orchestrator never
// touches anything other than the per-section reset functions and a
// transaction boundary — so swapping in a fake stays cheap.
type SettingsResetTxRunner interface {
	// RunInTx opens a transaction, invokes fn with it, commits on a
	// nil error and rolls back otherwise. The supplied tx is the same
	// one passed to every per-section reset function so they all share
	// the same atomic boundary.
	RunInTx(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error
}

// pgxPoolTxRunner is the production implementation of
// SettingsResetTxRunner. Wraps a *database.DB.Pool directly so the orchestrator
// doesn't depend on the wider *database.DB type.
type pgxPoolTxRunner struct {
	db *database.DB
}

// RunInTx opens a transaction with the default isolation level, calls
// fn, then commits if fn returned nil. Rollback is best-effort on the
// error path — the underlying pool will surface anything that goes
// wrong with the rollback itself in its connection-health metrics.
func (r *pgxPoolTxRunner) RunInTx(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("settings reset: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("settings reset: commit tx: %w", err)
	}
	return nil
}

// SettingsResetRepo is the orchestrator. It is concurrency-safe as
// long as the underlying TxRunner is (the production pgx pool is).
// Construct once at router wire-up; share between requests.
type SettingsResetRepo struct {
	runner SettingsResetTxRunner
}

// NewSettingsResetRepo wires the production pgx-backed runner.
func NewSettingsResetRepo(db *database.DB) *SettingsResetRepo {
	return &SettingsResetRepo{runner: &pgxPoolTxRunner{db: db}}
}

// NewSettingsResetRepoWithRunner injects a custom runner. Used by
// handler tests so the orchestrator can be exercised end-to-end
// without a live database.
func NewSettingsResetRepoWithRunner(runner SettingsResetTxRunner) *SettingsResetRepo {
	return &SettingsResetRepo{runner: runner}
}

// ResetSections runs each requested section's reset SQL inside a
// single transaction. An empty `sections` slice short-circuits to a
// zero-row no-op result so callers don't have to special-case it.
//
// `userID` is required when the request includes ResetSectionQuietHours
// (the only per-user section). Other sections are install-global and
// ignore it. The handler maps ErrSettingsResetQuietHoursRequiresUser
// to a 401 so the SPA can prompt for sign-in.
func (r *SettingsResetRepo) ResetSections(ctx context.Context, userID string, sections []SettingsResetSection) (*SettingsResetResult, error) {
	if r == nil || r.runner == nil {
		return nil, errors.New("settings reset: runner not configured")
	}

	// Pre-flight validation BEFORE we open the transaction so an
	// unknown / unauthenticated section never wastes a round-trip.
	for _, s := range sections {
		if s == ResetSectionQuietHours && strings.TrimSpace(userID) == "" {
			return nil, ErrSettingsResetQuietHoursRequiresUser
		}
		if _, ok := settingsResetWhitelist[string(s)]; !ok {
			return nil, fmt.Errorf("%w: %q", ErrSettingsResetUnknownSection, s)
		}
	}

	out := &SettingsResetResult{Sections: make([]SettingsResetSectionResult, 0, len(sections))}
	if len(sections) == 0 {
		return out, nil
	}

	err := r.runner.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		for _, s := range sections {
			n, err := resetSection(ctx, tx, s, userID)
			if err != nil {
				return fmt.Errorf("settings reset: %s: %w", s, err)
			}
			out.Sections = append(out.Sections, SettingsResetSectionResult{
				Section: string(s),
				Reset:   n,
			})
			out.Reset += n
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// generalSettingsKeys lists the typed-row keys backing the
// GeneralSettings panel. Resetting deletes these rows; the next read
// rehydrates them from settingsDefaults() in settings_repo.go so the
// effective values revert without a follow-up upsert.
//
// alert_digest_mode and the legacy quiet_hours_* keys are scoped to
// general because that's where they live in the SettingsRepo, even
// though their visible UI may live elsewhere — keeping the partition
// authoritative on the storage layout is what matters for "reset".
var generalSettingsKeys = []string{
	"unit_of_length",
	"unit_of_temp",
	"unit_of_pressure",
	"preferred_range",
	"language",
	"locale",
	"currency_symbol",
	"timezone_user",
	"tz_display_default",
	"decimal_precision",
	"base_cost_per_kwh",
	"gas_price_per_unit",
	"gas_unit",
	"gas_efficiency_mpg",
	"alert_digest_mode",
	"quiet_hours_enabled",
	"quiet_hours_start",
	"quiet_hours_end",
}

// appearanceSettingsKeys lists the typed-row keys backing the
// AppearanceSettings panel. Same rehydrate-from-defaults contract as
// generalSettingsKeys.
var appearanceSettingsKeys = []string{
	"theme",
	"mode",
	"custom_primary",
	"custom_accent",
	"ui_density",
	"time_format_default",
	"chart_palette",
	"tab_badge_enabled",
	"critical_flash_enabled",
}

// resetSection dispatches a single section to its per-section reset
// SQL. All statements are parameterized; the section enum is
// validated by ResetSections before this is called so the switch's
// default arm is unreachable in production (kept defensive for
// future additions that might forget to register here).
func resetSection(ctx context.Context, tx pgx.Tx, section SettingsResetSection, userID string) (int64, error) {
	switch section {
	case ResetSectionGeneral:
		return deleteSettingsKeys(ctx, tx, generalSettingsKeys)
	case ResetSectionAppearance:
		return deleteSettingsKeys(ctx, tx, appearanceSettingsKeys)
	case ResetSectionAlertRules:
		return execRowsAffected(ctx, tx, `DELETE FROM alert_rules`)
	case ResetSectionGeofences:
		// vehicle_guard.home_geofence_id is ON DELETE SET NULL so
		// guard rows survive; geofence_electricity_rates is ON DELETE
		// CASCADE so per-geofence pricing rows go with the geofence.
		return execRowsAffected(ctx, tx, `DELETE FROM geofences`)
	case ResetSectionNotificationChannels:
		return resetNotificationChannels(ctx, tx)
	case ResetSectionDashboardLayout:
		return resetDashboardLayout(ctx, tx)
	case ResetSectionAutomations:
		return resetAutomations(ctx, tx)
	case ResetSectionQuietHours:
		return execRowsAffected(ctx, tx,
			`DELETE FROM notification_quiet_hours WHERE user_id = $1`, userID)
	default:
		return 0, fmt.Errorf("unknown reset section: %q", section)
	}
}

// deleteSettingsKeys removes the supplied typed-row keys from the
// `settings` table. Uses ANY($1) so the list of keys is parameterized
// in a single round-trip regardless of size.
func deleteSettingsKeys(ctx context.Context, tx pgx.Tx, keys []string) (int64, error) {
	if len(keys) == 0 {
		return 0, nil
	}
	const q = `DELETE FROM settings WHERE key = ANY($1::text[])`
	tag, err := tx.Exec(ctx, q, keys)
	if err != nil {
		return 0, fmt.Errorf("delete settings keys: %w", err)
	}
	return tag.RowsAffected(), nil
}

// resetNotificationChannels nukes channels along with their delivery
// history. notification_logs.channel_id is ON DELETE RESTRICT so the
// logs MUST be deleted first (or the channels delete will fail). The
// alert_state_audit table cascades from notification_logs so it
// follows automatically; channel-config sub-tables (slack/discord/
// webhook/email/etc.) are ON DELETE CASCADE on channels.
//
// notification_schedules is ON DELETE CASCADE on channels so schedules
// go with the channels. The user is choosing to start over with their
// channel + schedule + delivery-history setup.
func resetNotificationChannels(ctx context.Context, tx pgx.Tx) (int64, error) {
	if _, err := tx.Exec(ctx, `DELETE FROM notification_logs`); err != nil {
		return 0, fmt.Errorf("delete notification_logs: %w", err)
	}
	tag, err := tx.Exec(ctx, `DELETE FROM notification_channels`)
	if err != nil {
		return 0, fmt.Errorf("delete notification_channels: %w", err)
	}
	return tag.RowsAffected(), nil
}

// resetDashboardLayout drops the per-row layout library AND the legacy
// JSON blob stored under the `dashboard_layouts` key in the typed
// settings table. Both writers stay in sync today (see
// SettingsRepo.UpsertDashboardLayouts) so the user expects a reset to
// erase both.
func resetDashboardLayout(ctx context.Context, tx pgx.Tx) (int64, error) {
	tag1, err := tx.Exec(ctx, `DELETE FROM dashboard_layouts`)
	if err != nil {
		return 0, fmt.Errorf("delete dashboard_layouts: %w", err)
	}
	tag2, err := tx.Exec(ctx, `DELETE FROM settings WHERE key = 'dashboard_layouts'`)
	if err != nil {
		return 0, fmt.Errorf("delete settings dashboard_layouts row: %w", err)
	}
	return tag1.RowsAffected() + tag2.RowsAffected(), nil
}

// resetAutomations clears the cross-reference tables that hold
// ON DELETE RESTRICT against `automations` (call_automation,
// condition_other_automation) before deleting the parent rows.
// Step children that are CASCADE-bound to automation_steps or
// automations follow automatically. Variables and history live in
// separate tables (automation_variables, automation_history) and are
// also wiped because they're meaningless without their parent
// automation graph.
func resetAutomations(ctx context.Context, tx pgx.Tx) (int64, error) {
	// Order matters: RESTRICT children first so the parent DELETE
	// doesn't trip the FK.
	for _, q := range []string{
		`DELETE FROM automation_step_action_call_automation`,
		`DELETE FROM automation_step_condition_other_automation`,
		`DELETE FROM automation_history`,
		`DELETE FROM automation_variables`,
	} {
		if _, err := tx.Exec(ctx, q); err != nil {
			return 0, fmt.Errorf("automations cleanup (%s): %w", q, err)
		}
	}
	tag, err := tx.Exec(ctx, `DELETE FROM automations`)
	if err != nil {
		return 0, fmt.Errorf("delete automations: %w", err)
	}
	return tag.RowsAffected(), nil
}

// execRowsAffected runs a parameterized statement and returns the
// affected-row count. Threads the same fmt.Errorf wrapping idiom the
// rest of the package uses so failures point at the section that
// failed, not a generic SQL error.
func execRowsAffected(ctx context.Context, tx pgx.Tx, sql string, args ...any) (int64, error) {
	tag, err := tx.Exec(ctx, sql, args...)
	if err != nil {
		return 0, fmt.Errorf("exec: %w", err)
	}
	return tag.RowsAffected(), nil
}
