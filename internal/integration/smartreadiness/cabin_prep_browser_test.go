package smartreadiness_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCabinPrepBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_CABIN_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_CABIN_BROWSER=1 to run the real-handler browser journey")
	}
	j := newCabinJourney(t, time.Date(2026, 11, 9, 8, 0, 0, 0, time.UTC))
	webRoot, err := filepath.Abs(filepath.Join("..", "..", "..", "web"))
	if err != nil {
		t.Fatal(err)
	}
	distRoot := os.Getenv("TESLASYNC_SMART_CABIN_BROWSER_DIST")
	if distRoot == "" {
		distRoot = filepath.Join(webRoot, "dist")
	}
	index := filepath.Join(distRoot, "index.html")
	if _, err := os.Stat(index); err != nil {
		t.Fatalf("build the frontend before running the browser journey: %v", err)
	}
	static := http.FileServer(http.Dir(distRoot))
	var fixtureMu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/sw.js":
			// Only the personal worker should control fixture requests.
			w.Header().Set("Content-Type", "application/javascript")
			w.WriteHeader(http.StatusOK)
			return
		case r.URL.Path == "/__fixture/cabin" && r.Method == http.MethodPost:
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			switch r.URL.Query().Get("phase") {
			case "setup":
				j.advance(j.departure.Add(-time.Hour))
			case "forecast", "due":
				lead := 37 * time.Minute
				if r.URL.Query().Get("phase") == "due" {
					lead = 13 * time.Minute
				}
				j.advance(j.departure.Add(-lead))
				if _, err := j.plans.ProcessDue(r.Context(), 6); err != nil {
					http.Error(w, fmt.Sprintf("fixture evaluation failed: %v", err), http.StatusInternalServerError)
					return
				}
				if err := j.delivery.DeliverCabinPrep(r.Context(), 6); err != nil {
					http.Error(w, fmt.Sprintf("fixture dispatch failed: %v", err), http.StatusInternalServerError)
					return
				}
			case "expiry":
				j.advance(j.departure.Add(-9 * time.Minute))
			case "latest":
				_, payload := j.sender.last()
				if len(payload) > 0 {
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write(payload)
					return
				}
			default:
				http.NotFound(w, r)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		case strings.HasPrefix(r.URL.Path, "/api/v1/"):
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			cookie, cookieErr := r.Cookie("personal_test_subject")
			if cookieErr != nil {
				http.Error(w, "missing synthetic identity", http.StatusUnauthorized)
				return
			}
			switch cookie.Value {
			case "synthetic-cabin-desktop", "synthetic-cabin-foreign-desktop":
				r.RemoteAddr = "192.0.2.21:12345"
			case "synthetic-cabin-mobile", "synthetic-cabin-foreign-mobile":
				r.RemoteAddr = "192.0.2.22:12345"
			default:
				http.Error(w, "unknown synthetic identity", http.StatusUnauthorized)
				return
			}
			r.Header.Set("X-Test-Subject", cookie.Value)
			j.router.ServeHTTP(w, r)
			return
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

	cmd := exec.CommandContext(t.Context(), "node",
		privatePlanningBrowserArgs("smart-cabin-prep.smoke.spec.ts", filepath.Join(t.TempDir(), "browser-results"))...)
	cmd.Dir = webRoot
	cmd.Env = append(os.Environ(), "E2E_BASE_URL="+server.URL, "E2E_SENSITIVE=1", "SMART_CABIN_REAL_BACKEND=1", "CI=1")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real cabin prep browser journey failed: %v\n%s", err, output)
	}
	t.Logf("real cabin prep browser journey:\n%s", output)
}
