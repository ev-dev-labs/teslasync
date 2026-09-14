package journey

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/api/stormguard"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// Departure window bounds: advice covers at most 48h out, hourly.
const (
	defaultDepartureHorizon = 12 * time.Hour
	maxDepartureHorizon     = 48 * time.Hour
)

// Slot is one scored departure hour.
type Slot struct {
	DepartAt time.Time `json:"depart_at"`
	Level    string    `json:"level"`
	Score    float64   `json:"score"`
}

// ChargeContext is the live charge state at advice time. Nil fields mean
// the vehicle has never reported that signal (asleep or stale) — the
// advice degrades to weather-only rather than guessing.
type ChargeContext struct {
	SocPct   *float64 `json:"soc_pct"`
	LimitPct *float64 `json:"limit_pct"`
}

// DepartureAdvice is the ranked-slot response.
type DepartureAdvice struct {
	SessionID     int64          `json:"session_id"`
	Slots         []Slot         `json:"slots"`
	RecommendedAt *time.Time     `json:"recommended_at"`
	Charge        *ChargeContext `json:"charge"`
	Evidence      []string       `json:"evidence"`
}

// RankDepartureSlots grades each hourly slot in [from, to] against the
// forecast: 100 for calm, 50 for watch, 0 for warning. Only slots
// covered by a forecast hour are emitted, so advice never outruns data.
// The recommendation is the earliest calm slot, else the earliest
// watch, else nil. Pure: no I/O, deterministic.
func RankDepartureSlots(f *stormguard.Forecast, from, to time.Time) ([]Slot, *time.Time) {
	out := []Slot{}
	if f == nil {
		return out, nil
	}
	type hour struct {
		code int
		gust float64
	}
	byHour := map[int64]hour{}
	for i := range f.Times {
		if i >= len(f.Weather) || i >= len(f.WindGustMS) {
			break
		}
		byHour[f.Times[i].Unix()/3600] = hour{f.Weather[i], f.WindGustMS[i]}
	}
	start := from.Truncate(time.Hour)
	if start.Before(from) {
		start = start.Add(time.Hour)
	}
	for t := start; !t.After(to); t = t.Add(time.Hour) {
		h, ok := byHour[t.Unix()/3600]
		if !ok {
			continue
		}
		level := stormguard.HourLevel(h.code, h.gust)
		out = append(out, Slot{DepartAt: t, Level: level, Score: slotScore(level)})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].DepartAt.Before(out[j].DepartAt)
	})
	if len(out) == 0 {
		return out, nil
	}
	if out[0].Score == 0 {
		return out, nil // every covered slot warns
	}
	best := out[0].DepartAt
	return out, &best
}

func slotScore(level string) float64 {
	switch level {
	case stormguard.LevelNone:
		return 100
	case stormguard.LevelWatch:
		return 50
	default:
		return 0
	}
}

// Meteo is the forecast port. *stormguard.Client satisfies it.
type Meteo interface {
	Fetch(ctx context.Context, lat, lng float64) (*stormguard.Forecast, error)
}

// LiveSignals is the minimal live-state port: the live-preferring
// reader, so pre-trip checks see fresh telemetry with signal_log
// backfill. signal.LiveStateReader satisfies it.
type LiveSignals interface {
	LiveSignal(ctx context.Context, vehicleID int64, name string) (signal.SignalValue, error)
}

// DepartureHandler serves the departure advisor. Stateless beyond
// constructor inputs; safe for concurrent use.
type DepartureHandler struct {
	store SessionStore
	meteo Meteo
	live  LiveSignals
	now   func() time.Time
}

// NewDepartureHandler wires the handler. Panics on nil inputs
// (fail-fast wiring contract, matching sibling handlers).
func NewDepartureHandler(store SessionStore, meteo Meteo, live LiveSignals) *DepartureHandler {
	if store == nil || meteo == nil || live == nil {
		panic("journey: nil dependency")
	}
	return &DepartureHandler{store: store, meteo: meteo, live: live, now: time.Now}
}

