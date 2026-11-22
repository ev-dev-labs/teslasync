package smartreadiness_test

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	actiondb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	ownershipdb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel"
	actiondomain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	actionhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	ownershiphandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/ownershipintel"
	"github.com/ev-dev-labs/teslasync/internal/integration/smartfixture"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

const warrantyEndpoint = "/api/v1/warranty-command/warranties"

func warrantyLifecycleCount(t *testing.T, outcome string) float64 {
	t.Helper()
	families, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Fatal(err)
	}
	for _, family := range families {
		if family.GetName() != "teslasync_smart_warranty_reminder_lifecycle_total" {
			continue
		}
		for _, sample := range family.Metric {
			if len(sample.Label) == 1 && sample.Label[0].GetName() == "outcome" && sample.Label[0].GetValue() == outcome {
				return sample.GetCounter().GetValue()
			}
		}
	}
	return 0
}

func applyWarrantyFixtureMigration(t *testing.T, db *database.DB, name string) {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", name+".sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(t.Context(), string(content)); err != nil {
		t.Fatalf("apply disposable migration %s: %v", name, err)
	}
	switch name {
	case "000280_smart_cold_tire_reviews.up":
		smartfixture.PolicyColumns(t, db.Pool, "smart_cold_tire_reviews")
	case "000316_smart_shared_charger.up":
		smartfixture.PolicyColumns(t, db.Pool, "smart_shared_charger_swaps")
	case "000278_smart_warranty_reminders.up":
		smartfixture.PolicyColumns(t, db.Pool, "smart_warranty_reminders")
	case "000279_smart_trip_maintenance.up":
		smartfixture.PolicyColumns(t, db.Pool, "smart_trip_maintenance")
	case "000281_smart_recall_watch.up":
		smartfixture.PolicyColumns(t, db.Pool, "smart_recall_watches")
	case "000284_smart_climate_schedule.up":
		smartfixture.PolicyColumns(t, db.Pool, "smart_climate_schedule_plans")
	case "000298_smart_charging_cost_digests.up":
		smartfixture.PolicyColumns(t, db.Pool, "smart_charging_cost_plans", "smart_charging_cost_digests")
	case "000299_smart_monthly_tariff_reviews.up":
		smartfixture.PolicyColumns(t, db.Pool, "smart_monthly_tariff_plans", "smart_monthly_tariff_digests")
	case "000300_smart_mileage_term_reviews.up":
		smartfixture.PolicyColumns(t, db.Pool, "smart_mileage_term_plans", "smart_mileage_term_digests")
	case "000301_smart_trip_packets.up":
		smartfixture.PolicyColumns(t, db.Pool, "smart_trip_packet_plans")
	case "000302_smart_subscription_renewals.up":
		smartfixture.PolicyColumns(t, db.Pool, "smart_subscription_renewal_plans", "smart_subscription_renewal_occurrences")
	case "000303_smart_weekly_drive_efficiency.up":
		smartfixture.PolicyColumns(t, db.Pool, "smart_weekly_drive_efficiency_plans", "smart_weekly_drive_efficiency_digests")
	}
}

func seedWarrantyEvidence(t *testing.T, db *database.DB, now time.Time) {
	t.Helper()
	if _, err := db.Pool.Exec(t.Context(), `CREATE TABLE drives (
		id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
		vehicle_id bigint NOT NULL REFERENCES vehicles(id),
		started_at timestamptz NOT NULL, ended_at timestamptz, end_odometer_m double precision);
		INSERT INTO vehicles (id, display_name) VALUES (8, 'Other synthetic vehicle');`); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"000223_action_center_state.up", "000225_ownership_intelligence.up",
		"000278_smart_warranty_reminders.up", "000309_warranty_start_odometer_proof.up"} {
		applyWarrantyFixtureMigration(t, db, name)
	}
	if _, err := db.Pool.Exec(t.Context(), `INSERT INTO drives (vehicle_id,started_at,ended_at,end_odometer_m)
		SELECT 7, $1::timestamptz - (43-i*4) * interval '24 hours',
			$1::timestamptz - (42-i*4) * interval '24 hours', 70000000 + i * 800000
		FROM generate_series(0, 10) i`, now); err != nil {
		t.Fatal(err)
	}
}

