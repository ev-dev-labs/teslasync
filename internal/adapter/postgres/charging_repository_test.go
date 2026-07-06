package postgres

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/domain/charging"
	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

var chargingCols = []string{
	"id", "vehicle_id", "charger_type", "start_battery_pct", "end_battery_pct",
	"energy_added_wh", "max_power_w", "cost_cents", "fsm_state", "sub_fsm_state",
	"charger_connected", "started_at", "completed_at", "created_at",
}

func chargingRow(s charging.ChargingSession) []any {
	return []any{
		s.ID, s.VehicleID, s.ChargerType, s.StartBatteryLevel, s.EndBatteryLevel,
		s.EnergyAddedWh, s.MaxPowerW, s.CostCents, s.FSMState, s.SubFSMState,
		s.ChargerConnected, s.StartedAt, s.CompletedAt, s.CreatedAt,
	}
}

func sampleCharging() charging.ChargingSession {
	base := time.Date(2026, 5, 6, 7, 8, 9, 0, time.UTC)
	return charging.ChargingSession{
		ID:                "100",
		VehicleID:         "42",
		ChargerType:       "supercharger",
		StartBatteryLevel: 20,
		EndBatteryLevel:   80,
		EnergyAddedWh:     42000,
		MaxPowerW:         250000,
		CostCents:         1575,
		FSMState:          fsm.State("completed"),
		SubFSMState:       fsm.State(""),
		ChargerConnected:  false,
		StartedAt:         base,
		CompletedAt:       base.Add(45 * time.Minute),
		CreatedAt:         base,
	}
}

func TestNewChargingSessionRepository(t *testing.T) {
	t.Parallel()
	repo := NewChargingSessionRepository(lazyPool(t))
	if repo == nil {
		t.Fatal("NewChargingSessionRepository returned nil")
	}
	var _ repository.ChargingSessionRepository = repo
	if _, ok := repo.(*chargingRepository); !ok {
		t.Fatalf("returned %T, want *chargingRepository", repo)
	}
}

func TestChargingRepository_singleRowGetters(t *testing.T) {
	t.Parallel()
	want := sampleCharging()
	row := chargingRow(want)

	runGetter(t, "GetByID", row, want, queries.GetChargingSessionByID, "100", "scanning charging session 100",
		func(pool *fakePool) (*charging.ChargingSession, error) {
			return (&chargingRepository{pool: pool}).GetByID(context.Background(), "100")
		})
	runGetter(t, "GetByIDForUpdate", row, want, queries.GetChargingSessionByIDForUpdate, "100", "scanning charging session 100",
		func(pool *fakePool) (*charging.ChargingSession, error) {
			return (&chargingRepository{pool: pool}).GetByIDForUpdate(context.Background(), "100")
		})
}

func TestChargingRepository_GetByVehicleID(t *testing.T) {
	t.Parallel()
	c1 := sampleCharging()
	c2 := sampleCharging()
	c2.ID = "101"
	c2.ChargerType = "ac"
	scenarios := listScenarios(chargingCols, chargingRow, []charging.ChargingSession{c1, c2},
		"querying charging sessions for vehicle", "collecting charging sessions for vehicle")
	runListMethod(t, scenarios, queries.GetChargingSessionsByVehicleID, []any{"42"},
		func(pool *fakePool) ([]charging.ChargingSession, error) {
			return (&chargingRepository{pool: pool}).GetByVehicleID(context.Background(), "42")
		})
}

func TestChargingRepository_ListByDateRange(t *testing.T) {
	t.Parallel()
	from := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 5, 31, 0, 0, 0, 0, time.UTC)
	c1 := sampleCharging()
	c2 := sampleCharging()
	c2.ID = "102"
	scenarios := listScenarios(chargingCols, chargingRow, []charging.ChargingSession{c1, c2},
		"listing charging sessions for vehicle", "collecting charging sessions for vehicle")
	runListMethod(t, scenarios, queries.ListChargingSessionsByDateRange, []any{"42", from, to},
		func(pool *fakePool) ([]charging.ChargingSession, error) {
			return (&chargingRepository{pool: pool}).ListByDateRange(context.Background(), "42", from, to)
		})
}

func TestChargingRepository_Save(t *testing.T) {
	t.Parallel()
	s := sampleCharging()
	execBoom := errors.New("check violation")

	t.Run("success", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{}
		if err := (&chargingRepository{pool: pool}).Save(context.Background(), &s); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if pool.execN != 1 {
			t.Fatalf("execN = %d, want 1", pool.execN)
		}
		if pool.execSQL != queries.UpsertChargingSession {
			t.Errorf("SQL = %q, want UpsertChargingSession", pool.execSQL)
		}
		wantArgs := []any{
			s.ID, s.VehicleID, s.ChargerType, s.StartBatteryLevel, s.EndBatteryLevel,
			s.EnergyAddedWh, s.MaxPowerW, s.CostCents, s.StartedAt, s.CompletedAt,
		}
		if !reflect.DeepEqual(pool.execArgs, wantArgs) {
			t.Errorf("exec args = %v,\nwant %v", pool.execArgs, wantArgs)
		}
	})

	t.Run("exec_error", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{execErr: execBoom}
		err := (&chargingRepository{pool: pool}).Save(context.Background(), &s)
		if !errors.Is(err, execBoom) {
			t.Fatalf("error = %v, want wrap of execBoom", err)
		}
		if !strings.Contains(err.Error(), "saving charging session 100") {
			t.Errorf("error %q missing context 'saving charging session 100'", err)
		}
	})
}
