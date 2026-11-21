package smartreadiness_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
	ftproto "github.com/teslamotors/fleet-telemetry/protos"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/ev-dev-labs/teslasync/internal/adapter/spotifyplaylist"
	"github.com/ev-dev-labs/teslasync/internal/api/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/app/smartmediasvc"
	mediadb "github.com/ev-dev-labs/teslasync/internal/database/smartmedia"
	media "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	mediahandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartmedia"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	teslaconfig "github.com/ev-dev-labs/teslasync/internal/tesla/config"
	"github.com/ev-dev-labs/teslasync/internal/tesla/normalize"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router/writers"
	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
)

const (
	driveTrackAPI = "/api/v1/media/drive-track/412"
	driveTrackURL = driveTrackAPI + "?vehicle_id=7"
	trackOffset   = 67
)

type trackJourney struct {
	*soundtrackJourney
	driveStart, driveEnd time.Time
	firstProgressAt      time.Time
	provider             *spotifyFixture
}

func newTrackJourney(t *testing.T) *trackJourney {
	t.Helper()
	base := newSoundtrackJourney(t)
	j := &trackJourney{soundtrackJourney: base, driveStart: base.start.Add(26 * time.Minute),
		driveEnd: base.start.Add(29 * time.Minute), provider: &spotifyFixture{}}
	j.exec(`INSERT INTO drives(id,vehicle_id,started_at,ended_at) VALUES (412,7,$1,$2)`, j.driveStart, j.driveEnd)
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000294_smart_drive_track_reviews.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	j.exec(string(migration))
	cadence, subscribed := teslaconfig.IntervalFor("MediaNowPlayingElapsed")
	if !subscribed {
		t.Fatal("the production subscription does not request playback progress")
	}
	j.playWithOffsets(7, 27, "Synthetic first", "Spotify", true, cadence, 2*cadence)
	j.firstProgressAt = j.driveStart.Add(time.Duration(60+cadence) * time.Second)
	j.exec(`INSERT INTO signal_log(ts,vehicle_id,field,int_value,source_emitted_at,received_at)
		VALUES ($1,7,'MediaNowPlayingDuration',181000,$1,$1)`, j.driveStart.Add(time.Minute))
	client, enc := newSpotifyFixtureClient(t, j.provider)
	repo := mediadb.NewRepository(j.db)
	now := func() time.Time { return j.now }
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		mediahandler.NewHandler(smartmediasvc.NewReviews(repo, client, enc, now), nil,
			smartmediasvc.NewTrackReviews(repo, client, enc, now), nil, "X-Test-Subject").MountRoutes(r)
	})
	j.router = router
	return j
}

func (j *trackJourney) lookup(id int64, offset int, confirmed bool, status int) {
	j.t.Helper()
	j.check(http.MethodPut, driveTrackURL, mediaOwner, media.DriveTrackConfirmation{
		ExpectedID: &id, OffsetS: &offset, Confirmed: confirmed, StartedAt: j.driveStart, EndedAt: j.driveEnd,
	}, status)
}

func (j *trackJourney) readTrack(subject, want string) media.DriveTrackReview {
	j.t.Helper()
	review := playlistData[media.DriveTrackReview](j.t, j.check(http.MethodGet, driveTrackURL, subject, nil, http.StatusOK))
	if review.Reason != want || (want != "observed" && (review.Track != nil || review.EvidenceKey != "")) {
		j.t.Fatalf("private exact-time lookup = %+v, want %s with no unqualified evidence", review, want)
	}
	return review
}

func libraryPath(id int64, suffix string) string {
	return fmt.Sprintf("%s/spotify%s?vehicle_id=7&review_id=%d", driveTrackAPI, suffix, id)
}

func (j *trackJourney) beginLibrary(id int64) string {
	j.t.Helper()
	body := map[string]bool{"confirmed": true}
	data := playlistData[map[string]string](j.t, j.check(http.MethodPost, libraryPath(id, ""), mediaOwner, body, http.StatusOK))
	target, err := url.Parse(data["authorization_url"])
	if err != nil || target.Host != "accounts.spotify.com" || target.Query().Get("scope") != spotifyplaylist.LibraryTrackScope ||
		target.Query().Get("code_challenge_method") != "S256" || !strings.HasPrefix(target.Query().Get("state"), smartmediasvc.LibraryStatePrefix) {
		j.t.Fatal("library attempt is not independently authorized with PKCE")
	}
	j.provider.mu.Lock()
	j.provider.challenge = target.Query().Get("code_challenge")
	j.provider.mu.Unlock()
	return "/api/v1" + spotifyCallback + "?" + url.Values{
		"state": {target.Query().Get("state")}, "code": {"synthetic-library-code"},
	}.Encode()
}

