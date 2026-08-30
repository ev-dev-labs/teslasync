package guard

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/go-chi/chi/v5"

	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// HTTP tests for GuardHandler.
//
// These tests pin Decision #7 coverage: status, event ordering/limit clamping,
// acknowledge behavior, unconfigured panic handling, validation, error paths,
// actor sourcing, and the sentry_on → honk_horn → flash_lights sequence.

// ---------- fakes ----------

type fakeGuardRepo struct {
	exists    map[int64]bool
	existsErr error

	status    map[int64]systemdb.GuardStatus
	statusErr error

	events    map[int64][]systemdb.GuardEvent
	eventsErr error

	ackEvents      map[ackKey]systemdb.GuardEvent
	ackErr         error
	ackUseSentinel bool // when true, return ErrGuardEventNotFound for any miss

	gotExistsCalls []int64
	gotStatusCalls []guardStatusCall
	gotEventsCalls []guardEventsCall
	gotAckCalls    []guardAckCall
}

type ackKey struct {
	vehicleID int64
	eventID   int64
}

type guardStatusCall struct {
	vehicleID int64
	now       time.Time
}
type guardEventsCall struct {
	vehicleID int64
	limit     int
}
type guardAckCall struct {
	vehicleID int64
	eventID   int64
	actor     string
}

func (f *fakeGuardRepo) VehicleExists(ctx context.Context, vehicleID int64) (bool, error) {
	f.gotExistsCalls = append(f.gotExistsCalls, vehicleID)
	if f.existsErr != nil {
		return false, f.existsErr
	}
	return f.exists[vehicleID], nil
}

func (f *fakeGuardRepo) Status(ctx context.Context, vehicleID int64, now time.Time) (systemdb.GuardStatus, error) {
	f.gotStatusCalls = append(f.gotStatusCalls, guardStatusCall{vehicleID, now})
	if f.statusErr != nil {
		return systemdb.GuardStatus{}, f.statusErr
	}
	return f.status[vehicleID], nil
}

func (f *fakeGuardRepo) Events(ctx context.Context, vehicleID int64, limit int) ([]systemdb.GuardEvent, error) {
	f.gotEventsCalls = append(f.gotEventsCalls, guardEventsCall{vehicleID, limit})
	if f.eventsErr != nil {
		return nil, f.eventsErr
	}
	return f.events[vehicleID], nil
}

func (f *fakeGuardRepo) Acknowledge(ctx context.Context, vehicleID, eventID int64, actor string) (systemdb.GuardEvent, error) {
	f.gotAckCalls = append(f.gotAckCalls, guardAckCall{vehicleID, eventID, actor})
	if f.ackErr != nil {
		return systemdb.GuardEvent{}, f.ackErr
	}
	ev, ok := f.ackEvents[ackKey{vehicleID, eventID}]
	if !ok {
		if f.ackUseSentinel {
			return systemdb.GuardEvent{}, systemdb.ErrGuardEventNotFound
		}
		return systemdb.GuardEvent{}, systemdb.ErrGuardEventNotFound
	}
	// Mutate the returned row to reflect the new ack metadata so the
	// handler echo back includes the actor.
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	ev.AcknowledgedAt = &now
	ev.AcknowledgedBy = guardStrPtr(actor)
	return ev, nil
}

type fakeGuardVehicles struct {
	byID   map[int64]*vehiclemodel.Vehicle
	getErr error
	gotIDs []int64
}

func (f *fakeGuardVehicles) GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error) {
	f.gotIDs = append(f.gotIDs, id)
	if f.getErr != nil {
		return nil, f.getErr
	}
	v, ok := f.byID[id]
	if !ok {
		return nil, nil
	}
	return v, nil
}

type fakeGuardCommandClient struct {
	// errByCommand maps command name -> error to return. Missing keys
	// imply success (nil).
	errByCommand map[string]error
	gotCalls     []guardCmdCall
}

type guardCmdCall struct {
	vin     string
	command string
}

func (f *fakeGuardCommandClient) SendCommand(ctx context.Context, vin string, command string, params map[string]interface{}) error {
	f.gotCalls = append(f.gotCalls, guardCmdCall{vin, command})
	if f.errByCommand == nil {
		return nil
	}
	return f.errByCommand[command]
}

