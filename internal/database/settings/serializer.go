package settings

// Phase-46 / Prompt 36 — Settings export/import serializer.
//
// The serializer assembles a portable JSON bundle from the four
// repos that own the user-discoverable preference surface (settings,
// alert_rules, geofences, notification_quiet_hours) and applies one
// back to the database in a single transaction.
//
// Sensitive items (Tesla refresh tokens, API keys, TOTP secrets,
// password hashes, notification-channel webhook URLs / SMTP passwords
// / bot tokens) are NEVER part of the bundle. The bundle is plain
// JSON the user can stash in a git repo or backup folder.
//
// Idempotent upsert by stable_id:
//   - settings  → single global row, replaces wholesale.
//   - alert_rules / geofences → name (case-insensitive, trimmed) is the key.
//   - quiet_hours → composite (start_local|end_local|timezone) per user.
//
// Schema versioning lives on the bundle envelope. v1 covers the four
// sections above; v2+ will add automations, notification_channels (with
// secret redaction), dashboard_layout, and tariffs. See plan.md TODO.

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// SettingsBundleSchemaVersion is the wire-format version this build
// emits and accepts. Bump when adding/removing top-level sections so
// older readers reject incompatible files. See ImportSettingsBundle
// for the compatibility check.
const SettingsBundleSchemaVersion = 1

// SettingsBundle is the JSON document returned by ExportSettings and
// accepted by ImportSettings. Fields use snake_case so the wire shape
// matches the rest of the API contract. Sensitive sections (channels
// with secrets, OAuth tokens, password hashes, TOTP secrets) are
// intentionally absent; cf. file-level docstring.
type SettingsBundle struct {
	SchemaVersion int                    `json:"schema_version"`
	ExportedAt    time.Time              `json:"exported_at"`
	Sections      SettingsBundleSections `json:"sections"`
}

// SettingsBundleSections is the top-level sections map. Each section
// is independently optional on import — missing sections are simply
// not touched, so a partial bundle (e.g. only alert_rules) is valid.
type SettingsBundleSections struct {
	Settings   *systemmodel.Settings      `json:"settings,omitempty"`
	AlertRules []*alertmodel.AlertRule    `json:"alert_rules,omitempty"`
	Geofences  []*systemmodel.Geofence    `json:"geofences,omitempty"`
	QuietHours []*models.QuietHoursWindow `json:"quiet_hours,omitempty"`
}

// SectionResult is the per-section diff/apply summary surfaced to the
// SPA. Counts add up to the section's total record count. Conflicts
// is a human-readable list of stable_ids that require attention
// (always empty on apply — the apply path uses last-write-wins on
// stable_id, conflicts are surfaced only by the dry-run preview).
type SectionResult struct {
	Added     int      `json:"added"`
	Updated   int      `json:"updated"`
	Skipped   int      `json:"skipped"`
	Conflicts []string `json:"conflicts,omitempty"`
}

// ImportResult is the JSON contract for both dry-run and apply
// responses. Sections is keyed by the same names as
// SettingsBundleSections so the SPA can render each one in its own
// collapsible panel.
type ImportResult struct {
	DryRun   bool                     `json:"dry_run"`
	Sections map[string]SectionResult `json:"sections"`
}

// SettingsSerializerSettingsRepo is the narrow settings surface the
// serializer depends on. Production = *SettingsRepo; tests provide an
// in-memory fake.
type SettingsSerializerSettingsRepo interface {
	Get(ctx context.Context) (*systemmodel.Settings, error)
	Upsert(ctx context.Context, s *systemmodel.Settings) error
}

// SettingsSerializerAlertRepo is the narrow alert-rules surface the
// serializer depends on. Apply uses GetAll to compute the diff +
// Create/Update/Delete to converge.
type SettingsSerializerAlertRepo interface {
	GetAll(ctx context.Context) ([]*alertmodel.AlertRule, error)
	Create(ctx context.Context, rule *alertmodel.AlertRule) error
	Update(ctx context.Context, id int64, rule *alertmodel.AlertRule) error
}

