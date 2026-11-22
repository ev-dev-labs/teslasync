package smartreadiness_test

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/adapter/spotifyplaylist"
	"github.com/ev-dev-labs/teslasync/internal/app/smartmediasvc"
	mediadb "github.com/ev-dev-labs/teslasync/internal/database/smartmedia"
	media "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	mediahandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartmedia"
	"github.com/ev-dev-labs/teslasync/internal/integration/smartfixture"
)

const episodeAPI = "/api/v1/media/episode-review?vehicle_id=7"

func newEpisodeJourney(t *testing.T) (*soundtrackJourney, *spotifyFixture) {
	t.Helper()
	j := newSoundtrackJourney(t)
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000295_smart_episode_reviews.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	j.exec(string(migration))
	smartfixture.PolicyColumns(t, j.db.Pool, "smart_episode_reviews")
	fixture := &spotifyFixture{}
	client, enc := newSpotifyFixtureClient(t, fixture)
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		mediahandler.NewHandler(nil, nil, nil,
			smartmediasvc.NewEpisodeReviews(mediadb.NewRepository(j.db), client, enc, func() time.Time { return j.now }),
			"X-Test-Subject").MountRoutes(r)
	})
	j.router = router
	return j, fixture
}

func TestEpisodeReviewMountedManualAndReadOnlyProvider(t *testing.T) {
	j, fixture := newEpisodeJourney(t)
	read := func(subject, want string) media.EpisodeReview {
		t.Helper()
		got := playlistData[media.EpisodeReview](t, j.check(http.MethodGet, episodeAPI, subject, nil, http.StatusOK))
		if got.Reason != want {
			t.Fatalf("private episode review = %+v, want %s", got, want)
		}
		return got
	}
	j.check(http.MethodGet, episodeAPI, "", nil, http.StatusUnauthorized)
	read(mediaOwner, "off")
	var id int64
	c := media.EpisodeConfirmation{ExpectedID: &id, Confirmed: true, DepartureAt: j.now.Add(time.Hour), DriveDurationS: 900,
		Manual: &media.ManualEpisode{Title: "Synthetic manual episode", DurationS: 1500}}
	j.check(http.MethodPut, episodeAPI, mediaOwner, c, http.StatusOK)
	manual := read(mediaOwner, "unknown_progress")
	if manual.RemainingS != nil {
		t.Fatal("unknown manual progress is not zero")
	}
	id = manual.ID
	position := 600
	c.Manual.PositionS = &position
	j.check(http.MethodPut, episodeAPI, mediaOwner, c, http.StatusOK)
	manual = read(mediaOwner, "fits")
	if manual.RemainingS == nil || *manual.RemainingS != 900 || manual.SpotifyEpisode != "" ||
		manual.SpotifyStartS != nil || len(fixture.paths()) != 0 {
		t.Fatalf("incorrect local fit or unintended provider access: %+v", manual)
	}
	read(mediaOther, "off")
	j.check(http.MethodDelete, episodeAPI+fmt.Sprintf("&review_id=%d", manual.ID), mediaOther, nil, http.StatusConflict)
	j.check(http.MethodDelete, "/api/v1/media/episode-review?vehicle_id=8"+fmt.Sprintf("&review_id=%d", manual.ID), mediaOwner, nil, http.StatusConflict)

	authorize := func(previous int64, episode, want string) media.EpisodeReview {
		t.Helper()
		selection := c
		selection.Manual, selection.ExpectedID = nil, &previous
		selection.SpotifyEpisode = "https://open.spotify.com/episode/" + episode
		reply := playlistData[map[string]string](t, j.check(http.MethodPut, episodeAPI, mediaOwner, selection, http.StatusOK))
		target, err := url.Parse(reply["authorization_url"])
		if err != nil || target.Query().Get("scope") != spotifyplaylist.EpisodeProgressScope {
			t.Fatal("episode authorization included unexpected scopes")
		}
		read(mediaOwner, "awaiting_progress")
		uri := "/api/v1" + spotifyCallback + "?" + url.Values{
			"code": {"synthetic-episode-code"}, "state": {target.Query().Get("state")},
		}.Encode()
		first := j.check(http.MethodGet, uri, mediaOther, nil, http.StatusSeeOther)
		if first.Header().Get("Location") != "/media-player?spotify_episode=not-reviewed#episode-review" {
			t.Fatalf("wrong subject learned selected vehicle: %s", first.Header().Get("Location"))
		}
		owner := j.check(http.MethodGet, uri, mediaOwner, nil, http.StatusSeeOther)
		if owner.Header().Get("Location") != "/media-player?spotify_episode=reviewed&vehicle_id=7#episode-review" {
			t.Fatalf("provider review failed for owner: %s", owner.Header().Get("Location"))
		}
		repeated := j.check(http.MethodGet, uri, mediaOwner, nil, http.StatusSeeOther)
		if !strings.Contains(repeated.Header().Get("Location"), "not-reviewed") {
			t.Fatal("one-use episode state was reused")
		}
		return read(mediaOwner, want)
	}
	got := authorize(manual.ID, mediaFirst, "fits")
	if got.SpotifyEpisode != "https://open.spotify.com/episode/"+mediaFirst || got.RemainingS == nil || *got.RemainingS != 900 ||
		got.SpotifyStartS == nil || *got.SpotifyStartS != 600 {
		t.Fatalf("provider episode must match exact selection and report known remaining time: %+v", got)
	}
	got = authorize(got.ID, mediaSecond, "unknown_progress")
	if got.RemainingS != nil || got.SpotifyEpisode != "" || got.SpotifyStartS != nil {
		t.Fatal("do not infer progress or recommend a playback action for unqualified evidence")
	}
	want := []string{"POST /api/token", "GET /v1/episodes/" + mediaFirst, "POST /api/token", "GET /v1/episodes/" + mediaSecond}
	if calls := fixture.paths(); !slices.Equal(calls, want) {
		t.Fatalf("unexpected provider activity: %v", calls)
	}
	j.now = c.DepartureAt
	if expired := read(mediaOwner, "expired"); expired.Title != "" || expired.RemainingS != nil {
		t.Fatal("expired episode evidence is not actionable")
	}
	j.check(http.MethodDelete, episodeAPI+fmt.Sprintf("&review_id=%d", got.ID), mediaOwner, nil, http.StatusNoContent)
	read(mediaOwner, "off")
}

