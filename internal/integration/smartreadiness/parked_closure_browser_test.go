package smartreadiness_test

import (
	"encoding/json"
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

func TestParkedClosureBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_CLOSURE_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_CLOSURE_BROWSER=1 to run the real-handler browser journey")
	}
	j := newParkedClosureJourney(t)
	webRoot, err := filepath.Abs(filepath.Join("..", "..", "..", "web"))
	if err != nil {
		t.Fatal(err)
	}
	distRoot := os.Getenv("TESLASYNC_SMART_CLOSURE_BROWSER_DIST")
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
			w.Header().Set("Content-Type", "application/javascript")
			w.WriteHeader(http.StatusOK)
		case r.URL.Path == "/__fixture/parked-closure" && r.Method == http.MethodPost:
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			switch r.URL.Query().Get("phase") {
			case "latest":
				count, payload := j.sender.last()
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(struct {
					Count   int             `json:"count"`
					Payload json.RawMessage `json:"payload"`
				}{count, payload})
				return
			case "setup":
				j.now = j.start
				j.completedPark(j.start.Add(time.Minute))
			case "grace":
				for i := 1; i <= 5; i++ {
					j.emit(j.start.Add(time.Duration(i)*time.Minute), true, false, false)
				}
			case "due":
				j.emit(j.start.Add(6*time.Minute), true, false, false)
			case "closed":
				j.emit(j.start.Add(7*time.Minute), false, false, false)
			default:
				http.NotFound(w, r)
				return
			}
			if err := j.tick(r.Context()); err != nil {
				http.Error(w, fmt.Sprintf("fixture tick: %v", err), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case strings.HasPrefix(r.URL.Path, "/api/v1/"):
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			cookie, cookieErr := r.Cookie("personal_test_subject")
			if cookieErr != nil {
				http.Error(w, "missing synthetic identity", http.StatusUnauthorized)
				return
			}
			switch cookie.Value {
			case "synthetic-closure-desktop", "synthetic-closure-foreign-desktop":
				r.RemoteAddr = "192.0.2.51:12345"
			case "synthetic-closure-mobile", "synthetic-closure-foreign-mobile":
				r.RemoteAddr = "192.0.2.52:12345"
			default:
				http.Error(w, "unknown synthetic identity", http.StatusUnauthorized)
				return
			}
			r.Header.Set("X-Test-Subject", cookie.Value)
			j.router.ServeHTTP(w, r)
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
		privatePlanningBrowserArgs("smart-parked-closure.smoke.spec.ts", filepath.Join(t.TempDir(), "browser-results"))...)
	cmd.Dir = webRoot
	cmd.Env = append(os.Environ(), "E2E_BASE_URL="+server.URL, "E2E_SENSITIVE=1", "SMART_CLOSURE_REAL_BACKEND=1", "CI=1")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real parked closure browser journey failed: %v\n%s", err, output)
	}
	t.Logf("real parked closure browser journey:\n%s", output)
}
