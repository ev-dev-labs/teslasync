package smartreadiness_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPrivatePlaylistBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_MEDIA_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_MEDIA_BROWSER=1 to run the real-handler browser journey")
	}
	j := newPlaylistJourney(t)
	j.seed("Spotify", true)
	runPrivateMediaBrowser(t, j.router, "synthetic-playlist", "smart-private-playlist.smoke.spec.ts", "SMART_MEDIA_REAL_BACKEND")
	one := []string{
		"POST /api/token", "GET /v1/tracks/" + mediaFirst, "GET /v1/tracks/" + mediaSecond,
		"POST /v1/me/playlists", "POST /v1/playlists/" + mediaPlaylist + "/items",
	}
	if got := j.provider.paths(); !slices.Equal(got, append(slices.Clone(one), one...)) {
		t.Fatalf("unexpected external calls (one scoped grant and one ordered save per browser): %v", got)
	}
	j.provider.mu.Lock()
	got := slices.Clone(j.provider.saved)
	j.provider.mu.Unlock()
	if want := []string{"spotify:track:" + mediaFirst, "spotify:track:" + mediaSecond}; !slices.Equal(got, want) {
		t.Fatalf("provider did not receive the order chosen before authorization: %v", got)
	}
}

func TestJourneySoundtrackBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_MEDIA_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_MEDIA_BROWSER=1 to run the real-handler browser journey")
	}
	j := newSoundtrackJourney(t)
	runPrivateMediaBrowser(t, j.router, "synthetic-soundtrack", "smart-journey-soundtrack.smoke.spec.ts", "SMART_SOUNDTRACK_REAL_BACKEND")
}

func TestDriveTrackBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_MEDIA_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_MEDIA_BROWSER=1 to run the real-handler browser journey")
	}
	j := newTrackJourney(t)
	runPrivateMediaBrowser(t, j.router, "synthetic-drive-track", "smart-drive-track.smoke.spec.ts", "SMART_DRIVE_TRACK_REAL_BACKEND")
	one := []string{"POST /api/token", "GET /v1/tracks/" + mediaFirst, "PUT /v1/me/library"}
	if got := j.provider.paths(); !slices.Equal(got, append(slices.Clone(one), one...)) {
		t.Fatalf("want exactly one scoped exchange, track check and explicit library write per browser: %v", got)
	}
}

func TestEpisodeReviewBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_MEDIA_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_MEDIA_BROWSER=1 to run the real-handler browser journey")
	}
	j, fixture := newEpisodeJourney(t)
	runPrivateMediaBrowser(t, j.router, "synthetic-episode", "smart-episode-review.smoke.spec.ts", "SMART_EPISODE_REAL_BACKEND")
	one := []string{"POST /api/token", "GET /v1/episodes/" + mediaFirst}
	if got := fixture.paths(); !slices.Equal(got, append(slices.Clone(one), one...)) {
		t.Fatalf("want exactly one scoped exchange and episode read per browser, with no playback: %v", got)
	}
}

func runPrivateMediaBrowser(t *testing.T, router http.Handler, subjectPrefix, spec, envFlag string) {
	t.Helper()
	runPrivateMediaBrowserWithWorker(t, router, subjectPrefix, spec, envFlag, "", nil)
}

func TestFavoriteDigestBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_MEDIA_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_MEDIA_BROWSER=1 to run the real-handler browser journey")
	}
	j, worker := newFavoriteJourney(t, "Spotify")
	var gate sync.Mutex
	router := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gate.Lock()
		defer gate.Unlock()
		j.router.ServeHTTP(w, r)
	})
	tick := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gate.Lock()
		defer gate.Unlock()
		if r.URL.Query().Get("phase") == "setup" {
			j.now = time.Date(2026, 11, 20, 17, 15, 0, 0, time.UTC)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		j.now = time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC)
		batch, err := worker.ProcessDue(r.Context(), 4)
		if err != nil || batch.Published != 1 {
			t.Errorf("synthetic weekly worker did not publish exactly one eligible digest: %+v %v", batch, err)
			http.Error(w, "unexpected worker result", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	runPrivateMediaBrowserWithWorker(t, router, "synthetic-favorites", "smart-favorite-digest.smoke.spec.ts", "SMART_FAVORITE_REAL_BACKEND", "/__fixture/favorite-digest", tick)
}

func runPrivateMediaBrowserWithWorker(t *testing.T, router http.Handler, subjectPrefix, spec, envFlag, tickPath string, tick http.Handler) {
	t.Helper()
	webRoot, err := filepath.Abs(filepath.Join("..", "..", "..", "web"))
	if err != nil {
		t.Fatal(err)
	}
	distRoot := os.Getenv("TESLASYNC_SMART_MEDIA_BROWSER_DIST")
	if distRoot == "" {
		distRoot = filepath.Join(webRoot, "dist")
	}
	index := filepath.Join(distRoot, "index.html")
	if _, err := os.Stat(index); err != nil {
		t.Fatalf("build the frontend before running the browser journey: %v", err)
	}
	static := http.FileServer(http.Dir(distRoot))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case tick != nil && r.URL.Path == tickPath && r.Method == http.MethodPost:
			tick.ServeHTTP(w, r)
		case r.URL.Path == "/sw.js":
			w.Header().Set("Content-Type", "application/javascript")
			w.WriteHeader(http.StatusOK)
		case strings.HasPrefix(r.URL.Path, "/api/v1/"):
			subject, err := r.Cookie("personal_test_subject")
			if err != nil {
				http.Error(w, "missing synthetic identity", http.StatusUnauthorized)
				return
			}
			switch subject.Value {
			case subjectPrefix + "-desktop":
				r.RemoteAddr = "192.0.2.73:12345"
			case subjectPrefix + "-mobile":
				r.RemoteAddr = "192.0.2.74:12345"
			default:
				http.Error(w, "unknown synthetic identity", http.StatusUnauthorized)
				return
			}
			r.Header.Set("X-Test-Subject", subject.Value)
			router.ServeHTTP(w, r)
		default:
			relative := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
			if info, err := os.Stat(filepath.Join(distRoot, filepath.FromSlash(relative))); err == nil && !info.IsDir() {
				static.ServeHTTP(w, r)
				return
			}
			http.ServeFile(w, r, index)
		}
	}))
	defer server.Close()

	cmd := exec.CommandContext(t.Context(), "node", filepath.Join("node_modules", "@playwright", "test", "cli.js"), "test",
		filepath.ToSlash(filepath.Join("e2e", spec)), "--project=chromium-smoke",
		"--workers=1", "--retries=0", "--reporter=line", "--output="+filepath.Join(t.TempDir(), "browser-results"))
	cmd.Dir = webRoot
	cmd.Env = append(os.Environ(), "E2E_BASE_URL="+server.URL, "E2E_SENSITIVE=1", envFlag+"=1", "CI=1")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real private media browser journey failed: %v\n%s", err, output)
	}
	t.Logf("real private media browser journey:\n%s", output)
}
