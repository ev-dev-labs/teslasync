package stormguard

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
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// stormCommandTimeout caps the Tesla set_charge_limit call issued when
// the guard acts (project rule — Tesla API: 30s).
const stormCommandTimeout = 30 * time.Second

// ConfigStore is the config/event port. *Store satisfies it.
type ConfigStore interface {
	GetConfig(ctx context.Context, vehicleID int64) (*Config, error)
	UpsertConfig(ctx context.Context, c *Config) error
	ArmedConfigs(ctx context.Context) ([]*Config, error)
	LogEvent(ctx context.Context, e *Event) error
	LastEventLevel(ctx context.Context, vehicleID int64) (string, error)
	ListEvents(ctx context.Context, vehicleID int64, limit int) ([]*Event, error)
}

// Forecaster fetches severe-weather forecasts. *Client satisfies it.
type Forecaster interface {
	Fetch(ctx context.Context, lat, lng float64) (*Forecast, error)
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

// Handler serves storm-guard config/status/events and runs the hourly
// evaluator. Stateless beyond constructor inputs; safe for concurrent use.
type Handler struct {
	store    ConfigStore
	meteo    Forecaster
	tesla    Commander
	state    signal.StateReader
	vehicles vehicleByIDFetcher
	now      func() time.Time
}

// NewHandler wires the handler. Panics on nil inputs (fail-fast wiring
// contract, matching sibling handlers).
func NewHandler(store ConfigStore, meteo Forecaster, tesla Commander, state signal.StateReader, vehicles vehicleByIDFetcher) *Handler {
	if store == nil || meteo == nil || tesla == nil || state == nil || vehicles == nil {
		panic("stormguard: nil dependency")
	}
	return &Handler{store: store, meteo: meteo, tesla: tesla, state: state, vehicles: vehicles, now: time.Now}
}

type statusResponse struct {
	Config     *Config    `json:"config"`
	Assessment Assessment `json:"assessment"`
	CurrentSOC *int       `json:"current_soc,omitempty"`
}

// Status serves GET /stormguard/status?vehicle_id=: live assessment for
// the stored home coordinates plus current battery state. Read-only — it
// never acts; only the evaluator acts.
func (h *Handler) Status(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := vehicleIDParam(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx := r.Context()
	cfg, err := h.store.GetConfig(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("stormguard: config read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read storm-guard config")
		return
	}
	f, err := h.meteo.Fetch(ctx, cfg.Lat, cfg.Lng)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("stormguard: forecast fetch failed")
		httpx.WriteError(w, http.StatusBadGateway, "weather forecast unavailable")
		return
	}
	resp := statusResponse{Config: cfg, Assessment: Assess(f, h.now().UTC())}
	if v, err := h.state.SignalAt(ctx, vehicleID, "BatteryLevel", h.now()); err == nil && v != nil {
		if f, ok := signal.Float64(v); ok && f > 0 {
			soc := int(f)
			resp.CurrentSOC = &soc
		}
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

type configRequest struct {
	VehicleID int64   `json:"vehicle_id"`
	Enabled   bool    `json:"enabled"`
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
	TargetSOC int     `json:"target_soc"`
}

// UpsertConfig serves PUT /stormguard/config: arm/disarm + home coords +
// pre-storm charge target.
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
	if req.Lat < -90 || req.Lat > 90 || req.Lng < -180 || req.Lng > 180 {
		httpx.WriteError(w, http.StatusBadRequest, "lat/lng out of range")
		return
	}
	if req.TargetSOC < 50 || req.TargetSOC > 100 {
		httpx.WriteError(w, http.StatusBadRequest, "target_soc must be 50..100")
		return
	}
	cfg := &Config{VehicleID: req.VehicleID, Enabled: req.Enabled, Lat: req.Lat, Lng: req.Lng, TargetSOC: req.TargetSOC}
	if err := h.store.UpsertConfig(r.Context(), cfg); err != nil {
		log.Error().Err(err).Int64("vehicle_id", req.VehicleID).Msg("stormguard: config write failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save storm-guard config")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, cfg)
}

// Events serves GET /stormguard/events?vehicle_id=&limit=.
func (h *Handler) Events(w http.ResponseWriter, r *http.Request) {
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
	events, err := h.store.ListEvents(r.Context(), vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("stormguard: events read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read storm-guard events")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, events)
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

// DefaultEvaluateInterval is the hourly guard cadence.
const DefaultEvaluateInterval = time.Hour

// Run starts the periodic evaluation loop until ctx ends: an immediate
// first pass, then one per interval. Per-pass failures are logged
// inside EvaluateArmed and never kill the loop.
func (h *Handler) Run(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = DefaultEvaluateInterval
	}
	h.EvaluateArmed(ctx)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.EvaluateArmed(ctx)
		}
	}
}

