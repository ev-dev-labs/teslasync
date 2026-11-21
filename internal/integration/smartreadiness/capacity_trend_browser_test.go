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
	"testing"
	"time"
)

func TestCapacityDigestBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_CAPACITY_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_CAPACITY_BROWSER=1 to run the real-handler browser journey")
	}
	j := newCapacityJourney(t, 69_000)
	webRoot, err := filepath.Abs(filepath.Join("..", "..", "..", "web"))
	if err != nil {
		t.Fatal(err)
	}
	distRoot := os.Getenv("TESLASYNC_SMART_CAPACITY_BROWSER_DIST")
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
		case r.URL.Path == "/__fixture/capacity-digest" && r.Method == http.MethodPost:
			switch r.URL.Query().Get("phase") {
			case "setup":
				j.setClock(j.release.Add(-time.Hour))
			case "due":
				j.setClock(j.release)
				batch, err := j.reviews.ProcessDue(r.Context(), 5)
				if err != nil || batch.Published != 1 {
					http.Error(w, fmt.Sprintf("want one publication: %+v (%v)", batch, err), http.StatusInternalServerError)
					return
				}
			case "expiry":
				j.setClock(j.expiry)
			default:
				http.NotFound(w, r)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case strings.HasPrefix(r.URL.Path, "/api/v1/"):
			cookie, cookieErr := r.Cookie("personal_test_subject")
			if cookieErr != nil {
				http.Error(w, "missing synthetic identity", http.StatusUnauthorized)
				return
			}
			switch cookie.Value {
			case "synthetic-capacity-desktop", "synthetic-capacity-foreign-desktop":
				r.RemoteAddr = "192.0.2.41:12345"
			case "synthetic-capacity-mobile", "synthetic-capacity-foreign-mobile":
				r.RemoteAddr = "192.0.2.42:12345"
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
		privatePlanningBrowserArgs("smart-capacity-digest.smoke.spec.ts", filepath.Join(t.TempDir(), "browser-results"))...)
	cmd.Dir = webRoot
	cmd.Env = append(os.Environ(), "E2E_BASE_URL="+server.URL, "E2E_SENSITIVE=1", "SMART_CAPACITY_REAL_BACKEND=1", "CI=1")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real monthly capacity browser journey failed: %v\n%s", err, output)
	}
	t.Logf("real monthly capacity browser journey:\n%s", output)
}
