package teslaphysics

import (
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func fp(v float64) *float64 { return &v }

func bp(v bool) *bool { return &v }

func at(t *testing.T, raw string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func TestBuildChargePhysics_StoryEtiquetteAndSchedule(t *testing.T) {
	start := at(t, "2026-03-01T10:00:00Z")
	complete := at(t, "2026-03-01T10:40:00Z")
	unplug := at(t, "2026-03-01T11:27:00Z")
	scheduled := at(t, "2026-03-01T21:00:00Z")
	resumeAnyway := at(t, "2026-03-01T10:20:00Z")

	dc := BuildChargePhysics(9, 7, start, &unplug, "Supercharger", []ChargeSample{
		{At: start, DetailedChargeState: enums.ChargeStateStarting, FastChargerPresent: bp(true), FastChargerType: "Supercharger"},
		{At: start.Add(time.Minute), DetailedChargeState: enums.ChargeStateCharging, FastChargerPresent: bp(true)},
		{At: complete, DetailedChargeState: enums.ChargeStateComplete, FastChargerPresent: bp(true)},
		{At: unplug, DetailedChargeState: enums.ChargeStateDisconnected},
	}, unplug)
	if len(dc.Story) != 4 {
		t.Fatalf("story phases = %d, want 4: %+v", len(dc.Story), dc.Story)
	}
	if dc.Story[0].State != enums.ChargeStateStarting || dc.Story[2].State != enums.ChargeStateComplete {
		t.Fatalf("story = %+v", dc.Story)
	}
	if dc.AtLimitStillPluggedS == nil || *dc.AtLimitStillPluggedS != 47*60 {
		t.Fatalf("at-limit plugged = %v, want 2820", dc.AtLimitStillPluggedS)
	}
	if !dc.Etiquette.Applicable || dc.Etiquette.DwellS == nil || *dc.Etiquette.DwellS != 47*60 {
		t.Fatalf("etiquette = %+v", dc.Etiquette)
	}

	ac := BuildChargePhysics(10, 7, start, &unplug, "ac", []ChargeSample{
		{At: start, DetailedChargeState: enums.ChargeStateCharging},
		{At: complete, DetailedChargeState: enums.ChargeStateComplete},
		{At: unplug, DetailedChargeState: enums.ChargeStateDisconnected},
	}, unplug)
	if ac.Etiquette.Applicable {
		t.Fatalf("AC etiquette should not apply: %+v", ac.Etiquette)
	}

	scheduleEnd := scheduled.Add(2 * time.Hour)
	waited := BuildChargePhysics(11, 7, start, &scheduleEnd, "", []ChargeSample{
		{At: start, DetailedChargeState: enums.ChargeStateCharging, ScheduledMode: "StartAt", ScheduledStart: &scheduled},
		{At: start.Add(10 * time.Minute), DetailedChargeState: enums.ChargeStateStopped, ScheduledMode: "StartAt", ScheduledStart: &scheduled},
		{At: scheduled.Add(time.Hour), DetailedChargeState: enums.ChargeStateCharging, ScheduledMode: "StartAt", ScheduledStart: &scheduled},
		{At: scheduleEnd, DetailedChargeState: enums.ChargeStateDisconnected},
	}, scheduleEnd)
	if waited.Schedule.Unknown || waited.Schedule.WaitedForSchedule == nil || !*waited.Schedule.WaitedForSchedule {
		t.Fatalf("expected waited schedule, got %+v", waited.Schedule)
	}

	anyway := BuildChargePhysics(12, 7, start, &scheduleEnd, "", []ChargeSample{
		{At: start, DetailedChargeState: enums.ChargeStateCharging, ScheduledMode: "StartAt", ScheduledStart: &scheduled},
		{At: start.Add(10 * time.Minute), DetailedChargeState: enums.ChargeStateStopped, ScheduledMode: "StartAt", ScheduledStart: &scheduled},
		{At: resumeAnyway, DetailedChargeState: enums.ChargeStateCharging, ScheduledMode: "StartAt", ScheduledStart: &scheduled},
		{At: scheduleEnd, DetailedChargeState: enums.ChargeStateDisconnected},
	}, scheduleEnd)
	if anyway.Schedule.ChargedAnyway == nil || !*anyway.Schedule.ChargedAnyway {
		t.Fatalf("expected charged anyway, got %+v", anyway.Schedule)
	}
}

func TestBuildVampireSplit_TrailingParkAndNeutral(t *testing.T) {
	start := at(t, "2026-03-01T01:00:00Z")
	split := BuildVampireSplit(7, []VampireSample{
		{At: start, Gear: "P", ChargeState: enums.ChargeStateComplete, BatteryPct: fp(80)},
		{At: start.Add(2 * time.Hour), Gear: "P", ChargeState: enums.ChargeStateComplete, BatteryPct: fp(78)},
		{At: start.Add(3 * time.Hour), Gear: "P", ChargeState: enums.ChargeStateDisconnected, BatteryPct: fp(78)},
		{At: start.Add(5 * time.Hour), Gear: "P", ChargeState: enums.ChargeStateDisconnected, BatteryPct: fp(75)},
	})
	if len(split.CompletePlugged) != 1 || split.CompletePluggedPct == nil || *split.CompletePluggedPct != 2 {
		t.Fatalf("complete plugged = %+v pct=%v", split.CompletePlugged, split.CompletePluggedPct)
	}
	if len(split.Unplugged) != 1 || split.UnpluggedPct == nil || *split.UnpluggedPct != 3 {
		t.Fatalf("unplugged = %+v pct=%v", split.Unplugged, split.UnpluggedPct)
	}

	neutral := BuildVampireSplit(7, []VampireSample{
		{At: start, Gear: "N", ChargeState: enums.ChargeStateDisconnected, BatteryPct: fp(80)},
		{At: start.Add(2 * time.Hour), Gear: "N", ChargeState: enums.ChargeStateDisconnected, BatteryPct: fp(70)},
	})
	if len(neutral.CompletePlugged) != 0 || len(neutral.Unplugged) != 0 {
		t.Fatalf("neutral must not count as parked drain: %+v", neutral)
	}
}

func TestBuildParkTruth_ConfirmAndNeutral(t *testing.T) {
	start := at(t, "2026-03-01T12:00:00Z")
	now := start.Add(45 * time.Second)
	parked := BuildParkTruth([]ParkSample{
		{At: start, Gear: "P", Sentry: true, CabinOverheat: true, Preconditioning: true},
		{At: now, Gear: "P", Sentry: true, CabinOverheat: true, Preconditioning: true},
	}, now)
	if !parked.ConfirmedPark || !parked.SentryCounted || !parked.CabinOverheatCounted || !parked.PreconditioningCounted {
		t.Fatalf("confirmed park should count accessories: %+v", parked)
	}

	early := BuildParkTruth([]ParkSample{
		{At: start, Gear: "P", Sentry: true},
		{At: start.Add(10 * time.Second), Gear: "P", Sentry: true},
	}, start.Add(10*time.Second))
	if early.ConfirmedPark || early.SentryCounted || len(early.Rejected) == 0 {
		t.Fatalf("unconfirmed park should reject sentry: %+v", early)
	}

	neutral := BuildParkTruth([]ParkSample{
		{At: start, Gear: "N", Sentry: true},
		{At: now, Gear: "N", Sentry: true},
	}, now)
	if !neutral.NeutralRolling || neutral.ConfirmedPark || neutral.SentryCounted {
		t.Fatalf("neutral is rolling, not park: %+v", neutral)
	}
}

func TestBuildSilentReport_NullIsUnknownNotDisengagement(t *testing.T) {
	start := at(t, "2026-03-01T08:00:00Z")
	silent := BuildSilentReport(295, 7, []MotionSample{
		{At: start, Gear: "D", SpeedMps: fp(15), FSDDistanceM: fp(1000)},
		{At: start.Add(2 * time.Minute), Gear: "D", SpeedMps: fp(16), FSDDistanceM: fp(1000)},
		{At: start.Add(4 * time.Minute), Gear: "D", SpeedMps: fp(17), FSDDistanceM: fp(1000)},
	})
	if silent.Unknown || len(silent.Intervals) != 1 {
		t.Fatalf("expected one silent interval, got %+v", silent)
	}

	unknown := BuildSilentReport(295, 7, []MotionSample{
		{At: start, Gear: "D", SpeedMps: fp(15)},
		{At: start.Add(2 * time.Minute), Gear: "D", SpeedMps: fp(16)},
	})
	if !unknown.Unknown || len(unknown.Intervals) != 0 {
		t.Fatalf("null FSD is unknown, never a disengagement: %+v", unknown)
	}

	advancing := BuildSilentReport(295, 7, []MotionSample{
		{At: start, Gear: "D", SpeedMps: fp(15), FSDDistanceM: fp(1000)},
		{At: start.Add(2 * time.Minute), Gear: "D", SpeedMps: fp(16), FSDDistanceM: fp(1400)},
	})
	if len(advancing.Intervals) != 0 {
		t.Fatalf("advancing counter is not silent: %+v", advancing)
	}
}

func TestBuildSessionCertificate_HashAndHMAC(t *testing.T) {
	issued := at(t, "2026-03-02T00:00:00Z")
	from := at(t, "2026-03-01T00:00:00Z")
	to := at(t, "2026-03-02T00:00:00Z")
	end := at(t, "2026-03-01T11:00:00Z")
	drives := []SessionBoundary{{
		Kind: "drive", ID: 1, StartedAt: from, EndedAt: &end, EndRule: "confirmed Park (Gear=P)",
	}}
	a := BuildSessionCertificate(7, issued, from, to, drives, nil, nil)
	b := BuildSessionCertificate(7, issued, from, to, drives, nil, nil)
	if a.IntegritySHA256 == "" || a.IntegritySHA256 != b.IntegritySHA256 {
		t.Fatalf("hash mismatch: %s vs %s", a.IntegritySHA256, b.IntegritySHA256)
	}
	if a.HMACSHA256 != nil {
		t.Fatalf("HMAC should be omitted without a key")
	}
	signed := BuildSessionCertificate(7, issued, from, to, drives, nil, []byte("homelab-key"))
	if signed.HMACSHA256 == nil || *signed.HMACSHA256 == "" {
		t.Fatal("expected HMAC when a key is supplied")
	}
}

func TestBuildOutageAutobiography_UnknownGap(t *testing.T) {
	last := at(t, "2026-03-01T10:00:00Z")
	now := last.Add(10 * time.Minute)
	connected := true
	out := BuildOutageAutobiography(7, &last, &connected, now, nil)
	if !out.ReplayPreservesEventTime {
		t.Fatal("replay must preserve event time")
	}
	if out.UnknownSince == nil || out.GapS == nil {
		t.Fatalf("10-minute gap should stay unknown: %+v", out)
	}
}

func TestBuildHeartbeat_TripMeterNotEngagement(t *testing.T) {
	now := at(t, "2026-03-01T12:00:00Z")
	state := signal.State{
		"SelfDrivingMilesSinceReset": 1234.0,
		"MilesSinceReset":            9000.0,
		"Gear":                       "D",
		"ValetModeEnabled":           false,
		"Version":                    "2026.20.3",
	}
	hb := BuildHeartbeat(7, state, nil, now)
	if hb.FSDDistanceM == nil || *hb.FSDDistanceM != 1234 {
		t.Fatalf("fsd meter = %v", hb.FSDDistanceM)
	}
	if hb.LastTickAt != nil {
		t.Fatalf("a present meter is not a tick: %v", hb.LastTickAt)
	}
	if hb.Label == "" || hb.Honesty == "" {
		t.Fatal("heartbeat must keep the trip-meter honesty label")
	}

	tickAt := now.Add(-2 * time.Minute)
	ticked := BuildHeartbeat(7, state, []MotionSample{
		{At: now.Add(-10 * time.Minute), FSDDistanceM: fp(1200)},
		{At: tickAt, FSDDistanceM: fp(1234)},
	}, now)
	if ticked.LastTickAt == nil || !ticked.LastTickAt.Equal(tickAt) {
		t.Fatalf("last tick = %v, want %v", ticked.LastTickAt, tickAt)
	}
}

func TestParseScheduledStart_UnixAndMinutes(t *testing.T) {
	sample := at(t, "2026-03-01T10:00:00Z")
	unix := parseScheduledStart(float64(sample.Unix()), sample)
	if unix == nil || !unix.Equal(sample) {
		t.Fatalf("unix seconds = %v", unix)
	}
	minutes := parseScheduledStart(float64(21*60), sample)
	want := time.Date(2026, 3, 1, 21, 0, 0, 0, time.UTC)
	if minutes == nil || !minutes.Equal(want) {
		t.Fatalf("minutes-from-midnight = %v want %v", minutes, want)
	}
}
