package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// mediaCoreCols are the media-playback fields kept as dedicated SQL columns.
// Track metadata (artist/album/etc.) lives in the signals JSONB column.
// See migrations 000142-000144.
var mediaCoreCols = []string{
	"playback_status",
	"audio_volume",
}

type MediaRepo struct {
	db *DB
}

func NewMediaRepo(db *DB) *MediaRepo {
	return &MediaRepo{db: db}
}

func (r *MediaRepo) Insert(ctx context.Context, snap *models.MediaSnapshot) error {
	signalsJSON, err := marshalSignals(snap, mediaCoreCols...)
	if err != nil {
		return err
	}
	query := `INSERT INTO media_snapshots
		(vehicle_id, playback_status, audio_volume, signals)
		VALUES ($1, $2, $3, $4) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.PlaybackStatus, snap.AudioVolume, signalsJSON,
	).Scan(&snap.ID)
}

func (r *MediaRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.MediaSnapshot, error) {
	query := `SELECT id, vehicle_id, playback_status, audio_volume, signals, created_at
		FROM media_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.MediaSnapshot
	for rows.Next() {
		s := &models.MediaSnapshot{}
		var signalsRaw []byte
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.PlaybackStatus, &s.AudioVolume,
			&signalsRaw, &s.CreatedAt); err != nil {
			return nil, err
		}
		if err := hydrateFromSignals(signalsRaw, s); err != nil {
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
