package smartreadiness_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	smartadapter "github.com/ev-dev-labs/teslasync/internal/adapter/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartdeliverysvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	actiondb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	quiethoursdb "github.com/ev-dev-labs/teslasync/internal/database/quiethours"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	deliverydb "github.com/ev-dev-labs/teslasync/internal/database/smartdelivery"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
	actiondomain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	actionhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	deliveryhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartdelivery"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	settingsmodel "github.com/ev-dev-labs/teslasync/internal/models/settings"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/go-chi/chi/v5"
)

const backupPath = "/smart-charging/backup-charging"
const backupOwner = "subject-a"

type backupEnergyFixture struct {
	t          *testing.T
	mu         sync.Mutex
	body       map[string]any
	calls      int
	beforeRead func()
}

func (f *backupEnergyFixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(r.Body)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if err != nil || len(raw) != 0 || r.Method != http.MethodGet ||
		r.URL.RequestURI() != "/api/1/energy_sites/44/live_status" ||
		r.Header.Get("Authorization") != "Bearer synthetic-energy-access" {
		f.t.Error("provider received something other than the scoped empty read-only meter request")
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if f.beforeRead != nil {
		f.beforeRead()
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"response": f.body})
}

func (f *backupEnergyFixture) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func newBackupEnergyFixture(t *testing.T, grants *smartreadinesssvc.SolarEnergyConnections,
	db *database.DB,
) (*backupEnergyFixture, *smartadapter.SolarEnergy) {
	t.Helper()
	if _, err := db.Pool.Exec(t.Context(), `CREATE TABLE settings (
		key text PRIMARY KEY, value_jsonb jsonb, value_text text,
		value_num numeric, value_bool boolean, data_kind text NOT NULL
	)`); err != nil {
		t.Fatal(err)
	}
	settings := settingsdb.NewSettingsRepo(db)
	setSmartLiveStatus(t, settings, true)
	fixture := &backupEnergyFixture{t: t}
	server := httptest.NewServer(fixture)
	t.Cleanup(server.Close)
	cfg := config.TeslaConfig{BaseURL: server.URL, Timeout: 3 * time.Second}
	client := tesla.NewClient(cfg)
	client.SetEndpointControlsReader(settings)
	return fixture, smartadapter.NewSolarEnergy(client, grants)
}

type backupJourney struct {
	*chargingDeliveryJourney
	backup      *smartreadinesssvc.BackupCharging
	connections *readinessdb.SolarEnergyConnectionRepository
	provider    *backupEnergyFixture
	energy      *smartadapter.SolarEnergy
	enc         *crypto.Encryptor
	placeAt     time.Time
	browserID   int64
}

func newBackupJourney(t *testing.T) *backupJourney {
	t.Helper()
	j := &backupJourney{chargingDeliveryJourney: newChargingDeliveryJourney(t, nil)}
	var err error
	j.enc, err = crypto.New("synthetic-test-encryption-key")
	if err != nil {
		t.Fatal(err)
	}
	j.connections = readinessdb.NewSolarEnergyConnectionRepository(j.db, j.enc)
	j.connect()
	j.provider, j.energy = newBackupEnergyFixture(t, smartreadinesssvc.NewSolarEnergyConnections(j.connections, nil), j.db)
	j.placeAt = j.now.Add(-24 * time.Hour)
	j.earlyStopExec(`UPDATE geofences SET updated_at=$1 WHERE id=9`, j.placeAt)
	applyReadinessMigration(t, j.db, "000223_action_center_state", "up")
	j.mountBackup()
	j.live.setChargeState("Charging")
	j.live.values["ChargePortLatch"].Raw = "Engaged"
	for _, sample := range j.live.values {
		sample.Timestamp = j.now.Add(-20 * time.Minute)
	}
	j.live.values["ACChargingPower"] = &signal.Value{Raw: 3500.0, Timestamp: j.now}
	j.browserID = j.enroll(backupOwner, "https://push.example.invalid/backup-browser")
	return j
}

