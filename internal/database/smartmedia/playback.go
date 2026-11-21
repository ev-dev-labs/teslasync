package smartmedia

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

var errInvalidMediaWindow = errors.New("invalid or unbounded playback evidence window")

type Repository struct {
	db *database.DB
}

func NewRepository(db *database.DB) *Repository { return &Repository{db: db} }

func (r *Repository) ActiveVehicle(ctx context.Context, vehicleID int64) (bool, error) {
	var active bool
	err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM vehicles WHERE id=$1 AND archived_at IS NULL)`, vehicleID).Scan(&active)
	if err != nil {
		return false, fmt.Errorf("check private media vehicle: %w", err)
	}
	return active, nil
}

func (r *Repository) PlaybackSamples(ctx context.Context, vehicleID int64, from, to time.Time) ([]domain.PlaybackSample, error) {
	return readPlaybackSamples(ctx, r.db.Pool, vehicleID, from, to)
}

func readPlaybackSamples(ctx context.Context, db database.DBTX, vehicleID int64, from, to time.Time) ([]domain.PlaybackSample, error) {
	const maxEvents = 20_000
	if vehicleID <= 0 || from.IsZero() || !to.After(from) || to.Sub(from) > 7*24*time.Hour {
		return nil, errInvalidMediaWindow
	}
	rows, err := db.Query(ctx, `
		SELECT s.ts,s.field,s.str_value,s.int_value,s.float_value,s.source_emitted_at,s.received_at
		FROM signal_log s JOIN vehicles v ON v.id=s.vehicle_id AND v.archived_at IS NULL
		WHERE s.vehicle_id=$1 AND s.ts>=$2 AND s.ts<=$3 AND s.field IN (
			'MediaNowPlayingTitle','MediaNowPlayingArtist','MediaPlaybackSource',
			'MediaPlaybackStatus','MediaNowPlayingDuration','MediaNowPlayingElapsed')
		ORDER BY s.ts,s.field LIMIT $4`, vehicleID, from, to, maxEvents+1)
	if err != nil {
		return nil, fmt.Errorf("query bounded playback changes: %w", err)
	}
	defer rows.Close()
	samples := make([]domain.PlaybackSample, 0)
	count := 0
	for rows.Next() {
		count++
		if count > maxEvents {
			return nil, signal.ErrTimelineEventLimit
		}
		var at time.Time
		var field string
		var text *string
		var whole *int64
		var fraction *float64
		var emitted, received *time.Time
		if err := rows.Scan(&at, &field, &text, &whole, &fraction, &emitted, &received); err != nil {
			return nil, fmt.Errorf("scan playback change: %w", err)
		}
		if len(samples) == 0 || !samples[len(samples)-1].At.Equal(at) {
			samples = append(samples, domain.PlaybackSample{At: at.UTC(), Attested: true})
		}
		sample := &samples[len(samples)-1]
		if emitted == nil || !emitted.Equal(at) || received == nil ||
			received.Before(at.Add(-time.Minute)) || received.After(at.Add(time.Minute)) {
			sample.Attested = false
			continue
		}
		switch field {
		case "MediaNowPlayingTitle":
			sample.Title = mediaText(text, sample)
		case "MediaNowPlayingArtist":
			sample.Artist = mediaText(text, sample)
		case "MediaPlaybackSource":
			sample.Source = mediaText(text, sample)
		case "MediaPlaybackStatus":
			sample.Status = mediaText(text, sample)
		case "MediaNowPlayingDuration":
			sample.DurationS = mediaSeconds(whole, fraction, sample)
		case "MediaNowPlayingElapsed":
			sample.ElapsedS = mediaSeconds(whole, fraction, sample)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read playback changes: %w", err)
	}
	return samples, nil
}

func mediaText(text *string, sample *domain.PlaybackSample) *string {
	if text == nil {
		sample.Attested = false
	}
	return text
}

func mediaSeconds(whole *int64, fraction *float64, sample *domain.PlaybackSample) *float64 {
	// Tesla declares these two atomics in milliseconds; the raw signal log
	// retains that vendor scale. The derived media contract uses seconds.
	if whole != nil && fraction == nil {
		duration := float64(*whole) / 1000
		return &duration
	}
	if fraction != nil && whole == nil {
		duration := *fraction / 1000
		return &duration
	}
	sample.Attested = false
	return nil
}
