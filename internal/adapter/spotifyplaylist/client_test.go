package spotifyplaylist

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
)

const (
	testClientID = "00000000000000000000000000000000"
	testCallback = "https://synthetic.invalid/api/v1/media/spotify/callback"
	firstTrack   = "AAAAAAAAAAAAAAAAAAAAAA"
	secondTrack  = "BBBBBBBBBBBBBBBBBBBBBB"
	playlist     = "PPPPPPPPPPPPPPPPPPPPPP"
)

func syntheticClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	client, err := New(testClientID, testCallback)
	if err != nil {
		t.Fatal(err)
	}
	client.api, client.accounts = server.URL, server.URL
	return client
}

func TestSpotifyPlaylistCurrentWireContract(t *testing.T) {
	verifier := strings.Repeat("x", 43)
	var seen []string
	client := syntheticClient(t, func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path)
		if r.URL.RawQuery != "" {
			t.Error("API requests must not put selected tracks or credentials in query parameters")
		}
		if r.URL.Path != "/api/token" && r.Header.Get("Authorization") != "Bearer synthetic-grant" {
			t.Error("expected the authorized user's access token")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/token":
			if err := r.ParseForm(); err != nil || !reflect.DeepEqual(r.Form, url.Values{
				"grant_type": {"authorization_code"}, "redirect_uri": {testCallback},
				"client_id": {testClientID}, "code": {"synthetic-code"}, "code_verifier": {verifier},
			}) {
				t.Error("code exchange must send only the official PKCE fields")
			}
			fmt.Fprint(w, `{"access_token":"synthetic-grant","token_type":"Bearer","expires_in":3600,"scope":"playlist-modify-private","refresh_token":"discard-me"}`)
		case "/v1/tracks/" + firstTrack:
			fmt.Fprintf(w, `{"id":%q,"name":"Synthetic opener","duration_ms":181100,"artists":[{"name":"Synthetic ensemble"}]}`, firstTrack)
		case "/v1/me/playlists":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !reflect.DeepEqual(body, map[string]any{
				"name": "Drive mix", "public": false, "collaborative": false,
			}) {
				t.Error("create must be private/non-collaborative, without drive or user metadata")
			}
			w.WriteHeader(http.StatusCreated)
			fmt.Fprintf(w, `{"id":%q,"public":false}`, playlist)
		case "/v1/playlists/" + playlist + "/items":
			var body map[string][]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !reflect.DeepEqual(body, map[string][]string{
				"uris": {"spotify:track:" + firstTrack, "spotify:track:" + secondTrack},
			}) {
				t.Error("add must send only the exact, ordered Spotify items")
			}
			w.WriteHeader(http.StatusCreated)
			fmt.Fprint(w, `{"snapshot_id":"synthetic-snapshot"}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	auth, err := url.Parse(client.AuthorizationURL("synthetic-state", "synthetic-challenge"))
	if err != nil || auth.Path != "/authorize" || !reflect.DeepEqual(auth.Query(), url.Values{
		"client_id": {testClientID}, "redirect_uri": {testCallback}, "response_type": {"code"}, "state": {"synthetic-state"},
		"scope": {"playlist-modify-private"}, "code_challenge": {"synthetic-challenge"}, "code_challenge_method": {"S256"},
	}) {
		t.Fatal("expected scoped Spotify authorization with S256 and state")
	}
	grant, err := client.Exchange(t.Context(), "synthetic-code", verifier)
	if err != nil || grant.AccessToken != "synthetic-grant" || grant.ExpiresIn != time.Hour {
		t.Fatalf("exchange synthetic PKCE grant: %v", err)
	}
	track, err := client.Track(t.Context(), grant.AccessToken, firstTrack)
	if err != nil || track.DurationS != 182 || track.Title != "Synthetic opener" {
		t.Fatalf("read catalog track and convert vendor unit: %+v, %v", track, err)
	}
	id, err := client.CreatePrivate(t.Context(), grant.AccessToken, "Drive mix")
	if err != nil || id != playlist {
		t.Fatalf("create private playlist: %q, %v", id, err)
	}
	if err := client.AddTracks(t.Context(), grant.AccessToken, id, []string{firstTrack, secondTrack}); err != nil {
		t.Fatal(err)
	}
	want := []string{"POST /api/token", "GET /v1/tracks/" + firstTrack, "POST /v1/me/playlists", "POST /v1/playlists/" + playlist + "/items"}
	if !reflect.DeepEqual(seen, want) {
		t.Fatalf("unexpected or repeated provider calls: %v", seen)
	}
}

func TestSpotifyPlaylistRejectsAmbiguousSuccessWithoutRetrying(t *testing.T) {
	for _, tt := range []struct {
		name    string
		status  int
		body    string
		unknown bool
	}{
		{"provider rejected", 403, `{"error":"private text"}`, false},
		{"server failure", 502, `{"error":"private text"}`, true},
		{"privacy missing", 201, fmt.Sprintf(`{"id":%q}`, playlist), true},
		{"provider claims public", 201, fmt.Sprintf(`{"id":%q,"public":true}`, playlist), true},
		{"unexpected 200", 200, fmt.Sprintf(`{"id":%q,"public":false}`, playlist), true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			requests := 0
			client := syntheticClient(t, func(w http.ResponseWriter, _ *http.Request) {
				requests++
				w.WriteHeader(tt.status)
				fmt.Fprint(w, tt.body)
			})
			id, err := client.CreatePrivate(t.Context(), "synthetic-grant", "Drive mix")
			var failure *domain.SpotifyFailure
			if id != "" || !errors.As(err, &failure) || failure.Unknown != tt.unknown ||
				strings.Contains(err.Error(), "private text") || requests != 1 {
				t.Fatalf("incorrect no-replay classification, id=%q err=%v requests=%d", id, err, requests)
			}
		})
	}
}

func TestSpotifyLibraryTrackUsesSeparateGrantAndDocumentedEmptyResponse(t *testing.T) {
	for _, tt := range []struct {
		name        string
		scope       string
		status      int
		wantUnknown bool
	}{
		{"saved", LibraryTrackScope, http.StatusOK, false},
		{"playlist grant is insufficient", PlaylistScope, 0, false},
		{"combined grant is rejected", LibraryTrackScope + " " + PlaylistScope, 0, false},
		{"provider rejection", LibraryTrackScope, http.StatusForbidden, false},
		{"uncertain server result", LibraryTrackScope, http.StatusBadGateway, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var writes atomic.Int32
			client := syntheticClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/token" {
					fmt.Fprintf(w, `{"access_token":"synthetic-grant","token_type":"Bearer","expires_in":3600,"scope":%q,"refresh_token":"discard-me"}`, tt.scope)
					return
				}
				writes.Add(1)
				if r.Method != http.MethodPut || r.URL.Path != "/v1/me/library" ||
					!reflect.DeepEqual(r.URL.Query(), url.Values{"uris": {"spotify:track:" + firstTrack}}) ||
					r.ContentLength != 0 || r.Header.Get("Authorization") != "Bearer synthetic-grant" {
					t.Error("only the exact track URI and authorized grant may reach the library save endpoint")
				}
				w.WriteHeader(tt.status)
			})
			u, err := url.Parse(client.LibraryAuthorizationURL("synthetic-state", "synthetic-challenge"))
			if err != nil || u.Query().Get("scope") != LibraryTrackScope || u.Query().Get("code_challenge_method") != "S256" {
				t.Fatal("library write consent must request exactly its own scope")
			}
			grant, err := client.ExchangeLibrary(t.Context(), "synthetic-code", strings.Repeat("x", 43))
			if tt.status == 0 {
				if err == nil || writes.Load() != 0 {
					t.Fatal("must not accept a mismatched scope")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			err = client.SaveLibraryTrack(t.Context(), grant.AccessToken, firstTrack)
			var failure *domain.SpotifyFailure
			if writes.Load() != 1 || (tt.status == http.StatusOK && err != nil) ||
				(tt.status != http.StatusOK && (!errors.As(err, &failure) || failure.Unknown != tt.wantUnknown)) {
				t.Fatalf("want one wire attempt and an evidence-appropriate outcome, writes=%d error=%v", writes.Load(), err)
			}
		})
	}
}
