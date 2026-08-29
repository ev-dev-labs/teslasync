package actioncenter

import (
	"context"
	"strings"
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

func TestEvidenceQueriesUseCurrentCanonicalSources(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		query     string
		required  []string
		forbidden []string
	}{
		{
			name:  "battery passport",
			query: latestBatteryHealthQuery,
			required: []string{
				"tesla_battery_passport_ledger",
				"DISTINCT ON (ledger.vehicle_id)",
				"ledger.soh_pct",
			},
			forbidden: []string{"battery_snapshots"},
		},
		{
			name:  "drive efficiency",
			query: driveEfficiencyEvidenceQuery,
			required: []string{
				"FROM drives",
				"d.distance_m",
				"d.energy_used_wh",
				"energy_intensity_wh_per_m",
				"baselines.sample_count >= $4",
			},
			forbidden: []string{"distance_mi", "energy_used_kwh"},
		},
		{
			name:  "signal normalization health",
			query: listSignalHealthQuery,
			required: []string{
				"FROM signal_log",
				"normalization_version >= 1",
				"normalization_version IS NULL",
				"normalization_version < 1",
				"sl.ts >= $1",
				"sl.ts <= $2",
				"latest_unversioned_at",
				"normalization_candidates",
				"freshness_candidates",
				"LIMIT GREATEST(($4 + 1) / 2, 1)",
				"LIMIT GREATEST($4 / 2, 1)",
			},
			forbidden: []string{"value_float", "value_text"},
		},
		{
			name:  "active vehicle roster",
			query: listActiveVehiclesQuery,
			required: []string{
				"FROM vehicles v",
				"v.archived_at IS NULL",
				"($1::bigint IS NULL OR v.id = $1)",
				"ORDER BY v.id ASC",
				"LIMIT $2",
			},
			// The roster must NOT inherit the findings feed's evidence
			// filters. Any of these would silently drop healthy,
			// fully-version-attested vehicles from advanced-intelligence
			// evaluation — the exact regression this query exists to fix.
			forbidden: []string{
				"signal_log",
				"normalization_version",
				"latest_unversioned_at",
				"unversioned_sample_count",
				"candidate_ids",
			},
		},
		{
			name:  "command reliability",
			query: commandReliabilityQuery,
			required: []string{
				"FROM command_logs",
				"logs.status IN ('success', 'failed')",
				"latest_failure_at",
			},
		},
		{
			name:  "system incidents",
			query: openSystemIncidentsQuery,
			required: []string{
				"FROM status_incidents",
				"resolved_at IS NULL",
				"affected_components",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			for _, required := range test.required {
				if !strings.Contains(test.query, required) {
					t.Errorf("query missing %q", required)
				}
			}
			for _, forbidden := range test.forbidden {
				if strings.Contains(test.query, forbidden) {
					t.Errorf("query contains forbidden legacy source %q", forbidden)
				}
			}
		})
	}
}

func timePointer(value time.Time) *time.Time { return &value }
func int64Pointer(value int64) *int64        { return &value }
func stringPointer(value string) *string     { return &value }