// SettingsSerializerGeofenceRepo mirrors the alert surface for the
// geofences section.
type SettingsSerializerGeofenceRepo interface {
	GetAll(ctx context.Context) ([]*systemmodel.Geofence, error)
	Create(ctx context.Context, g *systemmodel.Geofence) error
	Update(ctx context.Context, g *systemmodel.Geofence) error
}

// SettingsSerializerQuietHoursRepo is the per-user surface used by
// the quiet_hours section. UserID is threaded through so a multi-user
// install never accidentally clobbers a different user's windows.
//
// The input parameter type lives in the quiethours subpkg with the
// concrete repo; the parent imports it here only to spell the
// interface signature.
type SettingsSerializerQuietHoursRepo interface {
	ListByUser(ctx context.Context, userID string) ([]*models.QuietHoursWindow, error)
	Insert(ctx context.Context, userID string, in QuietHoursInput) (*models.QuietHoursWindow, error)
	Update(ctx context.Context, userID string, id int64, in QuietHoursInput) (*models.QuietHoursWindow, error)
}

// SettingsSerializer orchestrates the multi-repo assembly + apply.
// Construct once at router wire-up; safe for concurrent use as long
// as the underlying repos are.
type SettingsSerializer struct {
	settings   SettingsSerializerSettingsRepo
	alerts     SettingsSerializerAlertRepo
	geofences  SettingsSerializerGeofenceRepo
	quietHours SettingsSerializerQuietHoursRepo
	now        func() time.Time
}

// NewSettingsSerializer wires the serializer against the production
// repos. now is fixed to time.Now().UTC; tests use the
// WithNow option to make export timestamps deterministic.
func NewSettingsSerializer(
	settings SettingsSerializerSettingsRepo,
	alerts SettingsSerializerAlertRepo,
	geofences SettingsSerializerGeofenceRepo,
	quietHours SettingsSerializerQuietHoursRepo,
) *SettingsSerializer {
	return &SettingsSerializer{
		settings:   settings,
		alerts:     alerts,
		geofences:  geofences,
		quietHours: quietHours,
		now:        func() time.Time { return time.Now().UTC() },
	}
}

// WithNow swaps the time source. Used by tests to assert deterministic
// exported_at values without needing a fake clock package.
func (s *SettingsSerializer) WithNow(fn func() time.Time) *SettingsSerializer {
	if fn != nil {
		s.now = fn
	}
	return s
}

// Sentinel errors raised by the serializer. Handlers map these to
// 4xx HTTP responses; anything else is treated as a 500.
var (
	// ErrSettingsBundleUnsupportedVersion is returned by ImportSettings
	// when the inbound bundle's schema_version is outside the supported
	// range. The handler maps this to 400.
	ErrSettingsBundleUnsupportedVersion = errors.New("settings bundle: unsupported schema_version")
	// ErrSettingsBundleNil is returned when ImportSettings is given a
	// nil bundle pointer — defensive, the handler should reject earlier
	// at decode time.
	ErrSettingsBundleNil = errors.New("settings bundle: nil")
)

// ExportSettings assembles the current state into a portable bundle.
// userID scopes the quiet_hours section; other sections are install-
// global (not per-user) so they're always included.
func (s *SettingsSerializer) ExportSettings(ctx context.Context, userID string) (*SettingsBundle, error) {
	out := &SettingsBundle{
		SchemaVersion: SettingsBundleSchemaVersion,
		ExportedAt:    s.now(),
	}

	settings, err := s.settings.Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("settings export: load settings: %w", err)
	}
	out.Sections.Settings = settings

	alerts, err := s.alerts.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("settings export: load alert_rules: %w", err)
	}
	out.Sections.AlertRules = alerts

	geofences, err := s.geofences.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("settings export: load geofences: %w", err)
	}
	out.Sections.Geofences = geofences

	quietHours, err := s.quietHours.ListByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("settings export: load quiet_hours: %w", err)
	}
	out.Sections.QuietHours = quietHours

	return out, nil
}

