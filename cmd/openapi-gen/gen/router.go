package gen

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	// ADR-007 forbids cmd/* from importing the FROZEN internal/api package
	// (composition root lives in internal/app). This spec generator is a
	// deliberate, reviewed exception (artifact P1/S1-0001): its entire purpose
	// is to introspect the router — the source of truth for the contract — so
	// it must construct it directly with inert stub dependencies. No handler is
	// ever invoked.
	api "github.com/ev-dev-labs/teslasync/internal/api" //nolint:depguard // ADR-003: OpenAPI generator introspects the router by design.
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// stubDSN is a syntactically valid DSN that pgxpool can parse without opening a
// connection. MinConns defaults to 0 so pgxpool.New never dials during spec
// generation — route registration only stores the pool handle, it never queries.
const stubDSN = "postgres://openapi:openapi@127.0.0.1:5432/openapi?sslmode=disable"

// noopStateReader satisfies signal.StateReader without touching a database.
// It is never invoked during route registration; it exists only so NewRouter's
// handler constructors have a non-nil reader to store.
type noopStateReader struct{}

func (noopStateReader) State(context.Context, int64, time.Time) (signal.State, error) {
	return signal.State{}, nil
}

func (noopStateReader) SignalAt(context.Context, int64, string, time.Time) (signal.SignalValue, error) {
	return nil, nil
}

func (noopStateReader) Timeline(context.Context, int64, []signal.FieldMapping, time.Time, time.Time, signal.TimelineOptions) ([]signal.TimelineRow, error) {
	return nil, nil
}

// BuildRouter constructs the production router with inert dependencies so that
// every route registration runs. The returned cleanup closes the stub pool.
//
// The same RouterOptions{} (empty) is used here and by the conformance test, so
// the spec and the test always describe the identical route surface.
func BuildRouter() (http.Handler, func(), error) {
	pool, err := pgxpool.New(context.Background(), stubDSN)
	if err != nil {
		return nil, func() {}, fmt.Errorf("create stub pool: %w", err)
	}
	cleanup := func() { pool.Close() }

	db := &database.DB{Pool: pool}
	cfg := &config.Config{}
	health := resilience.NewHealthMonitor()

	handler := api.NewRouter(db, nil, nil, cfg, health, noopStateReader{})
	return handler, cleanup, nil
}

// Route is a single (method, path) pair registered on the router.
type Route struct {
	Method string
	Path   string
}

// WalkRoutes enumerates every route registered on a chi router, sorted by
// (path, method) for deterministic output.
func WalkRoutes(handler http.Handler) ([]Route, error) {
	routes, ok := handler.(chi.Routes)
	if !ok {
		return nil, fmt.Errorf("handler does not implement chi.Routes (got %T)", handler)
	}
	var out []Route
	err := chi.Walk(routes, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		out = append(out, Route{Method: method, Path: route})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk routes: %w", err)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Path == out[j].Path {
			return out[i].Method < out[j].Method
		}
		return out[i].Path < out[j].Path
	})
	return out, nil
}
