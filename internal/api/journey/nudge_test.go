package journey

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/stormguard"
)

func TestNudgeVerdict(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	in := now
	future := now.Add(3 * time.Hour)
	recent := now.Add(-20 * time.Minute)
	blockers := []Item{{Key: "tire_pressure", Status: ItemAction, Detail: "flat"}}
	cases := []struct {
		name  string
		slot  *time.Time
		items []Item
		want  string
	}{
		{"blockers win over a live slot", &in, blockers, NudgeWait},
		{"no slot delays", nil, nil, NudgeDelay},
		{"future slot waits", &future, nil, NudgeWait},
		{"live slot leaves", &in, nil, NudgeLeaveNow},
		{"missed slot still leaves", &recent, nil, NudgeLeaveNow},
	}
	for _, c := range cases {
		if got := NudgeVerdict(now, c.slot, c.items); got != c.want {
			t.Errorf("%s: verdict = %s, want %s", c.name, got, c.want)
		}
	}
	if got := NudgeVerdict(now, &in, nil); got != NudgeLeaveNow {
		t.Fatalf("clean leaves = %s", got)
	}
}

func TestBlockers(t *testing.T) {
	if b := Blockers(nil); b != nil {
		t.Fatalf("nil = %+v, want nil", b)
	}
	run := &Run{Items: []Item{
		{Key: "a", Status: ItemOK},
		{Key: "b", Status: ItemAction, Detail: "fix b"},
		{Key: "c", Status: "attention"},
		{Key: "d", Status: ItemAction, Detail: "fix d"},
	}}
	b := Blockers(run)
	if len(b) != 2 || b[0].Key != "b" || b[1].Key != "d" {
		t.Fatalf("blockers = %+v, want b+d", b)
	}
	if b := Blockers(&Run{}); len(b) != 0 {
		t.Fatalf("empty = %+v, want empty", b)
	}
}

func nudgeSession() *Session {
	s := liveSession()
	s.Status = StatusPlanned
	s.StartedAt = nil
	return s
}

func TestMonitor(t *testing.T) {
	base := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	f := newFakeStore()
	f.sessions[1] = nudgeSession()
	runs := &fakeRuns{runs: map[int64][]*Run{1: {{
		ID: 1, SessionID: 1, RunAt: base.Add(-time.Hour),
		Items: []Item{{Key: "a", Status: ItemOK}, {Key: "b", Status: ItemOK}},
	}}}}
	h := NewNudgeHandler(f, &fakeMeteo{forecast: departForecast(base)}, runs)
	h.now = func() time.Time { return base }
	rec := httptest.NewRecorder()
	h.Monitor(rec, liveRequest(http.MethodGet, "/journey/sessions/1/nudge", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got Nudge
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Verdict != NudgeLeaveNow || got.SlotAt == nil || !got.SlotAt.Equal(base) {
		t.Fatalf("nudge = %+v, want leave_now @ base", got)
	}
	if len(got.Blockers) != 0 {
		t.Fatalf("blockers = %+v, want none", got.Blockers)
	}
	if len(got.Evidence) != 1 {
		t.Fatalf("evidence = %v, want 1 line", got.Evidence)
	}
}

func TestMonitorWait(t *testing.T) {
	base := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	f := newFakeStore()
	f.sessions[1] = nudgeSession()
	runs := &fakeRuns{runs: map[int64][]*Run{1: {{
		ID: 1, SessionID: 1, RunAt: base.Add(-time.Hour),
		Items: []Item{{Key: "tire_pressure", Status: ItemAction, Detail: "FR at 2.6 bar"}},
	}}}}
	h := NewNudgeHandler(f, &fakeMeteo{forecast: departForecast(base)}, runs)
	h.now = func() time.Time { return base }
	rec := httptest.NewRecorder()
	h.Monitor(rec, liveRequest(http.MethodGet, "/journey/sessions/1/nudge", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
	var got Nudge
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Verdict != NudgeWait || len(got.Blockers) != 1 {
		t.Fatalf("nudge = %+v, want wait + 1 blocker", got)
	}
	if len(got.Evidence) != 2 {
		t.Fatalf("evidence = %v, want 2 lines", got.Evidence)
	}
}

func TestMonitorDelay(t *testing.T) {
	base := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	f := newFakeStore()
	f.sessions[1] = nudgeSession()
	warn := &stormguard.Forecast{
		Times:      []time.Time{base, base.Add(time.Hour)},
		Weather:    []int{95, 99},
		WindGustMS: []float64{9, 9},
	}
	h := NewNudgeHandler(f, &fakeMeteo{forecast: warn}, &fakeRuns{runs: map[int64][]*Run{}})
	h.now = func() time.Time { return base }
	rec := httptest.NewRecorder()
	h.Monitor(rec, liveRequest(http.MethodGet, "/journey/sessions/1/nudge", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
	var got Nudge
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Verdict != NudgeDelay || got.SlotAt != nil {
		t.Fatalf("nudge = %+v, want delay without slot", got)
	}
}

func TestMonitorUnknown(t *testing.T) {
	f := newFakeStore()
	s := nudgeSession()
	s.OriginLat, s.OriginLng = nil, nil
	f.sessions[1] = s
	h := NewNudgeHandler(f, &fakeMeteo{}, &fakeRuns{runs: map[int64][]*Run{}})
	rec := httptest.NewRecorder()
	h.Monitor(rec, liveRequest(http.MethodGet, "/journey/sessions/1/nudge", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
	var got Nudge
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Verdict != NudgeUnknown {
		t.Fatalf("verdict = %s, want unknown", got.Verdict)
	}
}

func TestMonitorErrors(t *testing.T) {
	base := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	newHandler := func(f *fakeStore, m *fakeMeteo) *NudgeHandler {
		h := NewNudgeHandler(f, m, &fakeRuns{runs: map[int64][]*Run{}})
		h.now = func() time.Time { return base }
		return h
	}
	f := newFakeStore()
	f.sessions[1] = nudgeSession()
	cases := []struct {
		name string
		id   string
		h    *NudgeHandler
		want int
	}{
		{"bad id", "abc", newHandler(f, &fakeMeteo{forecast: departForecast(base)}), http.StatusBadRequest},
		{"missing", "9", newHandler(f, &fakeMeteo{forecast: departForecast(base)}), http.StatusNotFound},
		{"meteo down", "1", newHandler(f, &fakeMeteo{err: errors.New("meteo down")}), http.StatusInternalServerError},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		c.h.Monitor(rec, liveRequest(http.MethodGet, "/journey/sessions/1/nudge", c.id, ""))
		if rec.Code != c.want {
			t.Errorf("%s: code = %d, want %d (%s)", c.name, rec.Code, c.want, rec.Body.String())
		}
	}
}

func TestMonitorConflict(t *testing.T) {
	f := newFakeStore()
	f.sessions[1] = liveSession() // active
	h := NewNudgeHandler(f, &fakeMeteo{}, &fakeRuns{runs: map[int64][]*Run{}})
	rec := httptest.NewRecorder()
	h.Monitor(rec, liveRequest(http.MethodGet, "/journey/sessions/1/nudge", "1", ""))
	if rec.Code != http.StatusConflict {
		t.Fatalf("code = %d, want 409", rec.Code)
	}
}
