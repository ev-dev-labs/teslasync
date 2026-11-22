package smartmediasvc

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

var (
	ErrInvalidInput = errors.New("invalid private playlist request")
	ErrUnavailable  = errors.New("Spotify private playlist connection is unavailable")
	ErrConnect      = errors.New("Spotify private playlist authorization is required")
	ErrTrackMatch   = errors.New("a selected Spotify recording could not be verified")
)

const (
	draftHorizon = 7 * 24 * time.Hour
	abandonAfter = time.Minute
	holdDuration = 15 * time.Minute
)

var spotifyID = regexp.MustCompile(`^[A-Za-z0-9]{22}$`)

type Reviews struct {
	repo    port.Repository
	spotify port.SpotifyProvider
	secrets port.SecretCodec
	now     func() time.Time
}

func NewReviews(repo port.Repository, spotify port.SpotifyProvider, secrets port.SecretCodec, now func() time.Time) *Reviews {
	return &Reviews{repo: repo, spotify: spotify, secrets: secrets, now: now}
}

func (s *Reviews) available() bool { return s.spotify != nil && s.secrets != nil }

func validSubject(subject string) bool {
	return subject != "" && subject != personal.OpenSubject && subject != "open-mode" && len(subject) <= 512
}

func (s *Reviews) checkScope(ctx context.Context, scope port.Scope) error {
	if !validSubject(scope.Subject) || scope.VehicleID <= 0 {
		return ErrInvalidInput
	}
	active, err := s.repo.ActiveVehicle(ctx, scope.VehicleID)
	if err != nil {
		return err
	}
	if !active {
		return port.ErrNotFound
	}
	return nil
}

func (s *Reviews) Read(ctx context.Context, scope port.Scope) (domain.PlaylistReview, error) {
	if err := s.checkScope(ctx, scope); err != nil {
		return domain.PlaylistReview{}, err
	}
	draft, err := s.repo.ReadDraft(ctx, scope)
	if err != nil {
		return domain.PlaylistReview{}, err
	}
	now := s.now().UTC()
	if draft != nil && draft.Status == domain.PlaylistSaving && draft.DispatchAt != nil &&
		!draft.DispatchAt.Add(abandonAfter).After(now) {
		draft.Status = domain.PlaylistUnknown
	}
	review := domain.PlaylistReview{Draft: draft, Available: s.available()}
	if review.Available {
		grant, err := s.repo.SpotifyGrant(ctx, scope.Subject, now)
		if err != nil {
			return domain.PlaylistReview{}, err
		}
		review.Connected = grant != nil
	}
	return review, nil
}

func (s *Reviews) Preview(ctx context.Context, scope port.Scope, expectedID int64, setup domain.PlaylistSetup) error {
	now := s.now().UTC()
	if expectedID < 0 || !setup.Confirmed || !setup.DepartureAt.After(now) ||
		setup.DepartureAt.After(now.Add(24*time.Hour)) ||
		setup.TargetDurationS < minPlaylistTargetS || setup.TargetDurationS > maxPlaylistTargetS {
		return ErrInvalidInput
	}
	if err := s.checkScope(ctx, scope); err != nil {
		return err
	}
	previous, err := s.repo.ReadDraft(ctx, scope)
	if err != nil {
		return err
	}
	if (previous == nil && expectedID != 0) || (previous != nil &&
		(previous.ID != expectedID || previous.Status != domain.PlaylistPreview)) {
		return port.ErrChanged
	}
	from := now.Add(-draftHorizon)
	samples, began, err := s.repo.PlaylistSamples(ctx, scope, from, now)
	if err != nil && !errors.Is(err, signal.ErrTimelineEventLimit) {
		return err
	}
	candidates := make([]domain.PlaylistCandidate, 0)
	if suggestion := SuggestSpotifyPlaylist(ObservedPlays(samples, from, now), setup.TargetDurationS); suggestion != nil {
		candidates = playlistCandidates(suggestion)
	}
	return s.repo.ReplaceDraft(ctx, scope, expectedID, domain.PlaylistDraft{
		DepartureAt: setup.DepartureAt.UTC(), TargetDurationS: setup.TargetDurationS, CreatedAt: now,
		ExpiresAt: setup.DepartureAt.UTC(), Candidates: candidates,
		FeatureCheckedAt: began,
	})
}

