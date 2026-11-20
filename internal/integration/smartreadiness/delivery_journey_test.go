package smartreadiness_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/smartdeliverysvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	quiethoursdb "github.com/ev-dev-labs/teslasync/internal/database/quiethours"
	deliverydb "github.com/ev-dev-labs/teslasync/internal/database/smartdelivery"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	readiness "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	deliveryhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartdelivery"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	deliveryport "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
	readinessport "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type sentPush struct {
	endpoint string
	payload  []byte
}

type controlledPushSender struct {
	mu      sync.Mutex
	enabled bool
	status  domain.DeliveryStatus
	calls   int
	payload []byte
	sent    []sentPush
}

func (s *controlledPushSender) IsEnabled() bool { return s.enabled }
func (s *controlledPushSender) PublicKey() string {
	return "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM"
}
func (s *controlledPushSender) Send(
	_ context.Context, sub domain.Subscription, payload []byte, _ time.Duration,
) (domain.DeliveryStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.payload = append([]byte(nil), payload...)
	s.sent = append(s.sent, sentPush{endpoint: sub.Endpoint, payload: append([]byte(nil), payload...)})
	return s.status, nil
}

func (s *controlledPushSender) last() (int, []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls, append([]byte(nil), s.payload...)
}

func (s *controlledPushSender) messages() []sentPush {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]sentPush, len(s.sent))
	copy(result, s.sent)
	return result
}

type chargingDeliveryJourney struct {
	t         *testing.T
	ctx       context.Context
	db        *database.DB
	now       time.Time
	live      *controlledLive
	sender    *controlledPushSender
	delivery  *smartdeliverysvc.Service
	readiness *smartreadinesssvc.Service
	router    chi.Router
}

func newChargingDeliveryJourney(t *testing.T, wrap func(*controlledPushSender) smartdeliverysvc.Sender) *chargingDeliveryJourney {
	t.Helper()
	repo, db := testRepository(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	if _, err := db.Pool.Exec(ctx, `CREATE TABLE notification_logs (id bigint, status text, created_at timestamptz)`); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000170_quiet_hours.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	enc, err := crypto.New("synthetic-test-encryption-key")
	if err != nil {
		t.Fatal(err)
	}
	j := &chargingDeliveryJourney{
		t: t, ctx: ctx, db: db, now: time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC),
		sender: &controlledPushSender{enabled: true, status: domain.DeliveryAccepted},
	}
	j.live = &controlledLive{values: map[string]*signal.Value{
		"BatteryLevel":        {Raw: 45.0},
		"DetailedChargeState": {Raw: "Disconnected"},
		"ChargePortLatch":     {Raw: "Engaged"},
		"Gear":                {Raw: "P"},
		"LocationLatitude":    {Raw: 47.1},
		"LocationLongitude":   {Raw: -122.1},
	}}
	j.advance(j.now)
	var delivery *smartdeliverysvc.Service
	j.readiness = smartreadinesssvc.New(repo, j.live, controlledSite{},
		smartreadinesssvc.WithPublicFees(repo),
		smartreadinesssvc.WithClock(func() time.Time { return j.now }),
		smartreadinesssvc.WithCandidateNotifier(func(ctx context.Context, candidate readinessport.Candidate) error {
			return delivery.NotifyCharging(ctx, candidate)
		}))
	var sender smartdeliverysvc.Sender = j.sender
	if wrap != nil {
		sender = wrap(j.sender)
	}
	deliveryRepo := deliverydb.NewRepository(db)
	delivery = smartdeliverysvc.New(deliveryRepo, enc, sender,
		smartdeliverysvc.WithClock(func() time.Time { return j.now }),
		smartdeliverysvc.WithChargingCandidates(j.readiness),
		smartdeliverysvc.WithPublicFeeDelivery(deliveryRepo, j.readiness),
		smartdeliverysvc.WithQuietHours(quiethoursdb.NewQuietHoursRepo(db)))
	j.delivery = delivery
	j.router = chi.NewRouter()
	j.router.Route("/api/v1", func(r chi.Router) {
		deliveryhandler.NewHandler(delivery, "X-Test-Subject").MountRoutes(r)
		readinesshandler.NewHandler(j.readiness, "X-Test-Subject").MountRoutes(r)
	})
	return j
}

func (j *chargingDeliveryJourney) advance(now time.Time) {
	j.t.Helper()
	j.now = now
	j.live.mu.Lock()
	defer j.live.mu.Unlock()
	for _, value := range j.live.values {
		value.Timestamp = now
	}
}

func (j *chargingDeliveryJourney) request(method, path, subject string, body any) *httptest.ResponseRecorder {
	j.t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		j.t.Fatal(err)
	}
	req := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(data)).WithContext(j.ctx)
	req.Header.Set("X-Test-Subject", subject)
	rec := httptest.NewRecorder()
	j.router.ServeHTTP(rec, req)
	return rec
}

