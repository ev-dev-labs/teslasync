package charge

import (
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

const (
	StartSnapshotTimeout = 30 * time.Second
	EndSnapshotTimeout   = 30 * time.Second
)

// SessionFSM manages the lifecycle of a single charge session.
type SessionFSM struct {
	mu     sync.Mutex
	state  State
	ctx    *Context
	logger zerolog.Logger
}

// NewSessionFSM creates a charge session FSM in Pending state.
func NewSessionFSM(vehicleID int64, vin string, sessionID int64) *SessionFSM {
	return NewSessionFSMAt(vehicleID, vin, sessionID, time.Now().UTC())
}

// NewSessionFSMAt creates a charge session FSM anchored to event time.
func NewSessionFSMAt(vehicleID int64, vin string, sessionID int64, eventTime time.Time) *SessionFSM {
	if eventTime.IsZero() {
		eventTime = time.Now().UTC()
	}
	return &SessionFSM{
		state: Pending,
		ctx: &Context{
			SessionID:    sessionID,
			VehicleID:    vehicleID,
			VIN:          vin,
			StartTime:    eventTime,
			PendingSince: eventTime,
		},
		logger: log.With().Str("component", "charge_fsm").Int64("session_id", sessionID).Logger(),
	}
}

func (m *SessionFSM) State() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

func (m *SessionFSM) Context() Context {
	m.mu.Lock()
	defer m.mu.Unlock()
	return *m.ctx
}

// ProcessSignals feeds a signal batch to the charge session FSM.
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
		m.extractChargerInfo(signals)
		if m.ctx.HasRequiredStartFields() {
			m.transitionTo(Active, TriggerStartSnapshotReady)
		} else if eventTime.Sub(m.ctx.PendingSince) > StartSnapshotTimeout {
			m.logger.Warn().Msg("start snapshot timeout — proceeding with partial data")
			m.transitionTo(Active, TriggerStartTimeout)
		}

	case Active:
		m.accumulate(signals)

	case Completing:
		m.extractEndSnapshot(signals)
		if m.ctx.HasRequiredEndFields() {
			m.transitionTo(Done, TriggerEndSnapshotReady)
		} else if eventTime.Sub(m.ctx.CompletingSince) > EndSnapshotTimeout {
			m.logger.Warn().Msg("end snapshot timeout — completing with partial data")
			m.transitionTo(Done, TriggerEndTimeout)
		}

	case Recovered:
		m.accumulate(signals)
		m.transitionTo(Active, TriggerChargeStillActive)
	}
}

// TriggerEnding moves to Completing state (charge ended or unplug-and-go).
func (m *SessionFSM) TriggerEnding(signals map[string]interface{}, gearDrive bool) {
	m.TriggerEndingAt(signals, gearDrive, time.Now().UTC())
}

// TriggerEndingAt moves the session to Completing at the supplied event time.
func (m *SessionFSM) TriggerEndingAt(signals map[string]interface{}, gearDrive bool, eventTime time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.state == Done {
		return
	}

	if eventTime.IsZero() {
		eventTime = time.Now().UTC()
	}
	m.ctx.EndTime = eventTime
	m.ctx.CompletingSince = eventTime

	if signals != nil {
		m.extractEndSnapshot(signals)
	}

	trigger := TriggerChargeEnding
	if gearDrive {
		trigger = TriggerGearDriving
	}

	if m.ctx.HasRequiredEndFields() {
		m.transitionTo(Done, TriggerEndSnapshotReady)
	} else {
		m.transitionTo(Completing, trigger)
	}
}

func (m *SessionFSM) ForceComplete() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state != Done {
		if m.ctx.EndTime.IsZero() {
			m.ctx.EndTime = time.Now().UTC()
		}
		m.transitionTo(Done, TriggerEndTimeout)
	}
}

func (m *SessionFSM) IsCompleted() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state == Done
}

func (m *SessionFSM) ValidationIssues() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return Validate(m.ctx)
}

func (m *SessionFSM) RecoverFrom(startBattery int, startLat, startLon float64, startTime time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ctx.StartBattery = startBattery
	m.ctx.StartLatitude = startLat
	m.ctx.StartLongitude = startLon
	m.ctx.StartTime = startTime
	m.state = Recovered
}

func (m *SessionFSM) transitionTo(to State, trigger Trigger) {
	from := m.state
	m.state = to
	m.logger.Info().
		Str("from", string(from)).Str("to", string(to)).
		Str("trigger", trigger.String()).
		Msg("charge session transition")
}

func (m *SessionFSM) extractStartSnapshot(signals map[string]interface{}) {
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
	if v, ok := toInt(signals["BatteryLevel"]); ok {
		m.ctx.EndBattery = v
	}
	if v, ok := toFloat(signals["RatedRange"]); ok {
		m.ctx.EndRange = v
	}
	if m.ctx.EndTime.IsZero() {
		m.ctx.EndTime = time.Now().UTC()
	}
}

func (m *SessionFSM) extractChargerInfo(signals map[string]interface{}) {
	if v, ok := signals["FastChargerType"].(string); ok {
		m.ctx.FastChargerType = v
	}
	if v, ok := signals["FastChargerBrand"].(string); ok {
		m.ctx.FastChargerBrand = v
	}
	if v, ok := signals["ChargingCableType"].(string); ok {
		m.ctx.CableType = v
	}
	if v, ok := toInt(signals["ChargerPhases"]); ok {
		m.ctx.Phases = v
	}
}

func (m *SessionFSM) accumulate(signals map[string]interface{}) {
	if v, ok := toFloat(signals["DCChargingEnergyIn"]); ok {
		m.ctx.EnergyAdded = v
	} else if v, ok := toFloat(signals["ACChargingEnergyIn"]); ok {
		m.ctx.EnergyAdded = v
	}
	if v, ok := toInt(signals["ChargerVoltage"]); ok {
		m.ctx.VoltageSum += float64(v)
		m.ctx.VoltageSamples++
		if v > m.ctx.MaxVoltage {
			m.ctx.MaxVoltage = v
		}
	}
	if v, ok := toInt(signals["ChargerActualCurrent"]); ok {
		m.ctx.CurrentSum += float64(v)
		m.ctx.CurrentSamples++
		if v > m.ctx.MaxCurrent {
			m.ctx.MaxCurrent = v
		}
	}
	if v, ok := toFloat(signals["DCChargingPower"]); ok {
		m.ctx.PowerSum += v
		m.ctx.PowerSamples++
		if v > m.ctx.MaxPower {
			m.ctx.MaxPower = v
		}
	} else if v, ok := toFloat(signals["ACChargingPower"]); ok {
		m.ctx.PowerSum += v
		m.ctx.PowerSamples++
		if v > m.ctx.MaxPower {
			m.ctx.MaxPower = v
		}
	}
	if v, ok := toFloat(signals["InsideTemp"]); ok {
		m.ctx.InsideTempSum += v
		m.ctx.TempSamples++
	}
	if v, ok := toFloat(signals["OutsideTemp"]); ok {
		m.ctx.OutsideTempSum += v
	}
	// Continuously update end battery
	if v, ok := toInt(signals["BatteryLevel"]); ok {
		m.ctx.EndBattery = v
	}
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
	}
	return 0, false
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
	}
	return 0, false
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
