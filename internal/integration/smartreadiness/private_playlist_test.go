package smartreadiness_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/adapter/spotifyplaylist"
	"github.com/ev-dev-labs/teslasync/internal/app/smartmediasvc"
	"github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	featuredb "github.com/ev-dev-labs/teslasync/internal/database/smartfeature"
	mediadb "github.com/ev-dev-labs/teslasync/internal/database/smartmedia"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartfeature"
	media "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	mediahandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartmedia"
)

const (
	playlistRead      = "/media/playlist-review?vehicle_id=7"
	playlistSave      = "/media/playlist-review/save?vehicle_id=7&draft_id="
	spotifyConnection = "/media/spotify/connection?vehicle_id=7"
	spotifyCallback   = "/media/spotify/callback"
	mediaOwner        = "synthetic-media-owner"
	mediaOther        = "synthetic-media-other"
	mediaGrant        = "synthetic-spotify-grant"
	mediaFirst        = "AAAAAAAAAAAAAAAAAAAAAA"
	mediaSecond       = "BBBBBBBBBBBBBBBBBBBBBB"
	mediaThird        = "CCCCCCCCCCCCCCCCCCCCCC"
	mediaPlaylist     = "PPPPPPPPPPPPPPPPPPPPPP"
)

type spotifyFixture struct {
	mu            sync.Mutex
	seen          []string
	saved         []string
	challenge     string
	createStatus  int
	itemsStatus   int
	libraryStatus int
	onCreate      func()
	onTrack       func()
}

func (s *spotifyFixture) paths() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.seen)
}

