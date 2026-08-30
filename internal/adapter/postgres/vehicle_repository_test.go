package postgres

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

// vehicleCols is the projected column order shared by every vehicle SELECT and
// by the hand-written GetByID scan. RowToStructByName maps these to the
// vehicle.Vehicle db tags by name.
var vehicleCols = []string{
	"id", "user_id", "vin", "display_name", "model", "year", "color",
	"fsm_state", "sub_fsm_state", "odometer_miles", "battery_level",
	"range_miles", "is_charging", "latitude", "longitude",
	"created_at", "updated_at",
}

func vehicleRow(v vehicle.Vehicle) []any {
	return []any{
		v.ID, v.UserID, v.VIN, v.DisplayName, v.Model, v.Year, v.Color,
		v.FSMState, v.SubFSMState, v.OdometerMiles, v.BatteryLevel,
		v.RangeMiles, v.IsCharging, v.Latitude, v.Longitude,
		v.CreatedAt, v.UpdatedAt,
	}
}

func sampleVehicle() vehicle.Vehicle {
	base := time.Date(2026, 2, 3, 4, 5, 6, 0, time.UTC)
	return vehicle.Vehicle{
		ID:            "42",
		UserID:        "7",
		VIN:           "5YJ3E1EA7KF000001",
		DisplayName:   "Red One",
		Model:         "Model 3",
		Year:          2022,
		Color:         "red",
		FSMState:      fsm.State("online"),
		SubFSMState:   fsm.State("idle"),
		OdometerMiles: 12345.6,
		BatteryLevel:  82,
		RangeMiles:    210.5,
		IsCharging:    true,
		Latitude:      37.42,
		Longitude:     -122.08,
		CreatedAt:     base,
		UpdatedAt:     base.Add(time.Hour),
	}
}

func TestNewVehicleRepository(t *testing.T) {
	t.Parallel()
	repo := NewVehicleRepository(lazyPool(t))
	if repo == nil {
		t.Fatal("NewVehicleRepository returned nil")
	}
	var _ repository.VehicleRepository = repo
	if _, ok := repo.(*vehicleRepository); !ok {
		t.Fatalf("NewVehicleRepository returned %T, want *vehicleRepository", repo)
	}
}

func TestVehicleRepository_singleRowGetters(t *testing.T) {
	t.Parallel()

	want := sampleVehicle()
	scanBoom := errors.New("bad column type")

	cases := []struct {
		name    string
		call    func(r *vehicleRepository, ctx context.Context) (*vehicle.Vehicle, error)
		wantSQL string
		wantArg any
	}{
		{
			name:    "GetByID",
			call:    func(r *vehicleRepository, ctx context.Context) (*vehicle.Vehicle, error) { return r.GetByID(ctx, "42") },
			wantSQL: queries.GetVehicleByID,
			wantArg: "42",
		},
		{
			name: "GetByVIN",
			call: func(r *vehicleRepository, ctx context.Context) (*vehicle.Vehicle, error) {
				return r.GetByVIN(ctx, "5YJ3E1EA7KF000001")
			},
			wantSQL: queries.GetVehicleByVIN,
			wantArg: "5YJ3E1EA7KF000001",
		},
		{
			name: "GetByIDForUpdate",
			call: func(r *vehicleRepository, ctx context.Context) (*vehicle.Vehicle, error) {
				return r.GetByIDForUpdate(ctx, "42")
			},
			wantSQL: queries.GetVehicleByIDForUpdate,
			wantArg: "42",
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name+"/found", func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{row: fakeRow{vals: vehicleRow(want)}}
			r := &vehicleRepository{pool: pool}

			got, err := c.call(r, context.Background())
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if pool.queryRowN != 1 {
				t.Fatalf("queryRowN = %d, want 1", pool.queryRowN)
			}
			if pool.queryRowSQL != c.wantSQL {
				t.Errorf("SQL = %q, want the matching query constant", pool.queryRowSQL)
			}
			if len(pool.queryRowArgs) != 1 || argAt(pool.queryRowArgs, 0) != c.wantArg {
				t.Errorf("args = %v, want [%v]", pool.queryRowArgs, c.wantArg)
			}
			if !reflect.DeepEqual(*got, want) {
				t.Errorf("vehicle = %+v, want %+v", *got, want)
			}
		})

		t.Run(c.name+"/not_found", func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{row: fakeRow{err: pgx.ErrNoRows}}
			r := &vehicleRepository{pool: pool}

			got, err := c.call(r, context.Background())
			if !errors.Is(err, domain.ErrNotFound) {
				t.Fatalf("error = %v, want wrap of domain.ErrNotFound", err)
			}
			if got != nil {
				t.Errorf("vehicle = %+v, want nil on not-found", got)
			}
		})

		t.Run(c.name+"/scan_error", func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{row: fakeRow{err: scanBoom}}
			r := &vehicleRepository{pool: pool}

			got, err := c.call(r, context.Background())
			if !errors.Is(err, scanBoom) {
				t.Fatalf("error = %v, want wrap of scanBoom", err)
			}
			if !strings.Contains(err.Error(), "scanning vehicle") {
				t.Errorf("error %q missing context 'scanning vehicle'", err)
			}
			if got != nil {
				t.Errorf("vehicle = %+v, want nil on error", got)
			}
		})
	}
}

