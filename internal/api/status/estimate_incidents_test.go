package status

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
	centerdb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
	center "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestHEREIncidentNotificationLifecycle(t *testing.T) {
	db := estimateTestDatabase(t)
	ctx := t.Context()
	const operator = "synthetic-operator"
	repo := dbobs.NewIncidentRepo(db)
	h := NewStatusIncidentsHandler(repo)
	if _, err := repo.Insert(ctx, dbobs.IncidentInsert{
		Title: "Existing maintenance notice", Severity: "minor", Status: "identified", Source: "manual",
	}); err != nil {
		t.Fatal(err)
	}
	health := dbobs.NewEstimateHealth(db, operator)
	sources := centerdb.NewSourceRepository(db)
	inbox := actioncentersvc.New(sources, centerdb.NewStateRepository(db),
		actioncentersvc.WithOperatorIncidentNotices(sources, operator))
	start, err := health.BeginEstimate(ctx, port.HEREFlow)
	if err != nil {
		t.Fatal(err)
	}
	if err := health.FinishEstimate(ctx, port.HEREFlow, start, true); err != nil {
		t.Fatal(err)
	}
	assertEstimateAction(t, inbox, operator, "", false, false)
	assertEstimatePredictions(t, db, start.StartedAt, true, true)
	attempts := make([]port.EstimateAttempt, 8)
	for i := range attempts {
		attempts[i], err = health.BeginEstimate(ctx, port.HEREFlow)
		if err != nil {
			t.Fatal(err)
		}
	}
	var workers sync.WaitGroup
	for _, attempt := range attempts {
		workers.Go(func() {
			if err := dbobs.NewEstimateHealth(db, operator).FinishEstimate(ctx, port.HEREFlow, attempt, false); err != nil {
				t.Error(err)
			}
		})
	}
	workers.Wait()
	assertSharedIncidentList(t, h)
	outage := assertEstimateAction(t, inbox, operator, "Estimates paused: ", false, false)
	assertEstimateAction(t, inbox, operator, "", true, false)
	assertEstimateAction(t, inbox, operator, "", false, true)
	assertEstimateAction(t, inbox, "other-operator", "", false, false)
	assertEstimateAction(t, inbox, "SYNTHETIC-OPERATOR", "", false, false)
	for _, privateExcluded := range []context.Context{
		auth.WithAppTokenSubject(ctx, operator),
		auth.WithImpersonationForTests(ctx, auth.ImpersonationClaim{OriginalAdmin: "synthetic-other-admin", Target: operator}),
	} {
		assertEstimateActions(t, privateExcluded, inbox, operator, actioncentersvc.ListFilter{})
		if _, err := inbox.ApplyAction(privateExcluded, operator, actioncentersvc.ActionRequest{
			RecommendationID: outage.ID, Fingerprint: outage.Fingerprint, Action: center.ActionAcknowledge, Confirmed: true,
		}); !errors.Is(err, actioncentersvc.ErrNotFound) {
			t.Fatalf("excluded context could acknowledge private notice: %v", err)
		}
	}
	receipt, err := inbox.ApplyAction(ctx, operator, actioncentersvc.ActionRequest{
		RecommendationID: outage.ID, Fingerprint: outage.Fingerprint, Action: center.ActionAcknowledge, Confirmed: true,
	})
	if err != nil || receipt.Event.Outcome != "applied" {
		t.Fatalf("cannot acknowledge outage without taking another action: %+v, %v", receipt, err)
	}
	history, err := inbox.History(ctx, operator, outage.ID, 10, 0)
	if err != nil || history.Total != 1 || history.Items[0].Action != center.ActionAcknowledge {
		t.Fatalf("operator cannot read the private notice audit: %+v, %v", history, err)
	}
	rollback := actioncentersvc.New(sources, centerdb.NewStateRepository(db))
	for _, read := range []struct {
		name, subject string
		ctx           context.Context
		service       *actioncentersvc.Service
	}{
		{"feature disabled", operator, ctx, rollback},
		{"foreign operator", "synthetic-other", ctx, inbox},
		{"app token", operator, auth.WithAppTokenSubject(ctx, operator), inbox},
		{"impersonated", operator, auth.WithImpersonationForTests(ctx, auth.ImpersonationClaim{}), inbox},
	} {
		t.Run(read.name, func(t *testing.T) {
			got, err := read.service.History(read.ctx, read.subject, outage.ID, 10, 0)
			if err != nil || got.Total != 0 {
				t.Fatalf("private incident audit escaped its recipient: %+v, %v", got, err)
			}
		})
	}
	if acknowledged := assertEstimateAction(t, inbox, operator, "Estimates paused: ", false, false); acknowledged.CurrentState.Status != center.StateAcknowledged {
		t.Fatalf("the same notice was not acknowledged: %+v", acknowledged)
	}
	assertEstimatePredictions(t, db, time.Now(), false, true)
	if err := health.FinishEstimate(ctx, port.HEREFlow, start, true); !errors.Is(err, port.ErrEstimatesPaused) {
		t.Fatalf("pre-outage response cleared pause: %v", err)
	}
	if _, err := dbobs.NewEstimateHealth(db, operator).BeginEstimate(ctx, port.HEREFlow); !errors.Is(err, port.ErrEstimatesPaused) {
		t.Fatalf("restart bypassed durable recovery cooldown: %v", err)
	}
	var incidentID int64
	if err := db.Pool.QueryRow(ctx, `SELECT incident_id FROM here_estimate_health WHERE feed = 'here_flow'`).Scan(&incidentID); err != nil {
		t.Fatal(err)
	}
	recovery := make(chan port.EstimateAttempt, len(attempts))
	if _, err := db.Pool.Exec(ctx, `UPDATE here_estimate_health SET next_probe_at = CLOCK_TIMESTAMP() WHERE feed = 'here_flow'`); err != nil {
		t.Fatal(err)
	}
	for range attempts {
		workers.Go(func() {
			attempt, err := health.BeginEstimate(ctx, port.HEREFlow)
			if err == nil {
				recovery <- attempt
			} else if !errors.Is(err, port.ErrEstimatesPaused) {
				t.Error(err)
			}
		})
	}
	workers.Wait()
	close(recovery)
	if len(recovery) != 1 {
		t.Fatalf("active outage leased %d recovery requests, want one", len(recovery))
	}
	resumed := <-recovery
	assertEstimateAction(t, inbox, operator, "Estimates paused: ", false, false)
	if err := dbobs.NewEstimateHealth(db, operator).FinishEstimate(ctx, port.HEREFlow, resumed, true); err != nil {
		t.Fatal(err)
	}
	if err := health.FinishEstimate(ctx, port.HEREFlow, resumed, true); !errors.Is(err, port.ErrEstimatesPaused) {
		t.Fatalf("replayed recovery was not fenced: %v", err)
	}
	notices := assertEstimateActions(t, ctx, inbox, operator, actioncentersvc.ListFilter{}, "Estimates paused: ", "Estimates resumed: ")
	if recovered := notices["Estimates resumed: "]; recovered.ID == outage.ID ||
		recovered.CurrentState.Status != center.StateOpen || !strings.Contains(recovered.Summary, "verified recovery") {
		t.Fatalf("recovery notice was not distinct from the acknowledged outage: %+v", recovered)
	}
	if original := notices["Estimates paused: "]; original.ID != outage.ID || original.Fingerprint != outage.Fingerprint ||
		original.CurrentState.Status != center.StateAcknowledged {
		t.Fatalf("recovery changed the previously acknowledged outage notice: %+v", original)
	}
	assertEstimatePredictions(t, db, start.StartedAt, false, true)
	assertEstimatePredictions(t, db, resumed.StartedAt, true, true)

	var private, shared int
	if err := db.Pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM here_estimate_incidents WHERE id = $1 AND resolved_at >= started_at),
		       (SELECT count(*) FROM status_incidents)`, incidentID).Scan(&private, &shared); err != nil {
		t.Fatal(err)
	}
	if private != 1 || shared != 1 {
		t.Fatalf("expected one resolved private occurrence and one unrelated shared row, got %d and %d", private, shared)
	}
	if rows, err := sources.ListOpenSystemIncidents(ctx, 10); err != nil || len(rows) != 1 || rows[0].Title != "Existing maintenance notice" {
		t.Fatalf("shared incident source did not preserve baseline: %+v, %v", rows, err)
	}
	assertSharedIncidentList(t, h)
	routing, err := health.BeginEstimate(ctx, port.HERERoutes)
	if err != nil {
		t.Fatal(err)
	}
	if err := health.FinishEstimate(ctx, port.HERERoutes, routing, false); err != nil {
		t.Fatal(err)
	}
	assertEstimatePredictions(t, db, time.Now(), false, false)
}

func TestHEREIncidentWithoutRecipientStillFencesEstimates(t *testing.T) {
	db := estimateTestDatabase(t)
	ctx := t.Context()
	const operator = "synthetic-operator"
	repo, sources := dbobs.NewIncidentRepo(db), centerdb.NewSourceRepository(db)
	health := dbobs.NewEstimateHealth(db, "")
	if health == nil {
		t.Fatal("health tracking must not depend on a notice recipient")
	}
	before, err := health.BeginEstimate(ctx, port.HERERoutes)
	if err != nil {
		t.Fatal(err)
	}
	if err := health.FinishEstimate(ctx, port.HERERoutes, before, false); err != nil {
		t.Fatal(err)
	}
	assertEstimatePredictions(t, db, time.Now(), false, false)
	if _, err := health.BeginEstimate(ctx, port.HERERoutes); !errors.Is(err, port.ErrEstimatesPaused) {
		t.Fatalf("no-recipient outage was not fenced: %v", err)
	}
	if err := health.FinishEstimate(ctx, port.HERERoutes, before, true); !errors.Is(err, port.ErrEstimatesPaused) {
		t.Fatalf("stale success cleared the no-recipient outage: %v", err)
	}

	var id int64
	var subject string
	if err := db.Pool.QueryRow(ctx, `SELECT id, operator_subject FROM here_estimate_incidents`).Scan(&id, &subject); err != nil || subject != "" {
		t.Fatalf("no-recipient incident should have an internal marker; got %q, %v", subject, err)
	}
	if _, err := repo.Get(ctx, id); !errors.Is(err, dbobs.ErrIncidentNotFound) {
		t.Fatalf("internal incident leaked through shared details: %v", err)
	}
	if incidents, err := repo.List(ctx, dbobs.IncidentListParams{ActiveOnly: true}); err != nil || len(incidents) != 0 {
		t.Fatalf("internal incident leaked through shared list: %+v, %v", incidents, err)
	}
	if incidents, err := sources.ListOpenSystemIncidents(ctx, 10); err != nil || len(incidents) != 0 {
		t.Fatalf("internal incident leaked through shared Action Center source: %+v, %v", incidents, err)
	}
	assertNoNotice := func() {
		for _, subject := range []string{"", operator} {
			rows, err := sources.ListOperatorIncidentNotices(ctx, subject, time.Now().Add(-time.Hour), 10)
			if err != nil || len(rows) != 0 {
				t.Fatalf("internal incident emitted a notice: %+v, %v", rows, err)
			}
		}
	}
	assertNoNotice()

	if _, err := db.Pool.Exec(ctx, `UPDATE here_estimate_health SET next_probe_at = CLOCK_TIMESTAMP() WHERE feed = 'here_routes'`); err != nil {
		t.Fatal(err)
	}
	health = dbobs.NewEstimateHealth(db, operator)
	probe, err := health.BeginEstimate(ctx, port.HERERoutes)
	if err != nil || !probe.Recovery {
		t.Fatalf("could not lease a fresh recovery after restart: %+v, %v", probe, err)
	}
	if err := health.FinishEstimate(ctx, port.HERERoutes, probe, true); err != nil {
		t.Fatal(err)
	}
	if err := health.FinishEstimate(ctx, port.HERERoutes, before, false); err != nil {
		t.Fatal(err)
	}
	assertEstimatePredictions(t, db, before.StartedAt, false, false)
	assertEstimatePredictions(t, db, probe.StartedAt, true, true)
	assertNoNotice()
}

func TestHEREIncidentRecoveredBetweenOperatorVisits(t *testing.T) {
	db := estimateTestDatabase(t)
	ctx := t.Context()
	const operator = "synthetic-operator"
	health := dbobs.NewEstimateHealth(db, operator)
	attempt, err := health.BeginEstimate(ctx, port.HEREImport)
	if err != nil {
		t.Fatal(err)
	}
	if err := health.FinishEstimate(ctx, port.HEREImport, attempt, false); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE here_estimate_health SET next_probe_at = CLOCK_TIMESTAMP() WHERE feed = 'here_import'`); err != nil {
		t.Fatal(err)
	}
	recovery, err := health.BeginEstimate(ctx, port.HEREImport)
	if err != nil || !recovery.Recovery {
		t.Fatalf("could not lease a fresh recovery: %+v, %v", recovery, err)
	}
	if err := health.FinishEstimate(ctx, port.HEREImport, recovery, true); err != nil {
		t.Fatal(err)
	}

	sources := centerdb.NewSourceRepository(db)
	now := time.Now()
	inbox := actioncentersvc.New(sources, centerdb.NewStateRepository(db),
		actioncentersvc.WithClock(func() time.Time { return now }),
		actioncentersvc.WithOperatorIncidentNotices(sources, operator))
	const paused, resumed = "Estimates paused: ", "Estimates resumed: "
	first := assertEstimateActions(t, ctx, inbox, operator, actioncentersvc.ListFilter{}, paused, resumed)
	outage, recovered := first[paused], first[resumed]
	if outage.ID == recovered.ID || outage.Fingerprint == recovered.Fingerprint ||
		outage.CurrentState.Status != center.StateOpen || recovered.CurrentState.Status != center.StateOpen ||
		!outage.Evidence[0].ObservedAt.Before(*recovered.Evidence[0].ObservedAt) {
		t.Fatalf("first visit did not see two distinct, ordered transitions: %+v", first)
	}
	if _, err := inbox.ApplyAction(ctx, operator, actioncentersvc.ActionRequest{
		RecommendationID: outage.ID, Fingerprint: outage.Fingerprint, Action: center.ActionDismiss, Confirmed: true,
	}); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Minute)
	polled := assertEstimateActions(t, ctx, inbox, operator, actioncentersvc.ListFilter{}, paused, resumed)
	for _, prefix := range []string{paused, resumed} {
		if polled[prefix].ID != first[prefix].ID || polled[prefix].Fingerprint != first[prefix].Fingerprint {
			t.Fatalf("polling changed the identity of %q: %+v", prefix, polled[prefix])
		}
	}
	if polled[paused].CurrentState.Status != center.StateDismissed || polled[resumed].CurrentState.Status != center.StateOpen {
		t.Fatalf("polling jumped the notice state: %+v", polled)
	}
}

