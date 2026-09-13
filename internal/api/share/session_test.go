package share

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

// ---------------------------------------------------------------------------
// Fakes for the session ports, mirroring the drive-port fake style in
// handler_test.go.
// ---------------------------------------------------------------------------

type fakeSessionStore struct {
	sessionFn func(ctx context.Context, id int64) (*chargingmodel.ChargingSession, error)
	calls     int
	gotID     int64
}

func (f *fakeSessionStore) GetByID(ctx context.Context, id int64) (*chargingmodel.ChargingSession, error) {
	f.calls++
	f.gotID = id
	if f.sessionFn == nil {
		return nil, nil
	}
	return f.sessionFn(ctx, id)
}

var _ sessionByIDFetcher = (*fakeSessionStore)(nil)

type fakeCurveLister struct {
	curveFn func(ctx context.Context, vehicleID int64, from, to time.Time) ([]publicCurvePoint, error)
	calls   int
	gotFrom time.Time
	gotTo   time.Time
}

func (f *fakeCurveLister) SessionCurve(ctx context.Context, vehicleID int64, from, to time.Time) ([]publicCurvePoint, error) {
	f.calls++
	f.gotFrom = from
	f.gotTo = to
	if f.curveFn == nil {
		return nil, nil
	}
	return f.curveFn(ctx, vehicleID, from, to)
}

var _ chargeCurveLister = (*fakeCurveLister)(nil)

// completedSession is a fully-populated charging session for share tests.
func completedSession(id, vehicleID int64) *chargingmodel.ChargingSession {
	start := time.Date(2026, 3, 15, 8, 0, 0, 0, time.UTC)
	end := start.Add(40 * time.Minute)
	return &chargingmodel.ChargingSession{
		ID:                 id,
		VehicleID:          vehicleID,
		StartedAt:          start,
		EndedAt:            &end,
		StartSocPct:        ptrF64(20),
		EndSocPct:          ptrF64(80),
		StartLat:           ptrF64(37.7749),
		StartLng:           ptrF64(-122.4194),
		StartPlace:         ptrStr("Home"),
		TotalEnergyAddedWh: ptrF64(45000),
		PeakPowerW:         ptrF64(250000),
		AvgPowerW:          ptrF64(67500),
		CostDecimal:        ptrF64(9.99),
		CostCurrency:       ptrStr("USD"),
		ChargerType:        ptrStr("supercharger"),
	}
}

// ---------------------------------------------------------------------------
// CreateSessionShare
// ---------------------------------------------------------------------------

