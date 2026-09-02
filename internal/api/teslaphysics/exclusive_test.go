package teslaphysics

import (
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
)

func TestBuildThreeClocks_IngestUnknownAndGapsStayGaps(t *testing.T) {
	now := at(t, "2026-03-01T12:00:00Z")
	clocks := BuildThreeClocks(7, []PhysicsFrame{
		{At: at(t, "2026-03-01T11:00:00Z"), Gear: "P"},
		{At: at(t, "2026-03-01T11:50:00Z"), Gear: "P"},
	}, now)
	if clocks.Latest == nil || !clocks.Latest.Unknown || clocks.Latest.IngestTime != nil {
		t.Fatalf("ingest time must stay unknown: %+v", clocks.Latest)
	}
	if clocks.Latest.GapS == nil || *clocks.Latest.GapS != 10*60 {
		t.Fatalf("display gap = %v", clocks.Latest.GapS)
	}
}

func TestBuildLifeTape_NeutralNotParkAndUnknownGaps(t *testing.T) {
	now := at(t, "2026-03-01T12:10:00Z")
	tape := BuildLifeTape(7, []PhysicsFrame{
		{At: at(t, "2026-03-01T12:00:00Z"), Gear: "D", SpeedMps: fp(12)},
		{At: at(t, "2026-03-01T12:01:00Z"), Gear: "N", SpeedMps: fp(1.5)},
		{At: at(t, "2026-03-01T12:08:00Z"), Gear: "P"},
	}, now)
	states := make([]string, 0, len(tape.Segments))
	for _, segment := range tape.Segments {
		states = append(states, segment.State)
	}
	if len(states) < 3 {
		t.Fatalf("segments = %+v", tape.Segments)
	}
	foundNeutral := false
	foundUnknown := false
	foundPark := false
	for _, state := range states {
		if state == "neutral_rolling" {
			foundNeutral = true
		}
		if state == "unknown" {
			foundUnknown = true
		}
		if state == "confirmed_park" {
			t.Fatal("Park must not confirm without 30s of Gear=P")
		}
		if state == "park_unconfirmed" {
			foundPark = true
		}
	}
	if !foundNeutral || !foundUnknown || !foundPark {
		t.Fatalf("want Neutral, unknown gap, unconfirmed Park; got %v", states)
	}
}

func TestBuildContradictionCourt_ParkSpeedAndCompleteLatched(t *testing.T) {
	court := BuildContradictionCourt(7, []PhysicsFrame{
		{At: at(t, "2026-03-01T12:00:00Z"), Gear: "P", SpeedMps: fp(8)},
		{At: at(t, "2026-03-01T12:01:00Z"), ChargeState: enums.ChargeStateComplete, Latch: "Engaged"},
	})
	if len(court.Findings) != 1 || court.Findings[0].Kind != "park_with_speed" {
		t.Fatalf("Complete still latched must not be a contradiction: %+v", court.Findings)
	}
}

func TestBuildMeterGenealogy_NullIsNotZeroReset(t *testing.T) {
	gen := BuildMeterGenealogy(7, []PhysicsFrame{
		{At: at(t, "2026-03-01T12:00:00Z")},
		{At: at(t, "2026-03-01T12:01:00Z"), FSDDistanceM: fp(0)},
		{At: at(t, "2026-03-01T12:02:00Z"), FSDDistanceM: fp(1000)},
		{At: at(t, "2026-03-01T12:03:00Z"), FSDDistanceM: fp(100), Service: bp(true)},
	})
	if len(gen.Resets) != 1 || gen.Resets[0].Cause != "service" {
		t.Fatalf("nil then 0 is not a reset; service drop is: %+v", gen.Resets)
	}
}

func TestBuildUnknownOS_EmptyWindowIsUnknownNotZero(t *testing.T) {
	from := at(t, "2026-03-01T00:00:00Z")
	to := at(t, "2026-03-02T00:00:00Z")
	os := BuildUnknownOS(7, nil, from, to)
	if os.UnknownHours == nil || *os.UnknownHours != 24 {
		t.Fatalf("unknown hours = %v", os.UnknownHours)
	}
	if os.SampleHours != nil {
		t.Fatalf("no samples means sample hours stay unknown, got %v", *os.SampleHours)
	}
}

func TestBuildCarKeptLiving_NullMQTTAndUnknownQueue(t *testing.T) {
	last := at(t, "2026-03-01T11:00:00Z")
	living := BuildCarKeptLiving(7, &last, nil, at(t, "2026-03-01T12:00:00Z"))
	if living.MQTTConnected != nil || living.QueuedCount != nil {
		t.Fatalf("MQTT and queue must stay unknown: %+v", living)
	}
	if living.NeverReceivedGapS == nil || *living.NeverReceivedGapS != 3600 {
		t.Fatalf("never-received gap = %v", living.NeverReceivedGapS)
	}
}

func TestBuildRangeDisagreement_NeverPicksTrueRange(t *testing.T) {
	dis := BuildRangeDisagreement(7, &PhysicsFrame{
		RatedRangeM: fp(400000),
		EstRangeM:   fp(320000),
		IdealRangeM: fp(410000),
	})
	if !dis.Disagree || dis.TrueRangeM != nil || dis.RecentWhPerKm != nil {
		t.Fatalf("must disagree without a true range: %+v", dis)
	}
}

func TestBuildModeLaws_UnknownTransport(t *testing.T) {
	laws := BuildModeLaws(7, &PhysicsFrame{Valet: bp(true)})
	if laws.Transport != nil {
		t.Fatal("Transport signal is not in Fleet Telemetry here — must stay unknown")
	}
	if laws.Valet == nil || !*laws.Valet {
		t.Fatalf("valet = %+v", laws.Valet)
	}
}

func TestBuildExclusiveReport_LogbookUsesTeslaWords(t *testing.T) {
	end := at(t, "2026-03-01T11:00:00Z")
	report := BuildExclusiveReport(7, []PhysicsFrame{
		{At: at(t, "2026-03-01T10:00:00Z"), Gear: "D", ChargeState: enums.ChargeStateDisconnected, Firmware: "2026.20.3"},
	}, at(t, "2026-03-01T12:00:00Z"), nil, []SessionBoundary{{
		Kind: "drive", ID: 295, StartedAt: at(t, "2026-03-01T10:00:00Z"), EndedAt: &end, EndRule: "confirmed Park (Gear=P)",
	}}, nil, nil)
	if report.Logbook.Entries[0].Word != "Drive" {
		t.Fatalf("logbook = %+v", report.Logbook.Entries)
	}
	if report.Range.TrueRangeM != nil {
		t.Fatal("exclusive report must not invent true range")
	}
	if report.Clocks.Latest.IngestTime != nil {
		t.Fatal("exclusive report must not invent ingest time")
	}
}

func TestBuildLifeTape_ConfirmedParkAfterDebounce(t *testing.T) {
	start := at(t, "2026-03-01T12:00:00Z")
	tape := BuildLifeTape(7, []PhysicsFrame{
		{At: start, Gear: "P"},
		{At: start.Add(30 * time.Second), Gear: "P"},
	}, start.Add(31*time.Second))
	found := false
	for _, segment := range tape.Segments {
		if segment.State == "confirmed_park" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected confirmed Park after 30s: %+v", tape.Segments)
	}
}
