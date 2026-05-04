package database

import (
	"strconv"
	"strings"
	"testing"
	"time"
)

// Regression coverage for buildObservationQuery — the SQL builder behind
// SignalObservationRepo.ListByName and ListByVehicle. The shape of these
// queries is the contract the cold-signal panels (G-force / pedals / cruise
// on /driving-dynamics) and SignalLogWidget rely on; getting it wrong
// renders the panels empty or stale.

func TestBuildObservationQuery_ByNameAlwaysDESC(t *testing.T) {
	q, _ := buildObservationQuery(42, "PedalPosition", time.Time{}, time.Time{}, 1)
	if !strings.Contains(q, "ORDER BY ts DESC") {
		t.Fatalf("expected ORDER BY ts DESC, got %q", q)
	}
	if strings.Contains(q, "ORDER BY ts ASC") {
		t.Fatalf("must not order ASC — frontend reads data[0] as latest: %q", q)
	}
}

func TestBuildObservationQuery_OmitsTimeBoundsWhenZero(t *testing.T) {
	q, args := buildObservationQuery(42, "PedalPosition", time.Time{}, time.Time{}, 1)
	if strings.Contains(q, "ts >=") || strings.Contains(q, "ts <=") || strings.Contains(q, "BETWEEN") {
		t.Fatalf("zero time bounds must omit ts predicates entirely, got %q", q)
	}
	// args = [vehicle_id, signal_name, limit]
	if len(args) != 3 {
		t.Fatalf("expected 3 args [vehicle, signal_name, limit], got %d: %v", len(args), args)
	}
}

func TestBuildObservationQuery_AppliesBothTimeBoundsWhenSet(t *testing.T) {
	from := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 5, 2, 0, 0, 0, 0, time.UTC)
	q, args := buildObservationQuery(42, "PedalPosition", from, to, 100)
	if !strings.Contains(q, "ts >=") || !strings.Contains(q, "ts <=") {
		t.Fatalf("expected both ts >= and ts <= predicates, got %q", q)
	}
	// args = [vehicle_id, signal_name, from, to, limit]
	if len(args) != 5 {
		t.Fatalf("expected 5 args, got %d: %v", len(args), args)
	}
}

func TestBuildObservationQuery_OmitsSignalNameWhenEmpty(t *testing.T) {
	q, args := buildObservationQuery(42, "", time.Time{}, time.Time{}, 20)
	if strings.Contains(q, "signal_name =") {
		t.Fatalf("empty signal_name must omit signal_name predicate, got %q", q)
	}
	// args = [vehicle_id, limit]
	if len(args) != 2 {
		t.Fatalf("expected 2 args [vehicle, limit], got %d: %v", len(args), args)
	}
}

func TestBuildObservationQuery_PlaceholdersAreSequential(t *testing.T) {
	from := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	q, args := buildObservationQuery(42, "PedalPosition", from, time.Time{}, 50)
	// Expect $1=vehicle, $2=signal, $3=from, $4=limit
	for i := 1; i <= len(args); i++ {
		marker := "$" + strconv.Itoa(i)
		if !strings.Contains(q, marker) {
			t.Fatalf("expected placeholder %s in query, got %q", marker, q)
		}
	}
}