func setSmartLiveStatus(t *testing.T, settings *settingsdb.SettingsRepo, enabled bool) {
	t.Helper()
	flags := settingsmodel.DefaultPollingConfig()
	if enabled {
		flags.SmartEndpoints = map[string]bool{tesla.EnergyLiveStatusEndpoint: true}
	}
	if err := settings.UpsertEndpointControls(t.Context(), flags); err != nil {
		t.Fatal(err)
	}
}

func (j *backupJourney) mountBackup() {
	j.t.Helper()
	now := func() time.Time { return j.now }
	j.backup = smartreadinesssvc.NewBackupCharging(readinessdb.NewRepository(j.db), j.live, controlledSite{}, true, j.energy, now)
	deliveryRepo := deliverydb.NewRepository(j.db)
	j.delivery = smartdeliverysvc.New(deliveryRepo, j.enc, j.sender, smartdeliverysvc.WithClock(now),
		smartdeliverysvc.WithBackupDelivery(deliveryRepo, j.backup), smartdeliverysvc.WithQuietHours(quiethoursdb.NewQuietHoursRepo(j.db)))
	action := actioncentersvc.New(emptySources{}, actiondb.NewStateRepository(j.db),
		actioncentersvc.WithBackupCharging(j.backup), actioncentersvc.WithClock(now))
	j.router = chi.NewRouter()
	j.router.Route("/api/v1", func(r chi.Router) {
		deliveryhandler.NewHandler(j.delivery, "X-Test-Subject").MountRoutes(r)
		readinesshandler.NewHandler(j.readiness, "X-Test-Subject",
			readinesshandler.WithBackupCharging(j.backup, j.delivery.BackupDeliveryAvailable)).MountRoutes(r)
		r.Get("/action-center", actionhandler.NewHandler(action, "X-Test-Subject").List)
	})
}

func (j *backupJourney) connect() {
	j.t.Helper()
	if err := finishTestEnergyAuthorization(j.ctx, j.connections, backupOwner, 44, time.Now().UTC()); err != nil {
		j.t.Fatal(err)
	}
}

func (j *backupJourney) settings(subject string) domain.BackupChargingSettings {
	j.t.Helper()
	rec := j.request(http.MethodGet, backupPath+"?vehicle_id=7", subject, nil)
	if rec.Code != http.StatusOK {
		j.t.Fatalf("read backup settings: %d %s", rec.Code, rec.Body)
	}
	return playlistData[domain.BackupChargingSettings](j.t, rec)
}

func (j *backupJourney) start(connection, device int64, circuit, outage bool, want int) {
	j.t.Helper()
	j.startWithDeviceRevision(connection, device, j.deviceRevision(), circuit, outage, want)
}

func (j *backupJourney) deviceRevision() time.Time {
	j.t.Helper()
	var updated time.Time
	if err := j.db.Pool.QueryRow(j.ctx, `SELECT updated_at FROM smart_push_devices WHERE id=$1`, j.browserID).Scan(&updated); err != nil {
		j.t.Fatal(err)
	}
	return updated
}

func (j *backupJourney) startWithDeviceRevision(connection, device int64, updated time.Time, circuit, outage bool, want int) {
	j.t.Helper()
	rec := j.request(http.MethodPost, backupPath, backupOwner, map[string]any{
		"vehicle_id": 7, "connection_revision": connection, "place_id": 9, "device_id": device, "place_updated_at": j.placeAt,
		"device_updated_at": updated, "same_backup_circuit_confirmed": circuit, "utility_outage_confirmed": outage,
	})
	if rec.Code != want {
		j.t.Fatalf("start backup watch: %d, want %d: %s", rec.Code, want, rec.Body)
	}
}

func (j *backupJourney) process(want int) {
	j.t.Helper()
	got, err := j.backup.ProcessBackupCharging(j.ctx, 3, j.delivery.NotifyBackupCharging)
	if err != nil || got != want {
		j.t.Fatalf("processed %d backup checks, want %d: %v", got, want, err)
	}
}

func (j *backupJourney) sample(at time.Time, island string, change func(map[string]any)) {
	j.t.Helper()
	j.provider.sample(at, island, change)
}

