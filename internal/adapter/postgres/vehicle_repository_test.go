package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

// Read the applied schema sources, not vehicleCols or the domain db tags:
// those two fixtures can agree with each other while referencing absent columns.
func TestVehicleReadQueries_CanonicalSchema(t *testing.T) {
	t.Parallel()

	baseline, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000142_baseline_typed.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	table := regexp.MustCompile(`(?is)\bCREATE TABLE vehicles\s*\((.*?)\n\);`).FindStringSubmatch(string(baseline))
	if len(table) != 2 {
		t.Fatal("canonical migration has no vehicles table definition")
	}
	columns := make(map[string]bool)
	columnDefinition := regexp.MustCompile(`(?m)^\s*([a-z_][a-z0-9_]*)\s+(?:bigint|text|timestamptz)\b`)
	for _, match := range columnDefinition.FindAllStringSubmatch(table[1], -1) {
		columns[match[1]] = true
	}
	timezone, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000154_vehicles_add_timezone.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for _, match := range regexp.MustCompile(`(?is)\bALTER TABLE vehicles\s+ADD COLUMN IF NOT EXISTS ([a-z_][a-z0-9_]*)\s+text\b`).FindAllStringSubmatch(string(timezone), -1) {
		columns[match[1]] = true
	}
	if len(columns) != 13 || !columns["id"] || !columns["tesla_id"] || !columns["timezone"] {
		t.Fatalf("unexpected canonical vehicles schema: %v", columns)
	}

	cases := []struct {
		name string
		sql  string
	}{
		{"GetVehicleByID", queries.GetVehicleByID},
		{"GetVehicleByVIN", queries.GetVehicleByVIN},
		{"GetAllVehicles", queries.GetAllVehicles},
		{"GetVehicleByIDForUpdate", queries.GetVehicleByIDForUpdate},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			projection := regexp.MustCompile(`(?is)^\s*SELECT\s+(.*?)\s+FROM\s+vehicles\b`).FindStringSubmatch(c.sql)
			if len(projection) != 2 {
				t.Fatal("expected a static vehicles SELECT")
			}
			missing := make(map[string]bool)
			for _, name := range strings.Split(projection[1], ",") {
				name = strings.TrimSpace(name)
				if !columns[name] {
					missing[name] = true
				}
			}
			var missingColumns []string
			for name := range missing {
				missingColumns = append(missingColumns, name)
			}
			sort.Strings(missingColumns)
			if len(missingColumns) > 0 {
				t.Errorf("SELECT references columns absent from canonical vehicles schema: %v", missingColumns)
			}
			// The missing ownership predicate is independently invalid even
			// if every projected column is corrected or the userID is empty.
			predicates := regexp.MustCompile(`(?i)\b([a-z_][a-z0-9_]*)\s*(?:=|IS\s+(?:NOT\s+)?NULL\b)`)
			for _, match := range predicates.FindAllStringSubmatch(c.sql, -1) {
				if !columns[match[1]] {
					t.Errorf("predicate references column absent from canonical vehicles schema: %s", match[1])
				}
			}
			order := regexp.MustCompile(`(?i)\bORDER\s+BY\s+([a-z_][a-z0-9_]*)`).FindStringSubmatch(c.sql)
			if len(order) == 2 && !columns[order[1]] {
				t.Errorf("ORDER BY references column absent from canonical vehicles schema: %s", order[1])
			}
		})
	}
}

// vehicleCols is the projected column order shared by every vehicle SELECT and
// by the hand-written GetByID scan. RowToStructByName maps these to the
// vehicle.Vehicle db tags by name.
var vehicleCols = []string{
	"id", "tesla_id", "vin", "display_name", "model", "option_codes", "color",
	"trim_level", "enrolled_at", "archived_at", "created_at", "updated_at", "timezone",
}

func vehicleRow(v vehicle.Vehicle) []any {
	return []any{
		v.ID, v.TeslaID, v.VIN, v.DisplayName, v.Model, v.OptionCodes, v.Color,
		v.TrimLevel, v.EnrolledAt, v.ArchivedAt, v.CreatedAt, v.UpdatedAt, v.Timezone,
	}
}

