package exports

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

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

func TestExportsBulkUpdate_Delete_HappyPath(t *testing.T) {
	store := &fakeExportBulkStore{existing: map[string]bool{"a": true, "b": true}}
	h := &ExportHandler{bulkOverride: store}

	rec := httptest.NewRecorder()
	h.BulkUpdate(rec, newBulkRequest(t, http.MethodPost, "/export/jobs/bulk",
		map[string]any{"ids": []string{"a", "b", "missing"}, "op": "delete"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
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

func TestParseAsyncExportWindow(t *testing.T) {
	tests := []struct {
		name        string
		start       string
		end         string
		wantErr     bool
		wantNilBoth bool
	}{
		{name: "all time preserves nil bounds", wantNilBoth: true},
		{name: "valid explicit window", start: "2026-08-01", end: "2026-08-26"},
		{name: "invalid start", start: "invalid", wantErr: true},
		{name: "reversed range", start: "2026-08-26", end: "2026-08-01", wantErr: true},
		{name: "long explicit range remains valid", start: "2020-01-01", end: "2026-08-26"},
		{name: "empty absolute range", start: "2026-03-08T08:00:00Z", end: "2026-03-08T08:00:00Z", wantErr: true},
		{name: "reversed absolute range", start: "2026-03-09T07:00:00Z", end: "2026-03-08T08:00:00Z", wantErr: true},
	}

	t.Run("selected clock and legacy compatibility", func(t *testing.T) {
		for _, tt := range []struct {
			name, start, end, wantStart, wantEnd string
		}{
			{"legacy date-only midnight", "2026-08-01", "2026-08-26", "2026-08-01T00:00:00Z", "2026-08-26T00:00:00Z"},
			{"spring DST day", "2026-03-08T08:00:00Z", "2026-03-09T07:00:00Z", "2026-03-08T08:00:00Z", "2026-03-09T06:59:59.999999Z"},
			{"fall DST day", "2026-11-01T07:00:00Z", "2026-11-02T08:00:00Z", "2026-11-01T07:00:00Z", "2026-11-02T07:59:59.999999Z"},
			{"offset instants", "2026-03-08T00:00:00-08:00", "2026-03-09T00:00:00-07:00", "2026-03-08T08:00:00Z", "2026-03-09T06:59:59.999999Z"},
			{"open lower bound", "", "2026-03-09T07:00:00Z", "", "2026-03-09T06:59:59.999999Z"},
			{"open upper bound", "2026-03-08T08:00:00Z", "", "2026-03-08T08:00:00Z", ""},
		} {
			t.Run(tt.name, func(t *testing.T) {
				start, end, err := parseAsyncExportWindow(tt.start, tt.end)
				if err != nil {
					t.Fatal(err)
				}
				for i, got := range []*time.Time{start, end} {
					want := []string{tt.wantStart, tt.wantEnd}[i]
					if want == "" {
						if got != nil {
							t.Fatalf("bound %d = %v, want nil", i, got)
						}
						continue
					}
					expected, err := time.Parse(time.RFC3339Nano, want)
					if err != nil {
						t.Fatal(err)
					}
					if got == nil || !got.Equal(expected) || got.Location() != time.UTC {
						t.Fatalf("bound %d = %v, want UTC %v", i, got, expected)
					}
				}
			})
		}
	})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			start, end, err := parseAsyncExportWindow(tt.start, tt.end)
			if (err != nil) != tt.wantErr {
				t.Fatalf("parseAsyncExportWindow() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			if tt.wantNilBoth {
				if start != nil || end != nil {
					t.Fatalf("all-time bounds = (%v, %v), want (nil, nil)", start, end)
				}
				return
			}
			if start == nil || end == nil {
				t.Fatal("explicit range returned a nil bound")
			}
		})
	}
}

func TestQueuedExportEndpointsRejectInvalidBoundsBeforeQueueing(t *testing.T) {
	h := &ExportHandler{}
	for _, endpoint := range []struct {
		name    string
		handler http.HandlerFunc
	}{
		{"generic", h.SubmitJob},
		{"account", h.SubmitAccountJob},
	} {
		for _, bounds := range []string{
			`"start":"invalid"`,
			`"start":"2026-03-08T08:00:00Z","end":"2026-03-08T08:00:00Z"`,
			`"start":"2026-03-09","end":"2026-03-08"`,
		} {
			t.Run(endpoint.name+"/"+bounds, func(t *testing.T) {
				rec := httptest.NewRecorder()
				req := httptest.NewRequest(http.MethodPost, "/export/jobs",
					strings.NewReader(`{"type":"drives",`+bounds+`}`))
				endpoint.handler(rec, req)
				if rec.Code != http.StatusBadRequest {
					t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
				}
			})
		}
	}
}

func TestSyncExportWindowPreservesLegacyDateSemantics(t *testing.T) {
	tests := []struct {
		name      string
		target    string
		wantStart time.Time
		wantEnd   time.Time
	}{
		{
			name:      "date-only inclusive end-of-day",
			target:    "/export/drives?start=2026-08-26&end=2026-08-26",
			wantStart: time.Date(2026, time.August, 26, 0, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, time.August, 26, 23, 59, 59, 0, time.UTC),
		},
		{
			name:      "RFC3339 exclusive end remains inclusive SQL bound",
			target:    "/export/drives?start=2026-08-26T00:00:00-07:00&end=2026-08-27T00:00:00-07:00",
			wantStart: time.Date(2026, time.August, 26, 0, 0, 0, 0, time.FixedZone("PDT", -7*60*60)),
			wantEnd:   time.Date(2026, time.August, 26, 23, 59, 59, 999999000, time.FixedZone("PDT", -7*60*60)),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.target, nil)
			start, end := syncExportWindow(req)
			if !start.Equal(tt.wantStart) {
				t.Fatalf("start = %s, want %s", start, tt.wantStart)
			}
			if !end.Equal(tt.wantEnd) {
				t.Fatalf("end = %s, want %s", end, tt.wantEnd)
			}
		})
	}
}

func TestDecodeSubmitJobRequestRejectsUnknownAndTrailingData(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "unknown field", body: `{"type":"drives","unknown":true}`},
		{name: "trailing object", body: `{"type":"drives"} {"type":"charging"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/export/jobs", strings.NewReader(tt.body))
			if _, err := decodeSubmitJobRequest(rec, req); err == nil {
				t.Fatal("decodeSubmitJobRequest() error = nil, want validation error")
			}
		})
	}
}
