package smartmedia

import (
	"context"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
)

type DriveScope struct {
	Scope
	DriveID int64
}

type LibraryProvider interface {
	LibraryAuthorizationURL(state, challenge string) string
	ExchangeLibrary(ctx context.Context, code, verifier string) (domain.SpotifyGrant, error)
	Track(ctx context.Context, token, id string) (domain.CatalogTrack, error)
	SaveLibraryTrack(ctx context.Context, token, id string) error
}

type LibraryOAuthAttempt struct {
	Scope          DriveScope
	ReviewID       int64
	Revision       int64
	VerifierCipher string
}

type TrackReviewRepository interface {
	ReadDriveTrack(ctx context.Context, scope DriveScope, now time.Time) (*domain.DriveTrackSource, error)
	ConfirmDriveTrack(ctx context.Context, scope DriveScope, confirmation domain.DriveTrackConfirmation, selected, now time.Time) error
	ClearDriveTrack(ctx context.Context, scope DriveScope, id int64, now time.Time) error
	StartLibraryAuthorization(ctx context.Context, scope DriveScope, id int64, stateHash []byte, cipher string, now time.Time) error
	ConsumeLibraryAuthorization(ctx context.Context, subject string, stateHash []byte, now time.Time) (*LibraryOAuthAttempt, error)
	SetLibraryGrant(ctx context.Context, attempt LibraryOAuthAttempt, cipher string, expiry, now time.Time) error
	ReadLibraryGrant(ctx context.Context, scope DriveScope, id int64, now time.Time) (*Grant, error)
	DisconnectLibrary(ctx context.Context, scope DriveScope, id int64) error
	ClaimTrackSave(ctx context.Context, scope DriveScope, id, revision int64, now time.Time) error
	FinishTrackSave(ctx context.Context, scope DriveScope, id int64, status domain.TrackSaveStatus) error
}
