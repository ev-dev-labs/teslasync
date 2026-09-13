package comfort

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// comfortCommandTimeout caps each Tesla climate call (project rule —
// Tesla API: 30s).
const comfortCommandTimeout = 30 * time.Second

// DefaultEvaluateInterval is the 5-minute event-watch cadence.
const DefaultEvaluateInterval = 5 * time.Minute

// ConfigStore is the config/run port. *Store satisfies it.
type ConfigStore interface {
	GetConfig(ctx context.Context, vehicleID int64) (*Config, error)
	UpsertConfig(ctx context.Context, c *Config) error
	EnabledConfigs(ctx context.Context) ([]*Config, error)
	HasRun(ctx context.Context, vehicleID int64, uid string) (bool, error)
	LogRun(ctx context.Context, r *Run) (bool, error)
	ListRuns(ctx context.Context, vehicleID int64, limit int) ([]*Run, error)
}

// FeedFetcher downloads ICS feeds. *Fetcher satisfies it.
type FeedFetcher interface {
	Fetch(ctx context.Context, feedURL string) ([]Event, error)
}

// Commander issues Tesla vehicle commands. *tesla.Client satisfies it.
type Commander interface {
	SendCommand(ctx context.Context, vin string, command string, params map[string]interface{}) error
}

// vehicleByIDFetcher fetches a single vehicle. *vehicledb.VehicleRepo
// satisfies it.
type vehicleByIDFetcher interface {
	GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
}

// Handler serves comfort config/status/runs and runs the event-watch
// evaluator. Stateless beyond constructor inputs; safe for concurrent use.
type Handler struct {
	store    ConfigStore
	feeds    FeedFetcher
	tesla    Commander
	vehicles vehicleByIDFetcher
	now      func() time.Time
}

// NewHandler wires the handler. Panics on nil inputs (fail-fast wiring
// contract, matching sibling handlers).
func NewHandler(store ConfigStore, feeds FeedFetcher, tesla Commander, vehicles vehicleByIDFetcher) *Handler {
	if store == nil || feeds == nil || tesla == nil || vehicles == nil {
		panic("comfort: nil dependency")
	}
	return &Handler{store: store, feeds: feeds, tesla: tesla, vehicles: vehicles, now: time.Now}
}

type nextResponse struct {
	Config *Config `json:"config"`
	Event  *Event  `json:"event,omitempty"`
}

// Next serves GET /comfort/next?vehicle_id=: the stored config plus the
// next offsite event inside the lead window (null when none). Read-only.
func (h *Handler) Next(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := vehicleIDParam(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx := r.Context()
	cfg, err := h.store.GetConfig(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("comfort: config read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read comfort config")
		return
	}
	resp := nextResponse{Config: cfg}
	if cfg.ICSURL != "" {
		events, err := h.feeds.Fetch(ctx, cfg.ICSURL)
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("comfort: ICS fetch failed")
			httpx.WriteError(w, http.StatusBadGateway, "calendar feed unavailable")
			return
		}
		resp.Event = NextOffsite(events, h.now(), time.Duration(cfg.LeadMinutes)*time.Minute)
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

type configRequest struct {
	VehicleID   int64   `json:"vehicle_id"`
	Enabled     bool    `json:"enabled"`
	TargetTempC float64 `json:"target_temp_c"`
	LeadMinutes int     `json:"lead_minutes"`
	ICSURL      string  `json:"ics_url"`
}

// UpsertConfig serves PUT /comfort/config.
func (h *Handler) UpsertConfig(w http.ResponseWriter, r *http.Request) {
	var req configRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.VehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}
	if req.TargetTempC < 15 || req.TargetTempC > 28 {
		httpx.WriteError(w, http.StatusBadRequest, "target_temp_c must be 15..28")
		return
	}
	if req.LeadMinutes < 5 || req.LeadMinutes > 120 {
		httpx.WriteError(w, http.StatusBadRequest, "lead_minutes must be 5..120")
		return
	}
	if len(req.ICSURL) > 2000 {
		httpx.WriteError(w, http.StatusBadRequest, "ics_url too long")
		return
	}
	if req.ICSURL != "" {
		if err := validateICSURL(req.ICSURL); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	cfg := &Config{VehicleID: req.VehicleID, Enabled: req.Enabled, TargetTempC: req.TargetTempC, LeadMinutes: req.LeadMinutes, ICSURL: req.ICSURL}
	if err := h.store.UpsertConfig(r.Context(), cfg); err != nil {
		log.Error().Err(err).Int64("vehicle_id", req.VehicleID).Msg("comfort: config write failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save comfort config")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, cfg)
}

type nowRequest struct {
	VehicleID int64 `json:"vehicle_id"`
}

// PreconditionNow serves POST /comfort/now: immediate climate start at
// the configured target. Rate-limited at the router.
func (h *Handler) PreconditionNow(w http.ResponseWriter, r *http.Request) {
	var req nowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.VehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}
	ctx := r.Context()
	cfg, err := h.store.GetConfig(ctx, req.VehicleID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read comfort config")
		return
	}
	if err := h.startClimate(ctx, cfg); err != nil {
		log.Error().Err(err).Int64("vehicle_id", req.VehicleID).Msg("comfort: precondition failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to start climate")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{"status": "started", "target_temp_c": cfg.TargetTempC})
}

// Runs serves GET /comfort/runs?vehicle_id=&limit=.
func (h *Handler) Runs(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := vehicleIDParam(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	limit := 20
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			limit = n
		}
	}
	runs, err := h.store.ListRuns(r.Context(), vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("comfort: runs read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read comfort runs")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, runs)
}

