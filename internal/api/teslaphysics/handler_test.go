package teslaphysics

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/signal/signaltest"
)

type fakeChargeStore struct {
	session *chargingmodel.ChargingSession
	list    []*chargingmodel.ChargingSession
}

func (f fakeChargeStore) GetByID(context.Context, int64) (*chargingmodel.ChargingSession, error) {
	return f.session, nil
}

func (f fakeChargeStore) GetByVehicle(context.Context, int64, int, int, time.Time, time.Time) ([]*chargingmodel.ChargingSession, error) {
	return f.list, nil
}

type fakeDriveStore struct {
	drive *drivemodel.Drive
	list  []*drivemodel.Drive
}

func (f fakeDriveStore) GetByID(context.Context, int64) (*drivemodel.Drive, error) {
	return f.drive, nil
}

func (f fakeDriveStore) GetByVehicle(context.Context, int64, int, int, time.Time, time.Time) ([]*drivemodel.Drive, error) {
	return f.list, nil
}

func testPhysicsHandler(t *testing.T) (*Handler, *signaltest.FakeStateReader, *signaltest.FakeLiveStateReader) {
	t.Helper()
	now := at(t, "2026-03-01T12:00:00Z")
	start := at(t, "2026-03-01T10:00:00Z")
	end := at(t, "2026-03-01T11:00:00Z")
	state := signaltest.NewFakeStateReader()
	live := signaltest.NewFakeLiveStateReader()
	state.SetTimeline(7, []signal.TimelineRow{
		{Timestamp: start, Fields: map[string]signal.SignalValue{
			"detailed_charge_state": "Charging",
			"gear":                  "D",
			"speed":                 12.0,
			"fsd_distance_m":        1000.0,
			"charge_port_latch":     "Engaged",
			"battery_level":         70.0,
		}},
		{Timestamp: start.Add(30 * time.Minute), Fields: map[string]signal.SignalValue{
			"detailed_charge_state": "Complete",
			"gear":                  "P",
			"sentry_mode":           "Armed",
			"battery_level":         80.0,
		}},
		{Timestamp: end, Fields: map[string]signal.SignalValue{
			"detailed_charge_state": "Disconnected",
			"gear":                  "P",
			"battery_level":         80.0,
		}},
	})
	live.SetMany(7, map[string]signal.SignalValue{
		"Gear":                       "P",
		"DetailedChargeState":        "Disconnected",
		"SelfDrivingMilesSinceReset": 1234.0,
		"MilesSinceReset":            9000.0,
		"Version":                    "2026.20.3",
	})
	charger := "Supercharger"
	h := &Handler{
		state: state,
		live:  live,
		charges: fakeChargeStore{session: &chargingmodel.ChargingSession{
			ID: 9, VehicleID: 7, StartedAt: start, EndedAt: &end, ChargerType: &charger,
		}},
		chargeList: fakeChargeStore{list: []*chargingmodel.ChargingSession{{
			ID: 9, VehicleID: 7, StartedAt: start, EndedAt: &end,
		}}},
		drives: fakeDriveStore{drive: &drivemodel.Drive{
			ID: 295, VehicleID: 7, StartTs: start, EndTs: &end,
		}},
		driveList: fakeDriveStore{list: []*drivemodel.Drive{{
			ID: 295, VehicleID: 7, StartTs: start, EndTs: &end,
		}}},
		clock: func() time.Time { return now },
		mqttConnected: func() *bool {
			v := true
			return &v
		},
	}
	return h, state, live
}

func physicsRouter(h *Handler) http.Handler {
	r := chi.NewRouter()
	r.Get("/physics/cockpit", h.Cockpit)
	r.Get("/physics/heartbeat", h.Heartbeat)
	r.Get("/physics/park-truth", h.ParkTruth)
	r.Get("/physics/vampire", h.Vampire)
	r.Get("/physics/outage", h.Outage)
	r.Get("/physics/exclusive", h.Exclusive)
	r.Get("/physics/certificate", h.Certificate)
	r.Get("/physics/charging/{sessionID}", h.ChargePhysics)
	r.Get("/physics/drives/{driveID}/theater", h.Theater)
	r.Get("/physics/drives/{driveID}/silent", h.Silent)
	return r
}

