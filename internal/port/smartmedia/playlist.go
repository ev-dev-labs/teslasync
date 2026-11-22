package smartmedia

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
)

var (
	ErrNotFound = errors.New("private media record not found")
	ErrChanged  = errors.New("private media record changed")
)

type Scope struct {
	Subject   string
	VehicleID int64
}

type SpotifyProvider interface {
	AuthorizationURL(state, challenge string) string
	Exchange(ctx context.Context, code, verifier string) (domain.SpotifyGrant, error)
	Track(ctx context.Context, token, id string) (domain.CatalogTrack, error)
	CreatePrivate(ctx context.Context, token, name string) (string, error)
	AddTracks(ctx context.Context, token, playlistID string, trackIDs []string) error
}

type OAuthAttempt struct {
	Revision       int64
	VehicleID      int64
	VerifierCipher string
}

type Grant struct {
	Revision    int64
	TokenCipher string
	ExpiresAt   time.Time
}

type Repository interface {
	ActiveVehicle(context.Context, int64) (bool, error)
	PlaylistSamples(ctx context.Context, scope Scope, from, to time.Time) ([]domain.PlaybackSample, time.Time, error)
	CheckPlaylistDraft(ctx context.Context, scope Scope, id int64) error
	ReadDraft(context.Context, Scope) (*domain.PlaylistDraft, error)
	ReplaceDraft(ctx context.Context, scope Scope, expectedID int64, draft domain.PlaylistDraft) error
	HoldDraft(ctx context.Context, scope Scope, id int64, snoozedUntil *time.Time, now time.Time) error
	DeleteDraft(ctx context.Context, scope Scope, id int64, abandonedBefore time.Time) error
	StartSpotify(ctx context.Context, scope Scope, stateHash []byte, verifierCipher string, expiresAt time.Time) error
	ConsumeSpotify(ctx context.Context, subject string, stateHash []byte, now time.Time) (*OAuthAttempt, error)
	SetSpotifyGrant(ctx context.Context, subject string, revision int64, grant Grant, now time.Time) error
	SpotifyGrant(ctx context.Context, subject string, now time.Time) (*Grant, error)
	DisconnectSpotify(ctx context.Context, subject string) error
	ClaimPlaylistSave(ctx context.Context, scope Scope, id, revision int64, now time.Time) (bool, error)
	CanSendPlaylistItems(ctx context.Context, scope Scope, id, revision int64, now time.Time) (bool, error)
	RecordPlaylistCreated(ctx context.Context, scope Scope, id int64, playlistID string) error
	FinishPlaylistSave(ctx context.Context, scope Scope, id int64, status domain.PlaylistSaveStatus) error
}

type SecretCodec interface {
	Encrypt(string) (string, error)
	Decrypt(string) (string, error)
}
