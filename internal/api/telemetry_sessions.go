package api

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// TelemetrySessionTracker detects drive starts/ends and charge starts/ends
// from streaming Fleet Telemetry signals. Mirrors the polling worker's
// session detection but works with individual signal updates.
type TelemetrySessionTracker struct {
	driveRepo  *database.DriveRepo
	chargeRepo *database.ChargingRepo
	eventBus   *events.Bus

	mu            sync.Mutex
	activeDrives  map[int64]*streamingDrive  // vehicleID → active drive
	activeCharges map[int64]*streamingCharge // vehicleID → active charge
}

type streamingDrive struct {
	DriveID   int64
	StartTime time.Time
	LastSpeed float64
	LastSeen  time.Time
	MaxSpeed  float64
}

type streamingCharge struct {
	SessionID   int64
	StartTime   time.Time
	LastSeen    time.Time
	EnergyAdded float64
}

// NewTelemetrySessionTracker creates a session tracker for streaming data.
func NewTelemetrySessionTracker(db *database.DB, eventBus *events.Bus) *TelemetrySessionTracker {
	return &TelemetrySessionTracker{
		driveRepo:     database.NewDriveRepo(db),
		chargeRepo:    database.NewChargingRepo(db),
		eventBus:      eventBus,
		activeDrives:  make(map[int64]*streamingDrive),
		activeCharges: make(map[int64]*streamingCharge),
	}
}

// ProcessSignals evaluates incoming telemetry signals for drive/charge transitions.
func (t *TelemetrySessionTracker) ProcessSignals(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}) {
	t.trackDriving(ctx, vehicleID, vin, signals)
	t.trackCharging(ctx, vehicleID, vin, signals)
}

func (t *TelemetrySessionTracker) trackDriving(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}) {
	speedVal, hasSpeed := signals["VehicleSpeed"]
	if !hasSpeed {
		return
	}
	speed := toFloat(speedVal)

	t.mu.Lock()
	defer t.mu.Unlock()

	active, hasDrive := t.activeDrives[vehicleID]

	if speed > 0 && !hasDrive {
		// Start drive
		batteryLevel := int(toFloat(signals["BatteryLevel"]))
		if batteryLevel == 0 {
			batteryLevel = int(toFloat(signals["Soc"]))
		}

		drive := &models.Drive{
			VehicleID:       vehicleID,
			StartDate:       time.Now().UTC(),
			StartBatteryLvl: &batteryLevel,
		}
		if err := t.driveRepo.Create(ctx, drive); err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to create drive")
			return
		}

		t.activeDrives[vehicleID] = &streamingDrive{
			DriveID:   drive.ID,
			StartTime: time.Now(),
			LastSpeed: speed,
			LastSeen:  time.Now(),
			MaxSpeed:  speed,
		}

		log.Info().Int64("vehicle_id", vehicleID).Int64("drive_id", drive.ID).Msg("telemetry: drive started")
		if t.eventBus != nil {
			t.eventBus.Publish(events.Event{Type: events.DriveStarted, VehicleID: vehicleID, VIN: vin,
				Data: map[string]interface{}{"drive_id": drive.ID, "battery_level": batteryLevel, "source": "fleet_telemetry"}})
		}

	} else if speed > 0 && hasDrive {
		// Update active drive
		active.LastSpeed = speed
		active.LastSeen = time.Now()
		if speed > active.MaxSpeed {
			active.MaxSpeed = speed
		}

	} else if speed == 0 && hasDrive {
		// Speed is 0 — check if drive has ended (speed at 0 for 2+ minutes)
		if time.Since(active.LastSeen) > 2*time.Minute || active.LastSpeed == 0 {
			endBattery := int(toFloat(signals["BatteryLevel"]))
			if endBattery == 0 {
				endBattery = int(toFloat(signals["Soc"]))
			}
			duration := time.Since(active.StartTime).Minutes()
			maxSpeed := active.MaxSpeed

			if err := t.driveRepo.Complete(ctx, active.DriveID, time.Now().UTC(),
				nil, nil, 0, duration, nil, &endBattery, &maxSpeed, nil, nil, nil, nil); err != nil {
				log.Error().Err(err).Int64("drive_id", active.DriveID).Msg("telemetry: failed to complete drive")
			}

			log.Info().Int64("vehicle_id", vehicleID).Int64("drive_id", active.DriveID).Float64("duration_min", duration).Msg("telemetry: drive ended")
			if t.eventBus != nil {
				t.eventBus.Publish(events.Event{Type: events.DriveEnded, VehicleID: vehicleID, VIN: vin,
					Data: map[string]interface{}{"drive_id": active.DriveID, "battery_level": endBattery, "source": "fleet_telemetry"}})
			}

			delete(t.activeDrives, vehicleID)
		}
		// Otherwise, speed just hit 0 — wait to confirm drive ended
		active.LastSpeed = 0
	}
}

