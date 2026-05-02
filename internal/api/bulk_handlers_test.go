package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeDriveBulkStore is an in-memory driveBulkStore for handler tests. It
// records each call so tests can assert ordering, and supports an injected
// error to verify rollback semantics.
type fakeDriveBulkStore struct {
	existing       map[int64]bool
	deleteErr      error
	filterCalled   [][]int64
	bulkDeleteArgs [][]int64
}

func (f *fakeDriveBulkStore) FilterExistingIDs(_ context.Context, ids []int64) ([]int64, error) {
	cp := append([]int64(nil), ids...)
	f.filterCalled = append(f.filterCalled, cp)
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if f.existing[id] {
			out = append(out, id)
		}
	}
	return out, nil
}

func (f *fakeDriveBulkStore) BulkDelete(_ context.Context, ids []int64) (int64, error) {
	cp := append([]int64(nil), ids...)
	f.bulkDeleteArgs = append(f.bulkDeleteArgs, cp)
	if f.deleteErr != nil {
		return 0, f.deleteErr
	}
	return int64(len(ids)), nil
}

func newBulkRequest(t *testing.T, method, path string, body any) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if s, ok := body.(string); ok {
			buf.WriteString(s)
		} else if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	return req
}

func decodeBulkResult(t *testing.T, body []byte) bulkOperationResult {
	t.Helper()
	var got bulkOperationResult
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("unmarshal response: %v; body=%s", err, string(body))
	}
	return got
}

func TestDriveBulkDelete_EmptyIDs_Returns400(t *testing.T) {
	store := &fakeDriveBulkStore{existing: map[int64]bool{}}
	h := &DriveHandler{bulkOverride: store}

	rec := httptest.NewRecorder()
	h.BulkDelete(rec, newBulkRequest(t, http.MethodDelete, "/drives/bulk", map[string]any{"ids": []int64{}}))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if len(store.filterCalled) != 0 {
		t.Fatalf("FilterExistingIDs called %d times, want 0 (request must be rejected before repo)", len(store.filterCalled))
	}
}

func TestDriveBulkDelete_TooManyIDs_Returns400(t *testing.T) {
	store := &fakeDriveBulkStore{existing: map[int64]bool{}}
	h := &DriveHandler{bulkOverride: store}

	ids := make([]int64, MaxBulkIDs+1)
	for i := range ids {
		ids[i] = int64(i + 1)
	}

	rec := httptest.NewRecorder()
	h.BulkDelete(rec, newBulkRequest(t, http.MethodDelete, "/drives/bulk", map[string]any{"ids": ids}))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), fmt.Sprint(MaxBulkIDs)) {
		t.Fatalf("error body should mention cap %d; got %q", MaxBulkIDs, rec.Body.String())
	}
}

