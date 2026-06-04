package adminmaintenance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/config"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
)

// Authenticated operators can update the service-mode banner; the audit row is
// the accountability surface until a future RBAC layer exists. Env system-mode
// settings shadow the DB row in effective health/status responses, so admin
// responses include source metadata when a DB write is currently overridden.

const (
	adminMaintenanceBodyLimit = 8 * 1024
)

// SystemStateStore is the narrow interface the handler depends on.
// Implemented by *systemdb.SystemStateRepo in production; mocked in
// admin_maintenance_handler_test.go so the unit tests don't require a
// live database.
type SystemStateStore interface {
	Get(ctx context.Context) (systemdb.SystemState, error)
	Set(ctx context.Context, mode, message string, until *time.Time, updatedBy string) (systemdb.SystemState, error)
}

// AdminMaintenanceHandler serves the POST/GET admin endpoints that
// read and write the system_state row. It does NOT call ExtendedHealth's
// resolver — admin reads/writes always reflect the persisted DB state
// so an operator can see "what's in the table" even while an env
// override is shadowing it on /system/health.
type AdminMaintenanceHandler struct {
	store   SystemStateStore
	authHdr string
	envMode string // captured at construction so the resolver and admin agree on env winner
	audit   AuditFunc
}

// AuditFunc is the audit-logging callback shape expected by AdminMaintenanceHandler.
type AuditFunc func(r *http.Request, headerName, action, resource string, entityID *int64, detail string)

// Option mutates an AdminMaintenanceHandler during construction.
type Option func(*AdminMaintenanceHandler)

// WithAuditFunc installs the audit callback invoked after successful mutations.
func WithAuditFunc(f AuditFunc) Option { return func(h *AdminMaintenanceHandler) { h.audit = f } }

// NewAdminMaintenanceHandler wires the handler against the shared repo.
// cfg is optional; when present its ForwardAuth header attributes audit
// rows and its system-mode env setting lets admin responses surface env overrides.
func NewAdminMaintenanceHandler(store SystemStateStore, cfg *config.Config, opts ...Option) *AdminMaintenanceHandler {
	h := &AdminMaintenanceHandler{store: store}
	if cfg != nil {
		h.authHdr = cfg.Auth.ForwardAuthHeader
		h.envMode = strings.ToLower(strings.TrimSpace(cfg.System.Mode))
	}
	for _, opt := range opts {
		if opt != nil {
			opt(h)
		}
	}
	return h
}

// adminMaintenanceRequest is the POST body shape. All fields optional
// except mode; client may omit until/message to clear them when mode
// is "ok" (the repo itself zeroes both on mode="ok" as a safety net).
type adminMaintenanceRequest struct {
	Mode    string  `json:"mode"`
	Message *string `json:"message,omitempty"`
	Until   *string `json:"until,omitempty"`
}

// adminMaintenanceResponse is the JSON shape of both GET and POST
// responses. snake_case keys match the rest of the API surface.
type adminMaintenanceResponse struct {
	Mode            string  `json:"mode"`
	Message         string  `json:"maintenance_message,omitempty"`
	Until           *string `json:"maintenance_until,omitempty"`
	UpdatedAt       string  `json:"updated_at"`
	UpdatedBy       string  `json:"updated_by,omitempty"`
	Source          string  `json:"source"`
	EnvOverrideMode string  `json:"env_override_mode,omitempty"`
}

// MaintenanceView is the resolved service-mode snapshot returned by the
// system-state provider closure passed into ExtendedHealthCheck. Source
// indicates which input "won" — "env" when the operator set
// TESLASYNC_SYSTEM_MODE, "db" when an admin POSTed to
// /admin/maintenance, "default" when neither is set. The SPA uses
// `source == "env"` to disable the admin-panel write controls.
type MaintenanceView struct {
	Mode      string
	Message   string
	Until     *time.Time
	UpdatedAt time.Time
	Source    string
}

// Get handles GET /admin/maintenance. Returns the current persisted
// row plus a `source` marker that tells the SPA whether the env
// override is currently shadowing the DB value.
func (h *AdminMaintenanceHandler) Get(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "system state unavailable")
		return
	}
	state, err := h.store.Get(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("admin maintenance: failed to read system_state")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read system state")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, h.toResponse(state))
}

