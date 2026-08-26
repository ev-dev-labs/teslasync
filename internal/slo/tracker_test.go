package slo

import (
	"context"
	"strings"
	"testing"
	"time"

	promv1 "github.com/prometheus/client_golang/api/prometheus/v1"
	prommodel "github.com/prometheus/common/model"
)

type fakeProm struct {
	answers map[string]float64
	err     error
}

func (f *fakeProm) Query(_ context.Context, q string, _ time.Time, _ ...promv1.Option) (prommodel.Value, promv1.Warnings, error) {
	if f.err != nil {
		return nil, nil, f.err
	}
	v, ok := f.answers[q]
	if !ok {
		return prommodel.Vector{}, nil, nil
	}
	return prommodel.Vector{
		&prommodel.Sample{Value: prommodel.SampleValue(v), Timestamp: prommodel.Now()},
	}, nil, nil
}

func TestSnapshot_PrometheusUnconfigured_ReturnsCatalogMetadataWithError(t *testing.T) {
	t.Parallel()
	tr, err := NewTracker("")
	if err != nil {
		t.Fatalf("constructor: %v", err)
	}
	cat := &Catalog{Version: 1, SLOs: []SLO{{
		Name: "test_one", Description: "x", Objective: 99.5, Window: "30d",
		Owner: "platform", SLI: SLI{GoodEvents: "rate(good[5m])", ValidEvents: "rate(valid[5m])"},
	}}}
	snap, err := tr.Snapshot(context.Background(), cat)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if snap.PromAvailable {
		t.Fatal("expected prom_available=false")
	}
	if len(snap.SLOs) != 1 {
		t.Fatalf("want 1 SLO, got %d", len(snap.SLOs))
	}
	if snap.SLOs[0].Error == "" {
		t.Fatal("expected error message when prom unconfigured")
	}
}

func TestSnapshot_FastBurnTierFires_WhenBothWindowsAboveThreshold(t *testing.T) {
	t.Parallel()
	// Objective 99% -> error budget = 0.01.
	// Fast-burn threshold = 0.01 * 14.4 = 0.144.
	// We set bad-ratio above threshold for both 1h and 5m windows.
	cat := &Catalog{Version: 1, SLOs: []SLO{{
		Name: "fastburn_demo", Description: "x", Objective: 99.0, Window: "30d",
		Owner: "platform", SLI: SLI{GoodEvents: "sum(rate(good[5m]))", ValidEvents: "sum(rate(valid[5m]))"},
	}}}
	prom := &fakeProm{answers: map[string]float64{
		// Long window (1h) bad ratio = 0.5 > 0.144 -> firing leg
		badRatioExpr(cat.SLOs[0], "1h"): 0.5,
		// Short window (5m) bad ratio = 0.4 > 0.144 -> firing leg
		badRatioExpr(cat.SLOs[0], "5m"): 0.4,
		// Slow tier windows: 6h + 30m; below threshold so slow burn does NOT fire
		badRatioExpr(cat.SLOs[0], "6h"):  0.001,
		badRatioExpr(cat.SLOs[0], "30m"): 0.001,
		// Current ratio (good/valid over 30d) — used for error budget remaining
		goodRatioExpr(cat.SLOs[0], "30d"): 0.6,
	}}
	tr := NewTrackerWithClient(prom, func() time.Time { return time.Unix(0, 0) })
	snap, err := tr.Snapshot(context.Background(), cat)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}

	if len(snap.SLOs) != 1 {
		t.Fatalf("want 1 SLO, got %d", len(snap.SLOs))
	}
	st := snap.SLOs[0]
	if st.HighestSeverity != "page" {
		t.Fatalf("expected highest_severity=page, got %s", st.HighestSeverity)
	}
	// Tiers order: FastBurn first
	if !st.Tiers[0].Firing {
		t.Fatal("expected FastBurn tier to fire")
	}
	if st.Tiers[1].Firing {
		t.Fatal("expected SlowBurn tier NOT to fire")
	}
	if st.ErrorBudgetRemaining == nil {
		t.Fatal("expected error_budget_remaining populated")
	}
	// budget = 0.01; consumed = (1-0.6)/0.01 = 40; remaining clamped to 0.
	if *st.ErrorBudgetRemaining != 0 {
		t.Fatalf("expected remaining=0 (budget exhausted), got %v", *st.ErrorBudgetRemaining)
	}
}

func TestRatioExpressionsPreserveLowTrafficAndHandleNoTraffic(t *testing.T) {
	t.Parallel()
	slo := SLO{
		SLI: SLI{
			GoodEvents:  "sum(rate(good[5m]))",
			ValidEvents: "sum(rate(valid[5m]))",
		},
	}

	good := goodRatioExpr(slo, "1h")
	if strings.Contains(good, "clamp_min") {
		t.Fatalf("good ratio floors low traffic: %s", good)
	}
	if !strings.Contains(good, "((sum(rate(valid[1h]))) > 0)") ||
		!strings.Contains(good, "or on() vector(1)") {
		t.Fatalf("good ratio does not explicitly handle zero traffic: %s", good)
	}

	bad := badRatioExpr(slo, "1h")
	if strings.Contains(bad, "clamp_min") {
		t.Fatalf("bad ratio floors low traffic: %s", bad)
	}
	if !strings.HasPrefix(bad, "1 - (") || !strings.Contains(bad, "or on() vector(1)") {
		t.Fatalf("bad ratio does not derive from the zero-traffic-safe good ratio: %s", bad)
	}
}

func TestSnapshot_PerSLOErrorIsolation(t *testing.T) {
	t.Parallel()
	cat := &Catalog{Version: 1, SLOs: []SLO{{
		Name: "ok_slo", Description: "x", Objective: 99.5, Window: "30d",
		Owner: "platform", SLI: SLI{GoodEvents: "rate(good[5m])", ValidEvents: "rate(valid[5m])"},
	}}}
	prom := &fakeProm{answers: map[string]float64{}}
	tr := NewTrackerWithClient(prom, time.Now)
	snap, err := tr.Snapshot(context.Background(), cat)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap.SLOs) != 1 {
		t.Fatalf("want 1, got %d", len(snap.SLOs))
	}
	if snap.SLOs[0].HighestSeverity != "none" {
		t.Fatalf("empty vectors should not fire any tier; got severity=%s", snap.SLOs[0].HighestSeverity)
	}
}

func TestLoadCatalog_Roundtrip(t *testing.T) {
	t.Parallel()
	c, err := LoadCatalog("../../slo/catalog.yaml")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if c.Version != 1 {
		t.Fatalf("want version 1, got %d", c.Version)
	}
	if len(c.SLOs) == 0 {
		t.Fatal("expected at least one SLO in production catalog")
	}
	if c.LookupSLO("api_availability") == nil {
		t.Fatal("expected api_availability SLO to be present")
	}
}
