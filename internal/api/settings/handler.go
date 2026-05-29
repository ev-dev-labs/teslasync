package settings

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	settingsmodel "github.com/ev-dev-labs/teslasync/internal/models/settings"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"

	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	"github.com/rs/zerolog/log"
)

// SettingsHandler handles user settings.
type SettingsHandler struct {
	settingsRepo     *settingsdb.SettingsRepo
	db               *database.DB
	telemetryHandler any
}

func NewSettingsHandler(db *database.DB) *SettingsHandler {
	return &SettingsHandler{settingsRepo: settingsdb.NewSettingsRepo(db), db: db}
}

// SetTelemetryHandler allows the settings handler to sync capture toggle changes.
func (h *SettingsHandler) SetTelemetryHandler(th any) {
	h.telemetryHandler = th
}

func (h *SettingsHandler) Get(w http.ResponseWriter, r *http.Request) {
	s, err := h.settingsRepo.Get(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to get settings")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get settings")
		return
	}
	// ADR-015 §I9: off mode never exposes saved provider config or the archived
	// feature map. They stay persisted so a later explicit re-enable can restore
	// state without leaking historical AI choices while AI is off.
	if s.AIMode == "off" {
		s.AIProviderConfig = nil
		s.AIFeaturesArchived = nil
	}
	httpx.WriteJSON(w, http.StatusOK, s)
}