func warrantyTestRouter(db *database.DB, repo *ownershipdb.DurableRepository, reminders *ownershipintelsvc.WarrantyReminders,
	header string, clock func() time.Time,
) http.Handler {
	ownership := ownershipintelsvc.New(ownershipdb.NewSourceRepository(db), repo).WithClock(clock)
	recommendations := actioncentersvc.New(emptySources{}, actiondb.NewStateRepository(db),
		actioncentersvc.WithWarrantyDistance(reminders), actioncentersvc.WithClock(clock))
	r := chi.NewRouter()
	r.Route("/api/v1", func(r chi.Router) {
		ownershiphandler.NewHandler(ownership, header).WithWarrantyReminders(reminders).MountRoutes(r)
		action := actionhandler.NewHandler(recommendations, header)
		r.Get("/action-center", action.List)
		r.Post("/action-center/{recommendationID}/actions", action.ApplyAction)
	})
	return r
}

func TestWarrantyOverviewDoesNotFallbackFromLatestCompletedOdometer(t *testing.T) {
	_, db := testRepository(t)
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	seedWarrantyEvidence(t, db, now)
	exec := func(statement string, args ...any) {
		t.Helper()
		if _, err := db.Pool.Exec(t.Context(), statement, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`ALTER TABLE vehicles ADD COLUMN vin text, ADD COLUMN enrolled_at timestamptz;
		ALTER TABLE drives ADD COLUMN start_odometer_m double precision,
		ADD COLUMN distance_m double precision, ADD COLUMN duration_s bigint,
		ADD COLUMN energy_used_wh double precision, ADD COLUMN regen_energy_wh double precision,
		ADD COLUMN avg_speed_mps double precision, ADD COLUMN max_speed_mps double precision,
		ADD COLUMN avg_power_w double precision, ADD COLUMN peak_power_w double precision,
		ADD COLUMN ambient_temp_c_avg double precision,
		ADD COLUMN start_lat double precision, ADD COLUMN start_lng double precision,
		ADD COLUMN end_lat double precision, ADD COLUMN end_lng double precision,
		ADD COLUMN start_place text, ADD COLUMN end_place text;
		CREATE TABLE charging_sessions (
			vehicle_id bigint NOT NULL, started_at timestamptz NOT NULL,
			total_energy_added_wh double precision, delta_soc_pct double precision);
		UPDATE drives SET start_odometer_m=end_odometer_m-16000, distance_m=16000, duration_s=3600`)
	repo := ownershipdb.NewDurableRepository(db)
	router := warrantyTestRouter(db, repo, ownershipintelsvc.NewWarrantyReminders(repo, clock), "X-Test-Subject", clock)
	const owner = "synthetic-warranty-overview"
	request := func(method, path, body string, status int) []byte {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("X-Test-Subject", owner)
		req.Header.Set("X-TeslaSync-Expected-Principal", "subject:"+owner)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != status {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, rec.Code, status, rec.Body.String())
		}
		return rec.Body.Bytes()
	}
	start := now.AddDate(-1, 0, 0)
	request(http.MethodPost, warrantyEndpoint, fmt.Sprintf(`{"vehicle_id":7,"kind":"basic","label":"Synthetic coverage",
		"start_at":%q,"term_s":63072000,"term_distance_m":81000000,"start_odometer_m":1000,"currency":"USD"}`,
		start.Format(time.RFC3339)), http.StatusCreated)
	read := func() domain.WarrantyOverview {
		t.Helper()
		var overview domain.WarrantyOverview
		body := request(http.MethodGet, "/api/v1/warranty-command?vehicle_id=7", "", http.StatusOK)
		if err := json.Unmarshal(body, &overview); err != nil || len(overview.Coverages) != 1 {
			t.Fatalf("expected a complete coverage response: %s (%v)", body, err)
		}
		return overview
	}
	if overview := read(); overview.OdometerM == nil || *overview.OdometerM != 78000000 ||
		overview.ActiveCount != 1 || overview.Coverages[0].ClaimWindowClosingS == nil {
		t.Fatalf("valid odometer must support current coverage: %+v", overview)
	}
	end := now.Add(-time.Hour)
	exec(`INSERT INTO drives(vehicle_id,started_at,ended_at) VALUES (7,$1,$2)`, end.Add(-time.Hour), end)
	for _, invalid := range []struct{ start, end string }{
		{"", "77000000"}, {"", "NaN"}, {"", "Infinity"}, {"", "-Infinity"}, {"", ""}, {"83000000", "80000000"},
	} {
		exec(`UPDATE drives SET start_odometer_m=NULLIF($1::text,'')::double precision,
			end_odometer_m=NULLIF($2::text,'')::double precision WHERE vehicle_id=7 AND ended_at=$3`, invalid.start, invalid.end, end)
		overview := read()
		coverage := overview.Coverages[0]
		if overview.OdometerM != nil || overview.ActiveCount != 0 || overview.ExpiringSoonCount != 0 || overview.NextExpiryAt != nil ||
			coverage.Active || coverage.Status != "undetermined" || coverage.ClaimWindowClosingS != nil ||
			coverage.ProjectedExpiryAt != nil || !coverage.TimeExpiryAt.Equal(start.Add(730*24*time.Hour)) {
			t.Fatalf("invalid latest evidence (%+v) must retain calendar facts but not imply coverage: %+v", invalid, overview)
		}
		if invalid.end == "" {
			snapshot, err := ownershipdb.NewSourceRepository(db).VehicleSnapshot(t.Context(), 7)
			if err != nil || snapshot.OdometerM == nil || *snapshot.OdometerM != 78000000 {
				t.Fatalf("the existing consumables projection lost its recorded upper odometer: %+v, %v", snapshot, err)
			}
		}
	}
}

