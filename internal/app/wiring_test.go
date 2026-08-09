// These tests pin telemetry cutover wiring at the source level. Runtime
// wiring needs live Postgres, Redis, and MQTT dependencies, so these
// guards ensure legacy mqtt.NewSubscriber is absent and every required
// pipeline component is still wired by name.
package app

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// readAppSources concatenates every top-level Go source file in
// internal/app (excluding _test.go) so the source-grep guards stay
// meaningful even if the wiring is later split across files such as
// new.go + telemetry.go.
func readAppSources(t *testing.T) string {
	t.Helper()
	_, here, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller(0) failed; cannot locate test source dir")
	}
	dir := filepath.Dir(here)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read %s: %v", dir, err)
	}
	var b strings.Builder
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		b.WriteString("// === " + name + "\n")
		b.Write(data)
		b.WriteString("\n")
	}
	if b.Len() == 0 {
		t.Fatalf("no internal/app/*.go sources found in %s", dir)
	}
	return b.String()
}

// TestCutover_LegacyMQTTSubscriberRemoved enforces ADR-004 #12 at the
// source level: legacy mqtt.NewSubscriber must not appear in internal/app.
//
// We match `mqtt.NewSubscriber(` with the trailing open-paren so this
// test is robust against e.g. a future `mqtt.NewSubscriberConfig` type
// that should not falsely trip the guard.
func TestCutover_LegacyMQTTSubscriberRemoved(t *testing.T) {
	src := readAppSources(t)
	if strings.Contains(src, "mqtt.NewSubscriber(") {
		t.Fatalf("phase-42a/0050 cutover failed: legacy mqtt.NewSubscriber( still present in internal/app; the hard cutover requires deletion of the legacy MQTT subscriber wiring (ADR-004 #12)")
	}
}

// TestCutover_PipelineSubscriberPresent is the dual of the above: the
// new mqtt.NewPipelineSubscriber MUST appear. Without it the
// fleet-telemetry topic has no consumer and the SI tables receive no
// data.
func TestCutover_PipelineSubscriberPresent(t *testing.T) {
	src := readAppSources(t)
	if !strings.Contains(src, "mqtt.NewPipelineSubscriber(") {
		t.Fatal("phase-42a/0050 cutover incomplete: mqtt.NewPipelineSubscriber( missing from internal/app; without it the fleet-telemetry topic has no subscriber and SI tables receive no data")
	}
}

// TestCutover_PipelineCoreWiringPresent pins the two core constructors:
// normalize.New is the single ingest entry point, and router.New is the
// writer registry. If either is missing, the pipeline is incomplete.
func TestCutover_PipelineCoreWiringPresent(t *testing.T) {
	src := readAppSources(t)
	for _, sym := range []string{"normalize.New(", "router.New("} {
		if !strings.Contains(src, sym) {
			t.Errorf("phase-42a/0050 cutover incomplete: %s missing from internal/app", sym)
		}
	}
}

// TestCutover_AllTwelveWritersWired pins every router.Writer constructor.
// router.New itself rejects an incomplete writer map at process-start
// (see internal/tesla/router/
// router.go:127), but a STARTUP failure is a worse signal than a TEST
// failure: a missing writer here means the binary crash-loops on
// every pod after deploy. Catching it at `go test` keeps the cutover
// honest before commit.
func TestCutover_AllTwelveWritersWired(t *testing.T) {
	src := readAppSources(t)
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
			t.Errorf("phase-42a/0050 cutover incomplete: %s missing from internal/app (router.New would reject this at process-start; catching it earlier here)", sym)
		}
	}
}

// TestCutover_SideEffectsObserverWired pins the bridge from
// normalize.Pipeline payload completion to the legacy 5 cross-cutting
// effects. Without teslapipeline.New the live store, signal history,
// FSM, sessions/alerts, and SSE all stop receiving telemetry-driven
// updates — the system would be silently degraded rather than crashed.
func TestCutover_SideEffectsObserverWired(t *testing.T) {
	src := readAppSources(t)
	if !strings.Contains(src, "teslapipeline.New(") {
		t.Fatal("phase-42a/0050 cutover incomplete: teslapipeline.New( missing from internal/app; without the SideEffectsObserver the live store, signal history, FSM, sessions, alerts, and SSE stop receiving telemetry updates")
	}
}

// TestCutover_ProductionMQTTHelperWired pins the helper that
// constructs a paho client with auto-ack disabled and a DLQ publisher.
// The PipelineSubscriber's manual-ack +
// DLQ contract assumes the underlying client honours
// SetAutoAckDisabled(true); using a different constructor would
// silently break the redelivery semantics.
func TestCutover_ProductionMQTTHelperWired(t *testing.T) {
	src := readAppSources(t)
	if !strings.Contains(src, "mqtt.NewProductionPipelineMQTT(") {
		t.Fatal("phase-42a/0050 cutover incomplete: mqtt.NewProductionPipelineMQTT( missing from internal/app; the PipelineSubscriber requires the auto-ack-disabled paho client + DLQ produced by this helper (added in phase-42a/0040)")
	}
}

func TestChargingPlaceHistoryBackfillRunsWithoutFleetTelemetry(t *testing.T) {
	src := readAppSources(t)
	for _, required := range []string{
		"a.initChargingPlaceHistoryBackfill(ctx)",
		"sessionTracker = apitelem.NewTelemetrySessionTracker(a.DB, a.EventBus, nil, nil)",
		"sessionTracker.StartChargingPlaceHistoryBackfill(ctx)",
	} {
		if !strings.Contains(src, required) {
			t.Errorf("charging-place history backfill wiring missing %q", required)
		}
	}

	initTelemetryAt := strings.Index(src, "if err := a.initTelemetryHandler(ctx); err != nil")
	backfillAt := strings.Index(src, "a.initChargingPlaceHistoryBackfill(ctx)")
	initWorkerAt := strings.Index(src, "a.initWorker(ctx)")
	if initTelemetryAt < 0 || backfillAt < initTelemetryAt || initWorkerAt < backfillAt {
		t.Fatalf(
			"charging-place backfill must start after telemetry initialization and before workers: telemetry=%d backfill=%d worker=%d",
			initTelemetryAt,
			backfillAt,
			initWorkerAt,
		)
	}
}
