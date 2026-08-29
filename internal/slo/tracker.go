package slo

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	promapi "github.com/prometheus/client_golang/api"
	promv1 "github.com/prometheus/client_golang/api/prometheus/v1"
	prommodel "github.com/prometheus/common/model"
)

// PromQuerier abstracts the Prometheus HTTP query API so unit tests can
// inject a fake (see tracker_test.go) without standing up a real
// Prometheus server.
type PromQuerier interface {
	Query(ctx context.Context, query string, ts time.Time, opts ...promv1.Option) (prommodel.Value, promv1.Warnings, error)
}

// Tracker queries Prometheus for live SLO state. Zero-value safe but
// not useful — construct via NewTracker.
type Tracker struct {
	client    PromQuerier
	now       func() time.Time
	queryTime time.Duration
}

// NewTracker wires a Tracker against the given Prometheus base URL.
//
// When promBaseURL is empty the returned Tracker has a nil client and
// every Snapshot returns ErrPrometheusUnconfigured — the admin handler
// surfaces that as a 503 SUBSYSTEM_NOT_CONFIGURED so the SPA can render
// "Prometheus not wired into this deployment" without crashing.
func NewTracker(promBaseURL string) (*Tracker, error) {
	t := &Tracker{
		now:       time.Now,
		queryTime: 5 * time.Second,
	}
	if promBaseURL == "" {
		return t, nil
	}
	cli, err := promapi.NewClient(promapi.Config{
		Address: promBaseURL,
		Client:  &http.Client{Timeout: 5 * time.Second},
	})
	if err != nil {
		return nil, fmt.Errorf("create prometheus client: %w", err)
	}
	t.client = promv1.NewAPI(cli)
	return t, nil
}

// NewTrackerWithClient lets tests inject a PromQuerier directly.
func NewTrackerWithClient(client PromQuerier, now func() time.Time) *Tracker {
	if now == nil {
		now = time.Now
	}
	return &Tracker{client: client, now: now, queryTime: 5 * time.Second}
}

// ErrPrometheusUnconfigured is returned by Snapshot when the Tracker was
// constructed with an empty base URL (Prometheus not wired).
var ErrPrometheusUnconfigured = errors.New("slo: prometheus base URL not configured")

// BurnRateTier mirrors cmd/slogen's burnTiers — same windows so the
// runtime board agrees with the alerts.
type BurnRateTier struct {
	Name        string  `json:"name"`         // FastBurn | SlowBurn
	LongWindow  string  `json:"long_window"`  // 1h or 6h
	ShortWindow string  `json:"short_window"` // 5m or 30m
	BurnRate    float64 `json:"burn_rate"`    // 14.4 or 6
	Severity    string  `json:"severity"`     // page or ticket
}

// Tiers returns the two MW-MBR tiers, ordered fast → slow so the SPA
// renders the most-critical tier first.
func Tiers() []BurnRateTier {
	return []BurnRateTier{
		{Name: "FastBurn", LongWindow: "1h", ShortWindow: "5m", BurnRate: 14.4, Severity: "page"},
		{Name: "SlowBurn", LongWindow: "6h", ShortWindow: "30m", BurnRate: 6, Severity: "ticket"},
	}
}

// TierStatus is one tier's evaluation against the live samples.
type TierStatus struct {
	Tier       BurnRateTier `json:"tier"`
	LongRatio  *float64     `json:"long_ratio,omitempty"`  // bad-event ratio over the long window
	ShortRatio *float64     `json:"short_ratio,omitempty"` // bad-event ratio over the short window
	Threshold  float64      `json:"threshold"`             // (1-objective)*burn_rate
	Firing     bool         `json:"firing"`                // both windows above threshold
	Error      string       `json:"error,omitempty"`
}