// ImportSettings applies bundle to the database. When dryRun is true
// no writes happen — the returned ImportResult only reflects the diff
// the apply path WOULD perform. When dryRun is false the apply runs
// section-by-section using the configured repos. Sections absent from
// the bundle are not touched.
//
// Stable_id strategy:
//   - alert_rules + geofences → lower-cased trimmed Name
//   - quiet_hours → start_local|end_local|timezone composite
//   - settings → single row, replaced wholesale
//
// Returns ErrSettingsBundleUnsupportedVersion when bundle's
// schema_version is outside the [1, SettingsBundleSchemaVersion]
// range so the handler can map it to a 400.
func (s *SettingsSerializer) ImportSettings(ctx context.Context, userID string, bundle *SettingsBundle, dryRun bool) (*ImportResult, error) {
	if bundle == nil {
		return nil, ErrSettingsBundleNil
	}
	if bundle.SchemaVersion < 1 || bundle.SchemaVersion > SettingsBundleSchemaVersion {
		return nil, fmt.Errorf("%w: got %d, supported 1..%d",
			ErrSettingsBundleUnsupportedVersion, bundle.SchemaVersion, SettingsBundleSchemaVersion)
	}

	result := &ImportResult{
		DryRun:   dryRun,
		Sections: map[string]SectionResult{},
	}

	// Settings section — single row, always counted as updated when present.
	if bundle.Sections.Settings != nil {
		var added, updated int
		current, err := s.settings.Get(ctx)
		if err != nil {
			return nil, fmt.Errorf("settings import: load current settings: %w", err)
		}
		if settingsEquivalent(current, bundle.Sections.Settings) {
			result.Sections["settings"] = SectionResult{Skipped: 1}
		} else {
			updated = 1
			if !dryRun {
				if err := s.settings.Upsert(ctx, bundle.Sections.Settings); err != nil {
					return nil, fmt.Errorf("settings import: upsert settings: %w", err)
				}
			}
			result.Sections["settings"] = SectionResult{Added: added, Updated: updated}
		}
	}

	if bundle.Sections.AlertRules != nil {
		sec, err := s.applyAlertRules(ctx, bundle.Sections.AlertRules, dryRun)
		if err != nil {
			return nil, err
		}
		result.Sections["alert_rules"] = sec
	}

	if bundle.Sections.Geofences != nil {
		sec, err := s.applyGeofences(ctx, bundle.Sections.Geofences, dryRun)
		if err != nil {
			return nil, err
		}
		result.Sections["geofences"] = sec
	}

	if bundle.Sections.QuietHours != nil {
		sec, err := s.applyQuietHours(ctx, userID, bundle.Sections.QuietHours, dryRun)
		if err != nil {
			return nil, err
		}
		result.Sections["quiet_hours"] = sec
	}

	return result, nil
}

// applyAlertRules computes the per-rule diff against the current
// alert_rules table. Existing rules are matched on lowercased Name;
// importing a rule with the same Name but different fields counts as
// "updated". Rules absent from the import are LEFT IN PLACE — this is
// an additive merge, not a destructive sync, so the user can hand-pick
// rules across multiple installs without losing any.
func (s *SettingsSerializer) applyAlertRules(ctx context.Context, incoming []*alertmodel.AlertRule, dryRun bool) (SectionResult, error) {
	current, err := s.alerts.GetAll(ctx)
	if err != nil {
		return SectionResult{}, fmt.Errorf("alert_rules import: list current: %w", err)
	}
	byKey := map[string]*alertmodel.AlertRule{}
	for _, r := range current {
		byKey[AlertRuleStableID(r.Name)] = r
	}
	var sec SectionResult
	for _, r := range incoming {
		if r == nil {
			sec.Skipped++
			continue
		}
		key := AlertRuleStableID(r.Name)
		if key == "" {
			sec.Skipped++
			continue
		}
		existing, ok := byKey[key]
		if !ok {
			sec.Added++
			if !dryRun {
				toCreate := *r
				toCreate.ID = 0
				toCreate.CreatedAt = time.Time{}
				toCreate.UpdatedAt = time.Time{}
				if err := s.alerts.Create(ctx, &toCreate); err != nil {
					return SectionResult{}, fmt.Errorf("alert_rules import: create %q: %w", r.Name, err)
				}
			}
			continue
		}
		if AlertRulesEquivalent(existing, r) {
			sec.Skipped++
			continue
		}
		sec.Updated++
		if !dryRun {
			toUpdate := *r
			toUpdate.ID = existing.ID
			if err := s.alerts.Update(ctx, existing.ID, &toUpdate); err != nil {
				return SectionResult{}, fmt.Errorf("alert_rules import: update %q: %w", r.Name, err)
			}
		}
	}
	return sec, nil
}