func (j *trackJourney) completeLibrary(uri, subject string, drive bool, connected bool) {
	j.t.Helper()
	target := "/drives"
	if drive {
		target += "/412"
	}
	outcome := "not-connected"
	if connected {
		outcome = "connected"
	}
	rec := j.check(http.MethodGet, uri, subject, nil, http.StatusSeeOther)
	if got := rec.Header().Get("Location"); got != target+"?spotify_library="+outcome+"#drive-track-review" {
		j.t.Fatalf("unsafe or unexpected OAuth return %q; want %s and %s", got, target, outcome)
	}
}

func trackSave(review media.DriveTrackReview, track string) media.SaveDriveTrack {
	return media.SaveDriveTrack{Confirmed: true, EvidenceKey: review.EvidenceKey, Spotify: "https://open.spotify.com/track/" + track}
}

func TestDriveTrackMountedLifecycle(t *testing.T) {
	j := newTrackJourney(t)
	j.check(http.MethodGet, driveTrackURL, "", nil, http.StatusUnauthorized)
	j.check(http.MethodGet, driveTrackAPI+"?vehicle_id=8", mediaOwner, nil, http.StatusNotFound)
	if rec := j.request(http.MethodGet, driveTrackURL, mediaOther, mediaOwner, nil); rec.Code != http.StatusConflict ||
		!strings.Contains(rec.Body.String(), "IDENTITY_CHANGED") {
		t.Fatal("lookup failed to fence a stale browser identity")
	}
	j.exec(`ALTER TABLE signal_log RENAME TO synthetic_unavailable_signals`)
	j.readTrack(mediaOwner, "off")
	j.lookup(0, trackOffset, false, http.StatusBadRequest)
	j.readTrack(mediaOwner, "off")
	j.exec(`ALTER TABLE synthetic_unavailable_signals RENAME TO signal_log`)

	j.lookup(0, trackOffset, true, http.StatusNoContent)
	j.lookup(0, trackOffset, true, http.StatusConflict)
	got := j.readTrack(mediaOwner, "observed")
	if got.Track == nil || got.Track.Title != "Synthetic first" || got.Track.Artist != "Synthetic artist" ||
		got.Track.DurationS == nil || *got.Track.DurationS != 181 || got.SelectedAt == nil ||
		!got.SelectedAt.Equal(j.driveStart.Add(67*time.Second)) || !got.Track.ObservedFrom.Equal(j.driveStart.Add(time.Minute)) ||
		!got.Track.LastObservedAt.Equal(j.firstProgressAt) || got.LibraryConnected {
		t.Fatalf("want the exact selected time and bracketing observed recording, got %+v (%+v)", got, got.Track)
	}
	j.readTrack(mediaOther, "off")
	save := libraryPath(got.ID, "/save")
	j.check(http.MethodPost, save, mediaOwner, trackSave(got, mediaFirst), http.StatusConflict)
	j.check(http.MethodPost, libraryPath(got.ID, ""), mediaOther, map[string]bool{"confirmed": true}, http.StatusConflict)
	if calls := j.provider.paths(); len(calls) != 0 {
		t.Fatalf("local lookup or unconsented request contacted a provider: %v", calls)
	}
	callback := j.beginLibrary(got.ID)
	j.completeLibrary(callback, mediaOther, false, false)
	j.completeLibrary(callback, mediaOwner, true, true)
	j.completeLibrary(callback, mediaOwner, false, false)
	if !j.readTrack(mediaOwner, "observed").LibraryConnected {
		t.Fatal("successful grant was not applied to the original lookup")
	}
	playlist := playlistData[media.PlaylistReview](t, j.check(http.MethodGet, "/api/v1"+playlistRead, mediaOwner, nil, http.StatusOK))
	if playlist.Connected {
		t.Fatal("library consent incorrectly authorized a playlist")
	}
	j.check(http.MethodPost, save, mediaOwner, trackSave(got, mediaSecond), http.StatusUnprocessableEntity)
	j.exec(`UPDATE signal_log SET int_value=int_value+1000 WHERE ts=$1 AND vehicle_id=7 AND field='MediaNowPlayingElapsed'`,
		j.firstProgressAt)
	j.check(http.MethodPost, save, mediaOwner, trackSave(got, mediaFirst), http.StatusConflict)
	got = j.readTrack(mediaOwner, "observed")

	responses := make(chan int, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Go(func() {
			responses <- j.request(http.MethodPost, save, mediaOwner, mediaOwner, trackSave(got, mediaFirst)).Code
		})
	}
	wait.Wait()
	codes := []int{<-responses, <-responses}
	slices.Sort(codes)
	if !slices.Equal(codes, []int{http.StatusOK, http.StatusConflict}) {
		t.Fatalf("competing explicit saves = %v, want one completion and one conflict", codes)
	}
	saved := j.readTrack(mediaOwner, "observed")
	if saved.Status != media.TrackSaved || saved.LibraryConnected {
		t.Fatalf("terminal outcome did not retire the grant: %+v", saved)
	}
	j.check(http.MethodDelete, driveTrackURL+fmt.Sprintf("&review_id=%d", got.ID), mediaOwner, nil, http.StatusNoContent)
	j.readTrack(mediaOwner, "off")
	var rows int
	if err := j.db.Pool.QueryRow(t.Context(), `SELECT count(*) FROM signal_log`).Scan(&rows); err != nil || rows != 57 {
		t.Fatalf("clearing must preserve 57 source observations, got %d (%v)", rows, err)
	}
	countLibraryWrites(t, j.provider, 1)
}

