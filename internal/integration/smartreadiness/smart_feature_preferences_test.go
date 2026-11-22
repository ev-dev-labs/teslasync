package smartreadiness_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/smartfeaturesvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/auth"
	featuredb "github.com/ev-dev-labs/teslasync/internal/database/smartfeature"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartfeature"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	featurehttp "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartfeature"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type featureAwareLive struct {
	*controlledLive
	onRead func()
}

func (s *featureAwareLive) GetAll(ctx context.Context, vehicleID int64, preference signal.LiveSignalReadPreference) (map[string]*signal.Value, error) {
	if s.onRead != nil {
		s.onRead()
	}
	return s.controlledLive.GetAll(ctx, vehicleID, preference)
}

func TestSmartFeatureChargingRatesAndReadinessAreIndependent(t *testing.T) {
	repo, db := testRepository(t)
	ctx := t.Context()
	now := time.Now().UTC().Truncate(time.Second)
	const owner = "synthetic-charging-feature-owner"
	plan := testPlan(now)
	plan.CompareSiteRates = true
	plan.DepartureAt = now.Add(6 * time.Hour)
	if _, err := repo.SavePlan(ctx, owner, plan, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `
			INSERT INTO geofence_rates (geofence_id, rate_per_wh, currency, effective_from, effective_to)
			VALUES (9,0.0004,'USD',$1,$2), (9,0.0001,'USD',$2,NULL)`,
		now.Add(-time.Hour), now.Add(3*time.Hour)); err != nil {
		t.Fatal(err)
	}
	live := &featureAwareLive{controlledLive: &controlledLive{values: map[string]*signal.Value{
		"BatteryLevel":             {Raw: 40.0, Timestamp: now},
		"DetailedChargeState":      {Raw: "Charging", Timestamp: now},
		"Gear":                     {Raw: "P", Timestamp: now},
		"LocationLatitude":         {Raw: 47.1, Timestamp: now},
		"LocationLongitude":        {Raw: -122.1, Timestamp: now},
		"NominalFullPackEnergyKwh": {Raw: 80000.0, Timestamp: now},
		"ACChargingPower":          {Raw: 10000.0, Timestamp: now},
	}}}
	service := smartreadinesssvc.New(repo, live, controlledSite{}, smartreadinesssvc.WithClock(func() time.Time { return now }))
	prefs := smartfeaturesvc.New(featuredb.NewRepository(db.Pool))
	set := func(feature smartfeature.Key, allowed bool) {
		t.Helper()
		if err := prefs.Set(ctx, owner, smartfeature.Preference{Feature: feature, Allowed: allowed}); err != nil {
			t.Fatal(err)
		}
	}
	check := func(status smartreadiness.LatestStartStatus, compare bool) {
		t.Helper()
		got, err := service.LatestStarts(ctx, owner, plan.VehicleID)
		if err != nil {
			t.Fatal(err)
		}
		if status == "" && len(got) == 0 {
			return
		}
		if len(got) != 1 || got[0].Status != status || (got[0].CostComparison != nil) != compare {
			t.Fatalf("latest starts = %+v, want status %q and comparison %t", got, status, compare)
		}
		if status == smartreadiness.LatestStartRatesOnly &&
			(got[0].EarlierCheckAt != nil || got[0].EarliestSafeStartAt != nil || got[0].TripProjection != nil) {
			t.Fatalf("rate comparison exposed paused readiness advice: %+v", got[0])
		}
	}

	check(smartreadiness.LatestStartEstimate, true)
	set(smartfeature.ChargingAdvice, false)
	check(smartreadiness.LatestStartRatesOnly, true)
	set(smartfeature.SiteRates, false)
	reads := live.readCount()
	check("", false)
	if live.readCount() != reads {
		t.Fatal("both features are paused but live data was read")
	}
	set(smartfeature.ChargingAdvice, true)
	check(smartreadiness.LatestStartEstimate, false)
	set(smartfeature.SiteRates, true)

	live.onRead = func() {
		set(smartfeature.ChargingAdvice, false)
		set(smartfeature.ChargingAdvice, true)
	}
	check(smartreadiness.LatestStartRatesOnly, true)
	live.onRead = func() {
		set(smartfeature.SiteRates, false)
		set(smartfeature.SiteRates, true)
	}
	check(smartreadiness.LatestStartEstimate, false)
	live.onRead = nil
	check(smartreadiness.LatestStartEstimate, true)
}