// Status is the per-SLO live snapshot returned by Tracker.Snapshot.
type Status struct {
	Name                 string       `json:"name"`
	Description          string       `json:"description"`
	Objective            float64      `json:"objective"`
	Window               string       `json:"window"`
	Owner                string       `json:"owner"`
	Tags                 []string     `json:"tags"`
	CurrentRatio         *float64     `json:"current_ratio,omitempty"`          // live good/valid over `Window`
	ErrorBudgetRemaining *float64     `json:"error_budget_remaining,omitempty"` // 0..1 fraction of budget left
	Tiers                []TierStatus `json:"tiers"`
	HighestSeverity      string       `json:"highest_severity"` // page > ticket > none
	Error                string       `json:"error,omitempty"`
}

// Snapshot is the response shape of /admin/observability/slo.
type Snapshot struct {
	GeneratedAt   time.Time `json:"generated_at"`
	SLOs          []Status  `json:"slos"`
	PromAvailable bool      `json:"prom_available"`
}

// Snapshot queries Prometheus for every SLO in the catalog and returns
// their live state. Per-SLO errors are isolated — one slow query does
// not block the whole dashboard.
func (t *Tracker) Snapshot(ctx context.Context, catalog *Catalog) (*Snapshot, error) {
	if catalog == nil {
		return nil, errors.New("slo: catalog is nil")
	}
	out := &Snapshot{
		GeneratedAt:   t.now(),
		PromAvailable: t.client != nil,
		SLOs:          make([]Status, 0, len(catalog.SLOs)),
	}
	if t.client == nil {
		// Surface the catalog metadata even when Prometheus is
		// unreachable so the SPA can render the SLO names + targets
		// with a "Prometheus not configured" banner instead of a
		// blank panel.
		for _, s := range catalog.SLOs {
			out.SLOs = append(out.SLOs, Status{
				Name:        s.Name,
				Description: s.Description,
				Objective:   s.Objective,
				Window:      s.Window,
				Owner:       s.Owner,
				Tags:        s.Tags,
				Error:       ErrPrometheusUnconfigured.Error(),
			})
		}
		return out, nil
	}
	for _, s := range catalog.SLOs {
		out.SLOs = append(out.SLOs, t.snapshotOne(ctx, s))
	}
	return out, nil
}

func (t *Tracker) snapshotOne(ctx context.Context, s SLO) Status {
	status := Status{
		Name:        s.Name,
		Description: s.Description,
		Objective:   s.Objective,
		Window:      s.Window,
		Owner:       s.Owner,
		Tags:        s.Tags,
		Tiers:       make([]TierStatus, 0, len(Tiers())),
	}

	// Current SLI ratio over the SLO's nominal window.
	currentExpr := goodRatioExpr(s, s.Window)
	if v, err := t.queryScalar(ctx, currentExpr); err != nil {
		status.Error = fmt.Sprintf("current ratio: %v", err)
	} else if v != nil {
		ratio := *v
		status.CurrentRatio = &ratio
		// Error budget remaining = how much of the SLO's allowed
		// failure budget is still unspent. budget = 1 - objective/100;
		// consumed = max(0, (1 - current_ratio) / budget); remaining
		// = clamp(1 - consumed, 0, 1).
		budget := (100 - s.Objective) / 100
		if budget > 0 {
			consumed := (1 - ratio) / budget
			if consumed < 0 {
				consumed = 0
			}
			remaining := 1 - consumed
			if remaining < 0 {
				remaining = 0
			}
			if remaining > 1 {
				remaining = 1
			}
			status.ErrorBudgetRemaining = &remaining
		}
	}

	highest := "none"
	for _, tier := range Tiers() {
		ts := t.snapshotTier(ctx, s, tier)
		status.Tiers = append(status.Tiers, ts)
		if ts.Firing {
			switch tier.Severity {
			case "page":
				highest = "page"
			case "ticket":
				if highest != "page" {
					highest = "ticket"
				}
			}
		}
	}
	status.HighestSeverity = highest
	return status
}

