package database

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// MediaRepo reads/writes media playback data via the consolidated
// vehicle_meta_snapshots table (category='media'). The old media_snapshots
// table was dropped in migration 000142_baseline_typed.
type MediaRepo struct {
	db *DB
}

func NewMediaRepo(db *DB) *MediaRepo {
	return &MediaRepo{db: db}
}

func (r *MediaRepo) Insert(ctx context.Context, snap *models.MediaSnapshot) error {
	// Derive media_is_playing (bool) from PlaybackStatus (string)
	var isPlaying *bool
	if snap.PlaybackStatus != nil {
		b := *snap.PlaybackStatus == "Playing"
		isPlaying = &b
	}

	// Convert NowPlayingDuration (int) to media_track_duration_sec (int32)
	var durationSec *int32
	if snap.NowPlayingDuration != nil {
		d := int32(*snap.NowPlayingDuration)
		durationSec = &d
	}

	query := `INSERT INTO vehicle_meta_snapshots
		(vehicle_id, ts, category,
		 media_source, media_track_title, media_track_artist, media_track_album,
		 media_volume, media_is_playing, media_track_duration_sec, source)
		VALUES ($1, $2, 'media', $3, $4, $5, $6, $7, $8, $9, 'fleet_telemetry')
		ON CONFLICT (vehicle_id, ts, category) DO NOTHING`
	_, err := r.db.Pool.Exec(ctx, query,
		snap.VehicleID, time.Now().UTC(),
		snap.PlaybackSource, snap.NowPlayingTitle, snap.NowPlayingArtist, snap.NowPlayingAlbum,
		snap.AudioVolume, isPlaying, durationSec)
	return err
}

func (r *MediaRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.MediaSnapshot, error) {
	query := `SELECT vehicle_id,
		media_track_title, media_track_artist, media_track_album,
		media_track_duration_sec, media_is_playing, media_source,
		media_volume, ts
		FROM vehicle_meta_snapshots
		WHERE vehicle_id = $1 AND category = 'media'
		ORDER BY ts DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.MediaSnapshot
	for rows.Next() {
		s := &models.MediaSnapshot{}
		var durationSec *int32
		var isPlaying *bool
		if err := rows.Scan(&s.VehicleID,
			&s.NowPlayingTitle, &s.NowPlayingArtist, &s.NowPlayingAlbum,
			&durationSec, &isPlaying, &s.PlaybackSource,
			&s.AudioVolume, &s.CreatedAt); err != nil {
			return nil, err
		}
		if durationSec != nil {
			d := int(*durationSec)
			s.NowPlayingDuration = &d
		}
		if isPlaying != nil {
			if *isPlaying {
				status := "Playing"
				s.PlaybackStatus = &status
			} else {
				status := "Stopped"
				s.PlaybackStatus = &status
			}
		}
		snaps = append(snaps, s)
	}
	return snaps, rows.Err()
}

func (r *MediaRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.MediaSnapshot, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	return snaps[0], nil
}
