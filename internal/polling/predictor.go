package polling

import (
	"context"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

// Predictor learns daily patterns from historical drive and charge sessions
// and predicts upcoming state changes. It queries the existing drives and
// charging_sessions tables — no schema changes required.
type Predictor struct {
	mu           sync.RWMutex
	patterns     map[string]*VehiclePattern // keyed by VIN
	pool         *pgxpool.Pool
	refreshEvery time.Duration
	lastRefresh  time.Time
	lookbackDays int
}

// VehiclePattern holds learned activity patterns for one vehicle.
type VehiclePattern struct {
	DepartureSlots []TimeSlot `json:"departure_slots"`
	ChargingSlots  []TimeSlot `json:"charging_slots"`
}

// TimeSlot represents a recurring time window with a confidence score.
type TimeSlot struct {
	Hour       int     `json:"hour"`        // 0–23
	DayOfWeek  int     `json:"day_of_week"` // 0=Sun … 6=Sat
	Frequency  int     `json:"frequency"`   // occurrences in the lookback window
	Confidence float64 `json:"confidence"`  // 0.0–1.0
}

// NewPredictor creates a predictor that refreshes patterns periodically.
func NewPredictor(pool *pgxpool.Pool) *Predictor {
	return &Predictor{
		patterns:     make(map[string]*VehiclePattern),
		pool:         pool,
		refreshEvery: 6 * time.Hour,
		lookbackDays: 30,
	}
}

// RefreshIfNeeded reloads patterns from the database if enough time has passed.
func (p *Predictor) RefreshIfNeeded(ctx context.Context) {
	p.mu.RLock()
	needsRefresh := time.Since(p.lastRefresh) >= p.refreshEvery
	p.mu.RUnlock()

	if !needsRefresh {
		return
	}

	p.refresh(ctx)
}

func (p *Predictor) refresh(ctx context.Context) {
	p.mu.Lock()
	defer p.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	patterns := make(map[string]*VehiclePattern)

	departureRows, err := p.pool.Query(ctx, `
		SELECT v.vin,
		       EXTRACT(HOUR FROM d.started_at) AS hour,
		       EXTRACT(DOW FROM d.started_at) AS dow,
		       COUNT(*) AS freq
		FROM drives d
		JOIN vehicles v ON d.vehicle_id = v.id
		WHERE d.started_at > NOW() - make_interval(days => $1)
		  AND d.started_at IS NOT NULL
		GROUP BY v.vin, hour, dow
		HAVING COUNT(*) >= 2
		ORDER BY v.vin, freq DESC
	`, p.lookbackDays)
	if err != nil {
		log.Warn().Err(err).Msg("predictor: failed to query departure patterns")
		return
	}
	defer departureRows.Close()

	for departureRows.Next() {
		var vin string
		var hour, dow float64
		var freq int
		if err := departureRows.Scan(&vin, &hour, &dow, &freq); err != nil {
			continue
		}
		if _, ok := patterns[vin]; !ok {
			patterns[vin] = &VehiclePattern{}
		}
		maxPossible := float64(p.lookbackDays) / 7.0 // max occurrences for one day-of-week
		confidence := float64(freq) / maxPossible
		if confidence > 1.0 {
			confidence = 1.0
		}
		patterns[vin].DepartureSlots = append(patterns[vin].DepartureSlots, TimeSlot{
			Hour:       int(hour),
			DayOfWeek:  int(dow),
			Frequency:  freq,
			Confidence: confidence,
		})
	}

	chargeRows, err := p.pool.Query(ctx, `
		SELECT v.vin,
		       EXTRACT(HOUR FROM cs.started_at) AS hour,
		       EXTRACT(DOW FROM cs.started_at) AS dow,
		       COUNT(*) AS freq
		FROM charging_sessions cs
		JOIN vehicles v ON cs.vehicle_id = v.id
		WHERE cs.started_at > NOW() - make_interval(days => $1)
		  AND cs.started_at IS NOT NULL
		GROUP BY v.vin, hour, dow
		HAVING COUNT(*) >= 2
		ORDER BY v.vin, freq DESC
	`, p.lookbackDays)
	if err != nil {
		log.Warn().Err(err).Msg("predictor: failed to query charging patterns")
	} else {
		defer chargeRows.Close()
		for chargeRows.Next() {
			var vin string
			var hour, dow float64
			var freq int
			if err := chargeRows.Scan(&vin, &hour, &dow, &freq); err != nil {
				continue
			}
			if _, ok := patterns[vin]; !ok {
				patterns[vin] = &VehiclePattern{}
			}
			maxPossible := float64(p.lookbackDays) / 7.0
			confidence := float64(freq) / maxPossible
			if confidence > 1.0 {
				confidence = 1.0
			}
			patterns[vin].ChargingSlots = append(patterns[vin].ChargingSlots, TimeSlot{
				Hour:       int(hour),
				DayOfWeek:  int(dow),
				Frequency:  freq,
				Confidence: confidence,
			})
		}
	}

	p.patterns = patterns
	p.lastRefresh = time.Now()

	totalSlots := 0
	for _, pat := range patterns {
		totalSlots += len(pat.DepartureSlots) + len(pat.ChargingSlots)
	}
	log.Info().Int("vehicles", len(patterns)).Int("slots", totalSlots).Msg("predictor: patterns refreshed")
}

// Predict returns the next predicted state change for a vehicle, or nil if
// no prediction can be made with sufficient confidence.
func (p *Predictor) Predict(vin string) *PredictionInfo {
	p.mu.RLock()
	defer p.mu.RUnlock()

	pattern, ok := p.patterns[vin]
	if !ok {
		return nil
	}

	now := time.Now()
	currentHour := now.Hour()
	currentDOW := int(now.Weekday())

	// Find the next upcoming departure
	bestDeparture := p.findNextSlot(pattern.DepartureSlots, currentHour, currentDOW, now)
	bestCharge := p.findNextSlot(pattern.ChargingSlots, currentHour, currentDOW, now)

	// Return whichever is sooner (if any)
	if bestDeparture != nil && bestCharge != nil {
		if bestDeparture.EstimatedIn < bestCharge.EstimatedIn {
			bestDeparture.NextState = enums.StateDriving
			return bestDeparture
		}
		bestCharge.NextState = enums.StateCharging
		return bestCharge
	}
	if bestDeparture != nil {
		bestDeparture.NextState = enums.StateDriving
		return bestDeparture
	}
	if bestCharge != nil {
		bestCharge.NextState = enums.StateCharging
		return bestCharge
	}
	return nil
}

func (p *Predictor) findNextSlot(slots []TimeSlot, currentHour, currentDOW int, now time.Time) *PredictionInfo {
	var best *PredictionInfo

	for _, slot := range slots {
		if slot.Confidence < 0.5 {
			continue
		}

		daysUntil := slot.DayOfWeek - currentDOW
		if daysUntil < 0 {
			daysUntil += 7
		}
		if daysUntil == 0 && slot.Hour <= currentHour {
			daysUntil = 7 // already passed today
		}

		target := time.Date(now.Year(), now.Month(), now.Day()+daysUntil, slot.Hour, 0, 0, 0, now.Location())
		estimatedIn := target.Sub(now)

		if estimatedIn > 24*time.Hour {
			continue
		}

		dayName := time.Weekday(slot.DayOfWeek).String()
		info := &PredictionInfo{
			EstimatedIn: estimatedIn,
			Confidence:  slot.Confidence,
			BasedOn:     dayName + " " + target.Format("3:04 PM") + " pattern",
		}

		if best == nil || estimatedIn < best.EstimatedIn {
			best = info
		}
	}

	return best
}

// GetPatterns returns learned patterns for a vehicle (for the dashboard).
func (p *Predictor) GetPatterns(vin string) *VehiclePattern {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if pat, ok := p.patterns[vin]; ok {
		cp := *pat
		return &cp
	}
	return nil
}

// GetAllPatterns returns all learned patterns (for the dashboard).
func (p *Predictor) GetAllPatterns() map[string]*VehiclePattern {
	p.mu.RLock()
	defer p.mu.RUnlock()
	result := make(map[string]*VehiclePattern, len(p.patterns))
	for vin, pat := range p.patterns {
		cp := *pat
		result[vin] = &cp
	}
	return result
}