func (s *Reviews) Hold(ctx context.Context, scope port.Scope, id int64, snooze bool) error {
	if id <= 0 {
		return ErrInvalidInput
	}
	if err := s.checkScope(ctx, scope); err != nil {
		return err
	}
	now := s.now().UTC()
	var until *time.Time
	if snooze {
		value := now.Add(holdDuration)
		until = &value
	}
	return s.repo.HoldDraft(ctx, scope, id, until, now)
}

func (s *Reviews) Clear(ctx context.Context, scope port.Scope, id int64) error {
	if id <= 0 {
		return ErrInvalidInput
	}
	if err := s.checkScope(ctx, scope); err != nil {
		return err
	}
	return s.repo.DeleteDraft(ctx, scope, id, s.now().UTC().Add(-abandonAfter))
}

func playlistCandidates(suggestion *domain.PlaylistSuggestion) []domain.PlaylistCandidate {
	candidates := make([]domain.PlaylistCandidate, 0, len(suggestion.Tracks)+len(suggestion.Alternatives))
	for _, list := range []struct {
		plays     []domain.TrackPlay
		suggested bool
	}{{suggestion.Tracks, true}, {suggestion.Alternatives, false}} {
		for _, play := range list.plays {
			candidates = append(candidates, domain.PlaylistCandidate{
				Position: len(candidates) + 1, Title: play.Title, Artist: play.Artist,
				DurationS: *play.DurationS, ObservedAt: play.LastObservedAt, Suggested: list.suggested,
			})
		}
	}
	return candidates
}

func (s *Reviews) Save(ctx context.Context, scope port.Scope, id int64, request domain.SavePlaylist) (domain.PlaylistSaveStatus, error) {
	name := strings.TrimSpace(request.Name)
	if !request.Confirmed || id <= 0 || !validMediaLabel(name) || utf8.RuneCountInString(name) > 100 ||
		len(request.Selection) == 0 || len(request.Selection) > maxPlaylistPool {
		return "", ErrInvalidInput
	}
	if !s.available() {
		return "", ErrUnavailable
	}
	if err := s.checkScope(ctx, scope); err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	draft, err := s.repo.ReadDraft(ctx, scope)
	if err != nil {
		return "", err
	}
	now := s.now().UTC()
	if draft == nil || draft.ID != id || draft.Status != domain.PlaylistPreview || draft.Paused ||
		!draft.ExpiresAt.After(now) || (draft.SnoozedUntil != nil && draft.SnoozedUntil.After(now)) {
		return "", port.ErrChanged
	}
	if err := s.repo.CheckPlaylistDraft(ctx, scope, id); err != nil {
		return "", err
	}
	ids, err := verifyPlaylistSelection(draft, request.Selection)
	if err != nil {
		return "", err
	}
	grant, err := s.repo.SpotifyGrant(ctx, scope.Subject, now)
	if err != nil {
		return "", err
	}
	if grant == nil {
		return "", ErrConnect
	}
	token, err := s.unwrap(scope.Subject, "grant", grant.Revision, grant.TokenCipher)
	if err != nil {
		return "", err
	}
	resolvedDurationS := 0
	for i, trackID := range ids {
		if err := s.repo.CheckPlaylistDraft(ctx, scope, id); err != nil {
			return "", err
		}
		current, err := s.repo.SpotifyGrant(ctx, scope.Subject, s.now().UTC())
		if err != nil {
			return "", err
		}
		if current == nil || current.Revision != grant.Revision {
			return "", ErrConnect
		}
		track, err := s.spotify.Track(ctx, token, trackID)
		if err != nil || !recordingMatches(draft.Candidates[request.Selection[i].Position-1], track) || track.ID != trackID {
			return "", ErrTrackMatch
		}
		resolvedDurationS += track.DurationS
	}
	if distance(resolvedDurationS, draft.TargetDurationS) > max(120, draft.TargetDurationS/10) {
		return "", ErrTrackMatch
	}
	claimed, err := s.repo.ClaimPlaylistSave(ctx, scope, id, grant.Revision, s.now().UTC())
	if err != nil {
		return "", err
	}
	if !claimed {
		return "", port.ErrChanged
	}
	return s.dispatch(ctx, scope, id, grant.Revision, token, name, ids)
}

