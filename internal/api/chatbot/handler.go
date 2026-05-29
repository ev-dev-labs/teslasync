package chatbot

import (
	"context"
	"errors"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/database"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	"github.com/ev-dev-labs/teslasync/internal/service"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// ChatbotHandler handles heuristic chatbot queries against fleet data.
//
// Phase-39 migration: ChatbotHandler now depends on signal.StateReader so
// "where is my car?" / location-style questions read forward-folded values
// from the signal_log change feed instead of querying the snapshot
// `positions` table directly.
//
// A parked Tesla emits Latitude/Longitude exactly once when it parks and
// then NEVER re-emits them until the vehicle moves again — Fleet Telemetry
// only writes a value when both the interval has elapsed AND the value has
// changed. A naive `SELECT lat, lon ... ORDER BY ts DESC LIMIT 1` against
// the snapshot table for a vehicle that has been parked for more than the
// lookback window returns NO row (or a very stale one), so the chatbot
// would tell the user "I don't know where your car is" for a vehicle that
// has been sitting in the driveway all day. signal.StateReader.State
// forward-folds the change feed, so the most recent emission of every
// signal is carried forward to the requested timestamp and a parked
// vehicle always reports its real last-known position. See ADR-002 and
// the layered live-state contract in .github/ARCHITECTURE.md.
type ChatbotHandler struct {
	chat       *dbnotif.ChatRepo
	db         *database.DB
	vehicleSvc *service.VehicleService
	state      signal.StateReader
	live       signal.LiveStateReader
}

func NewChatbotHandler(db *database.DB, vehicleSvc *service.VehicleService, state signal.StateReader, live signal.LiveStateReader) *ChatbotHandler {
	return &ChatbotHandler{
		chat:       dbnotif.NewChatRepo(db),
		db:         db,
		vehicleSvc: vehicleSvc,
		state:      state,
		live:       live,
	}
}

// vehicleLocationLine renders one markdown line summarising the most recent
// known location for vehicleID. The values are read via the layered
// LiveStateReader (L1+L2 with signal_log fallback) so a parked car that
// has not re-emitted Latitude / Longitude in hours still reports its real
// last-known coordinates — the absence of a recent emission must NEVER be
// confused with "no location" (which would cause the chatbot to falsely
// answer "I don't know where your car is" for a vehicle in the driveway).
//
// A non-nil error from the reader is propagated so the orchestrating
// caller can present a single user-facing failure message instead of
// silently skipping the row.
func (h *ChatbotHandler) vehicleLocationLine(ctx context.Context, vehicleID int64, name string) (string, error) {
	if h.live == nil {
		return "", errors.New("chatbot: live state reader not configured")
	}
	snap, err := h.live.LiveState(ctx, vehicleID)
	if err != nil {
		return "", err
	}
	// Phase-42 codec emits LocationLatitude / LocationLongitude
	// (codec/flatten.go); legacy ingest path uses bare names. Try the
	// codec name first and fall back so both paths work during the
	// migration.
	lat, latOk := toFloat64(snap["LocationLatitude"])
	if !latOk {
		lat, latOk = toFloat64(snap["Latitude"])
	}
	lon, lonOk := toFloat64(snap["LocationLongitude"])
	if !lonOk {
		lon, lonOk = toFloat64(snap["Longitude"])
	}
	if !latOk || !lonOk {
		return fmt.Sprintf("- **%s**: Location unknown", name), nil
	}
	return fmt.Sprintf("- **%s**: %.5f, %.5f", name, lat, lon), nil
}

// toFloat64 normalizes a signal.SignalValue (which is `any`) into a float64.
// signal_log payloads can land as float64 (numeric column) or other numeric
// kinds depending on which storage path the value came in on, so the helper
// accepts the common subset. Returns (0, false) for nil / wrong-type values
// so callers can branch to an "unknown" path without panicking.
func toFloat64(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	default:
		return 0, false
	}
}
