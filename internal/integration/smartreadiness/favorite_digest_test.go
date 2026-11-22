package smartreadiness_test

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/smartmediasvc"
	mediadb "github.com/ev-dev-labs/teslasync/internal/database/smartmedia"
	media "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	mediahandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartmedia"
	"github.com/ev-dev-labs/teslasync/internal/integration/smartfixture"
)

const favoriteAPI = "/api/v1/media/favorite-digest?vehicle_id=7"

func newFavoriteJourney(t *testing.T, lastSource string) (*soundtrackJourney, *smartmediasvc.FavoriteDigests) {
	t.Helper()
	j := newSoundtrackJourney(t)
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000296_smart_favorite_digests.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	j.exec(string(migration))
	smartfixture.PolicyColumns(t, j.db.Pool, "smart_favorite_digest_plans")
	for i, source := range []string{"Spotify", "Spotify", lastSource} {
		at := time.Date(2026, 11, 17+i, 12, 0, 0, 0, time.UTC)
		if i == 0 {
			at = time.Date(2026, 11, 16, 0, 0, 0, 0, time.UTC)
		}
		j.exec(`INSERT INTO drives(id,vehicle_id,started_at,ended_at) VALUES ($1,7,$2,$3)`,
			100+i, at, at.Add(15*time.Minute))
		j.exec(`INSERT INTO signal_log(ts,vehicle_id,field,str_value,int_value,source_emitted_at,received_at)
			SELECT $1::timestamptz+d.shift,7,d.field,d.text,d.number,$1+d.shift,$1+d.shift
			FROM (VALUES
			    (INTERVAL '-30 seconds','MediaPlaybackSource',$2,NULL::bigint),
			    (INTERVAL '-27 seconds','MediaPlaybackStatus','MediaStatusPlaying',NULL),
			    (INTERVAL '-12 seconds','MediaNowPlayingTitle','Synthetic repeated recording',NULL),
			    (INTERVAL '-10 seconds','MediaNowPlayingArtist','Synthetic ensemble',NULL),
			    (INTERVAL '-8 seconds','MediaNowPlayingDuration',NULL,190000),
			    (INTERVAL '-5 seconds','MediaNowPlayingElapsed',NULL,1000),
			    (INTERVAL '15 seconds','MediaNowPlayingElapsed',NULL,21000),
			    (INTERVAL '35 seconds','MediaNowPlayingElapsed',NULL,41000)
			) AS d(shift,field,text,number)`, at, source)
	}
	repo := mediadb.NewRepository(j.db)
	svc := smartmediasvc.NewFavoriteDigests(repo, func() time.Time { return j.now })
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) { mediahandler.NewFavoritesHandler(svc, "X-Test-Subject").MountRoutes(r) })
	j.router = router
	return j, svc
}

func readFavorite(t *testing.T, j *soundtrackJourney, subject string) media.FavoriteDigestSettings {
	t.Helper()
	return playlistData[media.FavoriteDigestSettings](t, j.check(http.MethodGet, favoriteAPI, subject, nil, http.StatusOK))
}

