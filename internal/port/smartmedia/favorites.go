package smartmedia

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
)

var ErrFavoriteLimit = errors.New("private favorite list is full")

type FavoriteDigestJob struct {
	ID        int64
	VehicleID int64
	Revision  int64
	TimeZone  string
	Lease     time.Time
}

type FavoriteDigestRepository interface {
	ReadFavoriteDigest(ctx context.Context, scope Scope, now time.Time) (domain.FavoriteDigestSettings, error)
	ReplaceFavoriteDigest(ctx context.Context, scope Scope, setup domain.FavoriteDigestSetup, next *time.Time) error
	DeleteFavoriteDigest(ctx context.Context, scope Scope, revision int64) error
	ActOnFavoriteDigest(ctx context.Context, scope Scope, action domain.FavoriteDigestAction, now time.Time) error
	ClaimFavoriteDigest(ctx context.Context, now, lease time.Time) (*FavoriteDigestJob, error)
	FavoriteEvidence(ctx context.Context, job FavoriteDigestJob, from, until time.Time, driveLimit int) ([]domain.DriveWindow, []domain.PlaybackSample, error)
	FinishFavoriteDigest(ctx context.Context, job FavoriteDigestJob, now, next time.Time, digest domain.FavoriteDigest) (bool, error)
}
