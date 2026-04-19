package update

import (
	"testing"
)

func TestHappyPath(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")

	// Step 1: New version available
	events := f.ProcessSignals(map[string]interface{}{
		"Version":               "2026.11.1",
		"SoftwareUpdateVersion": "2026.12.3",
	})
	assertTransition(t, events, NoUpdate, Available, TriggerVersionAvailable)

	// Step 2: Download starts
	events = f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateDownloadPercentComplete": float64(5),
	})
	assertTransition(t, events, Available, Downloading, TriggerDownloadStarted)

	// Step 3: Download progresses — no transition
	events = f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateDownloadPercentComplete": float64(50),
	})
	if len(events) != 0 {
		t.Fatalf("expected no transition at 50%%, got %d events", len(events))
	}

	// Step 4: Download complete
	events = f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateDownloadPercentComplete": float64(100),
	})
	assertTransition(t, events, Downloading, Downloaded, TriggerDownloadComplete)

	// Step 5: Install starts
	events = f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateInstallationPercentComplete": float64(1),
	})
	assertTransition(t, events, Downloaded, Installing, TriggerInstallStarted)

	// Step 6: Install complete
	events = f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateInstallationPercentComplete": float64(100),
	})
	// Installed → NoUpdate auto-transition also fires
	if len(events) < 1 {
		t.Fatal("expected at least 1 transition")
	}
	if events[0].From != Installing || events[0].To != Installed {
		t.Fatalf("expected Installing→Installed, got %s→%s", events[0].From, events[0].To)
	}
	if len(events) == 2 {
		if events[1].From != Installed || events[1].To != NoUpdate {
			t.Fatalf("expected Installed→NoUpdate, got %s→%s", events[1].From, events[1].To)
		}
	}

	// Final state
	if f.State() != NoUpdate {
		t.Fatalf("expected final state NoUpdate, got %s", f.State())
	}
}

func TestScheduledPath(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")

	// Version available
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion": "2026.12.3",
		"Version":               "2026.11.1",
	})
	if f.State() != Available {
		t.Fatalf("expected Available, got %s", f.State())
	}

	// Scheduled
	events := f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateScheduledStartTime": "2026-04-20T02:00:00Z",
	})
	assertTransition(t, events, Available, Scheduled, TriggerScheduleSet)

	// Download starts from scheduled
	events = f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateDownloadPercentComplete": float64(10),
	})
	assertTransition(t, events, Scheduled, Downloading, TriggerDownloadStarted)
}

func TestDownloadFailure(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")

	// Get to downloading state
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion": "2026.12.3",
		"Version":               "2026.11.1",
	})
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateDownloadPercentComplete": float64(50),
	})
	if f.State() != Downloading {
		t.Fatalf("expected Downloading, got %s", f.State())
	}

	// Download progress resets to 0 — failure
	events := f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateDownloadPercentComplete": float64(0),
	})
	assertTransition(t, events, Downloading, Failed, TriggerDownloadFailed)
}

func TestInstallFailure(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")

	// Get to installing state
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion": "2026.12.3",
		"Version":               "2026.11.1",
	})
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateDownloadPercentComplete": float64(100),
	})
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateInstallationPercentComplete": float64(30),
	})
	if f.State() != Installing {
		t.Fatalf("expected Installing, got %s", f.State())
	}

	// Install progress resets to 0 — failure
	events := f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateInstallationPercentComplete": float64(0),
	})
	assertTransition(t, events, Installing, Failed, TriggerInstallFailed)
}

func TestVersionJumpDuringDownload(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")

	// Get to downloading
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion": "2026.12.3",
		"Version":               "2026.11.1",
	})
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateDownloadPercentComplete": float64(42),
	})
	if f.State() != Downloading {
		t.Fatalf("expected Downloading, got %s", f.State())
	}

	// Firmware version jumps — OTA completed behind the scenes
	events := f.ProcessSignals(map[string]interface{}{
		"Version": "2026.12.3",
	})
	// Should get Downloading→Installed, then Installed→NoUpdate
	if len(events) < 1 {
		t.Fatal("expected at least 1 transition on version jump")
	}
	if events[0].From != Downloading || events[0].To != Installed {
		t.Fatalf("expected Downloading→Installed, got %s→%s", events[0].From, events[0].To)
	}
}

func TestVersionJumpDuringInstall(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")

	// Get to installing
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion": "2026.12.3",
		"Version":               "2026.11.1",
	})
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateDownloadPercentComplete": float64(100),
	})
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateInstallationPercentComplete": float64(50),
	})
	if f.State() != Installing {
		t.Fatalf("expected Installing, got %s", f.State())
	}

	// Version changes — install completed
	events := f.ProcessSignals(map[string]interface{}{
		"Version": "2026.12.3",
	})
	if len(events) < 1 || events[0].To != Installed {
		t.Fatal("expected transition to Installed on version change")
	}
}