func (h *SettingsHandler) Update(w http.ResponseWriter, r *http.Request) {
	var s systemmodel.Settings
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	validUnitsLen := map[string]bool{"km": true, "mi": true}
	validUnitsTemp := map[string]bool{"C": true, "F": true}
	validUnitsPressure := map[string]bool{"bar": true, "psi": true}
	validRange := map[string]bool{"ideal": true, "rated": true}

	if s.UnitOfLength != "" && !validUnitsLen[s.UnitOfLength] {
		httpx.WriteError(w, http.StatusBadRequest, "unit_of_length must be 'km' or 'mi'")
		return
	}
	if s.UnitOfTemp != "" && !validUnitsTemp[s.UnitOfTemp] {
		httpx.WriteError(w, http.StatusBadRequest, "unit_of_temp must be 'C' or 'F'")
		return
	}
	if s.UnitOfPressure != "" && !validUnitsPressure[s.UnitOfPressure] {
		httpx.WriteError(w, http.StatusBadRequest, "unit_of_pressure must be 'bar' or 'psi'")
		return
	}
	if s.PreferredRange != "" && !validRange[s.PreferredRange] {
		httpx.WriteError(w, http.StatusBadRequest, "preferred_range must be 'ideal' or 'rated'")
		return
	}
	if s.BaseCostPerKWh < 0 || s.BaseCostPerKWh > 10 {
		httpx.WriteError(w, http.StatusBadRequest, "base_cost_per_kwh must be between 0 and 10")
		return
	}
	if len(s.Language) > 10 {
		httpx.WriteError(w, http.StatusBadRequest, "language must be 10 characters or less")
		return
	}
	if len(s.CurrencySymbol) > 8 {
		httpx.WriteError(w, http.StatusBadRequest, "currency_symbol must be 8 characters or less")
		return
	}
	if s.Locale != "" && !isValidBCP47(s.Locale) {
		httpx.WriteError(w, http.StatusBadRequest, "locale must be a BCP-47 tag (e.g. 'en-US', 'de-DE')")
		return
	}
	if s.TzDisplayDefault != "" && !isValidTzDisplayMode(s.TzDisplayDefault) {
		httpx.WriteError(w, http.StatusBadRequest, "tz_display_default must be 'vehicle', 'user', or 'utc'")
		return
	}
	if s.TimezoneUser != "" && !isValidIANATimezone(s.TimezoneUser) {
		httpx.WriteError(w, http.StatusBadRequest, "timezone_user must be a valid IANA timezone (e.g. 'America/Los_Angeles')")
		return
	}
	validUIDensity := map[string]bool{"compact": true, "comfortable": true, "spacious": true}
	if s.UIDensity != "" && !validUIDensity[s.UIDensity] {
		httpx.WriteError(w, http.StatusBadRequest, "ui_density must be 'compact', 'comfortable', or 'spacious'")
		return
	}
	validTimeFormat := map[string]bool{"relative": true, "absolute": true}
	if s.TimeFormatDefault != "" && !validTimeFormat[s.TimeFormatDefault] {
		httpx.WriteError(w, http.StatusBadRequest, "time_format_default must be 'relative' or 'absolute'")
		return
	}
	validChartPalette := map[string]bool{"cb_safe": true, "neon": true}
	if s.ChartPalette != "" && !validChartPalette[s.ChartPalette] {
		httpx.WriteError(w, http.StatusBadRequest, "chart_palette must be 'cb_safe' or 'neon'")
		return
	}
	// ADR-015 §I2 — three modes, one flag. Validate so a typo in
	// the request body cannot poison the DB and inadvertently
	// flip the user out of the off-by-default state.
	validAIMode := map[string]bool{"off": true, "local": true, "cloud": true}
	if s.AIMode != "" && !validAIMode[s.AIMode] {
		httpx.WriteError(w, http.StatusBadRequest, "ai_mode must be 'off', 'local', or 'cloud'")
		return
	}
	if s.AICostCapCents < 0 {
		httpx.WriteError(w, http.StatusBadRequest, "ai_cost_cap_cents must be >= 0")
		return
	}

	// ADR-015 §I9: Get redacts AI secrets and archived feature state in off mode,
	// so preserve stored values across SPA round-trips that omit those fields.
	if s.AIProviderConfig == nil || s.AIFeaturesArchived == nil {
		if existing, err := h.settingsRepo.Get(r.Context()); err == nil && existing != nil {
			if s.AIProviderConfig == nil {
				s.AIProviderConfig = existing.AIProviderConfig
			}
			if s.AIFeaturesArchived == nil {
				s.AIFeaturesArchived = existing.AIFeaturesArchived
			}
		}
	}

	// Phase-50 / F2: switching AI off clears active toggles but archives the prior
	// enabled set so a later restore is explicit, not automatic.
	if s.AIMode == "off" {
		existing, err := h.settingsRepo.Get(r.Context())
		if err == nil && existing != nil {
			applyAIArchiveOnModeFlip(existing, &s)
		} else {
			// We could not read the prior state; clear AIFeatures
			// anyway because off means off. The archive stays
			// whatever the request body carried (which is what
			// was preserved earlier in this handler from the
			// existing read).
			s.AIFeatures = map[string]bool{}
		}
	}

	// Record gas price change in history if price or unit changed
	if s.GasPricePerUnit > 0 {
		oldSettings, _ := h.settingsRepo.Get(r.Context())
		if oldSettings == nil || oldSettings.GasPricePerUnit != s.GasPricePerUnit ||
			oldSettings.GasUnit != s.GasUnit || oldSettings.GasEfficiencyMPG != s.GasEfficiencyMPG {
			h.db.Pool.Exec(r.Context(),
				`UPDATE gas_price_history SET effective_to = NOW() WHERE effective_to IS NULL`)
			h.db.Pool.Exec(r.Context(),
				`INSERT INTO gas_price_history (price_per_unit, unit, efficiency_mpg, effective_from) VALUES ($1, $2, $3, NOW())`,
				s.GasPricePerUnit, s.GasUnit, s.GasEfficiencyMPG)
		}
	}

	if err := h.settingsRepo.Upsert(r.Context(), &s); err != nil {
		log.Error().Err(err).Msg("failed to update settings")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to update settings")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s)
}

// ToggleAPISuspend toggles the api_suspended flag. POST /api/v1/settings/suspend-api
func (h *SettingsHandler) ToggleAPISuspend(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Suspended bool `json:"suspended"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	s, err := h.settingsRepo.Get(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to get settings for suspend toggle")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get settings")
		return
	}
	s.APISuspended = body.Suspended

	if err := h.settingsRepo.Upsert(r.Context(), s); err != nil {
		log.Error().Err(err).Msg("failed to toggle api_suspended")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to update api_suspended")
		return
	}

	log.Info().Bool("api_suspended", body.Suspended).Msg("Tesla API suspension toggled")
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"api_suspended": body.Suspended})
}

// GetPollingConfig returns the current polling endpoint configuration.
// Per-vehicle polling tuning now lives in the `polling_config` table;
// this endpoint returns a backward-compatible LegacyPollingConfig with
// all endpoints enabled (default safe state).
func (h *SettingsHandler) GetPollingConfig(w http.ResponseWriter, r *http.Request) {
	pc := settingsmodel.DefaultPollingConfig()
	httpx.WriteJSON(w, http.StatusOK, pc)
}

// UpdatePollingConfig accepts a polling configuration update.
// Per-vehicle polling tuning now lives in the `polling_config` table;
// this is a no-op that returns the default config.
func (h *SettingsHandler) UpdatePollingConfig(w http.ResponseWriter, r *http.Request) {
	var pc settingsmodel.LegacyPollingConfig
	if err := json.NewDecoder(r.Body).Decode(&pc); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	log.Info().Interface("polling_config", pc).Msg("polling config updated (legacy no-op)")

	httpx.WriteJSON(w, http.StatusOK, pc)
}

// dashboardLayoutsResponse is the JSON envelope for dashboard layout persistence.
type dashboardLayoutsResponse struct {
	Dashboards json.RawMessage `json:"dashboards"`
	ActiveID   string          `json:"active_id"`
}

// maxDashboardLayoutSize is the maximum allowed body size for layout storage (1 MB).
const maxDashboardLayoutSize = 1 << 20

// GetDashboardLayouts returns persisted dashboard layouts.
func (h *SettingsHandler) GetDashboardLayouts(w http.ResponseWriter, r *http.Request) {
	raw, err := h.settingsRepo.GetDashboardLayouts(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to get dashboard layouts")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get dashboard layouts")
		return
	}
	if raw == "" {
		httpx.WriteJSON(w, http.StatusOK, dashboardLayoutsResponse{
			Dashboards: json.RawMessage("[]"),
			ActiveID:   "default",
		})
		return
	}

	var stored dashboardLayoutsResponse
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		// Corrupted data — return empty default rather than 500.
		log.Warn().Err(err).Msg("corrupted dashboard_layouts in settings, returning defaults")
		httpx.WriteJSON(w, http.StatusOK, dashboardLayoutsResponse{
			Dashboards: json.RawMessage("[]"),
			ActiveID:   "default",
		})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, stored)
}

// UpdateDashboardLayouts persists dashboard layout data.
// PUT /settings/dashboard-layouts
func (h *SettingsHandler) UpdateDashboardLayouts(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxDashboardLayoutSize+1))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	if len(body) > maxDashboardLayoutSize {
		httpx.WriteError(w, http.StatusRequestEntityTooLarge, "dashboard layouts payload exceeds 1 MB limit")
		return
	}

	var payload dashboardLayoutsResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if payload.ActiveID == "" {
		payload.ActiveID = "default"
	}
	if len(payload.Dashboards) == 0 || payload.Dashboards[0] != '[' {
		httpx.WriteError(w, http.StatusBadRequest, "dashboards must be a JSON array")
		return
	}

	canonical, err := json.Marshal(payload)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to serialize dashboard layouts")
		return
	}

	if err := h.settingsRepo.UpsertDashboardLayouts(r.Context(), string(canonical)); err != nil {
		log.Error().Err(err).Msg("failed to persist dashboard layouts")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to persist dashboard layouts")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, payload)
}

// bcp47Pattern is a deliberately conservative subset of BCP-47 — it covers
// the locales we ship i18n bundles for (en-US, en-GB, de-DE, fr-FR, es-ES,
// ja-JP, zh-CN, …). Either a 2-3 letter language tag, or a language tag
// followed by a 2-letter region (or 3-digit UN M.49 code) is accepted.
var bcp47Pattern = regexp.MustCompile(`^[a-z]{2,3}(-(?:[A-Z]{2}|[0-9]{3}))?$`)

// isValidBCP47 reports whether s is a supported BCP-47 locale tag.
func isValidBCP47(s string) bool {
	if len(s) > 16 {
		return false
	}
	return bcp47Pattern.MatchString(s)
}

// isValidTzDisplayMode reports whether s is a supported tz display mode
// for `Settings.TzDisplayDefault`. Mirrors the union type in
// `web/src/lib/timezone.ts`.
func isValidTzDisplayMode(s string) bool {
	switch s {
	case "vehicle", "user", "utc":
		return true
	}
	return false
}

// isValidIANATimezone reports whether s parses as an IANA tz database
// name. Uses Go's tzdata so the validator accepts the same set of zones
// the runtime can resolve. Empty string is treated as invalid here;
// callers should short-circuit before calling.
func isValidIANATimezone(s string) bool {
	if len(s) == 0 || len(s) > 64 {
		return false
	}
	_, err := time.LoadLocation(s)
	return err == nil
}

// applyAIArchiveOnModeFlip enforces the Phase-50 / F2 off-mode transition.
// It clears active features whenever incoming.AIMode is "off" and, on a fresh
// non-off→off transition, stores a true-only clone of the prior feature map.
func applyAIArchiveOnModeFlip(existing, incoming *systemmodel.Settings) {
	if incoming == nil || incoming.AIMode != "off" {
		return
	}
	incoming.AIFeatures = map[string]bool{}
	if existing == nil || existing.AIMode == "off" {
		return
	}
	// Clone only enabled entries so later mutations to existing cannot alias the archive.
	archive := make(map[string]bool, len(existing.AIFeatures))
	for k, v := range existing.AIFeatures {
		if v {
			archive[k] = true
		}
	}
	if len(archive) > 0 {
		incoming.AIFeaturesArchived = archive
	}
}
