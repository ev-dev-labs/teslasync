package share

import (
	"context"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// Session share links: the same token system as drives, targeting a
// charging session. The public payload is a PII-filtered summary (no
// coordinates, no VIN/IDs) plus an optional downsampled charge curve and
// cost when include_telemetry is set. include_map/include_speed are
// drive-only and ignored for sessions.

// shareTypeDrive and shareTypeSession discriminate the public payload so
// one /s/:token route serves both link kinds.
const (
	shareTypeDrive   = "drive"
	shareTypeSession = "charging_session"
)

// maxCurvePoints caps the public charge curve so a long session cannot
// produce a megabyte-sized share payload.
const maxCurvePoints = 240

type publicSessionInfo struct {
	Date          string             `json:"date"`
	DurationS     int64              `json:"duration_s"`
	EnergyAddedWh *float64           `json:"energy_added_wh,omitempty"`
	StartSocPct   *float64           `json:"start_soc_pct,omitempty"`
	EndSocPct     *float64           `json:"end_soc_pct,omitempty"`
	ChargerType   string             `json:"charger_type"`
	Place         string             `json:"place"`
	PeakPowerW    *float64           `json:"peak_power_w,omitempty"`
	AvgPowerW     *float64           `json:"avg_power_w,omitempty"`
	Cost          *float64           `json:"cost,omitempty"`
	CostCurrency  string             `json:"cost_currency,omitempty"`
	Curve         []publicCurvePoint `json:"curve,omitempty"`
}

type publicCurvePoint struct {
	OffsetS    int64    `json:"t_s"`
	PowerKW    *float64 `json:"power_kw,omitempty"`
	BatteryPct *float64 `json:"battery_pct,omitempty"`
	EnergyKWh  *float64 `json:"energy_kwh,omitempty"`
}

// sessionByIDFetcher fetches a single charging session.
type sessionByIDFetcher interface {
	GetByID(ctx context.Context, id int64) (*chargingmodel.ChargingSession, error)
}

// chargeCurveLister returns downsampled charge-curve points over a
// session window. *SignalCurveLister satisfies it.
type chargeCurveLister interface {
	SessionCurve(ctx context.Context, vehicleID int64, from, to time.Time) ([]publicCurvePoint, error)
}

// shareCurveFieldMappings projects the signal_log change feed into the
// public curve. AC/DC pairs merge downstream (DC wins when positive),
// mirroring the authenticated telemetry endpoint.
var shareCurveFieldMappings = []signal.FieldMapping{
	{Signal: "BatteryLevel", Field: "battery_level"},
	{Signal: "ACChargingPower", Field: "power_kw"},
	{Signal: "DCChargingPower", Field: "dc_power_w"},
	{Signal: "ACChargingEnergyIn", Field: "energy_added"},
	{Signal: "DCChargingEnergyIn", Field: "dc_energy_wh"},
}

// SignalCurveLister builds public charge curves from the signal change
// feed. Stateless; safe for concurrent use.
type SignalCurveLister struct {
	state signal.StateReader
}

// NewSignalCurveLister wires the lister. A nil reader is a wiring bug.
func NewSignalCurveLister(state signal.StateReader) *SignalCurveLister {
	if state == nil {
		panic("share.NewSignalCurveLister: state must not be nil")
	}
	return &SignalCurveLister{state: state}
}

var _ chargeCurveLister = (*SignalCurveLister)(nil)

// SessionCurve returns the downsampled public curve for a session window.
// Canonical feed units are W/Wh; the wire contract is kW/kWh, converted
// strictly at this boundary.
func (l *SignalCurveLister) SessionCurve(ctx context.Context, vehicleID int64, from, to time.Time) ([]publicCurvePoint, error) {
	rows, err := l.state.Timeline(ctx, vehicleID, shareCurveFieldMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		return nil, err
	}
	pts := make([]publicCurvePoint, 0, len(rows))
	for _, row := range rows {
		pt := publicCurvePoint{OffsetS: int64(row.Timestamp.Sub(from).Seconds())}
		if v, ok := mergedPowerKW(row); ok {
			v := v
			pt.PowerKW = &v
		}
		if v, ok := signal.Float64(row.Fields["battery_level"]); ok {
			v := v
			pt.BatteryPct = &v
		}
		if v, ok := mergedEnergyKWh(row); ok {
			v := v
			pt.EnergyKWh = &v
		}
		pts = append(pts, pt)
	}
	return downsampleCurve(pts, maxCurvePoints), nil
}

// mergedPowerKW prefers DC power when positive, else AC. Both feed
// values are watts; the result is kilowatts.
func mergedPowerKW(row signal.TimelineRow) (float64, bool) {
	if v, ok := signal.Float64(row.Fields["dc_power_w"]); ok && v > 0 {
		return v / 1000.0, true
	}
	if v, ok := signal.Float64(row.Fields["power_kw"]); ok {
		return v / 1000.0, true
	}
	return 0, false
}

// mergedEnergyKWh prefers DC energy when positive, else AC. Both feed
// values are watt-hours; the result is kilowatt-hours.
func mergedEnergyKWh(row signal.TimelineRow) (float64, bool) {
	if v, ok := signal.Float64(row.Fields["dc_energy_wh"]); ok && v > 0 {
		return v / 1000.0, true
	}
	if v, ok := signal.Float64(row.Fields["energy_added"]); ok {
		return v / 1000.0, true
	}
	return 0, false
}

// downsampleCurve thins pts to at most max points by even stride, always
// keeping the first and last points so the curve endpoints stay exact.
// Pure: no I/O.
func downsampleCurve(pts []publicCurvePoint, max int) []publicCurvePoint {
	if max < 2 {
		max = 2
	}
	if len(pts) <= max {
		return pts
	}
	out := make([]publicCurvePoint, 0, max)
	stride := float64(len(pts)-1) / float64(max-1)
	for i := 0; i < max; i++ {
		out = append(out, pts[int(float64(i)*stride+0.5)])
	}
	return out
}

// sessionDurationS returns the session length in seconds, clamping
// negative clock skew to zero and open sessions to now.
func sessionDurationS(s *chargingmodel.ChargingSession, now time.Time) int64 {
	end := now
	if s.EndedAt != nil {
		end = *s.EndedAt
	}
	d := int64(end.Sub(s.StartedAt).Seconds())
	if d < 0 {
		return 0
	}
	return d
}

func logSessionCurveErr(err error, sessionID int64) {
	log.Warn().Err(err).Int64("sessionID", sessionID).Msg("share: session curve unavailable, serving summary")
}

// serveSessionShare renders the public view of a session-target share.
// The summary always serves; the curve + cost require include_telemetry,
// and a curve failure degrades to the summary rather than failing the
// whole share (telemetry retention may have expired it).
func (h *ShareHandler) serveSessionShare(w http.ResponseWriter, r *http.Request, share *drivemodel.ShareToken) {
	ctx := r.Context()

	session, err := h.sessionRepo.GetByID(ctx, share.ChargingSessionID)
	if err != nil || session == nil {
		log.Error().Err(err).Int64("sessionID", share.ChargingSessionID).Msg("share: session not found")
		httpx.WriteError(w, http.StatusNotFound, "shared session no longer exists")
		return
	}

	now := time.Now().UTC()
	info := publicSessionInfo{
		Date:          session.StartedAt.Format("2006-01-02"),
		DurationS:     sessionDurationS(session, now),
		EnergyAddedWh: session.TotalEnergyAddedWh,
		StartSocPct:   session.StartSocPct,
		EndSocPct:     session.EndSocPct,
		ChargerType:   safeDeref(session.ChargerType, ""),
		Place:         safeDeref(session.StartPlace, ""),
		PeakPowerW:    session.PeakPowerW,
		AvgPowerW:     session.AvgPowerW,
	}

	if share.IncludeTelemetry {
		info.Cost = session.CostDecimal
		info.CostCurrency = safeDeref(session.CostCurrency, "")
		endTs := now
		if session.EndedAt != nil {
			endTs = *session.EndedAt
		}
		curve, err := h.curveLister.SessionCurve(ctx, session.VehicleID, session.StartedAt, endTs)
		if err != nil {
			logSessionCurveErr(err, session.ID)
		} else {
			info.Curve = curve
		}
	}

	resp := publicShareResponse{
		PayloadVersion: "v2",
		ShareType:      shareTypeSession,
		Title:          safeDeref(share.Title, "Shared Charging Session"),
		Description:    safeDeref(share.Description, ""),
		Session:        &info,
	}

	// Vehicle info is limited to model and color: no VIN or IDs.
	vehicle, err := h.vehicleRepo.GetByID(ctx, session.VehicleID)
	if err == nil && vehicle != nil {
		resp.Vehicle = &publicVehicle{
			Model: safeDeref(vehicle.Model, ""),
			Color: safeDeref(vehicle.Color, ""),
		}
	}

	w.Header().Set("Cache-Control", "public, max-age=300")
	httpx.WriteJSON(w, http.StatusOK, resp)
}
