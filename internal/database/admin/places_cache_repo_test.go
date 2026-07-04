package admin

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func placeRow(e *PlaceCacheEntry) []any {
	return []any{
		e.ID, e.Latitude, e.Longitude, e.DisplayName, e.Source,
		e.PlaceID, e.BusinessName, e.Category, e.City, e.State,
		e.Country, e.Postcode, e.HitCount, e.LastUsedAt, e.CreatedAt,
	}
}

func samplePlace() *PlaceCacheEntry {
	ts := time.Date(2026, 7, 7, 7, 0, 0, 0, time.UTC)
	return &PlaceCacheEntry{
		ID:           31,
		Latitude:     37.5,
		Longitude:    -122.3,
		DisplayName:  "Home",
		Source:       "nominatim",
		PlaceID:      strp("p-1"),
		BusinessName: nil,
		Category:     strp("residential"),
		City:         strp("Springfield"),
		State:        strp("CA"),
		Country:      strp("US"),
		Postcode:     strp("94000"),
		HitCount:     4,
		LastUsedAt:   ts,
		CreatedAt:    ts,
	}
}

func TestPlacesCacheRepo_FindNearby(t *testing.T) {
	t.Parallel()
	e := samplePlace()

	tests := []struct {
		name    string
		row     pgx.Row
		wantNil bool
		errFrag string
	}{
		{name: "found", row: fakeRow{vals: placeRow(e)}},
		{name: "no rows returns nil,nil", row: noRow(), wantNil: true},
		{name: "wrapped no-rows still returns nil,nil", row: fakeRow{scanErr: fmt.Errorf("scan: %w", pgx.ErrNoRows)}, wantNil: true},
		{name: "other scan error wrapped", row: fakeRow{scanErr: errors.New("boom")}, errFrag: "places_cache find_nearby"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryRowQueue: []pgx.Row{tt.row}}
			repo := &PlacesCacheRepo{pool: pool}
			got, err := repo.FindNearby(context.Background(), 37.5, -122.3, 50)
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				if got != nil {
					t.Errorf("want nil entry on error, got %+v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if tt.wantNil {
				if got != nil {
					t.Fatalf("want nil, got %+v", got)
				}
				return
			}
			if got == nil || got.ID != 31 || got.DisplayName != "Home" || got.HitCount != 4 {
				t.Fatalf("unexpected entry: %+v", got)
			}
			if got.BusinessName != nil {
				t.Errorf("BusinessName should be nil, got %v", *got.BusinessName)
			}
			assertArgsEqual(t, pool.queryRowCalls[0].args, []any{37.5, -122.3, float64(50)})
		})
	}
}

func TestPlacesCacheRepo_Upsert(t *testing.T) {
	t.Parallel()

	t.Run("find-nearby error wrapped", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{scanErr: errors.New("boom")}}}
		repo := &PlacesCacheRepo{pool: pool}
		requireErr(t, repo.Upsert(context.Background(), samplePlace()), "places_cache upsert find_nearby")
	})

	t.Run("existing entry updates in place", func(t *testing.T) {
		t.Parallel()
		existing := samplePlace()
		pool := &fakePool{
			queryRowQueue: []pgx.Row{fakeRow{vals: placeRow(existing)}},
			execQueue:     []execResult{{tag: tag(1)}},
		}
		repo := &PlacesCacheRepo{pool: pool}
		entry := &PlaceCacheEntry{Latitude: 37.5, Longitude: -122.3, DisplayName: "Home2", Source: "s"}
		if err := repo.Upsert(context.Background(), entry); err != nil {
			t.Fatalf("Upsert: %v", err)
		}
		if len(pool.execCalls) != 1 {
			t.Fatalf("want 1 Exec (update), got %d", len(pool.execCalls))
		}
		// update targets the existing row id ($1).
		if pool.execCalls[0].args[0] != int64(31) {
			t.Errorf("update must target existing id 31, got %v", pool.execCalls[0].args[0])
		}
	})

	t.Run("update error wrapped", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{
			queryRowQueue: []pgx.Row{fakeRow{vals: placeRow(samplePlace())}},
			execQueue:     []execResult{{err: errors.New("boom")}},
		}
		repo := &PlacesCacheRepo{pool: pool}
		requireErr(t, repo.Upsert(context.Background(), samplePlace()), "places_cache upsert update")
	})

	t.Run("no nearby entry inserts", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{
			queryRowQueue: []pgx.Row{noRow()},
			execQueue:     []execResult{{tag: tag(1)}},
		}
		repo := &PlacesCacheRepo{pool: pool}
		entry := &PlaceCacheEntry{Latitude: 1, Longitude: 2, DisplayName: "New", Source: "s"}
		if err := repo.Upsert(context.Background(), entry); err != nil {
			t.Fatalf("Upsert: %v", err)
		}
		if len(pool.execCalls) != 1 {
			t.Fatalf("want 1 Exec (insert), got %d", len(pool.execCalls))
		}
		// insert binds latitude/longitude first — 11 columns total.
		if len(pool.execCalls[0].args) != 11 {
			t.Errorf("insert must bind 11 args, got %d", len(pool.execCalls[0].args))
		}
	})

	t.Run("insert error wrapped", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{
			queryRowQueue: []pgx.Row{noRow()},
			execQueue:     []execResult{{err: errors.New("boom")}},
		}
		repo := &PlacesCacheRepo{pool: pool}
		requireErr(t, repo.Upsert(context.Background(), samplePlace()), "places_cache upsert insert")
	})
}

