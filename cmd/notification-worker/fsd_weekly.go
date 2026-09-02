package main

import (
	"context"
	"sync"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/api/fsd"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/notification/fsddigest"
)

const fsdWeeklyDigestInterval = time.Hour

// fsdWeeklyLoader is the slice of fsd.Repo the digest tick needs.
type fsdWeeklyLoader interface {
	LoadAnalyticsInput(ctx context.Context, vehicleID int64, from, split, to time.Time) (fsd.AnalyticsInput, error)
}

// titleDeduper skips a vehicle/week that already has a non-failed log row.
type titleDeduper interface {
	ExistsTitleSince(ctx context.Context, title string, since time.Time) (bool, error)
}

// digestDeduper also remembers titles in-process. Web Push is a synthetic
// channel (ChannelID 0) so notification_logs often never records it.
type digestDeduper interface {
	titleDeduper
	Remember(title string)
}

type fsdDigestDeduper struct {
	logs titleDeduper
	mu   sync.Mutex
	seen map[string]struct{}
}

func newFsdDigestDeduper(logs titleDeduper) *fsdDigestDeduper {
	return &fsdDigestDeduper{logs: logs, seen: make(map[string]struct{})}
}

func (d *fsdDigestDeduper) ExistsTitleSince(ctx context.Context, title string, since time.Time) (bool, error) {
	if d == nil {
		return false, nil
	}
	d.mu.Lock()
	_, ok := d.seen[title]
	d.mu.Unlock()
	if ok {
		return true, nil
	}
	if d.logs == nil {
		return false, nil
	}
	return d.logs.ExistsTitleSince(ctx, title, since)
}

func (d *fsdDigestDeduper) Remember(title string) {
	if d == nil || title == "" {
		return
	}
	d.mu.Lock()
	d.seen[title] = struct{}{}
	d.mu.Unlock()
}

func runFsdWeeklyDigestTick(
	ctx context.Context,
	vehicles fleetVehicleLister,
	loader fsdWeeklyLoader,
	deduper digestDeduper,
	mqttClient pahomqtt.Client,
	now time.Time,
	span oteltrace.Span,
) {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	all, err := vehicles.GetAll(ctx)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "load vehicles failed")
		log.Error().Err(err).Msg("fsd-weekly: failed to load vehicles")
		return
	}

	sent := 0
	skipped := 0
	for _, vehicle := range all {
		if vehicle == nil || !vehicle.IsActive() {
			continue
		}
		switch sendFsdWeeklyDigest(ctx, loader, deduper, mqttClient, vehicle, now) {
		case "sent":
			sent++
		case "error":
			span.SetStatus(codes.Error, "vehicle digest failed")
			skipped++
		default:
			skipped++
		}
	}
	span.SetAttributes(
		attribute.Int("notification.fsd_weekly.sent", sent),
		attribute.Int("notification.fsd_weekly.skipped", skipped),
	)
}

func sendFsdWeeklyDigest(
	ctx context.Context,
	loader fsdWeeklyLoader,
	deduper digestDeduper,
	mqttClient pahomqtt.Client,
	vehicle *vehiclemodel.Vehicle,
	now time.Time,
) string {
	loc := fsd.LoadLocationOrUTC(vehicle.Timezone)
	weekStart, weekEnd := fsd.CurrentWeekBounds(now, loc)
	title := fsddigest.Title(vehicle.ID, weekStart, loc)

	already, err := deduper.ExistsTitleSince(ctx, title, weekStart)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("fsd-weekly: dedupe lookup failed")
		return "error"
	}
	if already {
		return "already_sent"
	}

	snapshot, err := loadFsdWeeklySnapshot(ctx, loader, vehicle.ID, loc, weekStart, weekEnd)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicle.ID).Msg("fsd-weekly: insights load failed")
		return "error"
	}
	if !fsddigest.ShouldSend(snapshot) {
		return "unmeasured"
	}

	req := &notification.Request{
		ChannelType: notification.ChannelTypeWebPush,
		Config: map[string]string{
			"severity":  fsddigest.Severity,
			"url":       fsddigest.DrillURL,
			"alert_tag": fsddigest.AlertTag(vehicle.ID, weekStart, loc),
		},
		Title:    title,
		Message:  fsddigest.Body(snapshot),
		Severity: fsddigest.Severity,
	}
	if pubErr := notification.PublishCtx(ctx, mqttClient, req); pubErr != nil {
		log.Error().Err(pubErr).Int64("vehicle_id", vehicle.ID).Msg("fsd-weekly: publish failed")
		return "error"
	}
	deduper.Remember(title)
	log.Info().
		Int64("vehicle_id", vehicle.ID).
		Str("title", title).
		Msg("fsd-weekly: digest published")
	return "sent"
}

func loadFsdWeeklySnapshot(
	ctx context.Context,
	loader fsdWeeklyLoader,
	vehicleID int64,
	loc *time.Location,
	weekStart, weekEnd time.Time,
) (fsddigest.Snapshot, error) {
	prevStart := fsd.PreviousWeekStart(weekStart, loc)
	input, err := loader.LoadAnalyticsInput(ctx, vehicleID, prevStart, weekStart, weekEnd)
	if err != nil {
		return fsddigest.Snapshot{}, err
	}
	current := fsd.Aggregate(fsd.AggregateParams{
		VehicleID: vehicleID,
		Days:      7,
		Loc:       loc,
		Start:     weekStart,
		End:       weekEnd,
		Samples:   input.CounterSamples,
	})
	previous := fsd.Aggregate(fsd.AggregateParams{
		VehicleID: vehicleID,
		Days:      7,
		Loc:       loc,
		Start:     prevStart,
		End:       weekStart,
		Samples:   input.PreviousCounterSamples,
	})
	current.Analytics = fsd.BuildDriveAnalytics(current, previous, input, loc, false)
	return fsddigest.Snapshot{
		VehicleID:      vehicleID,
		WeekStart:      weekStart,
		Location:       loc,
		FSDDistanceM:   current.Totals.FSDDistanceM,
		SharePct:       current.Totals.FSDSharePct,
		ShareChangePts: current.Analytics.Comparison.FSDShareChangePctPoints,
	}, nil
}