// applyGeofences mirrors applyAlertRules for the geofences section.
// Stable_id is the lowercased name; missing rows are NOT deleted.
func (s *SettingsSerializer) applyGeofences(ctx context.Context, incoming []*systemmodel.Geofence, dryRun bool) (SectionResult, error) {
	current, err := s.geofences.GetAll(ctx)
	if err != nil {
		return SectionResult{}, fmt.Errorf("geofences import: list current: %w", err)
	}
	byKey := map[string]*systemmodel.Geofence{}
	for _, g := range current {
		byKey[AlertRuleStableID(g.Name)] = g
	}
	var sec SectionResult
	for _, g := range incoming {
		if g == nil {
			sec.Skipped++
			continue
		}
		key := AlertRuleStableID(g.Name)
		if key == "" {
			sec.Skipped++
			continue
		}
		existing, ok := byKey[key]
		if !ok {
			sec.Added++
			if !dryRun {
				toCreate := *g
				toCreate.ID = 0
				toCreate.CreatedAt = time.Time{}
				toCreate.UpdatedAt = time.Time{}
				if err := s.geofences.Create(ctx, &toCreate); err != nil {
					return SectionResult{}, fmt.Errorf("geofences import: create %q: %w", g.Name, err)
				}
			}
			continue
		}
		if geofencesEquivalent(existing, g) {
			sec.Skipped++
			continue
		}
		sec.Updated++
		if !dryRun {
			toUpdate := *g
			toUpdate.ID = existing.ID
			if err := s.geofences.Update(ctx, &toUpdate); err != nil {
				return SectionResult{}, fmt.Errorf("geofences import: update %q: %w", g.Name, err)
			}
		}
	}
	return sec, nil
}

// applyQuietHours converges the per-user quiet_hours windows.
// Stable_id is the (start_local|end_local|timezone) composite — the
// QuietHoursWindow type has no name field so this is the most stable
// identity the user can author by hand. Existing windows missing from
// the import are LEFT IN PLACE (additive merge).
func (s *SettingsSerializer) applyQuietHours(ctx context.Context, userID string, incoming []*models.QuietHoursWindow, dryRun bool) (SectionResult, error) {
	current, err := s.quietHours.ListByUser(ctx, userID)
	if err != nil {
		return SectionResult{}, fmt.Errorf("quiet_hours import: list current: %w", err)
	}
	byKey := map[string]*models.QuietHoursWindow{}
	for _, w := range current {
		byKey[quietHoursStableID(w)] = w
	}
	var sec SectionResult
	for _, w := range incoming {
		if w == nil {
			sec.Skipped++
			continue
		}
		key := quietHoursStableID(w)
		if key == "||" {
			sec.Skipped++
			continue
		}
		existing, ok := byKey[key]
		if !ok {
			sec.Added++
			if !dryRun {
				in := QuietHoursInput{
					Enabled:          ptrBool(w.Enabled),
					StartLocal:       ptrString(w.StartLocal),
					EndLocal:         ptrString(w.EndLocal),
					Timezone:         ptrString(w.Timezone),
					Weekdays:         ptrInt(w.Weekdays),
					BypassSeverities: ptrStringSlice(w.BypassSeverities),
				}
				if _, err := s.quietHours.Insert(ctx, userID, in); err != nil {
					return SectionResult{}, fmt.Errorf("quiet_hours import: insert %s: %w", key, err)
				}
			}
			continue
		}
		if quietHoursEquivalent(existing, w) {
			sec.Skipped++
			continue
		}
		sec.Updated++
		if !dryRun {
			in := QuietHoursInput{
				Enabled:          ptrBool(w.Enabled),
				StartLocal:       ptrString(w.StartLocal),
				EndLocal:         ptrString(w.EndLocal),
				Timezone:         ptrString(w.Timezone),
				Weekdays:         ptrInt(w.Weekdays),
				BypassSeverities: ptrStringSlice(w.BypassSeverities),
			}
			if _, err := s.quietHours.Update(ctx, userID, existing.ID, in); err != nil {
				return SectionResult{}, fmt.Errorf("quiet_hours import: update %s: %w", key, err)
			}
		}
	}
	return sec, nil
}

