package smartreadiness_test

import (
	"context"
	"html"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	actiondb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
	actionhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	deliveryhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartdelivery"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	readinessport "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/go-chi/chi/v5"
)

func TestPrivatePersonalDeliveryBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_CHARGING_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_CHARGING_BROWSER=1 to run the real-handler browser journey")
	}
	j := newChargingDeliveryJourney(t, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	j.ctx = ctx
	j.advance(time.Now().UTC())
	createPublicFeeEvidenceTables(t, j.db)
	applySolarMigration(t, j.db, "up")
	enc, err := crypto.New("synthetic-solar-browser-encryption-key")
	if err != nil {
		t.Fatal(err)
	}
	solarConnections := smartreadinesssvc.NewSolarEnergyConnections(
		readinessdb.NewSolarEnergyConnectionRepository(j.db, enc), solarBrowserAuthorization{},
	)
	solarRepo := readinessdb.NewRepository(j.db)
	solarProvider := &solarTestProvider{now: func() time.Time { return j.now }}
	solarReadiness := smartreadinesssvc.New(solarRepo, j.live, controlledSite{}, smartreadinesssvc.WithSolarCharging(solarRepo, solarProvider),
		smartreadinesssvc.WithClock(func() time.Time { return j.now }))
	if _, err := j.db.Pool.Exec(ctx, `UPDATE geofences SET updated_at = '2026-01-01T00:00:00Z' WHERE id = 9`); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000223_action_center_state.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := j.db.Pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	actionService := actioncentersvc.New(
		emptySources{}, actiondb.NewStateRepository(j.db), actioncentersvc.WithSmartCharging(j.readiness),
		actioncentersvc.WithSolarCharging(solarReadiness),
		actioncentersvc.WithClock(func() time.Time { return j.now }),
	)
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(j.readiness, "X-Test-Subject",
			readinesshandler.WithSolarCharging(solarReadiness, solarConnections)).MountRoutes(r)
		deliveryhandler.NewHandler(j.delivery, "X-Test-Subject").MountRoutes(r)
		r.Get("/action-center", actionhandler.NewHandler(actionService, "X-Test-Subject").List)
	})

	webRoot, err := filepath.Abs(filepath.Join("..", "..", "..", "web"))
	if err != nil {
		t.Fatal(err)
	}
	distRoot := filepath.Join(webRoot, "dist")
	if os.Getenv("TESLASYNC_BROWSER_E2E_DIST") == "1" {
		distRoot = filepath.Join(webRoot, "e2e", ".app-dist")
	}
	index := filepath.Join(distRoot, "index.html")
	if _, err := os.Stat(index); err != nil {
		t.Fatalf("build the frontend before running the browser journey: %v", err)
	}
	static := http.FileServer(http.Dir(distRoot))
	var fixtureMu sync.Mutex
	var solarStart time.Time
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/sw.js":
			// Prevent the root PWA worker from intercepting mocked app reads.
			// The separate personal-delivery worker is served unchanged.
			w.Header().Set("Content-Type", "application/javascript")
			w.WriteHeader(http.StatusOK)
			return
		case r.URL.Path == "/__fixture/latest-push" && r.Method == http.MethodGet:
			_, payload := j.sender.last()
			if len(payload) == 0 {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(payload)
			return
		case r.URL.Path == "/__fixture/process" && r.Method == http.MethodPost:
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			j.advance(time.Now().UTC())
			j.live.setChargeState("Disconnected")
			if _, err := j.readiness.ProcessDue(r.Context(), 50); err != nil {
				http.Error(w, "fixture processing failed", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		case r.URL.Path == "/__fixture/process-public-fee" && r.Method == http.MethodPost:
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			completed := time.Now().UTC().Truncate(time.Microsecond)
			if _, err := j.db.Pool.Exec(r.Context(), `
				INSERT INTO charging_sessions
				SELECT 51, 7, 9, confirmed_at + INTERVAL '1 microsecond',
				  GREATEST($1::timestamptz, confirmed_at + INTERVAL '2 milliseconds')
				FROM smart_public_charging_fee_terms WHERE subject = 'synthetic-personal-a-public-fee'`,
				completed); err != nil {
				http.Error(w, "fixture session failed", http.StatusInternalServerError)
				return
			}
			if _, err := j.db.Pool.Exec(r.Context(), `
				INSERT INTO signal_log (ts, vehicle_id, field, value_kind, int_value)
				SELECT started_at, 7, 'DetailedChargeState', $1::smallint, $2::bigint FROM charging_sessions WHERE id = 51
				UNION ALL
				SELECT ended_at, 7, 'DetailedChargeState', $1::smallint, $3::bigint FROM charging_sessions WHERE id = 51`,
				protomodel.ValueKindEnum, protomodel.DetailedChargeStateValue_DetailedChargeStateCharging,
				protomodel.DetailedChargeStateValue_DetailedChargeStateComplete); err != nil {
				http.Error(w, "fixture transition failed", http.StatusInternalServerError)
				return
			}
			j.advance(completed.Add(10 * time.Millisecond))
			j.live.setChargeState("Complete")
			if count, err := j.readiness.ProcessPublicFees(r.Context(), 25, j.delivery.NotifyPublicFee); err != nil || count != 1 {
				http.Error(w, "fixture fee processing failed", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		case r.URL.Path == "/__fixture/solar-authorize" && r.Method == http.MethodGet:
			query := url.Values{"state": {r.URL.Query().Get("state")}, "code": {"synthetic-solar-code"}}
			callback := html.EscapeString(tesla.EnergyReadOAuthCallback + "?" + query.Encode())
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			_, _ = io.WriteString(w, `<!doctype html><title>Synthetic Tesla Energy consent</title><a href="`+
				callback+`">Allow read-only access</a>`)
			return
		case r.URL.Path == "/__fixture/solar-clock" && r.Method == http.MethodPost:
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			solarStart = time.Now().UTC().Add(-3*time.Minute - time.Second)
			j.advance(solarStart)
			j.live.setChargeState("Stopped")
			j.live.mu.Lock()
			j.live.values["ChargeLimitSoc"] = &signal.Value{Raw: 80.0, Timestamp: j.now}
			j.live.mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
			return
		case r.URL.Path == "/__fixture/process-solar" && r.Method == http.MethodPost:
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			for i := range 4 {
				j.advance(solarStart.Add(time.Duration(i) * time.Minute))
				if count, err := solarReadiness.ProcessSolarCharging(r.Context(), 4); err != nil || count != 1 {
					http.Error(w, "fixture solar processing failed", http.StatusInternalServerError)
					return
				}
			}
			w.WriteHeader(http.StatusNoContent)
			return
		case strings.HasPrefix(r.URL.Path, "/api/v1/"):
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			cookie, cookieErr := r.Cookie("personal_test_subject")
			// Each independent browser journey has its own client address.
			// Its owner and foreign-subject attempts still share one rate limit.
			clientAddresses := map[string]string{
				"synthetic-personal-a-desktop": "192.0.2.10:12345", "synthetic-personal-b-desktop": "192.0.2.10:12345",
				"synthetic-personal-a-mobile": "192.0.2.11:12345", "synthetic-personal-b-mobile": "192.0.2.11:12345",
				"synthetic-personal-a-public-fee": "192.0.2.12:12345", "synthetic-personal-b-public-fee": "192.0.2.12:12345",
				"synthetic-personal-a-solar": "192.0.2.13:12345", "synthetic-personal-b-solar": "192.0.2.13:12345",
			}

			if cookieErr != nil || clientAddresses[cookie.Value] == "" {
				http.Error(w, "missing synthetic identity", http.StatusUnauthorized)
				return
			}
			r.RemoteAddr = clientAddresses[cookie.Value]
			r.Header.Set("X-Test-Subject", cookie.Value)
			router.ServeHTTP(w, r)
			return
		}
		relative := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		file := filepath.Join(distRoot, filepath.FromSlash(relative))
		if info, statErr := os.Stat(file); statErr == nil && !info.IsDir() {
			static.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, index)
	}))
	defer server.Close()

	cmd := exec.CommandContext(ctx, "node",
		filepath.Join("node_modules", "@playwright", "test", "cli.js"), "test",
		filepath.Join("e2e", "personal-delivery.real.smoke.spec.ts"),
		"--project=chromium-smoke", "--workers=1", "--retries=0", "--reporter=line", "--headed",
		"--output="+filepath.Join(os.TempDir(), "teslasync-personal-delivery-browser-results"),
	)
	cmd.Dir = webRoot
	cmd.Env = append(os.Environ(),
		"E2E_BASE_URL="+server.URL,
		"E2E_SENSITIVE=1",
		"SMART_PERSONAL_REAL_BACKEND=1",
		"CI=1",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("personal delivery browser journey failed: %v\n%s", err, output)
	}
	t.Logf("personal delivery browser journey:\n%s", output)
}

type solarBrowserAuthorization struct{}

func (solarBrowserAuthorization) EnergyReadAuthURL(state string) (string, error) {
	return "/__fixture/solar-authorize?state=" + url.QueryEscape(state), nil
}

func (solarBrowserAuthorization) ExchangeEnergyAuthorization(_ context.Context, code string) (readinessport.SolarEnergyTokens, error) {
	if code != "synthetic-solar-code" {
		return readinessport.SolarEnergyTokens{}, readinessport.ErrNotFound
	}
	return testEnergyTokens(time.Now().Add(time.Hour)), nil
}

func (solarBrowserAuthorization) RefreshEnergyAuthorization(context.Context, string) (readinessport.SolarEnergyTokens, error) {
	return readinessport.SolarEnergyTokens{}, readinessport.ErrNotFound
}

func (solarBrowserAuthorization) CheckEnergySiteAccess(_ context.Context, siteID int64, token string) error {
	if siteID != 44 || token != "synthetic-energy-access" {
		return readinessport.ErrNotFound
	}
	return nil
}
