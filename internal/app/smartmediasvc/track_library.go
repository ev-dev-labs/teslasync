package smartmediasvc

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
)

const LibraryStatePrefix = "library."

var ErrLibraryConnect = errors.New("Spotify library authorization is required")

func trackEvidenceKey(track domain.TrackPlay) string {
	data, _ := json.Marshal(track)
	key := sha256.Sum256(data)
	return hex.EncodeToString(key[:])
}

func (s *TrackReviews) saveableTrack(ctx context.Context, scope port.DriveScope, id int64) (*domain.DriveTrackReview, error) {
	if s.library == nil || s.secrets == nil {
		return nil, ErrUnavailable
	}
	review, err := s.Read(ctx, scope)
	if err != nil {
		return nil, err
	}
	if review.ID != id || review.Status != domain.TrackReview || review.Track == nil ||
		review.Track.Source != "spotify" || review.Track.DurationS == nil {
		return nil, port.ErrChanged
	}
	return review, nil
}

func (s *TrackReviews) StartLibrary(ctx context.Context, scope port.DriveScope, id int64, confirmed bool) (string, error) {
	if !confirmed || id <= 0 {
		return "", ErrInvalidInput
	}
	if _, err := s.saveableTrack(ctx, scope, id); err != nil {
		return "", err
	}
	state := LibraryStatePrefix + base64.RawURLEncoding.EncodeToString(randomBytes())
	verifier := base64.RawURLEncoding.EncodeToString(randomBytes())
	hash, challenge := sha256.Sum256([]byte(state)), sha256.Sum256([]byte(verifier))
	cipher, err := encryptSpotifySecret(s.secrets, scope.Subject, "library-verifier", hex.EncodeToString(hash[:]), verifier)
	if err != nil {
		return "", err
	}
	if err := s.repo.StartLibraryAuthorization(ctx, scope, id, hash[:], cipher, s.now().UTC()); err != nil {
		return "", err
	}
	return s.library.LibraryAuthorizationURL(state, base64.RawURLEncoding.EncodeToString(challenge[:])), nil
}

func (s *TrackReviews) CompleteLibrary(ctx context.Context, subject, state, code string) (port.DriveScope, error) {
	remainder, prefixed := strings.CutPrefix(state, LibraryStatePrefix)
	if !prefixed || len(remainder) != 43 || !validSubject(subject) || len(code) > 4096 {
		return port.DriveScope{}, ErrInvalidInput
	}
	if s.library == nil || s.secrets == nil {
		return port.DriveScope{}, ErrUnavailable
	}
	hash := sha256.Sum256([]byte(state))
	attempt, err := s.repo.ConsumeLibraryAuthorization(ctx, subject, hash[:], s.now().UTC())
	if err != nil {
		return port.DriveScope{}, err
	}
	if code == "" {
		return attempt.Scope, ErrLibraryConnect
	}
	if _, err := s.saveableTrack(ctx, attempt.Scope, attempt.ReviewID); err != nil {
		return attempt.Scope, err
	}
	verifier, err := decryptSpotifySecret(s.secrets, subject, "library-verifier", hex.EncodeToString(hash[:]), attempt.VerifierCipher)
	if err != nil {
		return attempt.Scope, err
	}
	grant, err := s.library.ExchangeLibrary(ctx, code, verifier)
	if err != nil || grant.ExpiresIn <= 0 || grant.AccessToken == "" {
		return attempt.Scope, ErrLibraryConnect
	}
	cipher, err := encryptSpotifySecret(s.secrets, subject, "library-grant", libraryKey(attempt.ReviewID, attempt.Revision), grant.AccessToken)
	if err != nil {
		return attempt.Scope, err
	}
	now := s.now().UTC()
	return attempt.Scope, s.repo.SetLibraryGrant(ctx, *attempt, cipher, now.Add(min(grant.ExpiresIn, 30*time.Minute)), now)
}

func (s *TrackReviews) DisconnectLibrary(ctx context.Context, scope port.DriveScope, id int64) error {
	if !validDrive(scope) || id <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DisconnectLibrary(ctx, scope, id)
}

func (s *TrackReviews) SaveLibrary(ctx context.Context, scope port.DriveScope, id int64, request domain.SaveDriveTrack) (domain.TrackSaveStatus, error) {
	trackID := trackLinkID(request.Spotify)
	if id <= 0 || !request.Confirmed || trackID == "" || len(request.EvidenceKey) != 64 {
		return "", ErrInvalidInput
	}
	ctx, cancel := context.WithTimeout(ctx, 32*time.Second)
	defer cancel()
	review, err := s.saveableTrack(ctx, scope, id)
	if err != nil {
		return "", err
	}
	if review.EvidenceKey != request.EvidenceKey {
		return "", port.ErrChanged
	}
	grant, err := s.repo.ReadLibraryGrant(ctx, scope, id, s.now().UTC())
	if err != nil {
		return "", err
	}
	if grant == nil {
		return "", ErrLibraryConnect
	}
	token, err := decryptSpotifySecret(s.secrets, scope.Subject, "library-grant", libraryKey(id, grant.Revision), grant.TokenCipher)
	if err != nil {
		return "", err
	}
	track, err := s.library.Track(ctx, token, trackID)
	if err != nil || track.ID != trackID || !recordingMatches(domain.PlaylistCandidate{
		Title: review.Track.Title, Artist: review.Track.Artist, DurationS: *review.Track.DurationS,
	}, track) {
		return "", ErrTrackMatch
	}
	latest, err := s.saveableTrack(ctx, scope, id)
	if err != nil {
		return "", err
	}
	if latest.EvidenceKey != request.EvidenceKey {
		return "", port.ErrChanged
	}
	if err := s.repo.ClaimTrackSave(ctx, scope, id, grant.Revision, s.now().UTC()); err != nil {
		return "", err
	}
	status := domain.TrackSaved
	if err := s.library.SaveLibraryTrack(ctx, token, trackID); err != nil {
		status = domain.TrackUnknown
		if providerRejected(err) {
			status = domain.TrackRejected
		}
	}
	persist, persistCancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer persistCancel()
	if err := s.repo.FinishTrackSave(persist, scope, id, status); err != nil {
		return domain.TrackUnknown, err
	}
	return status, nil
}

func libraryKey(id, revision int64) string {
	return strconv.FormatInt(id, 10) + ":" + strconv.FormatInt(revision, 10)
}
