package smartmedia

import (
	"context"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
)

type EpisodeProvider interface {
	EpisodeProgressAuthorizationURL(state, challenge string) string
	ExchangeEpisodeProgress(ctx context.Context, code, verifier string) (domain.SpotifyGrant, error)
	EpisodeProgress(ctx context.Context, token, id string) (domain.EpisodeProgress, error)
}

type EpisodeOAuth struct {
	Scope          Scope
	ReviewID       int64
	EpisodeID      string
	VerifierCipher string
}

type EpisodeRepository interface {
	ReadEpisodeReview(ctx context.Context, scope Scope) (*domain.StoredEpisodeReview, error)
	ReplaceEpisodeReview(ctx context.Context, scope Scope, confirmation domain.EpisodeConfirmation, episodeID string, stateHash []byte, cipher string, now time.Time) error
	ConsumeEpisodeAuthorization(ctx context.Context, subject string, stateHash []byte, now time.Time) (*EpisodeOAuth, error)
	CheckEpisodeAuthorization(ctx context.Context, attempt EpisodeOAuth, now time.Time) error
	FinishEpisodeAuthorization(ctx context.Context, attempt EpisodeOAuth, progress domain.EpisodeProgress, now time.Time) error
	ClearEpisodeReview(ctx context.Context, scope Scope, id int64) error
}
