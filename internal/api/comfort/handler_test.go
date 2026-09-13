package comfort

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

type fakeStore struct {
	cfg    *Config
	runs   []*Run
	ran    map[string]bool
	upsert *Config
	err    error
}

func (f *fakeStore) GetConfig(_ context.Context, vehicleID int64) (*Config, error) {
	if f.err != nil {
		return nil, f.err
	}
	if f.cfg != nil {
		return f.cfg, nil
	}
	return DefaultConfig(vehicleID), nil
}

func (f *fakeStore) UpsertConfig(_ context.Context, c *Config) error {
	f.upsert = c
	return f.err
}

func (f *fakeStore) EnabledConfigs(_ context.Context) ([]*Config, error) {
	if f.cfg != nil && f.cfg.Enabled {
		return []*Config{f.cfg}, f.err
	}
	return nil, f.err
}

func (f *fakeStore) HasRun(_ context.Context, _ int64, uid string) (bool, error) {
	return f.ran[uid], f.err
}

func (f *fakeStore) LogRun(_ context.Context, r *Run) (bool, error) {
	if f.err != nil {
		return false, f.err
	}
	if f.ran == nil {
		f.ran = map[string]bool{}
	}
	if f.ran[r.EventUID] {
		return false, nil
	}
	f.ran[r.EventUID] = true
	f.runs = append(f.runs, r)
	return true, nil
}

func (f *fakeStore) ListRuns(_ context.Context, _ int64, _ int) ([]*Run, error) {
	return f.runs, f.err
}

var _ ConfigStore = (*fakeStore)(nil)

type fakeFeeds struct {
	events []Event
	err    error
}

func (f *fakeFeeds) Fetch(_ context.Context, _ string) ([]Event, error) { return f.events, f.err }

var _ FeedFetcher = (*fakeFeeds)(nil)

type fakeCommander struct {
	calls []string
	vin   string
	err   error
}

func (f *fakeCommander) SendCommand(_ context.Context, vin string, command string, _ map[string]interface{}) error {
	f.calls = append(f.calls, command)
	f.vin = vin
	return f.err
}

var _ Commander = (*fakeCommander)(nil)

type fakeVehicles struct {
	vin string
}

func (f *fakeVehicles) GetByID(_ context.Context, id int64) (*vehiclemodel.Vehicle, error) {
	return &vehiclemodel.Vehicle{ID: id, VIN: f.vin}, nil
}

func testHandler(store *fakeStore, feeds *fakeFeeds, cmd *fakeCommander) *Handler {
	return &Handler{store: store, feeds: feeds, tesla: cmd, vehicles: &fakeVehicles{vin: "VIN7"}, now: func() time.Time {
		return time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	}}
}