func newGuardHandlerForTest(repo *fakeGuardRepo, vehicles *fakeGuardVehicles, cmd *fakeGuardCommandClient, proxyConfigured bool, fixedNow time.Time) *GuardHandler {
	return &GuardHandler{
		repo:                   repo,
		vehicles:               vehicles,
		cmd:                    cmd,
		authHdr:                "X-Forwarded-User",
		commandProxyConfigured: proxyConfigured,
		clock:                  func() time.Time { return fixedNow },
	}
}

func guardRequest(method, target string, vehicleID, eventID string) *http.Request {
	r := httptest.NewRequest(method, target, nil)
	rctx := chi.NewRouteContext()
	if vehicleID != "" {
		rctx.URLParams.Add("vehicleID", vehicleID)
	}
	if eventID != "" {
		rctx.URLParams.Add("eventID", eventID)
	}
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func guardStrPtr(s string) *string { return &s }

// ---------- (a) Status — active vs inactive sentry ----------

func TestGuard_Status_ActiveSentry(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	lastTS := now.Add(-30 * time.Minute)
	repo := &fakeGuardRepo{
		exists: map[int64]bool{42: true},
		status: map[int64]systemdb.GuardStatus{
			42: {
				VehicleID:           42,
				SentryModeActive:    true,
				LastState:           guardStrPtr("SentryModeStateArmed"),
				LastStateAt:         &lastTS,
				RecentEventCount24h: 7,
			},
		},
	}
	h := newGuardHandlerForTest(repo, nil, nil, false, now)
	rec := httptest.NewRecorder()
	h.Status(rec, guardRequest(http.MethodGet, "/vehicles/42/guard", "42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	mustDecode(t, rec.Body.Bytes(), &body)
	if body["sentry_mode_active"] != true {
		t.Errorf("sentry_mode_active = %v, want true", body["sentry_mode_active"])
	}
	if body["last_state"] != "SentryModeStateArmed" {
		t.Errorf("last_state = %v, want SentryModeStateArmed", body["last_state"])
	}
	if body["recent_event_count_24h"].(float64) != 7 {
		t.Errorf("recent_event_count_24h = %v, want 7", body["recent_event_count_24h"])
	}
	// Vehicle existence MUST be probed before status query.
	if len(repo.gotExistsCalls) != 1 || repo.gotExistsCalls[0] != 42 {
		t.Errorf("VehicleExists not called first; calls=%v", repo.gotExistsCalls)
	}
	// now propagated through to repo so repo's 24h boundary matches handler clock.
	if len(repo.gotStatusCalls) != 1 || !repo.gotStatusCalls[0].now.Equal(now) {
		t.Errorf("Status called with now=%v, want %v", repo.gotStatusCalls[0].now, now)
	}
}

func TestGuard_Status_InactiveSentry(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	lastTS := now.Add(-3 * time.Hour)
	repo := &fakeGuardRepo{
		exists: map[int64]bool{99: true},
		status: map[int64]systemdb.GuardStatus{
			99: {
				VehicleID:           99,
				SentryModeActive:    false,
				LastState:           guardStrPtr("SentryModeStateOff"),
				LastStateAt:         &lastTS,
				RecentEventCount24h: 0,
			},
		},
	}
	h := newGuardHandlerForTest(repo, nil, nil, false, now)
	rec := httptest.NewRecorder()
	h.Status(rec, guardRequest(http.MethodGet, "/vehicles/99/guard", "99", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	mustDecode(t, rec.Body.Bytes(), &body)
	if body["sentry_mode_active"] != false {
		t.Errorf("sentry_mode_active = %v, want false", body["sentry_mode_active"])
	}
	if body["last_state"] != "SentryModeStateOff" {
		t.Errorf("last_state = %v, want SentryModeStateOff", body["last_state"])
	}
}

func TestGuard_Status_VehicleNotFound(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeGuardRepo{exists: map[int64]bool{}}
	h := newGuardHandlerForTest(repo, nil, nil, false, now)
	rec := httptest.NewRecorder()
	h.Status(rec, guardRequest(http.MethodGet, "/vehicles/77/guard", "77", ""))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", rec.Code, rec.Body.String())
	}
	if len(repo.gotStatusCalls) != 0 {
		t.Errorf("Status called despite vehicle not found; calls=%v", repo.gotStatusCalls)
	}
}

func TestGuard_Status_RepoError(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeGuardRepo{
		exists:    map[int64]bool{42: true},
		statusErr: errors.New("boom"),
	}
	h := newGuardHandlerForTest(repo, nil, nil, false, now)
	rec := httptest.NewRecorder()
	h.Status(rec, guardRequest(http.MethodGet, "/vehicles/42/guard", "42", ""))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

// ---------- (b) Events — ordering preserved + limit clamp ----------

func TestGuard_Events_PreservesRepoOrder(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	// Repo SQL ORDER BY ts DESC, id DESC — handler must NOT re-sort.
	t1 := now.Add(-1 * time.Hour)
	t2 := now.Add(-2 * time.Hour)
	t3 := now.Add(-3 * time.Hour)
	repo := &fakeGuardRepo{
		exists: map[int64]bool{42: true},
		events: map[int64][]systemdb.GuardEvent{
			42: {
				{ID: 103, VehicleID: 42, TS: t1, EventType: "sentry_mode", ToState: guardStrPtr("SentryModeStateArmed")},
				{ID: 102, VehicleID: 42, TS: t2, EventType: "sentry_mode", ToState: guardStrPtr("SentryModeStateAware")},
				{ID: 101, VehicleID: 42, TS: t3, EventType: "sentry_mode", ToState: guardStrPtr("SentryModeStateOff")},
			},
		},
	}
	h := newGuardHandlerForTest(repo, nil, nil, false, now)
	rec := httptest.NewRecorder()
	h.Events(rec, guardRequest(http.MethodGet, "/vehicles/42/guard/events", "42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	var body GuardEventsResponse
	mustDecode(t, rec.Body.Bytes(), &body)
	if body.VehicleID != 42 {
		t.Errorf("vehicle_id = %d, want 42", body.VehicleID)
	}
	gotIDs := []int64{}
	for _, ev := range body.Events {
		gotIDs = append(gotIDs, ev.ID)
	}
	wantIDs := []int64{103, 102, 101}
	if fmt.Sprint(gotIDs) != fmt.Sprint(wantIDs) {
		t.Errorf("event ids = %v, want %v (handler must not re-sort)", gotIDs, wantIDs)
	}
}

func TestGuard_Events_EmptyResultIsNotNull(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeGuardRepo{
		exists: map[int64]bool{42: true},
		// No entries for vehicle 42 → repo returns nil slice; handler
		// must coerce to []GuardEvent{} so JSON renders [] not null.
	}
	h := newGuardHandlerForTest(repo, nil, nil, false, now)
	rec := httptest.NewRecorder()
	h.Events(rec, guardRequest(http.MethodGet, "/vehicles/42/guard/events", "42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"events":[]`) {
		t.Errorf("body must include `\"events\":[]`, got: %s", rec.Body.String())
	}
}

func TestGuard_Events_LimitClamp(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name       string
		query      string
		wantStatus int
		wantLimit  int
		wantErrTxt string
		wantMax    bool
	}{
		{"default_when_absent", "", http.StatusOK, guardEventsDefaultLimit, "", false},
		{"limit_500", "?limit=500", http.StatusOK, 500, "", false},
		{"limit_1000_max_inclusive", "?limit=1000", http.StatusOK, 1000, "", false},
		{"limit_1001_exceeds_max", "?limit=1001", http.StatusBadRequest, 0, "limit exceeds maximum", true},
		{"limit_zero", "?limit=0", http.StatusBadRequest, 0, "limit must be", false},
		{"limit_negative", "?limit=-5", http.StatusBadRequest, 0, "limit must be", false},
		{"limit_non_integer", "?limit=abc", http.StatusBadRequest, 0, "limit must be an integer", false},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeGuardRepo{
				exists: map[int64]bool{42: true},
				events: map[int64][]systemdb.GuardEvent{42: {}},
			}
			h := newGuardHandlerForTest(repo, nil, nil, false, now)
			rec := httptest.NewRecorder()
			h.Events(rec, guardRequest(http.MethodGet, "/vehicles/42/guard/events"+c.query, "42", ""))

			if rec.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, c.wantStatus, rec.Body.String())
			}
			if c.wantErrTxt != "" && !strings.Contains(rec.Body.String(), c.wantErrTxt) {
				t.Errorf("body missing %q; body=%s", c.wantErrTxt, rec.Body.String())
			}
			if c.wantMax {
				var body map[string]any
				mustDecode(t, rec.Body.Bytes(), &body)
				maxV, ok := body["max"].(float64)
				if !ok || int(maxV) != guardEventsMaxLimit {
					t.Errorf("body.max = %v, want %d", body["max"], guardEventsMaxLimit)
				}
			}
			if c.wantStatus == http.StatusOK {
				if len(repo.gotEventsCalls) != 1 {
					t.Fatalf("got %d Events calls, want 1", len(repo.gotEventsCalls))
				}
				if repo.gotEventsCalls[0].limit != c.wantLimit {
					t.Errorf("repo limit = %d, want %d", repo.gotEventsCalls[0].limit, c.wantLimit)
				}
			}
		})
	}
}

func TestGuard_Events_VehicleNotFound(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeGuardRepo{exists: map[int64]bool{}}
	h := newGuardHandlerForTest(repo, nil, nil, false, now)
	rec := httptest.NewRecorder()
	h.Events(rec, guardRequest(http.MethodGet, "/vehicles/77/guard/events", "77", ""))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if len(repo.gotEventsCalls) != 0 {
		t.Errorf("Events called despite vehicle not found")
	}
}

// ---------- (c) Acknowledge ----------

func TestGuard_Acknowledge_Success(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeGuardRepo{
		exists: map[int64]bool{42: true},
		ackEvents: map[ackKey]systemdb.GuardEvent{
			{vehicleID: 42, eventID: 5}: {
				ID: 5, VehicleID: 42, TS: now.Add(-1 * time.Hour),
				EventType: "sentry_mode", ToState: guardStrPtr("SentryModeStateAware"),
			},
		},
	}
	h := newGuardHandlerForTest(repo, nil, nil, false, now)
	r := guardRequest(http.MethodPost, "/vehicles/42/guard/events/5/acknowledge", "42", "5")
	r.Header.Set("X-Forwarded-User", "alice@example.com")
	rec := httptest.NewRecorder()
	h.Acknowledge(rec, r)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	var body systemdb.GuardEvent
	mustDecode(t, rec.Body.Bytes(), &body)
	if body.ID != 5 {
		t.Errorf("id = %d, want 5", body.ID)
	}
	if body.AcknowledgedAt == nil {
		t.Errorf("acknowledged_at must be set after ack")
	}
	if body.AcknowledgedBy == nil || *body.AcknowledgedBy != "alice@example.com" {
		t.Errorf("acknowledged_by = %v, want alice@example.com", body.AcknowledgedBy)
	}
	if len(repo.gotAckCalls) != 1 || repo.gotAckCalls[0].actor != "alice@example.com" {
		t.Errorf("ack actor = %q, want alice@example.com (calls=%v)", repo.gotAckCalls[0].actor, repo.gotAckCalls)
	}
}

func TestGuard_Acknowledge_EmptyActorAllowed(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeGuardRepo{
		exists: map[int64]bool{42: true},
		ackEvents: map[ackKey]systemdb.GuardEvent{
			{vehicleID: 42, eventID: 5}: {ID: 5, VehicleID: 42, TS: now, EventType: "sentry_mode"},
		},
	}
	h := newGuardHandlerForTest(repo, nil, nil, false, now)
	// No X-Forwarded-User header — actorFromRequest returns "" in
	// open-mode. The empty actor must be passed through as-is rather
	// than rejected or replaced with a fabricated identity.
	rec := httptest.NewRecorder()
	h.Acknowledge(rec, guardRequest(http.MethodPost, "/vehicles/42/guard/events/5/acknowledge", "42", "5"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	if len(repo.gotAckCalls) != 1 {
		t.Fatalf("got %d ack calls, want 1", len(repo.gotAckCalls))
	}
	if repo.gotAckCalls[0].actor != "" {
		t.Errorf("actor = %q, want empty string (open-mode passthrough)", repo.gotAckCalls[0].actor)
	}
}

func TestGuard_Acknowledge_NotFound_CrossVehicle(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	// Event 5 belongs to vehicle 99, NOT vehicle 42. The handler MUST
	// return 404 (Decision #3) so a cross-vehicle ack attempt cannot
	// succeed and cannot leak the existence of event 5 either.
	repo := &fakeGuardRepo{
		exists: map[int64]bool{42: true},
		ackEvents: map[ackKey]systemdb.GuardEvent{
			{vehicleID: 99, eventID: 5}: {ID: 5, VehicleID: 99, TS: now, EventType: "sentry_mode"},
		},
		ackUseSentinel: true,
	}
	h := newGuardHandlerForTest(repo, nil, nil, false, now)
	rec := httptest.NewRecorder()
	h.Acknowledge(rec, guardRequest(http.MethodPost, "/vehicles/42/guard/events/5/acknowledge", "42", "5"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (cross-vehicle)", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "guard event not found") {
		t.Errorf("body must include 'guard event not found'; body=%s", rec.Body.String())
	}
}

func TestGuard_Acknowledge_VehicleNotFound(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeGuardRepo{exists: map[int64]bool{}}
	h := newGuardHandlerForTest(repo, nil, nil, false, now)
	rec := httptest.NewRecorder()
	h.Acknowledge(rec, guardRequest(http.MethodPost, "/vehicles/77/guard/events/5/acknowledge", "77", "5"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if len(repo.gotAckCalls) != 0 {
		t.Errorf("Acknowledge called despite vehicle not found")
	}
}

func TestGuard_Acknowledge_BadEventID(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	cases := []struct{ name, eventID string }{
		{"non_numeric", "abc"},
		{"zero", "0"},
		{"negative", "-1"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeGuardRepo{}
			h := newGuardHandlerForTest(repo, nil, nil, false, now)
			rec := httptest.NewRecorder()
			h.Acknowledge(rec, guardRequest(http.MethodPost, "/vehicles/42/guard/events/"+c.eventID+"/acknowledge", "42", c.eventID))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
		})
	}
}

// ---------- (d) Panic ----------

func TestGuard_Panic_NotImplementedWhenProxyUnconfigured(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	cmd := &fakeGuardCommandClient{}
	vehicles := &fakeGuardVehicles{
		byID: map[int64]*vehiclemodel.Vehicle{42: {ID: 42, VIN: "5YJ3E1EA0KFXXXXXX"}},
	}
	h := newGuardHandlerForTest(&fakeGuardRepo{}, vehicles, cmd, false, now)
	rec := httptest.NewRecorder()
	h.Panic(rec, guardRequest(http.MethodPost, "/vehicles/42/guard/panic", "42", ""))

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want 501", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Tesla command proxy not configured") {
		t.Errorf("body must mention proxy not configured; body=%s", rec.Body.String())
	}
	// CRITICAL: must NOT touch vehicle lookup or send any command.
	if len(vehicles.gotIDs) != 0 {
		t.Errorf("vehicle lookup performed despite proxy unconfigured; calls=%v", vehicles.gotIDs)
	}
	if len(cmd.gotCalls) != 0 {
		t.Errorf("commands sent despite proxy unconfigured; calls=%v", cmd.gotCalls)
	}
}

func TestGuard_Panic_AllCommandsSucceed(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	cmd := &fakeGuardCommandClient{}
	vehicles := &fakeGuardVehicles{
		byID: map[int64]*vehiclemodel.Vehicle{42: {ID: 42, VIN: "5YJ3E1EA0KF000001"}},
	}
	h := newGuardHandlerForTest(&fakeGuardRepo{}, vehicles, cmd, true, now)
	rec := httptest.NewRecorder()
	h.Panic(rec, guardRequest(http.MethodPost, "/vehicles/42/guard/panic", "42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	// Command sequence is locked: sentry_on → honk_horn → flash_lights.
	want := []guardCmdCall{
		{vin: "5YJ3E1EA0KF000001", command: "sentry_on"},
		{vin: "5YJ3E1EA0KF000001", command: "honk_horn"},
		{vin: "5YJ3E1EA0KF000001", command: "flash_lights"},
	}
	if fmt.Sprint(cmd.gotCalls) != fmt.Sprint(want) {
		t.Errorf("command sequence = %v, want %v", cmd.gotCalls, want)
	}
	var body GuardPanicResponse
	mustDecode(t, rec.Body.Bytes(), &body)
	if len(body.Results) != 3 {
		t.Fatalf("results len = %d, want 3", len(body.Results))
	}
	for _, r := range body.Results {
		if !r.OK {
			t.Errorf("result for %q: ok=false err=%q", r.Command, r.Error)
		}
	}
}

func TestGuard_Panic_PartialFailureReturns502(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	cmd := &fakeGuardCommandClient{
		errByCommand: map[string]error{
			"honk_horn": errors.New("vehicle asleep"),
		},
	}
	vehicles := &fakeGuardVehicles{
		byID: map[int64]*vehiclemodel.Vehicle{42: {ID: 42, VIN: "5YJ3E1EA0KF000001"}},
	}
	h := newGuardHandlerForTest(&fakeGuardRepo{}, vehicles, cmd, true, now)
	rec := httptest.NewRecorder()
	h.Panic(rec, guardRequest(http.MethodPost, "/vehicles/42/guard/panic", "42", ""))

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 on partial failure", rec.Code)
	}
	// Subsequent commands must STILL run after a failure so the
	// dashboard can show what worked.
	if len(cmd.gotCalls) != 3 {
		t.Errorf("commands sent = %d, want 3 (handler must continue on failure)", len(cmd.gotCalls))
	}
	var body GuardPanicResponse
	mustDecode(t, rec.Body.Bytes(), &body)
	if len(body.Results) != 3 {
		t.Fatalf("results len = %d, want 3", len(body.Results))
	}
	if body.Results[0].Command != "sentry_on" || !body.Results[0].OK {
		t.Errorf("results[0] = %+v, want sentry_on OK", body.Results[0])
	}
	if body.Results[1].Command != "honk_horn" || body.Results[1].OK || body.Results[1].Error == "" {
		t.Errorf("results[1] = %+v, want honk_horn failed", body.Results[1])
	}
	if body.Results[2].Command != "flash_lights" || !body.Results[2].OK {
		t.Errorf("results[2] = %+v, want flash_lights OK", body.Results[2])
	}
}

// TestGuard_Panic_BudgetExceededAbortsRemainingCommands pins the
// structured 429 surface + early-abort behavior for Fleet API daily
// budget exhaustion: unlike an ordinary per-command failure (which
// continues through the remaining commands and returns a 502 with
// partial results), a budget error is systemic — every remaining
// command shares the same exhausted daily budget — so the handler
// must stop immediately and report the real HTTP status instead of
// masking it behind the generic degraded-success envelope.
func TestGuard_Panic_BudgetExceededAbortsRemainingCommands(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	cmd := &fakeGuardCommandClient{
		errByCommand: map[string]error{
			"sentry_on": fmt.Errorf("send command: %w", tesla.ErrBudgetExceeded),
		},
	}
	vehicles := &fakeGuardVehicles{
		byID: map[int64]*vehiclemodel.Vehicle{42: {ID: 42, VIN: "5YJ3E1EA0KF000001"}},
	}
	h := newGuardHandlerForTest(&fakeGuardRepo{}, vehicles, cmd, true, now)
	rec := httptest.NewRecorder()
	h.Panic(rec, guardRequest(http.MethodPost, "/vehicles/42/guard/panic", "42", ""))

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429, body=%s", rec.Code, rec.Body.String())
	}
	if len(cmd.gotCalls) != 1 {
		t.Errorf("commands sent = %d, want 1 (must abort after budget error)", len(cmd.gotCalls))
	}
	var resp map[string]string
	mustDecode(t, rec.Body.Bytes(), &resp)
	if resp["code"] != "RATE_LIMITED" {
		t.Errorf("code = %q, want RATE_LIMITED", resp["code"])
	}
}

// TestGuard_Panic_BudgetUnavailableAbortsRemainingCommands mirrors the
// exceeded-budget case for the budget-evidence-store-unavailable
// sentinel: 503 instead of 429, otherwise identical abort semantics.
func TestGuard_Panic_BudgetUnavailableAbortsRemainingCommands(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	cmd := &fakeGuardCommandClient{
		errByCommand: map[string]error{
			"sentry_on": fmt.Errorf("read budget snapshot: %w", tesla.ErrBudgetUnavailable),
		},
	}
	vehicles := &fakeGuardVehicles{
		byID: map[int64]*vehiclemodel.Vehicle{42: {ID: 42, VIN: "5YJ3E1EA0KF000001"}},
	}
	h := newGuardHandlerForTest(&fakeGuardRepo{}, vehicles, cmd, true, now)
	rec := httptest.NewRecorder()
	h.Panic(rec, guardRequest(http.MethodPost, "/vehicles/42/guard/panic", "42", ""))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503, body=%s", rec.Code, rec.Body.String())
	}
	if len(cmd.gotCalls) != 1 {
		t.Errorf("commands sent = %d, want 1 (must abort after budget error)", len(cmd.gotCalls))
	}
	var resp map[string]string
	mustDecode(t, rec.Body.Bytes(), &resp)
	if resp["code"] != "SERVICE_UNAVAILABLE" {
		t.Errorf("code = %q, want SERVICE_UNAVAILABLE", resp["code"])
	}
}

func TestGuard_Panic_VehicleNotFound(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	cmd := &fakeGuardCommandClient{}
	vehicles := &fakeGuardVehicles{byID: map[int64]*vehiclemodel.Vehicle{}}
	h := newGuardHandlerForTest(&fakeGuardRepo{}, vehicles, cmd, true, now)
	rec := httptest.NewRecorder()
	h.Panic(rec, guardRequest(http.MethodPost, "/vehicles/77/guard/panic", "77", ""))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if len(cmd.gotCalls) != 0 {
		t.Errorf("commands sent despite vehicle not found")
	}
}

// ---------- vehicle_id validation ----------

func TestGuard_BadVehicleID(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	cases := []struct{ name, vid string }{
		{"missing", ""},
		{"non_numeric", "abc"},
		{"zero", "0"},
		{"negative", "-5"},
	}
	for _, c := range cases {
		c := c
		t.Run("status_"+c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeGuardRepo{}
			h := newGuardHandlerForTest(repo, nil, nil, false, now)
			rec := httptest.NewRecorder()
			h.Status(rec, guardRequest(http.MethodGet, "/vehicles/x/guard", c.vid, ""))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if len(repo.gotExistsCalls) != 0 {
				t.Errorf("VehicleExists called on bad vehicle_id; calls=%v", repo.gotExistsCalls)
			}
		})
		t.Run("events_"+c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeGuardRepo{}
			h := newGuardHandlerForTest(repo, nil, nil, false, now)
			rec := httptest.NewRecorder()
			h.Events(rec, guardRequest(http.MethodGet, "/vehicles/x/guard/events", c.vid, ""))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", rec.Code)
			}
		})
		t.Run("ack_"+c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeGuardRepo{}
			h := newGuardHandlerForTest(repo, nil, nil, false, now)
			rec := httptest.NewRecorder()
			h.Acknowledge(rec, guardRequest(http.MethodPost, "/vehicles/x/guard/events/5/acknowledge", c.vid, "5"))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", rec.Code)
			}
		})
		t.Run("panic_"+c.name, func(t *testing.T) {
			t.Parallel()
			h := newGuardHandlerForTest(&fakeGuardRepo{}, &fakeGuardVehicles{}, &fakeGuardCommandClient{}, true, now)
			rec := httptest.NewRecorder()
			h.Panic(rec, guardRequest(http.MethodPost, "/vehicles/x/guard/panic", c.vid, ""))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", rec.Code)
			}
		})
	}
}

// ---------- helpers ----------

func mustDecode(t *testing.T, body []byte, into any) {
	t.Helper()
	if err := json.Unmarshal(body, into); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, body)
	}
}