func (t *Tracker) snapshotTier(ctx context.Context, s SLO, tier BurnRateTier) TierStatus {
	threshold := ((100 - s.Objective) / 100) * tier.BurnRate
	ts := TierStatus{Tier: tier, Threshold: threshold}

	longExpr := badRatioExpr(s, tier.LongWindow)
	shortExpr := badRatioExpr(s, tier.ShortWindow)

	if v, err := t.queryScalar(ctx, longExpr); err != nil {
		ts.Error = fmt.Sprintf("long window: %v", err)
		return ts
	} else if v != nil {
		ts.LongRatio = v
	}
	if v, err := t.queryScalar(ctx, shortExpr); err != nil {
		ts.Error = fmt.Sprintf("short window: %v", err)
		return ts
	} else if v != nil {
		ts.ShortRatio = v
	}
	if ts.LongRatio != nil && ts.ShortRatio != nil {
		ts.Firing = *ts.LongRatio > threshold && *ts.ShortRatio > threshold
	}
	return ts
}

// queryScalar runs a PromQL instant query and unwraps it to a single
// float. Returns nil when Prometheus returned an empty vector — the
// caller distinguishes "no data" from "low ratio" in the UI.
func (t *Tracker) queryScalar(ctx context.Context, expr string) (*float64, error) {
	qctx, cancel := context.WithTimeout(ctx, t.queryTime)
	defer cancel()
	val, _, err := t.client.Query(qctx, expr, t.now())
	if err != nil {
		return nil, err
	}
	switch v := val.(type) {
	case prommodel.Vector:
		if len(v) == 0 {
			return nil, nil
		}
		f := float64(v[0].Value)
		return &f, nil
	case *prommodel.Scalar:
		if v == nil {
			return nil, nil
		}
		f := float64(v.Value)
		return &f, nil
	default:
		return nil, fmt.Errorf("unexpected prom value type %T", val)
	}
}

// goodRatioExpr returns the PromQL for the live success ratio. We
// rewrite the SLI inline rather than depend on recording rules so the
// tracker works against a fresh Prometheus that hasn't loaded the
// generated rules yet.
func goodRatioExpr(s SLO, window string) string {
	good := rewriteWindow(s.SLI.GoodEvents, window)
	valid := rewriteWindow(s.SLI.ValidEvents, window)
	return nonZeroTrafficRatioExpr(good, valid)
}

func nonZeroTrafficRatioExpr(good, valid string) string {
	// A missing numerator must NOT read as a perfect ratio.
	//
	// The `or on() vector(1)` tail exists so a window with genuinely zero
	// traffic scores 1 (no reliability budget was consumed). But if the
	// numerator selects a series that does not exist — the classic case is a
	// latency SLI pinned to an `le=` histogram bucket boundary that was never
	// configured — then `good` is an empty vector, `good / valid` is empty,
	// and the whole expression collapses straight to vector(1). The SLO then
	// reports 100 % forever and silently monitors nothing.
	//
	// Coalescing the numerator to `0 * valid` keeps a real series present
	// whenever there IS traffic, so a missing bucket surfaces as ratio 0 (a
	// loud, immediate failure) instead of a fabricated pass. vector(1) now
	// only applies when `valid` itself is absent or zero, which is the one
	// case it was written for.
	return fmt.Sprintf(
		"(((((%s) or on() (0 * (%s)))) / (%s)) and on() ((%s) > 0)) or on() vector(1)",
		good, valid, valid, valid,
	)
}

// badRatioExpr returns the PromQL for the bad-event ratio over a window.
// Mirrors cmd/slogen's ratioExpr — single source of truth.
func badRatioExpr(s SLO, window string) string {
	return fmt.Sprintf("1 - (%s)", goodRatioExpr(s, window))
}

// rewriteWindow swaps the reference window in the SLI body for the requested
// window. Catalog convention is that all SLIs use [5m] as the reference
// window; recording rules + alerts then re-render the same expression against
// the desired window. Both the plain range `[5m]` and the subquery form
// `[5m:30s]` are handled, in that order, so a continuity SLI built on a
// subquery re-windows identically at runtime and at codegen time. Divergence
// from cmd/slogen here would make the admin board disagree with the alerts
// that actually fire.
func rewriteWindow(expr, window string) string {
	expr = strings.ReplaceAll(expr, "[5m:30s]", "["+window+":30s]")
	expr = strings.ReplaceAll(expr, "[5m]", "["+window+"]")
	return expr
}
