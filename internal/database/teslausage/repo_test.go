package teslausage

import (
	"math"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

func TestTeslaCycleStartHalfOpenUTCAndOlderCycles(t *testing.T) {
	boundary := time.Unix(100*30*86400, 0).UTC()
	for _, tc := range []struct {
		at, want time.Time
	}{
		{boundary.Add(-time.Nanosecond), boundary.Add(-30 * 24 * time.Hour)},
		{boundary, boundary},
		{boundary.Add(30*24*time.Hour - time.Nanosecond), boundary},
		{boundary.Add(30 * 24 * time.Hour), boundary.Add(30 * 24 * time.Hour)},
		{boundary.Add(-90 * 24 * time.Hour), boundary.Add(-90 * 24 * time.Hour)},
	} {
		if got := TeslaCycleStart(tc.at.In(time.FixedZone("offset", -7*3600))); !got.Equal(tc.want) {
			t.Errorf("cycle start for %v = %v, want %v", tc.at, got, tc.want)
		}
	}
}

func TestTeslaUsageRates(t *testing.T) {
	for _, tc := range []models.TeslaUsageCycle{
		{Signals: 150000}, {Commands: 1000}, {DataRequests: 500}, {Wakes: 50},
	} {
		if got := estimateTeslaUSD(tc); math.Abs(got-1) > 1e-12 {
			t.Errorf("%+v estimated %v, want $1", tc, got)
		}

	}
	if got := estimateTeslaUSD(models.TeslaUsageCycle{
		Signals: 150000, Commands: 1000, DataRequests: 500, Wakes: 50,
	}); got != 4 {
		t.Errorf("combined estimate = %v, want $4", got)
	}
}

func TestObservedHistoryDoesNotInventPreInstallationCycles(t *testing.T) {
	cycles := make([]models.TeslaUsageCycle, 5)
	if got := observedHistory(cycles, 0, -1); len(got) != 0 {
		t.Errorf("empty history = %+v", got)
	}

	if got := observedHistory(cycles, 0, 2); len(got) != 2 {
		t.Errorf("history since earliest observation: got %d cycles, want 2", len(got))
	}
	if got := observedHistory(cycles, 2, 2); len(got) != 0 {
		t.Errorf("history after earliest observation = %+v", got)
	}
}

func TestSignalUsageFingerprintIsStableAcrossQoSRedelivery(t *testing.T) {
	topic := "telemetry/5YJ3E1EA1LF000001/v/Soc"
	payload := []byte(`{"value":75,"ts":"2026-08-22T10:00:00Z"}`)
	firstTopic, firstPayload := signalUsageFingerprints(topic, payload)
	secondTopic, secondPayload := signalUsageFingerprints(topic, append([]byte(nil), payload...))
	if firstTopic != secondTopic || firstPayload != secondPayload {
		t.Fatal("identical source MQTT message must hit the same unique constraint")
	}
	if firstTopic == topic {
		t.Fatal("stored evidence must not expose VIN")
	}
	otherTopic, otherPayload := signalUsageFingerprints(topic+"/other", []byte(`{"value":76}`))
	if otherTopic == firstTopic || otherPayload == firstPayload {
		t.Fatal("distinct source emissions must have distinct fingerprints")
	}
}

func TestBillableTeslaRequestsExcludesUnrelatedRequests(t *testing.T) {
	for _, tc := range []struct{ method, path, want string }{
		{"GET", "https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles/123/vehicle_data?foo=bar", "data"},
		{"POST", "/api/1/vehicles/123/command/door_lock", "command"},
		{"POST", "/api/1/vehicles/123/wake_up", "wake"},
		{"GET", "/api/1/vehicles", ""},
		{"GET", "/api/1/vehicles/123/specs", ""},
		{"POST", "/api/1/vehicles/fleet_telemetry_config", ""},
		{"POST", "/api/v1/vehicles/123/command/door_lock", ""},
		{"GET", "/api/1/vehicles/123/wake_up", ""},
		{"POST", "/api/1/partner_accounts/123/command/door_lock", ""},
	} {
		if got := billableTeslaRequest(tc.method, tc.path); got != tc.want {
			t.Errorf("%s %s = %q, want %q", tc.method, tc.path, got, tc.want)
		}

	}
}

func TestProxyResponsesAreConservative(t *testing.T) {
	command := "/api/1/vehicles/123/command/door_lock"
	for _, tc := range []struct {
		service string
		status  int
		path    string
		want    string
	}{
		{"tesla-api", 400, command, "command"},
		{"tesla-api", 400, "https://command-proxy.example.test" + command, ""},
		{"tesla-api", 200, "https://command-proxy.example.test" + command, "command"},
		{"tesla-api", 400, "https://fleet-api.prd.na.vn.cloud.tesla.com" + command, "command"},
		{"tesla-command-proxy", 400, command, ""},
		{"tesla-command-proxy", 429, command, ""},
		{"tesla-command-proxy", 200, command, "command"},
		{"tesla-command-proxy", 204, "/api/1/vehicles/123/wake_up", ""},
		{"tesla-command-proxy", 500, command, ""},
		{"teslasync-http", 200, command, ""},
	} {
		if got := billableTeslaAudit(tc.service, "POST", tc.path, tc.status); got != tc.want {
			t.Errorf("%s status %d path %s: got %q, want %q", tc.service, tc.status, tc.path, got, tc.want)
		}
	}
}
