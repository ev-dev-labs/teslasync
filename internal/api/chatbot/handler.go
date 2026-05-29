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

// ChatbotHandler answers heuristic fleet questions.
//
// Location questions use StateProvider's folded live state, not raw position
// tables or signal_log scans, preserving the phase-42 live-state contract.
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

// vehicleLocationLine uses folded live state so cold-start or stale reads are
// visible as unknown values instead of silently falling back to raw tables.
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
