package smartmediasvc

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/url"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
)

const EpisodeStatePrefix = "episode."

type EpisodeReviews struct {
	repo     port.EpisodeRepository
	provider port.EpisodeProvider
	secrets  port.SecretCodec
	now      func() time.Time
}

func NewEpisodeReviews(repo port.EpisodeRepository, provider port.EpisodeProvider, secrets port.SecretCodec, now func() time.Time) *EpisodeReviews {
	return &EpisodeReviews{repo: repo, provider: provider, secrets: secrets, now: now}
}

func (s *EpisodeReviews) available() bool {
	return s.provider != nil && s.secrets != nil
}

func (s *EpisodeReviews) Read(ctx context.Context, scope port.Scope) (*domain.EpisodeReview, error) {
	if !validSubject(scope.Subject) || scope.VehicleID <= 0 {
		return nil, ErrInvalidInput
	}
	stored, err := s.repo.ReadEpisodeReview(ctx, scope)
	if err != nil {
		return nil, err
	}
	review := &stored.Review
	review.SpotifyAvailable = s.available()
	review.Reason = "off"
	if review.ID == 0 {
		return review, nil
	}
	now := s.now().UTC()
	if !review.ExpiresAt.After(now) {
		review.Reason = "expired"
		return review, nil
	}
	if stored.EpisodeID != "" && stored.Progress == nil {
		review.Reason = "awaiting_progress"
		return review, nil
	}
	fit := EvaluateEpisodeFit(now, *review.DepartureAt, *review.DriveDurationS, true, stored.Progress)
	review.Reason, review.RemainingS = fit.Reason, fit.RemainingS
	if stored.Progress != nil {
		review.Title = stored.Progress.Title
	}
	if fit.Reason == "fits" && stored.EpisodeID != "" {
		review.SpotifyEpisode = "https://open.spotify.com/episode/" + stored.EpisodeID
		review.SpotifyStartS = stored.Progress.PositionS
	}
	return review, nil
}

func (s *EpisodeReviews) Confirm(ctx context.Context, scope port.Scope, c domain.EpisodeConfirmation) (string, error) {
	now := s.now().UTC()
	eligibility := EvaluateEpisodeFit(now, c.DepartureAt, c.DriveDurationS, c.Confirmed, nil)
	if !validSubject(scope.Subject) || scope.VehicleID <= 0 || c.ExpectedID == nil || *c.ExpectedID < 0 ||
		eligibility.Reason != "unknown_progress" || (c.Manual == nil) == (c.SpotifyEpisode == "") {
		return "", ErrInvalidInput
	}
	if c.Manual != nil {
		c.Manual.Title = strings.TrimSpace(c.Manual.Title)
		if !validMediaLabel(c.Manual.Title) || c.Manual.DurationS <= 0 || c.Manual.DurationS > 86400 ||
			(c.Manual.PositionS != nil && (*c.Manual.PositionS < 0 || *c.Manual.PositionS > c.Manual.DurationS)) {
			return "", ErrInvalidInput
		}
		return "", s.repo.ReplaceEpisodeReview(ctx, scope, c, "", nil, "", now)
	}
	episodeID := episodeLinkID(c.SpotifyEpisode)
	if episodeID == "" {
		return "", ErrInvalidInput
	}
	if !s.available() {
		return "", ErrUnavailable
	}
	state := EpisodeStatePrefix + base64.RawURLEncoding.EncodeToString(randomBytes())
	verifier := base64.RawURLEncoding.EncodeToString(randomBytes())
	hash, challenge := sha256.Sum256([]byte(state)), sha256.Sum256([]byte(verifier))
	cipher, err := encryptSpotifySecret(s.secrets, scope.Subject, "episode-verifier", hex.EncodeToString(hash[:]), verifier)
	if err != nil {
		return "", err
	}
	if err := s.repo.ReplaceEpisodeReview(ctx, scope, c, episodeID, hash[:], cipher, now); err != nil {
		return "", err
	}
	return s.provider.EpisodeProgressAuthorizationURL(state, base64.RawURLEncoding.EncodeToString(challenge[:])), nil
}