func TestFavoriteDigestMountedWeeklyLifecycle(t *testing.T) {
	j, worker := newFavoriteJourney(t, "Spotify")
	j.check(http.MethodGet, favoriteAPI, "", nil, http.StatusUnauthorized)
	if off := readFavorite(t, j, mediaOwner); off.Revision != 0 || off.Digest != nil || off.Favorites == nil {
		t.Fatalf("new private plan must be off and empty: %+v", off)
	}
	if batch, err := worker.ProcessDue(t.Context(), 4); err != nil || batch.Checked != 0 {
		t.Fatalf("no opt-in must mean no source scan: %+v, %v", batch, err)
	}
	revision := int64(0)
	setup := media.FavoriteDigestSetup{ExpectedRevision: &revision, TimeZone: "UTC"}
	j.check(http.MethodPut, favoriteAPI, mediaOwner, setup, http.StatusBadRequest)
	setup.Confirmed = true
	j.check(http.MethodPut, favoriteAPI, mediaOwner, setup, http.StatusNoContent)
	pending := readFavorite(t, j, mediaOwner)
	if pending.NextAt == nil || pending.Digest != nil || pending.Revision <= 0 {
		t.Fatalf("enrollment must schedule, not publish or add a favorite: %+v", pending)
	}
	if batch, err := worker.ProcessDue(t.Context(), 4); err != nil || batch.Checked != 0 {
		t.Fatalf("before the scheduled local release: %+v, %v", batch, err)
	}
	j.now = *pending.NextAt
	type result struct {
		batch smartmediasvc.FavoriteDigestBatch
		err   error
	}
	var wg sync.WaitGroup
	results := make(chan result, 2)
	for range 2 {
		wg.Go(func() {
			restarted := smartmediasvc.NewFavoriteDigests(mediadb.NewRepository(j.db), func() time.Time { return j.now })
			batch, err := restarted.ProcessDue(t.Context(), 4)
			results <- result{batch, err}
		})
	}
	wg.Wait()
	close(results)
	published := 0
	for r := range results {
		if r.err != nil {
			t.Fatal(r.err)
		}
		published += r.batch.Published
	}
	ready := readFavorite(t, j, mediaOwner)
	if published != 1 || ready.Digest == nil || len(ready.Digest.Candidates) != 1 || len(ready.Favorites) != 0 ||
		ready.Digest.Candidates[0].ObservedDrives != 3 || ready.Digest.Candidates[0].ObservedDates != 3 {
		t.Fatalf("one digest with distinct evidence and no inferred favorites: %d %+v", published, ready)
	}
	if other := readFavorite(t, j, mediaOther); other.Revision != 0 || other.Digest != nil || len(other.Favorites) != 0 {
		t.Fatalf("shared vehicle must not expose another subject's choices: %+v", other)
	}
	action := media.FavoriteDigestAction{Revision: ready.Revision, DigestUntil: ready.Digest.Until,
		Key: ready.Digest.Candidates[0].Key, Action: "confirm"}
	j.check(http.MethodPost, favoriteAPI, mediaOther, action, http.StatusConflict)
	j.check(http.MethodPost, strings.Replace(favoriteAPI, "vehicle_id=7", "vehicle_id=8", 1), mediaOwner, action, http.StatusConflict)
	wrongPeriod := action
	wrongPeriod.DigestUntil = action.DigestUntil.Add(time.Hour)
	j.check(http.MethodPost, favoriteAPI, mediaOwner, wrongPeriod, http.StatusConflict)
	j.check(http.MethodPost, favoriteAPI, mediaOwner, action, http.StatusNoContent)
	j.check(http.MethodPost, favoriteAPI, mediaOwner, action, http.StatusConflict)
	saved := readFavorite(t, j, mediaOwner)
	if saved.Digest != nil || len(saved.Favorites) != 1 || saved.Favorites[0].Key != action.Key {
		t.Fatalf("explicit exact choice did not persist locally: %+v", saved)
	}
	revision = saved.Revision
	setup.Paused = true
	j.check(http.MethodPut, favoriteAPI, mediaOwner, setup, http.StatusNoContent)
	paused := readFavorite(t, j, mediaOwner)
	if paused.NextAt != nil || paused.Digest != nil || paused.Revision == revision || len(paused.Favorites) != 1 {
		t.Fatalf("pause must invalidate work without removing explicit choices: %+v", paused)
	}
	remove := media.FavoriteDigestAction{Revision: paused.Revision, Key: action.Key, Action: "remove"}
	j.check(http.MethodPost, favoriteAPI, mediaOwner, remove, http.StatusNoContent)
	j.check(http.MethodDelete, favoriteAPI+fmt.Sprintf("&revision=%d", paused.Revision), mediaOwner, nil, http.StatusNoContent)
	if current := readFavorite(t, j, mediaOwner); current.Revision != 0 || current.Digest != nil || len(current.Favorites) != 0 {
		t.Fatalf("clear did not fully turn off the private digest: %+v", current)
	}
}

func TestFavoriteDigestSuppressesRadioAndStaleOrRevokedWork(t *testing.T) {
	j, worker := newFavoriteJourney(t, "FM")
	var revision int64
	setup := media.FavoriteDigestSetup{ExpectedRevision: &revision, Confirmed: true, TimeZone: "UTC"}
	j.check(http.MethodPut, favoriteAPI, mediaOwner, setup, http.StatusNoContent)
	pending := readFavorite(t, j, mediaOwner)
	j.now = *pending.NextAt
	batch, err := worker.ProcessDue(t.Context(), 1)
	if err != nil || batch.Published != 0 || batch.NotQualified != 1 || readFavorite(t, j, mediaOwner).Digest != nil {
		t.Fatalf("radio must not qualify a third drive: %+v %v", batch, err)
	}

	j.now = *readFavorite(t, j, mediaOwner).NextAt
	repo := mediadb.NewRepository(j.db)
	job, err := repo.ClaimFavoriteDigest(t.Context(), j.now, j.now.Add(time.Minute))
	if err != nil || job == nil {
		t.Fatalf("expected due job: %+v %v", job, err)
	}
	j.check(http.MethodDelete, favoriteAPI+fmt.Sprintf("&revision=%d", pending.Revision), mediaOwner, nil, http.StatusNoContent)
	j.check(http.MethodPut, favoriteAPI, mediaOwner, setup, http.StatusNoContent)
	j.check(http.MethodDelete, favoriteAPI+fmt.Sprintf("&revision=%d", pending.Revision), mediaOwner, nil, http.StatusConflict)
	published, err := repo.FinishFavoriteDigest(t.Context(), *job, j.now, j.now.AddDate(0, 0, 7), media.FavoriteDigest{})
	if err != nil || published {
		t.Fatalf("old work cannot publish into fresh consent: %t %v", published, err)
	}
}

func TestFavoriteDigestDoesNotCountProgressBeforeTheDrive(t *testing.T) {
	j, worker := newFavoriteJourney(t, "Spotify")
	j.exec(`UPDATE drives SET started_at=started_at+INTERVAL '20 seconds' WHERE id=102`)
	var revision int64
	j.check(http.MethodPut, favoriteAPI, mediaOwner,
		media.FavoriteDigestSetup{ExpectedRevision: &revision, Confirmed: true, TimeZone: "UTC"}, http.StatusNoContent)
	j.now = *readFavorite(t, j, mediaOwner).NextAt
	batch, err := worker.ProcessDue(t.Context(), 1)
	if err != nil || batch.Published != 0 || batch.NotQualified != 1 || readFavorite(t, j, mediaOwner).Digest != nil {
		t.Fatalf("pre-drive progress completed a third drive: %+v %v", batch, err)
	}
}
