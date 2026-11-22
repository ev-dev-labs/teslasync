package smartreadiness_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

func createPublicFeeEvidenceTables(t *testing.T, db *database.DB) {
	t.Helper()
	if _, err := db.Pool.Exec(t.Context(), `
		CREATE TABLE charging_sessions (
		  id bigint PRIMARY KEY, vehicle_id bigint NOT NULL, geofence_id bigint,
		  started_at timestamptz NOT NULL, ended_at timestamptz);`); err != nil {
		t.Fatal(err)
	}
	createPublicFeeSignals(t, db)
}

func createPublicFeeSignals(t *testing.T, db *database.DB) {
	t.Helper()
	if _, err := db.Pool.Exec(t.Context(), `CREATE TABLE signal_log (
		  ts timestamptz NOT NULL, vehicle_id bigint NOT NULL, field text NOT NULL,
		  value_kind smallint NOT NULL, int_value bigint, float_value double precision,
		  PRIMARY KEY (vehicle_id, ts, field));`); err != nil {
		t.Fatal(err)
	}
}

func TestPublicFeeCompletionBindsOriginalTransitionAndReviewedSite(t *testing.T) {
	ctx := context.Background()
	repo, db := testRepository(t)
	now := time.Date(2026, 4, 7, 18, 30, 0, 0, time.UTC)
	terms := domain.PublicFeeTerms{
		Subject: "synthetic-fee-owner", VehicleID: 7, PlaceID: 9, ConfirmedUnconditional: true,
		Currency: "USD", FeePerMinuteMinor: 55, GraceS: 300, SourceURL: "https://example.test/site-terms",
		PlaceUpdatedAt: now.Add(-48 * time.Hour), ConfirmedAt: now.Add(-time.Hour), ValidUntil: now.Add(time.Hour),
	}
	exec := func(statement string, parameters ...any) {
		t.Helper()
		if _, err := db.Pool.Exec(ctx, statement, parameters...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`UPDATE geofences SET updated_at = $1 WHERE id = 9`, terms.PlaceUpdatedAt)
	createPublicFeeEvidenceTables(t, db)
	save := func() {
		t.Helper()
		if err := repo.SavePublicFeeTerms(ctx, terms); err != nil {
			t.Fatal(err)
		}
	}
	resolve := func(expectedSession int64) *domain.PublicChargeCompletion {
		t.Helper()
		found, err := repo.FindPublicChargeCompletion(ctx, terms, now)
		if err != nil || (expectedSession == 0 && found != nil) ||
			(expectedSession != 0 && (found == nil || found.SessionID != expectedSession)) {
			t.Fatalf("completion = %+v, %v; want session %d", found, err, expectedSession)
		}
		return found
	}
	completedAt, lastPowerAt := now.Add(-time.Minute), now.Add(-90*time.Second)
	exec(`INSERT INTO charging_sessions VALUES (51, 7, 9, $1, $2)`, now.Add(-30*time.Minute), completedAt)
	insertState := func(at time.Time, state protomodel.DetailedChargeStateValue) {
		t.Helper()
		exec(`INSERT INTO signal_log (ts, vehicle_id, field, value_kind, int_value)
		      VALUES ($1, 7, 'DetailedChargeState', $2, $3)`, at, protomodel.ValueKindEnum, state)
	}
	insertState(now.Add(-20*time.Minute), protomodel.DetailedChargeStateValue_DetailedChargeStateCharging)
	insertState(completedAt, protomodel.DetailedChargeStateValue_DetailedChargeStateComplete)
	insertState(now.Add(-5*time.Second), protomodel.DetailedChargeStateValue_DetailedChargeStateComplete)
	exec(`INSERT INTO signal_log (ts, vehicle_id, field, value_kind, float_value)
	      VALUES ($1, 7, 'DCChargingPower', $2, 2400)`, lastPowerAt, protomodel.ValueKindFloat)

	live := &controlledLive{values: map[string]*signal.Value{
		"DetailedChargeState": {Raw: "Complete", Timestamp: now},
		"ChargePortLatch":     {Raw: "Engaged", Timestamp: now},
		"Gear":                {Raw: "P", Timestamp: now},
		"LocationLatitude":    {Raw: 47.1, Timestamp: now},
		"LocationLongitude":   {Raw: -122.1, Timestamp: now},
	}}
	service := smartreadinesssvc.New(repo, live, controlledSite{}, smartreadinesssvc.WithPublicFees(repo),
		smartreadinesssvc.WithClock(func() time.Time { return now }))
	decision := func(subject string, want bool) {
		t.Helper()
		result, err := service.FindPublicFeeDecision(ctx, subject, 7)
		if err != nil || (result != nil) != want || (want && (result.SessionID != 51 ||
			!result.EarliestFeeStartsAt.Equal(lastPowerAt.Add(5*time.Minute)))) {
			t.Fatalf("fee decision eligible = %t: got %+v, %v", want, result, err)
		}
	}
	decision(terms.Subject, false)
	if live.readCount() != 0 {
		t.Fatal("live telemetry read before individual consent")
	}
	resolve(0)
	save()
	current, err := repo.FindPublicFeeTerms(ctx, terms.Subject, terms.VehicleID, now)
	if err != nil || current == nil || !current.PlaceUpdatedAt.Equal(terms.PlaceUpdatedAt) ||
		current.SourceURL != terms.SourceURL || current.FeePerMinuteMinor != terms.FeePerMinuteMinor {
		t.Fatalf("reviewed terms not round-tripped: %+v, %v", current, err)
	}
	if foreign, err := repo.FindPublicFeeTerms(ctx, "another-owner", 7, now); err != nil || foreign != nil {
		t.Fatalf("foreign subject received terms: %+v, %v", foreign, err)
	}
	result := resolve(51)
	if !result.ChargingAt.Equal(lastPowerAt) || !result.CompletedAt.Equal(completedAt) {
		t.Fatalf("want measured charging and the first Complete, got %+v", result)
	}
	decision(terms.Subject, true)
	decision("another-owner", false)
	live.setChargeState("Charging")
	decision(terms.Subject, false)
	live.setChargeState("Complete")
	exec(`UPDATE charging_sessions SET geofence_id = NULL WHERE id = 51`)
	resolve(0)
	exec(`UPDATE charging_sessions SET geofence_id = 9 WHERE id = 51`)
	exec(`INSERT INTO charging_sessions VALUES (52, 7, NULL, $1, $2)`, now.Add(-7*time.Minute), now.Add(-time.Second))
	resolve(0)
	exec(`DELETE FROM charging_sessions WHERE id = 52`)
	insertState(now.Add(-30*time.Second), protomodel.DetailedChargeStateValue_DetailedChargeStateDisconnected)
	resolve(0)
	exec(`DELETE FROM signal_log WHERE ts = $1`, now.Add(-30*time.Second))
	exec(`UPDATE signal_log SET float_value = 0 WHERE ts = $1`, lastPowerAt)
	resolve(0)
	exec(`UPDATE signal_log SET float_value = 2400 WHERE ts = $1`, lastPowerAt)
	exec(`UPDATE geofences SET updated_at = updated_at + INTERVAL '1 second' WHERE id = 9`)
	resolve(0)
	if err := repo.SavePublicFeeTerms(ctx, terms); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("stale site review accepted: %v", err)
	}
	terms.PlaceUpdatedAt = terms.PlaceUpdatedAt.Add(time.Second)
	terms.ConfirmedAt = terms.ConfirmedAt.Add(time.Second)
	save()
	resolve(51)
	if err := repo.DeletePublicFeeTerms(ctx, terms.Subject, terms.VehicleID); err != nil {
		t.Fatal(err)
	}
	resolve(0)
	decision(terms.Subject, false)
}