// Advise serves GET /journey/sessions/{id}/departure?from=&to=: ranked
// departure slots with a recommendation. from/to are RFC3339; default
// now → +12h; the window clamps to 48h.
func (h *DepartureHandler) Advise(w http.ResponseWriter, r *http.Request) {
	id, err := sessionIDParam(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	now := h.now().UTC()
	from, to := now, now.Add(defaultDepartureHorizon)
	if s := r.URL.Query().Get("from"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "from must be RFC3339")
			return
		}
		from = t
	}
	if s := r.URL.Query().Get("to"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "to must be RFC3339")
			return
		}
		to = t
	}
	if from.Before(now.Add(-time.Hour)) {
		from = now
	}
	if to.After(from.Add(maxDepartureHorizon)) {
		to = from.Add(maxDepartureHorizon)
	}
	if !to.After(from) {
		httpx.WriteError(w, http.StatusBadRequest, "to must be after from")
		return
	}
	ctx := r.Context()
	session, err := h.store.Get(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: get failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read journey")
		return
	}
	if session == nil {
		httpx.WriteError(w, http.StatusNotFound, "journey not found")
		return
	}
	if session.OriginLat == nil || session.OriginLng == nil {
		httpx.WriteError(w, http.StatusBadRequest, "journey needs origin coordinates for departure advice")
		return
	}
	forecast, err := h.meteo.Fetch(ctx, *session.OriginLat, *session.OriginLng)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: forecast fetch failed")
		httpx.WriteError(w, http.StatusBadGateway, "weather forecast unavailable")
		return
	}
	slots, recommended := RankDepartureSlots(forecast, from, to)
	charge, err := h.chargeContext(ctx, session.VehicleID)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: live state failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read vehicle state")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, DepartureAdvice{
		SessionID:     id,
		Slots:         slots,
		RecommendedAt: recommended,
		Charge:        charge,
		Evidence:      departureEvidence(slots, recommended, charge),
	})
}

func (h *DepartureHandler) chargeContext(ctx context.Context, vehicleID int64) (*ChargeContext, error) {
	soc, err := signalFloat(h.live, ctx, vehicleID, "Soc")
	if err != nil {
		return nil, err
	}
	limit, err := signalFloat(h.live, ctx, vehicleID, "ChargeLimitSoc")
	if err != nil {
		return nil, err
	}
	return &ChargeContext{SocPct: soc, LimitPct: limit}, nil
}

// signalFloat reads one float signal. (nil, nil) when never observed
// in either layer; errors only on transport/query failure.
func signalFloat(live LiveSignals, ctx context.Context, vehicleID int64, name string) (*float64, error) {
	v, err := live.LiveSignal(ctx, vehicleID, name)
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, nil
	}
	f, ok := signal.Float64(v)
	if !ok {
		return nil, nil
	}
	return &f, nil
}

func departureEvidence(slots []Slot, recommended *time.Time, charge *ChargeContext) []string {
	out := []string{}
	warn, watch := 0, 0
	for _, s := range slots {
		switch s.Level {
		case stormguard.LevelWarning:
			warn++
		case stormguard.LevelWatch:
			watch++
		}
	}
	out = append(out, fmt.Sprintf("%d slots scored, %d warning, %d watch", len(slots), warn, watch))
	if recommended != nil {
		out = append(out, "earliest calm slot "+recommended.Format("Mon 15:04"))
	} else if len(slots) > 0 {
		out = append(out, "every covered slot warns — delay or ride it out")
	} else {
		out = append(out, "forecast covers none of the window")
	}
	if charge != nil && charge.SocPct != nil {
		out = append(out, fmt.Sprintf("battery at %.0f%% now", *charge.SocPct))
	} else {
		out = append(out, "vehicle state stale — weather-only advice")
	}
	return out
}
