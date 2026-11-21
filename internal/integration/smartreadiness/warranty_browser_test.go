package smartreadiness_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc"
	ownershipdb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
)

func TestPrivateWarrantyBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_WARRANTY_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_WARRANTY_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_READINESS_TEST_DSN") == "" && os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
	_, db := testRepository(t)
	now := time.Now().UTC().Truncate(time.Second)
	clock := func() time.Time { return now }
	seedWarrantyEvidence(t, db, now)
	repo := ownershipdb.NewDurableRepository(db)
	reminders := ownershipintelsvc.NewWarrantyReminders(repo, clock)
	router := warrantyTestRouter(db, repo, reminders, "X-Test-Subject", clock)
	runPrivatePlanningBrowser(t, router, "/__fixture/warranty-tick", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		batch, err := reminders.ProcessDue(r.Context(), 20)
		if err != nil || batch.Outcomes[domain.WarrantyEligible] != 1 || batch.Published != 1 {
			t.Errorf("synthetic mileage check: %+v, %v", batch, err)
			http.Error(w, "mileage check failed", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}), "smart-warranty.smoke.spec.ts", "SMART_WARRANTY_REAL_BACKEND=1", nil)
}

func runPrivatePlanningBrowser(t *testing.T, router http.Handler, tickPath string, tick http.Handler, spec, fixtureEnv string, args []string) {
	t.Helper()
	webRoot, err := filepath.Abs(filepath.Join("..", "..", "..", "web"))
	if err != nil {
		t.Fatal(err)
	}
	distRoot := filepath.Join(webRoot, "dist")
	if exact := os.Getenv("TESLASYNC_SMART_PLANNING_BROWSER_DIST"); exact != "" {
		distRoot = exact
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
		case strings.HasPrefix(r.URL.Path, "/api/v1/"):
			router.ServeHTTP(w, r)
		default:
			relative := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
			file := filepath.Join(distRoot, filepath.FromSlash(relative))
			if info, err := os.Stat(file); err == nil && !info.IsDir() {
				static.ServeHTTP(w, r)
				return
			}
			http.ServeFile(w, r, index)
		}
	}))
	defer server.Close()

	cmdArgs := privatePlanningBrowserArgs(spec, filepath.Join(t.TempDir(), "browser-results"))
	cmd := exec.CommandContext(t.Context(), "node", append(cmdArgs, args...)...)
	cmd.Dir = webRoot
	cmd.Env = append(os.Environ(),
		"E2E_BASE_URL="+server.URL, "E2E_SENSITIVE=1", fixtureEnv, "CI=1",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%s browser journey failed: %v\n%s", spec, err, out)
	}

	t.Logf("%s browser journey:\n%s", spec, out)
}

func privatePlanningBrowserArgs(spec, outputDir string) []string {
	args := []string{
		filepath.Join("node_modules", "@playwright", "test", "cli.js"), "test",
		filepath.ToSlash(filepath.Join("e2e", spec)), "--project=chromium-smoke",
		"--workers=1", "--retries=0", "--reporter=line", "--output=" + outputDir,
	}
	if os.Getenv("TESLASYNC_SMART_BROWSER_HEADED") == "1" {
		args = append(args, "--headed")
	}
	return args
}
