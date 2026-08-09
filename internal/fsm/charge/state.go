// Package charge implements the Charge Session sub-FSM.
package charge

import "time"

// State represents a charge session lifecycle state.
type State string

const (
	Pending    State = "pending"    // Charge detected; waiting for start snapshot
	Active     State = "active"     // Start values captured; accumulating
	Completing State = "completing" // Charge ended; waiting for end snapshot
	Done       State = "done"       // Final metrics computed, persisted
	Recovered  State = "recovered"  // Reconstructed from DB after pod restart
)

// Trigger represents an event in the charge session lifecycle.
type Trigger int

const (
	TriggerStartSnapshotReady Trigger = iota
	TriggerStartTimeout
	TriggerChargeEnding
	TriggerGearDriving // unplug-and-go
	TriggerEndSnapshotReady
	TriggerEndTimeout
	TriggerPodRestart
	TriggerChargeStillActive
)

func (t Trigger) String() string {
	names := [...]string{
		"TriggerStartSnapshotReady", "TriggerStartTimeout",
		"TriggerChargeEnding", "TriggerGearDriving",
		"TriggerEndSnapshotReady", "TriggerEndTimeout",
		"TriggerPodRestart", "TriggerChargeStillActive",
	}
	if int(t) < len(names) {
		return names[t]
	}
	return "TriggerUnknown"
}

// Context holds all accumulated data for a charge session.
type Context struct {
	SessionID int64
	VehicleID int64
	VIN       string

	// Start snapshot
	StartBattery   int
	StartRange     float64
	StartLatitude  float64
	StartLongitude float64
	StartTime      time.Time

	// End snapshot
	EndBattery int
	EndRange   float64
	EndTime    time.Time

	// Charger info
	ChargerType      string // "AC" or "DC"
	FastChargerType  string
	FastChargerBrand string
	CableType        string
	Phases           int
	MaxVoltage       int
	MaxCurrent       int
	MaxPower         float64 // W

	// Accumulation
	EnergyAdded    float64 // Wh
	VoltageSum     float64
	VoltageSamples int
	CurrentSum     float64
	CurrentSamples int
	PowerSum       float64 // sum of W samples
	PowerSamples   int
	InsideTempSum  float64
	OutsideTempSum float64
	TempSamples    int

	// Metadata
	PendingSince    time.Time
	CompletingSince time.Time
}

// HasRequiredStartFields returns true if we have enough start data.
func (c *Context) HasRequiredStartFields() bool {
	return c.StartBattery > 0 &&
		c.StartLatitude != 0 && c.StartLongitude != 0
}

// HasRequiredEndFields returns true if we have enough end data.
func (c *Context) HasRequiredEndFields() bool {
	return c.EndBattery > 0 &&
		c.EndBattery >= c.StartBattery &&
		c.EnergyAdded >= 0
}

// Duration returns the charge duration.
func (c *Context) Duration() time.Duration {
	if c.EndTime.IsZero() || c.StartTime.IsZero() {
		return 0
	}
	return c.EndTime.Sub(c.StartTime)
}

// BatteryGain returns end - start battery %.
func (c *Context) BatteryGain() int {
	return c.EndBattery - c.StartBattery
}

// AvgPower returns average charge power in W.
func (c *Context) AvgPower() float64 {
	if c.PowerSamples == 0 {
		return 0
	}
	return c.PowerSum / float64(c.PowerSamples)
}

// Validate checks the completed charge session for impossible values.
func Validate(c *Context) []string {
	var issues []string
	dur := c.Duration()

	if c.EndBattery < c.StartBattery {
		issues = append(issues, "end battery < start battery")
	}
	if c.EnergyAdded <= 0 && dur > 5*time.Minute {
		issues = append(issues, "no energy added in >5min charge")
	}
	if c.EnergyAdded > 150_000 {
		issues = append(issues, "energy > 150 kWh — suspicious")
	}
	if dur < 1*time.Minute {
		issues = append(issues, "duration < 1 min — micro-charge")
	}
	if dur.Hours() > 0 && c.EnergyAdded > 0 {
		rate := c.EnergyAdded / dur.Hours()
		if rate > 350_000 {
			issues = append(issues, "charge rate > 350 kW — suspicious")
		}
	}
	return issues
}
