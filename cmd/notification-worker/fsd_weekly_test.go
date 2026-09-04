package main

import (
	"context"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/fsd"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/notification/fsddigest"
)

type fakeFsdLoader struct {
	input fsd.AnalyticsInput
	err   error
	calls int
}

func (f *fakeFsdLoader) LoadAnalyticsInput(
	context.Context, int64, time.Time, time.Time, time.Time,
) (fsd.AnalyticsInput, error) {
	f.calls++
	return f.input, f.err
}

type fakeDeduper struct {
	exists bool
	err    error
	title  string
}

func (f *fakeDeduper) ExistsTitleSince(_ context.Context, title string, _ time.Time) (bool, error) {
	f.title = title
	return f.exists, f.err
}

func (f *fakeDeduper) Remember(title string) {
	f.title = title
	f.exists = true
}

func measuredFSDInput(now time.Time) fsd.AnalyticsInput {
	version := int16(1)
	value := 16000.0
	drive := 40000.0
	sample := func(field string, at time.Time, meters float64) fsd.Sample {
		v := meters
		return fsd.Sample{
			Field:                field,
			TS:                   at,
			Value:                &v,
			NormalizationVersion: &version,
		}
	}
	return fsd.AnalyticsInput{
		CounterSamples: []fsd.Sample{
			sample(fsd.SignalFSDDistance, now.Add(-2*time.Hour), 0),
			sample(fsd.SignalFSDDistance, now.Add(-time.Hour), value),
			sample(fsd.SignalDrivingDistance, now.Add(-2*time.Hour), 0),
			sample(fsd.SignalDrivingDistance, now.Add(-time.Hour), drive),
		},
	}
}

func TestRunFsdWeeklyDigestTick_PublishesOnceWhenMeasured(t *testing.T) {
	now := time.Date(2026, 3, 4, 15, 0, 0, 0, time.UTC)
	mqtt := &fakeMQTTClient{connected: true}
	loader := &fakeFsdLoader{input: measuredFSDInput(now)}
	deduper := &fakeDeduper{}
	runFsdWeeklyDigestTick(
		context.Background(),
		&fakeVehicleLister{vehicles: []*vehiclemodel.Vehicle{{
			ID: 7, DisplayName: "Aurora", Timezone: "UTC",
		}}},
		loader,
		deduper,
		mqtt,
		now,
		testSpan(),
	)
	reqs := mqtt.requests(t)
	if len(reqs) != 1 {
		t.Fatalf("published %d, want 1", len(reqs))
	}
	req := reqs[0]
	if req.ChannelType != notification.ChannelTypeWebPush {
		t.Fatalf("channel = %s, want webpush", req.ChannelType)
	}
	if req.Config["url"] != fsddigest.DrillURL {
		t.Fatalf("url = %s", req.Config["url"])
	}
	if req.Title != "Weekly FSD digest (#7 · 2026-03-02)" {
		t.Fatalf("title = %q", req.Title)
	}
	if req.Message == "" || req.Message == "Reported FSD 0.0 km this week." {
		t.Fatalf("message = %q", req.Message)
	}

	runFsdWeeklyDigestTick(
		context.Background(),
		&fakeVehicleLister{vehicles: []*vehiclemodel.Vehicle{{
			ID: 7, DisplayName: "Aurora", Timezone: "UTC",
		}}},
		loader,
		deduper,
		mqtt,
		now,
		testSpan(),
	)
	if mqtt.count() != 1 {
		t.Fatalf("second tick published %d, want 1 total", mqtt.count())
	}
}

func TestRunFsdWeeklyDigestTick_SkipsUnmeasuredAndAlreadySent(t *testing.T) {
	now := time.Date(2026, 3, 4, 15, 0, 0, 0, time.UTC)
	mqtt := &fakeMQTTClient{connected: true}

	runFsdWeeklyDigestTick(
		context.Background(),
		&fakeVehicleLister{vehicles: []*vehiclemodel.Vehicle{{ID: 7, Timezone: "UTC"}}},
		&fakeFsdLoader{},
		&fakeDeduper{},
		mqtt,
		now,
		testSpan(),
	)
	if mqtt.count() != 0 {
		t.Fatalf("unmeasured week published %d", mqtt.count())
	}

	loader := &fakeFsdLoader{input: measuredFSDInput(now)}
	runFsdWeeklyDigestTick(
		context.Background(),
		&fakeVehicleLister{vehicles: []*vehiclemodel.Vehicle{{ID: 7, Timezone: "UTC"}}},
		loader,
		&fakeDeduper{exists: true},
		mqtt,
		now,
		testSpan(),
	)
	if mqtt.count() != 0 {
		t.Fatalf("already-sent week published %d", mqtt.count())
	}
	if loader.calls != 0 {
		t.Fatalf("deduped week still loaded insights %d times", loader.calls)
	}
}

func TestRunFsdWeeklyDigestTick_SkipsArchivedVehicles(t *testing.T) {
	now := time.Date(2026, 3, 4, 15, 0, 0, 0, time.UTC)
	archived := now.Add(-time.Hour)
	mqtt := &fakeMQTTClient{connected: true}
	loader := &fakeFsdLoader{input: measuredFSDInput(now)}
	runFsdWeeklyDigestTick(
		context.Background(),
		&fakeVehicleLister{vehicles: []*vehiclemodel.Vehicle{{
			ID: 7, Timezone: "UTC", ArchivedAt: &archived,
		}}},
		loader,
		&fakeDeduper{},
		mqtt,
		now,
		testSpan(),
	)
	if mqtt.count() != 0 || loader.calls != 0 {
		t.Fatalf("archived vehicle published=%d loaded=%d", mqtt.count(), loader.calls)
	}
}
