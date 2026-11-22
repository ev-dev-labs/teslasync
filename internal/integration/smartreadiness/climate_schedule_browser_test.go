package smartreadiness_test

import (
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

func TestScheduledClimateReviewBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_CLIMATE_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_CLIMATE_BROWSER=1 to run the mounted browser journey")
	}
	j := newClimateScheduleJourney(t)
	web, err := filepath.Abs(filepath.Join("..", "..", "..", "web"))
	if err != nil {
		t.Fatal(err)
	}
	dist := os.Getenv("TESLASYNC_SMART_CLIMATE_BROWSER_DIST")
	if dist == "" {
		dist = filepath.Join(web, "dist")
	}
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		t.Fatalf("build the frontend before running the browser journey: %v", err)
	}
	static := http.FileServer(http.Dir(dist))
	var fixtureMu sync.Mutex
	seeded := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/__fixture/climate-schedule" && r.Method == http.MethodPost {
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			if r.URL.Query().Get("phase") == "setup" {
				j.now = j.monday.AddDate(0, 0, -15)
				j.exec("DELETE FROM smart_climate_schedule_plans")
				j.exec("DELETE FROM signal_log")
				j.exec("DELETE FROM automation_history")
				seeded = false
				w.WriteHeader(http.StatusNoContent)
				return
			}
			if !seeded {
				for _, offset := range []int{-14, -7, 0} {
					run := j.monday.AddDate(0, 0, offset)
					j.run(run, "success", j.receipt(run))
					j.parkedWindow(run)
				}
				j.now = j.monday.Add(2 * time.Hour)
				j.exec(`INSERT INTO automation_history(automation_id,automation_name,vehicle_id,triggered_at,trigger_type,status)
					VALUES (52,'Foreign cabin',8,$1,'trigger_schedule','success')`, j.monday)
				seeded = true
			}
			if _, err := j.reviews.ProcessDue(r.Context(), 5); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/v1/") {
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			cookie, err := r.Cookie("personal_test_subject")
			if err != nil || (cookie.Value != climateScheduleOwner && cookie.Value != "synthetic-climate-schedule-peer") {
				http.Error(w, "missing synthetic identity", http.StatusUnauthorized)
				return
			}
			r.Header.Set("X-Test-Subject", cookie.Value)
			j.router.ServeHTTP(w, r)
			return
		}
		relative := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if info, err := os.Stat(filepath.Join(dist, filepath.FromSlash(relative))); err == nil && !info.IsDir() {
			static.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(dist, "index.html"))
	}))
	defer server.Close()
	cmd := exec.CommandContext(t.Context(), "node",
		privatePlanningBrowserArgs("smart-climate-schedule.smoke.spec.ts", filepath.Join(t.TempDir(), "browser-results"))...)
	cmd.Dir = web
	cmd.Env = append(os.Environ(), "E2E_BASE_URL="+server.URL, "E2E_SENSITIVE=1", "SMART_CLIMATE_SCHEDULE_REAL_BACKEND=1", "CI=1")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real scheduled climate browser journey failed: %v\n%s", err, output)
	}
	t.Logf("real scheduled climate browser journey:\n%s", output)
}