func assertEstimateAction(t *testing.T, inbox *actioncentersvc.Service, subject, prefix string, hidePrivate, shared bool) *center.Recommendation {
	t.Helper()
	filter := actioncentersvc.ListFilter{ExcludePrivate: hidePrivate, SharedOpenMode: shared}
	if prefix == "" {
		assertEstimateActions(t, t.Context(), inbox, subject, filter)
		return nil
	}
	notice := assertEstimateActions(t, t.Context(), inbox, subject, filter, prefix)[prefix]
	return &notice
}

func assertEstimateActions(
	t *testing.T, ctx context.Context, inbox *actioncentersvc.Service, subject string,
	filter actioncentersvc.ListFilter, prefixes ...string,
) map[string]center.Recommendation {
	t.Helper()
	source := center.SourceSystemHealth
	filter.SourceFeature = &source
	result, err := inbox.List(ctx, subject, filter)
	if err != nil {
		t.Fatal(err)
	}
	notices := make(map[string]center.Recommendation)
	for _, item := range result.Items {
		if !strings.HasPrefix(item.Title, "Estimates ") {
			continue
		}
		var prefix string
		for _, expected := range prefixes {
			if strings.HasPrefix(item.Title, expected) {
				prefix = expected
				break
			}
		}
		if prefix == "" || notices[prefix].ID != "" || item.ProjectedImpact != nil ||
			len(item.Evidence) != 1 || item.Evidence[0].Provenance.Source != "here_estimate_incidents" {
			t.Fatalf("unexpected or repeated Action Center incident notice: %+v", item)
		}
		notices[prefix] = item
	}
	if len(notices) != len(prefixes) {
		t.Fatalf("wanted private Action Center notices %q for subject %q, got %+v", prefixes, subject, result.Items)
	}
	return notices
}

