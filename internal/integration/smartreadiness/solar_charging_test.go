package smartreadiness_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type solarTestProvider struct {
	now         func() time.Time
	reserve     int
	live        int
	unavailable bool
}

func (s *solarTestProvider) Available(context.Context, string, int64) (bool, error) {
	return !s.unavailable, nil
}

func (s *solarTestProvider) ReadReserve(_ context.Context, _ string, siteID int64) (domain.SolarBackupReserve, error) {
	s.reserve++
	return domain.SolarBackupReserve{SiteID: siteID, ObservedAt: s.now(), Percent: 30}, nil
}

func (s *solarTestProvider) ReadObservation(_ context.Context, _ string, siteID int64) (domain.SolarSurplusObservation, error) {
	s.live++
	return domain.SolarSurplusObservation{
		SiteID: siteID, ObservedAt: s.now(), GridConnected: true, GridPowerW: -2300,
		SolarPowerW: 6000, BatteryPowerW: -750, BatteryPct: 60,
	}, nil
}

func testSolarDatabase(t *testing.T) (*readinessdb.Repository, *database.DB, *readinessdb.SolarEnergyConnectionRepository) {
	t.Helper()
	repo, db := testRepository(t)
	applySolarMigration(t, db, "up")
	applySolarMigration(t, db, "down")
	applySolarMigration(t, db, "up")
	enc, err := crypto.New("synthetic-test-encryption-key")
	if err != nil {
		t.Fatal(err)
	}
	return repo, db, readinessdb.NewSolarEnergyConnectionRepository(db, enc)
}

func applySolarMigration(t *testing.T, db *database.DB, direction string) {
	t.Helper()
	ctx := t.Context()
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000275_smart_solar_charging."+direction+".sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, string(content)); err != nil {
		t.Fatal(err)
	}
}

