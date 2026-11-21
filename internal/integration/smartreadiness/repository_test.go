package smartreadiness_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/database"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

func testRepository(t *testing.T) (*readinessdb.Repository, *database.DB) {
	t.Helper()
	dsn := os.Getenv("TESLASYNC_SMART_READINESS_TEST_DSN")
	if dsn == "" {
		dsn = os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN")
	}
	if dsn == "" {
		t.Skip("a disposable smart notification test database is required")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.ConnConfig.Database != "teslasync_test" && config.ConnConfig.Database != "teslasync_smart_test" {
		t.Fatal("integration test requires a database named teslasync_test or teslasync_smart_test")
	}
	ctx := context.Background()
	admin, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	schema := pgx.Identifier{fmt.Sprintf("smart_readiness_test_%d", time.Now().UnixNano())}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		if _, err := admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("drop disposable schema: %v", err)
		}
		admin.Close()
	})
	if _, err := pool.Exec(ctx, `
		CREATE TABLE vehicles (id bigint PRIMARY KEY, display_name text NOT NULL, archived_at timestamptz);
		CREATE TABLE geofences (
		  id bigint PRIMARY KEY, name text NOT NULL, enabled boolean NOT NULL,
		  needs_review boolean NOT NULL, archived_at timestamptz,
		  is_charging_location boolean NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
		  created_at timestamptz NOT NULL DEFAULT now(), category text, origin text NOT NULL DEFAULT 'manual',
		  alert_on_entry boolean NOT NULL DEFAULT false, alert_on_exit boolean NOT NULL DEFAULT false,
		  polygon_wkt text NOT NULL DEFAULT ''
		);
		CREATE TABLE geofence_rates (
		  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
		  geofence_id bigint NOT NULL REFERENCES geofences(id),
		  rate_per_wh numeric(20,10) NOT NULL, currency char(3) NOT NULL,
		  effective_from timestamptz NOT NULL, effective_to timestamptz
		);
		INSERT INTO vehicles (id, display_name) VALUES (7, 'Synthetic vehicle');
		INSERT INTO geofences (id, name, enabled, needs_review, is_charging_location)
		VALUES (9, 'Synthetic charging place', true, false, true);`); err != nil {
		t.Fatal(err)
	}
	db := &database.DB{Pool: pool}
	applyMigration(t, db, "up")
	return readinessdb.NewRepository(db), db
}

func applyMigration(t *testing.T, db *database.DB, direction string) {
	t.Helper()
	names := []string{
		"000242_journey",
		"000259_smart_commute", "000260_smart_charging_readiness", "000261_smart_charging_slow_samples",
		"000262_smart_charging_site_rate_consent", "000263_smart_personal_push",
		"000264_smart_charging_trip_legs", "000265_smart_charging_scheduled_start",
		"000266_smart_charging_schedule_power_ceiling",
		"000267_smart_departure_overlap",
		"000268_smart_commute_traffic_consent", "000269_smart_commute_personal_push",
		"000270_smart_commute_arrival_deadline",
		"000271_smart_charging_site_performance",
		"000272_smart_commute_route_energy",
		"000273_type_commute_route_energy_evidence",
		"000274_smart_public_charging_fee_terms",
		"000275_smart_solar_charging",
		"000276_smart_trip_charging_stops",
		"000277_smart_trip_reviews",
		"000283_smart_cabin_prep",
		"000285_smart_park_reserve",
		"000286_smart_overnight_drain",
		"000287_smart_capacity_trend",
		"000288_smart_window_rain",
		"000289_smart_parked_closure",
		"000290_smart_parked_unlock",
		"000291_smart_software_window",
		"000292_smart_media_playlists",
		"000293_smart_journey_soundtracks",
		"000305_smart_commute_navigation_attempts",
		"000307_smart_departure_conflict_delivery",
		"000308_smart_trip_evidence_provenance",
		"000310_smart_battery_evidence_fingerprints",
		"000312_window_rain_park_anchor",
		"000313_smart_charging_early_stop",
		"000314_smart_backup_charging",
	}
	if direction == "down" {
		for i, j := 0, len(names)-1; i < j; i, j = i+1, j-1 {
			names[i], names[j] = names[j], names[i]
		}
	}
	for _, name := range names {
		applyReadinessMigration(t, db, name, direction)
	}
}

func applyReadinessMigration(t *testing.T, db *database.DB, name, direction string) {
	t.Helper()
	file := filepath.Join("..", "..", "..", "migrations", name+"."+direction+".sql")
	content, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(context.Background(), string(content)); err != nil {
		t.Fatalf("apply %s: %v", file, err)
	}
}