func TestCreateSessionShare(t *testing.T) {
	newHandler := func(sess *fakeSessionStore, store *fakeShareStore) *ShareHandler {
		return &ShareHandler{shareRepo: store, sessionRepo: sess}
	}

	t.Run("invalid session id is a 400", func(t *testing.T) {
		h := newHandler(&fakeSessionStore{}, &fakeShareStore{})
		rec := httptest.NewRecorder()
		h.CreateSessionShare(rec, newRequest(t, http.MethodPost, "/charging/abc/share", nil, map[string]string{"sessionID": "abc"}))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})

	t.Run("missing session is a 404", func(t *testing.T) {
		h := newHandler(&fakeSessionStore{}, &fakeShareStore{})
		rec := httptest.NewRecorder()
		h.CreateSessionShare(rec, newRequest(t, http.MethodPost, "/charging/9/share", nil, map[string]string{"sessionID": "9"}))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rec.Code)
		}
	})

	t.Run("success mints a session-target token with telemetry off by default", func(t *testing.T) {
		sess := &fakeSessionStore{sessionFn: func(_ context.Context, _ int64) (*chargingmodel.ChargingSession, error) {
			return completedSession(9, 3), nil
		}}
		store := &fakeShareStore{}
		h := newHandler(sess, store)

		rec := httptest.NewRecorder()
		h.CreateSessionShare(rec, newRequest(t, http.MethodPost, "/charging/9/share", nil, map[string]string{"sessionID": "9"}))
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201: %s", rec.Code, rec.Body.String())
		}
		if store.created == nil {
			t.Fatal("expected a created token")
		}
		if store.created.ChargingSessionID != 9 || store.created.DriveID != 0 {
			t.Fatalf("target = (drive %d, session %d), want (0, 9)",
				store.created.DriveID, store.created.ChargingSessionID)
		}
		if store.created.IncludeTelemetry || store.created.IncludeMap || store.created.IncludeSpeed {
			t.Fatalf("flags = (map %v, telemetry %v, speed %v), want all false",
				store.created.IncludeMap, store.created.IncludeTelemetry, store.created.IncludeSpeed)
		}
		var body map[string]interface{}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if body["url"] != "/s/"+store.created.Token {
			t.Fatalf("url = %v, want /s/<token>", body["url"])
		}
	})

	t.Run("telemetry flag and title flow through", func(t *testing.T) {
		sess := &fakeSessionStore{sessionFn: func(_ context.Context, _ int64) (*chargingmodel.ChargingSession, error) {
			return completedSession(9, 3), nil
		}}
		store := &fakeShareStore{}
		h := newHandler(sess, store)

		rec := httptest.NewRecorder()
		req := newRequest(t, http.MethodPost, "/charging/9/share",
			strings.NewReader(`{"title":"Road trip charge","include_telemetry":true,"expires_in_days":7}`),
			map[string]string{"sessionID": "9"})
		h.CreateSessionShare(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201: %s", rec.Code, rec.Body.String())
		}
		if !store.created.IncludeTelemetry {
			t.Error("IncludeTelemetry = false, want true")
		}
		if store.created.Title == nil || *store.created.Title != "Road trip charge" {
			t.Errorf("title = %v, want Road trip charge", store.created.Title)
		}
		if store.created.ExpiresAt == nil || time.Until(*store.created.ExpiresAt) <= 0 {
			t.Errorf("missing or past expiry: %v", store.created.ExpiresAt)
		}
	})

	t.Run("malformed body is a 400", func(t *testing.T) {
		sess := &fakeSessionStore{sessionFn: func(_ context.Context, _ int64) (*chargingmodel.ChargingSession, error) {
			return completedSession(9, 3), nil
		}}
		h := newHandler(sess, &fakeShareStore{})
		rec := httptest.NewRecorder()
		req := newRequest(t, http.MethodPost, "/charging/9/share",
			strings.NewReader(`{not json`), map[string]string{"sessionID": "9"})
		h.CreateSessionShare(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})
}

// ---------------------------------------------------------------------------
// ListSessionShares
// ---------------------------------------------------------------------------

func TestListSessionShares(t *testing.T) {
	t.Run("returns empty array when none", func(t *testing.T) {
		store := &fakeShareStore{}
		h := &ShareHandler{shareRepo: store}
		rec := httptest.NewRecorder()
		h.ListSessionShares(rec, newRequest(t, http.MethodGet, "/charging/9/shares", nil, map[string]string{"sessionID": "9"}))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if strings.TrimSpace(rec.Body.String()) != "[]" {
			t.Fatalf("body = %s, want []", rec.Body.String())
		}
		if store.listSessionID != 9 {
			t.Fatalf("listed session = %d, want 9", store.listSessionID)
		}
	})

	t.Run("store error is a 500", func(t *testing.T) {
		store := &fakeShareStore{listSessionFn: func(_ context.Context, _ int64) ([]*drivemodel.ShareToken, error) {
			return nil, errors.New("db down")
		}}
		h := &ShareHandler{shareRepo: store}
		rec := httptest.NewRecorder()
		h.ListSessionShares(rec, newRequest(t, http.MethodGet, "/charging/9/shares", nil, map[string]string{"sessionID": "9"}))
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
	})
}

// ---------------------------------------------------------------------------
// GetPublicShare — session branch
// ---------------------------------------------------------------------------

