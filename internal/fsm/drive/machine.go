package drive

import (
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

const (
	StartSnapshotTimeout = 30 * time.Second
	EndSnapshotTimeout   = 60 * time.Second
)

// SessionFSM manages the lifecycle of a single drive session.
type SessionFSM struct {
	mu     sync.Mutex
	state  State
	ctx    *Context
	logger zerolog.Logger
}

// NewSessionFSM creates a drive session FSM in Pending state.
func NewSessionFSM(vehicleID int64, vin string, driveID int64) *SessionFSM {
	return NewSessionFSMAt(vehicleID, vin, driveID, time.Now().UTC())
}

// NewSessionFSMAt creates a drive session FSM anchored to event time.
func NewSessionFSMAt(vehicleID int64, vin string, driveID int64, eventTime time.Time) *SessionFSM {
	if eventTime.IsZero() {
		eventTime = time.Now().UTC()
	}
	return &SessionFSM{
		state: Pending,
		ctx: &Context{
			DriveID:      driveID,
			VehicleID:    vehicleID,
			VIN:          vin,
			StartTime:    eventTime,
			PendingSince: eventTime,
		},
		logger: log.With().Str("component", "drive_fsm").Int64("drive_id", driveID).Logger(),
	}
}

// State returns the current session state.
func (m *SessionFSM) State() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

// Context returns a copy of the session context.
func (m *SessionFSM) Context() Context {
	m.mu.Lock()
	defer m.mu.Unlock()
	return *m.ctx
}

// ProcessSignals feeds a signal batch to the drive session FSM.
func (m *SessionFSM) ProcessSignals(signals map[string]interface{}) {
	m.ProcessSignalsAt(signals, time.Now().UTC())
}

// ProcessSignalsAt feeds a signal batch using producer event time.
func (m *SessionFSM) ProcessSignalsAt(signals map[string]interface{}, eventTime time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if eventTime.IsZero() {
		eventTime = time.Now().UTC()
	}

	switch m.state {
	case Pending:
		m.extractStartSnapshot(signals)
		if m.ctx.HasRequiredStartFields() {
			m.transitionTo(Active, TriggerStartSnapshotReady)
		} else if eventTime.Sub(m.ctx.PendingSince) > StartSnapshotTimeout {
			m.logger.Warn().Msg("start snapshot timeout — proceeding with partial data")
			m.transitionTo(Active, TriggerStartTimeout)
		}

	case Active:
		m.accumulate(signals, eventTime)

	case Ending:
		m.extractEndSnapshot(signals)
		if m.ctx.HasRequiredEndFields() {
			m.transitionTo(Completed, TriggerEndSnapshotReady)
		} else if eventTime.Sub(m.ctx.EndingSince) > EndSnapshotTimeout {
			m.logger.Warn().Msg("end snapshot timeout — completing with partial data")
			m.transitionTo(Completed, TriggerEndTimeout)
		}

	case Recovered:
		// Resume accumulation — next signal moves us to Active
		m.accumulate(signals, eventTime)
		m.transitionTo(Active, TriggerSignalsFlowing)
	}
}

// TriggerEnding moves the session to Ending state (vehicle exited Driving).
func (m *SessionFSM) TriggerEnding(signals map[string]interface{}) {
	m.TriggerEndingAt(signals, time.Now().UTC())
}

// TriggerEndingAt moves the session to Ending at the supplied event time.
func (m *SessionFSM) TriggerEndingAt(signals map[string]interface{}, eventTime time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.state == Completed {
		return
	}

	if eventTime.IsZero() {
		eventTime = time.Now().UTC()
	}
	m.ctx.EndTime = eventTime
	m.ctx.EndingSince = eventTime

	if signals != nil {
		m.extractEndSnapshot(signals)
	}

	if m.ctx.HasRequiredEndFields() {
		m.transitionTo(Completed, TriggerEndSnapshotReady)
	} else {
		m.transitionTo(Ending, TriggerDriveEnding)
	}
}

// ForceComplete moves directly to Completed (e.g., stale timeout).
func (m *SessionFSM) ForceComplete() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != Completed {
		if m.ctx.EndTime.IsZero() {
			m.ctx.EndTime = time.Now().UTC()
		}
		m.transitionTo(Completed, TriggerEndTimeout)
	}
}

// IsCompleted returns true if the session has finished.
func (m *SessionFSM) IsCompleted() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state == Completed
}

// ValidationIssues runs validation on the completed session.
func (m *SessionFSM) ValidationIssues() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return Validate(m.ctx)
}

