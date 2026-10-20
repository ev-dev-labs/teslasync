package maintenance

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// scopedVehicleReader rejects a first-vehicle lookup when selection is explicit.
type scopedVehicleReader struct {
	id      int64
	err     error
	gotSQL  string
	gotArgs []any
	gotCtx  context.Context
	calls   int
}

func (f *scopedVehicleReader) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	f.calls++
	f.gotCtx, f.gotSQL, f.gotArgs = ctx, query, args
	return fakeRow{scan: func(dest ...any) error {
		if f.err != nil {
			return f.err
		}
		*dest[0].(*int64) = f.id
		return nil
	}}
}

func TestList_SelectedVehicle(t *testing.T) {
	reader := &scopedVehicleReader{id: 42}
	cache := &fakeSignalReader{signals: map[string]interface{}{"Odometer": float32(123000)}}
	h := &Handler{db: reader, redisCache: cache}
	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/maintenance?vehicle_id=42", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if reader.calls != 1 || reader.gotSQL != "SELECT id FROM vehicles WHERE id = $1" {
		t.Fatalf("lookup calls=%d sql=%q", reader.calls, reader.gotSQL)
	}
	if !reflect.DeepEqual(reader.gotArgs, []any{int64(42)}) {
		t.Fatalf("args=%v, want selected ID 42", reader.gotArgs)
	}
	if _, ok := reader.gotCtx.Deadline(); !ok {
		t.Fatal("selected lookup missing request timeout")
	}
	if cache.calls != 1 || cache.gotVeh != 42 || cache.gotCtx != reader.gotCtx {
		t.Fatalf("cache calls=%d vehicle=%d; context must propagate", cache.calls, cache.gotVeh)
	}
	items := decodeItems(t, rec.Body.Bytes())
	if len(items) != 8 {
		t.Fatalf("items=%d, want unchanged full schedule", len(items))
	}
	for _, item := range items {
		if item["vehicle_id"] != float64(42) || item["current_mileage"] != float64(123000) {
			t.Fatalf("wrong selected-vehicle projection: %v", item)
		}
	}
	if items[1]["due_mileage"] != float64(133000) || items[1]["interval_miles"] != float64(10000) {
		t.Fatalf("SI interval changed: %v", items[1])
	}
}

func TestList_InvalidSelectedVehicle(t *testing.T) {
	for _, raw := range []string{"0", "-1", "abc", "1.5", "9223372036854775808", "1%20OR%201=1"} {
		t.Run(raw, func(t *testing.T) {
			reader := &scopedVehicleReader{id: 42}
			cache := &fakeSignalReader{}
			h := &Handler{db: reader, redisCache: cache}
			rec := httptest.NewRecorder()
			h.List(rec, httptest.NewRequest(http.MethodGet, "/maintenance?vehicle_id="+raw, nil))
			if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "vehicle_id must be a positive integer") {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			if reader.calls != 0 || cache.calls != 0 {
				t.Fatal("invalid scope performed I/O")
			}
		})
	}
}

func TestList_SelectedVehicleUnavailableDoesNotFallback(t *testing.T) {
	for _, err := range []error{pgx.ErrNoRows, errors.New("database unavailable")} {
		t.Run(err.Error(), func(t *testing.T) {
			reader := &scopedVehicleReader{err: err}
			cache := &fakeSignalReader{}
			h := &Handler{db: reader, redisCache: cache}
			rec := httptest.NewRecorder()
			h.List(rec, httptest.NewRequest(http.MethodGet, "/maintenance?vehicle_id=42", nil))
			if rec.Code != http.StatusOK || len(decodeItems(t, rec.Body.Bytes())) != 0 {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			if reader.calls != 1 || len(reader.gotArgs) != 1 || cache.calls != 0 {
				t.Fatal("unavailable selection fell back or read another vehicle")
			}
		})
	}
}

func TestList_EmptySelectionRetainsUnscopedBehavior(t *testing.T) {
	reader := rowReturningID(7)
	h := &Handler{db: reader}
	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/maintenance?vehicle_id=", nil))
	if rec.Code != http.StatusOK || reader.gotSQL != "SELECT id FROM vehicles ORDER BY id LIMIT 1" {
		t.Fatalf("status=%d sql=%q", rec.Code, reader.gotSQL)
	}
	items := decodeItems(t, rec.Body.Bytes())
	if len(items) != 8 || items[0]["vehicle_id"] != float64(7) {
		t.Fatalf("unscoped behavior changed: %v", items)
	}
}

func TestRecords_SelectedVehicleStillReturnsEmptyHistory(t *testing.T) {
	reader := &scopedVehicleReader{id: 42}
	h := &Handler{db: reader}
	rec := httptest.NewRecorder()
	h.Records(rec, httptest.NewRequest(http.MethodGet, "/maintenance/records?vehicle_id=42", nil))
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if reader.calls != 0 {
		t.Fatal("records invented a repository lookup")
	}
}
