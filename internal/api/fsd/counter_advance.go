package fsd

import (
	"time"

	signalcounter "github.com/ev-dev-labs/teslasync/internal/signal/counter"
)

// maxAttributableSpeedMps is faster than any Tesla can travel. An advance
// larger than this over the observation interval is a counter discontinuity
// (include_fields zero, unit mix, trip-meter restore), not distance driven.
const maxAttributableSpeedMps = 120.0

// minAdvanceInterval floors the speed check so a 0.01 mile tick on a
// sub-second change-feed row remains attributable.
const minAdvanceInterval = time.Second

// tripMeterCursor remembers the pre-drop reading of a resettable trip meter
// so a later return to that magnitude can be treated as a telemetry glitch
// instead of thousands of kilometres of driving.
type tripMeterCursor struct {
	preReset *float64
	resetDay string
}

func (c *tripMeterCursor) clear() {
	*c = tripMeterCursor{}
}

func (c *tripMeterCursor) noteReset(pre float64, day string) {
	if c.preReset != nil {
		return
	}
	v := pre
	c.preReset = &v
	c.resetDay = day
}

// tripMeterStep is the reset-safe classification of one consecutive pair.
type tripMeterStep struct {
	Delta        float64
	Reset        bool
	Restored     bool
	Implausible  bool
	UndoResetDay string
}

func stepTripMeter(prev, current float64, dt time.Duration, day string, cur *tripMeterCursor) tripMeterStep {
	if cur == nil {
		cur = &tripMeterCursor{}
	}
	change := signalcounter.Compare(prev, current)
	switch change.Kind {
	case signalcounter.ChangeReset:
		cur.noteReset(prev, day)
		return tripMeterStep{Reset: true}
	case signalcounter.ChangeAdvanced:
		if cur.preReset != nil {
			if restored, ok := restoreDelta(*cur.preReset, current); ok {
				undo := cur.resetDay
				cur.clear()
				return tripMeterStep{Delta: restored, Restored: true, UndoResetDay: undo}
			}
		}
		if !plausibleCounterAdvance(change.Delta, dt) {
			cur.clear()
			return tripMeterStep{Implausible: true}
		}
		cur.clear()
		return tripMeterStep{Delta: change.Delta}
	default:
		return tripMeterStep{}
	}
}

// restoreDelta reports the distance to keep when a trip meter dropped and
// then returned to (or passed) its pre-drop reading. Only the excess past
// that reading is travel; the snap back from 0 is not.
func restoreDelta(preReset, current float64) (float64, bool) {
	if preReset <= 0 {
		return 0, false
	}
	if current+1 < preReset {
		return 0, false
	}
	d := current - preReset
	if d < 0 {
		d = 0
	}
	return d, true
}

func plausibleCounterAdvance(delta float64, dt time.Duration) bool {
	if delta <= 0 || !signalcounter.Valid(delta) {
		return true
	}
	if dt < minAdvanceInterval {
		dt = minAdvanceInterval
	}
	return delta <= maxAttributableSpeedMps*dt.Seconds()
}
