package actioncenter

import (
	"context"
	"testing"
	"time"

	fleetdb "github.com/ev-dev-labs/teslasync/internal/database/fleetops"
	fleetmodels "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
)

type fakeWorkOrderLister struct {
	byStatus map[string][]fleetmodels.FleetMaintenanceWorkOrder
	calls    []fleetdb.WorkOrderFilter
}

func (f *fakeWorkOrderLister) ListWorkOrders(
	_ context.Context,
	filter fleetdb.WorkOrderFilter,
) ([]fleetmodels.FleetMaintenanceWorkOrder, int, error) {
	f.calls = append(f.calls, filter)
	items := f.byStatus[filter.Status]
	return items, len(items), nil
}

func TestListActiveWorkOrdersReusesReaderAndAppliesGlobalPriorityBound(t *testing.T) {
	now := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	vehicleID := int64(7)
	lister := &fakeWorkOrderLister{byStatus: map[string][]fleetmodels.FleetMaintenanceWorkOrder{
		"open": {
			{ID: 1, VehicleID: 7, VehicleDisplayName: "Orion", Title: "Open", Status: "open", Severity: "low", UpdatedAt: now},
			{ID: 2, VehicleID: 7, VehicleDisplayName: "Orion", Title: "Soon", Status: "open", Severity: "medium", DueAt: timePointer(now.Add(time.Hour)), UpdatedAt: now},
		},
		"scheduled": {
			{
				ID: 3, VehicleID: 7, VehicleDisplayName: "Orion", Title: "Critical",
				Status: "scheduled", Severity: "critical",
				ScheduledStartAt: timePointer(now.Add(time.Hour)),
				ScheduledEndAt:   timePointer(now.Add(3 * time.Hour)),
				CostMinor:        int64Pointer(12500),
				Currency:         stringPointer("USD"),
				UpdatedAt:        now,
			},
		},
		"in_progress": {
			{ID: 4, VehicleID: 7, VehicleDisplayName: "Orion", Title: "High", Status: "in_progress", Severity: "high", UpdatedAt: now},
		},
	}}
	repository := &SourceRepository{workOrders: lister}

	items, err := repository.ListActiveWorkOrders(context.Background(), &vehicleID, 3)
	if err != nil {
		t.Fatalf("ListActiveWorkOrders() error = %v", err)
	}
	if len(lister.calls) != 3 {
		t.Fatalf("work-order reader calls = %d, want one per active status", len(lister.calls))
	}
	if len(items) != 3 {
		t.Fatalf("items = %d, want global limit 3", len(items))
	}
	if items[0].ID != 3 || items[1].ID != 4 || items[2].ID != 2 {
		t.Fatalf("priority order IDs = [%d %d %d], want [3 4 2]",
			items[0].ID, items[1].ID, items[2].ID)
	}
	if items[0].CostMinor == nil || *items[0].CostMinor != 12500 ||
		items[0].Currency == nil || *items[0].Currency != "USD" ||
		items[0].ScheduledStartAt == nil || items[0].ScheduledEndAt == nil {
		t.Fatalf("projected-impact source fields = %+v", items[0])
	}
	for _, call := range lister.calls {
		if call.VehicleID == nil || *call.VehicleID != vehicleID || call.Limit != 3 {
			t.Fatalf("reader filter = %+v", call)
		}
	}
}

func timePointer(value time.Time) *time.Time { return &value }
func int64Pointer(value int64) *int64        { return &value }
func stringPointer(value string) *string     { return &value }
