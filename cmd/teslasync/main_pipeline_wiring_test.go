// Phase-42a/0050 hard cutover compile-time + source-level guards.
//
// These tests do NOT exercise the runtime wiring (that requires a live
// pgxpool, redis, MQTT broker, and is covered end-to-end by the
// docker-compose smoke tests). Instead they pin the cutover at the
// SOURCE level: the legacy mqtt.NewSubscriber must NOT appear in
// main.go, and every component the prompt requires must appear by
// name. Honesty Covenant rule 12 forbids "production blind spots" —
// these greps are the testable expression of that rule.
package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// readMainSource loads cmd/teslasync/main.go from disk relative to
// this test file. Using runtime.Caller keeps the test independent of
// the working directory `go test` is invoked with.
func readMainSource(t *testing.T) string {
	t.Helper()
	_, here, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller(0) failed; cannot locate test source dir")
	}
	mainPath := filepath.Join(filepath.Dir(here), "main.go")
	data, err := os.ReadFile(mainPath)
	if err != nil {
		t.Fatalf("read %s: %v", mainPath, err)
	}
	return string(data)
}

// TestCutover_LegacyMQTTSubscriberRemoved enforces ADR-004 #12 (single
// ingest cutover) at the source level: the legacy mqtt.NewSubscriber
// must not appear in main.go after the phase-42a/0050 cutover.
//
// We match `mqtt.NewSubscriber(` with the trailing open-paren so this
// test is robust against e.g. a future `mqtt.NewSubscriberConfig` type
// that should not falsely trip the guard.
func TestCutover_LegacyMQTTSubscriberRemoved(t *testing.T) {
	src := readMainSource(t)
	if strings.Contains(src, "mqtt.NewSubscriber(") {
		t.Fatalf("phase-42a/0050 cutover failed: legacy mqtt.NewSubscriber( still present in cmd/teslasync/main.go; the hard cutover requires deletion of the legacy MQTT subscriber wiring (ADR-004 #12)")
	}
}

// TestCutover_PipelineSubscriberPresent is the dual of the above: the
// new mqtt.NewPipelineSubscriber MUST appear in main.go. Without it
// the fleet-telemetry topic has no consumer and the SI tables receive
// no data.
func TestCutover_PipelineSubscriberPresent(t *testing.T) {
	src := readMainSource(t)
	if !strings.Contains(src, "mqtt.NewPipelineSubscriber(") {
		t.Fatal("phase-42a/0050 cutover incomplete: mqtt.NewPipelineSubscriber( missing from cmd/teslasync/main.go; without it the fleet-telemetry topic has no subscriber and SI tables receive no data")
	}
}

// TestCutover_PipelineCoreWiringPresent pins the two core constructors
// the prompt enumerates explicitly: normalize.New (the single ingest
// entry point) and router.New (the writer registry). If either is
// missing the cutover diff is incomplete.
func TestCutover_PipelineCoreWiringPresent(t *testing.T) {
	src := readMainSource(t)
	for _, sym := range []string{"normalize.New(", "router.New("} {
		if !strings.Contains(src, sym) {
			t.Errorf("phase-42a/0050 cutover incomplete: %s missing from cmd/teslasync/main.go", sym)
		}
	}
}

// TestCutover_AllTwelveWritersWired pins every router.Writer
// constructor the prompt requires. router.New itself rejects an
// incomplete writer map at process-start (see internal/tesla/router/
// router.go:127), but a STARTUP failure is a worse signal than a
// TEST failure: a missing writer here means the binary crash-loops on
// every pod after deploy. Catching it at `go test` keeps the cutover
// honest before commit.
//
// Order matches the writer construction order inside the
// pipelineWriters map literal in main.go, mirrored to make
// drift-detection greppable.
func TestCutover_AllTwelveWritersWired(t *testing.T) {
	src := readMainSource(t)
	required := []string{
		"writers.NewPositionsWriter(",
		"writers.NewClimateWriter(",
		"writers.NewMotorWriter(",
		"writers.NewTirePressureWriter(",
		"writers.NewMediaWriter(",
		"writers.NewSafetyWriter(",
		"writers.NewLocationWriter(",
		"writers.NewSecurityEventWriter(",
		"writers.NewChargingTelemetryWriter(",
		"writers.NewDriveTelemetryWriter(",
		"writers.NewSignalLogWriter(",
		"writers.NewUnitHistoryWriter(",
	}
	if got, want := len(required), 12; got != want {
		t.Fatalf("test self-check: required writer count = %d, want %d", got, want)
	}
	for _, sym := range required {
		if !strings.Contains(src, sym) {
			t.Errorf("phase-42a/0050 cutover incomplete: %s missing from cmd/teslasync/main.go (router.New would reject this at process-start; catching it earlier here)", sym)
		}
	}
}

// TestCutover_SideEffectsObserverWired pins the bridge from
// normalize.Pipeline payload completion to the legacy 5 cross-cutting
// effects. Without teslapipeline.New the live store, signal history,
// FSM, sessions/alerts, and SSE all stop receiving telemetry-driven
// updates — the system would be silently degraded rather than crashed.
func TestCutover_SideEffectsObserverWired(t *testing.T) {
	src := readMainSource(t)
	if !strings.Contains(src, "teslapipeline.New(") {
		t.Fatal("phase-42a/0050 cutover incomplete: teslapipeline.New( missing from cmd/teslasync/main.go; without the SideEffectsObserver the live store, signal history, FSM, sessions, alerts, and SSE stop receiving telemetry updates")
	}
}

// TestCutover_ProductionMQTTHelperWired pins the helper that
// constructs a paho client with auto-ack disabled + a DLQ publisher
// (added in phase-42a/0040). The PipelineSubscriber's manual-ack +
// DLQ contract assumes the underlying client honours
// SetAutoAckDisabled(true); using a different constructor would
// silently break the redelivery semantics.
func TestCutover_ProductionMQTTHelperWired(t *testing.T) {
	src := readMainSource(t)
	if !strings.Contains(src, "mqtt.NewProductionPipelineMQTT(") {
		t.Fatal("phase-42a/0050 cutover incomplete: mqtt.NewProductionPipelineMQTT( missing from cmd/teslasync/main.go; the PipelineSubscriber requires the auto-ack-disabled paho client + DLQ produced by this helper (added in phase-42a/0040)")
	}
}
