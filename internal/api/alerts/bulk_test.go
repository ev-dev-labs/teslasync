package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/apibulk"
)

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

func decodeBulkResult(t *testing.T, body []byte) apibulk.OperationResult {
	t.Helper()
	var got apibulk.OperationResult
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("unmarshal response: %v; body=%s", err, string(body))
	}
	return got
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
	ids := make([]int64, apibulk.MaxIDs+1)
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