func (f *backupEnergyFixture) sample(at time.Time, island string, change func(map[string]any)) {
	body := map[string]any{
		"timestamp": at, "grid_status": "Unknown", "island_status": island, "backup_capable": true,
		"grid_power": 0, "solar_power": 800, "battery_power": -4200, "load_power": 5000,
	}
	if change != nil {
		change(body)
	}
	f.mu.Lock()
	f.body = body
	f.mu.Unlock()
}

func (j *backupJourney) pushState() (int, string) {
	j.t.Helper()
	n, raw := j.sender.last()
	if n <= 1 {
		return n, ""
	}
	var data map[string]string
	if err := json.Unmarshal(raw, &data); err != nil || len(data) != 2 || data["kind"] != "backup-charging" ||
		len(data["token"]) != 43 || j.sender.messages()[n-1].endpoint != "https://push.example.invalid/backup-browser" {
		j.t.Fatalf("invalid backup notification envelope or recipient")
	}
	return n, data["token"]
}

func (j *backupJourney) claimBackup(subject, token string) *httptest.ResponseRecorder {
	j.t.Helper()
	return j.request(http.MethodPost, "/smart-delivery/deliveries/claim", subject, map[string]string{"kind": "backup-charging", "token": token})
}

func TestBackupChargingPrivateOutageLifecycle(t *testing.T) {
	j := newBackupJourney(t)
	setup := j.settings(backupOwner)
	if !setup.Available || !setup.Connected || setup.ConnectionRevision <= 0 || setup.Watch != nil {
		t.Fatalf("unexpected default settings: %+v", setup)
	}
	j.process(0)
	j.start(setup.ConnectionRevision, j.browserID, true, false, http.StatusBadRequest)
	j.start(setup.ConnectionRevision, j.browserID, false, true, http.StatusBadRequest)
	j.start(setup.ConnectionRevision, j.browserID+99, true, true, http.StatusNotFound)
	if j.provider.count() != 0 {
		t.Fatal("reading settings or unconfirmed consent contacted Tesla")
	}
	j.start(setup.ConnectionRevision, j.browserID, true, true, http.StatusNoContent)
	j.sample(j.now, "off_grid", nil)
	j.process(1)
	if n, _ := j.pushState(); n != 1 || j.settings(backupOwner).Decision != nil {
		t.Fatal("a single meter pair was sufficient to create advice")
	}
	j.mountBackup()
	j.now = j.now.Add(time.Minute)
	j.live.values["ACChargingPower"].Timestamp = j.now
	j.sample(j.now, "off_grid_unintentional", nil)
	j.process(1)
	j.process(0)
	n, token := j.pushState()
	if n != 2 || j.provider.count() != 2 {
		t.Fatalf("expected one opaque delivery after restart and two meter-only requests, got %d pushes and %d reads", n, j.provider.count())
	}
	result := j.settings(backupOwner)
	if !result.Active || result.Decision == nil || result.Decision.Sample.MinimumBatteryToLoadW != 2550 || result.Decision.Sample.VehiclePowerW != 3500 {
		t.Fatalf("expected scoped conservative SI evidence: %+v", result.Decision)
	}
	j.now = j.now.Add(40 * time.Second)
	j.live.values["ACChargingPower"].Timestamp = j.now
	var action actiondomain.Response
	response := j.request(http.MethodGet, "/action-center?vehicle_id=7", backupOwner, nil)
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &action) != nil {
		t.Fatalf("read Action Center: %d %s", response.Code, response.Body)
	}
	card := action.Items
	if len(card) != 1 || len(card[0].Evidence) != 1 || card[0].Evidence[0].BackupCharging == nil {
		t.Fatalf("no authorized Action Center decision: %+v", card)
	}
	if foreign := j.settings("subject-b"); foreign.Connected || foreign.Watch != nil || foreign.Decision != nil {
		t.Fatalf("foreign identity saw private settings: %+v", foreign)
	}
	if rec := j.claimBackup("subject-b", token); rec.Code != http.StatusNotFound {
		t.Fatalf("foreign claim: %d", rec.Code)
	}
	wantLink := fmt.Sprintf("/settings/smart-charging?vehicle_id=7\\u0026backup_watch_id=%d#backup-charging", result.Watch.ID)
	if rec := j.claimBackup(backupOwner, token); rec.Code != http.StatusOK ||
		!strings.Contains(rec.Body.String(), wantLink) || !strings.Contains(rec.Body.String(), "Review your charging plan.") {
		t.Fatalf("authorized claim did not use configured copy and revision-pinned review: %d %s", rec.Code, rec.Body)
	}
	if rec := j.claimBackup(backupOwner, token); rec.Code != http.StatusNotFound {
		t.Fatalf("replayed claim: %d", rec.Code)
	}
	if j.provider.count() != 2 {
		t.Fatal("review or claim contacted Tesla")
	}
	j.now = j.now.Add(time.Minute)
	j.live.values["ACChargingPower"].Timestamp = j.now
	j.sample(j.now, "on_grid", func(body map[string]any) {
		body["grid_status"] = "Active"
		delete(body, "battery_power")
	})
	j.process(1)
	if recovered := j.settings(backupOwner); recovered.Active || recovered.Decision != nil || recovered.Watch.WatchUntil.After(j.now) {
		t.Fatalf("grid recovery failed to retire backup advice: %+v", recovered)
	}
	j.process(0)
	if n, _ := j.pushState(); n != 2 {
		t.Fatal("recovery duplicated the charging push")
	}
}