func assertSharedIncidentList(t *testing.T, h *StatusIncidentsHandler) {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/status/incidents", nil)
	w := httptest.NewRecorder()
	h.List(w, r)
	body := w.Body.String()
	if w.Code != http.StatusOK || !strings.Contains(body, "Existing maintenance notice") ||
		strings.Contains(body, "HERE") {
		t.Fatalf("shared incident list changed unrelated visibility: %d %s", w.Code, body)
	}
}

func assertEstimatePredictions(t *testing.T, db *database.DB, observed time.Time, commute, road bool) {
	t.Helper()
	var gotCommute, gotRoad bool
	if err := db.Pool.QueryRow(t.Context(), `
		SELECT here_estimates_usable($1), here_estimates_usable($1, 'here_routes')`, observed).Scan(&gotCommute, &gotRoad); err != nil {
		t.Fatal(err)
	}
	if gotCommute != commute || gotRoad != road {
		t.Fatalf("commute = %v, road = %v; want %v, %v", gotCommute, gotRoad, commute, road)
	}
}

func estimateTestDatabase(t *testing.T) *database.DB {
	t.Helper()
	dsn := os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN")
	if dsn == "" {
		t.Skip("set TESLASYNC_SMART_COMMUTE_TEST_DSN to run PostgreSQL incident tests")
	}
	ctx := t.Context()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := pgx.Identifier{fmt.Sprintf("s48_test_%d", time.Now().UnixNano())}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	for _, migration := range []string{
		"000198_status_incidents.up.sql", "000223_action_center_state.up.sql", "000318_here_estimate_health.up.sql",
	} {
		applyEstimateTestMigration(t, pool, migration)
	}
	return &database.DB{Pool: pool}
}