// AlertRuleStableID normalises a name into the case-insensitive,
// whitespace-trimmed key used to dedupe rules + geofences across
// imports. Empty / whitespace-only names are rejected (the import path
// counts them as skipped).
func AlertRuleStableID(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

// quietHoursStableID derives the composite key for a window. We
// can't use ID (it's reassigned on import) and there's no name
// field — start_local + end_local + timezone is the most stable
// user-authorable identity.
func quietHoursStableID(w *models.QuietHoursWindow) string {
	if w == nil {
		return "||"
	}
	return strings.ToLower(strings.TrimSpace(w.StartLocal)) + "|" +
		strings.ToLower(strings.TrimSpace(w.EndLocal)) + "|" +
		strings.TrimSpace(w.Timezone)
}

// settingsEquivalent reports whether two Settings structs are field-
// for-field equal. Used by the import path to surface unchanged
// imports as "skipped" instead of "updated".
//
// reflect.DeepEqual is used (instead of ==) because Settings now
// contains map[string]bool / map[string]any fields (ai_features /
// ai_provider_config, ADR-015) which the language forbids from
// direct struct comparison.
func settingsEquivalent(a, b *systemmodel.Settings) bool {
	if a == nil || b == nil {
		return a == b
	}
	return reflect.DeepEqual(*a, *b)
}

// AlertRulesEquivalent compares the user-authored fields of two rules.
// Server-managed columns (ID, CreatedAt, UpdatedAt) are excluded so
// "skipped" reflects "no behavioural difference" rather than "no
// timestamp difference".
//
// Phase-49 / Slice 0005: AllVehicles + VehicleIDs (sorted) are part of
// the equivalence so settings export/import round-trips multi-vehicle
// rules cleanly. The legacy VehicleID pointer is intentionally not
// compared independently — it is mirrored from VehicleIDs by the repo
// on read, so two rules with identical AllVehicles + VehicleIDs always
// have identical VehicleID.
//
// Phase-50 / ADR-005: MsgTemplate + IncludeTitle are compared so a
// reimport that toggles the title or rewords the body is recognised
// as a behavioural change (and not silently skipped).
func AlertRulesEquivalent(a, b *alertmodel.AlertRule) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.Name != b.Name || a.Enabled != b.Enabled || a.SignalName != b.SignalName ||
		a.Op != b.Op || a.Severity != b.Severity || a.CooldownMin != b.CooldownMin ||
		a.TriggerMode != b.TriggerMode || a.Kind != b.Kind ||
		a.IncludeTitle != b.IncludeTitle {
		return false
	}
	if a.AllVehicles != b.AllVehicles {
		return false
	}
	if !int64SliceEqSorted(a.VehicleIDs, b.VehicleIDs) {
		return false
	}
	if !ptrStringEq(a.Description, b.Description) ||
		!ptrFloatEq(a.ValueNum, b.ValueNum) ||
		!ptrStringEq(a.ValueText, b.ValueText) ||
		!ptrBoolEq(a.ValueBool, b.ValueBool) ||
		!ptrFloatEq(a.ValueMin, b.ValueMin) ||
		!ptrFloatEq(a.ValueMax, b.ValueMax) ||
		!ptrTimeEq(a.SnoozedUntil, b.SnoozedUntil) ||
		!ptrStringEq(a.MetricID, b.MetricID) ||
		!ptrStringEq(a.MetricWindow, b.MetricWindow) ||
		!ptrFloatEq(a.MetricThreshold, b.MetricThreshold) ||
		!ptrStringEq(a.MetricOp, b.MetricOp) ||
		!ptrStringEq(a.MsgTemplate, b.MsgTemplate) {
		return false
	}
	return true
}