func TestNext(t *testing.T) {
	now := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	store := &fakeStore{cfg: &Config{VehicleID: 7, Enabled: true, LeadMinutes: 20, ICSURL: "http://10.0.0.5/y.ics"}}
	feeds := &fakeFeeds{events: []Event{
		{UID: "a", Title: "Dentist", Location: "123 Main", StartsAt: now.Add(15 * time.Minute)},
	}}
	h := testHandler(store, feeds, &fakeCommander{})

	req := httptest.NewRequest(http.MethodGet, "/next?vehicle_id=7", nil)
	rec := httptest.NewRecorder()
	h.Next(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var resp nextResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Event == nil || resp.Event.UID != "a" {
		t.Fatalf("event = %+v, want UID a", resp.Event)
	}
}

func TestNextNoFeed(t *testing.T) {
	store := &fakeStore{cfg: &Config{VehicleID: 7, LeadMinutes: 20}}
	h := testHandler(store, &fakeFeeds{err: errors.New("must not be called")}, &fakeCommander{})
	req := httptest.NewRequest(http.MethodGet, "/next?vehicle_id=7", nil)
	rec := httptest.NewRecorder()
	h.Next(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestUpsertConfig(t *testing.T) {
	store := &fakeStore{}
	h := testHandler(store, &fakeFeeds{}, &fakeCommander{})
	body := `{"vehicle_id":7,"enabled":true,"target_temp_c":22.5,"lead_minutes":30,"ics_url":"http://10.0.0.5/y.ics"}`
	req := httptest.NewRequest(http.MethodPut, "/config", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.UpsertConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if store.upsert == nil || store.upsert.TargetTempC != 22.5 || store.upsert.LeadMinutes != 30 {
		t.Fatalf("upsert = %+v", store.upsert)
	}
	for _, bad := range []string{
		`{"vehicle_id":7,"target_temp_c":5,"lead_minutes":20}`,
		`{"vehicle_id":7,"target_temp_c":21,"lead_minutes":500}`,
		`{"vehicle_id":0,"target_temp_c":21,"lead_minutes":20}`,
	} {
		req := httptest.NewRequest(http.MethodPut, "/config", strings.NewReader(bad))
		rec := httptest.NewRecorder()
		h.UpsertConfig(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %q status = %d, want 400", bad, rec.Code)
		}
	}
}

func TestPreconditionNow(t *testing.T) {
	store := &fakeStore{cfg: &Config{VehicleID: 7, TargetTempC: 22}}
	cmd := &fakeCommander{}
	h := testHandler(store, &fakeFeeds{}, cmd)
	req := httptest.NewRequest(http.MethodPost, "/now", strings.NewReader(`{"vehicle_id":7}`))
	rec := httptest.NewRecorder()
	h.PreconditionNow(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if len(cmd.calls) != 2 || cmd.calls[0] != "set_temps" || cmd.calls[1] != "climate_on" {
		t.Fatalf("calls = %v, want [set_temps climate_on]", cmd.calls)
	}
}

func TestEvaluateEnabled(t *testing.T) {
	now := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	newCase := func() (*fakeStore, *fakeFeeds, *fakeCommander) {
		store := &fakeStore{cfg: &Config{VehicleID: 7, Enabled: true, TargetTempC: 22, LeadMinutes: 20, ICSURL: "http://10.0.0.5/y.ics"}}
		feeds := &fakeFeeds{events: []Event{
			{UID: "a", Title: "Dentist", Location: "123 Main", StartsAt: now.Add(15 * time.Minute)},
		}}
		return store, feeds, &fakeCommander{}
	}

	t.Run("preconditions once per event", func(t *testing.T) {
		store, feeds, cmd := newCase()
		h := testHandler(store, feeds, cmd)
		h.EvaluateEnabled(context.Background())
		h.EvaluateEnabled(context.Background())
		if len(cmd.calls) != 2 {
			t.Fatalf("calls = %v, want exactly one set_temps+climate_on pair", cmd.calls)
		}
		if len(store.runs) != 1 || store.runs[0].EventUID != "a" {
			t.Fatalf("runs = %+v", store.runs)
		}
	})

	t.Run("no event in window does nothing", func(t *testing.T) {
		store, feeds, cmd := newCase()
		feeds.events[0].StartsAt = now.Add(2 * time.Hour)
		h := testHandler(store, feeds, cmd)
		h.EvaluateEnabled(context.Background())
		if len(cmd.calls) != 0 || len(store.runs) != 0 {
			t.Fatal("expected silence outside the lead window")
		}
	})

	t.Run("feed failure skips vehicle", func(t *testing.T) {
		store, _, cmd := newCase()
		h := testHandler(store, &fakeFeeds{err: errors.New("down")}, cmd)
		h.EvaluateEnabled(context.Background())
		if len(cmd.calls) != 0 {
			t.Fatal("expected no commands on feed failure")
		}
	})
}

func TestNewHandlerPanicsOnNil(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	NewHandler(nil, &fakeFeeds{}, &fakeCommander{}, &fakeVehicles{})
}