func TestPublicFeeWorkerVerifiedDeviceAndOneTimelyClaim(t *testing.T) {
	j := newChargingDeliveryJourney(t, nil)
	createPublicFeeEvidenceTables(t, j.db)
	const owner = "fee-owner"
	const foreign = "other-fee-owner"
	device := j.enroll(owner, "https://fcm.googleapis.com/fcm/send/public-fee-this-browser")
	otherDevice := j.enroll(foreign, "https://fcm.googleapis.com/fcm/send/public-fee-another-browser")
	revision := j.now.Add(-time.Hour)
	if _, err := j.db.Pool.Exec(j.ctx, `UPDATE geofences SET updated_at = $1 WHERE id = 9`, revision); err != nil {
		t.Fatal(err)
	}
	terms := map[string]any{
		"vehicle_id": 7, "place_id": 9, "confirmed_public_site": true, "confirmed_unconditional": true,
		"place_updated_at": revision, "currency": "USD", "fee_per_minute_minor": 55, "grace_s": 300,
		"source_url": "https://example.test/fee-policy", "valid_until": j.now.Add(4 * time.Hour),
		"push_device_id": otherDevice, "push_title": "A charging fee may start soon",
		"push_body": "Open TeslaSync for the reviewed fee terms and timing.",
	}
	const root = "/smart-charging/public-fee-terms"
	if got := j.request(http.MethodPut, root, owner, terms); got.Code != http.StatusNotFound {
		t.Fatalf("foreign browser selection = %d: %s", got.Code, got.Body)
	}
	terms["push_device_id"] = device
	if got := j.request(http.MethodPut, root, owner, terms); got.Code != http.StatusNoContent {
		t.Fatalf("enrollment = %d: %s", got.Code, got.Body)
	}
	j.advance(j.now.Add(time.Hour))
	complete := j.now.Add(-40 * time.Second)
	if _, err := j.db.Pool.Exec(j.ctx, `INSERT INTO charging_sessions VALUES (51, 7, 9, $1, $2)`,
		j.now.Add(-30*time.Minute), complete); err != nil {
		t.Fatal(err)
	}
	if _, err := j.db.Pool.Exec(j.ctx, `
			INSERT INTO signal_log (ts, vehicle_id, field, value_kind, int_value)
			VALUES ($1, 7, 'DetailedChargeState', $3, $4), ($2, 7, 'DetailedChargeState', $3, $5)`,
		complete.Add(-25*time.Second), complete, protomodel.ValueKindEnum,
		protomodel.DetailedChargeStateValue_DetailedChargeStateCharging,
		protomodel.DetailedChargeStateValue_DetailedChargeStateComplete); err != nil {
		t.Fatal(err)
	}
	before, _ := j.sender.last()
	if count, err := j.readiness.ProcessPublicFees(j.ctx, 25, j.delivery.NotifyPublicFee); err != nil || count != 0 {
		t.Fatalf("unplugged fee processed: count=%d, err=%v", count, err)
	}
	j.live.setChargeState("Complete")
	var workers sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		workers.Go(func() {
			_, err := j.readiness.ProcessPublicFees(j.ctx, 25, j.delivery.NotifyPublicFee)
			errs <- err
		})
	}
	workers.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	after, payload := j.sender.last()
	var message map[string]string
	if after != before+1 || json.Unmarshal(payload, &message) != nil || len(message) != 2 ||
		message["kind"] != "public-fee" || message["token"] == "" {
		t.Fatalf("want exactly one token-only push, got %d attempts, %s", after-before, payload)
	}
	const claimPath = "/smart-delivery/deliveries/claim"
	if got := j.request(http.MethodPost, claimPath, foreign, message); got.Code != http.StatusNotFound {
		t.Fatalf("foreign claim = %d: %s", got.Code, got.Body)
	}
	j.live.setChargeState("Charging")
	if got := j.request(http.MethodPost, claimPath, owner, message); got.Code != http.StatusNotFound {
		t.Fatalf("resumed charge claim = %d: %s", got.Code, got.Body)
	}
	j.live.setChargeState("Complete")
	if got := j.request(http.MethodPost, claimPath, owner, message); got.Code != http.StatusOK ||
		!strings.Contains(got.Body.String(), "fee_session_id=51#public-fee") {
		t.Fatalf("owner claim = %d: %s", got.Code, got.Body)
	}
	const review = "/smart-charging/public-fee?vehicle_id=7&session_id="
	if got := j.request(http.MethodGet, review+"51", owner, nil); got.Code != http.StatusOK ||
		!strings.Contains(got.Body.String(), "https://example.test/fee-policy") {
		t.Fatalf("exact decision = %d: %s", got.Code, got.Body)
	}
	for _, response := range []*httptest.ResponseRecorder{
		j.request(http.MethodGet, review+"52", owner, nil),
		j.request(http.MethodGet, review+"51", foreign, nil),
	} {
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"decision":null`) {
			t.Fatalf("wrong decision disclosed: %d %s", response.Code, response.Body)
		}
	}
	if got := j.request(http.MethodPost, claimPath, owner, message); got.Code != http.StatusNotFound {
		t.Fatalf("duplicate claim = %d: %s", got.Code, got.Body)
	}
}

func TestPublicFeeTermsPrivateSetupAndRevoke(t *testing.T) {
	repo, db := testRepository(t)
	now := time.Date(2026, 4, 7, 18, 30, 0, 0, time.UTC)
	revision := now.Add(-time.Hour)
	if _, err := db.Pool.Exec(t.Context(), `UPDATE geofences SET updated_at = $1 WHERE id = 9`, revision); err != nil {
		t.Fatal(err)
	}
	service := smartreadinesssvc.New(repo, &controlledLive{}, controlledSite{}, smartreadinesssvc.WithPublicFees(repo),
		smartreadinesssvc.WithClock(func() time.Time { return now }))
	router := chi.NewRouter()
	readinesshandler.NewHandler(service, "X-Test-Subject").MountRoutes(router)
	const root = "/smart-charging/public-fee-terms"
	const owner = "fee-owner"
	request := func(method, path, subject, body string, status int) string {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("X-Test-Subject", subject)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != status || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: got %d %s, expected %d and no-store", method, path, rec.Code, rec.Body.String(), status)
		}
		return rec.Body.String()
	}
	read := func(subject string) *domain.PublicFeeTerms {
		t.Helper()
		result := request(http.MethodGet, root+"?vehicle_id=7", subject, "", http.StatusOK)
		var response struct {
			Data struct {
				Terms *domain.PublicFeeTerms
			}
		}
		if err := json.Unmarshal([]byte(result), &response); err != nil {
			t.Fatal(err)
		}
		return response.Data.Terms
	}
	setup := func(unconditional bool, status int) {
		t.Helper()
		body, err := json.Marshal(map[string]any{
			"vehicle_id": 7, "place_id": 9, "confirmed_public_site": true, "confirmed_unconditional": unconditional,
			"place_updated_at": revision, "currency": "USD", "fee_per_minute_minor": 55, "grace_s": 300,
			"source_url": "https://example.test/fee-policy", "valid_until": now.Add(time.Hour),
		})
		if err != nil {
			t.Fatal(err)
		}
		request(http.MethodPut, root, owner, string(body), status)
	}
	request(http.MethodGet, root+"?vehicle_id=7", "", "", http.StatusUnauthorized)
	setup(false, http.StatusBadRequest)
	if result := read(owner); result != nil {
		t.Fatalf("conditional fee was stored: %+v", result)
	}
	setup(true, http.StatusNoContent)
	if result := read(owner); result == nil || !result.ConfirmedAt.Equal(now) || result.FeePerMinuteMinor != 55 {
		t.Fatalf("owner could not retrieve reviewed terms: %+v", result)
	}
	if result := read("foreign"); result != nil {
		t.Fatalf("foreign subject could read terms: %+v", result)
	}
	request(http.MethodDelete, root+"?vehicle_id=7", owner, "", http.StatusNoContent)
	if result := read(owner); result != nil {
		t.Fatalf("revoked terms remained visible: %+v", result)
	}
}