func testPlan(now time.Time) domain.Plan {
	placeID := int64(9)
	return domain.Plan{
		VehicleID: 7, ChargingPlaceID: &placeID, Enabled: true,
		NotifyAt: now, DepartureAt: now.Add(12 * time.Hour),
		TripUseLowPct: 35, TripUseHighPct: 45, ReservePct: 20,
	}
}

func testDecision(now time.Time) domain.Decision {
	return domain.Decision{
		Reason: domain.ReasonEligible, Kind: domain.DecisionPlugIn, BatteryPct: 45, ArrivalLowPct: 0, ArrivalHighPct: 10,
		ObservedAt: now, ExpiresAt: now.Add(2 * time.Minute),
	}
}

func TestMigrationRoundTrip(t *testing.T) {
	_, db := testRepository(t)
	applyMigration(t, db, "down")
	var table *string
	if err := db.Pool.QueryRow(context.Background(), `SELECT to_regclass('smart_charging_plans')::text`).Scan(&table); err != nil {
		t.Fatal(err)
	}
	if table != nil {
		t.Fatalf("plan table still exists after down migration: %q", *table)
	}
	applyMigration(t, db, "up")
}

func TestTripLegMigrationPreservesSlowEvidenceAndInvalidatesNewTokensOnRollback(t *testing.T) {
	repo, db := testRepository(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, err := repo.SavePlan(ctx, "subject-a", testPlan(now), now)
	if err != nil {
		t.Fatal(err)
	}
	applyReadinessMigration(t, db, "000313_smart_charging_early_stop", "down")
	applyReadinessMigration(t, db, "000307_smart_departure_conflict_delivery", "down")
	run := func(direction string) {
		t.Helper()
		applyReadinessMigration(t, db, "000264_smart_charging_trip_legs", direction)
	}
	run("down")
	if _, err := db.Pool.Exec(ctx, `
		INSERT INTO smart_charging_decisions
		  (plan_id,battery_pct,arrival_low_pct,arrival_high_pct,observed_at,expires_at,evaluated_at)
		VALUES ($1,45,0,10,$2,$3,$2)`, plan.ID, now, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `
		INSERT INTO smart_charging_slow_samples (plan_id,plan_version,first_seen_at,last_seen_at)
		VALUES ($1,$2,$3,$4)`, plan.ID, plan.Version, now.Add(-5*time.Minute), now); err != nil {
		t.Fatal(err)
	}
	run("up")
	var kind string
	if err := db.Pool.QueryRow(ctx, `SELECT kind FROM smart_charging_decisions WHERE plan_id=$1`, plan.ID).Scan(&kind); err != nil || kind != "slow_charging" {
		t.Fatalf("upgraded slow decision kind = %q, %v", kind, err)
	}
	var deviceID int64
	if err := db.Pool.QueryRow(ctx, `
		INSERT INTO smart_push_devices
		  (subject,endpoint_hash,subscription_ciphertext,verified_at,charging_enabled,
		   verification_title,verification_body,charging_title,charging_body,created_at,updated_at)
		VALUES ('subject-a',decode(repeat('00',32),'hex'),'synthetic',$1,true,
		        'test','test','test','test',$1,$1) RETURNING id`, now).Scan(&deviceID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `
		INSERT INTO smart_push_deliveries
		  (device_id,plan_id,plan_version,departure_at,place_updated_at,decision_kind,
		   token_hash,status,created_at,expires_at)
		VALUES ($1,$2,$3,$4,$5,'trip_review',decode(repeat('11',32),'hex'),'accepted',$5,$6)`,
		deviceID, plan.ID, plan.Version, plan.DepartureAt, now, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	run("down")
	var count int
	if err := db.Pool.QueryRow(ctx, `SELECT count(*) FROM smart_push_deliveries`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("trip-review tokens after rollback = %d, %v", count, err)
	}
	run("up")
	if err := db.Pool.QueryRow(ctx, `SELECT kind FROM smart_charging_decisions WHERE plan_id=$1`, plan.ID).Scan(&kind); err != nil || kind != "slow_charging" {
		t.Fatalf("re-upgraded slow decision kind = %q, %v", kind, err)
	}
}

func TestSnoozeRevokesCandidatesAndInFlightClaims(t *testing.T) {
	repo, _ := testRepository(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, err := repo.SavePlan(ctx, "subject-a", testPlan(now), now)
	if err != nil {
		t.Fatal(err)
	}
	claim, err := repo.ClaimDue(ctx, now, false)
	if err != nil || claim == nil {
		t.Fatalf("claim = %+v, %v", claim, err)
	}
	if err := repo.FinishClaim(ctx, *claim, testDecision(now), domain.Decision{}, now); err != nil {
		t.Fatal(err)
	}
	claim, err = repo.ClaimDue(ctx, now.Add(time.Minute), false)
	if err != nil || claim == nil {
		t.Fatalf("second claim = %+v, %v", claim, err)
	}
	until := now.Add(3 * time.Minute)
	if err := repo.SnoozePlan(ctx, "subject-b", 7, plan.ID, &until, now); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("other subject snooze = %v", err)
	}
	if err := repo.SnoozePlan(ctx, "subject-a", 7, plan.ID, &until, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := repo.FinishClaim(ctx, *claim, testDecision(now), domain.Decision{}, now.Add(time.Minute)); !errors.Is(err, port.ErrClaimLost) {
		t.Fatalf("stale claim finish = %v", err)
	}
	items, err := repo.ListCandidates(ctx, "subject-a", nil, now.Add(time.Minute), 10)
	if err != nil || len(items) != 0 {
		t.Fatalf("snoozed candidates = %+v, %v", items, err)
	}
	plan.ReservePct = 25
	if _, err := repo.SavePlan(ctx, "subject-a", *plan, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	plans, err := repo.ListPlans(ctx, "subject-a", 7, 1, 0)
	if err != nil || len(plans) != 1 || plans[0].SnoozedUntil == nil || !plans[0].SnoozedUntil.Equal(until) {
		t.Fatalf("edited snoozed plan = %+v, %v", plans, err)
	}
	if skipped, err := repo.ListPlans(ctx, "subject-a", 7, 1, 1); err != nil || len(skipped) != 0 {
		t.Fatalf("offset plans = %+v, %v", skipped, err)
	}
	if early, err := repo.ClaimDue(ctx, now.Add(2*time.Minute), false); err != nil || early != nil {
		t.Fatalf("early claim = %+v, %v", early, err)
	}
	if err := repo.SnoozePlan(ctx, "subject-a", 7, plan.ID, nil, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if resumed, err := repo.ClaimDue(ctx, now.Add(2*time.Minute), false); err != nil || resumed == nil {
		t.Fatalf("resumed claim = %+v, %v", resumed, err)
	}
}

func TestActivePlansRequireCurrentPrivateConsentAndReviewedPlace(t *testing.T) {
	repo, _ := testRepository(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, err := repo.SavePlan(ctx, "subject-a", testPlan(now), now)
	if err != nil {
		t.Fatal(err)
	}
	plans, err := repo.ListActivePlans(ctx, "subject-a", 7, now, 10)
	if err != nil || len(plans) != 1 || plans[0].ID != plan.ID {
		t.Fatalf("active plans = %+v, %v", plans, err)
	}

	tests := []struct {
		name string
		sql  string
	}{
		{"disabled plan", `UPDATE smart_charging_plans SET enabled=false WHERE id=$1`},
		{"snoozed plan", `UPDATE smart_charging_plans SET snoozed_until=$2 WHERE id=$1`},
		{"not due plan", `UPDATE smart_charging_plans SET notify_at=$2 WHERE id=$1`},
		{"archived vehicle", `UPDATE vehicles SET archived_at=now() WHERE id=7`},
		{"disabled place", `UPDATE geofences SET enabled=false WHERE id=9`},
		{"unreviewed place", `UPDATE geofences SET needs_review=true WHERE id=9`},
		{"archived place", `UPDATE geofences SET archived_at=now() WHERE id=9`},
		{"place no longer charging", `UPDATE geofences SET is_charging_location=false WHERE id=9`},
		{"deleted place", `DELETE FROM geofences WHERE id=9`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repo, db := testRepository(t)
			ctx := context.Background()
			plan, err := repo.SavePlan(ctx, "subject-a", testPlan(now), now)
			if err != nil {
				t.Fatal(err)
			}
			var args []any
			switch test.name {
			case "disabled plan":
				args = []any{plan.ID}
			case "snoozed plan", "not due plan":
				args = []any{plan.ID, now.Add(time.Hour)}
			}
			if _, err := db.Pool.Exec(ctx, test.sql, args...); err != nil {
				t.Fatal(err)
			}
			plans, err := repo.ListActivePlans(ctx, "subject-a", 7, now, 10)
			if err != nil || len(plans) != 0 {
				t.Fatalf("inactive plan still listed: %+v, %v", plans, err)
			}
		})
	}
}

func TestConcurrentClaimsAndPrivateCandidates(t *testing.T) {
	repo, _ := testRepository(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, err := repo.SavePlan(ctx, "subject-a", testPlan(now), now)
	if err != nil {
		t.Fatal(err)
	}
	type result struct {
		claim *port.Claim
		err   error
	}
	const workers = 12
	results := make(chan result, workers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			claim, claimErr := repo.ClaimDue(ctx, now, false)
			results <- result{claim: claim, err: claimErr}
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	var claim *port.Claim
	for result := range results {
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.claim != nil {
			if claim != nil {
				t.Fatal("more than one worker claimed the same plan")
			}
			claim = result.claim
		}
	}
	if claim == nil || claim.Plan.ID != plan.ID {
		t.Fatalf("missing claim for saved plan: %+v", claim)
	}
	if err := repo.FinishClaim(ctx, *claim, testDecision(now), domain.Decision{}, now); err != nil {
		t.Fatal(err)
	}
	if err := repo.FinishClaim(ctx, *claim, testDecision(now), domain.Decision{}, now); !errors.Is(err, port.ErrClaimLost) {
		t.Fatalf("duplicate finish = %v, want claim lost", err)
	}
	items, err := repo.ListCandidates(ctx, "subject-a", nil, now, 10)
	if err != nil || len(items) != 1 || items[0].Plan.ID != plan.ID {
		t.Fatalf("owner candidates = %+v, %v", items, err)
	}
	items, err = repo.ListCandidates(ctx, "subject-b", nil, now, 10)
	if err != nil || len(items) != 0 {
		t.Fatalf("other subject candidates = %+v, %v", items, err)
	}
	wrongVehicle := int64(8)
	items, err = repo.ListCandidates(ctx, "subject-a", &wrongVehicle, now, 10)
	if err != nil || len(items) != 0 {
		t.Fatalf("wrong vehicle candidates = %+v, %v", items, err)
	}
	items, err = repo.ListCandidates(ctx, "subject-a", nil, now.Add(2*time.Minute), 10)
	if err != nil || len(items) != 0 {
		t.Fatalf("expired candidates = %+v, %v", items, err)
	}
	if err := repo.DeletePlan(ctx, "subject-b", plan.VehicleID, plan.ID); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("other subject deletion = %v, want not found", err)
	}
}

func TestRevocationAndExpiredLeaseInvalidateWork(t *testing.T) {
	repo, _ := testRepository(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, err := repo.SavePlan(ctx, "subject-a", testPlan(now), now)
	if err != nil {
		t.Fatal(err)
	}
	claim, err := repo.ClaimDue(ctx, now, false)
	if err != nil || claim == nil {
		t.Fatalf("claim = %+v, %v", claim, err)
	}
	if err := repo.FinishClaim(ctx, *claim, testDecision(now), domain.Decision{}, now.Add(2*time.Minute)); !errors.Is(err, port.ErrClaimLost) {
		t.Fatalf("expired lease finish = %v, want claim lost", err)
	}
	reclaimed, err := repo.ClaimDue(ctx, now.Add(2*time.Minute), false)
	if err != nil || reclaimed == nil || reclaimed.Token == claim.Token {
		t.Fatalf("restart claim = %+v, %v", reclaimed, err)
	}
	plan.Enabled = false
	if _, err := repo.SavePlan(ctx, "subject-a", *plan, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := repo.FinishClaim(ctx, *reclaimed, testDecision(now), domain.Decision{}, now.Add(2*time.Minute)); !errors.Is(err, port.ErrClaimLost) {
		t.Fatalf("revoked claim finish = %v, want claim lost", err)
	}
	items, err := repo.ListCandidates(ctx, "subject-a", nil, now.Add(2*time.Minute), 10)
	if err != nil || len(items) != 0 {
		t.Fatalf("revoked candidates = %+v, %v", items, err)
	}
}

func TestNextMinuteClaimAfterWorkFinishes(t *testing.T) {
	repo, _ := testRepository(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	if _, err := repo.SavePlan(ctx, "subject-a", testPlan(now), now); err != nil {
		t.Fatal(err)
	}
	claim, err := repo.ClaimDue(ctx, now, false)
	if err != nil || claim == nil {
		t.Fatalf("initial claim = %+v, %v", claim, err)
	}
	if err := repo.FinishClaim(ctx, *claim, testDecision(now), domain.Decision{}, now.Add(5*time.Second)); err != nil {
		t.Fatal(err)
	}
	next, err := repo.ClaimDue(ctx, now.Add(time.Minute), false)
	if err != nil || next == nil {
		t.Fatalf("next minute claim = %+v, %v", next, err)
	}
}