func (t *TelemetrySessionTracker) trackCharging(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}) {
	// Check for charge state signal
	chargeStateVal, hasChargeState := signals["DetailedChargeState"]
	if !hasChargeState {
		chargeStateVal, hasChargeState = signals["ChargeState"]
	}
	if !hasChargeState {
		return
	}

	chargeState := ""
	if s, ok := chargeStateVal.(string); ok {
		chargeState = s
	}
	isCharging := chargeState == "Charging" || chargeState == "Starting"

	t.mu.Lock()
	defer t.mu.Unlock()

	active, hasCharge := t.activeCharges[vehicleID]

	if isCharging && !hasCharge {
		// Start charge session
		batteryLevel := int(toFloat(signals["BatteryLevel"]))
		if batteryLevel == 0 {
			batteryLevel = int(toFloat(signals["Soc"]))
		}

		session := &models.ChargingSession{
			VehicleID:         vehicleID,
			StartDate:         time.Now().UTC(),
			StartBatteryLevel: batteryLevel,
		}
		if err := t.chargeRepo.Create(ctx, session); err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to create charge session")
			return
		}

		t.activeCharges[vehicleID] = &streamingCharge{
			SessionID: session.ID,
			StartTime: time.Now(),
			LastSeen:  time.Now(),
		}

		log.Info().Int64("vehicle_id", vehicleID).Int64("session_id", session.ID).Msg("telemetry: charging started")
		if t.eventBus != nil {
			t.eventBus.Publish(events.Event{Type: events.ChargeStarted, VehicleID: vehicleID, VIN: vin,
				Data: map[string]interface{}{"session_id": session.ID, "battery_level": batteryLevel, "source": "fleet_telemetry"}})
		}

	} else if isCharging && hasCharge {
		// Update active charge
		active.LastSeen = time.Now()
		if ea, ok := signals["DCChargingEnergyIn"]; ok {
			active.EnergyAdded = toFloat(ea)
		} else if ea, ok := signals["ACChargingEnergyIn"]; ok {
			active.EnergyAdded = toFloat(ea)
		}

	} else if !isCharging && hasCharge {
		// Charge ended
		endBattery := int(toFloat(signals["BatteryLevel"]))
		if endBattery == 0 {
			endBattery = int(toFloat(signals["Soc"]))
		}
		duration := time.Since(active.StartTime).Minutes()
		power := toFloat(signals["DCChargingPower"])
		if power == 0 {
			power = toFloat(signals["ACChargingPower"])
		}
		intPower := int(power)

		if err := t.chargeRepo.Complete(ctx, active.SessionID, time.Now().UTC(),
			active.EnergyAdded, nil, &endBattery, nil,
			nil, nil, nil, nil,
			nil, nil, nil, nil, duration); err != nil {
			log.Error().Err(err).Int64("session_id", active.SessionID).Msg("telemetry: failed to complete charge")
		}
		_ = intPower // available for future use

		log.Info().Int64("vehicle_id", vehicleID).Int64("session_id", active.SessionID).Float64("duration_min", duration).Msg("telemetry: charging ended")
		if t.eventBus != nil {
			t.eventBus.Publish(events.Event{Type: events.ChargeCompleted, VehicleID: vehicleID, VIN: vin,
				Data: map[string]interface{}{"session_id": active.SessionID, "battery_level": endBattery, "energy_added": active.EnergyAdded, "source": "fleet_telemetry"}})
		}

		delete(t.activeCharges, vehicleID)
	}
}