func TestHEREIncidentMigrationRollbackIsPrivate(t *testing.T) {
	db := estimateTestDatabase(t)
	ctx := t.Context()
	const operator = "synthetic-operator"
	health := dbobs.NewEstimateHealth(db, operator)
	sources := centerdb.NewSourceRepository(db)
	inbox := actioncentersvc.New(sources, centerdb.NewStateRepository(db),
		actioncentersvc.WithOperatorIncidentNotices(sources, operator))
	open := func() *center.Recommendation {
		t.Helper()
		attempt, err := health.BeginEstimate(ctx, port.HEREImport)
		if err != nil {
			t.Fatal(err)
		}
		if err := health.FinishEstimate(ctx, port.HEREImport, attempt, false); err != nil {
			t.Fatal(err)
		}
		return assertEstimateAction(t, inbox, operator, "Estimates paused: ", false, false)
	}
	before := open()
	if _, err := inbox.ApplyAction(ctx, operator, actioncentersvc.ActionRequest{
		RecommendationID: before.ID, Fingerprint: before.Fingerprint, Action: center.ActionDismiss, Confirmed: true,
	}); err != nil {
		t.Fatal(err)
	}
	applyEstimateTestMigration(t, db.Pool, "000318_here_estimate_health.down.sql")
	var privateSchemaGone bool
	if err := db.Pool.QueryRow(ctx, `
		SELECT to_regclass('here_estimate_incidents') IS NULL
			AND to_regclass('here_estimate_health') IS NULL
			AND to_regprocedure('here_estimates_usable(timestamptz,text)') IS NULL`).Scan(&privateSchemaGone); err != nil || !privateSchemaGone {
		t.Fatalf("rollback left private incident storage or its fence: %t, %v", privateSchemaGone, err)
	}
	applyEstimateTestMigration(t, db.Pool, "000318_here_estimate_health.up.sql")
	assertEstimatePredictions(t, db, time.Now(), true, true)
	after := open()
	if after.ID == before.ID || after.CurrentState.Status != center.StateOpen {
		t.Fatalf("replayed migration caused a new outage to inherit an old dismissal: %+v", after)
	}
}

func applyEstimateTestMigration(t *testing.T, pool *pgxpool.Pool, name string) {
	t.Helper()
	fixture, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", name))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), string(fixture)); err != nil {
		t.Fatalf("apply %s: %v", name, err)
	}
}