func TestEpisodeReviewSuppressesClearedAndExpiredAuthorization(t *testing.T) {
	for _, invalidation := range []string{"clear", "expiry"} {
		t.Run(invalidation, func(t *testing.T) {
			j, fixture := newEpisodeJourney(t)
			previous := playlistData[media.EpisodeReview](t, j.check(http.MethodGet, episodeAPI, mediaOwner, nil, http.StatusOK))
			c := media.EpisodeConfirmation{ExpectedID: &previous.ID, Confirmed: true,
				DepartureAt: j.now.Add(time.Minute), DriveDurationS: 900,
				SpotifyEpisode: "https://open.spotify.com/episode/" + mediaFirst}
			reply := playlistData[map[string]string](t, j.check(http.MethodPut, episodeAPI, mediaOwner, c, http.StatusOK))
			target, err := url.Parse(reply["authorization_url"])
			if err != nil || target.Query().Get("state") == "" {
				t.Fatal("expected scoped pending state")
			}
			if invalidation == "clear" {
				current := playlistData[media.EpisodeReview](t, j.check(http.MethodGet, episodeAPI, mediaOwner, nil, http.StatusOK))
				j.check(http.MethodDelete, episodeAPI+fmt.Sprintf("&review_id=%d", current.ID), mediaOwner, nil, http.StatusNoContent)
			} else {
				j.now = c.DepartureAt
			}
			query := url.Values{"state": {target.Query().Get("state")}, "code": {"synthetic-episode-code"}}
			callback := j.check(http.MethodGet, "/api/v1"+spotifyCallback+"?"+query.Encode(), mediaOwner, nil, http.StatusSeeOther)
			if !strings.Contains(callback.Header().Get("Location"), "spotify_episode=not-reviewed") {
				t.Fatalf("invalidated review was accepted: %s", callback.Header().Get("Location"))
			}
			if calls := fixture.paths(); len(calls) != 0 {
				t.Fatalf("invalidated episode authorization must not reach provider: %v", calls)
			}
		})
	}
}