func TestPlacesCacheRepo_IncrementHitCount(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		exec    execResult
		errFrag string
	}{
		{name: "success", exec: execResult{tag: tag(1)}},
		{name: "error wrapped", exec: execResult{err: errors.New("boom")}, errFrag: "places_cache increment_hit_count"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{execQueue: []execResult{tt.exec}}
			repo := &PlacesCacheRepo{pool: pool}
			err := repo.IncrementHitCount(context.Background(), 31)
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if pool.execCalls[0].args[0] != int64(31) {
				t.Errorf("must bind id=31, got %v", pool.execCalls[0].args[0])
			}
		})
	}
}

func TestPlacesCacheRepo_TopPlaces(t *testing.T) {
	t.Parallel()
	e1 := samplePlace()
	e2 := samplePlace()
	e2.ID = 32
	e2.HitCount = 2

	tests := []struct {
		name    string
		script  queryResult
		wantLen int
		errFrag string
	}{
		{name: "success", script: queryResult{rows: newFakeRows([][]any{placeRow(e1), placeRow(e2)})}, wantLen: 2},
		{name: "empty", script: queryResult{rows: newFakeRows(nil)}, wantLen: 0},
		{name: "query error", script: queryResult{err: errors.New("boom")}, errFrag: "places_cache top_places query"},
		{name: "scan error", script: queryResult{rows: &fakeRows{data: [][]any{placeRow(e1)}, cursor: -1, scanErrAt: 0}}, errFrag: "places_cache top_places scan"},
		{name: "iter error", script: queryResult{rows: &fakeRows{data: nil, cursor: -1, scanErrAt: -1, iterErr: errors.New("x")}}, errFrag: "places_cache top_places iter"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryQueue: []queryResult{tt.script}}
			repo := &PlacesCacheRepo{pool: pool}
			got, err := repo.TopPlaces(context.Background(), 10)
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if len(got) != tt.wantLen {
				t.Fatalf("len=%d, want %d", len(got), tt.wantLen)
			}
			if pool.queryCalls[0].args[0] != 10 {
				t.Errorf("limit arg=%v, want 10", pool.queryCalls[0].args[0])
			}
			if tt.wantLen == 2 && (got[0].ID != 31 || got[1].ID != 32) {
				t.Errorf("row ids wrong: %d,%d", got[0].ID, got[1].ID)
			}
		})
	}
}

func TestPlacesCacheRepo_Cleanup(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		exec     execResult
		wantRows int64
		errFrag  string
	}{
		{name: "success returns rows affected", exec: execResult{tag: tag(5)}, wantRows: 5},
		{name: "zero rows", exec: execResult{tag: tag(0)}, wantRows: 0},
		{name: "error wrapped", exec: execResult{err: errors.New("boom")}, errFrag: "places_cache cleanup"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{execQueue: []execResult{tt.exec}}
			repo := &PlacesCacheRepo{pool: pool}
			got, err := repo.Cleanup(context.Background(), 24*time.Hour)
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				if got != 0 {
					t.Errorf("want 0 rows on error, got %d", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got != tt.wantRows {
				t.Fatalf("rows=%d, want %d", got, tt.wantRows)
			}
			// olderThan is applied as a cutoff timestamp in the past.
			cutoff, ok := pool.execCalls[0].args[0].(time.Time)
			if !ok || !cutoff.Before(time.Now()) {
				t.Errorf("cleanup cutoff must be a past timestamp, got %#v", pool.execCalls[0].args[0])
			}
		})
	}
}