func sessionShareHandler(t *testing.T, share *drivemodel.ShareToken, curve *fakeCurveLister) (*ShareHandler, *fakeShareStore) {
	t.Helper()
	store := &fakeShareStore{getFn: func(_ context.Context, _ string) (*drivemodel.ShareToken, error) {
		return share, nil
	}}
	sess := &fakeSessionStore{sessionFn: func(_ context.Context, _ int64) (*chargingmodel.ChargingSession, error) {
		return completedSession(9, 3), nil
	}}
	veh := &fakeVehicleStore{vehicleFn: func(_ context.Context, _ int64) (*vehiclemodel.Vehicle, error) {
		return &vehiclemodel.Vehicle{Model: ptrStr("Model 3"), Color: ptrStr("White")}, nil
	}}
	return &ShareHandler{shareRepo: store, sessionRepo: sess, vehicleRepo: veh, curveLister: curve}, store
}

func getPublic(t *testing.T, h *ShareHandler, token string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.GetPublicShare(rec, newRequest(t, http.MethodGet, "/share/"+token, nil, map[string]string{"token": token}))
	return rec
}

func TestGetPublicShareSession(t *testing.T) {
	t.Run("summary serves with share_type and no curve by default", func(t *testing.T) {
		h, _ := sessionShareHandler(t, &drivemodel.ShareToken{ID: 1, Token: "tok", ChargingSessionID: 9}, &fakeCurveLister{})
		rec := getPublic(t, h, "tok")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
		}
		var resp publicShareResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if resp.ShareType != shareTypeSession {
			t.Fatalf("share_type = %q, want %q", resp.ShareType, shareTypeSession)
		}
		if resp.Session == nil {
			t.Fatal("session payload missing")
		}
		if resp.Drive != nil {
			t.Fatalf("drive payload present for a session share: %+v", resp.Drive)
		}
		if resp.Session.EnergyAddedWh == nil || *resp.Session.EnergyAddedWh != 45000 {
			t.Fatalf("energy_added_wh = %v, want 45000", resp.Session.EnergyAddedWh)
		}
		if resp.Session.DurationS != 2400 {
			t.Fatalf("duration_s = %d, want 2400", resp.Session.DurationS)
		}
		if resp.Session.Place != "Home" || resp.Session.ChargerType != "supercharger" {
			t.Fatalf("place/charger = %q/%q", resp.Session.Place, resp.Session.ChargerType)
		}
		if len(resp.Session.Curve) != 0 {
			t.Fatalf("curve has %d points without telemetry opt-in", len(resp.Session.Curve))
		}
		if resp.Session.Cost != nil {
			t.Fatalf("cost exposed without telemetry opt-in: %v", resp.Session.Cost)
		}
		if resp.Vehicle == nil || resp.Vehicle.Model != "Model 3" {
			t.Fatalf("vehicle = %+v, want Model 3", resp.Vehicle)
		}
		// No coordinates anywhere in the public payload.
		if strings.Contains(rec.Body.String(), "37.7749") || strings.Contains(rec.Body.String(), "-122.4194") {
			t.Fatal("public payload leaks coordinates")
		}
	})

	t.Run("telemetry opt-in serves curve and cost", func(t *testing.T) {
		curve := &fakeCurveLister{curveFn: func(_ context.Context, _ int64, _, _ time.Time) ([]publicCurvePoint, error) {
			pw, soc := 120.5, 42.0
			return []publicCurvePoint{{OffsetS: 0, PowerKW: &pw, BatteryPct: &soc}}, nil
		}}
		h, _ := sessionShareHandler(t,
			&drivemodel.ShareToken{ID: 1, Token: "tok", ChargingSessionID: 9, IncludeTelemetry: true}, curve)
		rec := getPublic(t, h, "tok")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		var resp publicShareResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(resp.Session.Curve) != 1 || resp.Session.Curve[0].OffsetS != 0 {
			t.Fatalf("curve = %+v, want 1 point", resp.Session.Curve)
		}
		if resp.Session.Cost == nil || *resp.Session.Cost != 9.99 {
			t.Fatalf("cost = %v, want 9.99", resp.Session.Cost)
		}
		if resp.Session.CostCurrency != "USD" {
			t.Fatalf("cost_currency = %q, want USD", resp.Session.CostCurrency)
		}
		if curve.calls != 1 {
			t.Fatalf("curve calls = %d, want 1", curve.calls)
		}
	})

	t.Run("curve failure degrades to summary", func(t *testing.T) {
		curve := &fakeCurveLister{curveFn: func(_ context.Context, _ int64, _, _ time.Time) ([]publicCurvePoint, error) {
			return nil, errors.New("retention expired")
		}}
		h, _ := sessionShareHandler(t,
			&drivemodel.ShareToken{ID: 1, Token: "tok", ChargingSessionID: 9, IncludeTelemetry: true}, curve)
		rec := getPublic(t, h, "tok")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (degraded)", rec.Code)
		}
		var resp publicShareResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if resp.Session == nil || len(resp.Session.Curve) != 0 {
			t.Fatal("expected summary without curve on curve failure")
		}
	})

	t.Run("missing session is a 404", func(t *testing.T) {
		store := &fakeShareStore{getFn: func(_ context.Context, _ string) (*drivemodel.ShareToken, error) {
			return &drivemodel.ShareToken{ID: 1, Token: "tok", ChargingSessionID: 9}, nil
		}}
		h := &ShareHandler{shareRepo: store, sessionRepo: &fakeSessionStore{}, curveLister: &fakeCurveLister{}}
		rec := getPublic(t, h, "tok")
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rec.Code)
		}
	})

	t.Run("expired session share is gone", func(t *testing.T) {
		past := time.Now().UTC().Add(-time.Hour)
		store := &fakeShareStore{getFn: func(_ context.Context, _ string) (*drivemodel.ShareToken, error) {
			return &drivemodel.ShareToken{ID: 1, Token: "tok", ChargingSessionID: 9, ExpiresAt: &past}, nil
		}}
		h := &ShareHandler{shareRepo: store}
		rec := getPublic(t, h, "tok")
		if rec.Code != http.StatusGone {
			t.Fatalf("status = %d, want 410", rec.Code)
		}
	})
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