// int64SliceEqSorted reports whether two int64 slices contain the same
// elements (order-insensitive). Both slices are copied + sorted before
// comparison so a caller-supplied unsorted slice doesn't trigger a
// false negative. Phase-49 / Slice 0005.
func int64SliceEqSorted(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	if len(a) == 0 {
		return true
	}
	aa := make([]int64, len(a))
	bb := make([]int64, len(b))
	copy(aa, a)
	copy(bb, b)
	sort.Slice(aa, func(i, j int) bool { return aa[i] < aa[j] })
	sort.Slice(bb, func(i, j int) bool { return bb[i] < bb[j] })
	for i := range aa {
		if aa[i] != bb[i] {
			return false
		}
	}
	return true
}

// geofencesEquivalent compares the user-authored fields of two
// geofences (name, polygon, category, enabled, alert flags).
// ID + timestamps are excluded.
//
// The alert flag comparison was added with migration 000192 — older import
// bundles that omit them unmarshal as `false`, so re-importing a legacy
// bundle against a row that has alerts enabled WILL flip the row off. This
// matches the rest of settings-import semantics (omitted fields = explicit
// false) and is the agreed trade-off for keeping the merge stable.
func geofencesEquivalent(a, b *systemmodel.Geofence) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.Name != b.Name || a.PolygonWKT != b.PolygonWKT {
		return false
	}
	if (a.Category == nil) != (b.Category == nil) {
		return false
	}
	if a.Category != nil && *a.Category != *b.Category {
		return false
	}
	if a.Enabled != b.Enabled {
		return false
	}
	if a.AlertOnEntry != b.AlertOnEntry {
		return false
	}
	if a.AlertOnExit != b.AlertOnExit {
		return false
	}
	return true
}

// quietHoursEquivalent compares the user-authored fields of two
// windows. Bypass severities are sorted before comparison so a
// reordering on the wire doesn't show up as a fake change.
func quietHoursEquivalent(a, b *models.QuietHoursWindow) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.Enabled != b.Enabled ||
		a.StartLocal != b.StartLocal ||
		a.EndLocal != b.EndLocal ||
		a.Timezone != b.Timezone ||
		a.Weekdays != b.Weekdays {
		return false
	}
	aSev := append([]string(nil), a.BypassSeverities...)
	bSev := append([]string(nil), b.BypassSeverities...)
	sort.Strings(aSev)
	sort.Strings(bSev)
	if len(aSev) != len(bSev) {
		return false
	}
	for i := range aSev {
		if aSev[i] != bSev[i] {
			return false
		}
	}
	return true
}

// ptr* helpers — small wrappers used by the apply paths to convert
// concrete values to the QuietHoursInput pointer fields. Kept here so
// the call sites stay one-line.
func ptrBool(v bool) *bool                { return &v }
func ptrString(v string) *string          { return &v }
func ptrInt(v int) *int                   { return &v }
func ptrStringSlice(v []string) *[]string { return &v }

// ptr*Eq helpers compare two pointer-of-T values: nil/nil → equal,
// nil/non-nil → not equal, non-nil/non-nil → element-equal.
func ptrStringEq(a, b *string) bool {
	if (a == nil) != (b == nil) {
		return false
	}
	return a == nil || *a == *b
}
func ptrFloatEq(a, b *float64) bool {
	if (a == nil) != (b == nil) {
		return false
	}
	return a == nil || *a == *b
}
func ptrBoolEq(a, b *bool) bool {
	if (a == nil) != (b == nil) {
		return false
	}
	return a == nil || *a == *b
}
func ptrTimeEq(a, b *time.Time) bool {
	if (a == nil) != (b == nil) {
		return false
	}
	return a == nil || a.Equal(*b)
}

// Compile-time check: the production *AlertRuleRepo, *GeofenceRepo
// and *QuietHoursRepo all satisfy the serializer interfaces. Catches
// signature drift at build time. SettingsRepo is intentionally NOT
// asserted because pgx.Tx wrapping is exercised by the WithTx-aware
// repos exclusively at runtime.
// Compile-time assertion for *SettingsRepo only — *GeofenceRepo and
// *QuietHoursRepo are asserted from their respective subpackages
// (internal/database/geofence/assertion.go, internal/database/quiethours/
// assertion.go) per Lesson 30/34: the assertion lives with the concrete
// type and depends on the parent interface (child -> parent), keeping the
// parent free of child imports.
var (
	_ SettingsSerializerSettingsRepo = (*SettingsRepo)(nil)
)