func TestBackupChargingWorkerHonorsFleetPermissionRevocation(t *testing.T) {
	j := newBackupJourney(t)
	setup := j.settings(backupOwner)
	j.start(setup.ConnectionRevision, j.browserID, true, true, http.StatusNoContent)
	j.sample(j.now, "off_grid", nil)
	j.process(1)
	if j.provider.count() != 1 {
		t.Fatal("live status must work without automatic polling or site info permission")
	}

	setSmartLiveStatus(t, settingsdb.NewSettingsRepo(j.db), false)
	j.now = j.now.Add(time.Minute)
	j.live.values["ACChargingPower"].Timestamp = j.now
	j.sample(j.now, "off_grid", nil)
	claimed, err := j.backup.ProcessBackupCharging(t.Context(), 3, nil)
	if claimed != 1 || err == nil || j.provider.count() != 1 || j.settings(backupOwner).Decision != nil {
		t.Fatalf("revoked permission should block the next worker read: claimed=%d err=%v reads=%d", claimed, err, j.provider.count())
	}
}

func TestBackupChargingClaimExpiresWhileWaitingForDeliveryLock(t *testing.T) {
	j := newBackupJourney(t)
	setup := j.settings(backupOwner)
	j.start(setup.ConnectionRevision, j.browserID, true, true, http.StatusNoContent)
	for range 2 {
		j.live.values["ACChargingPower"].Timestamp = j.now
		j.sample(j.now, "off_grid", nil)
		j.process(1)
		j.now = j.now.Add(time.Minute)
	}
	count, token := j.pushState()
	if count != 2 || token == "" {
		t.Fatal("expected a signed-in browser push before exercising claim expiry")
	}
	var deadline time.Time
	if err := j.db.Pool.QueryRow(j.ctx, `SELECT expires_at FROM smart_push_backup_charging_deliveries`).Scan(&deadline); err != nil {
		t.Fatal(err)
	}
	var current atomic.Int64
	current.Store(j.now.UnixMicro())
	clock := func() time.Time { return time.UnixMicro(current.Load()).UTC() }
	repo := deliverydb.NewRepository(j.db)
	svc := smartdeliverysvc.New(repo, j.enc, j.sender, smartdeliverysvc.WithClock(clock),
		smartdeliverysvc.WithBackupDelivery(repo, j.backup), smartdeliverysvc.WithQuietHours(quiethoursdb.NewQuietHoursRepo(j.db)))
	j.router = chi.NewRouter()
	j.router.Route("/api/v1", deliveryhandler.NewHandler(svc, "X-Test-Subject").MountRoutes)
	rec := j.claimAfterLockWait(`SELECT token_hash FROM smart_push_backup_charging_deliveries FOR UPDATE`, "%SELECT d.charging_title%",
		func() *httptest.ResponseRecorder { return j.claimBackup(backupOwner, token) },
		func() { current.Store(deadline.UnixMicro()) })
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expired backup warning remained claimable: %d %s", rec.Code, rec.Body)
	}
	var consumed bool
	if err := j.db.Pool.QueryRow(j.ctx, `SELECT EXISTS (SELECT 1 FROM smart_push_backup_charging_deliveries WHERE claimed_at IS NOT NULL)`).
		Scan(&consumed); err != nil || consumed {
		t.Fatalf("expired backup claim consumed=%t err=%v", consumed, err)
	}
}

