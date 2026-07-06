package postgres

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"github.com/ev-dev-labs/teslasync/internal/domain/trip"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

var tripCols = []string{
	"id", "vehicle_id", "start_latitude", "start_longitude", "end_latitude",
	"end_longitude", "start_address", "end_address", "distance_m", "energy_used_wh",
	"efficiency_wh_per_m", "max_speed_mps", "fsm_state", "started_at", "completed_at",
	"created_at",
}

func tripRow(t trip.Trip) []any {
	return []any{
		t.ID, t.VehicleID, t.StartLatitude, t.StartLongitude, t.EndLatitude,
		t.EndLongitude, t.StartAddress, t.EndAddress, t.DistanceM, t.EnergyUsedWh,
		t.EfficiencyWhPerM, t.MaxSpeedMps, t.FSMState, t.StartedAt, t.CompletedAt,
		t.CreatedAt,
	}
}

func sampleTrip() trip.Trip {
	base := time.Date(2026, 6, 7, 8, 9, 10, 0, time.UTC)
	return trip.Trip{
		ID:               "200",
		VehicleID:        "42",
		StartLatitude:    37.1,
		StartLongitude:   -122.1,
		EndLatitude:      37.9,
		EndLongitude:     -122.9,
		StartAddress:     "Home",
		EndAddress:       "Work",
		DistanceM:        15000,
		EnergyUsedWh:     3000,
		EfficiencyWhPerM: 0.2,
		MaxSpeedMps:      31.3,
		FSMState:         fsm.State("completed"),
		StartedAt:        base,
		CompletedAt:      base.Add(30 * time.Minute),
		CreatedAt:        base,
	}
}

func TestNewTripRepository(t *testing.T) {
	t.Parallel()
	repo := NewTripRepository(lazyPool(t))
	if repo == nil {
		t.Fatal("NewTripRepository returned nil")
	}
	var _ repository.TripRepository = repo
	if _, ok := repo.(*tripRepository); !ok {
		t.Fatalf("returned %T, want *tripRepository", repo)
	}
}

func TestTripRepository_singleRowGetters(t *testing.T) {
	t.Parallel()
	want := sampleTrip()
	row := tripRow(want)

	runGetter(t, "GetByID", row, want, queries.GetTripByID, "200", "scanning trip 200",
		func(pool *fakePool) (*trip.Trip, error) {
			return (&tripRepository{pool: pool}).GetByID(context.Background(), "200")
		})
	runGetter(t, "GetByIDForUpdate", row, want, queries.GetTripByIDForUpdate, "200", "scanning trip 200",
		func(pool *fakePool) (*trip.Trip, error) {
			return (&tripRepository{pool: pool}).GetByIDForUpdate(context.Background(), "200")
		})
}

func TestTripRepository_GetByVehicleID(t *testing.T) {
	t.Parallel()
	t1 := sampleTrip()
	t2 := sampleTrip()
	t2.ID = "201"
	t2.EndAddress = "Gym"
	scenarios := listScenarios(tripCols, tripRow, []trip.Trip{t1, t2},
		"querying trips for vehicle", "collecting trips for vehicle")
	runListMethod(t, scenarios, queries.GetTripsByVehicleID, []any{"42"},
		func(pool *fakePool) ([]trip.Trip, error) {
			return (&tripRepository{pool: pool}).GetByVehicleID(context.Background(), "42")
		})
}

func TestTripRepository_ListByDateRange(t *testing.T) {
	t.Parallel()
	from := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC)
	t1 := sampleTrip()
	t2 := sampleTrip()
	t2.ID = "202"
	scenarios := listScenarios(tripCols, tripRow, []trip.Trip{t1, t2},
		"listing trips for vehicle", "collecting trips for vehicle")
	runListMethod(t, scenarios, queries.ListTripsByDateRange, []any{"42", from, to},
		func(pool *fakePool) ([]trip.Trip, error) {
			return (&tripRepository{pool: pool}).ListByDateRange(context.Background(), "42", from, to)
		})
}

// TestTripRepository_Save_PersistsOnlyOwnedColumns pins the phase-48 bug fix:
// the trips table stores only id/vehicle_id/started_at/ended_at, so Save must
// pass EXACTLY those four positional args (previously it passed 16, leaving
// $3..$13 as un-typeable gap parameters that Postgres rejects at parse time).
func TestTripRepository_Save(t *testing.T) {
	t.Parallel()
	tr := sampleTrip()
	execBoom := errors.New("serialization failure")

	t.Run("success_four_args", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{}
		if err := (&tripRepository{pool: pool}).Save(context.Background(), &tr); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if pool.execN != 1 {
			t.Fatalf("execN = %d, want 1", pool.execN)
		}
		if pool.execSQL != queries.UpsertTrip {
			t.Errorf("SQL = %q, want UpsertTrip", pool.execSQL)
		}
		wantArgs := []any{tr.ID, tr.VehicleID, tr.StartedAt, tr.CompletedAt}
		if !reflect.DeepEqual(pool.execArgs, wantArgs) {
			t.Fatalf("exec args = %v (len %d), want exactly %v", pool.execArgs, len(pool.execArgs), wantArgs)
		}
	})

	t.Run("exec_error", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{execErr: execBoom}
		err := (&tripRepository{pool: pool}).Save(context.Background(), &tr)
		if !errors.Is(err, execBoom) {
			t.Fatalf("error = %v, want wrap of execBoom", err)
		}
		if !strings.Contains(err.Error(), "saving trip 200") {
			t.Errorf("error %q missing context 'saving trip 200'", err)
		}
	})
}
