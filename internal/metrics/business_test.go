package metrics

import (
	"testing"
	"time"

	dto "github.com/prometheus/client_model/go"
)

func gaugeValue(t *testing.T, lvs ...string) float64 {
	t.Helper()
	g, err := TelemetryLagSeconds.GetMetricWithLabelValues(lvs...)
	if err != nil {
		t.Fatalf("GetMetricWithLabelValues(%v): %v", lvs, err)
	}
	var pb dto.Metric
	if err := g.Write(&pb); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if pb.GetGauge() == nil {
		return 0
	}
	return pb.GetGauge().GetValue()
}

func TestRecordSignalReceived_AndRefresh(t *testing.T) {
	const vid = "test-vehicle-1"
	now := time.Now()
	RecordSignalReceived(vid, now.Add(-30*time.Second))

	refreshTelemetryLag(now)

	got := gaugeValue(t, vid)
	if got < 29 || got > 31 {
		t.Errorf("telemetry_lag_seconds=%v want ~30", got)
	}
}

func TestRecordSignalReceived_EmptyVehicleIDSkipped(t *testing.T) {
	RecordSignalReceived("", time.Now())
}

func TestSetTeslaAPICircuitBreakerState(t *testing.T) {
	SetTeslaAPICircuitBreakerState("vehicles/list", CircuitBreakerOpen)

	g, err := TeslaAPICircuitBreakerState.GetMetricWithLabelValues("vehicles/list")
	if err != nil {
		t.Fatalf("GetMetricWithLabelValues: %v", err)
	}
	var pb dto.Metric
	if err := g.Write(&pb); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if got := pb.GetGauge().GetValue(); got != 1.0 {
		t.Errorf("breaker state=%v want 1 (open)", got)
	}

	SetTeslaAPICircuitBreakerState("vehicles/list", CircuitBreakerClosed)
	g2, _ := TeslaAPICircuitBreakerState.GetMetricWithLabelValues("vehicles/list")
	var pb2 dto.Metric
	_ = g2.Write(&pb2)
	if got := pb2.GetGauge().GetValue(); got != 0.0 {
		t.Errorf("breaker state=%v want 0 (closed)", got)
	}
}

func TestSetFSMStateCorrectness_ClampedTo01(t *testing.T) {
	cases := []struct {
		in   float64
		want float64
	}{
		{-0.5, 0.0},
		{0.0, 0.0},
		{0.5, 0.5},
		{1.0, 1.0},
		{1.5, 1.0},
	}
	for i, tc := range cases {
		vid := "vehicle-" + time.Now().Format("150405.000") + "-" + string(rune('a'+i))
		SetFSMStateCorrectness(vid, tc.in)
		g, _ := FSMStateCorrectnessRatio.GetMetricWithLabelValues(vid)
		var pb dto.Metric
		_ = g.Write(&pb)
		if got := pb.GetGauge().GetValue(); got != tc.want {
			t.Errorf("ratio in=%v got=%v want=%v", tc.in, got, tc.want)
		}
	}
}

func TestSetNormalizePipelineThroughput(t *testing.T) {
	SetNormalizePipelineThroughput(123.45)
	var pb dto.Metric
	if err := NormalizePipelineThroughput.Write(&pb); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if got := pb.GetGauge().GetValue(); got != 123.45 {
		t.Errorf("throughput=%v want 123.45", got)
	}
}

func TestMQTTConsumerBacklog_IncDec(t *testing.T) {
	var before dto.Metric
	if err := MQTTConsumerBacklog.Write(&before); err != nil {
		t.Fatalf("Write before: %v", err)
	}
	beforeVal := before.GetGauge().GetValue()

	IncMQTTConsumerBacklog()
	IncMQTTConsumerBacklog()
	IncMQTTConsumerBacklog()
	DecMQTTConsumerBacklog()

	var after dto.Metric
	if err := MQTTConsumerBacklog.Write(&after); err != nil {
		t.Fatalf("Write after: %v", err)
	}
	if got := after.GetGauge().GetValue(); got-beforeVal != 2 {
		t.Errorf("backlog delta=%v want 2 (3 inc - 1 dec)", got-beforeVal)
	}

	DecMQTTConsumerBacklog()
	DecMQTTConsumerBacklog()
}

func TestStartTelemetryLagRefresher_RunsAndStops(t *testing.T) {
	const vid = "refresher-vehicle"
	RecordSignalReceived(vid, time.Now().Add(-5*time.Second))

	stop := make(chan struct{})
	StartTelemetryLagRefresher(20*time.Millisecond, stop)
	defer close(stop)

	deadline := time.After(2 * time.Second)
	for {
		select {
		case <-deadline:
			t.Fatalf("refresher never wrote a sample")
		default:
		}
		if v := gaugeValue(t, vid); v >= 5 {
			return
		}
		time.Sleep(30 * time.Millisecond)
	}
}
