package metrics

import (
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// ── Telemetry-vs-FSM state conflict observability ──────────────────
//
// A "conflict" is a vehicle whose CURRENTLY-VERIFIED telemetry proves an
// operational state (charging / driving) that disagrees with the persisted
// FSM/inventory state. It is the machine-readable form of the bug class where
// the dashboard hero said "Charging" while Fleet Posture said "Unknown".
//
// CARDINALITY CONTRACT (ADR-008 "no unbounded Prometheus labels"):
//   - vehicle_id is NEVER a label. Per-vehicle context lives on the OTel span
//     and in the zerolog transition line.
//   - Both labels are drawn from closed vocabularies and every unrecognised
//     value collapses to "other", so the series count is bounded at
//     len(telemetryStates) * len(fsmStates) regardless of fleet size or
//     future FSM state names.
//
// READ-VOLUME CONTRACT:
//
//	The gauge is IDEMPOTENT and CURRENT: it answers "how many vehicles are in
//	disagreement right now", not "how many times did somebody ask". Every HTTP
//	read re-asserts the same (vehicle → conflict) fact, and re-asserting is a
//	no-op. The transitions counter only moves when a vehicle ENTERS a
//	particular disagreement, so a 30-second dashboard poll over a 100-vehicle
//	fleet contributes exactly zero to it.
var (
	// VehicleStateConflictCurrent is the number of vehicles currently in
	// disagreement, split by the disagreeing pair.
	VehicleStateConflictCurrent = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "vehicle_state_conflict_current",
		Help:      "Vehicles whose verified telemetry-derived operational state currently disagrees with the persisted FSM state, by (telemetry_state, fsm_state). Idempotent: repeated reads of the same disagreement do not inflate it.",
	}, []string{"telemetry_state", "fsm_state"})

	// VehicleStateConflictTransitionsTotal counts distinct conflict EPISODES.
	// Incremented once when a vehicle enters a given disagreement; never
	// incremented by a repeat observation of the same disagreement.
	VehicleStateConflictTransitionsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "vehicle_state_conflict_transitions_total",
		Help:      "Distinct episodes where a vehicle entered a telemetry-vs-FSM state disagreement, by (telemetry_state, fsm_state). Counts episodes, not reads.",
	}, []string{"telemetry_state", "fsm_state"})

	VehicleStateConflictDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "vehicle_state_conflict_duration_seconds",
		Help:      "Duration of resolved telemetry-vs-FSM disagreement episodes, by bounded state pair",
		Buckets:   []float64{5, 15, 30, 60, 120, 300, 900, 1800, 3600},
	}, []string{"telemetry_state", "fsm_state"})
)

// stateConflictKey is the bounded label pair a conflict maps onto.
type stateConflictKey struct {
	Telemetry string
	FSM       string
}

// knownConflictStates is the closed label vocabulary. Anything outside it is
// reported as "other" so a new FSM state name can never explode the series
// count before somebody has thought about it.
var knownConflictStates = map[string]bool{
	"charging": true,
	"driving":  true,
	"parked":   true,
	"asleep":   true,
	"online":   true,
	"offline":  true,
	"updating": true,
}

// conflictStateLabel folds an arbitrary state string into the closed
// vocabulary. Empty and unrecognised values become "other".
func conflictStateLabel(state string) string {
	if knownConflictStates[state] {
		return state
	}
	return "other"
}

var (
	stateConflictMu        sync.Mutex
	stateConflictByVehicle = map[int64]stateConflictEpisode{}
	stateConflictCounts    = map[stateConflictKey]int{}
)

type stateConflictEpisode struct {
	Key       stateConflictKey
	StartedAt time.Time
}

// RecordVehicleStateConflict marks vehicleID as being in the given
// disagreement and returns true only when that is a CHANGE (the vehicle was
// previously in agreement, or in a different disagreement).
//
// Callers use the return value to log once per episode instead of once per
// HTTP read.
func RecordVehicleStateConflict(vehicleID int64, telemetryState, fsmState string) bool {
	key := stateConflictKey{
		Telemetry: conflictStateLabel(telemetryState),
		FSM:       conflictStateLabel(fsmState),
	}

	stateConflictMu.Lock()
	previous, had := stateConflictByVehicle[vehicleID]
	if had && previous.Key == key {
		stateConflictMu.Unlock()
		return false
	}
	if had {
		decrementConflictLocked(previous.Key)
		VehicleStateConflictCurrent.WithLabelValues(previous.Key.Telemetry, previous.Key.FSM).
			Set(float64(stateConflictCounts[previous.Key]))
		observeConflictDuration(previous, time.Now())
	}
	stateConflictByVehicle[vehicleID] = stateConflictEpisode{
		Key:       key,
		StartedAt: time.Now(),
	}
	stateConflictCounts[key]++
	current := stateConflictCounts[key]
	VehicleStateConflictCurrent.WithLabelValues(key.Telemetry, key.FSM).Set(float64(current))
	VehicleStateConflictTransitionsTotal.WithLabelValues(key.Telemetry, key.FSM).Inc()
	stateConflictMu.Unlock()
	return true
}

// ClearVehicleStateConflict records that vehicleID is no longer in
// disagreement. Returns true only when it previously was, so a converged
// fleet does not emit a "resolved" line on every poll.
func ClearVehicleStateConflict(vehicleID int64) bool {
	stateConflictMu.Lock()
	previous, had := stateConflictByVehicle[vehicleID]
	if !had {
		stateConflictMu.Unlock()
		return false
	}
	delete(stateConflictByVehicle, vehicleID)
	decrementConflictLocked(previous.Key)
	current := stateConflictCounts[previous.Key]
	VehicleStateConflictCurrent.WithLabelValues(previous.Key.Telemetry, previous.Key.FSM).Set(float64(current))
	observeConflictDuration(previous, time.Now())
	stateConflictMu.Unlock()
	return true
}

func observeConflictDuration(episode stateConflictEpisode, endedAt time.Time) {
	duration := endedAt.Sub(episode.StartedAt).Seconds()
	if duration < 0 {
		duration = 0
	}
	VehicleStateConflictDuration.
		WithLabelValues(episode.Key.Telemetry, episode.Key.FSM).
		Observe(duration)
}

// decrementConflictLocked drops one vehicle from a bucket. Caller holds the
// mutex. The bucket key is retained at zero rather than deleted so the gauge
// keeps reporting an explicit 0 instead of the series vanishing (a vanished
// series reads as "no data", which alerting cannot distinguish from "no
// scrape").
func decrementConflictLocked(key stateConflictKey) {
	if stateConflictCounts[key] > 0 {
		stateConflictCounts[key]--
	}
}

// VehicleStateConflictSnapshot returns the current per-pair conflict counts.
// Exported for tests and diagnostics; the Prometheus gauge is the production
// read path.
func VehicleStateConflictSnapshot() map[string]int {
	stateConflictMu.Lock()
	defer stateConflictMu.Unlock()
	out := make(map[string]int, len(stateConflictCounts))
	for key, count := range stateConflictCounts {
		out[key.Telemetry+"->"+key.FSM] = count
	}
	return out
}

// ResetVehicleStateConflictsForTests clears the in-process registry so suites
// do not leak conflict state into each other.
func ResetVehicleStateConflictsForTests() {
	stateConflictMu.Lock()
	defer stateConflictMu.Unlock()
	for key := range stateConflictCounts {
		VehicleStateConflictCurrent.WithLabelValues(key.Telemetry, key.FSM).Set(0)
	}
	stateConflictByVehicle = map[int64]stateConflictEpisode{}
	stateConflictCounts = map[stateConflictKey]int{}
}
