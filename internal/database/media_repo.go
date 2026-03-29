package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type MediaRepo struct {
	db *DB
}

func NewMediaRepo(db *DB) *MediaRepo {
	return &MediaRepo{db: db}
}

func (r *MediaRepo) Insert(ctx context.Context, snap *models.MediaSnapshot) error {
	query := `INSERT INTO media_snapshots (vehicle_id, now_playing_title, now_playing_artist, now_playing_album, now_playing_station, now_playing_duration, now_playing_elapsed, playback_status, playback_source, audio_volume, audio_volume_max)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.NowPlayingTitle, snap.NowPlayingArtist, snap.NowPlayingAlbum,
		snap.NowPlayingStation, snap.NowPlayingDuration, snap.NowPlayingElapsed,
		snap.PlaybackStatus, snap.PlaybackSource, snap.AudioVolume, snap.AudioVolumeMax,
	).Scan(&snap.ID)
}

func (r *MediaRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.MediaSnapshot, error) {
	query := `SELECT id, vehicle_id, now_playing_title, now_playing_artist, now_playing_album, now_playing_station, now_playing_duration, now_playing_elapsed, playback_status, playback_source, audio_volume, audio_volume_max, created_at
		FROM media_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.MediaSnapshot
	for rows.Next() {
		s := &models.MediaSnapshot{}
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.NowPlayingTitle, &s.NowPlayingArtist, &s.NowPlayingAlbum,
			&s.NowPlayingStation, &s.NowPlayingDuration, &s.NowPlayingElapsed,
			&s.PlaybackStatus, &s.PlaybackSource, &s.AudioVolume, &s.AudioVolumeMax,
			&s.CreatedAt); err != nil {
			return nil, err
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
