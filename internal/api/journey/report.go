package journey

import (
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// ChecklistRecap summarizes the latest readiness run.
type ChecklistRecap struct {
	Ready int `json:"ready"`
	Total int `json:"total"`
}

// Report is the debrief card: what the trip covered, how long it
// took, how far it strayed from the straight line, and how ready it
// was. Computed live from the trail — for an unfinished trip it reads
// as a "so far" card, flagged in evidence.
type Report struct {
	SessionID int64           `json:"session_id"`
	Status    string          `json:"status"`
	StartedAt *time.Time      `json:"started_at"`
	EndedAt   *time.Time      `json:"ended_at"`
	DurationS *float64        `json:"duration_s"`
	DistanceM *float64        `json:"distance_m"`
	Fixes     int             `json:"fixes"`
	Plans     int             `json:"plans"`
	Replans   int             `json:"replans"`
	Detour    *float64        `json:"detour"`
	Checklist *ChecklistRecap `json:"checklist"`
	Evidence  []string        `json:"evidence"`
}

// TrailDistanceM measures the driven path. Odometer span wins when
// the time-first and time-last fixes both carry one (road truth);
// otherwise the haversine sum over time-ordered fixes. Fewer than two
// fixes measures nothing. Order-agnostic. Pure.
func TrailDistanceM(points []*Checkpoint) (float64, bool) {
	if len(points) < 2 {
		return 0, false
	}
	ordered := make([]*Checkpoint, len(points))
	copy(ordered, points)
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].RecordedAt.Before(ordered[j].RecordedAt)
	})
	first, last := ordered[0], ordered[len(ordered)-1]
	if first.OdometerM != nil && last.OdometerM != nil && *last.OdometerM >= *first.OdometerM {
		return *last.OdometerM - *first.OdometerM, true
	}
	sum := 0.0
	for i := 1; i < len(ordered); i++ {
		sum += haversineM(ordered[i-1].Lat, ordered[i-1].Lng, ordered[i].Lat, ordered[i].Lng)
	}
	return sum, true
}

// TripDurationS measures started→ended, or started→last-fix for a trip
// still live. Nil without a start. Negative spans (clock skew) read as
// no duration. Pure.
func TripDurationS(started, ended *time.Time, fixes []*Checkpoint) (float64, bool) {
	if started == nil {
		return 0, false
	}
	end := ended
	if end == nil {
		var last *time.Time
		for _, f := range fixes {
			if f == nil {
				continue
			}
			if last == nil || f.RecordedAt.After(*last) {
				t := f.RecordedAt
				last = &t
			}
		}
		end = last
	}
	if end == nil {
		return 0, false
	}
	d := end.Sub(*started).Seconds()
	if d < 0 {
		return 0, false
	}
	return d, true
}

// DetourRatio compares the driven path to the straight-line plan:
// 1.0 hugs the line, 1.5 drove half as far again. Below 1.0 the trip
// covered less than the full leg (or cut the corner). Nil without a
// positive straight leg. Rounded to 2 dp for stable display. Pure.
func DetourRatio(trailM, straightM float64) *float64 {
	if straightM <= 0 {
		return nil
	}
	r := math.Round(trailM/straightM*100) / 100
	return &r
}

// CountPlans tallies versions and replans (kind "replan"). Pure.
func CountPlans(plans []*PlanVersion) (total, replans int) {
	for _, p := range plans {
		if p == nil {
			continue
		}
		total++
		var kind struct {
			Kind string `json:"kind"`
		}
		if err := json.Unmarshal(p.Plan, &kind); err == nil && kind.Kind == "replan" {
			replans++
		}
	}
	return total, replans
}

// RecapChecklist counts ready (ok) items in the latest run. Nil run
// yields nil. Pure.
func RecapChecklist(run *Run) *ChecklistRecap {
	if run == nil {
		return nil
	}
	recap := &ChecklistRecap{Total: len(run.Items)}
	for _, item := range run.Items {
		if item.Status == ItemOK {
			recap.Ready++
		}
	}
	return recap
}

// ReportHandler serves the debrief card. Stateless beyond constructor
// inputs; safe for concurrent use.
type ReportHandler struct {
	store SessionStore
	trail TrailStore
	runs  RunStore
	now   func() time.Time
}

// NewReportHandler wires the handler. Panics on nil inputs (fail-fast
// wiring contract, matching sibling handlers).
func NewReportHandler(store SessionStore, trail TrailStore, runs RunStore) *ReportHandler {
	if store == nil || trail == nil || runs == nil {
		panic("journey: nil dependency")
	}
	return &ReportHandler{store: store, trail: trail, runs: runs, now: time.Now}
}

// Card serves GET /journey/sessions/{id}/report: the debrief card.
func (h *ReportHandler) Card(w http.ResponseWriter, r *http.Request) {
	id, err := sessionIDParam(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx := r.Context()
	session, err := h.store.Get(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: get failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read journey")
		return
	}
	if session == nil {
		httpx.WriteError(w, http.StatusNotFound, "journey not found")
		return
	}
	trail, err := h.trail.Trail(ctx, id, 100)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: trail failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read trail")
		return
	}
	plans, err := h.store.ListPlans(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: list plans failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read plans")
		return
	}
	run, err := h.runs.LatestChecklistRun(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: latest checklist failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read checklist")
		return
	}
	out := Report{
		SessionID: id, Status: session.Status,
		StartedAt: session.StartedAt, EndedAt: session.EndedAt,
		Fixes: len(trail), Checklist: RecapChecklist(run),
	}
	if d, ok := TrailDistanceM(trail); ok {
		out.DistanceM = &d
	}
	if d, ok := TripDurationS(session.StartedAt, session.EndedAt, trail); ok {
		out.DurationS = &d
	}
	out.Plans, out.Replans = CountPlans(plans)
	if out.DistanceM != nil {
		straight := straightM(session)
		out.Detour = DetourRatio(*out.DistanceM, straight)
	}
	out.Evidence = reportEvidence(session, &out, straightM(session))
	httpx.WriteJSON(w, http.StatusOK, out)
}

func straightM(session *Session) float64 {
	if session.OriginLat == nil || session.OriginLng == nil || session.DestLat == nil || session.DestLng == nil {
		return 0
	}
	return haversineM(*session.OriginLat, *session.OriginLng, *session.DestLat, *session.DestLng)
}

func reportEvidence(session *Session, rep *Report, straight float64) []string {
	out := []string{}
	if rep.DurationS != nil {
		out = append(out, "trip time "+formatDur(*rep.DurationS))
	} else {
		out = append(out, "trip never started")
	}
	if rep.DistanceM != nil {
		out = append(out, formatKm("drove ", *rep.DistanceM/1000))
	} else {
		out = append(out, "no trail — nothing driven yet")
	}
	if rep.Detour != nil {
		out = append(out, strconv.FormatFloat(*rep.Detour, 'f', 2, 64)+"× the straight line")
	} else if straight <= 0 {
		out = append(out, "route coordinates missing — detour unavailable")
	}
	switch rep.Replans {
	case 0:
		out = append(out, "no replans — the first plan held")
	case 1:
		out = append(out, "1 replan en route")
	default:
		out = append(out, strconv.Itoa(rep.Replans)+" replans en route")
	}
	if rep.Checklist != nil {
		out = append(out, strconv.Itoa(rep.Checklist.Ready)+"/"+strconv.Itoa(rep.Checklist.Total)+" ready at the last check")
	} else {
		out = append(out, "no checklist run")
	}
	if session.Status == StatusActive || session.Status == StatusPaused {
		out = append(out, "trip still live — card reads so far")
	}
	return out
}
