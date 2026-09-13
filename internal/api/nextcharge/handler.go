package nextcharge

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/chargeautopilot"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Handler serves GET /charge-autopilot/decision.
type Handler struct {
	profiles chargeautopilot.ProfileStore
	vins     VINFinder
	quotes   QuoteFinder
	now      func() time.Time
}

// NewHandler wires profile + optional VIN/invoice finders. Panics on a nil
// profile store (fail-fast wiring). A nil database degrades Supercharger
// quotes without failing the home TOU verdict.
func NewHandler(profiles chargeautopilot.ProfileStore, db *database.DB) *Handler {
	if profiles == nil {
		panic("nextcharge: nil profile store")
	}
	vins, quotes := newFinders(db)
	return &Handler{profiles: profiles, vins: vins, quotes: quotes, now: time.Now}
}

// Get serves GET /charge-autopilot/decision?vehicle_id=&current_soc=.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := parsePositiveInt(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}
	soc, err := parseSOC(r.URL.Query().Get("current_soc"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "current_soc must be 0..100")
		return
	}
	p, err := h.profiles.Get(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("nextcharge: profile read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read autopilot profile")
		return
	}

	var quote *Quote
	if h.vins != nil && h.quotes != nil {
		vin, vinErr := h.vins.VIN(r.Context(), vehicleID)
		if vinErr != nil {
			log.Warn().Err(vinErr).Int64("vehicle_id", vehicleID).Msg("nextcharge: vin lookup failed")
		} else if vin != "" {
			q, qErr := h.quotes.Cheapest(r.Context(), vin)
			if qErr != nil {
				log.Warn().Err(qErr).Int64("vehicle_id", vehicleID).Msg("nextcharge: supercharger quote failed")
			} else {
				quote = q
			}
		}
	}

	httpx.WriteJSON(w, http.StatusOK, Decide(Input{
		Profile:    *p,
		CurrentSOC: soc,
		Now:        h.now(),
		Quote:      quote,
	}))
}

func parsePositiveInt(s string) (int64, error) {
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil || id <= 0 {
		return 0, errMissing
	}
	return id, nil
}

func parseSOC(s string) (int, error) {
	n, err := strconv.Atoi(s)
	if err != nil || n < 0 || n > 100 {
		return 0, errMissing
	}
	return n, nil
}

type missingErr string

func (e missingErr) Error() string { return string(e) }

const errMissing = missingErr("missing")