func verifyPlaylistSelection(draft *domain.PlaylistDraft, selection []domain.PlaylistSelection) ([]string, error) {
	ids := make([]string, 0, len(selection))
	seenTracks, seenPositions := make(map[string]bool), make(map[int]bool)
	total := 0
	for _, selected := range selection {
		id := trackLinkID(selected.Spotify)
		position := selected.Position
		if id == "" || seenTracks[id] || seenPositions[position] || position < 1 || position > len(draft.Candidates) ||
			draft.Candidates[position-1].Position != position {
			return nil, ErrInvalidInput
		}
		seenTracks[id], seenPositions[position] = true, true
		ids = append(ids, id)
		total += draft.Candidates[position-1].DurationS
	}
	if distance(total, draft.TargetDurationS) > max(120, draft.TargetDurationS/10) {
		return nil, ErrInvalidInput
	}
	return ids, nil
}

func trackLinkID(link string) string {
	link = strings.TrimSpace(link)
	if len(link) > 512 {
		return ""
	}
	parsed, err := url.Parse(link)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "open.spotify.com" || parsed.User != nil ||
		!strings.HasPrefix(parsed.Path, "/track/") || parsed.RawPath != "" || parsed.Fragment != "" {
		return ""
	}
	id := strings.TrimPrefix(parsed.Path, "/track/")
	if !spotifyID.MatchString(id) {
		return ""
	}
	return id
}

func recordingMatches(candidate domain.PlaylistCandidate, track domain.CatalogTrack) bool {
	if !strings.EqualFold(candidate.Title, strings.TrimSpace(track.Title)) ||
		distance(candidate.DurationS, track.DurationS) > 3 {
		return false
	}
	for _, artist := range track.Artists {
		if strings.EqualFold(candidate.Artist, strings.TrimSpace(artist)) {
			return true
		}
	}
	return strings.EqualFold(candidate.Artist, strings.Join(track.Artists, ", "))
}

func (s *Reviews) dispatch(ctx context.Context, scope port.Scope, id, revision int64, token, name string, ids []string) (domain.PlaylistSaveStatus, error) {
	persist := func(action func(context.Context) error) error {
		persistCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		return action(persistCtx)
	}
	finish := func(status domain.PlaylistSaveStatus) (domain.PlaylistSaveStatus, error) {
		return status, persist(func(ctx context.Context) error { return s.repo.FinishPlaylistSave(ctx, scope, id, status) })
	}
	if err := s.repo.CheckPlaylistDraft(ctx, scope, id); err != nil {
		return finish(domain.PlaylistRejected)
	}
	playlist, err := s.spotify.CreatePrivate(ctx, token, name)
	if err != nil {
		if providerRejected(err) {
			return finish(domain.PlaylistRejected)
		}
		return finish(domain.PlaylistUnknown)
	}
	if err := persist(func(ctx context.Context) error { return s.repo.RecordPlaylistCreated(ctx, scope, id, playlist) }); err != nil {
		return domain.PlaylistUnknown, fmt.Errorf("record private playlist before sending items: %w", err)
	}
	allowed, err := s.repo.CanSendPlaylistItems(ctx, scope, id, revision, s.now().UTC())
	if err != nil || !allowed {
		return finish(domain.PlaylistCreatedOnly)
	}
	if err := s.spotify.AddTracks(ctx, token, playlist, ids); err != nil {
		if providerRejected(err) {
			return finish(domain.PlaylistCreatedOnly)
		}
		return finish(domain.PlaylistUnknown)
	}
	return finish(domain.PlaylistSaved)
}

func providerRejected(err error) bool {
	var failure *domain.SpotifyFailure
	return errors.As(err, &failure) && !failure.Unknown
}
