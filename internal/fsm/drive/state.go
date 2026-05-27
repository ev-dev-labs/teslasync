// Package drive implements the Drive Session sub-FSM.
// It manages the lifecycle of a drive session: snapshot capture → accumulation → completion.
package drive

import "time"

// State represents a drive session lifecycle state.
type State string

const (
	Pending   State = "pending"   // Drive detected; waiting for start snapshot (odometer, battery, location)
	Active    State = "active"    // Start values captured; accumulating telemetry
	Ending    State = "ending"    // Gear=P received; waiting for end snapshot
	Completed State = "completed" // Final metrics computed, persisted
	Recovered State = "recovered" // Reconstructed from DB after pod restart
)

// Trigger represents an event in the drive session lifecycle.
type Trigger int

const (
	TriggerStartSnapshotReady Trigger = iota // All required start fields captured
	TriggerStartTimeout                      // 30s timeout — proceed with partial start data
	TriggerDriveEnding                       // Vehicle FSM exited Driving state
	TriggerEndSnapshotReady                  // All required end fields captured
	TriggerEndTimeout                        // 60s timeout — persist what we have
	TriggerPodRestart                        // Pod restarted mid-drive
	TriggerSignalsFlowing                    // Signals resumed after recovery
)

// String returns a human-readable trigger name.
func (t Trigger) String() string {
	names := [...]string{
		"TriggerStartSnapshotReady",
		"TriggerStartTimeout",
		"TriggerDriveEnding",
		"TriggerEndSnapshotReady",
		"TriggerEndTimeout",
		"TriggerPodRestart",
		"TriggerSignalsFlowing",
	}
	if int(t) < len(names) {
		return names[t]
	}
	return "TriggerUnknown"
}

// Context holds all accumulated data for a drive session.
type Context struct {
	DriveID   int64
	VehicleID int64
	VIN       string

	// Start snapshot (populated during Pending)
	StartOdometer  float64
	StartBattery   int
	StartRange     float64
	StartLatitude  float64
	StartLongitude float64
	StartTime      time.Time

	// End snapshot (populated during Ending)
	EndOdometer  float64
	EndBattery   int
	EndRange     float64
	EndLatitude  float64
	EndLongitude float64
	EndTime      time.Time

	// Accumulation (updated during Active)
	MaxSpeed       float64
	SpeedSum       float64
	SpeedSamples   int
	PowerSum       float64
	PowerSamples   int
	TotalEnergy    float64 // cumulative Wh consumed
	RegenEnergy    float64 // cumulative Wh recovered
	InsideTempSum  float64
	OutsideTempSum float64
	TempSamples    int
	PositionCount  int

	// State metadata
	PendingSince time.Time // when Pending started (for timeout)
	EndingSince  time.Time // when Ending started (for timeout)
}

// HasRequiredStartFields returns true if we have enough data to start tracking.
func (c *Context) HasRequiredStartFields() bool {
	return c.StartOdometer > 0 &&
		c.StartBattery > 0 &&
		c.StartLatitude != 0 && c.StartLongitude != 0
}

// HasRequiredEndFields returns true if we have enough data to complete.
func (c *Context) HasRequiredEndFields() bool {
	return c.EndOdometer > 0 &&
		c.EndOdometer > c.StartOdometer &&
		c.EndBattery > 0 &&
		c.EndLatitude != 0 && c.EndLongitude != 0
}

// Distance returns end - start odometer in miles.
func (c *Context) Distance() float64 {
	if c.EndOdometer <= c.StartOdometer {
		return 0
	}
	return c.EndOdometer - c.StartOdometer
}

// Duration returns the drive duration.
func (c *Context) Duration() time.Duration {
	if c.EndTime.IsZero() || c.StartTime.IsZero() {
		return 0
	}
	return c.EndTime.Sub(c.StartTime)
}

// AvgSpeed returns average speed from accumulated samples.
func (c *Context) AvgSpeed() float64 {
	if c.SpeedSamples == 0 {
		return 0
	}
	return c.SpeedSum / float64(c.SpeedSamples)
}

// NetEnergy returns consumed - recovered energy in Wh.
func (c *Context) NetEnergy() float64 {
	return c.TotalEnergy - c.RegenEnergy
}

// Efficiency returns Wh/mi (net energy per mile driven).
func (c *Context) Efficiency() float64 {
	d := c.Distance()
	if d <= 0 {
		return 0
	}
	return c.NetEnergy() / d
}
