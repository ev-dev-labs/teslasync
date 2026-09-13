package stormguard

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
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type fakeStore struct {
	cfg     *Config
	armed   []*Config
	events  []*Event
	last    string
	upserts []*Config
	err     error
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
	f.upserts = append(f.upserts, c)
	return f.err
}

func (f *fakeStore) ArmedConfigs(_ context.Context) ([]*Config, error) { return f.armed, f.err }

func (f *fakeStore) LogEvent(_ context.Context, e *Event) error {
	f.events = append(f.events, e)
	return f.err
}

func (f *fakeStore) LastEventLevel(_ context.Context, _ int64) (string, error) { return f.last, f.err }

func (f *fakeStore) ListEvents(_ context.Context, _ int64, _ int) ([]*Event, error) {
	return f.events, f.err
}

var _ ConfigStore = (*fakeStore)(nil)

type fakeMeteo struct {
	forecast *Forecast
	err      error
}

func (f *fakeMeteo) Fetch(_ context.Context, _, _ float64) (*Forecast, error) {
	return f.forecast, f.err
}

var _ Forecaster = (*fakeMeteo)(nil)

type fakeCommander struct {
	calls []string
	vin   string
	pct   int
	err   error
}

func (f *fakeCommander) SendCommand(_ context.Context, vin string, command string, params map[string]interface{}) error {
	f.calls = append(f.calls, command)
	f.vin = vin
	if p, ok := params["percent"].(int); ok {
		f.pct = p
	}
	return f.err
}

var _ Commander = (*fakeCommander)(nil)

type fakeState struct {
	soc float64
	err error
}

func (f *fakeState) State(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
	return signal.State{}, nil
}

func (f *fakeState) SignalAt(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.soc, nil
}

func (f *fakeState) Timeline(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
	return nil, nil
}

var _ signal.StateReader = (*fakeState)(nil)

type fakeVehicles struct {
	vin string
	err error
}

func (f *fakeVehicles) GetByID(_ context.Context, id int64) (*vehiclemodel.Vehicle, error) {
	if f.err != nil {
		return nil, f.err
	}
	return &vehiclemodel.Vehicle{ID: id, VIN: f.vin}, nil
}

func testHandler(store *fakeStore, meteo *fakeMeteo, cmd *fakeCommander, state *fakeState, veh *fakeVehicles) *Handler {
	if veh == nil {
		veh = &fakeVehicles{}
	}
	return &Handler{store: store, meteo: meteo, tesla: cmd, state: state, vehicles: veh, now: func() time.Time {
		return time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	}}
}

func stormForecast(now time.Time) *Forecast {
	return forecastAt(now, []int{6}, []int{95}, []float64{10})
}

