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

// fakeExportBulkStore implements exportBulkStore for handler tests.
type fakeExportBulkStore struct {
	existing  map[string]bool
	deleteArg []string
	deleteErr error
}

func (f *fakeExportBulkStore) FilterExistingStringIDs(_ context.Context, ids []string) ([]string, error) {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if f.existing[id] {
			out = append(out, id)
		}
	}
	return out, nil
}

func (f *fakeExportBulkStore) BulkDeleteByIDs(_ context.Context, ids []string) (int64, error) {
	f.deleteArg = append([]string(nil), ids...)
	if f.deleteErr != nil {
		return 0, f.deleteErr
	}
	return int64(len(ids)), nil
}

func TestExportsBulkUpdate_Delete_HappyPath(t *testing.T) {
	store := &fakeExportBulkStore{existing: map[string]bool{"a": true, "b": true}}
	h := &ExportHandler{bulkOverride: store}

	rec := httptest.NewRecorder()
	h.BulkUpdate(rec, newBulkRequest(t, http.MethodPost, "/export/jobs/bulk",
		map[string]any{"ids": []string{"a", "b", "missing"}, "op": "delete"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	// We can't decode into bulkOperationResult (different ID type), but we
	// can check the response shape contains "deleted":2 and missing in failed.
	body := rec.Body.String()
	if !strings.Contains(body, `"deleted":2`) {
		t.Fatalf("expected deleted=2 in body; got %q", body)
	}
	if !strings.Contains(body, `"missing"`) {
		t.Fatalf("expected missing id in failed[]; got %q", body)
	}
}

func TestExportsBulkUpdate_UnknownOp_Returns400(t *testing.T) {
	store := &fakeExportBulkStore{existing: map[string]bool{"a": true}}
	h := &ExportHandler{bulkOverride: store}

	rec := httptest.NewRecorder()
	h.BulkUpdate(rec, newBulkRequest(t, http.MethodPost, "/export/jobs/bulk",
		map[string]any{"ids": []string{"a"}, "op": "archive"}))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for unknown export op", rec.Code)
	}
	if store.deleteArg != nil {
		t.Fatalf("BulkDeleteByIDs must not be invoked when op is rejected")
	}
}

func TestExportsBulkUpdate_EmptyIDs_Returns400(t *testing.T) {
	store := &fakeExportBulkStore{existing: map[string]bool{}}
	h := &ExportHandler{bulkOverride: store}

	rec := httptest.NewRecorder()
	h.BulkUpdate(rec, newBulkRequest(t, http.MethodPost, "/export/jobs/bulk",
		map[string]any{"ids": []string{}, "op": "delete"}))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for empty ids", rec.Code)
	}
}

func TestExportsBulkUpdate_TooManyIDs_Returns400(t *testing.T) {
	store := &fakeExportBulkStore{existing: map[string]bool{}}
	h := &ExportHandler{bulkOverride: store}
	ids := make([]string, MaxBulkExportIDs+1)
	for i := range ids {
		ids[i] = "uuid-" + string(rune('a'+i%26))
	}
	rec := httptest.NewRecorder()
	h.BulkUpdate(rec, newBulkRequest(t, http.MethodPost, "/export/jobs/bulk",
		map[string]any{"ids": ids, "op": "delete"}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for >MaxBulkExportIDs", rec.Code)
	}
}

func TestExportsBulkUpdate_NoBulkRepo_Returns503(t *testing.T) {
	h := &ExportHandler{}

	rec := httptest.NewRecorder()
	h.BulkUpdate(rec, newBulkRequest(t, http.MethodPost, "/export/jobs/bulk",
		map[string]any{"ids": []string{"a"}, "op": "delete"}))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 when bulk repo is unwired", rec.Code)
	}
}

func TestExportsBulkUpdate_DeduplicatesIDs(t *testing.T) {
	store := &fakeExportBulkStore{existing: map[string]bool{"a": true, "b": true}}
	h := &ExportHandler{bulkOverride: store}

	rec := httptest.NewRecorder()
	h.BulkUpdate(rec, newBulkRequest(t, http.MethodPost, "/export/jobs/bulk",
		map[string]any{"ids": []string{"a", "a", "b", "b", "a"}, "op": "delete"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(store.deleteArg) != 2 {
		t.Fatalf("BulkDeleteByIDs received %#v, want 2 unique ids", store.deleteArg)
	}
}
