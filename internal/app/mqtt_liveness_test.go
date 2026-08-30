package app

import (
	"context"
	"net"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

func TestMQTTBrokerReachable(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	address := listener.Addr().(*net.TCPAddr)

	if !mqttBrokerReachable(address.IP.String(), address.Port) {
		t.Fatal("mqttBrokerReachable() = false for listening TCP endpoint")
	}
	if err := listener.Close(); err != nil {
		t.Fatalf("close listener: %v", err)
	}
	if mqttBrokerReachable(address.IP.String(), address.Port) {
		t.Fatal("mqttBrokerReachable() = true after listener closed")
	}
}

func TestInitTelemetryHandlerFailsWhenMQTTIsUnavailable(t *testing.T) {
	a := &App{Cfg: &config.Config{}}
	a.Cfg.FleetTelemetry.Enabled = true

	err := a.initTelemetryHandler(context.Background())
	if err == nil {
		t.Fatal("initTelemetryHandler() error = nil, want required MQTT failure")
	}
	if !strings.Contains(err.Error(), "MQTT is unavailable") {
		t.Fatalf("initTelemetryHandler() error = %q, want MQTT unavailable context", err)
	}
}