func TestStatus(t *testing.T) {
	now := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	store := &fakeStore{cfg: &Config{VehicleID: 7, Enabled: true, Lat: 37.7, Lng: -122.4, TargetSOC: 95}}
	meteo := &fakeMeteo{forecast: stormForecast(now)}
	h := testHandler(store, meteo, &fakeCommander{}, &fakeState{soc: 60}, nil)

	req := httptest.NewRequest(http.MethodGet, "/status?vehicle_id=7", nil)
	rec := httptest.NewRecorder()
	h.Status(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var resp statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Assessment.Level != LevelWarning {
		t.Fatalf("level = %q, want warning", resp.Assessment.Level)
	}
	if resp.CurrentSOC == nil || *resp.CurrentSOC != 60 {
		t.Fatalf("soc = %v, want 60", resp.CurrentSOC)
	}

	req = httptest.NewRequest(http.MethodGet, "/status", nil)
	rec = httptest.NewRecorder()
	h.Status(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing vehicle status = %d, want 400", rec.Code)
	}
}

func TestStatusMeteoFailure(t *testing.T) {
	store := &fakeStore{cfg: &Config{VehicleID: 7}}
	h := testHandler(store, &fakeMeteo{err: errors.New("down")}, &fakeCommander{}, &fakeState{}, nil)
	req := httptest.NewRequest(http.MethodGet, "/status?vehicle_id=7", nil)
	rec := httptest.NewRecorder()
	h.Status(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", rec.Code)
	}
}

func TestUpsertConfig(t *testing.T) {
	store := &fakeStore{}
	h := testHandler(store, &fakeMeteo{}, &fakeCommander{}, &fakeState{}, nil)

	body := `{"vehicle_id":7,"enabled":true,"lat":37.7,"lng":-122.4,"target_soc":95}`
	req := httptest.NewRequest(http.MethodPut, "/config", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.UpsertConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if len(store.upserts) != 1 || !store.upserts[0].Enabled || store.upserts[0].TargetSOC != 95 {
		t.Fatalf("upserts = %+v", store.upserts)
	}

	for _, bad := range []string{
		`{"vehicle_id":0,"lat":0,"lng":0,"target_soc":90}`,
		`{"vehicle_id":7,"lat":100,"lng":0,"target_soc":90}`,
		`{"vehicle_id":7,"lat":0,"lng":0,"target_soc":30}`,
		`{not json`,
	} {
		req := httptest.NewRequest(http.MethodPut, "/config", strings.NewReader(bad))
		rec := httptest.NewRecorder()
		h.UpsertConfig(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %q status = %d, want 400", bad, rec.Code)
		}
	}
}

func TestEvents(t *testing.T) {
	store := &fakeStore{events: []*Event{{ID: 1, VehicleID: 7, Level: LevelWarning, Acted: true}}}
	h := testHandler(store, &fakeMeteo{}, &fakeCommander{}, &fakeState{}, nil)
	req := httptest.NewRequest(http.MethodGet, "/events?vehicle_id=7&limit=5", nil)
	rec := httptest.NewRecorder()
	h.Events(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var events []*Event
	if err := json.Unmarshal(rec.Body.Bytes(), &events); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(events) != 1 || !events[0].Acted {
		t.Fatalf("events = %+v", events)
	}
}

func TestNewHandlerPanicsOnNil(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	NewHandler(nil, &fakeMeteo{}, &fakeCommander{}, &fakeState{}, nil)
}

func TestEvaluateArmedActsOnFreshWarning(t *testing.T) {
	now := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	cfg := &Config{VehicleID: 7, Enabled: true, Lat: 37.7, Lng: -122.4, TargetSOC: 95}
	store := &fakeStore{armed: []*Config{cfg}}
	meteo := &fakeMeteo{forecast: stormForecast(now)}
	cmd := &fakeCommander{}
	h := testHandler(store, meteo, cmd, &fakeState{soc: 60}, &fakeVehicles{vin: "VIN7"})

	h.EvaluateArmed(context.Background())

	if len(cmd.calls) != 1 || cmd.calls[0] != "set_charge_limit" {
		t.Fatalf("commands = %v, want [set_charge_limit]", cmd.calls)
	}
	if cmd.vin != "VIN7" || cmd.pct != 95 {
		t.Fatalf("vin/pct = %s/%d, want VIN7/95", cmd.vin, cmd.pct)
	}
	if len(store.events) != 1 || !store.events[0].Acted || store.events[0].Level != LevelWarning {
		t.Fatalf("events = %+v", store.events)
	}
}

func TestEvaluateArmedSkips(t *testing.T) {
	now := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	newArmed := func() (*fakeStore, *fakeMeteo, *fakeCommander) {
		cfg := &Config{VehicleID: 7, Enabled: true, TargetSOC: 95}
		return &fakeStore{armed: []*Config{cfg}}, &fakeMeteo{forecast: stormForecast(now)}, &fakeCommander{}
	}

	t.Run("no duplicate action on repeated warning", func(t *testing.T) {
		store, meteo, cmd := newArmed()
		store.last = LevelWarning
		h := testHandler(store, meteo, cmd, &fakeState{soc: 60}, &fakeVehicles{vin: "VIN7"})
		h.EvaluateArmed(context.Background())
		if len(cmd.calls) != 0 {
			t.Fatalf("commands = %v, want none", cmd.calls)
		}
		if len(store.events) != 0 {
			t.Fatalf("events = %+v, want none (no transition)", store.events)
		}
	})

	t.Run("already above target logs transition without acting", func(t *testing.T) {
		store, meteo, cmd := newArmed()
		h := testHandler(store, meteo, cmd, &fakeState{soc: 96}, &fakeVehicles{vin: "VIN7"})
		h.EvaluateArmed(context.Background())
		if len(cmd.calls) != 0 {
			t.Fatalf("commands = %v, want none", cmd.calls)
		}
		if len(store.events) != 1 || store.events[0].Acted {
			t.Fatalf("events = %+v, want one un-acted transition", store.events)
		}
	})

	t.Run("unreadable SOC never acts", func(t *testing.T) {
		store, meteo, cmd := newArmed()
		h := testHandler(store, meteo, cmd, &fakeState{err: errors.New("no data")}, &fakeVehicles{vin: "VIN7"})
		h.EvaluateArmed(context.Background())
		if len(cmd.calls) != 0 {
			t.Fatalf("commands = %v, want none", cmd.calls)
		}
	})

	t.Run("calm forecast after warning logs recovery", func(t *testing.T) {
		store, meteo, cmd := newArmed()
		store.last = LevelWarning
		meteo.forecast = forecastAt(now, []int{6, 12}, []int{1, 2}, []float64{5, 6})
		h := testHandler(store, meteo, cmd, &fakeState{soc: 60}, &fakeVehicles{vin: "VIN7"})
		h.EvaluateArmed(context.Background())
		if len(cmd.calls) != 0 {
			t.Fatalf("commands = %v, want none", cmd.calls)
		}
		if len(store.events) != 1 || store.events[0].Level != LevelNone {
			t.Fatalf("events = %+v, want recovery to none", store.events)
		}
	})

	t.Run("meteo failure skips vehicle", func(t *testing.T) {
		store, _, cmd := newArmed()
		meteo := &fakeMeteo{err: errors.New("down")}
		h := testHandler(store, meteo, cmd, &fakeState{soc: 60}, &fakeVehicles{vin: "VIN7"})
		h.EvaluateArmed(context.Background())
		if len(cmd.calls) != 0 || len(store.events) != 0 {
			t.Fatal("expected no commands or events on meteo failure")
		}
	})
}