func TestNoOpSignals(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")

	// Signals with no update info — no transitions
	events := f.ProcessSignals(map[string]interface{}{
		"VehicleSpeed": float64(65.0),
		"BatteryLevel": float64(80),
	})
	if len(events) != 0 {
		t.Fatalf("expected no transitions for unrelated signals, got %d", len(events))
	}
	if f.State() != NoUpdate {
		t.Fatalf("expected NoUpdate, got %s", f.State())
	}
}

func TestNoTransitionWithoutCurrentVersion(t *testing.T) {
	// FSM created without known current version
	f := NewUpdateFSM(1, "")

	// SoftwareUpdateVersion without known current version — should not transition
	events := f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion": "2026.12.3",
	})
	if len(events) != 0 {
		t.Fatal("should not transition without known current version")
	}

	// Now receive Version signal
	events = f.ProcessSignals(map[string]interface{}{
		"Version":               "2026.11.1",
		"SoftwareUpdateVersion": "2026.12.3",
	})
	assertTransition(t, events, NoUpdate, Available, TriggerVersionAvailable)
}

func TestAvailableDismissed(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")

	// Get to available
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion": "2026.12.3",
		"Version":               "2026.11.1",
	})
	if f.State() != Available {
		t.Fatalf("expected Available, got %s", f.State())
	}

	// Update dismissed — SoftwareUpdateVersion cleared
	events := f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion": "",
	})
	assertTransition(t, events, Available, NoUpdate, TriggerNoUpdate)
}

func TestScheduledCancelled(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")

	// Get to scheduled
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion":          "2026.12.3",
		"Version":                        "2026.11.1",
	})
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateScheduledStartTime": "2026-04-20T02:00:00Z",
	})
	if f.State() != Scheduled {
		t.Fatalf("expected Scheduled, got %s", f.State())
	}

	// Schedule cancelled — SoftwareUpdateVersion cleared
	events := f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion": "",
	})
	assertTransition(t, events, Scheduled, NoUpdate, TriggerNoUpdate)
}

func TestFailedThenNewVersion(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")

	// Get to failed state
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion": "2026.12.3",
		"Version":               "2026.11.1",
	})
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateDownloadPercentComplete": float64(50),
	})
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateDownloadPercentComplete": float64(0),
	})
	if f.State() != Failed {
		t.Fatalf("expected Failed, got %s", f.State())
	}

	// New version available after failure
	events := f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion": "2026.12.4",
	})
	assertTransition(t, events, Failed, Available, TriggerVersionAvailable)
}

func TestGlobalVersionChangedFromAvailable(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")

	// Get to available
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion": "2026.12.3",
		"Version":               "2026.11.1",
	})
	if f.State() != Available {
		t.Fatalf("expected Available, got %s", f.State())
	}

	// Version changes directly (e.g., service center update)
	events := f.ProcessSignals(map[string]interface{}{
		"Version": "2026.12.3",
	})
	if len(events) < 1 || events[0].To != Installed {
		t.Fatal("expected transition to Installed on version change from Available")
	}
}

func TestSnapshotContainsContext(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")

	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion":              "2026.12.3",
		"Version":                            "2026.11.1",
		"SoftwareUpdateExpectedDurationMinutes": float64(25),
	})
	f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateDownloadPercentComplete": float64(42),
	})

	snap := f.Snapshot()
	if snap["state"] != "downloading" {
		t.Fatalf("expected state downloading, got %v", snap["state"])
	}
	if snap["target_version"] != "2026.12.3" {
		t.Fatalf("expected target_version 2026.12.3, got %v", snap["target_version"])
	}
	if snap["download_pct"] != float64(42) {
		t.Fatalf("expected download_pct 42, got %v", snap["download_pct"])
	}
	if snap["expected_duration_min"] != 25 {
		t.Fatalf("expected expected_duration_min 25, got %v", snap["expected_duration_min"])
	}
}

func TestTransitionDurationTracked(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")

	events := f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion": "2026.12.3",
		"Version":               "2026.11.1",
	})
	if len(events) == 0 {
		t.Fatal("expected transition")
	}
	if events[0].Duration < 0 {
		t.Fatal("expected non-negative duration")
	}
}

func TestConcurrentAccess(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")
	done := make(chan struct{})

	// Concurrent signal processing
	for i := 0; i < 10; i++ {
		go func(pct float64) {
			defer func() { done <- struct{}{} }()
			f.ProcessSignals(map[string]interface{}{
				"SoftwareUpdateVersion":                 "2026.12.3",
				"Version":                               "2026.11.1",
				"SoftwareUpdateDownloadPercentComplete":  pct,
			})
		}(float64(i * 10))
	}

	for i := 0; i < 10; i++ {
		<-done
	}

	// Should not panic — state may vary depending on goroutine ordering
	state := f.State()
	if state == "" {
		t.Fatal("expected non-empty state")
	}
}

