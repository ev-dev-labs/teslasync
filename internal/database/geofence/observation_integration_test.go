package geofence

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPlaceObservationPersistsAcrossRepoInstances(t *testing.T) {
	dsn := os.Getenv("TESLASYNC_TEST_DB")
	if dsn == "" {
		t.Skip("TESLASYNC_TEST_DB unset")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("test database unreachable: %v", err)
	}
	if _, err := pool.Exec(ctx, `SELECT vehicle_id FROM place_alert_observation LIMIT 0`); err != nil {
		t.Skipf("migration 000252 not applied: %v", err)
	}
	var vehicleID, placeID int64
	unique := time.Now().UnixNano()
	if err := pool.QueryRow(ctx, `INSERT INTO vehicles(tesla_id,vin,display_name) VALUES ($1,$2,$3) RETURNING id`,
		-unique, fmt.Sprintf("TEST-PLACE-%d", unique), "place observation test").Scan(&vehicleID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `DELETE FROM vehicles WHERE id=$1`, vehicleID); err != nil {
			t.Errorf("cleanup vehicle: %v", err)
		}
	})
	if err := pool.QueryRow(ctx, `INSERT INTO geofences(name,polygon_wkt,enabled,origin,needs_review)
		VALUES ($1,$2,true,'manual',false) RETURNING id`,
		fmt.Sprintf("Test place %d", unique), squareWKT(40, -75)).Scan(&placeID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `DELETE FROM geofences WHERE id=$1`, placeID); err != nil {
			t.Errorf("cleanup place: %v", err)
		}
	})

	at := time.Now().UTC()
	repo := NewPlaceObservationRepo(&database.DB{Pool: pool})
	initial, err := repo.Observe(ctx, vehicleID, at, 40, -75)
	if err != nil || len(initial) != 0 {
		t.Fatalf("initial fix: %+v %v", initial, err)
	}
	restarted := NewPlaceObservationRepo(&database.DB{Pool: pool})
	repeated, err := restarted.Observe(ctx, vehicleID, at, 40, -75)
	if err != nil || len(repeated) != 0 {
		t.Fatalf("duplicate fix: %+v %v", repeated, err)
	}
	exit, err := restarted.Observe(ctx, vehicleID, at.Add(time.Second), 41, -75)
	if err != nil || len(exit) != 1 || exit[0].PlaceID != placeID || exit[0].Direction != "exit" {
		t.Fatalf("exit: %+v %v", exit, err)
	}
	enter, err := repo.Observe(ctx, vehicleID, at.Add(2*time.Second), 40, -75)
	if err != nil || len(enter) != 1 || enter[0].PlaceID != placeID || enter[0].Direction != "enter" {
		t.Fatalf("enter after restart: %+v %v", enter, err)
	}
	stale, err := restarted.Observe(ctx, vehicleID, at.Add(time.Second), 41, -75)
	if err != nil || len(stale) != 0 {
		t.Fatalf("stale fix: %+v %v", stale, err)
	}
}
