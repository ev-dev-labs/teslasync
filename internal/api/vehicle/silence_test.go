package vehicle

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestClassifySilenceOK(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	last := now.Add(-30 * time.Minute)
	s := ClassifySilence(3, &last, now)
	if s.Status != silenceOK || s.SilentForS == nil {
		t.Fatalf("unexpected: %+v", s)
	}
}

func TestClassifySilenceQuiet(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	last := now.Add(-8 * time.Hour)
	if s := ClassifySilence(3, &last, now); s.Status != silenceQuiet {
		t.Fatalf("status = %s, want quiet", s.Status)
	}
}

func TestClassifySilenceSilent(t *testing.T) {
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	last := now.Add(-30 * time.Hour)
	s := ClassifySilence(3, &last, now)
	if s.Status != silenceSilent {
		t.Fatalf("status = %s, want silent", s.Status)
	}
	if s.Explanation == "" {
		t.Fatal("expected guidance")
	}
}

func TestClassifySilenceNever(t *testing.T) {
	s := ClassifySilence(3, nil, time.Now().UTC())
	if s.Status != silenceNever || s.LastSeenAt != nil {
		t.Fatalf("unexpected: %+v", s)
	}
}

func TestSilenceEndpointReadsLatestRow(t *testing.T) {
	base := time.Now().UTC()
	h := &Handler{state: &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return []signal.TimelineRow{
				{Timestamp: base.Add(-2 * time.Hour)},
				{Timestamp: base.Add(-10 * time.Minute)},
			}, nil
		},
	}}
	r := chi.NewRouter()
	r.Get("/vehicles/{vehicleID}/silence", h.Silence)
	req := httptest.NewRequest(http.MethodGet, "/vehicles/3/silence", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var s VehicleSilence
	if err := json.NewDecoder(rec.Body).Decode(&s); err != nil {
		t.Fatal(err)
	}
	if s.Status != silenceOK || s.VehicleID != 3 {
		t.Fatalf("unexpected: %+v", s)
	}
}