func (j *chargingDeliveryJourney) enroll(subject, endpoint string) int64 {
	j.t.Helper()
	sub := domain.Subscription{
		Endpoint: endpoint,
		P256DH:   "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
		Auth:     "tBHItJI5svbpez7KI4CCXg",
	}
	body := struct {
		Subscription domain.Subscription `json:"subscription"`
		Texts        domain.Texts        `json:"texts"`
	}{
		Subscription: sub,
		Texts: domain.Texts{
			VerificationTitle: "TeslaSync", VerificationBody: "This device is ready.",
			ChargingTitle: "Charging readiness", ChargingBody: "Review your charging plan.",
		},
	}
	rec := j.request(http.MethodPost, "/smart-delivery/devices", subject, body)
	var response struct {
		Data domain.Device `json:"data"`
	}
	if rec.Code != http.StatusCreated || json.Unmarshal(rec.Body.Bytes(), &response) != nil {
		j.t.Fatalf("enrollment = %d %s", rec.Code, rec.Body.String())
	}
	_, payload := j.sender.last()
	var challenge struct {
		Token string `json:"token"`
	}
	if json.Unmarshal(payload, &challenge) != nil || challenge.Token == "" {
		j.t.Fatal("verification challenge is missing")
	}
	path := "/smart-delivery/devices/" + strconv.FormatInt(response.Data.ID, 10)
	rec = j.request(http.MethodPost, path+"/verify", subject, map[string]string{"token": challenge.Token})
	if rec.Code != http.StatusOK {
		j.t.Fatalf("verification = %d %s", rec.Code, rec.Body.String())
	}
	rec = j.request(http.MethodPut, path+"/charging", subject, map[string]bool{"enabled": true})
	if rec.Code != http.StatusNoContent {
		j.t.Fatalf("charging opt-in = %d %s", rec.Code, rec.Body.String())
	}
	return response.Data.ID
}

func (j *chargingDeliveryJourney) savePlan() readiness.Plan {
	j.t.Helper()
	rec := j.request(http.MethodPost, "/smart-charging/plans", "subject-a", testPlan(j.now))
	var response struct {
		Data readiness.Plan `json:"data"`
	}
	if rec.Code != http.StatusCreated || json.Unmarshal(rec.Body.Bytes(), &response) != nil {
		j.t.Fatalf("plan creation = %d %s", rec.Code, rec.Body.String())
	}
	return response.Data
}

func (j *chargingDeliveryJourney) process() {
	j.t.Helper()
	if _, err := j.readiness.ProcessDue(j.ctx, 50); err != nil {
		j.t.Fatalf("process charging work: %v", err)
	}
}

func (j *chargingDeliveryJourney) claimToken() string {
	j.t.Helper()
	_, payload := j.sender.last()
	var push struct {
		Kind  string `json:"kind"`
		Token string `json:"token"`
	}
	if json.Unmarshal(payload, &push) != nil || push.Kind != "charging" || push.Token == "" {
		j.t.Fatalf("invalid charging push payload %s", payload)
	}
	for _, private := range []string{"subject-a", "Synthetic", "47.1", "Charging readiness"} {
		if bytes.Contains(payload, []byte(private)) {
			j.t.Fatal("push payload contained private recommendation details")
		}
	}
	return push.Token
}

func (j *chargingDeliveryJourney) claim(subject, token string) *httptest.ResponseRecorder {
	j.t.Helper()
	return j.request(http.MethodPost, "/smart-delivery/deliveries/claim", subject, map[string]string{"token": token})
}

func TestPersonalChargingDeliveryJourney(t *testing.T) {
	j := newChargingDeliveryJourney(t, nil)
	j.enroll("subject-a", "https://push.example.invalid/device-a")
	j.enroll("subject-b", "https://push.example.invalid/device-b")
	j.savePlan()
	if _, err := j.db.Pool.Exec(j.ctx, `
			INSERT INTO notification_quiet_hours (user_id,start_local,end_local,timezone)
			VALUES ('subject-a','18:00','20:00','UTC')`); err != nil {
		t.Fatal(err)
	}
	j.process()
	if calls, _ := j.sender.last(); calls != 2 {
		t.Fatalf("quiet-hours dispatch sent a recommendation: %d pushes", calls)
	}
	if _, err := j.db.Pool.Exec(j.ctx, `DELETE FROM notification_quiet_hours WHERE user_id='subject-a'`); err != nil {
		t.Fatal(err)
	}
	j.advance(j.now.Add(time.Minute))
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := j.readiness.ProcessDue(j.ctx, 50)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent charging worker: %v", err)
		}
	}
	messages := j.sender.messages()
	if len(messages) != 3 || messages[2].endpoint != "https://push.example.invalid/device-a" {
		t.Fatalf("private dispatch sent %d messages to the wrong recipient", len(messages))
	}
	token := j.claimToken()
	if rec := j.claim("subject-b", token); rec.Code != http.StatusNotFound {
		t.Fatalf("another subject claimed the notification: %d", rec.Code)
	}
	rec := j.claim("subject-a", token)
	var notification struct {
		Data domain.Notification `json:"data"`
	}
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &notification) != nil ||
		notification.Data.Title != "Charging readiness" || notification.Data.URL != "/action-center?vehicle_id=7" {
		t.Fatalf("authorized claim = %d %s", rec.Code, rec.Body.String())
	}
	if rec := j.claim("subject-a", token); rec.Code != http.StatusNotFound {
		t.Fatalf("claimed notification was replayed: %d", rec.Code)
	}
	j.advance(j.now.Add(time.Minute))
	j.process()
	if calls, _ := j.sender.last(); calls != 3 {
		t.Fatalf("restart/re-evaluation duplicated the notification: %d pushes", calls)
	}
}