func TestBackupChargingSuppressesUnqualifiedPairs(t *testing.T) {
	for _, mode := range []string{"unknown status", "intentional", "duplicate sample", "same vehicle sample", "stale sample", "insufficient load", "quiet hours", "daily budget"} {
		t.Run(mode, func(t *testing.T) {
			j := newBackupJourney(t)
			j.start(j.settings(backupOwner).ConnectionRevision, j.browserID, true, true, http.StatusNoContent)
			initial := j.now
			j.sample(initial, "off_grid", nil)
			j.process(1)
			j.now = j.now.Add(time.Minute)
			j.live.values["ACChargingPower"].Timestamp = j.now
			status, sampleAt := "off_grid", j.now
			var change func(map[string]any)
			switch mode {
			case "unknown status":
				status = "unavailable"
			case "intentional":
				status = "off_grid_intentional"
			case "duplicate sample":
				sampleAt = initial
			case "same vehicle sample":
				sampleAt = initial.Add(30 * time.Second)
				j.live.values["ACChargingPower"].Timestamp = initial
			case "stale sample":
				sampleAt = initial.Add(-time.Minute)
			case "insufficient load":
				change = func(body map[string]any) { body["solar_power"], body["battery_power"] = 3400, -1600 }
			case "quiet hours":
				j.earlyStopExec(`INSERT INTO notification_quiet_hours(user_id,start_local,end_local,timezone)
					VALUES ($1,'18:00','20:00','UTC')`, backupOwner)
			case "daily budget":
				for i := range 4 {
					j.earlyStopExec(`INSERT INTO smart_push_backup_charging_deliveries
						(watch_id,device_id,consented_at,outage_started_at,token_hash,status,created_at,expires_at)
						VALUES ($1,$2,$3,$3,decode(lpad($1::bigint::text,64,'0'),'hex'),'accepted',$3,$3::timestamptz+INTERVAL '1 minute')`,
						500+i, j.browserID, initial.Add(-time.Duration(i+2)*time.Hour))
				}
			}
			j.sample(sampleAt, status, change)
			j.process(1)
			if n, _ := j.pushState(); n != 1 {
				t.Fatal("unqualified evidence or policy produced a push")
			}
			wantReview := mode == "quiet hours" || mode == "daily budget"
			if got := j.settings(backupOwner).Decision != nil; got != wantReview {
				t.Fatalf("review available=%t, want=%t", got, wantReview)
			}
		})
	}
}

func TestBackupChargingDoesNotAcceptAnotherBrowser(t *testing.T) {
	j := newBackupJourney(t)
	revision := j.settings(backupOwner).ConnectionRevision
	foreignDevice := j.enroll("subject-b", "https://push.example.invalid/foreign-backup-browser")
	j.start(revision, foreignDevice, true, true, http.StatusNotFound)
	j.earlyStopExec(`UPDATE smart_push_devices SET verified_at=NULL,charging_enabled=false WHERE id=$1`, j.browserID)
	j.start(revision, j.browserID, true, true, http.StatusNotFound)
	j.process(0)
	if j.provider.count() != 0 {
		t.Fatal("foreign or unverified browser started a provider watch")
	}
}

