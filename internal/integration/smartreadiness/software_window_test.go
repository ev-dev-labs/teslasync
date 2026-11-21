package smartreadiness_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/auth"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

const (
	softwareEndpoint = "/software-updates/window-review?vehicle_id=7"
	softwareOwner    = "synthetic-software-owner"
)

type softwareWindowJourney struct {
	*parkedClosureJourney
}

func newSoftwareWindowJourney(t *testing.T) *softwareWindowJourney {
	t.Helper()
	j := &softwareWindowJourney{newParkedClosureJourney(t)}
	repo := readinessdb.NewRepository(j.db)
	j.live.values = make(map[string]*signal.Value)
	service := smartreadinesssvc.NewSoftwareWindows(repo, repo, j.live, func() time.Time { return j.now })
	j.router = chi.NewRouter()
	j.router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(j.readiness, "X-Test-Subject", readinesshandler.WithSoftwareWindow(service)).MountRoutes(r)
	})
	return j
}

func (j *softwareWindowJourney) read(endpoint, subject string) *domain.SoftwareWindowPlan {
	j.t.Helper()
	raw := j.status(http.MethodGet, endpoint, subject, nil, http.StatusOK)
	var response struct {
		Data struct {
			Plan      *domain.SoftwareWindowPlan `json:"plan"`
			Available bool                       `json:"available"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &response); err != nil || !response.Data.Available {
		j.t.Fatalf("invalid private software response: %s (%v)", raw, err)
	}
	return response.Data.Plan
}

func (j *softwareWindowJourney) emit(name, raw string, at time.Time) {
	j.t.Helper()
	body := fmt.Sprintf(`{"value":%s,"ts":%q}`, raw, at.UTC().Format(time.RFC3339))
	atoms, err := codec.DecodeJSONField(name, []byte(body), "00000000000000000", at.Add(time.Second))
	if err != nil || len(atoms) != 1 {
		j.t.Fatalf("decode fixture %s: %v, %v", name, atoms, err)
	}
	atom := atoms[0]
	var flag *bool
	var text *string
	kind := protomodel.ValueKindString
	switch value := atom.Value.(type) {
	case string:
		text = &value
	case bool:
		kind, flag = protomodel.ValueKindBool, &value
	default:
		j.t.Fatalf("unsupported fixture value %T", value)
	}
	j.exec(`INSERT INTO signal_log(ts,vehicle_id,field,value_kind,bool_value,str_value,source_emitted_at,received_at)
		VALUES($1,7,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (vehicle_id,field,ts) DO UPDATE SET bool_value=excluded.bool_value, str_value=excluded.str_value`,
		atom.EmittedAt, atom.Field, kind, flag, text, atom.SourceEmittedAt, at.Add(time.Second))
	j.live.mu.Lock()
	j.live.values[atom.Field] = &signal.Value{Raw: atom.Value, Timestamp: atom.EmittedAt}
	j.live.mu.Unlock()
}

func (j *softwareWindowJourney) idleFrom(at time.Time) {
	j.t.Helper()
	j.emit("Gear", `"P"`, at)
	j.emit("ServiceMode", "false", at.Add(time.Second))
	j.emit("DriverSeatOccupied", "false", at.Add(2*time.Second))
	j.emit("DetailedChargeState", `"DetailedChargeStateDisconnected"`, at.Add(3*time.Second))
	j.now = at.Add(75 * time.Second)
}

func (j *softwareWindowJourney) confirm(subject string, id int64, durationS int, confirmed bool, status int) {
	j.t.Helper()
	j.status(http.MethodPut, softwareEndpoint, subject, struct {
		domain.SoftwareWindowSetup
		ExpectedID int64 `json:"expected_plan_id"`
	}{domain.SoftwareWindowSetup{
		DepartureAt: j.start.Add(2 * time.Hour), Version: "2026.40.2",
		EstimatedDurationS: durationS, CheckedReadyUnscheduled: confirmed,
	}, id}, status)
}

func TestSoftwareWindowPrivateLifecycle(t *testing.T) {
	j := newSoftwareWindowJourney(t)
	j.completedPark(j.start)
	j.idleFrom(j.start)
	if off := j.read(softwareEndpoint, softwareOwner); off != nil || j.live.readCount() != 0 {
		t.Fatalf("default off should not read telemetry: %+v", off)
	}
	j.confirm(softwareOwner, 0, 40*60, false, http.StatusBadRequest)
	j.confirm(softwareOwner, 0, 40*60, true, http.StatusNoContent)
	plan := j.read(softwareEndpoint, softwareOwner)
	if plan == nil || plan.Review == nil || plan.Reason != domain.SoftwareWindowFits || plan.Version != "2026.40.2" ||
		plan.EstimatedDurationS != 2400 || plan.Review.MarginS != 1800 || !plan.Review.ActionUntil.Equal(j.start.Add(2*time.Minute)) {
		t.Fatalf("expected a short-lived review with evidence and meaningful margin, got %+v", plan)
	}
	if plan.Review.UpdateObservedAt != plan.ConfirmedAt || !plan.Review.IdleObservedFrom.Equal(j.start.Add(3*time.Second)) {
		t.Fatalf("provenance must distinguish the manual check and observed idle: %+v", plan.Review)
	}
	if j.read(softwareEndpoint, "synthetic-foreign") != nil ||
		j.read("/software-updates/window-review?vehicle_id=8", softwareOwner) != nil {
		t.Fatal("foreign subject or vehicle obtained private update context")
	}
	j.status(http.MethodGet, softwareEndpoint, "", nil, http.StatusUnauthorized)
	mismatch := httptest.NewRequest(http.MethodGet, "/api/v1"+softwareEndpoint, nil)
	mismatch.Header.Set("X-Test-Subject", "synthetic-foreign")
	mismatch.Header.Set(auth.ExpectedPrincipalHeader, "subject:"+softwareOwner)
	rec := httptest.NewRecorder()
	j.router.ServeHTTP(rec, mismatch)
	if rec.Code != http.StatusConflict {
		t.Fatalf("stale principal read = %d: %s", rec.Code, rec.Body)
	}

	hold := fmt.Sprintf("%s&plan_id=%d", softwareEndpoint, plan.ID)
	j.status(http.MethodPatch, hold, softwareOwner, map[string]string{"action": "snooze"}, http.StatusNoContent)
	snoozed := j.read(softwareEndpoint, softwareOwner)
	if snoozed.ID == plan.ID || snoozed.Reason != domain.SoftwareWindowHeld || snoozed.Review != nil {
		t.Fatalf("snooze must invalidate the old plan and hide the card: %+v", snoozed)
	}
	j.status(http.MethodDelete, hold, softwareOwner, nil, http.StatusConflict)
	j.status(http.MethodPatch, fmt.Sprintf("%s&plan_id=%d", softwareEndpoint, snoozed.ID), softwareOwner,
		map[string]string{"action": "pause"}, http.StatusNoContent)
	paused := j.read(softwareEndpoint, softwareOwner)
	if !paused.Paused || paused.ID == snoozed.ID || paused.Review != nil {
		t.Fatalf("pause must invalidate snooze and the old decision: %+v", paused)
	}
	j.confirm(softwareOwner, paused.ID, 40*60, true, http.StatusNoContent)
	replaced := j.read(softwareEndpoint, softwareOwner)
	if replaced.Review == nil || replaced.ID == paused.ID {
		t.Fatalf("explicit new check should resume a still-observed window: %+v", replaced)
	}
	j.now = replaced.DepartureAt
	if expired := j.read(softwareEndpoint, softwareOwner); expired.Reason != domain.SoftwareWindowExpired || expired.Review != nil {
		t.Fatalf("expired departure must no longer expose a recommendation: %+v", expired)
	}
	j.status(http.MethodDelete, fmt.Sprintf("%s&plan_id=%d", softwareEndpoint, replaced.ID), softwareOwner, nil, http.StatusNoContent)
	if j.read(softwareEndpoint, softwareOwner) != nil {
		t.Fatal("turning off must remove only the private review plan")
	}
}

func TestSoftwareWindowSuppressesWrongOrOldEvidence(t *testing.T) {
	cases := []struct {
		name   string
		change func(*softwareWindowJourney)
		want   domain.SoftwareWindowReason
	}{
		{"charging", func(j *softwareWindowJourney) {
			j.emit("DetailedChargeState", `"DetailedChargeStateCharging"`, j.now.Add(-time.Second))
		}, domain.SoftwareWindowNotIdle},
		{"scheduled", func(j *softwareWindowJourney) {
			j.emit("SoftwareUpdateScheduledStartTime", `"2026-11-20T19:00:00Z"`, j.now.Add(-time.Second))
		}, domain.SoftwareWindowNotReady},
		{"install began", func(j *softwareWindowJourney) {
			j.emit("SoftwareUpdateInProgress", "true", j.now.Add(time.Second))
			j.now = j.now.Add(2 * time.Second)
		}, domain.SoftwareWindowNotReady},
		{"seat became occupied", func(j *softwareWindowJourney) {
			j.emit("DriverSeatOccupied", "true", j.now.Add(-time.Second))
		}, domain.SoftwareWindowNotIdle},
		{"contradictory late drive", func(j *softwareWindowJourney) {
			j.exec(`INSERT INTO drives (vehicle_id,started_at,ended_at) VALUES (7,$1,NULL)`, j.now.Add(-time.Second))
		}, domain.SoftwareWindowNotIdle},
		{"source stamp missing", func(j *softwareWindowJourney) {
			j.exec(`UPDATE signal_log SET source_emitted_at=NULL WHERE field='Gear'`)
		}, domain.SoftwareWindowNotIdle},
		{"stale live", func(j *softwareWindowJourney) { j.now = j.start.Add(121 * time.Second) }, domain.SoftwareWindowNotIdle},
		{"stale owner check", func(j *softwareWindowJourney) { j.idleFrom(j.start.Add(8 * time.Minute)) }, domain.SoftwareWindowNoEvidence},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			j := newSoftwareWindowJourney(t)
			j.exec(`ALTER TABLE drives ALTER COLUMN ended_at DROP NOT NULL`)
			j.completedPark(j.start)
			j.idleFrom(j.start)
			j.confirm(softwareOwner, 0, 40*60, true, http.StatusNoContent)
			tt.change(j)
			got := j.read(softwareEndpoint, softwareOwner)
			if got.Reason != tt.want || got.Review != nil {
				t.Fatalf("want suppression %q, got %+v", tt.want, got)
			}
		})
	}
	t.Run("buffer exceeds departure", func(t *testing.T) {
		j := newSoftwareWindowJourney(t)
		j.completedPark(j.start)
		j.idleFrom(j.start)
		j.confirm(softwareOwner, 0, 90*60, true, http.StatusNoContent)
		if got := j.read(softwareEndpoint, softwareOwner); got.Reason != domain.SoftwareWindowTooShort || got.Review != nil {
			t.Fatalf("estimate alone fits but safety margin does not: %+v", got)
		}
	})
	t.Run("schedule stays blocking without fresh cache evidence", func(t *testing.T) {
		j := newSoftwareWindowJourney(t)
		j.completedPark(j.start)
		j.idleFrom(j.start)
		j.confirm(softwareOwner, 0, 40*60, true, http.StatusNoContent)
		plan := j.read(softwareEndpoint, softwareOwner)
		if plan.Review == nil {
			t.Fatalf("want actionable initial check: %+v", plan)
		}
		scheduledAt := j.now.Add(time.Second)
		j.emit("SoftwareUpdateScheduledStartTime", `"2026-11-20T19:00:00Z"`, scheduledAt)
		j.emit("DriverSeatOccupied", "false", scheduledAt)
		j.exec(`UPDATE signal_log SET source_emitted_at=NULL
			WHERE vehicle_id=7 AND field='DriverSeatOccupied' AND ts=$1`, scheduledAt)
		j.idleFrom(j.start.Add(3 * time.Minute))
		for _, removeLive := range []bool{false, true} {
			if removeLive {
				j.live.mu.Lock()
				delete(j.live.values, "SoftwareUpdateScheduledStartTime")
				j.live.mu.Unlock()
			}
			if got := j.read(softwareEndpoint, softwareOwner); got.Reason != domain.SoftwareWindowNotReady || got.Review != nil {
				t.Fatalf("post-confirmation schedule lost its veto (cache evicted=%t): %+v", removeLive, got)
			}
		}
		j.confirm(softwareOwner, plan.ID, 40*60, true, http.StatusNoContent)
		if got := j.read(softwareEndpoint, softwareOwner); got.Review == nil {
			t.Fatalf("fresh explicit recheck should replace the old confirmation: %+v", got)
		}
	})
}
