// Package update implements the Software Update FSM for tracking OTA update
// lifecycle from available → downloading → installing → installed/failed.
package update

import (
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// State represents a software update lifecycle state.
type State string

const (
	NoUpdate    State = "no_update"
	Available   State = "available"
	Scheduled   State = "scheduled"
	Downloading State = "downloading"
	Downloaded  State = "downloaded"
	Installing  State = "installing"
	Installed   State = "installed"
	Failed      State = "failed"
)

// Trigger represents an event that causes a state transition.
type Trigger string

const (
	TriggerVersionAvailable Trigger = "version_available"
	TriggerScheduleSet      Trigger = "schedule_set"
	TriggerDownloadStarted  Trigger = "download_started"
	TriggerDownloadComplete Trigger = "download_complete"
	TriggerInstallStarted   Trigger = "install_started"
	TriggerInstallComplete  Trigger = "install_complete"
	TriggerDownloadFailed   Trigger = "download_failed"
	TriggerInstallFailed    Trigger = "install_failed"
	TriggerVersionChanged   Trigger = "version_changed"
	TriggerNoUpdate         Trigger = "no_update"
)

// TransitionEvent records a single state transition for external logging.
type TransitionEvent struct {
	From     State
	To       State
	Trigger  Trigger
	Duration time.Duration
	Snapshot map[string]interface{}
}

// validTransitions defines the allowed state transitions.
var validTransitions = map[State]map[Trigger]State{
	NoUpdate: {
		TriggerVersionAvailable: Available,
	},
	Available: {
		TriggerScheduleSet:     Scheduled,
		TriggerDownloadStarted: Downloading,
		TriggerNoUpdate:        NoUpdate,
		TriggerVersionChanged:  Installed,
	},
	Scheduled: {
		TriggerDownloadStarted: Downloading,
		TriggerNoUpdate:        NoUpdate,
		TriggerVersionChanged:  Installed,
	},
	Downloading: {
		TriggerDownloadComplete: Downloaded,
		TriggerDownloadFailed:   Failed,
		TriggerVersionChanged:   Installed,
	},
	Downloaded: {
		TriggerInstallStarted: Installing,
		TriggerVersionChanged: Installed,
	},
	Installing: {
		TriggerInstallComplete: Installed,
		TriggerInstallFailed:   Failed,
		TriggerVersionChanged:  Installed,
	},
	Installed: {
		TriggerNoUpdate: NoUpdate,
	},
	Failed: {
		TriggerVersionAvailable: Available,
		TriggerNoUpdate:         NoUpdate,
		TriggerVersionChanged:   Installed,
	},
}

// UpdateFSM manages the software update lifecycle for a single vehicle.
// Thread-safe — all public methods acquire the internal mutex.
type UpdateFSM struct {
	mu               sync.Mutex
	state            State
	vehicleID        int64
	targetVersion    string
	currentVersion   string
	downloadPct      float64
	installPct       float64
	scheduledStart   string
	expectedDuration int // minutes
	stateEnteredAt   time.Time
	createdAt        time.Time
	logger           zerolog.Logger
}

// NewUpdateFSM creates a software update FSM starting in NoUpdate state.
func NewUpdateFSM(vehicleID int64, currentVersion string) *UpdateFSM {
	now := time.Now().UTC()
	return &UpdateFSM{
		state:          NoUpdate,
		vehicleID:      vehicleID,
		currentVersion: currentVersion,
		stateEnteredAt: now,
		createdAt:      now,
		logger: log.With().Str("component", "update_fsm").
			Int64("vehicle_id", vehicleID).Logger(),
	}
}

// State returns the current state (thread-safe).
func (f *UpdateFSM) State() State {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.state
}

// CurrentVersion returns the known firmware version.
func (f *UpdateFSM) CurrentVersion() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.currentVersion
}

// Snapshot returns the current FSM context for external use (thread-safe).
func (f *UpdateFSM) Snapshot() map[string]interface{} {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.snapshot()
}

func (f *UpdateFSM) snapshot() map[string]interface{} {
	snap := map[string]interface{}{
		"state":           string(f.state),
		"current_version": f.currentVersion,
	}
	if f.targetVersion != "" {
		snap["target_version"] = f.targetVersion
	}
	if f.downloadPct > 0 {
		snap["download_pct"] = f.downloadPct
	}
	if f.installPct > 0 {
		snap["install_pct"] = f.installPct
	}
	if f.scheduledStart != "" {
		snap["scheduled_start"] = f.scheduledStart
	}
	if f.expectedDuration > 0 {
		snap["expected_duration_min"] = f.expectedDuration
	}
	return snap
}

