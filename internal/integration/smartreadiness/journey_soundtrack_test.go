package smartreadiness_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/api/journey"
	"github.com/ev-dev-labs/teslasync/internal/api/waitoracle"
	"github.com/ev-dev-labs/teslasync/internal/app/smartmediasvc"
	"github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
	mediadb "github.com/ev-dev-labs/teslasync/internal/database/smartmedia"
	media "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	mediahandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartmedia"
)

const soundtrackAPI = "/api/v1/media/journey-soundtrack/1?vehicle_id=7"

type soundtrackJourney struct {
	t          *testing.T
	db         *database.DB
	now        time.Time
	start, end time.Time
	router     http.Handler
}

func newSoundtrackJourney(t *testing.T) *soundtrackJourney {
	t.Helper()
	_, db := testRepository(t)
	now := time.Date(2026, 11, 20, 17, 15, 0, 0, time.UTC)
	j := &soundtrackJourney{t: t, db: db, now: now, start: now.Add(-2 * time.Hour), end: now.Add(-time.Hour)}
	j.exec(`CREATE TABLE drives (id bigint PRIMARY KEY, vehicle_id bigint NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz);
		CREATE TABLE signal_log (ts timestamptz NOT NULL, vehicle_id bigint NOT NULL, field text NOT NULL,
			str_value text, int_value bigint, float_value double precision, source_emitted_at timestamptz, received_at timestamptz,
			PRIMARY KEY(vehicle_id,field,ts));
		INSERT INTO vehicles(id,display_name) VALUES (8,'Synthetic other vehicle')`)
	j.exec(`INSERT INTO journey_sessions(vehicle_id,name,status,started_at,ended_at,updated_at)
		VALUES (7,'Synthetic completed soundtrack journey','completed',$1,$2,$2),
		(7,'Synthetic aborted soundtrack journey','aborted',$1,$2,$2-INTERVAL '1 hour'),
		(8,'Synthetic other vehicle journey','completed',$1,$2,$2)`, j.start, j.end)
	j.exec(`INSERT INTO drives(id,vehicle_id,started_at,ended_at)
		VALUES (10,7,$1::timestamptz+INTERVAL '5 minutes',$1::timestamptz+INTERVAL '15 minutes'),
		(11,7,$1::timestamptz+INTERVAL '30 minutes',$1::timestamptz+INTERVAL '50 minutes'),
		(12,8,$1::timestamptz+INTERVAL '5 minutes',$1::timestamptz+INTERVAL '50 minutes')`, j.start)
	j.play(7, 7, "Synthetic opening track", "Spotify", true)
	j.play(7, 11, "Synthetic radio", "FM", true)
	j.play(7, 20, "Synthetic parked track", "Spotify", true)
	j.play(7, 35, "Synthetic closing track", "Spotify", true)
	j.play(7, 41, "Synthetic unattested track", "Spotify", false)
	j.play(8, 8, "Synthetic other vehicle track", "Spotify", true)
	j.play(7, 65, "Synthetic after the journey", "Spotify", true)
	j.router = j.mount("X-Test-Subject")
	return j
}

func (j *soundtrackJourney) mount(header string) http.Handler {
	router := chi.NewRouter()
	store := journey.NewStore(j.db)
	jh := journey.NewHandler(store, store, waitoracle.NewStore(j.db))
	svc := smartmediasvc.NewSoundtracks(mediadb.NewRepository(j.db), func() time.Time { return j.now })
	router.Route("/api/v1", func(r chi.Router) {
		mediahandler.NewHandler(nil, svc, nil, nil, header).MountRoutes(r)
		r.Get("/journey/sessions", jh.List)
		r.Get("/journey/sessions/{id}", jh.Get)
	})
	return router
}

func (j *soundtrackJourney) exec(stmt string, args ...any) {
	j.t.Helper()
	if _, err := j.db.Pool.Exec(j.t.Context(), stmt, args...); err != nil {
		j.t.Fatal(err)
	}
}

func (j *soundtrackJourney) play(vehicle int64, minute int, title, source string, attested bool) {
	j.t.Helper()
	j.playWithOffsets(vehicle, minute, title, source, attested, 15, 25)
}