// Set handles POST /admin/maintenance. Validates body, writes to the
// repo, audits the change, and returns the updated row. Errors are
// reported with the conventional {error} JSON envelope.
func (h *AdminMaintenanceHandler) Set(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "system state unavailable")
		return
	}
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, adminMaintenanceBodyLimit)

	var req adminMaintenanceRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid payload")
		return
	}

	mode, err := systemdb.ValidateSystemMode(req.Mode)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid mode (expected ok|degraded|maintenance)")
		return
	}

	var message string
	if req.Message != nil {
		message = *req.Message
	}

	var untilTime *time.Time
	if req.Until != nil && strings.TrimSpace(*req.Until) != "" {
		t, parseErr := time.Parse(time.RFC3339, strings.TrimSpace(*req.Until))
		if parseErr != nil {
			httpx.WriteError(w, http.StatusBadRequest, "invalid until (expected RFC3339 timestamp)")
			return
		}
		t = t.UTC()
		untilTime = &t
	}

	// Reject obviously-unusable inputs early so the audit row tells the
	// operator their typo back instead of recording a write nobody can
	// see in the UI.
	if mode != systemdb.SystemModeOK && message == "" && untilTime == nil && (req.Message == nil || strings.TrimSpace(*req.Message) == "") {
		// Allow mode-only "degraded" toggles — the SPA will fall back
		// to the i18n default banner text when message is empty.
		// This branch only fires when *all* descriptive fields are blank;
		// we don't reject — just log so noisy operator UIs surface.
		log.Debug().Str("mode", mode).Msg("admin maintenance: setting non-ok mode without message")
	}

	actor := actorFromRequest(r, h.authHdr)
	state, err := h.store.Set(r.Context(), mode, message, untilTime, actor)
	if err != nil {
		if errors.Is(err, systemdb.ErrInvalidSystemMode) {
			httpx.WriteError(w, http.StatusBadRequest, "invalid mode (expected ok|degraded|maintenance)")
			return
		}
		log.Error().Err(err).Msg("admin maintenance: failed to write system_state")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to write system state")
		return
	}

	if h.audit != nil {
		detail := fmt.Sprintf("mode=%s", state.Mode)
		if state.MaintenanceMessage != "" {
			detail += "; message_len=" + jsonSafeIntStr(len([]rune(state.MaintenanceMessage)))
		}
		if state.MaintenanceUntil != nil {
			detail += "; until=" + state.MaintenanceUntil.UTC().Format(time.RFC3339)
		}
		h.audit(r, h.authHdr, "system.maintenance.set", "system_state", nil, detail)
	}

	httpx.WriteJSON(w, http.StatusOK, h.toResponse(state))
}

// toResponse formats a SystemState into the JSON shape, layering on
// the env-override marker when the env mode is currently winning.
func (h *AdminMaintenanceHandler) toResponse(s systemdb.SystemState) adminMaintenanceResponse {
	var until *string
	if s.MaintenanceUntil != nil {
		t := s.MaintenanceUntil.UTC().Format(time.RFC3339)
		until = &t
	}
	resp := adminMaintenanceResponse{
		Mode:      s.Mode,
		Message:   s.MaintenanceMessage,
		Until:     until,
		UpdatedAt: s.UpdatedAt.UTC().Format(time.RFC3339),
		UpdatedBy: s.UpdatedBy,
		Source:    "db",
	}
	if envWins(h.envMode) {
		resp.Source = "env"
		resp.EnvOverrideMode = h.envMode
	}
	return resp
}

// envWins reports whether a captured env mode is a recognized
// non-default override. Empty / unrecognized values fall back to the
// DB; "ok"/"degraded"/"maintenance" all win including "ok" so an
// operator can force-clear the banner via the env knob.
func envWins(envMode string) bool {
	switch envMode {
	case systemdb.SystemModeOK, systemdb.SystemModeDegraded, systemdb.SystemModeMaintenance:
		return true
	default:
		return false
	}
}

// BuildMaintenanceProvider returns a closure suitable for passing into
// ExtendedHealthCheck. The closure resolves env-vs-DB on every call
// (DB lookup is a single indexed read on a 1-row table — cheap enough
// for the polled /system/health endpoint).
func BuildMaintenanceProvider(store SystemStateStore, cfg *config.Config) func(context.Context) MaintenanceView {
	envMode := ""
	envMsg := ""
	envUntil := ""
	if cfg != nil {
		envMode = strings.ToLower(strings.TrimSpace(cfg.System.Mode))
		envMsg = strings.TrimSpace(cfg.System.MaintenanceMessage)
		envUntil = strings.TrimSpace(cfg.System.MaintenanceUntil)
	}
	envParsedUntil := parseEnvUntil(envUntil)

	return func(ctx context.Context) MaintenanceView {
		if envWins(envMode) {
			view := MaintenanceView{
				Mode:    envMode,
				Message: envMsg,
				Source:  "env",
			}
			if envMode == systemdb.SystemModeOK {
				view.Message = ""
			} else if envParsedUntil != nil {
				v := *envParsedUntil
				view.Until = &v
			}
			return view
		}
		if store == nil {
			return MaintenanceView{Mode: systemdb.SystemModeOK, Source: "default"}
		}
		s, err := store.Get(ctx)
		if err != nil {
			log.Warn().Err(err).Msg("maintenance provider: system_state read failed; returning ok")
			return MaintenanceView{Mode: systemdb.SystemModeOK, Source: "default"}
		}
		view := MaintenanceView{
			Mode:      s.Mode,
			Message:   s.MaintenanceMessage,
			UpdatedAt: s.UpdatedAt,
			Source:    "db",
		}
		if s.MaintenanceUntil != nil {
			v := *s.MaintenanceUntil
			view.Until = &v
		}
		return view
	}
}

// actorFromRequest resolves the user identity for the system_state updated_by field.
func actorFromRequest(r *http.Request, headerName string) string {
	if r == nil || headerName == "" {
		return ""
	}
	return strings.TrimSpace(r.Header.Get(headerName))
}

// parseEnvUntil tolerates a malformed env value by returning nil so
// the banner still renders without a countdown rather than failing the
// whole resolver. The misconfiguration is logged once at startup so an
// operator notices.
func parseEnvUntil(raw string) *time.Time {
	if raw == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		log.Warn().Str("raw", raw).Err(err).Msg("maintenance: TESLASYNC_SYSTEM_MAINTENANCE_UNTIL is not RFC3339; ignoring")
		return nil
	}
	t = t.UTC()
	return &t
}

func jsonSafeIntStr(n int) string {
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	var buf [20]byte
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}
