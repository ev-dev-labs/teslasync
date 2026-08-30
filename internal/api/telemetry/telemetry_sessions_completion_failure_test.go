package telemetry

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestCompleteDriveTransactionFailureKeepsTrackerRetryable(t *testing.T) {
	const vehicleID = int64(7)
	end := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	active := &streamingDrive{
		DriveID:            101,
		VehicleID:          vehicleID,
		StartTime:          end.Add(-time.Hour),
		accumulatedSignals: map[string]interface{}{},
	}
	transactionCalls := 0
	tracker := &TelemetrySessionTracker{
		activeDrives:  map[int64]*streamingDrive{vehicleID: active},
		activeCharges: map[int64]*streamingCharge{},
		transaction: func(context.Context, func(pgx.Tx) error) error {
			transactionCalls++
			return errors.New("database unavailable")
		},
	}

	for attempt := 1; attempt <= 2; attempt++ {
		if completed := tracker.completeDriveLocked(
			context.Background(),
			vehicleID,
			active,
			nil,
			end,
			nil,
		); completed {
			t.Fatalf("attempt %d reported completion after transaction failure", attempt)
		}
		if active.Completing {
			t.Fatalf("attempt %d left Completing set, preventing retry", attempt)
		}
		if got := tracker.activeDrives[vehicleID]; got != active {
			t.Fatalf("attempt %d removed or replaced the active drive tracker", attempt)
		}
	}
	if transactionCalls != 2 {
		t.Fatalf("transaction calls = %d, want 2 retry attempts", transactionCalls)
	}
}

func TestCompleteChargeTransactionFailureKeepsTrackerRetryable(t *testing.T) {
	const vehicleID = int64(8)
	end := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	active := &streamingCharge{
		SessionID:          202,
		VehicleID:          vehicleID,
		StartTime:          end.Add(-time.Hour),
		accumulatedSignals: map[string]interface{}{},
	}
	transactionCalls := 0
	tracker := &TelemetrySessionTracker{
		activeDrives:  map[int64]*streamingDrive{},
		activeCharges: map[int64]*streamingCharge{vehicleID: active},
		transaction: func(context.Context, func(pgx.Tx) error) error {
			transactionCalls++
			return errors.New("database unavailable")
		},
	}

	for attempt := 1; attempt <= 2; attempt++ {
		if completed := tracker.completeChargeLocked(
			context.Background(),
			vehicleID,
			active,
			nil,
			end,
		); completed {
			t.Fatalf("attempt %d reported completion after transaction failure", attempt)
		}
		if active.Completing {
			t.Fatalf("attempt %d left Completing set, preventing retry", attempt)
		}
		if got := tracker.activeCharges[vehicleID]; got != active {
			t.Fatalf("attempt %d removed or replaced the active charge tracker", attempt)
		}
	}
	if transactionCalls != 2 {
		t.Fatalf("transaction calls = %d, want 2 retry attempts", transactionCalls)
	}
}