// RecoverFrom reconstructs state from a DB drive record.
func (m *SessionFSM) RecoverFrom(startOdo float64, startBattery int, startLat, startLon float64, startTime time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ctx.StartOdometer = startOdo
	m.ctx.StartBattery = startBattery
	m.ctx.StartLatitude = startLat
	m.ctx.StartLongitude = startLon
	m.ctx.StartTime = startTime
	m.state = Recovered
	m.logger.Info().Msg("drive session recovered from DB")
}

func (m *SessionFSM) transitionTo(to State, trigger Trigger) {
	from := m.state
	m.state = to
	m.logger.Info().
		Str("from", string(from)).
		Str("to", string(to)).
		Str("trigger", trigger.String()).
		Msg("drive session transition")
}

func (m *SessionFSM) extractStartSnapshot(signals map[string]interface{}) {
	if v, ok := toFloat(signals["Odometer"]); ok && m.ctx.StartOdometer == 0 {
		m.ctx.StartOdometer = v
	}
	if v, ok := toInt(signals["BatteryLevel"]); ok && m.ctx.StartBattery == 0 {
		m.ctx.StartBattery = v
	}
	if v, ok := toInt(signals["Soc"]); ok && m.ctx.StartBattery == 0 {
		m.ctx.StartBattery = v
	}
	if v, ok := toFloat(signals["RatedRange"]); ok && m.ctx.StartRange == 0 {
		m.ctx.StartRange = v
	}
	lat, lon := extractLatLon(signals)
	if lat != 0 && lon != 0 && m.ctx.StartLatitude == 0 {
		m.ctx.StartLatitude = lat
		m.ctx.StartLongitude = lon
	}
}

func (m *SessionFSM) extractEndSnapshot(signals map[string]interface{}) {
	if v, ok := toFloat(signals["Odometer"]); ok {
		m.ctx.EndOdometer = v
	}
	if v, ok := toInt(signals["BatteryLevel"]); ok {
		m.ctx.EndBattery = v
	}
	if v, ok := toInt(signals["Soc"]); ok && m.ctx.EndBattery == 0 {
		m.ctx.EndBattery = v
	}
	if v, ok := toFloat(signals["RatedRange"]); ok {
		m.ctx.EndRange = v
	}
	lat, lon := extractLatLon(signals)
	if lat != 0 && lon != 0 {
		m.ctx.EndLatitude = lat
		m.ctx.EndLongitude = lon
	}
	if m.ctx.EndTime.IsZero() {
		m.ctx.EndTime = time.Now().UTC()
	}
}

func (m *SessionFSM) accumulate(signals map[string]interface{}, now time.Time) {
	if speed, ok := toFloat(signals["VehicleSpeed"]); ok {
		m.ctx.SpeedSum += speed
		m.ctx.SpeedSamples++
		if speed > m.ctx.MaxSpeed {
			m.ctx.MaxSpeed = speed
		}
	}
	if power, ok := toFloat(signals["PackCurrent"]); ok {
		if voltage, vOk := toFloat(signals["PackVoltage"]); vOk {
			watts := power * voltage
			if watts > 0 {
				m.ctx.TotalEnergy += watts / 3600.0 // Watt-seconds to Wh
			} else {
				m.ctx.RegenEnergy += -watts / 3600.0
			}
		}
		m.ctx.PowerSum += power
		m.ctx.PowerSamples++
	}
	if it, ok := toFloat(signals["InsideTemp"]); ok {
		m.ctx.InsideTempSum += it
		m.ctx.TempSamples++
	}
	if ot, ok := toFloat(signals["OutsideTemp"]); ok {
		m.ctx.OutsideTempSum += ot
	}
	// Update end values continuously so we always have latest
	if v, ok := toFloat(signals["Odometer"]); ok {
		m.ctx.EndOdometer = v
	}
	if v, ok := toInt(signals["BatteryLevel"]); ok {
		m.ctx.EndBattery = v
	}
	lat, lon := extractLatLon(signals)
	if lat != 0 && lon != 0 {
		m.ctx.EndLatitude = lat
		m.ctx.EndLongitude = lon
		m.ctx.PositionCount++
	}
	_ = now
}

// helpers

func toFloat(v interface{}) (float64, bool) {
	if v == nil {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return 0, false
	}
}

func toInt(v interface{}) (int, bool) {
	if v == nil {
		return 0, false
	}
	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	case float32:
		return int(n), true
	default:
		return 0, false
	}
}

func extractLatLon(signals map[string]interface{}) (float64, float64) {
	if loc, ok := signals["Location"].(map[string]interface{}); ok {
		lat, latOk := toFloat(loc["latitude"])
		lon, lonOk := toFloat(loc["longitude"])
		if latOk && lonOk {
			return lat, lon
		}
	}
	lat, latOk := toFloat(signals["Latitude"])
	lon, lonOk := toFloat(signals["Longitude"])
	if latOk && lonOk {
		return lat, lon
	}
	return 0, 0
}