// EvaluateArmed runs one guard pass over every armed vehicle: assess,
// log on level transitions, and — on a fresh warning with the battery
// below target — raise the charge limit via the Tesla API. Per-vehicle
// failures are logged and skipped so one bad forecast never blocks the
// fleet. Called hourly from the app ticker.
func (h *Handler) EvaluateArmed(ctx context.Context) {
	cfgs, err := h.store.ArmedConfigs(ctx)
	if err != nil {
		log.Error().Err(err).Msg("stormguard: armed list failed")
		return
	}
	for _, cfg := range cfgs {
		if err := h.evaluateOne(ctx, cfg); err != nil {
			log.Error().Err(err).Int64("vehicle_id", cfg.VehicleID).Msg("stormguard: evaluation failed")
		}
	}
}

func (h *Handler) evaluateOne(ctx context.Context, cfg *Config) error {
	f, err := h.meteo.Fetch(ctx, cfg.Lat, cfg.Lng)
	if err != nil {
		return err
	}
	a := Assess(f, h.now().UTC())

	last, err := h.store.LastEventLevel(ctx, cfg.VehicleID)
	if err != nil {
		return err
	}
	acted := false
	if a.Level == LevelWarning && last != LevelWarning {
		acted, err = h.precharge(ctx, cfg)
		if err != nil {
			return err
		}
	}
	// Log transitions (including recovery to none) and every action, so
	// the timeline shows what changed without hourly duplicates.
	if a.Level != last || acted {
		return h.store.LogEvent(ctx, &Event{
			VehicleID: cfg.VehicleID, Level: a.Level, Reason: a.Reason, Acted: acted,
		})
	}
	return nil
}

// precharge raises the charge limit to the storm target when the battery
// sits below it. Returns acted=false when already at/above target or the
// battery state is unreadable (never acts blind).
func (h *Handler) precharge(ctx context.Context, cfg *Config) (bool, error) {
	v, err := h.state.SignalAt(ctx, cfg.VehicleID, "BatteryLevel", h.now())
	if err != nil || v == nil {
		log.Warn().Err(err).Int64("vehicle_id", cfg.VehicleID).Msg("stormguard: unreadable SOC, not acting")
		return false, nil
	}
	soc, ok := signal.Float64(v)
	if !ok || soc <= 0 {
		log.Warn().Int64("vehicle_id", cfg.VehicleID).Msg("stormguard: invalid SOC, not acting")
		return false, nil
	}
	if int(soc) >= cfg.TargetSOC {
		return false, nil
	}
	var vehicle *vehiclemodel.Vehicle
	vehicle, err = h.vehicles.GetByID(ctx, cfg.VehicleID)
	if err != nil || vehicle == nil {
		return false, err
	}
	cmdCtx, cancel := context.WithTimeout(ctx, stormCommandTimeout)
	defer cancel()
	if err := h.tesla.SendCommand(cmdCtx, vehicle.VIN, "set_charge_limit", map[string]interface{}{
		"percent": cfg.TargetSOC,
	}); err != nil {
		return false, err
	}
	log.Info().Int64("vehicle_id", cfg.VehicleID).Int("target_soc", cfg.TargetSOC).Msg("stormguard: pre-charge limit set")
	return true, nil
}

// Compile-time port assertions.
var (
	_ ConfigStore        = (*Store)(nil)
	_ Forecaster         = (*Client)(nil)
	_ Commander          = (*tesla.Client)(nil)
	_ vehicleByIDFetcher = (*vehicledb.VehicleRepo)(nil)
)