func TestScheduleConflictUsesPrivateDeliveryAndRechecksPending(t *testing.T) {
	j := newChargingDeliveryJourney(t, nil)
	j.enroll("subject-a", "https://push.example.invalid/device-a")
	j.enroll("subject-b", "https://push.example.invalid/device-b")
	plan := testPlan(j.now)
	ceilingW := 3200.0
	plan.ScheduledStart = &readiness.ScheduledStart{At: plan.DepartureAt.Add(-time.Hour), TimeZone: "UTC", PowerCeilingW: &ceilingW}
	rec := j.request(http.MethodPost, "/smart-charging/plans", "subject-a", plan)
	var saved struct {
		Data readiness.Plan `json:"data"`
	}

	if rec.Code != http.StatusCreated || json.Unmarshal(rec.Body.Bytes(), &saved) != nil ||
		saved.Data.ScheduledStart == nil || !saved.Data.ScheduledStart.At.Equal(plan.ScheduledStart.At) ||
		saved.Data.ScheduledStart.PowerCeilingW == nil || *saved.Data.ScheduledStart.PowerCeilingW != ceilingW {
		t.Fatalf("create dated plan: %d %s", rec.Code, rec.Body.String())
	}
	j.live.setChargeState("NoPower")
	j.live.values["ScheduledChargingPending"] = &signal.Value{Raw: true}
	j.live.values["ScheduledChargingStartTime"] = &signal.Value{Raw: plan.ScheduledStart.At.AddDate(0, 0, -1)}
	j.live.values["ChargePortLatch"] = &signal.Value{Raw: "Engaged"}
	j.live.values["NominalFullPackEnergyKwh"] = &signal.Value{Raw: 80000.0}
	j.advance(j.now)
	j.process()
	messages := j.sender.messages()
	if len(messages) != 3 || messages[2].endpoint != "https://push.example.invalid/device-a" {
		t.Fatalf("schedule conflict sent %d messages or routed to the wrong recipient", len(messages))
	}
	list := func(subject string) []readinessport.Candidate {
		t.Helper()
		got, err := j.readiness.ListCandidates(j.ctx, subject, nil, j.now, 10)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	if got := list("subject-a"); len(got) != 1 || got[0].Decision.Kind != readiness.DecisionScheduleConflict {
		t.Fatalf("owner schedule decision = %+v", got)
	}
	if got := list("subject-b"); len(got) != 0 {
		t.Fatalf("foreign subject saw a schedule conflict: %+v", got)
	}
	token := j.claimToken()
	if rec := j.claim("subject-b", token); rec.Code != http.StatusNotFound {
		t.Fatalf("foreign subject claimed a schedule conflict: %d", rec.Code)
	}
	j.live.values["ScheduledChargingPending"].Raw = false
	if got := list("subject-a"); len(got) != 0 {
		t.Fatalf("pending state cleared but the card survived: %+v", got)
	}
	if rec := j.claim("subject-a", token); rec.Code != http.StatusNotFound {
		t.Fatalf("pending state cleared but the push could still be claimed: %d %s", rec.Code, rec.Body.String())
	}
}

func TestDepartureOverlapDeliveryRequiresPlanConsent(t *testing.T) {
	j := newChargingDeliveryJourney(t, nil)
	j.enroll("subject-a", "https://push.example.invalid/device-a")
	j.enroll("subject-b", "https://push.example.invalid/device-b")
	plan := testPlan(j.now)
	plan.SoftwareInstall = &readiness.DepartureWindow{StartsAt: plan.DepartureAt, EndsAt: plan.DepartureAt.Add(time.Hour)}
	rec := j.request(http.MethodPost, "/smart-charging/plans", "subject-a", plan)
	var saved struct {
		Data readiness.Plan `json:"data"`
	}
	if rec.Code != http.StatusCreated || json.Unmarshal(rec.Body.Bytes(), &saved) != nil ||
		saved.Data.SoftwareInstall == nil || !saved.Data.SoftwareInstall.EndsAt.Equal(plan.SoftwareInstall.EndsAt) ||
		saved.Data.DepartureOverlapPush {
		t.Fatalf("create software window: %d %s", rec.Code, rec.Body.String())
	}
	j.process()
	rows, err := j.readiness.ListCandidates(j.ctx, "subject-a", nil, j.now, 10)
	if err != nil || len(rows) != 1 || rows[0].Decision.DepartureOverlap == nil ||
		rows[0].Decision.DepartureOverlap.Kind != readiness.OverlapSoftware {
		t.Fatalf("in-app software decision: %+v, %v", rows, err)
	}
	if calls, _ := j.sender.last(); calls != 2 {
		t.Fatalf("push not opted in: recorded %d total messages", calls)
	}
	plan.DepartureOverlapPush = true
	path := "/smart-charging/plans/" + strconv.FormatInt(saved.Data.ID, 10)
	if rec = j.request(http.MethodPut, path, "subject-a", plan); rec.Code != http.StatusOK {
		t.Fatalf("opt in: %d %s", rec.Code, rec.Body.String())
	}
	j.advance(j.now.Add(time.Minute))
	j.process()
	messages := j.sender.messages()
	if len(messages) != 3 || messages[2].endpoint != "https://push.example.invalid/device-a" {
		t.Fatalf("departure conflict sent %d messages or routed to the wrong recipient", len(messages))
	}
	token := j.claimToken()
	if rec = j.claim("subject-b", token); rec.Code != http.StatusNotFound {
		t.Fatalf("foreign subject claimed departure conflict: %d", rec.Code)
	}
	plan.SoftwareInstall = nil
	if rec = j.request(http.MethodPut, path, "subject-a", plan); rec.Code != http.StatusOK {
		t.Fatalf("clear window: %d %s", rec.Code, rec.Body.String())
	}
	if rec = j.claim("subject-a", token); rec.Code != http.StatusNotFound {
		t.Fatalf("removed window retained a claim: %d", rec.Code)
	}
}

func TestTripReviewStaysInAppUntilThereIsAnActionAtTheChosenCharger(t *testing.T) {
	j := newChargingDeliveryJourney(t, nil)
	j.enroll("subject-a", "https://push.example.invalid/device-a")
	j.enroll("subject-b", "https://push.example.invalid/device-b")
	plannedCharge := 100.0
	plan := testPlan(j.now)
	plan.TripLegs = &readiness.TripLegs{
		OutboundUseLowPct: 20, OutboundUseHighPct: 25,
		ReturnUseLowPct: 90, ReturnUseHighPct: 95, DestinationChargePct: &plannedCharge,
	}
	rec := j.request(http.MethodPost, "/smart-charging/plans", "subject-a", plan)
	var created struct {
		Data readiness.Plan `json:"data"`
	}
	if rec.Code != http.StatusCreated || json.Unmarshal(rec.Body.Bytes(), &created) != nil {
		t.Fatalf("create trip review plan: %d %s", rec.Code, rec.Body.String())
	}
	j.process()
	cards, err := j.readiness.ListCandidates(j.ctx, "subject-a", nil, j.now, 10)
	if err != nil || len(cards) != 1 || cards[0].Decision.Kind != readiness.DecisionTripReview {
		t.Fatalf("unverified stop should remain available for private review: %+v, %v", cards, err)
	}
	if messages := j.sender.messages(); len(messages) != 2 {
		t.Fatalf("unverified stop sent a push beyond enrollment: %d messages", len(messages))
	}

	plan.TripLegs.ReturnUseLowPct = 20
	plan.TripLegs.ReturnUseHighPct = 30
	plan.TripLegs.DestinationChargePct = nil
	path := "/smart-charging/plans/" + strconv.FormatInt(created.Data.ID, 10)
	if rec := j.request(http.MethodPut, path, "subject-a", plan); rec.Code != http.StatusOK {
		t.Fatalf("save trip that can benefit from plugging in: %d %s", rec.Code, rec.Body.String())
	}
	j.process()
	messages := j.sender.messages()
	if len(messages) != 3 || messages[2].endpoint != "https://push.example.invalid/device-a" {
		t.Fatalf("actionable shortfall sent %d messages or routed to the wrong recipient", len(messages))
	}
	token := j.claimToken()
	if rec := j.claim("subject-b", token); rec.Code != http.StatusNotFound {
		t.Fatalf("foreign subject claimed a trip shortfall: %d", rec.Code)
	}
	if rec := j.claim("subject-a", token); rec.Code != http.StatusOK {
		t.Fatalf("owner could not claim a trip shortfall: %d %s", rec.Code, rec.Body.String())
	}
	if rec := j.claim("subject-a", token); rec.Code != http.StatusNotFound {
		t.Fatalf("trip shortfall token was replayed: %d", rec.Code)
	}
}

func TestPersonalChargingDeliverySharedOpenMode(t *testing.T) {
	j := newChargingDeliveryJourney(t, nil)
	authRouter := j.router
	j.readiness = smartreadinesssvc.New(
		readinessdb.NewRepository(j.db), j.live, controlledSite{},
		smartreadinesssvc.WithClock(func() time.Time { return j.now }),
		smartreadinesssvc.WithSharedOpenMode(true),
		smartreadinesssvc.WithCandidateNotifier(j.delivery.NotifyCharging),
	)
	openRouter := chi.NewRouter()
	openRouter.Route("/api/v1", func(r chi.Router) {
		deliveryhandler.NewHandler(j.delivery, "").MountRoutes(r)
		readinesshandler.NewHandler(j.readiness, "").MountRoutes(r)
	})
	j.router = openRouter
	j.enroll("", "https://push.example.invalid/shared-device")
	j.savePlan()
	if _, err := j.db.Pool.Exec(j.ctx, `
		INSERT INTO notification_quiet_hours (user_id,start_local,end_local,timezone)
		VALUES ('','18:00','20:00','UTC'), ('subject-a','18:00','20:00','UTC')`); err != nil {
		t.Fatal(err)
	}
	j.process()
	if calls, _ := j.sender.last(); calls != 1 {
		t.Fatalf("shared quiet hours allowed a recommendation: %d pushes", calls)
	}
	if _, err := j.db.Pool.Exec(j.ctx, `DELETE FROM notification_quiet_hours WHERE user_id=''`); err != nil {
		t.Fatal(err)
	}
	j.advance(j.now.Add(time.Minute))
	j.process()
	if calls, _ := j.sender.last(); calls != 2 {
		t.Fatalf("shared delivery was suppressed by another subject's quiet hours: %d pushes", calls)
	}
	if _, err := j.db.Pool.Exec(j.ctx, `DELETE FROM notification_quiet_hours WHERE user_id='subject-a'`); err != nil {
		t.Fatal(err)
	}
	token := j.claimToken()
	j.router = authRouter
	if rec := j.claim("subject-a", token); rec.Code != http.StatusNotFound {
		t.Fatalf("signed-in subject claimed a shared delivery: %d", rec.Code)
	}
	j.router = openRouter
	if rec := j.claim("", token); rec.Code != http.StatusOK {
		t.Fatalf("shared delivery claim = %d", rec.Code)
	}
	if rec := j.claim("", token); rec.Code != http.StatusNotFound {
		t.Fatalf("shared delivery was replayed: %d", rec.Code)
	}
}

func TestPersonalChargingClaimsStayRevoked(t *testing.T) {
	tests := []struct {
		name   string
		revoke func(*chargingDeliveryJourney, int64)
	}{
		{"disabled then re-enabled", func(j *chargingDeliveryJourney, id int64) {
			if err := j.delivery.SetChargingEnabled(j.ctx, "subject-a", id, false); err != nil {
				j.t.Fatal(err)
			}
			if err := j.delivery.SetChargingEnabled(j.ctx, "subject-a", id, true); err != nil {
				j.t.Fatal(err)
			}
		}},
		{"re-enrolled and verified again", func(j *chargingDeliveryJourney, _ int64) {
			j.enroll("subject-a", "https://push.example.invalid/device-a")
		}},
		{"charging place edited", func(j *chargingDeliveryJourney, _ int64) {
			if _, err := j.db.Pool.Exec(j.ctx, `UPDATE geofences SET updated_at=updated_at + INTERVAL '1 second' WHERE id=9`); err != nil {
				j.t.Fatal(err)
			}
		}},
		{"already plugged in", func(j *chargingDeliveryJourney, _ int64) {
			j.live.setChargeState("Charging")
		}},
		{"evidence expired", func(j *chargingDeliveryJourney, _ int64) {
			j.now = j.now.Add(3 * time.Minute)
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			j := newChargingDeliveryJourney(t, nil)
			id := j.enroll("subject-a", "https://push.example.invalid/device-a")
			j.savePlan()
			j.process()
			token := j.claimToken()
			test.revoke(j, id)
			if rec := j.claim("subject-a", token); rec.Code != http.StatusNotFound {
				t.Fatalf("invalidated claim = %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}

type changingDeliveryRepository struct {
	deliveryport.Repository
	beforeConsume func() error
}

func (r changingDeliveryRepository) ConsumeDelivery(
	ctx context.Context, subject string, ref domain.DeliveryRef, now time.Time,
) (*domain.Notification, error) {
	if err := r.beforeConsume(); err != nil {
		return nil, err
	}
	return r.Repository.ConsumeDelivery(ctx, subject, ref, now)
}

func TestChangedDecisionCannotBeClaimedOrDispatched(t *testing.T) {
	j := newChargingDeliveryJourney(t, nil)
	deviceID := j.enroll("subject-a", "https://push.example.invalid/device-a")
	plan := j.savePlan()
	j.process()
	token := j.claimToken()
	candidate, err := j.readiness.FindCandidate(j.ctx, "subject-a", plan.VehicleID, plan.ID)
	if err != nil || candidate == nil {
		t.Fatalf("find original candidate: %+v, %v", candidate, err)
	}
	repo := deliverydb.NewRepository(j.db)
	attempt := domain.ChargingAttempt{
		Subject: "subject-a", DeviceID: deviceID, PlanID: plan.ID, VehicleID: plan.VehicleID,
		PlanVersion: candidate.Plan.Version, PlaceUpdatedAt: candidate.PlaceUpdatedAt,
		DecisionKind: string(candidate.Decision.Kind), DepartureAt: plan.DepartureAt, CreatedAt: j.now,
	}
	lease, err := repo.LockCharging(j.ctx, attempt)
	if err != nil || lease == nil {
		t.Fatalf("dispatch could not lock the original decision: %v", err)
	}
	if err := lease.Close(j.ctx); err != nil {
		t.Fatal(err)
	}
	setSlowDecision := func() error {
		_, err := j.db.Pool.Exec(j.ctx, `
			INSERT INTO smart_charging_slow_samples (plan_id,plan_version,first_seen_at,last_seen_at)
			SELECT p.id,p.version,d.evaluated_at - INTERVAL '5 minutes',d.evaluated_at
			FROM smart_charging_plans p JOIN smart_charging_decisions d ON d.plan_id=p.id
			WHERE p.id=$1`, plan.ID)
		return err
	}
	enc, err := crypto.New("synthetic-test-encryption-key")
	if err != nil {
		t.Fatal(err)
	}
	racing := changingDeliveryRepository{Repository: repo, beforeConsume: setSlowDecision}
	service := smartdeliverysvc.New(racing, enc, j.sender,
		smartdeliverysvc.WithClock(func() time.Time { return j.now }),
		smartdeliverysvc.WithChargingCandidates(j.readiness),
		smartdeliverysvc.WithQuietHours(quiethoursdb.NewQuietHoursRepo(j.db)))
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		deliveryhandler.NewHandler(service, "X-Test-Subject").MountRoutes(r)
	})
	j.router = router
	if rec := j.claim("subject-a", token); rec.Code != http.StatusNotFound {
		t.Fatalf("changed decision was claimed: %d %s", rec.Code, rec.Body.String())
	}
	lease, err = repo.LockCharging(j.ctx, attempt)
	if err != nil {
		t.Fatal(err)
	}
	if lease != nil {
		_ = lease.Close(j.ctx)
		t.Fatal("dispatch locked a decision whose kind had changed")
	}
	if _, err := j.db.Pool.Exec(j.ctx, `DELETE FROM smart_charging_slow_samples WHERE plan_id=$1`, plan.ID); err != nil {
		t.Fatal(err)
	}
	racing.beforeConsume = func() error {
		_, err := j.db.Pool.Exec(j.ctx, `UPDATE smart_charging_decisions SET kind='trip_review' WHERE plan_id=$1`, plan.ID)
		return err
	}
	service = smartdeliverysvc.New(racing, enc, j.sender,
		smartdeliverysvc.WithClock(func() time.Time { return j.now }),
		smartdeliverysvc.WithChargingCandidates(j.readiness),
		smartdeliverysvc.WithQuietHours(quiethoursdb.NewQuietHoursRepo(j.db)))
	router = chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		deliveryhandler.NewHandler(service, "X-Test-Subject").MountRoutes(r)
	})
	j.router = router
	if rec := j.claim("subject-a", token); rec.Code != http.StatusNotFound {
		t.Fatalf("replaced decision was claimed: %d %s", rec.Code, rec.Body.String())
	}
}

func TestPersonalChargingPoolExhaustionCancelsAndRecovers(t *testing.T) {
	for _, separateQuietPool := range []bool{false, true} {
		name := "quiet-hours recheck"
		if separateQuietPool {
			name = "delivery reservation"
		}
		t.Run(name, func(t *testing.T) {
			j := newChargingDeliveryJourney(t, nil)
			deviceID := j.enroll("subject-a", "https://push.example.invalid/device-a")
			if err := j.delivery.SetChargingEnabled(j.ctx, "subject-a", deviceID, false); err != nil {
				t.Fatal(err)
			}
			plan := j.savePlan()
			j.process()
			if err := j.delivery.SetChargingEnabled(j.ctx, "subject-a", deviceID, true); err != nil {
				t.Fatal(err)
			}
			candidate, err := j.readiness.FindCandidate(j.ctx, "subject-a", plan.VehicleID, plan.ID)
			if err != nil || candidate == nil {
				t.Fatalf("find candidate: %+v, %v", candidate, err)
			}
			config := j.db.Pool.Config().Copy()
			config.MaxConns = 2
			pool, err := pgxpool.NewWithConfig(j.ctx, config)
			if err != nil {
				t.Fatal(err)
			}
			defer pool.Close()
			smallDB := &database.DB{Pool: pool}
			quietDB := smallDB
			if separateQuietPool {
				quietDB = j.db
			}
			enc, err := crypto.New("synthetic-test-encryption-key")
			if err != nil {
				t.Fatal(err)
			}
			service := smartdeliverysvc.New(deliverydb.NewRepository(smallDB), enc, j.sender,
				smartdeliverysvc.WithClock(func() time.Time { return j.now }),
				smartdeliverysvc.WithChargingCandidates(j.readiness),
				smartdeliverysvc.WithQuietHours(quiethoursdb.NewQuietHoursRepo(quietDB)))
			held, err := pool.Acquire(j.ctx)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(j.ctx, 200*time.Millisecond)
			err = service.NotifyCharging(ctx, *candidate)
			cancel()
			held.Release()
			if !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("exhausted pool did not honor cancellation: %v", err)
			}
			if calls, _ := j.sender.last(); calls != 1 {
				t.Fatalf("exhausted pool sent a recommendation: %d pushes", calls)
			}
			if err := service.NotifyCharging(j.ctx, *candidate); err != nil {
				t.Fatalf("dispatch did not recover after releasing the pool: %v", err)
			}
			if calls, _ := j.sender.last(); calls != 2 {
				t.Fatalf("recovered dispatch sent %d pushes, want 2 including verification", calls)
			}
		})
	}
}

type blockingPushSender struct {
	base    *controlledPushSender
	started chan struct{}
	release chan struct{}
}

func (s *blockingPushSender) IsEnabled() bool   { return s.base.IsEnabled() }
func (s *blockingPushSender) PublicKey() string { return s.base.PublicKey() }
func (s *blockingPushSender) Send(ctx context.Context, sub domain.Subscription, payload []byte, ttl time.Duration) (domain.DeliveryStatus, error) {
	var event struct {
		Kind string `json:"kind"`
	}
	if json.Unmarshal(payload, &event) == nil && event.Kind == "charging" {
		close(s.started)
		select {
		case <-s.release:
		case <-ctx.Done():
			return domain.DeliveryUnknown, ctx.Err()
		}
	}
	return s.base.Send(ctx, sub, payload, ttl)
}

func TestRevocationDuringChargingDispatch(t *testing.T) {
	var blocking *blockingPushSender
	j := newChargingDeliveryJourney(t, func(base *controlledPushSender) smartdeliverysvc.Sender {
		blocking = &blockingPushSender{base: base, started: make(chan struct{}), release: make(chan struct{})}
		return blocking
	})
	id := j.enroll("subject-a", "https://push.example.invalid/device-a")
	j.savePlan()
	finished := make(chan error, 1)
	go func() {
		_, err := j.readiness.ProcessDue(j.ctx, 50)
		finished <- err
	}()
	select {
	case <-blocking.started:
	case err := <-finished:
		t.Fatalf("charging dispatch stopped before sending: %v", err)
	case <-j.ctx.Done():
		t.Fatal("charging dispatch did not start")
	}
	revoking := make(chan struct{})
	revoked := make(chan error, 1)
	go func() {
		close(revoking)
		revoked <- j.delivery.SetChargingEnabled(j.ctx, "subject-a", id, false)
	}()
	<-revoking
	select {
	case err := <-revoked:
		t.Fatalf("revocation completed before in-flight dispatch ended: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(blocking.release)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	if err := <-revoked; err != nil {
		t.Fatal(err)
	}
	if rec := j.claim("subject-a", j.claimToken()); rec.Code != http.StatusNotFound {
		t.Fatalf("in-flight delivery survived revocation: %d", rec.Code)
	}
}

func TestPersonalChargingBudgetAndUncertainDelivery(t *testing.T) {
	j := newChargingDeliveryJourney(t, nil)
	j.enroll("subject-a", "https://push.example.invalid/device-a")
	j.sender.status = domain.DeliveryUnknown
	j.savePlan()
	j.process()
	var status string
	if err := j.db.Pool.QueryRow(j.ctx, `SELECT status FROM smart_push_deliveries`).Scan(&status); err != nil || status != "unknown" {
		t.Fatalf("uncertain provider result = %q, %v", status, err)
	}
	j.advance(j.now.Add(time.Minute))
	j.process()
	if calls, _ := j.sender.last(); calls != 2 {
		t.Fatalf("uncertain delivery was retried: %d pushes", calls)
	}
	j.sender.status = domain.DeliveryAccepted
	for range 4 {
		j.advance(j.now.Add(61 * time.Minute))
		j.savePlan()
		j.process()
	}
	if calls, _ := j.sender.last(); calls != 5 {
		t.Fatalf("four-per-day personal budget was not enforced: %d pushes", calls)
	}
}

func TestPersonalChargingQuietHoursAcrossDST(t *testing.T) {
	j := newChargingDeliveryJourney(t, nil)
	j.advance(time.Date(2026, 3, 8, 9, 59, 0, 0, time.UTC))
	j.enroll("subject-a", "https://push.example.invalid/device-a")
	j.savePlan()
	if _, err := j.db.Pool.Exec(j.ctx, `
			INSERT INTO notification_quiet_hours (user_id,start_local,end_local,timezone)
			VALUES ('subject-a','01:30','03:30','America/Los_Angeles')`); err != nil {
		t.Fatal(err)
	}
	j.process()
	j.advance(time.Date(2026, 3, 8, 10, 0, 0, 0, time.UTC))
	j.process()
	if calls, _ := j.sender.last(); calls != 1 {
		t.Fatalf("quiet hours failed across spring DST transition: %d pushes", calls)
	}
	j.advance(time.Date(2026, 3, 8, 10, 31, 0, 0, time.UTC))
	j.process()
	if calls, _ := j.sender.last(); calls != 2 {
		t.Fatalf("delivery remained suppressed after quiet hours: %d pushes", calls)
	}
}
func TestVerifiedPersonalDeviceJourney(t *testing.T) {
	_, db := testRepository(t)
	enc, err := crypto.New("synthetic-test-encryption-key")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	sender := &controlledPushSender{enabled: true, status: domain.DeliveryAccepted}
	service := smartdeliverysvc.New(deliverydb.NewRepository(db), enc, sender,
		smartdeliverysvc.WithClock(func() time.Time { return now }))
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		deliveryhandler.NewHandler(service, "X-Test-Subject").MountRoutes(r)
	})
	request := func(method, path, subject string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var data []byte
		if body != nil {
			data, err = json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
		}
		req := httptest.NewRequest(method, "/api/v1/smart-delivery"+path, bytes.NewReader(data))
		req.Header.Set("X-Test-Subject", subject)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("private response lacks no-store: %v", rec.Header())
		}
		return rec
	}
	type response[T any] struct {
		Data T `json:"data"`
	}
	decode := func(rec *httptest.ResponseRecorder, target any) {
		t.Helper()
		if err := json.Unmarshal(rec.Body.Bytes(), target); err != nil {
			t.Fatalf("decode response: %v", err)
		}
	}
	var initial response[struct {
		Available bool            `json:"available"`
		Devices   []domain.Device `json:"devices"`
	}]
	rec := request(http.MethodGet, "/devices", "subject-a", nil)
	decode(rec, &initial)
	if rec.Code != http.StatusOK || !initial.Data.Available || len(initial.Data.Devices) != 0 {
		t.Fatalf("initial devices = %d %+v", rec.Code, initial.Data)
	}
	if calls, _ := sender.last(); calls != 0 {
		t.Fatalf("initial read sent %d pushes", calls)
	}
	sub := domain.Subscription{
		Endpoint: "https://push.example.invalid/synthetic-device-token",
		P256DH:   "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
		Auth:     "tBHItJI5svbpez7KI4CCXg",
	}
	body := struct {
		Subscription domain.Subscription `json:"subscription"`
		Texts        domain.Texts        `json:"texts"`
	}{
		Subscription: sub,
		Texts: domain.Texts{
			VerificationTitle: "TeslaSync", VerificationBody: "This device is ready.",
			ChargingTitle: "Charging readiness", ChargingBody: "Review your charging plan.",
		},
	}
	rec = request(http.MethodPost, "/devices", "subject-a", body)
	var enrolled response[domain.Device]
	decode(rec, &enrolled)
	if rec.Code != http.StatusCreated || enrolled.Data.ID <= 0 || enrolled.Data.Verified || enrolled.Data.ChargingEnabled {
		t.Fatalf("enrollment = %d %+v", rec.Code, enrolled.Data)
	}
	if strings.Contains(rec.Body.String(), "synthetic-device-token") || strings.Contains(rec.Body.String(), sub.Auth) {
		t.Fatal("enrollment response exposed subscription secrets")
	}
	var ciphertext string
	if err := db.Pool.QueryRow(context.Background(),
		`SELECT subscription_ciphertext FROM smart_push_devices WHERE id=$1`, enrolled.Data.ID).Scan(&ciphertext); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(ciphertext, sub.Endpoint) || strings.Contains(ciphertext, sub.Auth) {
		t.Fatal("subscription was stored in plaintext")
	}
	plaintext, err := enc.Decrypt(ciphertext)
	if err != nil || !strings.Contains(plaintext, sub.Endpoint) {
		t.Fatalf("encrypted subscription did not round-trip: %v", err)
	}
	calls, payload := sender.last()
	var challenge struct {
		Kind     string `json:"kind"`
		DeviceID int64  `json:"device_id"`
		Token    string `json:"token"`
	}
	if calls != 1 || json.Unmarshal(payload, &challenge) != nil || challenge.Kind != "verify" ||
		challenge.DeviceID != enrolled.Data.ID || challenge.Token == "" ||
		bytes.Contains(payload, []byte("subject-a")) {
		t.Fatal("confirmation payload was missing or included a subject")
	}
	devicePath := "/devices/" + strconv.FormatInt(enrolled.Data.ID, 10)
	rec = request(http.MethodPut, devicePath+"/charging", "subject-a", map[string]bool{"enabled": true})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unverified device enabled charging: %d", rec.Code)
	}
	rec = request(http.MethodPost, devicePath+"/verify", "subject-b", map[string]string{"token": challenge.Token})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("another subject verified a device: %d", rec.Code)
	}
	rec = request(http.MethodPost, "/devices", "subject-b", body)
	if rec.Code != http.StatusConflict {
		t.Fatalf("another subject claimed the same endpoint: %d", rec.Code)
	}
	if calls, _ := sender.last(); calls != 1 {
		t.Fatalf("other subject triggered a confirmation: %d", calls)
	}
	rec = request(http.MethodPost, devicePath+"/verify", "subject-a", map[string]string{"token": challenge.Token})
	if rec.Code != http.StatusOK {
		t.Fatalf("verification failed: %d %s", rec.Code, rec.Body.String())
	}
	rec = request(http.MethodPost, devicePath+"/verify", "subject-a", map[string]string{"token": challenge.Token})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("confirmation token was reusable: %d", rec.Code)
	}
	rec = request(http.MethodPut, devicePath+"/charging", "subject-a", map[string]bool{"enabled": true})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("explicit charging opt-in failed: %d", rec.Code)
	}
	rec = request(http.MethodGet, "/devices", "subject-b", nil)
	var other response[struct {
		Devices []domain.Device `json:"devices"`
	}]
	decode(rec, &other)
	if len(other.Data.Devices) != 0 {
		t.Fatal("another subject saw the enrolled device")
	}
	rec = request(http.MethodDelete, devicePath, "subject-a", nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("device disconnect failed: %d", rec.Code)
	}
	rec = request(http.MethodPost, "/devices", "subject-b", body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("disconnected device could not be enrolled by another subject: %d", rec.Code)
	}
	disabled := smartdeliverysvc.New(deliverydb.NewRepository(db), nil, sender)
	before, _ := sender.last()
	if _, err := disabled.Enroll(context.Background(), "subject-a", sub, body.Texts); !errors.Is(err, smartdeliverysvc.ErrUnavailable) {
		t.Fatalf("missing encryption key result = %v", err)
	}
	after, _ := sender.last()
	if before != after {
		t.Fatal("unconfigured personal delivery sent a push")
	}
}
