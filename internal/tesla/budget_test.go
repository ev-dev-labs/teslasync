package tesla

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"
)

func TestNewBudgetPolicyClampsReserve(t *testing.T) {
	policy := NewBudgetPolicy(0.30, 0.50)
	if policy.DailyLimitMicroUSD != 300_000 {
		t.Fatalf("daily limit = %d, want 300000", policy.DailyLimitMicroUSD)
	}
	if policy.CommandReserveMicroUSD != policy.DailyLimitMicroUSD {
		t.Fatalf("reserve = %d, want %d", policy.CommandReserveMicroUSD, policy.DailyLimitMicroUSD)
	}
}

func TestClassifyBudgetCharge(t *testing.T) {
	tests := []struct {
		name        string
		method      string
		path        string
		category    BudgetCategory
		cost        int64
		usesReserve bool
	}{
		{"vehicle data", http.MethodGet, "/api/1/vehicles/VIN/vehicle_data?endpoints=location_data", BudgetCategoryVehicleData, 2_000, false},
		{"wake", http.MethodPost, "/api/1/vehicles/VIN/wake_up", BudgetCategoryWakeUp, 20_000, true},
		{"command", http.MethodPost, "/api/1/vehicles/VIN/command/door_lock", BudgetCategoryCommand, 1_000, true},
		{"private specs template", http.MethodGet, vehicleSpecsRouteTemplate, BudgetCategoryVehicleSpecs, 100_000, false},
		{"other", http.MethodGet, "/api/1/vehicles", BudgetCategoryOther, 1_000, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ClassifyBudgetCharge(tt.method, tt.path)
			if got.Category != tt.category || got.EstimatedCostMicroUSD != tt.cost || got.UsesCommandReserve != tt.usesReserve {
				t.Fatalf("ClassifyBudgetCharge() = %+v", got)
			}
		})
	}
}

func TestEstimatedCostUSDMatchesClassifiedVehicleDataCost(t *testing.T) {
	charge := ClassifyBudgetCharge(http.MethodGet, "/api/1/vehicles/VIN/vehicle_data")
	got := EstimatedCostUSD(BudgetCategoryVehicleData)
	want := float64(charge.EstimatedCostMicroUSD) / float64(MicroUSDPerUSD)
	if got != want {
		t.Fatalf("EstimatedCostUSD(vehicle_data) = %v, want %v", got, want)
	}
}

func TestMemoryRequestBudgetProtectsCommandReserve(t *testing.T) {
	budget := NewMemoryRequestBudget(BudgetPolicy{
		DailyLimitMicroUSD:     30_000,
		CommandReserveMicroUSD: 5_000,
	})
	ctx := context.Background()
	background := BudgetCharge{
		Category:              BudgetCategoryOther,
		EstimatedCostMicroUSD: 5_000,
	}
	for i := 0; i < 5; i++ {
		if _, err := budget.Reserve(ctx, background); err != nil {
			t.Fatalf("background reservation %d: %v", i, err)
		}
	}
	if _, err := budget.Reserve(ctx, background); !errors.Is(err, ErrBudgetExceeded) {
		t.Fatalf("sixth background reservation error = %v, want ErrBudgetExceeded", err)
	}

	command := BudgetCharge{
		Category:              BudgetCategoryCommand,
		EstimatedCostMicroUSD: 1_000,
		UsesCommandReserve:    true,
	}
	for i := 0; i < 5; i++ {
		if _, err := budget.Reserve(ctx, command); err != nil {
			t.Fatalf("reserved command %d: %v", i, err)
		}
	}
	if _, err := budget.Reserve(ctx, command); !errors.Is(err, ErrBudgetExceeded) {
		t.Fatalf("command beyond daily limit error = %v, want ErrBudgetExceeded", err)
	}
}

func TestMemoryRequestBudgetRejectsInvalidCharges(t *testing.T) {
	budget := NewMemoryRequestBudget(BudgetPolicy{DailyLimitMicroUSD: 30_000})
	for _, charge := range []BudgetCharge{
		{Category: BudgetCategoryOther, EstimatedCostMicroUSD: 0},
		{Category: "unpriced", EstimatedCostMicroUSD: 1_000},
	} {
		if _, err := budget.Reserve(context.Background(), charge); !errors.Is(err, ErrInvalidBudgetCharge) {
			t.Fatalf("Reserve(%+v) error = %v, want ErrInvalidBudgetCharge", charge, err)
		}
	}
}

func TestMemoryRequestBudgetRollsAtUTCMidnight(t *testing.T) {
	now := time.Date(2026, time.August, 28, 23, 59, 0, 0, time.UTC)
	budget := NewMemoryRequestBudget(BudgetPolicy{DailyLimitMicroUSD: 10_000}).(*memoryRequestBudget)
	budget.now = func() time.Time { return now }

	if _, err := budget.Reserve(context.Background(), BudgetCharge{
		Category:              BudgetCategoryOther,
		EstimatedCostMicroUSD: 10_000,
	}); err != nil {
		t.Fatalf("initial reserve: %v", err)
	}
	now = now.Add(2 * time.Minute)
	snapshot, err := budget.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if snapshot.TotalRequests != 0 || snapshot.EstimatedCostMicroUSD != 0 {
		t.Fatalf("rolled snapshot = %+v, want zero usage", snapshot)
	}
	if got, want := snapshot.PeriodStart, time.Date(2026, time.August, 29, 0, 0, 0, 0, time.UTC); !got.Equal(want) {
		t.Fatalf("period start = %v, want %v", got, want)
	}
}

func TestRemainingBackgroundMicroUSDRespectsTotalAndReservedCaps(t *testing.T) {
	tests := []struct {
		name     string
		snapshot BudgetSnapshot
		want     int64
	}{
		{
			name: "background allowance is tighter",
			snapshot: BudgetSnapshot{
				DailyLimitMicroUSD:     300_000,
				CommandReserveMicroUSD: 50_000,
				EstimatedCostMicroUSD:  120_000,
				BackgroundCostMicroUSD: 100_000,
			},
			want: 150_000,
		},
		{
			name: "command overspend makes total cap tighter",
			snapshot: BudgetSnapshot{
				DailyLimitMicroUSD:     300_000,
				CommandReserveMicroUSD: 50_000,
				EstimatedCostMicroUSD:  290_000,
				BackgroundCostMicroUSD: 100_000,
			},
			want: 10_000,
		},
		{
			name: "exhausted total clamps to zero",
			snapshot: BudgetSnapshot{
				DailyLimitMicroUSD:     300_000,
				CommandReserveMicroUSD: 50_000,
				EstimatedCostMicroUSD:  310_000,
				BackgroundCostMicroUSD: 100_000,
			},
			want: 0,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := test.snapshot.RemainingBackgroundMicroUSD(); got != test.want {
				t.Fatalf("RemainingBackgroundMicroUSD() = %d, want %d", got, test.want)
			}
		})
	}
}