func TestDriveTrackSuppressesUnqualifiedEvidence(t *testing.T) {
	j := newTrackJourney(t)
	j.lookup(0, 180, true, http.StatusBadRequest)
	j.lookup(0, 15, true, http.StatusNoContent)
	missing := j.readTrack(mediaOwner, "missing_evidence")
	j.check(http.MethodPost, libraryPath(missing.ID, ""), mediaOwner, map[string]bool{"confirmed": true}, http.StatusConflict)
	j.lookup(missing.ID, trackOffset, true, http.StatusNoContent)
	got := j.readTrack(mediaOwner, "observed")
	j.exec(`INSERT INTO drives(id,vehicle_id,started_at,ended_at) VALUES (413,7,$1,$2)`, j.driveStart, j.driveEnd)
	j.readTrack(mediaOwner, "drive_unmatched")
	j.exec(`DELETE FROM drives WHERE id=413`)
	j.exec(`UPDATE drives SET ended_at=ended_at+INTERVAL '1 second' WHERE id=412`)
	j.readTrack(mediaOwner, "drive_changed")
	j.lookup(got.ID, trackOffset, true, http.StatusConflict)
	j.driveEnd = j.driveEnd.Add(time.Second)
	j.lookup(got.ID, trackOffset, true, http.StatusNoContent)
	eligible := j.readTrack(mediaOwner, "observed")
	callback := j.beginLibrary(eligible.ID)
	j.lookup(eligible.ID, trackOffset+1, true, http.StatusNoContent)
	j.completeLibrary(callback, mediaOwner, false, false)
	latest := j.readTrack(mediaOwner, "observed")
	j.now = *latest.ExpiresAt
	j.exec(`ALTER TABLE signal_log RENAME TO synthetic_unavailable_signals`)
	j.readTrack(mediaOwner, "expired")
	j.check(http.MethodPost, libraryPath(latest.ID, "/save"), mediaOwner, trackSave(latest, mediaFirst), http.StatusConflict)
	if calls := j.provider.paths(); len(calls) != 0 {
		t.Fatalf("unqualified or expired evidence contacted a provider: %v", calls)
	}
}

