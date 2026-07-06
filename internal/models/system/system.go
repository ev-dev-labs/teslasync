package system

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"
)

// =============================================================================
// system.go — Go models for the system / admin / runtime tables defined in
// migration 000142_baseline_typed (Phase 3 schema 23-system-tables.sql).
//
// One Go struct per table. Snake_case `db` and `json` tags mirror the
// column names exactly. Nullable columns use pointer types. No `raw_json`,
// no JSONB carve-outs (ADR-001, ADR-005). The `embeddings` vector column is
// the sole exception — it uses pgvector and is exposed as a typed slice.
// =============================================================================

// SettingsKind enumerates the valid `data_kind` values for a Setting row.
type SettingsKind string

const (
	SettingsKindText    SettingsKind = "text"
	SettingsKindNumber  SettingsKind = "number"
	SettingsKindBoolean SettingsKind = "boolean"
)

// Setting mirrors the post-migration `settings` schema (typed key-value store).
// Exactly one of ValueText / ValueNum / ValueBool is meaningful, selected by DataKind.
type Setting struct {
	Key         string       `db:"key" json:"key"`
	ValueText   *string      `db:"value_text" json:"value_text,omitempty"`
	ValueNum    *float64     `db:"value_num" json:"value_num,omitempty"`
	ValueBool   *bool        `db:"value_bool" json:"value_bool,omitempty"`
	DataKind    SettingsKind `db:"data_kind" json:"data_kind"`
	Description *string      `db:"description" json:"description,omitempty"`
	CreatedAt   time.Time    `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time    `db:"updated_at" json:"updated_at"`
}

// PollingConfig mirrors the post-migration `polling_config` schema
// (per-vehicle polling tuning). VehicleID is the primary key (1:1 with vehicles).
type PollingConfig struct {
	VehicleID          int64     `db:"vehicle_id" json:"vehicle_id"`
	AwakeIntervalSec   int32     `db:"awake_interval_sec" json:"awake_interval_sec"`
	AsleepIntervalSec  int32     `db:"asleep_interval_sec" json:"asleep_interval_sec"`
	DrivingIntervalSec int32     `db:"driving_interval_sec" json:"driving_interval_sec"`
	Enabled            bool      `db:"enabled" json:"enabled"`
	CreatedAt          time.Time `db:"created_at" json:"created_at"`
	UpdatedAt          time.Time `db:"updated_at" json:"updated_at"`
}

// PlaceCategory enumerates the valid `category` values for a Place row.
type PlaceCategory string

const (
	PlaceCategoryHome     PlaceCategory = "home"
	PlaceCategoryWork     PlaceCategory = "work"
	PlaceCategoryCharging PlaceCategory = "charging"
	PlaceCategoryCustom   PlaceCategory = "custom"
)

// Place mirrors the post-migration `places` schema (named locations).
type Place struct {
	ID        int64          `db:"id" json:"id"`
	Name      string         `db:"name" json:"name"`
	Latitude  float64        `db:"latitude" json:"latitude"`
	Longitude float64        `db:"longitude" json:"longitude"`
	RadiusM   int32          `db:"radius_m" json:"radius_m"`
	Category  *PlaceCategory `db:"category" json:"category,omitempty"`
	CreatedAt time.Time      `db:"created_at" json:"created_at"`
	UpdatedAt time.Time      `db:"updated_at" json:"updated_at"`
}

// GeofenceCategory enumerates the valid `category` values for a Geofence row.
type GeofenceCategory string

const (
	GeofenceCategoryHome       GeofenceCategory = "home"
	GeofenceCategoryWork       GeofenceCategory = "work"
	GeofenceCategoryRestricted GeofenceCategory = "restricted"
	GeofenceCategoryCustom     GeofenceCategory = "custom"
)

// Geofence mirrors the post-migration `geofences` schema. PolygonWKT is a
// Well-Known Text POLYGON((lon lat, ...)) parsed at runtime — not server-side.
//
// Enabled / AlertOnEntry / AlertOnExit were added by migration
// 000192_geofences_alerts. Pre-existing rows are backfilled with
// `enabled=false`; alert consumers (FSM transitions, notification dispatcher)
// MUST filter on Enabled themselves — FindByCoordinates intentionally returns
// disabled fences too because the reverse-geocoder uses it for friendly naming.
type Geofence struct {
	ID           int64             `db:"id" json:"id"`
	Name         string            `db:"name" json:"name"`
	PolygonWKT   string            `db:"polygon_wkt" json:"polygon_wkt"`
	Category     *GeofenceCategory `db:"category" json:"category,omitempty"`
	Enabled      bool              `db:"enabled" json:"enabled"`
	AlertOnEntry bool              `db:"alert_on_entry" json:"alert_on_entry"`
	AlertOnExit  bool              `db:"alert_on_exit" json:"alert_on_exit"`
	CreatedAt    time.Time         `db:"created_at" json:"created_at"`
	UpdatedAt    time.Time         `db:"updated_at" json:"updated_at"`
}

// Centroid computes the arithmetic mean of the polygon vertices.
// Returns (0, 0) for a nil receiver or if PolygonWKT is empty or unparseable.
// WKT convention: coordinates are (longitude latitude).
func (g *Geofence) Centroid() (lat, lon float64) {
	if g == nil || g.PolygonWKT == "" {
		return 0, 0
	}
	start := strings.Index(g.PolygonWKT, "((")
	end := strings.Index(g.PolygonWKT, "))")
	if start < 0 || end < 0 || end <= start+2 {
		return 0, 0
	}
	coords := g.PolygonWKT[start+2 : end]
	pairs := strings.Split(coords, ",")
	if len(pairs) > 1 && strings.TrimSpace(pairs[0]) == strings.TrimSpace(pairs[len(pairs)-1]) {
		pairs = pairs[:len(pairs)-1]
	}

	var sumLat, sumLon float64
	var count int
	for _, pair := range pairs {
		p := strings.TrimSpace(pair)
		parts := strings.Fields(p)
		if len(parts) != 2 {
			continue
		}
		lonVal, err1 := strconv.ParseFloat(parts[0], 64)
		latVal, err2 := strconv.ParseFloat(parts[1], 64)
		if err1 != nil || err2 != nil {
			continue
		}
		sumLon += lonVal
		sumLat += latVal
		count++
	}
	if count == 0 {
		return 0, 0
	}
	return sumLat / float64(count), sumLon / float64(count)
}

// Latitude returns the centroid latitude of this geofence's polygon.
func (g *Geofence) Latitude() float64 {
	lat, _ := g.Centroid()
	return lat
}

// Longitude returns the centroid longitude of this geofence's polygon.
func (g *Geofence) Longitude() float64 {
	_, lon := g.Centroid()
	return lon
}

// Radius returns the approximate radius (in meters) of this geofence's polygon,
// computed as the max Haversine distance from the centroid to any polygon vertex.
// Returns 0 if the polygon is empty or unparseable.
func (g *Geofence) Radius() float64 {
	cLat, cLon := g.Centroid()
	if cLat == 0 && cLon == 0 {
		return 0
	}

	start := strings.Index(g.PolygonWKT, "((")
	end := strings.Index(g.PolygonWKT, "))")
	if start < 0 || end < 0 || end <= start+2 {
		return 0
	}
	coords := g.PolygonWKT[start+2 : end]
	pairs := strings.Split(coords, ",")

	var maxDist float64
	for _, pair := range pairs {
		p := strings.TrimSpace(pair)
		parts := strings.Fields(p)
		if len(parts) != 2 {
			continue
		}
		lonVal, err1 := strconv.ParseFloat(parts[0], 64)
		latVal, err2 := strconv.ParseFloat(parts[1], 64)
		if err1 != nil || err2 != nil {
			continue
		}
		d := geofenceHaversineM(cLat, cLon, latVal, lonVal)
		if d > maxDist {
			maxDist = d
		}
	}
	return math.Round(maxDist)
}

// geofenceHaversineM returns the great-circle distance between two points in meters.
func geofenceHaversineM(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6_371_000.0 // Earth radius in meters
	dLat := (lat2 - lat1) * math.Pi / 180.0
	dLon := (lon2 - lon1) * math.Pi / 180.0
	lat1r := lat1 * math.Pi / 180.0
	lat2r := lat2 * math.Pi / 180.0

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1r)*math.Cos(lat2r)*math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

// MarshalJSON augments the default Geofence encoding with the circle-shape
// fields the web client consumes (`latitude`, `longitude`, `radius`).
//
// The DB stores a polygon as WKT; the centroid and bounding radius are
// derived on the fly via the existing Centroid()/Radius() methods. Emitting
// these alongside `polygon_wkt` is purely additive — no field is removed —
// so non-web consumers continue to see the same shape they always did.
func (g Geofence) MarshalJSON() ([]byte, error) {
	type alias Geofence
	lat, lon := g.Centroid()
	return json.Marshal(struct {
		alias
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		Radius    float64 `json:"radius"`
	}{
		alias:     alias(g),
		Latitude:  lat,
		Longitude: lon,
		Radius:    g.Radius(),
	})
}

// UnmarshalJSON is the symmetric counterpart of MarshalJSON. The
// derived `latitude`, `longitude`, `radius` fields emitted by
// MarshalJSON are accepted on input but discarded — they are
// recomputed from PolygonWKT on every read. Without this method,
// settings export/import (Phase-46 / Prompt 36) round-trips fail
// when `DisallowUnknownFields()` is enabled on the import decoder.
func (g *Geofence) UnmarshalJSON(data []byte) error {
	type alias Geofence
	aux := struct {
		*alias
		Latitude  *float64 `json:"latitude,omitempty"`
		Longitude *float64 `json:"longitude,omitempty"`
		Radius    *float64 `json:"radius,omitempty"`
	}{alias: (*alias)(g)}
	return json.Unmarshal(data, &aux)
}

// ElectricityCost mirrors the post-migration `electricity_cost` schema
// (time-of-use rate schedule). RatePerKwh is numeric(10,6); represented as
// float64 since the rate has a fixed magnitude well within float64 precision.
// StartTime/EndTime are SQL `time` values; represented as time.Time with the
// date component unused (consumers should read only the clock portion).
type ElectricityCost struct {
	ID            int64      `db:"id" json:"id"`
	Region        string     `db:"region" json:"region"`
	StartTime     time.Time  `db:"start_time" json:"start_time"`
	EndTime       time.Time  `db:"end_time" json:"end_time"`
	RatePerKwh    float64    `db:"rate_per_kwh" json:"rate_per_kwh"`
	Currency      string     `db:"currency" json:"currency"`
	EffectiveFrom time.Time  `db:"effective_from" json:"effective_from"`
	EffectiveTo   *time.Time `db:"effective_to" json:"effective_to,omitempty"`
	CreatedAt     time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt     time.Time  `db:"updated_at" json:"updated_at"`
}

// GasGrade enumerates the valid `grade` values for a GasPrice row.
type GasGrade string

const (
	GasGradeRegular  GasGrade = "regular"
	GasGradeMidgrade GasGrade = "midgrade"
	GasGradePremium  GasGrade = "premium"
	GasGradeDiesel   GasGrade = "diesel"
)

// GasPrice mirrors the post-migration `gas_prices` schema (append-only
// regional gas-price snapshots; no updated_at).
type GasPrice struct {
	ID             int64     `db:"id" json:"id"`
	Ts             time.Time `db:"ts" json:"ts"`
	Region         string    `db:"region" json:"region"`
	Grade          GasGrade  `db:"grade" json:"grade"`
	PricePerGallon float64   `db:"price_per_gallon" json:"price_per_gallon"`
	Currency       string    `db:"currency" json:"currency"`
	Source         string    `db:"source" json:"source"`
}

// AuditLog mirrors the post-migration `audit_logs` schema (append-only;
// composite PK (ts, id); no updated_at).
type AuditLog struct {
	ID         int64     `db:"id" json:"id"`
	Ts         time.Time `db:"ts" json:"ts"`
	Actor      string    `db:"actor" json:"actor"`
	Action     string    `db:"action" json:"action"`
	EntityType string    `db:"entity_type" json:"entity_type"`
	EntityID   *int64    `db:"entity_id" json:"entity_id,omitempty"`
	Detail     *string   `db:"detail" json:"detail,omitempty"`
}

// CommandStatus enumerates the valid `status` values for a CommandExecution row.
type CommandStatus string

const (
	CommandStatusQueued    CommandStatus = "queued"
	CommandStatusRunning   CommandStatus = "running"
	CommandStatusSucceeded CommandStatus = "succeeded"
	CommandStatusFailed    CommandStatus = "failed"
	CommandStatusTimedOut  CommandStatus = "timed_out"
)

// CommandExecution mirrors the post-migration `command_executions` schema
// (append-only Tesla command invocation log; composite PK (ts, id)).
type CommandExecution struct {
	ID           int64         `db:"id" json:"id"`
	Ts           time.Time     `db:"ts" json:"ts"`
	VehicleID    int64         `db:"vehicle_id" json:"vehicle_id"`
	Command      string        `db:"command" json:"command"`
	InvokedBy    string        `db:"invoked_by" json:"invoked_by"`
	Status       CommandStatus `db:"status" json:"status"`
	DurationMs   *int32        `db:"duration_ms" json:"duration_ms,omitempty"`
	ErrorMessage *string       `db:"error_message" json:"error_message,omitempty"`
}

// IsTerminal reports whether the command has reached a terminal state.
func (c *CommandExecution) IsTerminal() bool {
	if c == nil {
		return false
	}
	switch c.Status {
	case CommandStatusSucceeded, CommandStatusFailed, CommandStatusTimedOut:
		return true
	default:
		return false
	}
}

// FSMTransition mirrors the post-migration `fsm_transitions` schema
// (append-only state machine log; composite PK (ts, id)).
type FSMTransition struct {
	ID        int64     `db:"id" json:"id"`
	Ts        time.Time `db:"ts" json:"ts"`
	VehicleID int64     `db:"vehicle_id" json:"vehicle_id"`
	FromState string    `db:"from_state" json:"from_state"`
	ToState   string    `db:"to_state" json:"to_state"`
	Trigger   *string   `db:"trigger" json:"trigger,omitempty"`
}

// Settings is the typed-struct facade over the key/value `settings` table
// (ADR-011 Option A). Each field corresponds to one row in `settings`,
// keyed by the JSON tag. Repositories aggregate N rows into this struct on
// Get and decompose it into N upserts on Upsert. The JSON wire shape is
// preserved verbatim from the pre-refactor wide-row form so the frontend
// `useSettings` hook and Settings pages render unchanged.
//
// `polling_config` is intentionally NOT a field here — per-vehicle polling
// tuning lives in the sibling `polling_config` table (see PollingConfig
// above) and is accessed via its own repo methods. This eliminates the
// pre-refactor JSONB carve-out (ADR-001, ADR-005).
type Settings struct {
	UnitOfLength   string  `json:"unit_of_length"`
	UnitOfTemp     string  `json:"unit_of_temp"`
	UnitOfPressure string  `json:"unit_of_pressure"`
	PreferredRange string  `json:"preferred_range"`
	Language       string  `json:"language"`
	BaseCostPerKWh float64 `json:"base_cost_per_kwh"`
	APISuspended   bool    `json:"api_suspended"`
	Theme          string  `json:"theme"`
	Mode           string  `json:"mode"`
	CustomPrimary  string  `json:"custom_primary"`
	CustomAccent   string  `json:"custom_accent"`
	// CompletedTours records which onboarding tours the user has finished or
	// skipped so that a client whose localStorage/cookies were cleared does
	// not re-trigger a tour the user has already seen. Each entry is a
	// "{tourId}:{version}" marker (e.g. "main:1"); bumping a tour's version
	// re-arms it for everyone. Persisted as a JSONB array in the typed
	// settings key/value table (ADR-011), mirroring ai_features. Always
	// serialised as a JSON array — "[]" when empty, never null.
	CompletedTours    []string `json:"completed_tours"`
	GasPricePerUnit   float64  `json:"gas_price_per_unit"`
	GasUnit           string   `json:"gas_unit"`
	GasEfficiencyMPG  float64  `json:"gas_efficiency_mpg"`
	DecimalPrecision  int      `json:"decimal_precision"`
	QuietHoursEnabled bool     `json:"quiet_hours_enabled"`
	QuietHoursStart   string   `json:"quiet_hours_start"`
	QuietHoursEnd     string   `json:"quiet_hours_end"`
	AlertDigestMode   string   `json:"alert_digest_mode"`
	// CurrencySymbol is the Unicode glyph rendered alongside currency
	// values (e.g. "$", "€", "£"). The frontend uses this verbatim;
	// no ISO 4217 lookup is performed on the wire. Defaults to "$".
	CurrencySymbol string `json:"currency_symbol"`
	// Locale is a BCP-47 tag (e.g. "en-US", "de-DE", "fr-FR") used by
	// `Intl.NumberFormat` for thousands/decimal separators on the
	// frontend. Defaults to "en-US".
	Locale string `json:"locale"`
	// TzDisplayDefault selects which IANA timezone the frontend uses
	// when rendering timestamps without an explicit `in` override
	// on a `<DateTime>`. One of "vehicle" (car local time, falling
	// back to user when the car has no known TZ), "user" (browser
	// local), or "utc". Defaults to "vehicle" (Phase 40 / 22).
	TzDisplayDefault string `json:"tz_display_default"`
	// TimezoneUser overrides the browser's detected timezone when set
	// (useful when the user is travelling but wants timestamps in their
	// home zone). Empty string = use browser TZ. Validated server-side
	// against Go's tzdata so invalid IANA names are rejected.
	TimezoneUser string `json:"timezone_user"`
	// TabBadgeEnabled toggles the browser-tab signalling that prefixes
	// `document.title` with `(N)` and paints a coloured dot on the
	// favicon when there are unread notifications. Defaults to true so
	// existing users get the feature without an opt-in. (Phase 40 / 32.)
	TabBadgeEnabled bool `json:"tab_badge_enabled"`
	// CriticalFlashEnabled toggles the brief title-flash that fires
	// when a critical alert arrives while the tab is in the
	// background. Defaults to true; honoured alongside the
	// browser-level `prefers-reduced-motion` preference, which
	// suppresses the flash regardless of this setting. (Phase 40 / 32.)
	CriticalFlashEnabled bool `json:"critical_flash_enabled"`
	// UIDensity controls the global information-density preference
	// applied across the React frontend (table row heights, card
	// padding, button sizing). One of "compact" (32px rows / tight
	// padding), "comfortable" (44px rows / default padding), or
	// "spacious" (56px rows / loose padding). Defaults to
	// "comfortable" so existing users see no visual change.
	// (Phase 40 / 44.)
	UIDensity string `json:"ui_density"`
	// TimeFormatDefault selects the default rendering of <TimeStamp>
	// when no explicit `format` prop is set. One of "relative"
	// (e.g. "2h ago", best for activity feeds) or "absolute"
	// (e.g. "Nov 12, 13:42", best for trip planning + event
	// correlation). The alternate format is always shown on hover.
	// Defaults to "relative". (Phase 45 / 22.)
	TimeFormatDefault string `json:"time_format_default"`
	// ChartPalette selects the colour ramp used by multi-series
	// charts. One of "cb_safe" (Okabe-Ito, distinguishable for all
	// CVD types — the default) or "neon" (bright cyan/magenta legacy
	// palette). Drives the reactive `useChartPalette()` hook so
	// consumers re-render with the new colours when the user toggles.
	// (Phase 45 / 23.)
	ChartPalette string `json:"chart_palette"`

	// ── Typography preferences (Typography Unit 0) ──
	// Written by the frontend FontProvider; drive the --font-* CSS variables
	// at the display boundary only. Defaults mirror DEFAULT_FONT_PREFS in
	// web/src/components/ui/FontProvider.tsx.
	FontFamily        string  `json:"font_family"`         // sans preset id (inter/system/roboto/…) or "custom"
	FontMono          string  `json:"font_mono"`           // mono preset id (jetbrains/fira/…) or "custom"
	FontCustomSans    string  `json:"font_custom_sans"`    // custom sans CSS font stack
	FontCustomMono    string  `json:"font_custom_mono"`    // custom mono CSS font stack
	FontScale         float64 `json:"font_scale"`          // text size multiplier written to --font-scale
	FontLeading       float64 `json:"font_leading"`        // base line-height written to --leading
	FontTracking      string  `json:"font_tracking"`       // base letter-spacing (em) written to --tracking
	FontHeadingWeight int     `json:"font_heading_weight"` // heading weight written to --font-weight-bold

	// AIMode is the top-level AI feature gate (ADR-015). One of:
	//   - "off"   (default) — every AI surface is hidden, every
	//                         /api/v1/ai/* route returns 404, no
	//                         outbound AI calls are made.
	//   - "local" — only RFC1918/loopback providers are accepted.
	//   - "cloud" — any configured provider is allowed.
	// Mode upgrades require an explicit user action in Settings; the
	// backend never silently promotes the mode on update.
	AIMode string `json:"ai_mode"`

	// AIFeatures is the per-feature opt-in map keyed by canonical
	// feature ID (see internal/ai/features/registry.go). An entry is
	// `true` only if the user has explicitly enabled that feature.
	// Default: empty map = every feature off (ADR-015 §I7).
	AIFeatures map[string]bool `json:"ai_features"`

	// AIProviderConfig is the adapter-specific configuration map
	// (base_url, model, api_key_ref, …) keyed by provider ID. Per
	// ADR-015 §I9 this MUST be redacted from the client response
	// when AIMode == "off"; the redaction lives in the settings
	// handler, not on the type.
	AIProviderConfig map[string]any `json:"ai_provider_config,omitempty"`

	// AICostCapCents is the daily AI cost cap in cents. 0 = unset
	// (rate limiter still applies). Slice F9 enforces this.
	AICostCapCents int `json:"ai_cost_cap_cents"`

	// AIFeaturesArchived is the snapshot of AIFeatures preserved at
	// the moment ai_mode was set to 'off'. Per ADR-015 §I7, flipping
	// the top-level mode off clears AIFeatures so a subsequent
	// re-enable cannot silently restore previously-on features. The
	// archive lets the F2 Settings UI surface an explicit "Restore
	// previous selection?" panel — restore is never silent. Cleared
	// to {} once the user explicitly Confirms or Declines the
	// restore. Default: empty map. (Phase-50 / 0003 / F2.)
	AIFeaturesArchived map[string]bool `json:"ai_features_archived,omitempty"`
}

// Embedding mirrors the post-migration `embeddings` schema (pgvector-backed).
//
// ADR-005 carve-out: Embedding is the only field permitted to use a non-scalar
// type, since pgvector's vector(384) has no scalar Go equivalent. Repositories
// marshal []float32 ↔ pgvector.Vector at the database boundary.
type Embedding struct {
	ID         int64     `db:"id" json:"id"`
	EntityType string    `db:"entity_type" json:"entity_type"`
	EntityID   int64     `db:"entity_id" json:"entity_id"`
	Embedding  []float32 `db:"embedding" json:"embedding"`
	Model      string    `db:"model" json:"model"`
	CreatedAt  time.Time `db:"created_at" json:"created_at"`
	UpdatedAt  time.Time `db:"updated_at" json:"updated_at"`
}