func TestSmartFeaturePreferencesPersistInTheAuthenticatedScope(t *testing.T) {
	_, db := testRepository(t)
	mount := func(header string) http.Handler {
		router := chi.NewRouter()
		router.Route("/api/v1", featurehttp.NewHandler(smartfeaturesvc.New(featuredb.NewRepository(db.Pool)), header).MountRoutes)
		return router
	}
	const base = "/api/v1/settings/smart-features"
	call := func(router http.Handler, method, path, subject, expected, payload string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, base+path, strings.NewReader(payload))
		req.Header.Set("X-Test-Subject", subject)
		req.Header.Set(auth.ExpectedPrincipalHeader, expected)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != want || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: got %d %s, want private %d", method, path, rec.Code, rec.Body, want)
		}
		return rec
	}
	list := func(router http.Handler, subject, expected string) map[smartfeature.Key]bool {
		t.Helper()
		rec := call(router, http.MethodGet, "", subject, expected, "", http.StatusOK)
		var result struct{ Data []smartfeature.Preference }
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		prefs := make(map[smartfeature.Key]bool)
		for _, pref := range result.Data {
			prefs[pref.Feature] = pref.Allowed
		}
		return prefs
	}
	signedIn := mount("X-Test-Subject")
	const owner, recipient = "synthetic-feature-owner", "synthetic-feature-recipient"
	const expectedOwner, expectedRecipient = "subject:" + owner, "subject:" + recipient
	if !list(signedIn, owner, expectedOwner)[smartfeature.RecallWatch] {
		t.Fatal("missing preference should not revoke existing feature consent")
	}
	call(signedIn, http.MethodGet, "", "", "", "", http.StatusUnauthorized)
	call(signedIn, http.MethodPut, "/recall_watch", owner, expectedRecipient, `{"allowed":false}`, http.StatusConflict)
	for _, body := range []string{`{}`, `{"allowed":null}`, `{"allowed":"false"}`} {
		call(signedIn, http.MethodPut, "/recall_watch", owner, expectedOwner, body, http.StatusBadRequest)
	}
	call(signedIn, http.MethodPut, "/not_a_feature", owner, expectedOwner, `{"allowed":false}`, http.StatusBadRequest)
	call(signedIn, http.MethodPut, "/recall_watch", owner, expectedOwner, `{"allowed":false}`, http.StatusOK)
	restarted := mount("X-Test-Subject")
	if list(restarted, owner, expectedOwner)[smartfeature.RecallWatch] || !list(restarted, recipient, expectedRecipient)[smartfeature.RecallWatch] {
		t.Fatal("pause did not persist in exactly one private scope")
	}
	open := mount("")
	prefs := list(open, owner, "open")
	if _, exists := prefs[smartfeature.RecallWatch]; exists || !prefs[smartfeature.SolarCharging] {
		t.Fatalf("unexpected shared-open preferences: %+v", prefs)
	}
	call(open, http.MethodPut, "/recall_watch", owner, "open", `{"allowed":false}`, http.StatusBadRequest)
	call(open, http.MethodPut, "/solar_charging", owner, "open", `{"allowed":false}`, http.StatusOK)
	if list(open, recipient, "open")[smartfeature.SolarCharging] || !list(restarted, owner, expectedOwner)[smartfeature.SolarCharging] {
		t.Fatal("shared-open pause crossed the authenticated account boundary")
	}
	call(restarted, http.MethodPut, "/recall_watch", owner, expectedOwner, `{"allowed":true}`, http.StatusOK)
	if !list(restarted, owner, expectedOwner)[smartfeature.RecallWatch] {
		t.Fatal("re-enable did not persist")
	}
}
