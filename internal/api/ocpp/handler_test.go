package ocpp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	dbocpp "github.com/ev-dev-labs/teslasync/internal/database/ocpp"
)

type fakeReader struct {
	points   []dbocpp.ChargePoint
	sessions []dbocpp.SessionView
	err      error

	gotChargePointID string
	gotLimit         int
}

func (f *fakeReader) ListChargePoints(_ context.Context) ([]dbocpp.ChargePoint, error) {
	return f.points, f.err
}

func (f *fakeReader) ListSessions(_ context.Context, chargePointID string, limit int) ([]dbocpp.SessionView, error) {
	f.gotChargePointID = chargePointID
	f.gotLimit = limit
	return f.sessions, f.err
}

var _ Reader = (*fakeReader)(nil)

func TestListChargePoints(t *testing.T) {
	seen := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	r := &fakeReader{points: []dbocpp.ChargePoint{{
		ID:             "wallbox-1",
		Vendor:         "Wallbox",
		Model:          "Pulsar Plus",
		LastSeenAt:     seen,
		Connectors:     []dbocpp.ConnectorStatus{{ConnectorID: 1, Status: "Charging", ErrorCode: "NoError"}},
		ActiveSessions: 1,
	}}}
	h := NewHandler(r)

	req := httptest.NewRequest(http.MethodGet, "/ocpp/charge-points", nil)
	rec := httptest.NewRecorder()
	h.ListChargePoints(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got []dbocpp.ChargePoint
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 || got[0].ID != "wallbox-1" || got[0].ActiveSessions != 1 {
		t.Fatalf("unexpected body: %+v", got)
	}
}

func TestListSessionsPassesFilterAndLimit(t *testing.T) {
	r := &fakeReader{sessions: []dbocpp.SessionView{}}
	h := NewHandler(r)

	req := httptest.NewRequest(http.MethodGet, "/ocpp/sessions?charge_point_id=wallbox-1&limit=10", nil)
	rec := httptest.NewRecorder()
	h.ListSessions(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if r.gotChargePointID != "wallbox-1" {
		t.Fatalf("charge_point_id = %q, want wallbox-1", r.gotChargePointID)
	}
	if r.gotLimit != 10 {
		t.Fatalf("limit = %d, want 10", r.gotLimit)
	}
}

func TestHandlersSurfaceStoreErrors(t *testing.T) {
	r := &fakeReader{err: errors.New("db down")}
	h := NewHandler(r)

	rec := httptest.NewRecorder()
	h.ListChargePoints(rec, httptest.NewRequest(http.MethodGet, "/ocpp/charge-points", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("charge-points status = %d, want 500", rec.Code)
	}

	rec = httptest.NewRecorder()
	h.ListSessions(rec, httptest.NewRequest(http.MethodGet, "/ocpp/sessions", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("sessions status = %d, want 500", rec.Code)
	}
}

func TestNewHandlerPanicsOnNil(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic on nil store")
		}
	}()
	NewHandler(nil)
}