func (j *soundtrackJourney) playWithOffsets(vehicle int64, minute int, title, source string, attested bool, first, second int) {
	j.t.Helper()
	at := j.start.Add(time.Duration(minute) * time.Minute)
	var emitted *time.Time
	if attested {
		emitted = &at
	}
	j.exec(`INSERT INTO signal_log(ts,vehicle_id,field,str_value,int_value,source_emitted_at,received_at)
		VALUES ($1,$2,'MediaNowPlayingTitle',$3,NULL,$5,$1),
		($1,$2,'MediaNowPlayingArtist','Synthetic artist',NULL,$5,$1),
		($1,$2,'MediaPlaybackStatus','MediaStatusPlaying',NULL,$5,$1),
		($1,$2,'MediaPlaybackSource',$4,NULL,$5,$1),
		($1,$2,'MediaNowPlayingElapsed',NULL,1000,$5,$1)`, at, vehicle, title, source, emitted)
	j.exec(`INSERT INTO signal_log(ts,vehicle_id,field,int_value,source_emitted_at,received_at)
		VALUES ($1,$2,'MediaNowPlayingElapsed',$4,$1,$1),($3,$2,'MediaNowPlayingElapsed',$5,$3,$3)`,
		at.Add(time.Duration(first)*time.Second), vehicle, at.Add(time.Duration(second)*time.Second),
		(first+1)*1000, (second+1)*1000)
}

func (j *soundtrackJourney) request(method, uri, subject, expected string, body any) *httptest.ResponseRecorder {
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, uri, bytes.NewReader(raw))
	req.RemoteAddr = "192.0.2.81:12345"
	if subject == mediaOther {
		req.RemoteAddr = "192.0.2.82:12345"
	}
	if subject != "" {
		req.Header.Set("X-Test-Subject", subject)
	}
	if expected != "" {
		req.Header.Set(auth.ExpectedPrincipalHeader, "subject:"+expected)
	}
	rec := httptest.NewRecorder()
	j.router.ServeHTTP(rec, req)
	return rec
}

func (j *soundtrackJourney) check(method, uri, subject string, body any, status int) *httptest.ResponseRecorder {
	j.t.Helper()
	rec := j.request(method, uri, subject, subject, body)
	if rec.Code != status || rec.Header().Get("Cache-Control") != "no-store" {
		j.t.Fatalf("%s %s: got %d (%s), want private %d", method, uri, rec.Code, rec.Body, status)
	}
	return rec
}

func (j *soundtrackJourney) read(uri, subject, want string) media.SoundtrackReview {
	j.t.Helper()
	got := playlistData[media.SoundtrackReview](j.t, j.check(http.MethodGet, uri, subject, nil, http.StatusOK))
	if got.Reason != want || (want != "observed" && len(got.Plays) != 0) || got.Plays == nil {
		j.t.Fatalf("soundtrack got %+v, want %s and no unqualified evidence", got, want)
	}
	return got
}

func (j *soundtrackJourney) confirm(uri string, id int64, confirmed bool, status int) {
	j.t.Helper()
	j.check(http.MethodPut, uri, mediaOwner, media.SoundtrackConfirmation{
		Confirmed: confirmed, ExpectedID: &id, StartedAt: j.start, EndedAt: j.end,
	}, status)
}