// ProcessSignals evaluates a telemetry signal batch and returns any transitions.
//
// Signal keys:
//   - "Version" — current firmware version
//   - "SoftwareUpdateVersion" — OTA update target version
//   - "SoftwareUpdateDownloadPercentComplete" — download progress (0–100)
//   - "SoftwareUpdateInstallationPercentComplete" — install progress (0–100)
//   - "SoftwareUpdateScheduledStartTime" — user-scheduled install time
//   - "SoftwareUpdateExpectedDurationMinutes" — estimated install duration
func (f *UpdateFSM) ProcessSignals(signals map[string]interface{}) []TransitionEvent {
	f.mu.Lock()
	defer f.mu.Unlock()

	var events []TransitionEvent

	// Extract signal values
	version := stringSignal(signals, "Version")
	updateVersion := stringSignal(signals, "SoftwareUpdateVersion")
	downloadPct, hasDownload := floatSignal(signals, "SoftwareUpdateDownloadPercentComplete")
	installPct, hasInstall := floatSignal(signals, "SoftwareUpdateInstallationPercentComplete")
	scheduledStart := stringSignal(signals, "SoftwareUpdateScheduledStartTime")
	expectedDur, hasExpDur := floatSignal(signals, "SoftwareUpdateExpectedDurationMinutes")
	_, hasSWVersion := signals["SoftwareUpdateVersion"]

	// Track previous percentages for failure detection
	prevDownloadPct := f.downloadPct
	prevInstallPct := f.installPct

	// Update metadata from incoming signals
	if hasDownload {
		f.downloadPct = downloadPct
	}
	if hasInstall {
		f.installPct = installPct
	}
	if scheduledStart != "" {
		f.scheduledStart = scheduledStart
	}
	if hasExpDur && expectedDur > 0 {
		f.expectedDuration = int(expectedDur)
	}

	// --- Global: firmware version change detection ---
	// If the running firmware version changes, any active update is complete.
	if version != "" {
		if f.currentVersion == "" {
			f.currentVersion = version
		} else if version != f.currentVersion {
			f.currentVersion = version
			if f.state != NoUpdate && f.state != Installed {
				if ev := f.doTransition(TriggerVersionChanged); ev != nil {
					events = append(events, *ev)
				}
			}
		}
	}

	// --- State-specific transitions (loop to handle cascading) ---
	// e.g., Installing → Installed → NoUpdate in a single signal batch
	for i := 0; i < 10; i++ {
		prevState := f.state
		switch f.state {
		case NoUpdate:
			if updateVersion != "" && f.currentVersion != "" && updateVersion != f.currentVersion {
				f.targetVersion = updateVersion
				if ev := f.doTransition(TriggerVersionAvailable); ev != nil {
					events = append(events, *ev)
				}
			}

		case Available:
			if hasSWVersion && (updateVersion == "" || updateVersion == f.currentVersion) {
				if ev := f.doTransition(TriggerNoUpdate); ev != nil {
					events = append(events, *ev)
				}
			} else if hasDownload && downloadPct > 0 {
				if ev := f.doTransition(TriggerDownloadStarted); ev != nil {
					events = append(events, *ev)
				}
			} else if scheduledStart != "" {
				if ev := f.doTransition(TriggerScheduleSet); ev != nil {
					events = append(events, *ev)
				}
			}

		case Scheduled:
			if hasSWVersion && (updateVersion == "" || updateVersion == f.currentVersion) {
				if ev := f.doTransition(TriggerNoUpdate); ev != nil {
					events = append(events, *ev)
				}
			} else if hasDownload && downloadPct > 0 {
				if ev := f.doTransition(TriggerDownloadStarted); ev != nil {
					events = append(events, *ev)
				}
			}

		case Downloading:
			if hasDownload && downloadPct >= 100 {
				if ev := f.doTransition(TriggerDownloadComplete); ev != nil {
					events = append(events, *ev)
				}
			} else if hasDownload && downloadPct == 0 && prevDownloadPct > 0 {
				// Download progress reset to zero — indicates failure
				if ev := f.doTransition(TriggerDownloadFailed); ev != nil {
					events = append(events, *ev)
				}
			}

		case Downloaded:
			if hasInstall && installPct > 0 {
				if ev := f.doTransition(TriggerInstallStarted); ev != nil {
					events = append(events, *ev)
				}
			}

		case Installing:
			if hasInstall && installPct >= 100 {
				if ev := f.doTransition(TriggerInstallComplete); ev != nil {
					events = append(events, *ev)
				}
			} else if hasInstall && installPct == 0 && prevInstallPct > 0 {
				// Install progress reset to zero — indicates failure
				if ev := f.doTransition(TriggerInstallFailed); ev != nil {
					events = append(events, *ev)
				}
			}

		case Installed:
			// Auto-reset: update complete, transition back to no_update
			if ev := f.doTransition(TriggerNoUpdate); ev != nil {
				events = append(events, *ev)
			}
			f.targetVersion = ""
			f.downloadPct = 0
			f.installPct = 0
			f.scheduledStart = ""
			f.expectedDuration = 0

		case Failed:
			if updateVersion != "" && f.currentVersion != "" && updateVersion != f.currentVersion {
				f.targetVersion = updateVersion
				f.downloadPct = 0
				f.installPct = 0
				if ev := f.doTransition(TriggerVersionAvailable); ev != nil {
					events = append(events, *ev)
				}
			}
		}

		if f.state == prevState {
			break // no transition — stable
		}
	}

	return events
}

// doTransition validates and executes a state transition.
func (f *UpdateFSM) doTransition(trigger Trigger) *TransitionEvent {
	triggers, ok := validTransitions[f.state]
	if !ok {
		return nil
	}
	to, ok := triggers[trigger]
	if !ok {
		return nil
	}

	from := f.state
	now := time.Now().UTC()
	duration := now.Sub(f.stateEnteredAt)

	ev := &TransitionEvent{
		From:     from,
		To:       to,
		Trigger:  trigger,
		Duration: duration,
		Snapshot: f.snapshot(),
	}

	f.state = to
	f.stateEnteredAt = now

	f.logger.Info().
		Str("from", string(from)).
		Str("to", string(to)).
		Str("trigger", string(trigger)).
		Dur("duration_in_state", duration).
		Msg("software update transition")

	return ev
}

// stringSignal extracts a string value from the signal map.
func stringSignal(signals map[string]interface{}, key string) string {
	v, ok := signals[key]
	if !ok || v == nil {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return ""
	}
	return s
}

// floatSignal extracts a float64 value from the signal map.
func floatSignal(signals map[string]interface{}, key string) (float64, bool) {
	v, ok := signals[key]
	if !ok || v == nil {
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
