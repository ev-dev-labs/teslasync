package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apigeo "github.com/ev-dev-labs/teslasync/internal/api/geofence"
)

// fakeGeofenceBulkStore implements apigeo.BulkStore for handler tests.
type fakeGeofenceBulkStore struct {
	existing  map[int64]bool
	deleteArg []int64
	deleteErr error
}

func (f *fakeGeofenceBulkStore) FilterExistingIDs(_ context.Context, ids []int64) ([]int64, error) {
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if f.existing[id] {
			out = append(out, id)
		}
	}
	return out, nil
}

func (f *fakeGeofenceBulkStore) BulkDelete(_ context.Context, ids []int64) (int64, error) {
	f.deleteArg = append([]int64(nil), ids...)
	if f.deleteErr != nil {
		return 0, f.deleteErr
	}
	return int64(len(ids)), nil
}

func TestGeofencesBulkUpdate_Delete_HappyPath(t *testing.T) {
	store := &fakeGeofenceBulkStore{existing: map[int64]bool{1: true, 2: true}}
	h := apigeo.NewHandler(nil, apigeo.WithBulkStore(store))

	rec := httptest.NewRecorder()
	h.BulkUpdate(rec, newBulkRequest(t, http.MethodPost, "/geofences/bulk",
		map[string]any{"ids": []int64{1, 2, 99}, "op": "delete"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	got := decodeBulkResult(t, rec.Body.Bytes())
	if got.Deleted == nil || *got.Deleted != 2 {
		t.Fatalf("Deleted = %v, want 2", got.Deleted)
	}
	if len(got.Failed) != 1 || got.Failed[0].ID != 99 {
		t.Fatalf("Failed = %#v, want one entry for id=99", got.Failed)
	}
}

func TestGeofencesBulkUpdate_UnknownOp_Returns400(t *testing.T) {
	store := &fakeGeofenceBulkStore{existing: map[int64]bool{1: true}}
	h := apigeo.NewHandler(nil, apigeo.WithBulkStore(store))

	rec := httptest.NewRecorder()
	h.BulkUpdate(rec, newBulkRequest(t, http.MethodPost, "/geofences/bulk",
		map[string]any{"ids": []int64{1}, "op": "enable"}))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for unknown geofence op", rec.Code)
	}
	if store.deleteArg != nil {
		t.Fatalf("BulkDelete must not be invoked when op is rejected")
	}
}

func TestGeofencesBulkUpdate_EmptyIDs_Returns400(t *testing.T) {
	store := &fakeGeofenceBulkStore{existing: map[int64]bool{}}
	h := apigeo.NewHandler(nil, apigeo.WithBulkStore(store))

	rec := httptest.NewRecorder()
	h.BulkUpdate(rec, newBulkRequest(t, http.MethodPost, "/geofences/bulk",
		map[string]any{"ids": []int64{}, "op": "delete"}))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for empty ids", rec.Code)
	}
}

func TestGeofencesBulkUpdate_NoBulkRepo_Returns503(t *testing.T) {
	h := apigeo.NewHandler(nil)

	rec := httptest.NewRecorder()
	h.BulkUpdate(rec, newBulkRequest(t, http.MethodPost, "/geofences/bulk",
		map[string]any{"ids": []int64{1}, "op": "delete"}))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 when bulk repo is unwired", rec.Code)
	}
}