func TestSameVersionNotAvailable(t *testing.T) {
	f := NewUpdateFSM(1, "2026.11.1")

	// SoftwareUpdateVersion matches current — should not trigger Available
	events := f.ProcessSignals(map[string]interface{}{
		"SoftwareUpdateVersion": "2026.11.1",
		"Version":               "2026.11.1",
	})
	if len(events) != 0 {
		t.Fatal("should not transition when update version matches current")
	}
}

func TestValidTransitions(t *testing.T) {
	tests := []struct {
		name    string
		from    State
		trigger Trigger
		wantTo  State
		wantOK  bool
	}{
		{"no_update→available", NoUpdate, TriggerVersionAvailable, Available, true},
		{"available→scheduled", Available, TriggerScheduleSet, Scheduled, true},
		{"available→downloading", Available, TriggerDownloadStarted, Downloading, true},
		{"available→no_update", Available, TriggerNoUpdate, NoUpdate, true},
		{"scheduled→downloading", Scheduled, TriggerDownloadStarted, Downloading, true},
		{"downloading→downloaded", Downloading, TriggerDownloadComplete, Downloaded, true},
		{"downloading→failed", Downloading, TriggerDownloadFailed, Failed, true},
		{"downloaded→installing", Downloaded, TriggerInstallStarted, Installing, true},
		{"installing→installed", Installing, TriggerInstallComplete, Installed, true},
		{"installing→failed", Installing, TriggerInstallFailed, Failed, true},
		{"installed→no_update", Installed, TriggerNoUpdate, NoUpdate, true},
		{"failed→available", Failed, TriggerVersionAvailable, Available, true},

		// Invalid transitions
		{"no_update→downloading (invalid)", NoUpdate, TriggerDownloadStarted, "", false},
		{"available→installed (no direct)", Available, TriggerInstallComplete, "", false},
		{"downloaded→downloaded (invalid)", Downloaded, TriggerDownloadComplete, "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			triggers, ok := validTransitions[tt.from]
			if !ok && tt.wantOK {
				t.Fatal("no transitions defined for state")
			}
			to, ok := triggers[tt.trigger]
			if ok != tt.wantOK {
				t.Fatalf("transition ok=%v, want %v", ok, tt.wantOK)
			}
			if ok && to != tt.wantTo {
				t.Fatalf("transition to=%s, want %s", to, tt.wantTo)
			}
		})
	}
}

func TestStringSignal(t *testing.T) {
	signals := map[string]interface{}{
		"Version":  "2026.11.1",
		"NilValue": nil,
		"IntValue": 42,
	}
	if got := stringSignal(signals, "Version"); got != "2026.11.1" {
		t.Fatalf("expected 2026.11.1, got %s", got)
	}
	if got := stringSignal(signals, "Missing"); got != "" {
		t.Fatalf("expected empty, got %s", got)
	}
	if got := stringSignal(signals, "NilValue"); got != "" {
		t.Fatalf("expected empty for nil, got %s", got)
	}
	if got := stringSignal(signals, "IntValue"); got != "" {
		t.Fatalf("expected empty for int, got %s", got)
	}
}

func TestFloatSignal(t *testing.T) {
	signals := map[string]interface{}{
		"Float":   float64(42.5),
		"Float32": float32(10.0),
		"Int":     int(7),
		"Int64":   int64(99),
		"String":  "not_a_number",
		"Nil":     nil,
	}

	tests := []struct {
		key  string
		want float64
		ok   bool
	}{
		{"Float", 42.5, true},
		{"Float32", 10.0, true},
		{"Int", 7.0, true},
		{"Int64", 99.0, true},
		{"String", 0, false},
		{"Nil", 0, false},
		{"Missing", 0, false},
	}

	for _, tt := range tests {
		t.Run(tt.key, func(t *testing.T) {
			got, ok := floatSignal(signals, tt.key)
			if ok != tt.ok {
				t.Fatalf("ok=%v, want %v", ok, tt.ok)
			}
			if got != tt.want {
				t.Fatalf("got=%v, want %v", got, tt.want)
			}
		})
	}
}

// assertTransition checks that exactly one transition with expected from/to/trigger occurred.
func assertTransition(t *testing.T, events []TransitionEvent, from, to State, trigger Trigger) {
	t.Helper()
	if len(events) != 1 {
		t.Fatalf("expected 1 transition, got %d: %+v", len(events), events)
	}
	ev := events[0]
	if ev.From != from {
		t.Errorf("from=%s, want %s", ev.From, from)
	}
	if ev.To != to {
		t.Errorf("to=%s, want %s", ev.To, to)
	}
	if ev.Trigger != trigger {
		t.Errorf("trigger=%s, want %s", ev.Trigger, trigger)
	}
}