func TestDriveTrackSuppressesBrokenContinuityAcrossPrivateMedia(t *testing.T) {
	for _, tt := range []struct {
		name        string
		changeField string
		changeJSON  string
		invalid     ftproto.Field
		webhook     string
		observed    bool
	}{
		{name: "unchanged duration", changeField: "MediaNowPlayingDuration", changeJSON: "360000", observed: true},
		{name: "changed duration", changeField: "MediaNowPlayingDuration", changeJSON: "362000"},
		{name: "invalid MQTT source", changeField: "MediaPlaybackSource", changeJSON: "null"},
		{name: "invalid MQTT status", changeField: "MediaPlaybackStatus", changeJSON: "null"},
		{name: "invalid protobuf source", invalid: ftproto.Field_MediaPlaybackSource},
		{name: "invalid protobuf status", invalid: ftproto.Field_MediaPlaybackStatus},
		{name: "HTTP unchanged duration control", webhook: "data", changeField: "MediaNowPlayingDuration", changeJSON: "360000", observed: true},
		{name: "HTTP data null source", webhook: "data", changeField: "MediaPlaybackSource", changeJSON: "null"},
		{name: "HTTP data null status", webhook: "data", changeField: "MediaPlaybackStatus", changeJSON: "null"},
		{name: "HTTP signals null source", webhook: "signals", changeField: "MediaPlaybackSource", changeJSON: "null"},
		{name: "HTTP signals null status", webhook: "signals", changeField: "MediaPlaybackStatus", changeJSON: "null"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			j := newTrackJourney(t)
			pipeline := j.playbackPipeline()
			if tt.webhook != "" {
				j.alignPlaybackToHTTPReceipt()
			}
			at := j.driveStart.Add(time.Minute)
			for _, field := range []struct{ name, json string }{
				{"MediaNowPlayingTitle", `"Synthetic observed track"`},
				{"MediaNowPlayingArtist", `"Synthetic artist"`},
				{"MediaPlaybackSource", `"Spotify"`},
				{"MediaPlaybackStatus", `"MediaStatusPlaying"`},
				{"MediaNowPlayingDuration", "360000"},
				{"MediaNowPlayingElapsed", "1000"},
			} {
				j.ingestPlaybackJSON(pipeline, at, field.name, field.json)
			}
			between := at.Add(j.firstProgressAt.Sub(at) / 2)
			switch {
			case tt.webhook != "":
				j.ingestPlaybackWebhook(between, tt.webhook, tt.changeField, tt.changeJSON)
			case tt.changeField != "":
				j.ingestPlaybackJSON(pipeline, between, tt.changeField, tt.changeJSON)
			default:
				wire, err := proto.Marshal(&ftproto.Payload{Vin: playbackFixtureVIN, CreatedAt: timestamppb.New(between),
					Data: []*ftproto.Datum{{Key: tt.invalid, Value: &ftproto.Value{Value: &ftproto.Value_Invalid{Invalid: true}}}}})
				if err != nil {
					t.Fatal(err)
				}
				atoms, err := codec.Decode(wire)
				if err != nil {
					t.Fatal(err)
				}
				if err := pipeline.ProcessAtomics(t.Context(), codec.StampTransport(atoms, codec.IngestOriginFleetTelemetryHTTP, between.Add(time.Second)), 7); err != nil {
					t.Fatal(err)
				}
			}
			elapsedMS := 1000 + j.firstProgressAt.Sub(at).Milliseconds()
			j.ingestPlaybackJSON(pipeline, j.firstProgressAt, "MediaNowPlayingElapsed", fmt.Sprint(elapsedMS))
			var written int
			if err := j.db.Pool.QueryRow(t.Context(), `SELECT count(*) FROM signal_log WHERE
				source_emitted_at=ts AND received_at BETWEEN ts AND ts+INTERVAL '1 minute'`).Scan(&written); err != nil || written != 8 {
				t.Fatalf("want eight attested persisted updates including the interruption, got %d: %v", written, err)
			}

			playlistURL := "/api/v1" + playlistRead
			j.check(http.MethodPut, playlistURL, mediaOwner, map[string]any{
				"departure_at": j.now.Add(30 * time.Minute), "target_duration_s": 360, "confirmed": true, "expected_draft_id": 0,
			}, http.StatusNoContent)
			playlist := playlistData[media.PlaylistReview](t, j.check(http.MethodGet, playlistURL, mediaOwner, nil, http.StatusOK))
			wantCandidates := 0
			if tt.observed {
				wantCandidates = 1
			}
			if playlist.Draft == nil || len(playlist.Draft.Candidates) != wantCandidates {
				t.Fatalf("playlist qualified unexpected playback: %+v", playlist.Draft)
			}
			j.confirm(soundtrackAPI, 0, true, http.StatusNoContent)
			j.lookup(0, trackOffset, true, http.StatusNoContent)
			if tt.observed {
				j.read(soundtrackAPI, mediaOwner, "observed")
				j.readTrack(mediaOwner, "observed")
			} else {
				j.read(soundtrackAPI, mediaOwner, "missing_evidence")
				track := j.readTrack(mediaOwner, "missing_evidence")
				j.check(http.MethodPost, libraryPath(track.ID, ""), mediaOwner, map[string]bool{"confirmed": true}, http.StatusConflict)
			}
			if calls := j.provider.paths(); len(calls) != 0 {
				t.Fatalf("local evidence review contacted Spotify: %v", calls)
			}
		})
	}
}