func sampleVehicle() vehicle.Vehicle {
	base := time.Date(2026, 2, 3, 4, 5, 6, 0, time.UTC)
	model, color := "Model 3", "red"
	codes, trim := "CODE", "Long Range"
	return vehicle.Vehicle{
		ID:          "42",
		TeslaID:     70042,
		VIN:         "5YJ3E1EA7KF000001",
		DisplayName: "Red One",
		Model:       &model,
		OptionCodes: &codes,
		Color:       &color,
		TrimLevel:   &trim,
		EnrolledAt:  base.Add(-time.Hour),
		CreatedAt:   base,
		UpdatedAt:   base.Add(time.Hour),
		Timezone:    "America/Los_Angeles",
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

func TestVehicleRepository_GetAll(t *testing.T) {
	t.Parallel()

	v1 := sampleVehicle()
	v2 := sampleVehicle()
	v2.ID = "43"
	v2.DisplayName = "Blue Two"
	nullable := v1
	nullable.Model, nullable.OptionCodes, nullable.Color, nullable.TrimLevel = nil, nil, nil, nil
	archived := nullable.UpdatedAt
	nullable.ArchivedAt = &archived
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
			name:    "nullable_metadata_and_archived",
			rows:    &fakeRows{cols: vehicleCols, data: [][]any{vehicleRow(nullable)}},
			wantLen: 1,
			want:    []vehicle.Vehicle{nullable},
		},
		{
			name:       "query_error",
			queryErr:   queryBoom,
			wantErr:    queryBoom,
			wantErrSub: "querying fleet vehicles",
		},
		{
			name:       "collect_scan_error",
			rows:       &fakeRows{cols: vehicleCols, data: [][]any{vehicleRow(v1)}, scanErr: scanBoom, scanErrAt: 1},
			wantErr:    scanBoom,
			wantErrSub: "collecting fleet vehicles",
		},
		{
			name:       "collect_iter_error",
			rows:       &fakeRows{cols: vehicleCols, data: [][]any{vehicleRow(v1)}, iterErr: iterBoom},
			wantErr:    iterBoom,
			wantErrSub: "collecting fleet vehicles",
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{rows: c.rows, queryErr: c.queryErr}
			r := &vehicleRepository{pool: pool}

			got, err := r.GetAll(context.Background())

			if pool.queryN != 1 {
				t.Fatalf("queryN = %d, want 1", pool.queryN)
			}
			if pool.querySQL != queries.GetAllVehicles {
				t.Errorf("SQL = %q, want GetAllVehicles", pool.querySQL)
			}
			if len(pool.queryArgs) != 0 {
				t.Errorf("args = %v, shared fleet has no subject parameter", pool.queryArgs)
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
		v := v
		pool := &fakePool{row: fakeRow{vals: []any{v.ID, v.EnrolledAt, v.CreatedAt, v.UpdatedAt}}}
		r := &vehicleRepository{pool: pool}
		if err := r.Save(context.Background(), &v); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if pool.queryRowN != 1 {
			t.Fatalf("queryRowN = %d, want 1", pool.queryRowN)
		}
		if pool.queryRowSQL != queries.UpdateVehicle {
			t.Errorf("SQL = %q, want UpdateVehicle", pool.queryRowSQL)
		}
		wantArgs := []any{
			v.ID, v.TeslaID, v.VIN, v.DisplayName, v.Model, v.OptionCodes,
			v.Color, v.TrimLevel, v.ArchivedAt, v.Timezone,
		}
		if !reflect.DeepEqual(pool.queryRowArgs, wantArgs) {
			t.Errorf("query args = %v,\nwant %v", pool.queryRowArgs, wantArgs)
		}
	})

	t.Run("exec_error", func(t *testing.T) {
		t.Parallel()
		v := v
		pool := &fakePool{row: fakeRow{err: execBoom}}
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

type canceledVehiclePool struct {
	*fakePool
	received context.Context
}

func (p *canceledVehiclePool) Query(ctx context.Context, _ string, _ ...any) (pgx.Rows, error) {
	p.received = ctx
	return nil, ctx.Err()
}

func (p *canceledVehiclePool) QueryRow(ctx context.Context, _ string, _ ...any) pgx.Row {
	p.received = ctx
	return fakeRow{err: ctx.Err()}
}

func TestVehicleRepository_CanceledContext(t *testing.T) {
	cases := []struct {
		name string
		call func(*vehicleRepository, context.Context) error
	}{
		{"GetAll", func(r *vehicleRepository, ctx context.Context) error { _, err := r.GetAll(ctx); return err }},
		{"GetByID", func(r *vehicleRepository, ctx context.Context) error { _, err := r.GetByID(ctx, "42"); return err }},
		{"GetByVIN", func(r *vehicleRepository, ctx context.Context) error { _, err := r.GetByVIN(ctx, "known"); return err }},
		{"GetByIDForUpdate", func(r *vehicleRepository, ctx context.Context) error {
			_, err := r.GetByIDForUpdate(ctx, "42")
			return err
		}},
		{"Save", func(r *vehicleRepository, ctx context.Context) error { v := sampleVehicle(); return r.Save(ctx, &v) }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			pool := &canceledVehiclePool{fakePool: &fakePool{}}
			err := c.call(&vehicleRepository{pool: pool}, ctx)
			if !errors.Is(err, context.Canceled) || pool.received != ctx {
				t.Fatalf("error=%v forwarded context=%v, want original cancellation", err, pool.received)
			}
		})
	}
}

func TestVehicleRepository_PostgresScalarScanning(t *testing.T) {
	var id string
	var model *string
	codecs := pgtype.NewMap()
	if err := codecs.Scan(pgtype.Int8OID, pgtype.BinaryFormatCode, []byte{0, 0, 0, 0, 0, 0, 0, 42}, &id); err != nil {
		t.Fatalf("PostgreSQL bigint identity into domain string: %v", err)
	}
	if err := codecs.Scan(pgtype.TextOID, pgtype.BinaryFormatCode, nil, &model); err != nil {
		t.Fatalf("PostgreSQL NULL metadata: %v", err)
	}
	if id != "42" || model != nil {
		t.Fatalf("id=%s model=%v, want canonical identity and NULL", id, model)
	}
}

func TestVehicleRepository_NullableMetadata(t *testing.T) {
	want := sampleVehicle()
	want.Model, want.OptionCodes, want.Color, want.TrimLevel = nil, nil, nil, nil
	pool := &fakePool{row: fakeRow{vals: vehicleRow(want)}}
	got, err := (&vehicleRepository{pool: pool}).GetByID(context.Background(), "42")
	if err != nil || !reflect.DeepEqual(got, &want) {
		t.Fatalf("metadata=%+v error=%v, want truthful NULL fields", got, err)
	}
	data, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]json.RawMessage
	if err := json.Unmarshal(data, &wire); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"model", "option_codes", "color", "trim_level", "archived_at"} {
		if string(wire[key]) != "null" {
			t.Errorf("%s=%s, want JSON null", key, wire[key])
		}
	}
	for _, key := range []string{"user_id", "userId", "fsm_state", "fsmState", "odometer_miles", "odometerMiles", "rangeMiles", "batteryLevel", "latitude", "longitude", "year"} {
		if _, exists := wire[key]; exists {
			t.Errorf("static metadata advertises nonexistent ownership/current measurement %s", key)
		}
	}
	if len(wire) != 13 || string(wire["display_name"]) != `"Red One"` || string(wire["tesla_id"]) != "70042" {
		t.Fatalf("canonical metadata wire fields=%s", data)
	}
}

func TestVehicleRepository_SaveIdentity(t *testing.T) {
	t.Run("live_state_rejected_before_metadata_write", func(t *testing.T) {
		cases := []struct {
			name string
			set  func(*vehicle.Vehicle)
		}{
			{"battery", func(v *vehicle.Vehicle) { v.BatteryLevel = 85 }},
			{"lifecycle", func(v *vehicle.Vehicle) { v.FSMState = "online" }},
			{"sub_lifecycle", func(v *vehicle.Vehicle) { v.SubFSMState = "idle" }},
			{"odometer", func(v *vehicle.Vehicle) { v.OdometerMiles = 12 }},
			{"range", func(v *vehicle.Vehicle) { v.RangeMiles = 20 }},
			{"charging", func(v *vehicle.Vehicle) { v.IsCharging = true }},
			{"latitude", func(v *vehicle.Vehicle) { v.Latitude = 37 }},
			{"longitude", func(v *vehicle.Vehicle) { v.Longitude = -122 }},
		}
		for _, c := range cases {
			t.Run(c.name, func(t *testing.T) {
				v := sampleVehicle()
				c.set(&v)
				pool := &fakePool{}
				err := (&vehicleRepository{pool: pool}).Save(context.Background(), &v)
				if !errors.Is(err, domain.ErrValidation) || pool.queryRowN != 0 || pool.execN != 0 {
					t.Fatalf("error=%v queries=%d execs=%d, must not silently discard live state", err, pool.queryRowN, pool.execN)
				}
			})
		}
	})
	t.Run("create_uses_generated_identity", func(t *testing.T) {
		v := sampleVehicle()
		v.ID, v.Timezone = "", ""
		pool := &fakePool{row: fakeRow{vals: []any{"42", v.EnrolledAt, v.CreatedAt, v.UpdatedAt}}}
		err := (&vehicleRepository{pool: pool}).Save(context.Background(), &v)
		if err != nil || v.ID != "42" || v.Timezone != "UTC" {
			t.Fatalf("created metadata=%+v error=%v", v, err)
		}
		if pool.queryRowSQL != queries.UpsertVehicle || len(pool.queryRowArgs) != 8 || pool.queryRowArgs[0] != int64(70042) {
			t.Fatalf("create query=%s args=%v", pool.queryRowSQL, pool.queryRowArgs)
		}
	})
	t.Run("mismatched_identity_not_found", func(t *testing.T) {
		v := sampleVehicle()
		pool := &fakePool{row: fakeRow{err: pgx.ErrNoRows}}
		err := (&vehicleRepository{pool: pool}).Save(context.Background(), &v)
		if !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("error=%v, want identity mismatch to fail closed", err)
		}
		if pool.queryRowSQL != queries.UpdateVehicle || pool.queryRowArgs[0] != "42" || pool.queryRowArgs[1] != int64(70042) {
			t.Fatalf("identity-safe update args=%v", pool.queryRowArgs)
		}
	})
	t.Run("missing_identity_rejected_before_query", func(t *testing.T) {
		for _, v := range []*vehicle.Vehicle{nil, {ID: "42"}} {
			pool := &fakePool{}
			err := (&vehicleRepository{pool: pool}).Save(context.Background(), v)
			if !errors.Is(err, domain.ErrValidation) || pool.queryRowN != 0 || pool.execN != 0 {
				t.Fatalf("error=%v queries=%d execs=%d, want validation before writes", err, pool.queryRowN, pool.execN)
			}
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