func (s *spotifyFixture) serve(t *testing.T, w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	s.seen = append(s.seen, r.Method+" "+r.URL.Path)
	challenge, createStatus, itemsStatus, libraryStatus, onCreate, onTrack :=
		s.challenge, s.createStatus, s.itemsStatus, s.libraryStatus, s.onCreate, s.onTrack
	s.mu.Unlock()
	if r.URL.Path != "/api/token" && r.Header.Get("Authorization") != "Bearer "+mediaGrant {
		t.Error("Spotify request lacked the matching synthetic grant")
		http.Error(w, "wrong account", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	switch r.URL.Path {
	case "/api/token":
		if err := r.ParseForm(); err != nil {
			t.Error(err)
		}
		hash := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
		code := r.Form.Get("code")
		if (code != "synthetic-code" && code != "synthetic-library-code" && code != "synthetic-episode-code") ||
			(challenge != "" && base64.RawURLEncoding.EncodeToString(hash[:]) != challenge) {
			t.Error("invalid code or PKCE verifier")
		}
		scope := spotifyplaylist.PlaylistScope
		if code == "synthetic-library-code" {
			scope = spotifyplaylist.LibraryTrackScope
		}
		if code == "synthetic-episode-code" {
			scope = spotifyplaylist.EpisodeProgressScope
		}
		fmt.Fprintf(w, `{"access_token":%q,"token_type":"Bearer","expires_in":3600,"scope":%q}`, mediaGrant, scope)
	case "/v1/tracks/" + mediaFirst, "/v1/tracks/" + mediaSecond, "/v1/tracks/" + mediaThird:
		if onTrack != nil {
			onTrack()
		}
		id := strings.TrimPrefix(r.URL.Path, "/v1/tracks/")
		title, duration := "Synthetic first", 181000
		switch id {
		case mediaSecond:
			title, duration = "Synthetic second", 179000
		case mediaThird:
			title, duration = "Synthetic third", 225000
		}
		fmt.Fprintf(w, `{"id":%q,"name":%q,"duration_ms":%d,"artists":[{"name":"Synthetic artist"}]}`, id, title, duration)
	case "/v1/episodes/" + mediaFirst, "/v1/episodes/" + mediaSecond:
		id := strings.TrimPrefix(r.URL.Path, "/v1/episodes/")
		if r.Method != http.MethodGet || r.URL.RawQuery != "" || r.ContentLength != 0 {
			t.Error("episode review may request only the exact authorized episode")
		}
		progress := ""
		if id == mediaFirst {
			progress = `,"resume_point":{"fully_played":false,"resume_position_ms":600000}`
		}
		fmt.Fprintf(w, `{"id":%q,"type":"episode","uri":%q,"name":"Synthetic episode","duration_ms":1500000,"is_playable":true%s}`,
			id, "spotify:episode:"+id, progress)
	case "/v1/me/playlists":
		var create struct {
			Name          string `json:"name"`
			Public        *bool  `json:"public"`
			Collaborative *bool  `json:"collaborative"`
		}
		if err := json.NewDecoder(r.Body).Decode(&create); err != nil || create.Name != "Synthetic drive mix" ||
			create.Public == nil || *create.Public || create.Collaborative == nil || *create.Collaborative {
			t.Error("save must be private and non-collaborative")
		}
		if onCreate != nil {
			onCreate()
		}
		if createStatus != 0 {
			w.WriteHeader(createStatus)
			return
		}
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintf(w, `{"id":%q,"public":false}`, mediaPlaylist)
	case "/v1/playlists/" + mediaPlaylist + "/items":
		var payload struct {
			URIs []string `json:"uris"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		s.mu.Lock()
		s.saved = slices.Clone(payload.URIs)
		s.mu.Unlock()
		if itemsStatus != 0 {
			w.WriteHeader(itemsStatus)
			return
		}
		w.WriteHeader(http.StatusCreated)
		fmt.Fprint(w, `{"snapshot_id":"synthetic-revision"}`)
	case "/v1/me/library":
		query := r.URL.Query()
		if r.Method != http.MethodPut || len(query) != 1 || !slices.Equal(query["uris"], []string{"spotify:track:" + mediaFirst}) ||
			r.ContentLength != 0 {
			t.Error("library write must send only one authorized track URI")
		}
		if libraryStatus == 0 {
			libraryStatus = http.StatusOK
		}
		w.WriteHeader(libraryStatus)
	default:
		t.Error("Spotify received an unexpected endpoint")
		http.NotFound(w, r)
	}
}

type fixtureTransport func(*http.Request) (*http.Response, error)

func (f fixtureTransport) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

type playlistJourney struct {
	t        *testing.T
	db       *database.DB
	now      time.Time
	router   chi.Router
	provider *spotifyFixture
}

func newPlaylistJourney(t *testing.T) *playlistJourney {
	t.Helper()
	_, db := testRepository(t)
	j := &playlistJourney{t: t, db: db, now: time.Date(2026, 11, 20, 17, 15, 0, 0, time.UTC), provider: &spotifyFixture{}}
	j.exec(`CREATE TABLE signal_log (ts timestamptz NOT NULL, vehicle_id bigint NOT NULL, field text NOT NULL,
		str_value text, int_value bigint, float_value double precision, source_emitted_at timestamptz, received_at timestamptz,
		PRIMARY KEY(vehicle_id,field,ts));
		INSERT INTO vehicles(id,display_name) VALUES (8,'Synthetic other vehicle')`)
	client, enc := newSpotifyFixtureClient(t, j.provider)
	j.router = chi.NewRouter()
	j.router.Route("/api/v1", func(r chi.Router) {
		mediahandler.NewHandler(smartmediasvc.NewReviews(mediadb.NewRepository(db), client, enc, func() time.Time { return j.now }),
			nil, nil, nil, "X-Test-Subject").MountRoutes(r)
	})
	return j
}

func newSpotifyFixtureClient(t *testing.T, provider *spotifyFixture) (*spotifyplaylist.Client, *crypto.Encryptor) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provider.serve(t, w, r)
	}))
	t.Cleanup(server.Close)
	origin, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	transport := fixtureTransport(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host != "accounts.spotify.com" && request.URL.Host != "api.spotify.com" {
			return nil, fmt.Errorf("unexpected off-fixture provider host")
		}
		local := request.Clone(request.Context())
		local.URL.Scheme, local.URL.Host, local.Host = origin.Scheme, origin.Host, origin.Host
		return server.Client().Transport.RoundTrip(local)
	})
	client, err := spotifyplaylist.New("00000000000000000000000000000000",
		"https://synthetic.invalid/api/v1"+spotifyCallback, spotifyplaylist.WithTransport(transport))
	if err != nil {
		t.Fatal(err)
	}
	enc, err := crypto.New("synthetic-private-media-encryption-key")
	if err != nil {
		t.Fatal(err)
	}
	return client, enc
}

func (j *playlistJourney) exec(stmt string, args ...any) {
	j.t.Helper()
	if _, err := j.db.Pool.Exec(j.t.Context(), stmt, args...); err != nil {
		j.t.Fatal(err)
	}
}

func (j *playlistJourney) seed(source string, attest bool) {
	j.t.Helper()
	minute := j.now.Add(-4 * time.Hour)
	for idx, durationMS := range []int{181000, 179000, 225000} {
		title := []string{"Synthetic first", "Synthetic second", "Synthetic third"}[idx]
		at := minute.Add(time.Duration(idx*5) * time.Minute)
		var emitted *time.Time
		if attest {
			emitted = &at
		}
		j.exec(`INSERT INTO signal_log(ts,vehicle_id,field,str_value,int_value,source_emitted_at,received_at)
			VALUES ($1,7,'MediaNowPlayingTitle',$2,NULL,$4,$1),
			($1,7,'MediaNowPlayingArtist','Synthetic artist',NULL,$4,$1),
			($1,7,'MediaPlaybackStatus','MediaStatusPlaying',NULL,$4,$1),
			($1,7,'MediaPlaybackSource',$3,NULL,$4,$1),
			($1,7,'MediaNowPlayingDuration',NULL,$5,$4,$1),
			($1,7,'MediaNowPlayingElapsed',NULL,1000,$4,$1)`, at, title, source, emitted, durationMS)
		progressAt := at.Add(15 * time.Second)
		j.exec(`INSERT INTO signal_log(ts,vehicle_id,field,int_value,source_emitted_at,received_at)
			VALUES ($1,7,'MediaNowPlayingElapsed',16000,$1,$1)`, progressAt)
	}
}

func (j *playlistJourney) request(method, path, subject string, body any) *httptest.ResponseRecorder {
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(raw))
	req.RemoteAddr = "192.0.2.71:12345"
	if subject == mediaOther {
		req.RemoteAddr = "192.0.2.72:12345"
	}
	if subject != "" {
		req.Header.Set("X-Test-Subject", subject)
		req.Header.Set(auth.ExpectedPrincipalHeader, "subject:"+subject)
	}
	rec := httptest.NewRecorder()
	j.router.ServeHTTP(rec, req)
	return rec
}

func (j *playlistJourney) check(method, path, subject string, body any, status int) *httptest.ResponseRecorder {
	j.t.Helper()
	rec := j.request(method, path, subject, body)
	if rec.Code != status || rec.Header().Get("Cache-Control") != "no-store" {
		j.t.Fatalf("%s %s: got %d (%s), want private %d", method, path, rec.Code, rec.Body, status)
	}
	return rec
}

func playlistData[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var body struct{ Data T }
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("read playlist response: %v", err)
	}
	return body.Data
}

func (j *playlistJourney) preview(expected int64, confirmed bool, status int) {
	j.t.Helper()
	j.check(http.MethodPut, playlistRead, mediaOwner, map[string]any{
		"departure_at": j.now.Add(30 * time.Minute), "target_duration_s": 360, "confirmed": confirmed,
		"expected_draft_id": expected,
	}, status)
}

func (j *playlistJourney) read(path, subject string) media.PlaylistReview {
	j.t.Helper()
	return playlistData[media.PlaylistReview](j.t, j.check(http.MethodGet, path, subject, nil, http.StatusOK))
}

func (j *playlistJourney) begin() string {
	j.t.Helper()
	data := playlistData[map[string]string](j.t, j.check(http.MethodPost, spotifyConnection, mediaOwner,
		map[string]bool{"confirmed": true}, http.StatusOK))
	target, err := url.Parse(data["authorization_url"])
	if err != nil || target.Host != "accounts.spotify.com" || target.Query().Get("scope") != "playlist-modify-private" {
		j.t.Fatal("expected scoped Spotify authorization")
	}
	j.provider.mu.Lock()
	j.provider.challenge = target.Query().Get("code_challenge")
	j.provider.mu.Unlock()
	return spotifyCallback + "?" + url.Values{"state": {target.Query().Get("state")}, "code": {"synthetic-code"}}.Encode()
}

func chosenPlaylist(draft *media.PlaylistDraft) media.SavePlaylist {
	var selection []media.PlaylistSelection
	for _, entry := range draft.Candidates {
		id := mediaFirst
		if entry.Title == "Synthetic second" {
			id = mediaSecond
		}
		if entry.Suggested {
			selection = append(selection, media.PlaylistSelection{Position: entry.Position, Spotify: "https://open.spotify.com/track/" + id})
		}
	}
	return media.SavePlaylist{Name: "Synthetic drive mix", Selection: selection, Confirmed: true}
}

func TestPrivatePlaylistMountedLifecycle(t *testing.T) {
	j := newPlaylistJourney(t)
	j.seed("Spotify", true)
	if review := j.read(playlistRead, mediaOwner); review.Draft != nil || review.Connected || !review.Available {
		t.Fatal("default off must not match tracks or authorize a provider")
	}
	j.check(http.MethodGet, playlistRead, "", nil, http.StatusUnauthorized)
	j.preview(0, false, http.StatusBadRequest)
	j.preview(0, true, http.StatusNoContent)
	draft := j.read(playlistRead, mediaOwner).Draft
	if draft == nil || len(draft.Candidates) != 3 || len(chosenPlaylist(draft).Selection) != 2 || len(j.provider.paths()) != 0 {
		t.Fatalf("expected a local two-track fit with one editable alternative and no provider call: %+v", draft)
	}
	if j.read(playlistRead, mediaOther).Draft != nil || j.read("/media/playlist-review?vehicle_id=8", mediaOwner).Draft != nil {
		t.Fatal("revealed another subject's or vehicle's preview")
	}
	save := playlistSave + fmt.Sprint(draft.ID)
	j.check(http.MethodPost, save, mediaOwner, chosenPlaylist(draft), http.StatusConflict)
	j.check(http.MethodPost, spotifyConnection, mediaOwner, map[string]bool{"confirmed": false}, http.StatusBadRequest)
	callback := j.begin()
	if loc := j.check(http.MethodGet, callback, mediaOther, nil, http.StatusSeeOther).Header().Get("Location"); loc != "/media-player?spotify=not-connected#playlist-review" {
		t.Fatal("foreign callback connected or learned original vehicle")
	}
	if len(j.provider.paths()) != 0 {
		t.Fatal("foreign callback reached Spotify")
	}
	if loc := j.check(http.MethodGet, callback, mediaOwner, nil, http.StatusSeeOther).Header().Get("Location"); loc != "/media-player?spotify=connected&vehicle_id=7#playlist-review" {
		t.Fatal("valid callback did not return to selected review")
	}
	j.check(http.MethodGet, callback, mediaOwner, nil, http.StatusSeeOther)
	var cipher string
	if err := j.db.Pool.QueryRow(t.Context(), `SELECT token_cipher FROM smart_spotify_connections WHERE subject=$1`, mediaOwner).Scan(&cipher); err != nil ||
		cipher == "" || strings.Contains(cipher, mediaGrant) || !j.read(playlistRead, mediaOwner).Connected ||
		j.read(playlistRead, mediaOther).Connected {
		t.Fatal("grant is missing, unprotected, or not bound to the identity")
	}
	request := chosenPlaylist(draft)
	slices.Reverse(request.Selection)
	j.check(http.MethodPost, save, mediaOther, request, http.StatusConflict)
	j.check(http.MethodPost, strings.Replace(save, "vehicle_id=7", "vehicle_id=8", 1), mediaOwner, request, http.StatusConflict)
	unmatched := chosenPlaylist(draft)
	unmatched.Selection[0].Spotify = "https://open.spotify.com/track/" + mediaThird
	j.check(http.MethodPost, save, mediaOwner, unmatched, http.StatusUnprocessableEntity)
	if slices.Contains(j.provider.paths(), "POST /v1/me/playlists") {
		t.Fatal("incorrect track link created a playlist")
	}
	statuses := make(chan int, 2)
	var taps sync.WaitGroup
	for range 2 {
		taps.Go(func() { statuses <- j.request(http.MethodPost, save, mediaOwner, request).Code })
	}
	taps.Wait()
	statusCodes := []int{<-statuses, <-statuses}
	slices.Sort(statusCodes)
	saved := j.read(playlistRead, mediaOwner).Draft
	paths := j.provider.paths()
	if !slices.Equal(statusCodes, []int{200, 409}) || saved == nil || saved.Status != media.PlaylistSaved ||
		saved.PlaylistID != mediaPlaylist || strings.Count(strings.Join(paths, "\n"), "POST /api/token") != 1 ||
		strings.Count(strings.Join(paths, "\n"), "POST /v1/me/playlists") != 1 ||
		strings.Count(strings.Join(paths, "\n"), "/items") != 1 {
		t.Fatalf("unexpected OAuth or duplicate dispatch outcome: %v, %v", statusCodes, paths)
	}
	want := make([]string, 0, 2)
	for _, selected := range request.Selection {
		want = append(want, "spotify:track:"+strings.TrimPrefix(selected.Spotify, "https://open.spotify.com/track/"))
	}
	j.provider.mu.Lock()
	items := slices.Clone(j.provider.saved)
	j.provider.mu.Unlock()
	if !slices.Equal(items, want) {
		t.Fatalf("expected edited order %v, got %v", want, items)
	}
	j.check(http.MethodDelete, spotifyConnection, mediaOwner, nil, http.StatusNoContent)
	j.check(http.MethodDelete, playlistRead+"&draft_id="+fmt.Sprint(draft.ID), mediaOwner, nil, http.StatusNoContent)
	if review := j.read(playlistRead, mediaOwner); review.Draft != nil || review.Connected || !slices.Equal(paths, j.provider.paths()) {
		t.Fatal("clear or disconnect did not remain local")
	}
}

func TestPrivatePlaylistNoEvidenceAndSaveOutcomes(t *testing.T) {
	for _, source := range []string{"FM", "unattested"} {
		t.Run(source, func(t *testing.T) {
			j := newPlaylistJourney(t)
			attest := source == "FM"
			playbackSource := "Spotify"
			if attest {
				playbackSource = source
			}
			j.seed(playbackSource, attest)
			j.preview(0, true, http.StatusNoContent)
			if draft := j.read(playlistRead, mediaOwner).Draft; draft == nil || len(draft.Candidates) != 0 || len(j.provider.paths()) != 0 {
				t.Fatal("ineligible playback yielded a playlist or provider call")
			}
		})
	}
	for _, tc := range []struct {
		name       string
		createCode int
		itemCode   int
		disconnect bool
		want       media.PlaylistSaveStatus
		items      bool
		created    bool
	}{
		{"create rejection", 403, 0, false, media.PlaylistRejected, false, false},
		{"create unknown", 502, 0, false, media.PlaylistUnknown, false, false},
		{"item rejection", 0, 403, false, media.PlaylistCreatedOnly, true, true},
		{"items unknown", 0, 502, false, media.PlaylistUnknown, true, true},
		{"disconnect after create claim", 0, 0, true, media.PlaylistCreatedOnly, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			j := newPlaylistJourney(t)
			j.seed("Spotify", true)
			j.preview(0, true, http.StatusNoContent)
			draft := j.read(playlistRead, mediaOwner).Draft
			save := playlistSave + fmt.Sprint(draft.ID)
			j.check(http.MethodGet, j.begin(), mediaOwner, nil, http.StatusSeeOther)
			j.provider.mu.Lock()
			j.provider.createStatus, j.provider.itemsStatus = tc.createCode, tc.itemCode
			if tc.disconnect {
				j.provider.onCreate = func() {
					rec := j.request(http.MethodDelete, spotifyConnection, mediaOwner, nil)
					if rec.Code != http.StatusNoContent {
						t.Errorf("disconnect during creation returned %d", rec.Code)
					}
				}
			}
			j.provider.mu.Unlock()
			j.check(http.MethodPost, save, mediaOwner, chosenPlaylist(draft), http.StatusOK)
			j.check(http.MethodPost, save, mediaOwner, chosenPlaylist(draft), http.StatusConflict)
			after := j.read(playlistRead, mediaOwner).Draft
			paths := strings.Join(j.provider.paths(), "\n")
			if after.Status != tc.want || (after.PlaylistID == mediaPlaylist) != tc.created ||
				(strings.Count(paths, "/items") == 1) != tc.items ||
				strings.Count(paths, "/v1/me/playlists") != 1 {
				t.Fatalf("wrong outcome or a replay: %+v, %s", after, paths)
			}
		})
	}
}

func TestPrivatePlaylistHoldsAndReauthorization(t *testing.T) {
	j := newPlaylistJourney(t)
	j.seed("Spotify", true)
	j.preview(0, true, http.StatusNoContent)
	draft := j.read(playlistRead, mediaOwner).Draft
	save := playlistSave + fmt.Sprint(draft.ID)
	update := playlistRead + "&draft_id=" + fmt.Sprint(draft.ID)
	stale := j.begin()
	current := j.begin()
	j.check(http.MethodGet, stale, mediaOwner, nil, http.StatusSeeOther)
	if len(j.provider.paths()) != 0 {
		t.Fatal("replaced OAuth state was sent to Spotify")
	}
	j.check(http.MethodGet, current, mediaOwner, nil, http.StatusSeeOther)
	j.check(http.MethodPatch, update, mediaOwner, map[string]string{"action": "snooze"}, http.StatusNoContent)
	j.check(http.MethodPost, save, mediaOwner, chosenPlaylist(draft), http.StatusConflict)
	j.now = j.now.Add(16 * time.Minute)
	j.check(http.MethodPatch, update, mediaOwner, map[string]string{"action": "pause"}, http.StatusNoContent)
	j.check(http.MethodPost, save, mediaOwner, chosenPlaylist(draft), http.StatusConflict)
	j.preview(draft.ID, true, http.StatusNoContent)
	newDraft := j.read(playlistRead, mediaOwner).Draft
	if newDraft == nil || newDraft.ID == draft.ID || newDraft.Paused || newDraft.SnoozedUntil != nil {
		t.Fatal("reconfirm did not replace the held preview")
	}
	j.now = newDraft.DepartureAt
	j.check(http.MethodPost, playlistSave+fmt.Sprint(newDraft.ID), mediaOwner, chosenPlaylist(newDraft), http.StatusConflict)
	if !slices.Equal(j.provider.paths(), []string{"POST /api/token"}) {
		t.Fatal("held, expired, or unfenced draft reached the provider")
	}
}

func TestPrivatePlaylistPauseFencesProviderWithoutDisconnecting(t *testing.T) {
	j := newPlaylistJourney(t)
	j.seed("Spotify", true)
	j.preview(0, true, http.StatusNoContent)
	draft := j.read(playlistRead, mediaOwner).Draft
	if draft == nil || len(draft.Candidates) == 0 {
		t.Fatal("expected a qualified playlist preview")
	}
	j.check(http.MethodGet, j.begin(), mediaOwner, nil, http.StatusSeeOther)
	save := func(draft *media.PlaylistDraft, status int) {
		t.Helper()
		j.check(http.MethodPost, playlistSave+fmt.Sprint(draft.ID), mediaOwner, chosenPlaylist(draft), status)
	}
	prefs := featuredb.NewRepository(j.db.Pool)
	set := func(allowed bool) error {
		return prefs.SetPreference(t.Context(), mediaOwner, smartfeature.Preference{Feature: smartfeature.Playlist, Allowed: allowed})
	}
	if err := set(false); err != nil {
		t.Fatal(err)
	}
	if review := j.read(playlistRead, mediaOwner); !review.Connected || review.Draft == nil ||
		review.Draft.ID != draft.ID || len(review.Draft.Candidates) != 0 {
		t.Fatalf("pause lost the setup or exposed paused recommendations: %+v", review)
	}
	j.preview(draft.ID, true, http.StatusConflict)
	save(draft, http.StatusConflict)
	if paths := j.provider.paths(); !slices.Equal(paths, []string{"POST /api/token"}) {
		t.Fatalf("paused work reached the provider: %v", paths)
	}
	if err := set(true); err != nil {
		t.Fatal(err)
	}
	j.preview(draft.ID, true, http.StatusNoContent)
	draft = j.read(playlistRead, mediaOwner).Draft
	if draft == nil || len(draft.Candidates) == 0 {
		t.Fatal("fresh review did not become available")
	}
	cycle := func() {
		if err := set(false); err != nil {
			t.Error(err)
			return
		}
		if err := set(true); err != nil {
			t.Error(err)
		}
	}
	j.provider.mu.Lock()
	j.provider.onTrack = cycle
	j.provider.mu.Unlock()
	save(draft, http.StatusConflict)
	if paths := j.provider.paths(); len(paths) != 2 || !strings.HasPrefix(paths[1], "GET /v1/tracks/") {
		t.Fatalf("provider work continued after pause and resume: %v", paths)
	}

	j.preview(draft.ID, true, http.StatusNoContent)
	draft = j.read(playlistRead, mediaOwner).Draft
	if draft == nil || len(draft.Candidates) == 0 {
		t.Fatal("expected a fresh preview before create")
	}
	j.provider.mu.Lock()
	j.provider.onTrack, j.provider.onCreate = nil, cycle
	j.provider.mu.Unlock()
	save(draft, http.StatusOK)
	review := j.read(playlistRead, mediaOwner)
	if !review.Connected || review.Draft == nil || review.Draft.Status != media.PlaylistCreatedOnly ||
		review.Draft.PlaylistID != mediaPlaylist {
		t.Fatalf("pause lost consent or the result of the already-started request: %+v", review)
	}
	for _, path := range j.provider.paths() {
		if strings.HasSuffix(path, "/items") {
			t.Fatalf("playlist was populated after pause: %s", path)
		}
	}
}