const playbackFixtureVIN = "SYNTHETIC-MEDIA-VIN"

func (j *trackJourney) playbackPipeline() *normalize.Pipeline {
	j.t.Helper()
	j.exec(`TRUNCATE signal_log;
		ALTER TABLE vehicles ADD COLUMN vin text, ADD COLUMN tesla_id bigint NOT NULL DEFAULT 99,
		ADD COLUMN model text NOT NULL DEFAULT 'Synthetic', ADD COLUMN trim_level text NOT NULL DEFAULT '',
		ADD COLUMN color text NOT NULL DEFAULT '', ADD COLUMN timezone text NOT NULL DEFAULT 'UTC',
		ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
		ALTER TABLE signal_log ADD COLUMN value_kind smallint NOT NULL, ADD COLUMN bool_value boolean,
		ADD COLUMN time_value timestamptz, ADD COLUMN normalization_version smallint,
		ADD COLUMN normalization_write_token boolean, ADD COLUMN ingest_origin text, ADD COLUMN provenance_write_token boolean;
		CREATE TABLE media_snapshots (vehicle_id bigint NOT NULL, ts timestamptz NOT NULL,
			track_name text, artist text, source text, play_status text, duration_s double precision, elapsed_s double precision,
			PRIMARY KEY(vehicle_id,ts));`)
	j.exec(`UPDATE vehicles SET vin=$1 WHERE id=7`, playbackFixtureVIN)
	p := j.db.Pool
	r, err := router.New(map[router.Destination]router.Writer{
		router.DestPositions:         writers.NewPositionsWriter(p),
		router.DestClimateSnapshot:   writers.NewClimateWriter(p),
		router.DestMotorSnapshot:     writers.NewMotorWriter(p),
		router.DestTirePressure:      writers.NewTirePressureWriter(p),
		router.DestMediaSnapshot:     writers.NewMediaWriter(p),
		router.DestSafetySnapshot:    writers.NewSafetyWriter(p),
		router.DestLocationSnapshot:  writers.NewLocationWriter(p),
		router.DestSecurityEvent:     writers.NewSecurityEventWriter(p),
		router.DestChargingTelemetry: writers.NewChargingTelemetryWriter(p),
		router.DestDriveTelemetry:    writers.NewDriveTelemetryWriter(p),
		router.DestSignalLog:         writers.NewSignalLogWriter(p),
		router.DestUnitHistory:       writers.NewUnitHistoryWriter(),
	})
	if err != nil {
		j.t.Fatal(err)
	}
	client, enc := newSpotifyFixtureClient(j.t, j.provider)
	repo, now := mediadb.NewRepository(j.db), func() time.Time { return j.now }
	pipeline := normalize.New(unithistory.NewRepo(p, nil), r, zerolog.Nop())
	webhook := telemetry.NewHandler(j.db, nil, nil, 0, nil)
	webhook.SetPipeline(pipeline)
	j.t.Cleanup(webhook.Shutdown)
	mux := chi.NewRouter()
	mux.Route("/api/v1", func(r chi.Router) {
		mediahandler.NewHandler(smartmediasvc.NewReviews(repo, client, enc, now), smartmediasvc.NewSoundtracks(repo, now),
			smartmediasvc.NewTrackReviews(repo, client, enc, now), nil, "X-Test-Subject").MountRoutes(r)
		r.Post("/telemetry/", webhook.TelemetryIngest)
	})
	j.router = mux
	return pipeline
}