func TestBackupChargingRejectsStaleDeviceConfirmation(t *testing.T) {
	j := newBackupJourney(t)
	revision := j.settings(backupOwner).ConnectionRevision
	previous := j.deviceRevision()
	for _, enabled := range []bool{false, true} {
		j.now = j.now.Add(time.Second)
		if err := j.delivery.SetChargingEnabled(j.ctx, backupOwner, j.browserID, enabled); err != nil {
			t.Fatal(err)
		}
	}
	j.startWithDeviceRevision(revision, j.browserID, previous, true, true, http.StatusNotFound)
	j.process(0)
	if j.provider.count() != 0 {
		t.Fatal("stale browser consent started provider checks")
	}
	j.start(revision, j.browserID, true, true, http.StatusNoContent)
	if !j.settings(backupOwner).Active {
		t.Fatal("current verified browser consent did not activate the watch")
	}
}

func TestBackupChargingRevokedWhileReadingSite(t *testing.T) {
	for _, changed := range []string{"browser disabled", "place edited"} {
		t.Run(changed, func(t *testing.T) {
			j := newBackupJourney(t)
			j.start(j.settings(backupOwner).ConnectionRevision, j.browserID, true, true, http.StatusNoContent)
			j.sample(j.now, "off_grid", nil)
			j.process(1)
			j.now = j.now.Add(time.Minute)
			j.live.values["ACChargingPower"].Timestamp = j.now
			j.sample(j.now, "off_grid", nil)
			j.provider.mu.Lock()
			j.provider.beforeRead = func() {
				var err error
				switch changed {
				case "browser disabled":
					err = j.delivery.SetChargingEnabled(j.ctx, backupOwner, j.browserID, false)
				case "place edited":
					_, err = j.db.Pool.Exec(j.ctx, `UPDATE geofences SET updated_at=updated_at+INTERVAL '1 second' WHERE id=9`)
				}
				if err != nil {
					t.Errorf("withdraw backup authorization: %v", err)
				}
			}
			j.provider.mu.Unlock()
			j.process(1)
			j.now = j.now.Add(time.Minute)
			j.process(0)
			settings := j.settings(backupOwner)
			if n, _ := j.pushState(); n != 1 || j.provider.count() != 2 || settings.Active || settings.Decision != nil {
				t.Fatal("authorization changed during the site read but private advice was retained or provider checks continued")
			}
		})
	}
}

func TestBackupChargingRevocationAndMigration(t *testing.T) {
	for _, mode := range []string{"browser disabled and re-enabled", "grant replaced", "grid returns before claim", "migration rollback"} {
		t.Run(mode, func(t *testing.T) {
			j := newBackupJourney(t)
			revision := j.settings(backupOwner).ConnectionRevision
			j.start(revision, j.browserID, true, true, http.StatusNoContent)
			for i := range 2 {
				j.now = j.now.Add(time.Duration(i) * time.Minute)
				j.live.values["ACChargingPower"].Timestamp = j.now
				j.sample(j.now, "off_grid", nil)
				j.process(1)
			}
			_, token := j.pushState()
			if token == "" {
				t.Fatal("no token to revoke")
			}
			switch mode {
			case "browser disabled and re-enabled":
				for _, enable := range []bool{false, true} {
					if err := j.delivery.SetChargingEnabled(j.ctx, backupOwner, j.browserID, enable); err != nil {
						t.Fatal(err)
					}
				}
			case "grant replaced":
				if err := j.connections.DisconnectSolarEnergy(j.ctx, backupOwner); err != nil {
					t.Fatal(err)
				}
				j.connect()
				j.start(revision, j.browserID, true, true, http.StatusNotFound)
			case "grid returns before claim":
				j.now = j.now.Add(time.Minute)
				j.live.values["ACChargingPower"].Timestamp = j.now
				j.sample(j.now, "on_grid", nil)
				j.process(1)
			case "migration rollback":
				applyReadinessMigration(t, j.db, "000314_smart_backup_charging", "down")
				applyReadinessMigration(t, j.db, "000314_smart_backup_charging", "up")
			}
			j.process(0)
			if claim := j.claimBackup(backupOwner, token); claim.Code != http.StatusNotFound || j.settings(backupOwner).Decision != nil {
				t.Fatalf("withdrawn consent/evidence was actionable: %d %s", claim.Code, claim.Body)
			}
		})
	}
}