func TestJourneySoundtrackMountedLifecycle(t *testing.T) {
	j := newSoundtrackJourney(t)
	j.check(http.MethodGet, soundtrackAPI, "", nil, http.StatusUnauthorized)
	if rec := j.request(http.MethodGet, soundtrackAPI, mediaOther, mediaOwner, nil); rec.Code != http.StatusConflict ||
		!strings.Contains(rec.Body.String(), "IDENTITY_CHANGED") {
		t.Fatal("a stale browser identity was not fenced")
	}
	j.check(http.MethodGet, strings.Replace(soundtrackAPI, "vehicle_id=7", "vehicle_id=8", 1), mediaOwner, nil, http.StatusNotFound)
	aborted := strings.Replace(soundtrackAPI, "/1?", "/2?", 1)
	j.read(aborted, mediaOwner, "journey_unmatched")
	j.confirm(aborted, 0, true, http.StatusConflict)
	j.exec(`ALTER TABLE signal_log RENAME TO synthetic_hidden_signals`)
	j.read(soundtrackAPI, mediaOwner, "off")
	j.confirm(soundtrackAPI, 0, false, http.StatusBadRequest)
	j.read(soundtrackAPI, mediaOwner, "off")
	j.exec(`ALTER TABLE synthetic_hidden_signals RENAME TO signal_log`)

	j.confirm(soundtrackAPI, 0, true, http.StatusNoContent)
	j.confirm(soundtrackAPI, 0, true, http.StatusConflict)
	got := j.read(soundtrackAPI, mediaOwner, "observed")
	var titles []string
	for _, play := range got.Plays {
		titles = append(titles, play.Title)
		if !play.LastObservedAt.After(play.ObservedFrom) || play.DurationS != nil {
			t.Fatalf("want two progress-bounded observations without guessed duration: %+v", play)
		}
	}
	if got.ID < 1 || got.MatchedDrives != 2 || got.ObservedDrives != 2 ||
		!slices.Equal(titles, []string{"Synthetic opening track", "Synthetic closing track"}) {
		t.Fatalf("expected only the observed soundtrack in chronological order: %+v", got)
	}
	j.read(soundtrackAPI, mediaOther, "off")
	change := soundtrackAPI + fmt.Sprintf("&review_id=%d", got.ID)
	j.check(http.MethodDelete, change, mediaOther, nil, http.StatusConflict)
	j.check(http.MethodPatch, change, mediaOwner, map[string]string{"action": "snooze"}, http.StatusNoContent)
	j.read(soundtrackAPI, mediaOwner, "held")
	j.now = j.now.Add(24 * time.Hour)
	j.read(soundtrackAPI, mediaOwner, "observed")
	j.check(http.MethodPatch, change, mediaOwner, map[string]string{"action": "pause"}, http.StatusNoContent)
	j.check(http.MethodPatch, change, mediaOwner, map[string]string{"action": "snooze"}, http.StatusConflict)
	j.read(soundtrackAPI, mediaOwner, "held")
	j.confirm(soundtrackAPI, got.ID, true, http.StatusNoContent)
	fresh := j.read(soundtrackAPI, mediaOwner, "observed")
	j.check(http.MethodDelete, change, mediaOwner, nil, http.StatusConflict)
	j.check(http.MethodDelete, soundtrackAPI+fmt.Sprintf("&review_id=%d", fresh.ID), mediaOwner, nil, http.StatusNoContent)
	j.read(soundtrackAPI, mediaOwner, "off")
	var telemetry int
	if err := j.db.Pool.QueryRow(t.Context(), `SELECT count(*) FROM signal_log`).Scan(&telemetry); err != nil || telemetry != 49 {
		t.Fatalf("clearing private review must preserve all 49 synthetic signals; got %d (%v)", telemetry, err)
	}
}

func TestJourneySoundtrackSuppressesAmbiguousOrExpiredScope(t *testing.T) {
	j := newSoundtrackJourney(t)
	closed := j.router
	j.router = j.mount("")
	j.check(http.MethodGet, soundtrackAPI, "", nil, http.StatusForbidden)
	j.router = closed

	j.confirm(soundtrackAPI, 0, true, http.StatusNoContent)
	j.exec(`UPDATE journey_sessions SET ended_at=ended_at+INTERVAL '1 minute' WHERE id=1`)
	changed := j.read(soundtrackAPI, mediaOwner, "journey_changed")
	j.confirm(soundtrackAPI, changed.ID, true, http.StatusConflict)
	j.end = *changed.EndedAt
	j.confirm(soundtrackAPI, changed.ID, true, http.StatusNoContent)
	j.exec(`INSERT INTO drives(id,vehicle_id,started_at,ended_at)
		VALUES (13,7,$1::timestamptz+INTERVAL '10 minutes',$1::timestamptz+INTERVAL '25 minutes')`, j.start)
	j.read(soundtrackAPI, mediaOwner, "missing_evidence")
	j.exec(`DELETE FROM drives WHERE id=13`)
	got := j.read(soundtrackAPI, mediaOwner, "observed")
	j.now = *got.ExpiresAt
	j.read(soundtrackAPI, mediaOwner, "expired")
	j.now = j.end.Add(31 * 24 * time.Hour)
	j.confirm(soundtrackAPI, got.ID, true, http.StatusConflict)
	j.exec(`UPDATE vehicles SET archived_at=$1 WHERE id=7`, j.now)
	j.check(http.MethodGet, soundtrackAPI, mediaOwner, nil, http.StatusNotFound)
}
