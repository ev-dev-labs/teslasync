package middleware

// Phase-45 / Prompt 5 — Per-route query budget enforcement.
//
// The middleware attaches a per-request query counter to the request
// context. The database tracer increments it on every Query/QueryRow.
// When the request finishes we compare against the route's declared
// budget — if exceeded, a structured WARN is emitted and a Prometheus
// counter incremented so dashboards can flag pages that regress.

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// QueryBudgets maps `<METHOD> <route-pattern>` (chi pattern, e.g.
// `GET /vehicles/{vehicleID}/state`) to the maximum allowed pgx
// queries per request. Missing entries default to defaultBudget so
// the gate is non-blocking until budgets are formally declared.
type QueryBudgets map[string]int

const defaultBudget = 10

var queryBudgetExceeded = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "http_request_query_budget_exceeded_total",
	Help: "Count of HTTP requests that issued more pgx queries than the route budget allows.",
}, []string{"method", "route", "budget"})

// QueryBudget returns a chi middleware that enforces per-route pgx
// query budgets. Pass a budgets map; unknown routes default to
// defaultBudget.
func QueryBudget(budgets QueryBudgets) func(http.Handler) http.Handler {
	if budgets == nil {
		budgets = QueryBudgets{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := database.AttachQueryBudgetCounter(r.Context())
			r = r.WithContext(ctx)

			next.ServeHTTP(w, r)

			count := database.QueryBudgetCount(ctx)
			pattern := chi.RouteContext(r.Context()).RoutePattern()
			if pattern == "" {
				pattern = r.URL.Path
			}
			key := r.Method + " " + pattern
			budget, ok := budgets[key]
			if !ok {
				budget = defaultBudget
			}
			if count > int64(budget) {
				queryBudgetExceeded.WithLabelValues(r.Method, pattern, formatBudget(budget)).Inc()
				log.Warn().
					Str("method", r.Method).
					Str("route", pattern).
					Int64("query_count", count).
					Int("budget", budget).
					Msg("HTTP request exceeded pgx query budget")
			}
		})
	}
}

// formatBudget renders the budget as a label-cardinality-safe string.
// We use the literal budget so dashboards can plot "routes that
// regressed against budget=N".
func formatBudget(n int) string {
	switch {
	case n <= 1:
		return "1"
	case n <= 5:
		return "5"
	case n <= 10:
		return "10"
	case n <= 25:
		return "25"
	case n <= 50:
		return "50"
	default:
		return "50+"
	}
}