func TestHandler_ChargePhysicsAndMissingVehicle(t *testing.T) {
	h, _, _ := testPhysicsHandler(t)
	router := physicsRouter(h)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/physics/charging/9", nil)
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("charge physics status = %d body=%s", rec.Code, rec.Body.String())
	}
	var physics ChargePhysics
	if err := json.Unmarshal(rec.Body.Bytes(), &physics); err != nil {
		t.Fatal(err)
	}
	if physics.SessionID != 9 || len(physics.Story) == 0 {
		t.Fatalf("unexpected physics: %+v", physics)
	}

	missing := httptest.NewRecorder()
	router.ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/physics/cockpit", nil))
	if missing.Code != http.StatusBadRequest {
		t.Fatalf("missing vehicle_id status = %d", missing.Code)
	}
}

func TestHandler_CockpitHeartbeatCertificate(t *testing.T) {
	h, _, _ := testPhysicsHandler(t)
	router := physicsRouter(h)

	cockpitRec := httptest.NewRecorder()
	router.ServeHTTP(cockpitRec, httptest.NewRequest(http.MethodGet, "/physics/cockpit?vehicle_id=7", nil))
	if cockpitRec.Code != http.StatusOK {
		t.Fatalf("cockpit status = %d body=%s", cockpitRec.Code, cockpitRec.Body.String())
	}

	hbRec := httptest.NewRecorder()
	router.ServeHTTP(hbRec, httptest.NewRequest(http.MethodGet, "/physics/heartbeat?vehicle_id=7", nil))
	if hbRec.Code != http.StatusOK {
		t.Fatalf("heartbeat status = %d body=%s", hbRec.Code, hbRec.Body.String())
	}
	var hb Heartbeat
	if err := json.Unmarshal(hbRec.Body.Bytes(), &hb); err != nil {
		t.Fatal(err)
	}
	if hb.FSDDistanceM == nil || hb.FirmwareVersion != "2026.20.3" {
		t.Fatalf("heartbeat = %+v", hb)
	}

	certRec := httptest.NewRecorder()
	router.ServeHTTP(certRec, httptest.NewRequest(http.MethodGet, "/physics/certificate?vehicle_id=7", nil))
	if certRec.Code != http.StatusOK {
		t.Fatalf("certificate status = %d body=%s", certRec.Code, certRec.Body.String())
	}
	var cert SessionCertificate
	if err := json.Unmarshal(certRec.Body.Bytes(), &cert); err != nil {
		t.Fatal(err)
	}
	if cert.IntegritySHA256 == "" || len(cert.Drives) != 1 {
		t.Fatalf("certificate = %+v", cert)
	}

	exRec := httptest.NewRecorder()
	router.ServeHTTP(exRec, httptest.NewRequest(http.MethodGet, "/physics/exclusive?vehicle_id=7", nil))
	if exRec.Code != http.StatusOK {
		t.Fatalf("exclusive status = %d body=%s", exRec.Code, exRec.Body.String())
	}
	var exclusive ExclusiveReport
	if err := json.Unmarshal(exRec.Body.Bytes(), &exclusive); err != nil {
		t.Fatal(err)
	}
	if exclusive.VehicleID != 7 || exclusive.Range.TrueRangeM != nil || exclusive.Clocks.Latest == nil || exclusive.Clocks.Latest.IngestTime != nil {
		t.Fatalf("exclusive = %+v", exclusive)
	}

	driveRec := httptest.NewRecorder()
	router.ServeHTTP(driveRec, httptest.NewRequest(http.MethodGet, "/physics/drives/295/theater", nil))
	if driveRec.Code != http.StatusOK {
		t.Fatalf("theater status = %d body=%s", driveRec.Code, driveRec.Body.String())
	}

	h.drives = fakeDriveStore{}
	missing := httptest.NewRecorder()
	router.ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/physics/drives/295/silent", nil))
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing drive status = %d", missing.Code)
	}
}
