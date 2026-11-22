package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

type recordingSmartChargingProcessor struct {
	called   bool
	limit    int
	deadline time.Time
	err      error
}

func (p *recordingSmartChargingProcessor) ProcessDue(ctx context.Context, limit int) (int, error) {
	p.called = true
	p.limit = limit
	p.deadline, _ = ctx.Deadline()
	return 1, p.err
}

func TestSmartChargingTickUsesBoundedWorkAndDeadline(t *testing.T) {
	for _, processingErr := range []error{nil, errors.New("synthetic failure")} {
		processor := &recordingSmartChargingProcessor{err: processingErr}
		before := time.Now()
		runSmartChargingTick(context.Background(), processor)
		if !processor.called || processor.limit != 50 {
			t.Fatalf("tick did not use bounded work: %+v", processor)
		}
		if processor.deadline.Before(before) || processor.deadline.After(before.Add(51*time.Second)) {
			t.Fatalf("tick deadline = %v, want at most 50 seconds from %v", processor.deadline, before)
		}
	}
}

func TestSmartChargingWorkerStaysOffWithoutSharedSignals(t *testing.T) {
	for _, cfg := range []*config.Config{
		{},
		{Auth: config.AuthConfig{ForwardAuthHeader: "X-Test-Subject"}},
		{
			Redis:          config.RedisConfig{Enabled: true},
			FleetTelemetry: config.FleetTelemetryConfig{LiveSignalStoreMode: "local"},
		},
		{
			Auth:           config.AuthConfig{ForwardAuthHeader: "X-Test-Subject"},
			Redis:          config.RedisConfig{Enabled: true},
			FleetTelemetry: config.FleetTelemetryConfig{LiveSignalStoreMode: "local"},
		},
	} {
		stop := startSmartCharging(context.Background(), cfg, nil)
		stop()
	}
}

func TestSmartChargingWorkerAllowsOpenModeWithSharedSignals(t *testing.T) {
	for _, header := range []string{"", "X-Test-Subject"} {
		cfg := &config.Config{
			Auth:           config.AuthConfig{ForwardAuthHeader: header},
			Redis:          config.RedisConfig{Enabled: true},
			FleetTelemetry: config.FleetTelemetryConfig{LiveSignalStoreMode: "hybrid"},
		}
		if !smartChargingEnabled(cfg) {
			t.Fatalf("shared signals with auth header %q should enable readiness", header)
		}
	}
}
