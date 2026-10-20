package system

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/jackc/pgx/v5"
)

type guardConfigRow struct {
	cfg *vehiclemodel.GuardConfig
	err error
}

func (row guardConfigRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	cfg := row.cfg
	*(dest[0].(*int64)) = cfg.VehicleID
	*(dest[1].(*bool)) = cfg.Enabled
	*(dest[2].(**int64)) = cfg.HomeGeofenceID
	*(dest[3].(*string)) = cfg.Sensitivity
	*(dest[4].(*bool)) = cfg.AutoPanic
	*(dest[5].(*time.Time)) = cfg.CreatedAt
	*(dest[6].(*time.Time)) = cfg.UpdatedAt
	return nil
}

type guardConfigPool struct {
	row   pgx.Row
	query string
	args  []any
	ctx   context.Context
}

func (p *guardConfigPool) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected Query")
}

func (p *guardConfigPool) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	p.ctx, p.query, p.args = ctx, sql, args
	return p.row
}

func TestGuardConfigRepoRoundTrip(t *testing.T) {
	geofence := int64(9)
	expected := &vehiclemodel.GuardConfig{
		VehicleID: 42, Enabled: true, HomeGeofenceID: &geofence,
		Sensitivity: "high", AutoPanic: true,
		CreatedAt: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC),
	}
	pool := &guardConfigPool{row: guardConfigRow{cfg: expected}}
	repo := &GuardRepo{pool: pool}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	got, err := repo.UpsertConfig(ctx, expected)
	if err != nil || *got != *expected {
		t.Fatalf("saved=%+v err=%v", got, err)
	}
	if pool.ctx != ctx || pool.query != guardUpsertConfigSQL || len(pool.args) != 5 ||
		pool.args[0] != int64(42) || pool.args[1] != true || pool.args[2] != &geofence ||
		pool.args[3] != "high" || pool.args[4] != true {
		t.Fatalf("wrong query args/context: %+v", pool)
	}
	got, err = repo.GetConfig(ctx, 42)
	if err != nil || *got != *expected || pool.query != guardConfigSQL || len(pool.args) != 1 || pool.args[0] != int64(42) {
		t.Fatalf("read=%+v err=%v query=%s args=%v", got, err, pool.query, pool.args)
	}
	update := strings.Split(guardUpsertConfigSQL, "DO UPDATE")[1]
	update = strings.Split(update, "RETURNING")[0]
	if strings.Contains(update, "created_at") {
		t.Fatal("update must preserve original created_at")
	}
	if !strings.Contains(guardUpsertConfigSQL, "RETURNING vehicle_id, enabled, home_geofence_id, sensitivity, auto_panic, created_at, updated_at") {
		t.Fatal("upsert must return actual persisted values")
	}
}

func TestGuardConfigRepoNoRowsAndErrors(t *testing.T) {
	pool := &guardConfigPool{row: guardConfigRow{err: pgx.ErrNoRows}}
	repo := &GuardRepo{pool: pool}
	if got, err := repo.GetConfig(context.Background(), 42); got != nil || err != nil {
		t.Fatalf("missing config = %v, %v", got, err)
	}
	failure := errors.New("database unavailable")
	pool.row = guardConfigRow{err: failure}
	if got, err := repo.GetConfig(context.Background(), 42); got != nil || !errors.Is(err, failure) {
		t.Fatalf("read error = %v, %v", got, err)
	}
	if got, err := repo.UpsertConfig(context.Background(), &vehiclemodel.GuardConfig{VehicleID: 42}); got != nil || !errors.Is(err, failure) {
		t.Fatalf("save error = %v, %v", got, err)
	}
	if _, err := repo.GeofenceExists(context.Background(), 9); !errors.Is(err, failure) {
		t.Fatalf("geofence error = %v", err)
	}
}