func TestDriveBulkDelete_MalformedBody_Returns400(t *testing.T) {
	store := &fakeDriveBulkStore{existing: map[int64]bool{}}
	h := &DriveHandler{bulkOverride: store}

	rec := httptest.NewRecorder()
	h.BulkDelete(rec, newBulkRequest(t, http.MethodDelete, "/drives/bulk", "{not-json"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for malformed JSON", rec.Code)
	}
}

func TestDriveBulkDelete_MixedExistingAndMissing_PartialFailure(t *testing.T) {
	store := &fakeDriveBulkStore{
		existing: map[int64]bool{1: true, 3: true},
	}
	h := &DriveHandler{bulkOverride: store}

	rec := httptest.NewRecorder()
	h.BulkDelete(rec, newBulkRequest(t, http.MethodDelete, "/drives/bulk", map[string]any{"ids": []int64{1, 2, 3, 4}}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	got := decodeBulkResult(t, rec.Body.Bytes())
	if got.Deleted == nil || *got.Deleted != 2 {
		t.Fatalf("Deleted = %v, want 2", got.Deleted)
	}
	if len(got.Failed) != 2 {
		t.Fatalf("Failed = %d entries, want 2 (ids 2 and 4)", len(got.Failed))
	}
	wantMissing := map[int64]bool{2: true, 4: true}
	for _, f := range got.Failed {
		if !wantMissing[f.ID] {
			t.Fatalf("Failed contained id=%d, want only 2 and 4", f.ID)
		}
		if f.Reason != "not_found" {
			t.Fatalf("Failed[id=%d].Reason = %q, want 'not_found'", f.ID, f.Reason)
		}
	}
	if len(store.bulkDeleteArgs) != 1 || len(store.bulkDeleteArgs[0]) != 2 {
		t.Fatalf("BulkDelete must be called once with the 2 existing ids; got %#v", store.bulkDeleteArgs)
	}
}

func TestDriveBulkDelete_DeduplicatesIDs(t *testing.T) {
	store := &fakeDriveBulkStore{existing: map[int64]bool{1: true, 2: true}}
	h := &DriveHandler{bulkOverride: store}

	rec := httptest.NewRecorder()
	h.BulkDelete(rec, newBulkRequest(t, http.MethodDelete, "/drives/bulk", map[string]any{"ids": []int64{1, 1, 2, 2, 1}}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(store.filterCalled) != 1 || len(store.filterCalled[0]) != 2 {
		t.Fatalf("FilterExistingIDs must receive deduplicated ids ([1,2]); got %#v", store.filterCalled)
	}
}

func TestDriveBulkDelete_RepoErrorRollsBack(t *testing.T) {
	boom := errors.New("simulated tx failure")
	store := &fakeDriveBulkStore{
		existing:  map[int64]bool{1: true, 2: true},
		deleteErr: boom,
	}
	h := &DriveHandler{bulkOverride: store}

	rec := httptest.NewRecorder()
	h.BulkDelete(rec, newBulkRequest(t, http.MethodDelete, "/drives/bulk", map[string]any{"ids": []int64{1, 2}}))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 on repo error; body=%s", rec.Code, rec.Body.String())
	}
}

// fakeChargingBulkStore mirrors fakeDriveBulkStore for the charging handler.
type fakeChargingBulkStore struct {
	existing       map[int64]bool
	deleteErr      error
	bulkDeleteArgs [][]int64
}

func (f *fakeChargingBulkStore) FilterExistingIDs(_ context.Context, ids []int64) ([]int64, error) {
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if f.existing[id] {
			out = append(out, id)
		}
	}
	return out, nil
}

func (f *fakeChargingBulkStore) BulkDelete(_ context.Context, ids []int64) (int64, error) {
	cp := append([]int64(nil), ids...)
	f.bulkDeleteArgs = append(f.bulkDeleteArgs, cp)
	if f.deleteErr != nil {
		return 0, f.deleteErr
	}
	return int64(len(ids)), nil
}

func TestChargingBulkDelete_HappyPath(t *testing.T) {
	store := &fakeChargingBulkStore{existing: map[int64]bool{10: true, 20: true, 30: true}}
	h := &ChargingHandler{bulkOverride: store}

	rec := httptest.NewRecorder()
	h.BulkDelete(rec, newBulkRequest(t, http.MethodDelete, "/charging/bulk", map[string]any{"ids": []int64{10, 20, 30}}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	got := decodeBulkResult(t, rec.Body.Bytes())
	if got.Deleted == nil || *got.Deleted != 3 {
		t.Fatalf("Deleted = %v, want 3", got.Deleted)
	}
	if len(got.Failed) != 0 {
		t.Fatalf("Failed = %d, want 0 when all ids exist", len(got.Failed))
	}
}

func TestChargingBulkDelete_AllMissing_ReturnsZeroDeleted(t *testing.T) {
	store := &fakeChargingBulkStore{existing: map[int64]bool{}}
	h := &ChargingHandler{bulkOverride: store}

	rec := httptest.NewRecorder()
	h.BulkDelete(rec, newBulkRequest(t, http.MethodDelete, "/charging/bulk", map[string]any{"ids": []int64{1, 2}}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (partial failure is not an error); body=%s", rec.Code, rec.Body.String())
	}
	got := decodeBulkResult(t, rec.Body.Bytes())
	if got.Deleted == nil || *got.Deleted != 0 {
		t.Fatalf("Deleted = %v, want 0", got.Deleted)
	}
	if len(got.Failed) != 2 {
		t.Fatalf("Failed = %d, want 2", len(got.Failed))
	}
	if len(store.bulkDeleteArgs) != 1 || len(store.bulkDeleteArgs[0]) != 0 {
		t.Fatalf("BulkDelete must be invoked with empty slice when no ids exist; got %#v", store.bulkDeleteArgs)
	}
}

// fakeAlertRuleBulkRepo implements alertRuleBulkRepository for handler tests.
type fakeAlertRuleBulkRepo struct {
	existing      map[int64]bool
	updateErr     error
	setEnabledArg []int64
	setEnabledTo  bool
}

func (f *fakeAlertRuleBulkRepo) FilterExistingIDs(_ context.Context, ids []int64) ([]int64, error) {
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if f.existing[id] {
			out = append(out, id)
		}
	}
	return out, nil
}

func (f *fakeAlertRuleBulkRepo) BulkSetEnabled(_ context.Context, ids []int64, enabled bool) (int64, error) {
	f.setEnabledArg = append([]int64(nil), ids...)
	f.setEnabledTo = enabled
	if f.updateErr != nil {
		return 0, f.updateErr
	}
	return int64(len(ids)), nil
}

func TestAlertRulesBulkEnable_NoBulkRepo_Returns503(t *testing.T) {
	h := &AlertHandler{}

	rec := httptest.NewRecorder()
	h.BulkEnableRules(rec, newBulkRequest(t, http.MethodPost, "/alerts/rules/bulk/enable", map[string]any{"ids": []int64{1}}))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 when bulkRuleRepo is unwired", rec.Code)
	}
}

func TestAlertRulesBulkEnable_HappyPath(t *testing.T) {
	repo := &fakeAlertRuleBulkRepo{existing: map[int64]bool{1: true, 2: true}}
	h := &AlertHandler{bulkRuleRepo: repo}

	rec := httptest.NewRecorder()
	h.BulkEnableRules(rec, newBulkRequest(t, http.MethodPost, "/alerts/rules/bulk/enable", map[string]any{"ids": []int64{1, 2, 99}}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	got := decodeBulkResult(t, rec.Body.Bytes())
	if got.Updated == nil || *got.Updated != 2 {
		t.Fatalf("Updated = %v, want 2", got.Updated)
	}
	if len(got.Failed) != 1 || got.Failed[0].ID != 99 || got.Failed[0].Reason != "not_found" {
		t.Fatalf("Failed = %#v, want one entry {99, not_found}", got.Failed)
	}
	if !repo.setEnabledTo {
		t.Fatalf("BulkEnable must set enabled=true; got false")
	}
}

func TestAlertRulesBulkDisable_HappyPath(t *testing.T) {
	repo := &fakeAlertRuleBulkRepo{existing: map[int64]bool{5: true}}
	h := &AlertHandler{bulkRuleRepo: repo}

	rec := httptest.NewRecorder()
	h.BulkDisableRules(rec, newBulkRequest(t, http.MethodPost, "/alerts/rules/bulk/disable", map[string]any{"ids": []int64{5}}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if repo.setEnabledTo {
		t.Fatalf("BulkDisable must set enabled=false; got true")
	}
}

func TestAlertRulesBulk_TooManyIDs_Returns400(t *testing.T) {
	repo := &fakeAlertRuleBulkRepo{existing: map[int64]bool{}}
	h := &AlertHandler{bulkRuleRepo: repo}
	ids := make([]int64, MaxBulkIDs+1)
	for i := range ids {
		ids[i] = int64(i + 1)
	}
	rec := httptest.NewRecorder()
	h.BulkEnableRules(rec, newBulkRequest(t, http.MethodPost, "/alerts/rules/bulk/enable", map[string]any{"ids": ids}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for >MaxBulkIDs", rec.Code)
	}
	if repo.setEnabledArg != nil {
		t.Fatalf("BulkSetEnabled must not be called when request is rejected")
	}
}