func (s *EpisodeReviews) Complete(ctx context.Context, subject, state, code string) (int64, error) {
	remainder, prefixed := strings.CutPrefix(state, EpisodeStatePrefix)
	if !validSubject(subject) || !prefixed || len(remainder) != 43 || len(code) > 4096 {
		return 0, ErrInvalidInput
	}
	if !s.available() {
		return 0, ErrUnavailable
	}
	hash := sha256.Sum256([]byte(state))
	attempt, err := s.repo.ConsumeEpisodeAuthorization(ctx, subject, hash[:], s.now().UTC())
	if err != nil {
		return 0, err
	}
	vehicleID := attempt.Scope.VehicleID
	if code == "" {
		return vehicleID, ErrConnect
	}
	if err := s.repo.CheckEpisodeAuthorization(ctx, *attempt, s.now().UTC()); err != nil {
		return vehicleID, err
	}
	verifier, err := decryptSpotifySecret(s.secrets, subject, "episode-verifier", hex.EncodeToString(hash[:]), attempt.VerifierCipher)
	if err != nil {
		return vehicleID, err
	}
	grant, err := s.provider.ExchangeEpisodeProgress(ctx, code, verifier)
	if err != nil || grant.ExpiresIn <= 0 || grant.AccessToken == "" {
		return vehicleID, ErrConnect
	}
	if err := s.repo.CheckEpisodeAuthorization(ctx, *attempt, s.now().UTC()); err != nil {
		return vehicleID, err
	}
	progress, err := s.provider.EpisodeProgress(ctx, grant.AccessToken, attempt.EpisodeID)
	if err != nil {
		return vehicleID, ErrConnect
	}
	if progress.ID != attempt.EpisodeID || !validMediaLabel(progress.Title) {
		return vehicleID, ErrConnect
	}
	return vehicleID, s.repo.FinishEpisodeAuthorization(ctx, *attempt, progress, s.now().UTC())
}

func (s *EpisodeReviews) Clear(ctx context.Context, scope port.Scope, id int64) error {
	if !validSubject(scope.Subject) || scope.VehicleID <= 0 || id <= 0 {
		return ErrInvalidInput
	}
	return s.repo.ClearEpisodeReview(ctx, scope, id)
}

func episodeLinkID(link string) string {
	link = strings.TrimSpace(link)
	if len(link) > 512 {
		return ""
	}
	target, err := url.Parse(link)
	if err != nil || target.Scheme != "https" || target.Host != "open.spotify.com" ||
		target.User != nil || target.RawPath != "" || target.Fragment != "" {
		return ""
	}
	id, ok := strings.CutPrefix(target.Path, "/episode/")
	if !ok || !spotifyID.MatchString(id) {
		return ""
	}
	return id
}

func EvaluateEpisodeFit(now, departure time.Time, driveS int, confirmed bool, progress *domain.EpisodeProgress) domain.EpisodeFit {
	if !confirmed {
		return domain.EpisodeFit{Reason: "off"}
	}
	if !departure.After(now) || departure.Sub(now) > 24*time.Hour || driveS < 300 || driveS > 21600 {
		return domain.EpisodeFit{Reason: "drive_unmatched"}
	}
	if progress == nil || !validMediaLabel(progress.Title) || progress.DurationS <= 0 ||
		progress.DurationS > 86400 || progress.PositionS == nil || progress.Completed == nil ||
		*progress.PositionS < 0 || *progress.PositionS > progress.DurationS {
		return domain.EpisodeFit{Reason: "unknown_progress"}
	}
	remaining := progress.DurationS - *progress.PositionS
	if *progress.Completed || remaining == 0 {
		return domain.EpisodeFit{Reason: "completed"}
	}
	if remaining > driveS {
		return domain.EpisodeFit{Reason: "not_fit", RemainingS: &remaining}
	}
	return domain.EpisodeFit{Reason: "fits", RemainingS: &remaining}
}
