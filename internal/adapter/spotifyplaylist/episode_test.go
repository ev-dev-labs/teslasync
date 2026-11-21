package spotifyplaylist

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestSpotifyEpisodeUsesOnlyExactEpisodeAndSeparatesMissingProgress(t *testing.T) {
	for _, tt := range []struct {
		name        string
		resume      string
		durationS   int
		positionS   int
		hasPosition bool
	}{
		{"reported position", `,"resume_point":{"fully_played":false,"resume_position_ms":60502}`, 1001, 60, true},
		{"known start", `,"resume_point":{"fully_played":false,"resume_position_ms":0}`, 1001, 0, true},
		{"unknown", "", 1001, 0, false},
		{"missing position", `,"resume_point":{"fully_played":false}`, 1001, 0, false},
		{"invalid position", `,"resume_point":{"fully_played":false,"resume_position_ms":1001002}`, 1001, 0, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			client := syntheticClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/token" && r.Method == http.MethodPost {
					fmt.Fprintf(w, `{"access_token":"synthetic-grant","token_type":"Bearer","expires_in":3600,"scope":%q}`, EpisodeProgressScope)
					return
				}

				if r.Method != http.MethodGet || r.URL.Path != "/v1/episodes/"+firstTrack || r.URL.RawQuery != "" ||
					r.Header.Get("Authorization") != "Bearer synthetic-grant" || r.ContentLength != 0 {
					t.Error("only the chosen episode ID and progress grant may be sent")
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				fmt.Fprintf(w, `{"id":%q,"uri":%q,"type":"episode","name":"Synthetic episode","duration_ms":1000500,"is_playable":true%s}`,
					firstTrack, "spotify:episode:"+firstTrack, tt.resume)
			})
			auth, err := url.Parse(client.EpisodeProgressAuthorizationURL("synthetic-state", "synthetic-challenge"))
			if err != nil || auth.Query().Get("scope") != "user-read-playback-position" {
				t.Fatal("reading episode progress must not authorize playback or library modifications")
			}
			grant, err := client.ExchangeEpisodeProgress(t.Context(), "synthetic-code", strings.Repeat("x", 43))
			if err != nil {
				t.Fatal(err)
			}
			got, err := client.EpisodeProgress(t.Context(), grant.AccessToken, firstTrack)
			if err != nil || got.DurationS != tt.durationS || (got.PositionS != nil) != tt.hasPosition ||
				(tt.hasPosition && (*got.PositionS != tt.positionS || got.Completed == nil || *got.Completed)) ||
				(!tt.hasPosition && got.Completed != nil) {
				t.Fatalf("incorrect provider progress or SI duration: %+v (%v)", got, err)
			}
		})
	}
}

func TestSpotifyEpisodeTraceOmitsSelectedEpisode(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		_ = provider.Shutdown(t.Context())
	})
	client := syntheticClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/episodes/"+firstTrack {
			t.Errorf("unexpected provider path: %q", r.URL.Path)
		}
		fmt.Fprintf(w, `{"id":%q,"uri":%q,"type":"episode","name":"Synthetic episode","duration_ms":1000000,"is_playable":true}`,
			firstTrack, "spotify:episode:"+firstTrack)
	})
	if _, err := client.EpisodeProgress(t.Context(), "synthetic-grant", firstTrack); err != nil {
		t.Fatal(err)
	}
	spans := recorder.Ended()
	if len(spans) != 1 || spans[0].Name() != "spotify.read_episode_progress" {
		t.Fatalf("want only the operation span for the private resource, got %v", spans)
	}
	for _, field := range spans[0].Attributes() {
		if strings.Contains(field.Value.Emit(), firstTrack) || strings.Contains(string(field.Key), "url") {
			t.Fatalf("private episode request attributes were retained: %v", field)
		}
	}
}
