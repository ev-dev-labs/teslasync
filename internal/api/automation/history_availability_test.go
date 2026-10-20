package automation

import (
	"errors"
	"testing"
	"time"

	dbauto "github.com/ev-dev-labs/teslasync/internal/database/automation"
	automationmodel "github.com/ev-dev-labs/teslasync/internal/models/automation"
)

func TestExecutionTransitionAvailability(t *testing.T) {
	vehicleID := int64(3)
	completedAt := time.Now().UTC()
	for _, tt := range []struct {
		name      string
		vehicleID *int64
		completed *time.Time
		total     int64
		returned  int
		err       error
		want      dbauto.HistorySectionAvailability
	}{
		{"no vehicle", nil, &completedAt, 0, 0, nil, dbauto.HistorySectionAvailability{Status: "not_applicable"}},
		{"failed read", &vehicleID, &completedAt, 0, 0, errors.New("read failed"), dbauto.HistorySectionAvailability{Status: "failed"}},
		{"confirmed empty", &vehicleID, &completedAt, 0, 0, nil, dbauto.HistorySectionAvailability{Status: "available", Complete: true}},
		{"open window", &vehicleID, nil, 0, 0, nil, dbauto.HistorySectionAvailability{Status: "available"}},
		{"cap exactly reached", &vehicleID, &completedAt, 100, 100, nil, dbauto.HistorySectionAvailability{Status: "available", Complete: true, Total: 100}},
		{"truncated", &vehicleID, &completedAt, 101, 100, nil, dbauto.HistorySectionAvailability{Status: "available", Truncated: true, Total: 101}},
		{"populated", &vehicleID, &completedAt, 2, 2, nil, dbauto.HistorySectionAvailability{Status: "available", Complete: true, Total: 2}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			record := &automationmodel.AutomationHistory{VehicleID: tt.vehicleID, CompletedAt: tt.completed}
			if got := executionTransitionAvailability(record, tt.total, tt.returned, tt.err); got != tt.want {
				t.Fatalf("availability = %+v, want %+v", got, tt.want)
			}
		})
	}
}