func TestWarrantyReminderRequiresDocumentedStartingOdometer(t *testing.T) {
	_, db := testRepository(t)
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	seedWarrantyEvidence(t, db, now)
	repo := ownershipdb.NewDurableRepository(db)
	reminders := ownershipintelsvc.NewWarrantyReminders(repo, clock)
	router := warrantyTestRouter(db, repo, reminders, "X-Test-Subject", clock)
	const owner = "synthetic-warranty-baseline"
	request := func(method, path, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("X-Test-Subject", owner)
		req.Header.Set("X-TeslaSync-Expected-Principal", "subject:"+owner)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != status {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, rec.Code, status, rec.Body.String())
		}
		return rec
	}
	num := 0
	create := func(odometer string, status int) domain.Warranty {
		t.Helper()
		num++
		raw := fmt.Sprintf(`{"vehicle_id":7,"kind":"basic","label":"Synthetic distance term %d","start_at":%q,
			"term_s":63072000,"term_distance_m":81000000,"currency":"USD"%s}`,
			num, now.Add(-365*24*time.Hour).Format(time.RFC3339), odometer)
		response := request(http.MethodPost, warrantyEndpoint, raw, status)
		if status != http.StatusCreated {
			return domain.Warranty{}
		}
		var record domain.Warranty
		if err := json.Unmarshal(response.Body.Bytes(), &record); err != nil || record.ID <= 0 {
			t.Fatalf("read stored warranty: %+v %v", record, err)
		}
		return record
	}
	path := func(record domain.Warranty) string {
		return fmt.Sprintf("%s/%d/reminder?vehicle_id=7", warrantyEndpoint, record.ID)
	}
	const consent = `{"local_analysis_confirmed":true}`
	for _, value := range []string{"", `,"start_odometer_m":null`, `,"start_odometer_m":0`} {
		record := create(value, http.StatusCreated)
		if record.StartOdometerKnown {
			t.Fatalf("incomplete or legacy input qualified an unknown baseline: %s", value)
		}
		request(http.MethodPut, path(record), consent, http.StatusNotFound)
	}
	create(`,"start_odometer_m":null,"zero_start_odometer_confirmed":true`, http.StatusBadRequest)
	record := create(`,"start_odometer_m":0,"zero_start_odometer_confirmed":true`, http.StatusCreated)
	if !record.StartOdometerKnown {
		t.Fatal("an explicitly recorded zero was lost")
	}
	request(http.MethodPut, path(record), consent, http.StatusNoContent)
	if batch, err := reminders.ProcessDue(t.Context(), 20); err != nil || batch.Published != 1 {
		t.Fatalf("the documented zero should qualify one actionable reminder: %+v %v", batch, err)
	}
	const inbox = "/api/v1/action-center?vehicle_id=7&source_feature=warranty_distance"
	items := func() []actiondomain.Recommendation {
		t.Helper()
		var decoded actiondomain.Response
		if err := json.Unmarshal(request(http.MethodGet, inbox, "", http.StatusOK).Body.Bytes(), &decoded); err != nil {
			t.Fatal(err)
		}
		return decoded.Items
	}
	if got := items(); len(got) != 1 {
		t.Fatalf("qualified reminder missing: %+v", got)
	}
	applyWarrantyFixtureMigration(t, db, "000309_warranty_start_odometer_proof.down")
	applyWarrantyFixtureMigration(t, db, "000309_warranty_start_odometer_proof.up")
	var response struct {
		Data domain.WarrantyReminderSettings
	}
	if err := json.Unmarshal(request(http.MethodGet, path(record), "", http.StatusOK).Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Data.StartOdometerKnown || !response.Data.Enabled || response.Data.Projection != nil || len(items()) != 0 {
		t.Fatalf("an existing unchecked zero must hide its projection but permit removal: %+v", response.Data)
	}
	now = now.Add(25 * time.Hour)
	if batch, err := reminders.ProcessDue(t.Context(), 20); err != nil || len(batch.Outcomes) != 0 {
		t.Fatalf("an unknown baseline triggered history analysis: %+v %v", batch, err)
	}
	request(http.MethodDelete, path(record), "", http.StatusNoContent)
}

