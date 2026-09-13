package vehicle

import (
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/apperror"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// Silence statuses.
const (
	silenceOK     = "ok"
	silenceQuiet  = "quiet"
	silenceSilent = "silent"
	silenceNever  = "never"
)

const (
	// quietAfter: no telemetry for 6h is noteworthy but often just sleep.
	quietAfter = 6 * time.Hour
	// silentAfter: 24h without telemetry deserves an explicit check.
	silentAfter = 24 * time.Hour
	// silenceLookback bounds the recency scan; a car quieter than this
	// reports last_seen_at: null either way.
	silenceLookback = 72 * time.Hour
	// silenceMaxRows caps the scan — only the latest timestamp is read.
	silenceMaxRows = 100
)

// VehicleSilence is the GET /vehicles/{vehicleID}/silence response.
type VehicleSilence struct {
	VehicleID   int64      `json:"vehicle_id"`
	Status      string     `json:"status"`
	LastSeenAt  *time.Time `json:"last_seen_at"`
	SilentForS  *int64     `json:"silent_for_s"`
	CheckedAt   time.Time  `json:"checked_at"`
	Explanation string     `json:"explanation"`
}

// ClassifySilence is the pure last-seen evaluation. now pins the clock.
func ClassifySilence(vehicleID int64, last *time.Time, now time.Time) VehicleSilence {
	s := VehicleSilence{VehicleID: vehicleID, CheckedAt: now.UTC()}
	if last == nil {
		s.Status = silenceNever
		s.Explanation = "No telemetry in the last 72 hours — the car may be asleep, out of coverage, or unpaired. Try a wake; if it stays dark, check the Tesla app."
		return s
	}
	ago := now.Sub(*last)
	secs := int64(ago.Seconds())
	if secs < 0 {
		secs = 0
	}
	s.LastSeenAt = last
	s.SilentForS = &secs
	switch {
	case ago < quietAfter:
		s.Status = silenceOK
		s.Explanation = fmt.Sprintf("Telemetry is fresh — last seen %s ago.", humanAgo(ago))
	case ago < silentAfter:
		s.Status = silenceQuiet
		s.Explanation = fmt.Sprintf("Quiet for %s — usually just deep sleep. Wake the car if you expected recent activity.", humanAgo(ago))
	default:
		s.Status = silenceSilent
		s.Explanation = fmt.Sprintf("Silent for %s. If the car should be reachable, check Tesla connectivity, then wake it; a 12V failure also presents as prolonged silence.", humanAgo(ago))
	}
	return s
}

func humanAgo(d time.Duration) string {
	if d < time.Hour {
		m := int(d.Minutes())
		if m < 1 {
			return "under a minute"
		}
		return fmt.Sprintf("%dm", m)
	}
	h := int(d.Hours())
	if h < 48 {
		return fmt.Sprintf("%dh", h)
	}
	return fmt.Sprintf("%dd", h/24)
}

// Silence serves GET /vehicles/{vehicleID}/silence. It scans the most
// recent telemetry across heartbeat signals and classifies recency.
func (h *Handler) Silence(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}
	now := time.Now().UTC()
	rows, err := h.state.Timeline(r.Context(), id, silenceFields(),
		now.Add(-silenceLookback), now.Add(time.Nanosecond),
		signal.TimelineOptions{MaxRows: silenceMaxRows})
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to load telemetry recency")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to load telemetry recency"))
		return
	}
	var last *time.Time
	for i := range rows {
		t := rows[i].Timestamp.UTC()
		if last == nil || t.After(*last) {
			last = &t
		}
	}
	httpx.WriteJSON(w, http.StatusOK, ClassifySilence(id, last, now))
}

func silenceFields() []signal.FieldMapping {
	return []signal.FieldMapping{
		{Signal: "BatteryLevel", Field: "battery_level"},
		{Signal: "Location", Field: "location"},
		{Signal: "Odometer", Field: "odometer"},
		{Signal: "Gear", Field: "gear"},
	}
}
