package daylog

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	daylogdb "github.com/ev-dev-labs/teslasync/internal/database/daylog"
)

// fakeDayLogRepo implements dayLogRepository without a database.
type fakeDayLogRepo struct {
	exists   bool
	drives   []daylogdb.DayDrive
	charges  []daylogdb.DayCharge
	fsm      []daylogdb.DayFSMTransition
	security []daylogdb.DaySecurityEvent
	signals  []daylogdb.DaySignalRow
	gears    []daylogdb.DayGearTick
	software []daylogdb.DaySoftwareUpdate
	err      error

	gotFields []string
	gearCalls int
}

func (f *fakeDayLogRepo) VehicleExists(_ context.Context, _ int64) (bool, error) {
	return f.exists, f.err
}
func (f *fakeDayLogRepo) DrivesOverlapping(_ context.Context, _ int64, _, _ time.Time) ([]daylogdb.DayDrive, error) {
	return f.drives, f.err
}
func (f *fakeDayLogRepo) ChargesOverlapping(_ context.Context, _ int64, _, _ time.Time) ([]daylogdb.DayCharge, error) {
	return f.charges, f.err
}
func (f *fakeDayLogRepo) FSMTransitions(_ context.Context, _ int64, _, _ time.Time) ([]daylogdb.DayFSMTransition, error) {
	return f.fsm, f.err
}
func (f *fakeDayLogRepo) SecurityEvents(_ context.Context, _ int64, _, _ time.Time) ([]daylogdb.DaySecurityEvent, error) {
	return f.security, f.err
}
func (f *fakeDayLogRepo) SecurityPrevStates(_ context.Context, _ int64, _ time.Time) (map[string]*string, error) {
	return map[string]*string{}, f.err
}
func (f *fakeDayLogRepo) SignalRows(_ context.Context, _ int64, fields []string, _, _ time.Time, _ int) ([]daylogdb.DaySignalRow, error) {
	f.gotFields = fields
	return f.signals, f.err
}
func (f *fakeDayLogRepo) GearTicks(_ context.Context, _ int64, _, _ time.Time, _ int) ([]daylogdb.DayGearTick, error) {
	f.gearCalls++
	return f.gears, f.err
}
func (f *fakeDayLogRepo) SoftwareUpdates(_ context.Context, _ int64, _, _ time.Time) ([]daylogdb.DaySoftwareUpdate, error) {
	return f.software, f.err
}