func TestSolarChargingConsentSamplesOnlySelectedSiteAndRevokes(t *testing.T) {
	repo, db, connections := testSolarDatabase(t)
	ctx := t.Context()
	start := time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)
	now := start
	if _, err := db.Pool.Exec(ctx, `UPDATE geofences SET updated_at = $1 WHERE id = 9`, start); err != nil {
		t.Fatal(err)
	}
	live := &controlledLive{values: map[string]*signal.Value{
		"BatteryLevel": {Raw: 45.0}, "ChargeLimitSoc": {Raw: 80.0},
		"DetailedChargeState": {Raw: "Stopped"}, "ChargePortLatch": {Raw: "Engaged"},
		"Gear": {Raw: "P"}, "LocationLatitude": {Raw: 47.1}, "LocationLongitude": {Raw: -122.1},
	}}
	setSignalClock := func() {
		for _, sample := range live.values {
			sample.Timestamp = now
		}
	}
	provider := &solarTestProvider{now: func() time.Time { return now }}
	service := smartreadinesssvc.New(repo, live, controlledSite{}, smartreadinesssvc.WithSolarCharging(repo, provider),
		smartreadinesssvc.WithClock(func() time.Time { return now }))
	process := func(want int) {
		t.Helper()
		if got, err := service.ProcessSolarCharging(ctx, 10); got != want || err != nil {
			t.Fatalf("processed %d, want %d; error: %v", got, want, err)
		}
	}
	const owner = "synthetic-solar-owner"
	const other = "synthetic-solar-other"
	if err := finishTestEnergyAuthorization(ctx, connections, owner, 44, start); err != nil {
		t.Fatal(err)
	}

	process(0)
	if provider.live != 0 || provider.reserve != 0 {
		t.Fatal("default off contacted the power site")
	}
	plan := domain.SolarChargingPlan{VehicleID: 7, PlaceID: 9, PlaceUpdatedAt: start, EnergySiteID: 45}
	if err := service.SaveSolarChargingPlan(ctx, owner, plan); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("site without the recipient's energy grant should fail closed: %v", err)
	}
	plan.EnergySiteID = 44
	if err := service.SaveSolarChargingPlan(ctx, owner, plan); err != nil {
		t.Fatal(err)
	}
	if plans, err := repo.ClaimDueSolarChargingPlans(ctx, now, now.Add(time.Minute), 1, true); err != nil || len(plans) != 0 {
		t.Fatalf("switching to shared mode claimed a personal charging plan: %v", err)
	}
	for i := range 4 {
		now = start.Add(time.Duration(i) * time.Minute)
		setSignalClock()
		process(1)
		process(0)
	}
	decision, err := service.SolarChargingDecision(ctx, owner, 7)
	if decision == nil || err != nil || decision.SiteID != 44 || decision.SampleCount != 4 ||
		decision.MinimumExportW != 2300 || provider.reserve != 1 || provider.live != 4 {
		t.Fatalf("expected sustained export after consent, got decision=%+v err=%v provider=%+v", decision, err, provider)
	}
	if foreign, err := service.SolarChargingDecision(ctx, other, 7); foreign != nil || err != nil {
		t.Fatalf("foreign subject received solar advice: %+v, %v", foreign, err)
	}
	provider.unavailable = true
	if disconnected, err := service.SolarChargingDecision(ctx, owner, 7); disconnected != nil || err != nil {
		t.Fatalf("disconnected source served cached advice: %+v, %v", disconnected, err)
	}
	provider.unavailable = false
	now = start.Add(4 * time.Minute)
	var due atomic.Int32
	var workers sync.WaitGroup
	for range 2 {
		workers.Go(func() {
			plans, err := repo.ClaimDueSolarChargingPlans(ctx, now, now.Add(time.Minute), 1, false)
			if err != nil {
				t.Error(err)
			}
			due.Add(int32(len(plans)))
		})
	}
	workers.Wait()
	if due.Load() != 1 {
		t.Fatalf("concurrent due workers claimed %d plans, want one", due.Load())
	}
	old, err := repo.FindSolarChargingPlan(ctx, owner, 7)
	if err != nil || old == nil {
		t.Fatalf("old consent missing: %+v, %v", old, err)
	}
	if err := repo.InvalidateSolarChargingEvidence(ctx, *old, old.NextCheckAt); err != nil {
		t.Fatal(err)
	}
	if current, err := repo.FindSolarChargingPlan(ctx, owner, 7); err != nil || current == nil || current.Reserve == nil {
		t.Fatalf("expired worker erased valid reserve: %+v, %v", current, err)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE geofences SET updated_at = $1 WHERE id = 9`, now); err != nil {
		t.Fatal(err)
	}
	if previous, err := service.SolarChargingDecision(ctx, owner, 7); previous != nil || err != nil {
		t.Fatalf("superseded place revision received advice: %+v, %v", previous, err)
	}
	if err := connections.DisconnectSolarEnergy(ctx, owner); err != nil {
		t.Fatal(err)
	}
	if err := finishTestEnergyAuthorization(ctx, connections, owner, 44, now); err != nil {
		t.Fatal(err)
	}
	queued, err := provider.ReadObservation(ctx, owner, 44)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.SaveSolarChargingObservation(ctx, *old, nil, queued, now); !errors.Is(err, port.ErrClaimLost) {
		t.Fatalf("revoked consent accepted an in-flight sample: %v", err)
	}
	plan.PlaceUpdatedAt = now
	if err := service.SaveSolarChargingPlan(ctx, owner, plan); err != nil {
		t.Fatal(err)
	}
	if renewed, err := service.SolarChargingDecision(ctx, owner, 7); renewed != nil || err != nil {
		t.Fatalf("new consent reused revoked evidence: %+v, %v", renewed, err)
	}
	if err := service.DeleteSolarChargingPlan(ctx, owner, 7); err != nil {
		t.Fatal(err)
	}
	now = start.Add(5 * time.Minute)
	before := provider.live
	process(0)
	if provider.live != before {
		t.Fatal("revocation did not stop subsequent provider calls")
	}
}

func finishTestEnergyAuthorization(ctx context.Context, connections *readinessdb.SolarEnergyConnectionRepository,
	subject string, siteID int64, now time.Time,
) error {
	state := sha256.Sum256([]byte("synthetic-state"))
	if err := connections.BeginEnergyAuthorization(ctx, subject, siteID, state, now.Add(time.Minute)); err != nil {
		return err
	}
	auth, err := connections.ClaimEnergyAuthorization(ctx, subject, state, now)
	if err != nil {
		return err
	}
	return connections.CompleteEnergyAuthorization(ctx, *auth, state, testEnergyTokens(now.Add(time.Hour)), now)
}

func testEnergyTokens(expiry time.Time) port.SolarEnergyTokens {
	return port.SolarEnergyTokens{
		AccessToken: "synthetic-energy-access", RefreshToken: "synthetic-energy-refresh", ExpiresAt: expiry,
	}
}

func TestSolarEnergyGrantBindingAndRevocation(t *testing.T) {
	_, db, connections := testSolarDatabase(t)
	ctx := t.Context()
	start := time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)
	state := sha256.Sum256([]byte("synthetic-connection"))
	const owner = "solar-test-owner"
	if err := connections.BeginEnergyAuthorization(ctx, owner, 44, state, start.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := connections.ClaimEnergyAuthorization(ctx, "foreign-solar-subject", state, start); !errors.Is(err, port.ErrClaimLost) {
		t.Fatalf("wrong subject redeemed the challenge: %v", err)
	}
	auth, err := connections.ClaimEnergyAuthorization(ctx, owner, state, start)
	if err != nil || auth.SiteID != 44 {
		t.Fatalf("authorized scope could not redeem its state: %v", err)
	}
	if _, err := connections.ClaimEnergyAuthorization(ctx, owner, state, start); !errors.Is(err, port.ErrClaimLost) {
		t.Fatalf("challenged state was replayable: %v", err)
	}
	if err := connections.DisconnectSolarEnergy(ctx, owner); err != nil {
		t.Fatal(err)
	}
	if err := connections.CompleteEnergyAuthorization(ctx, *auth, state, testEnergyTokens(start.Add(time.Hour)), start); !errors.Is(err, port.ErrClaimLost) {
		t.Fatalf("an in-flight callback restored a disconnected grant: %v", err)
	}
	if err := finishTestEnergyAuthorization(ctx, connections, owner, 44, start); err != nil {
		t.Fatal(err)
	}
	if token, err := connections.FindSolarEnergyAccessToken(ctx, owner, 44, start); err != nil || token != "synthetic-energy-access" {
		t.Fatalf("scoped token unavailable: %v", err)
	}
	if token, err := connections.FindSolarEnergyAccessToken(ctx, owner, 46, start); err != nil || token != "" {
		t.Fatalf("different site obtained an access token: %v", err)
	}
	var ciphertext string
	if err := db.Pool.QueryRow(ctx, `SELECT encrypted_access_token FROM smart_solar_energy_connections WHERE subject = $1`, owner).
		Scan(&ciphertext); err != nil || ciphertext == "" || ciphertext == "synthetic-energy-access" {
		t.Fatalf("token not encrypted at rest: %v", err)
	}
	expiry := start.Add(time.Hour)
	retry := expiry.Add(time.Minute)
	id, refreshToken, err := connections.ClaimSolarEnergyRefresh(ctx, owner, 44, expiry, retry)
	if err != nil || refreshToken != "synthetic-energy-refresh" {
		t.Fatalf("refresh claim unavailable: %v", err)
	}
	if _, _, err := connections.ClaimSolarEnergyRefresh(ctx, owner, 44, expiry, retry); !errors.Is(err, port.ErrClaimLost) {
		t.Fatalf("refresh claim reusable by a concurrent worker: %v", err)
	}
	if err := connections.DisconnectSolarEnergy(ctx, owner); err != nil {
		t.Fatal(err)
	}
	if err := connections.CompleteSolarEnergyRefresh(ctx, id, retry, testEnergyTokens(expiry.Add(time.Hour))); !errors.Is(err, port.ErrClaimLost) {
		t.Fatalf("in-flight refresh restored the disconnected grant: %v", err)
	}
}