func TestVehicleRepository_GetByUserID(t *testing.T) {
	t.Parallel()

	v1 := sampleVehicle()
	v2 := sampleVehicle()
	v2.ID = "43"
	v2.DisplayName = "Blue Two"
	queryBoom := errors.New("connection reset")
	scanBoom := errors.New("smallint out of range")
	iterBoom := errors.New("stream aborted")

	cases := []struct {
		name       string
		rows       *fakeRows
		queryErr   error
		wantLen    int
		want       []vehicle.Vehicle
		wantErr    error
		wantErrSub string
	}{
		{
			name:    "two_rows",
			rows:    &fakeRows{cols: vehicleCols, data: [][]any{vehicleRow(v1), vehicleRow(v2)}},
			wantLen: 2,
			want:    []vehicle.Vehicle{v1, v2},
		},
		{
			name:    "empty",
			rows:    &fakeRows{cols: vehicleCols, data: nil},
			wantLen: 0,
		},
		{
			name:       "query_error",
			queryErr:   queryBoom,
			wantErr:    queryBoom,
			wantErrSub: "querying vehicles for user",
		},
		{
			name:       "collect_scan_error",
			rows:       &fakeRows{cols: vehicleCols, data: [][]any{vehicleRow(v1)}, scanErr: scanBoom, scanErrAt: 1},
			wantErr:    scanBoom,
			wantErrSub: "collecting vehicles for user",
		},
		{
			name:       "collect_iter_error",
			rows:       &fakeRows{cols: vehicleCols, data: [][]any{vehicleRow(v1)}, iterErr: iterBoom},
			wantErr:    iterBoom,
			wantErrSub: "collecting vehicles for user",
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{rows: c.rows, queryErr: c.queryErr}
			r := &vehicleRepository{pool: pool}

			got, err := r.GetByUserID(context.Background(), "7")

			if pool.queryN != 1 {
				t.Fatalf("queryN = %d, want 1", pool.queryN)
			}
			if pool.querySQL != queries.GetVehiclesByUserID {
				t.Errorf("SQL = %q, want GetVehiclesByUserID", pool.querySQL)
			}
			if len(pool.queryArgs) != 1 || argAt(pool.queryArgs, 0) != "7" {
				t.Errorf("args = %v, want [7]", pool.queryArgs)
			}

			if c.wantErr != nil {
				if !errors.Is(err, c.wantErr) {
					t.Fatalf("error = %v, want wrap of %v", err, c.wantErr)
				}
				if !strings.Contains(err.Error(), c.wantErrSub) {
					t.Errorf("error %q missing context %q", err, c.wantErrSub)
				}
				if got != nil {
					t.Errorf("result = %v, want nil on error", got)
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != c.wantLen {
				t.Fatalf("len = %d, want %d", len(got), c.wantLen)
			}
			for i := range c.want {
				if !reflect.DeepEqual(got[i], c.want[i]) {
					t.Errorf("result[%d] = %+v, want %+v", i, got[i], c.want[i])
				}
			}
			if c.rows != nil && !c.rows.closed {
				t.Error("rows.Close() was not called")
			}
		})
	}
}

func TestVehicleRepository_Save(t *testing.T) {
	t.Parallel()
	v := sampleVehicle()
	execBoom := errors.New("unique violation")

	t.Run("success", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{}
		r := &vehicleRepository{pool: pool}
		if err := r.Save(context.Background(), &v); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if pool.execN != 1 {
			t.Fatalf("execN = %d, want 1", pool.execN)
		}
		if pool.execSQL != queries.UpsertVehicle {
			t.Errorf("SQL = %q, want UpsertVehicle", pool.execSQL)
		}
		wantArgs := []any{
			v.ID, v.UserID, v.VIN, v.DisplayName, v.Model, v.Year, v.Color,
			v.FSMState, v.SubFSMState, v.OdometerMiles, v.BatteryLevel,
			v.RangeMiles, v.IsCharging, v.Latitude, v.Longitude,
			v.CreatedAt, v.UpdatedAt,
		}
		if !reflect.DeepEqual(pool.execArgs, wantArgs) {
			t.Errorf("exec args = %v,\nwant %v", pool.execArgs, wantArgs)
		}
	})

	t.Run("exec_error", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{execErr: execBoom}
		r := &vehicleRepository{pool: pool}
		err := r.Save(context.Background(), &v)
		if !errors.Is(err, execBoom) {
			t.Fatalf("error = %v, want wrap of execBoom", err)
		}
		if !strings.Contains(err.Error(), "saving vehicle 42") {
			t.Errorf("error %q missing context 'saving vehicle 42'", err)
		}
	})
}

func TestVehicleRepository_Delete(t *testing.T) {
	t.Parallel()
	execBoom := errors.New("fk violation")

	cases := []struct {
		name       string
		tag        string
		execErr    error
		wantErr    error
		wantErrSub string
	}{
		{name: "deleted", tag: "DELETE 1"},
		{name: "not_found", tag: "DELETE 0", wantErr: domain.ErrNotFound, wantErrSub: "vehicle 42"},
		{name: "exec_error", execErr: execBoom, wantErr: execBoom, wantErrSub: "deleting vehicle 42"},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{tag: newCommandTag(c.tag), execErr: c.execErr}
			r := &vehicleRepository{pool: pool}

			err := r.Delete(context.Background(), "42")

			if pool.execN != 1 {
				t.Fatalf("execN = %d, want 1", pool.execN)
			}
			if pool.execSQL != queries.DeleteVehicle {
				t.Errorf("SQL = %q, want DeleteVehicle", pool.execSQL)
			}
			if len(pool.execArgs) != 1 || argAt(pool.execArgs, 0) != "42" {
				t.Errorf("args = %v, want [42]", pool.execArgs)
			}

			if c.wantErr != nil {
				if !errors.Is(err, c.wantErr) {
					t.Fatalf("error = %v, want wrap of %v", err, c.wantErr)
				}
				if !strings.Contains(err.Error(), c.wantErrSub) {
					t.Errorf("error %q missing context %q", err, c.wantErrSub)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