func TestGet_ParamValidation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		query      string
		wantStatus int
	}{
		{"missing vehicle_id", "date=2026-09-14", http.StatusBadRequest},
		{"vehicle_id zero", "vehicle_id=0&date=2026-09-14", http.StatusBadRequest},
		{"vehicle_id negative", "vehicle_id=-3&date=2026-09-14", http.StatusBadRequest},
		{"vehicle_id text", "vehicle_id=abc&date=2026-09-14", http.StatusBadRequest},
		{"bad date", "vehicle_id=1&date=14-09-2026", http.StatusBadRequest},
		{"bad timezone", "vehicle_id=1&date=2026-09-14&timezone=Mars/Olympus", http.StatusBadRequest},
		{"unknown layer", "vehicle_id=1&date=2026-09-14&layers=lights,nope", http.StatusBadRequest},
		{"start without end", "vehicle_id=1&start=2026-09-14T07:00:00Z", http.StatusBadRequest},
		{"end without start", "vehicle_id=1&end=2026-09-15T07:00:00Z", http.StatusBadRequest},
		{"bad start", "vehicle_id=1&start=yesterday&end=2026-09-15T07:00:00Z", http.StatusBadRequest},
		{"end before start", "vehicle_id=1&start=2026-09-15T07:00:00Z&end=2026-09-14T07:00:00Z", http.StatusBadRequest},
		{"span over 48h", "vehicle_id=1&start=2026-09-10T07:00:00Z&end=2026-09-15T07:00:00Z", http.StatusBadRequest},
		{"limit zero", "vehicle_id=1&date=2026-09-14&limit=0", http.StatusBadRequest},
		{"limit text", "vehicle_id=1&date=2026-09-14&limit=many", http.StatusBadRequest},
		{"limit over max", "vehicle_id=1&date=2026-09-14&limit=5000", http.StatusBadRequest},
		{"offset negative", "vehicle_id=1&date=2026-09-14&offset=-1", http.StatusBadRequest},
		{"offset text", "vehicle_id=1&date=2026-09-14&offset=far", http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := &Handler{repo: &fakeDayLogRepo{exists: true}}
			req := httptest.NewRequest(http.MethodGet, "/api/v1/day-log?"+tt.query, nil)
			rec := httptest.NewRecorder()
			h.Get(rec, req)
			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d (body %s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestGet_VehicleNotFound(t *testing.T) {
	t.Parallel()
	h := &Handler{repo: &fakeDayLogRepo{exists: false}}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/day-log?vehicle_id=99&date=2026-09-14", nil)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestGet_RepoErrorIs500(t *testing.T) {
	t.Parallel()
	h := &Handler{repo: &fakeDayLogRepo{exists: true, err: errors.New("boom")}}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/day-log?vehicle_id=1&date=2026-09-14", nil)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
}

func TestGet_HappyPath(t *testing.T) {
	t.Parallel()
	repo := &fakeDayLogRepo{
		exists: true,
		drives: []daylogdb.DayDrive{{
			ID: 7, VehicleID: 1,
			StartedAt: time.Date(2026, 9, 14, 15, 4, 5, 0, time.UTC),
			EndedAt:   dlTimePtr2(2026, 9, 14, 16, 0, 0),
		}},
		security: []daylogdb.DaySecurityEvent{
			{ID: 1, Ts: time.Date(2026, 9, 14, 15, 0, 0, 0, time.UTC), EventType: "locked", ToState: dlStr("true")},
		},
	}
	h := &Handler{repo: repo}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/day-log?vehicle_id=1&date=2026-09-14&timezone=America/Los_Angeles", nil)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}

	var resp DayLogResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.VehicleID != 1 || resp.Date != "2026-09-14" || resp.Timezone != "America/Los_Angeles" {
		t.Errorf("envelope identity = %+v", resp)
	}
	// PDT is UTC-7: local midnight 2026-09-14 is 07:00Z.
	if want := "2026-09-14T07:00:00Z"; resp.DayStart.UTC().Format(time.RFC3339) != want {
		t.Errorf("day_start = %s, want %s", resp.DayStart.UTC().Format(time.RFC3339), want)
	}
	if want := "2026-09-15T07:00:00Z"; resp.DayEnd.UTC().Format(time.RFC3339) != want {
		t.Errorf("day_end = %s, want %s", resp.DayEnd.UTC().Format(time.RFC3339), want)
	}
	if resp.Events == nil || resp.Sources == nil || resp.Layers == nil {
		t.Errorf("events/sources/layers must be non-nil arrays")
	}
	if len(resp.Events) != 3 {
		t.Fatalf("events = %d, want 3 (locked, drive start+end)", len(resp.Events))
	}
	if resp.Events[0].Type != "locked" || resp.Events[1].Type != "drive_start" || resp.Events[2].Type != "drive_end" {
		t.Errorf("event order wrong: %v", eventTypes(resp.Events))
	}
	if resp.Summary.DriveCount != 1 {
		t.Errorf("drive_count = %d, want 1", resp.Summary.DriveCount)
	}
	// Omitted layers means the complete history: every layer echoed,
	// gear queried, all layer fields in the signal query.
	if len(resp.Layers) != len(AllLayers) {
		t.Errorf("layers echo = %v, want all %d layers", resp.Layers, len(AllLayers))
	}
	if resp.TotalEvents != 3 || resp.Limit != dayLogDefaultLimit || resp.Offset != 0 {
		t.Errorf("total/limit/offset = %d/%d/%d", resp.TotalEvents, resp.Limit, resp.Offset)
	}
	if repo.gearCalls != 1 {
		t.Errorf("gear calls = %d, want 1 (all-on default)", repo.gearCalls)
	}
	fields := map[string]bool{}
	for _, f := range repo.gotFields {
		fields[f] = true
	}
	for _, want := range []string{"RemoteStartActive", "LightsTurnSignal", "LightsHazardsActive", "HvacPower", "HomelinkNearby"} {
		if !fields[want] {
			t.Errorf("signal fields %v missing %q", repo.gotFields, want)
		}
	}
}

func TestGet_BlankLayersMeansAll(t *testing.T) {
	t.Parallel()
	for _, q := range []string{"vehicle_id=1&date=2026-09-14&layers=", "vehicle_id=1&date=2026-09-14&layers=,,"} {
		h := &Handler{repo: &fakeDayLogRepo{exists: true}}
		req := httptest.NewRequest(http.MethodGet, "/api/v1/day-log?"+q, nil)
		rec := httptest.NewRecorder()
		h.Get(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d, want 200", q, rec.Code)
		}
		var resp DayLogResponse
		if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
			t.Fatalf("%s: decode: %v", q, err)
		}
		if len(resp.Layers) != len(AllLayers) {
			t.Errorf("%s: layers = %v, want all", q, resp.Layers)
		}
	}
}

func TestGet_ExplicitLayersNarrow(t *testing.T) {
	t.Parallel()
	repo := &fakeDayLogRepo{exists: true}
	h := &Handler{repo: repo}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/day-log?vehicle_id=1&date=2026-09-14&layers=lights", nil)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	var resp DayLogResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Layers) != 1 || resp.Layers[0] != "lights" {
		t.Errorf("layers echo = %v, want [lights]", resp.Layers)
	}
	if repo.gearCalls != 0 {
		t.Errorf("gear must not be queried for layers=lights")
	}
}

func dlTimePtr2(y int, mo time.Month, d, h, mi, s int) *time.Time {
	t := time.Date(y, mo, d, h, mi, s, 0, time.UTC)
	return &t
}

func TestGet_LayersAndExplicitWindow(t *testing.T) {
	t.Parallel()
	repo := &fakeDayLogRepo{exists: true}
	h := &Handler{repo: repo}
	req := httptest.NewRequest(http.MethodGet,
		"/api/v1/day-log?vehicle_id=1&start=2026-09-14T07:00:00Z&end=2026-09-15T07:00:00Z&timezone=UTC&layers=lights,gear", nil)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	var resp DayLogResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Layers) != 2 || resp.Layers[0] != "lights" || resp.Layers[1] != "gear" {
		t.Errorf("layers echo = %v", resp.Layers)
	}
	if repo.gearCalls != 1 {
		t.Errorf("gear calls = %d, want 1", repo.gearCalls)
	}
	fields := map[string]bool{}
	for _, f := range repo.gotFields {
		fields[f] = true
	}
	for _, want := range []string{"RemoteStartActive", "LightsHazardsActive", "LightsHighBeams"} {
		if !fields[want] {
			t.Errorf("signal fields %v missing %q", repo.gotFields, want)
		}
	}
	if resp.Truncated {
		t.Errorf("empty day must not be truncated")
	}
}