func TestDownsampleCurve(t *testing.T) {
	mk := func(n int) []publicCurvePoint {
		pts := make([]publicCurvePoint, n)
		for i := range pts {
			pts[i].OffsetS = int64(i * 10)
		}
		return pts
	}

	if got := downsampleCurve(mk(10), 240); len(got) != 10 {
		t.Fatalf("short curve len = %d, want 10", len(got))
	}
	got := downsampleCurve(mk(1000), 240)
	if len(got) != 240 {
		t.Fatalf("long curve len = %d, want 240", len(got))
	}
	if got[0].OffsetS != 0 || got[len(got)-1].OffsetS != 9990 {
		t.Fatalf("endpoints = %d/%d, want 0/9990", got[0].OffsetS, got[len(got)-1].OffsetS)
	}
	for i := 1; i < len(got); i++ {
		if got[i].OffsetS <= got[i-1].OffsetS {
			t.Fatalf("not monotonic at %d: %d <= %d", i, got[i].OffsetS, got[i-1].OffsetS)
		}
	}
}

func TestSessionDurationS(t *testing.T) {
	s := completedSession(1, 1)
	if got := sessionDurationS(s, time.Date(2026, 3, 16, 0, 0, 0, 0, time.UTC)); got != 2400 {
		t.Fatalf("completed = %d, want 2400", got)
	}
	open := completedSession(2, 1)
	open.EndedAt = nil
	now := open.StartedAt.Add(90 * time.Second)
	if got := sessionDurationS(open, now); got != 90 {
		t.Fatalf("open = %d, want 90", got)
	}
	skewed := completedSession(3, 1)
	future := skewed.StartedAt.Add(-time.Hour)
	skewed.EndedAt = &future
	if got := sessionDurationS(skewed, now); got != 0 {
		t.Fatalf("skewed = %d, want 0", got)
	}
}

func TestExpiryFromDays(t *testing.T) {
	if expiryFromDays(0) != nil || expiryFromDays(-5) != nil {
		t.Fatal("non-positive days must yield nil expiry")
	}
	exp := expiryFromDays(7)
	if exp == nil || time.Until(*exp) <= 6*24*time.Hour {
		t.Fatalf("7-day expiry = %v", exp)
	}
	capped := expiryFromDays(maxExpiryDays + 10_000_000)
	if capped == nil || time.Until(*capped) > (maxExpiryDays+1)*24*time.Hour {
		t.Fatalf("uncapped expiry = %v", capped)
	}
}
