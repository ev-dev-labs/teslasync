package smartreadiness_test

import (
	"net/http"
	"os"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/auth"
	centerdb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
	centerhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
	"github.com/go-chi/chi/v5"
)

func TestHEREIncidentBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_INCIDENT_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_INCIDENT_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_READINESS_TEST_DSN") == "" && os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
	const header, operator = "X-Test-Subject", "synthetic-incident-operator"
	for _, layout := range []string{"desktop light", "mobile dark"} {
		t.Run(layout, func(t *testing.T) {
			_, db := testRepository(t)
			applyWarrantyFixtureMigration(t, db, "000223_action_center_state.up")
			ctx := t.Context()
			operators := auth.NewOperatorAccess(header, operator)
			recipient := operators.IncidentRecipient(operator)
			health := dbobs.NewEstimateHealth(db, recipient)
			attempt, err := health.BeginEstimate(ctx, port.HEREFlow)
			if err != nil {
				t.Fatal(err)
			}
			if err := health.FinishEstimate(ctx, port.HEREFlow, attempt, false); err != nil {
				t.Fatal(err)
			}
			handler := centerhandler.NewHandler(actioncentersvc.New(emptySources{}, centerdb.NewStateRepository(db),
				actioncentersvc.WithOperatorIncidentNotices(centerdb.NewSourceRepository(db), recipient)), header)
			router := chi.NewRouter()
			router.Get("/api/v1/action-center", handler.List)
			router.Get("/api/v1/action-center/{recommendationID}/history", handler.History)
			router.Post("/api/v1/action-center/{recommendationID}/actions", handler.ApplyAction)
			recover := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				ctx := r.Context()
				if _, err := db.Pool.Exec(ctx, `
					UPDATE here_estimate_health SET next_probe_at = CLOCK_TIMESTAMP() WHERE feed = 'here_flow'`); err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
				attempt, err := health.BeginEstimate(ctx, port.HEREFlow)
				if err == nil {
					err = health.FinishEstimate(ctx, port.HEREFlow, attempt, true)
				}
				if err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
				w.WriteHeader(http.StatusNoContent)
			})
			runPrivatePlanningBrowser(t, router, "/__fixture/here-recovery", recover,
				"estimate-incident.real.smoke.spec.ts", "SMART_INCIDENT_REAL_BACKEND=1", []string{"--grep", layout})
		})
	}
}