func vehicleIDParam(r *http.Request) (int64, error) {
	s := r.URL.Query().Get("vehicle_id")
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil || id <= 0 {
		return 0, errBadVehicleID
	}
	return id, nil
}

type vehicleIDError string

func (e vehicleIDError) Error() string { return string(e) }

const errBadVehicleID = vehicleIDError("vehicle_id must be a positive integer")

// Run starts the periodic evaluation loop until ctx ends. Per-pass
// failures are logged inside EvaluateEnabled and never kill the loop.
func (h *Handler) Run(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = DefaultEvaluateInterval
	}
	h.EvaluateEnabled(ctx)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.EvaluateEnabled(ctx)
		}
	}
}

// EvaluateEnabled runs one event-watch pass over every enabled vehicle:
// fetch the ICS feed, pick the next offsite event in the lead window,
// skip already-acted UIDs, and precondition. Per-vehicle failures are
// logged and skipped.
func (h *Handler) EvaluateEnabled(ctx context.Context) {
	cfgs, err := h.store.EnabledConfigs(ctx)
	if err != nil {
		log.Error().Err(err).Msg("comfort: enabled list failed")
		return
	}
	for _, cfg := range cfgs {
		if err := h.evaluateOne(ctx, cfg); err != nil {
			log.Error().Err(err).Int64("vehicle_id", cfg.VehicleID).Msg("comfort: evaluation failed")
		}
	}
}

func (h *Handler) evaluateOne(ctx context.Context, cfg *Config) error {
	if cfg.ICSURL == "" {
		return nil
	}
	events, err := h.feeds.Fetch(ctx, cfg.ICSURL)
	if err != nil {
		return err
	}
	next := NextOffsite(events, h.now(), time.Duration(cfg.LeadMinutes)*time.Minute)
	if next == nil {
		return nil
	}
	acted, err := h.store.HasRun(ctx, cfg.VehicleID, next.UID)
	if err != nil {
		return err
	}
	if acted {
		return nil
	}
	// Reserve the UID first: concurrent ticks collapse onto the unique
	// constraint instead of double-preconditioning.
	ran, err := h.store.LogRun(ctx, &Run{
		VehicleID: cfg.VehicleID, EventUID: next.UID, EventTitle: next.Title, StartsAt: next.StartsAt,
	})
	if err != nil || !ran {
		return err
	}
	if err := h.startClimate(ctx, cfg); err != nil {
		return err
	}
	log.Info().Int64("vehicle_id", cfg.VehicleID).Str("event", next.Title).Msg("comfort: preconditioned for event")
	return nil
}

// startClimate sets temps then starts climate, each under its own fresh
// deadline so a stuck first call cannot starve the second's budget.
func (h *Handler) startClimate(ctx context.Context, cfg *Config) error {
	vehicle, err := h.vehicles.GetByID(ctx, cfg.VehicleID)
	if err != nil || vehicle == nil {
		return err
	}
	tempsCtx, cancel := context.WithTimeout(ctx, comfortCommandTimeout)
	defer cancel()
	if err := h.tesla.SendCommand(tempsCtx, vehicle.VIN, "set_temps", map[string]interface{}{
		"driver_temp": cfg.TargetTempC, "passenger_temp": cfg.TargetTempC,
	}); err != nil {
		return err
	}
	onCtx, cancel := context.WithTimeout(ctx, comfortCommandTimeout)
	defer cancel()
	return h.tesla.SendCommand(onCtx, vehicle.VIN, "climate_on", nil)
}

// Compile-time port assertions.
var (
	_ ConfigStore        = (*Store)(nil)
	_ FeedFetcher        = (*Fetcher)(nil)
	_ Commander          = (*tesla.Client)(nil)
	_ vehicleByIDFetcher = (*vehicledb.VehicleRepo)(nil)
)