func (j *trackJourney) alignPlaybackToHTTPReceipt() {
	j.t.Helper()
	at := j.driveStart.Add(time.Minute)
	between := at.Add(j.firstProgressAt.Sub(at) / 2)
	shift := time.Now().UTC().Truncate(time.Second).Add(-5 * time.Second).Sub(between)
	j.start, j.end, j.now = j.start.Add(shift), j.end.Add(shift), j.now.Add(shift)
	j.driveStart, j.driveEnd = j.driveStart.Add(shift), j.driveEnd.Add(shift)
	j.firstProgressAt = j.firstProgressAt.Add(shift)
	j.exec(`UPDATE journey_sessions SET started_at=$1,ended_at=$2,updated_at=$2`, j.start, j.end)
	j.exec(`UPDATE drives SET started_at=$1,ended_at=$2 WHERE id=412`, j.driveStart, j.driveEnd)
}

func (j *trackJourney) ingestPlaybackWebhook(at time.Time, envelope, field, value string) {
	j.t.Helper()
	stamp := at.Format(time.RFC3339)
	var wire string
	if envelope == "signals" {
		wire = fmt.Sprintf(`{"vin":%q,"signals":[{"name":%q,"value":%s,"timestamp":%q}]}`, playbackFixtureVIN, field, value, stamp)
	} else {
		wire = fmt.Sprintf(`{"vin":%q,"created_at":%q,"data":{%q:%s}}`, playbackFixtureVIN, stamp, field, value)
	}
	rec := j.request(http.MethodPost, "/api/v1/telemetry/", "", "", json.RawMessage(wire))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"accepted"`) {
		j.t.Fatalf("production HTTP telemetry rejected synthetic observation: %d %s", rec.Code, rec.Body)
	}
}

func (j *trackJourney) ingestPlaybackJSON(pipeline *normalize.Pipeline, at time.Time, field, value string) {
	j.t.Helper()
	received := at.Add(time.Second)
	wire := fmt.Appendf(nil, `{"value":%s,"ts":%q}`, value, at.Format(time.RFC3339))
	atoms, err := codec.DecodeJSONField(field, wire, playbackFixtureVIN, received)
	if err != nil {
		j.t.Fatal(err)
	}
	if err := pipeline.ProcessAtomics(j.t.Context(), codec.StampTransport(atoms, codec.IngestOriginFleetTelemetryMQTT, received), 7); err != nil {
		j.t.Fatal(err)
	}
}

func TestDriveTrackDoesNotReplayProviderOutcomes(t *testing.T) {
	for _, tt := range []struct {
		name       string
		status     int
		outcome    media.TrackSaveStatus
		disconnect bool
	}{
		{"rejected", http.StatusForbidden, media.TrackRejected, false},
		{"unknown", http.StatusBadGateway, media.TrackUnknown, false},
		{"revoked before claim", 0, media.TrackReview, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			j := newTrackJourney(t)
			j.lookup(0, trackOffset, true, http.StatusNoContent)
			got := j.readTrack(mediaOwner, "observed")
			j.completeLibrary(j.beginLibrary(got.ID), mediaOwner, true, true)
			j.provider.mu.Lock()
			j.provider.libraryStatus = tt.status
			if tt.disconnect {
				j.provider.onTrack = func() {
					rec := j.request(http.MethodDelete, libraryPath(got.ID, ""), mediaOwner, mediaOwner, nil)
					if rec.Code != http.StatusNoContent {
						t.Errorf("disconnect during metadata verification: %d", rec.Code)
					}
				}
			}
			j.provider.mu.Unlock()
			save := libraryPath(got.ID, "/save")
			status, writes := http.StatusOK, 1
			if tt.disconnect {
				status, writes = http.StatusConflict, 0
			}
			j.check(http.MethodPost, save, mediaOwner, trackSave(got, mediaFirst), status)
			final := j.readTrack(mediaOwner, "observed")
			if final.Status != tt.outcome || final.LibraryConnected {
				t.Fatalf("incorrect final outcome/authorization: %+v", final)
			}
			j.check(http.MethodPost, save, mediaOwner, trackSave(got, mediaFirst), http.StatusConflict)
			countLibraryWrites(t, j.provider, writes)
		})
	}
}

func countLibraryWrites(t *testing.T, provider *spotifyFixture, want int) {
	t.Helper()
	calls := provider.paths()
	writes := 0
	for _, call := range calls {
		switch {
		case call == "PUT /v1/me/library":
			writes++
		case call == "POST /api/token", strings.HasPrefix(call, "GET /v1/tracks/"):
		default:
			t.Fatalf("unexpected provider call %q", call)
		}
	}
	if writes != want {
		t.Fatalf("library writes = %d, want %d; calls: %v", writes, want, calls)
	}
}