func TestWarrantyReminderUsesPrivateMeasuredRangeAndOneApproachingDecision(t *testing.T) {
	_, db := testRepository(t)
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	seedWarrantyEvidence(t, db, now)
	repo := ownershipdb.NewDurableRepository(db)
	reminders := ownershipintelsvc.NewWarrantyReminders(repo, clock)
	router := warrantyTestRouter(db, repo, reminders, "X-Test-Subject", clock)
	open := warrantyTestRouter(db, repo, reminders, "", clock)
	send := func(target http.Handler, method, path, subject, expected, input string, code int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(input))
		req.Header.Set("X-Test-Subject", subject)
		req.Header.Set("X-TeslaSync-Expected-Principal", expected)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		target.ServeHTTP(rec, req)
		if rec.Code != code {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, rec.Code, code, rec.Body.String())
		}
		return rec
	}
	owner, other := "synthetic-warranty-owner", "synthetic-warranty-other"
	call := func(method, path, input string, code int) *httptest.ResponseRecorder {
		return send(router, method, path, owner, "subject:"+owner, input, code)
	}
	create := func(label string, distance float64, termDays int) domain.Warranty {
		t.Helper()
		raw := fmt.Sprintf(`{"vehicle_id":7,"kind":"basic","label":%q,"start_at":%q,"start_odometer_m":2000000,
			"term_s":%d,"term_distance_m":%g,"currency":"USD"}`,
			label, now.Add(-365*24*time.Hour).Format(time.RFC3339), termDays*86400, distance)
		response := call(http.MethodPost, warrantyEndpoint, raw, http.StatusCreated)
		var warranty domain.Warranty
		if err := json.Unmarshal(response.Body.Bytes(), &warranty); err != nil || warranty.ID <= 0 {
			t.Fatalf("create a documented warranty: %+v, %v", warranty, err)
		}
		return warranty
	}
	warranty := create("Documented range cover", 79_000_000, 730)
	calendar := create("Calendar first cover", 79_000_000, 378)
	far := create("Distance limit beyond reminder window", 83_000_000, 730)
	endpoint := func(id int64, vehicle int) string {
		return fmt.Sprintf("%s/%d/reminder?vehicle_id=%d", warrantyEndpoint, id, vehicle)
	}
	path := endpoint(warranty.ID, 7)
	read := func(path string) domain.WarrantyReminderSettings {
		t.Helper()
		response := call(http.MethodGet, path, "", http.StatusOK)
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("private reminder is cacheable")
		}
		var wrapper struct {
			Data domain.WarrantyReminderSettings
		}
		if err := json.Unmarshal(response.Body.Bytes(), &wrapper); err != nil {
			t.Fatal(err)
		}
		return wrapper.Data
	}
	const inbox = "/api/v1/action-center?vehicle_id=7&source_feature=warranty_distance"
	list := func(subject, extra string) []actiondomain.Recommendation {
		t.Helper()
		response := send(router, http.MethodGet, inbox+extra, subject, "subject:"+subject, "", http.StatusOK)
		var decoded actiondomain.Response
		if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
			t.Fatal(err)
		}
		return decoded.Items
	}
	if off := read(path); off.Enabled || off.Projection != nil {
		t.Fatalf("warranty starts opted in: %+v", off)
	}
	const consent = `{"local_analysis_confirmed":true}`
	call(http.MethodPut, path, `{}`, http.StatusBadRequest)
	send(open, http.MethodGet, path, "", "open", "", http.StatusForbidden)
	send(router, http.MethodPut, path, domain.LegacyOpenSubject, "subject:"+domain.LegacyOpenSubject, consent, http.StatusForbidden)
	send(router, http.MethodGet, path, other, "subject:"+owner, "", http.StatusConflict)
	send(router, http.MethodGet, path, other, "subject:"+other, "", http.StatusNotFound)
	send(router, http.MethodPut, path, other, "subject:"+other, consent, http.StatusNotFound)
	call(http.MethodGet, endpoint(warranty.ID, 8), "", http.StatusNotFound)
	if batch, err := reminders.ProcessDue(t.Context(), 20); err != nil || len(batch.Outcomes) != 0 || batch.Published != 0 || len(list(owner, "")) != 0 {
		t.Fatalf("off or rejected consent has due work or advice: %+v, %v", batch, err)
	}
	for _, item := range []domain.Warranty{warranty, calendar, far} {
		call(http.MethodPut, endpoint(item.ID, 7), consent, http.StatusNoContent)
	}
	call(http.MethodPut, path, consent, http.StatusNoContent)

	var wg sync.WaitGroup
	type processed struct {
		batch ownershipintelsvc.WarrantyReminderBatch
		err   error
	}
	results := make(chan processed, 2)
	for range 2 {
		wg.Go(func() {
			batch, err := reminders.ProcessDue(t.Context(), 20)
			results <- processed{batch, err}
		})
	}
	wg.Wait()
	close(results)
	counts := make(map[domain.WarrantyReminderOutcome]int)
	published := 0
	for result := range results {
		if result.err != nil {
			t.Fatal(result.err)
		}
		for outcome, count := range result.batch.Outcomes {
			counts[outcome] += count
		}
		published += result.batch.Published
	}
	if !maps.Equal(counts, map[domain.WarrantyReminderOutcome]int{domain.WarrantyEligible: 2, domain.WarrantyCalendarFirst: 1}) || published != 1 {
		t.Fatalf("concurrent due work, calendar-first or approaching result: %+v, published %d", counts, published)
	}
	projection := read(path).Projection
	if projection == nil || projection.RemainingM != 3_000_000 || projection.ObservedDays != 11 ||
		!projection.EarliestLimitAt.Before(projection.LatestLimitAt) || !projection.LatestLimitAt.Before(projection.DocumentedTermEnd) {
		t.Fatalf("unexpected range or evidence: %+v", projection)
	}
	if read(endpoint(calendar.ID, 7)).Projection != nil || read(endpoint(far.ID, 7)).Projection == nil {
		t.Fatal("the card should suppress calendar-first but retain a qualified range outside the reminder window")
	}
	acknowledgedBefore := warrantyLifecycleCount(t, "explicitly_acknowledged")
	dismissedBefore := warrantyLifecycleCount(t, "dismissed")
	items := list(owner, "")
	if len(items) != 1 || len(list(other, "")) != 0 || items[0].NavigationPath == nil ||
		*items[0].NavigationPath != fmt.Sprintf("/ownership/warranty-command?vehicle_id=7&warranty_id=%d#warranty-mileage", warranty.ID) {
		t.Fatalf("expected one private, scoped Action Center decision: %+v", items)
	}
	send(router, http.MethodDelete, path, other, "subject:"+other, "", http.StatusNoContent)
	if !read(path).Enabled {
		t.Fatal("foreign caller removed the owner's opt-in")
	}
	item := items[0]
	actionPath := fmt.Sprintf("/api/v1/action-center/%s/actions", item.ID)
	ack := fmt.Sprintf(`{"fingerprint":%q,"action":"acknowledge","expected_version":0,"confirmed":true}`, item.Fingerprint)
	send(router, http.MethodPost, actionPath, other, "subject:"+other, ack, http.StatusNotFound)
	if warrantyLifecycleCount(t, "explicitly_acknowledged") != acknowledgedBefore || warrantyLifecycleCount(t, "dismissed") != dismissedBefore {
		t.Fatal("reading a reminder or submitting a foreign action counted as an outcome")
	}
	call(http.MethodPost, actionPath, ack, http.StatusOK)
	call(http.MethodPost, actionPath, ack, http.StatusConflict)
	call(http.MethodPost, actionPath, fmt.Sprintf(`{"fingerprint":%q,"action":"dismiss","expected_version":1,"confirmed":true}`,
		item.Fingerprint), http.StatusOK)
	if warrantyLifecycleCount(t, "explicitly_acknowledged") != acknowledgedBefore+1 || warrantyLifecycleCount(t, "dismissed") != dismissedBefore+1 {
		t.Fatal("expected one persisted acknowledgment and one dismissal")
	}
	now = now.Add(25 * time.Hour)
	restarted := ownershipintelsvc.NewWarrantyReminders(repo, clock)
	if batch, err := restarted.ProcessDue(t.Context(), 20); err != nil || batch.Published != 0 || batch.Outcomes[domain.WarrantyEligible] != 2 {
		t.Fatalf("refresh/restart did not preserve the publication: %+v, %v", batch, err)
	}
	dismissed := list(owner, "&state=dismissed")
	if len(list(owner, "&state=open")) != 0 || len(dismissed) != 1 || dismissed[0].ID != item.ID {
		t.Fatalf("refresh/restart reopened or duplicated the same warranty: %+v", dismissed)
	}
	now = projection.ExpiresAt
	if read(path).Projection != nil || len(list(owner, "")) != 0 {
		t.Fatal("stale evidence outlived its exact expiry")
	}
	claims, err := repo.ClaimWarrantyReminders(t.Context(), now, now.Add(time.Minute), 20)
	if err != nil {
		t.Fatal(err)
	}
	replaced := false
	for _, claim := range claims {
		if claim.Key.WarrantyID != warranty.ID {
			continue
		}
		call(http.MethodDelete, path, "", http.StatusNoContent)
		call(http.MethodPut, path, consent, http.StatusNoContent)
		saved, err := repo.SaveWarrantyProjection(t.Context(), claim, port.WarrantyProjectionUpdate{
			Projection: projection, CheckedAt: now, NextAt: now.Add(time.Hour), Publish: true,
		})
		if err != nil || saved {
			t.Fatalf("an in-flight claim survived revoke and re-enable: saved=%v, %v", saved, err)
		}
		replaced = true
		break
	}
	settings := read(path)
	if !replaced || !settings.Enabled || settings.Projection != nil {
		t.Fatal("re-enabling restored removed private projection")
	}
	applyWarrantyFixtureMigration(t, db, "000278_smart_warranty_reminders.down")
	var sources, warranties int
	if err := db.Pool.QueryRow(context.Background(),
		`SELECT (SELECT count(*) FROM drives), (SELECT count(*) FROM vehicle_warranties)`).Scan(&sources, &warranties); err != nil ||
		sources != 11 || warranties != 3 {
		t.Fatalf("rollback touched source terms or drives: %d / %d, %v", sources, warranties, err)
	}
	applyWarrantyFixtureMigration(t, db, "000278_smart_warranty_reminders.up")
	if read(path).Enabled {
		t.Fatal("migration round trip reinstated cleared opt-in")
	}
}
