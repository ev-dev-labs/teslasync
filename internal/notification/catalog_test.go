package notification

import "testing"

// TestEventCatalog_EveryEntryHasRequiredFields guards against a future
// entry being added with a blank field — the frontend renders
// Description directly, so a blank one would show an empty toggle
// label.
func TestEventCatalog_EveryEntryHasRequiredFields(t *testing.T) {
	if len(EventCatalog) == 0 {
		t.Fatal("EventCatalog is empty")
	}
	for _, e := range EventCatalog {
		if e.EventType == "" {
			t.Errorf("entry with component=%q has an empty EventType", e.Component)
		}
		if e.Component == "" {
			t.Errorf("entry %q has an empty Component", e.EventType)
		}
		if e.Transition != TransitionOutage && e.Transition != TransitionRecovery {
			t.Errorf("entry %q has an invalid Transition %q", e.EventType, e.Transition)
		}
		if e.Description == "" {
			t.Errorf("entry %q has an empty Description", e.EventType)
		}
	}
}

// TestEventCatalog_EventTypesAreUnique ensures no two entries share the
// same event_type — a duplicate would make the per-channel preference
// toggle ambiguous.
func TestEventCatalog_EventTypesAreUnique(t *testing.T) {
	seen := make(map[string]bool, len(EventCatalog))
	for _, e := range EventCatalog {
		if seen[e.EventType] {
			t.Errorf("duplicate event_type in EventCatalog: %q", e.EventType)
		}
		seen[e.EventType] = true
	}
}

// TestEventCatalog_EveryComponentHasBothTransitions pins the "exactly
// two event types per component" contract documented on EventCatalog.
func TestEventCatalog_EveryComponentHasBothTransitions(t *testing.T) {
	byComponent := make(map[string]map[EventTransition]bool)
	for _, e := range EventCatalog {
		if byComponent[e.Component] == nil {
			byComponent[e.Component] = make(map[EventTransition]bool)
		}
		byComponent[e.Component][e.Transition] = true
	}
	for component, transitions := range byComponent {
		if !transitions[TransitionOutage] {
			t.Errorf("component %q is missing an outage entry", component)
		}
		if !transitions[TransitionRecovery] {
			t.Errorf("component %q is missing a recovery entry", component)
		}
	}
}

// TestEventCatalog_MatchesExportedConstants pins every EventCatalog
// entry's EventType to the exported Event* constant of the same name,
// so a typo in the catalog literal (diverging from the constant the
// health watchdog actually fires) fails loudly here instead of
// silently shipping a frontend toggle that never does anything.
func TestEventCatalog_MatchesExportedConstants(t *testing.T) {
	want := map[string]bool{
		EventTelemetryOutage:   true,
		EventTelemetryRecovery: true,
		EventMQTTOutage:        true,
		EventMQTTRecovery:      true,
		EventDatabaseOutage:    true,
		EventDatabaseRecovery:  true,
		EventRedisOutage:       true,
		EventRedisRecovery:     true,
		EventTeslaAuthOutage:   true,
		EventTeslaAuthRecovery: true,
		EventWorkerOutage:      true,
		EventWorkerRecovery:    true,
	}
	if len(EventCatalog) != len(want) {
		t.Fatalf("EventCatalog has %d entries, want %d (exported Event* constants)", len(EventCatalog), len(want))
	}
	for _, e := range EventCatalog {
		if !want[e.EventType] {
			t.Errorf("EventCatalog entry %q does not match any exported Event* constant", e.EventType)
		}
	}
}

func TestEventTypeDefault(t *testing.T) {
	for _, entry := range EventCatalog {
		got, ok := EventTypeDefault(entry.EventType)
		if !ok {
			t.Fatalf("EventTypeDefault(%q) not found", entry.EventType)
		}
		if got != entry.DefaultEnabled {
			t.Errorf("EventTypeDefault(%q) = %v, want %v", entry.EventType, got, entry.DefaultEnabled)
		}
	}
	if enabled, ok := EventTypeDefault("system.unknown.outage"); ok || enabled {
		t.Errorf("unknown event = (%v, %v), want (false, false)", enabled, ok)
	}
}
