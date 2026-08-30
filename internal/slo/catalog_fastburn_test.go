package slo

import (
	"path/filepath"
	"strings"
	"testing"
)

// The runtime catalog parser is a hand-rolled duplicate of cmd/slogen's. Any
// field cmd/slogen accepts but the runtime parser rejects makes LoadCatalog
// fail outright — and because the admin SLO handler surfaces that as a single
// error, ONE unknown field blanks the entire board. `fast_burn_severity`
// regressed exactly that way.
func TestParseCatalog_FastBurnSeverity(t *testing.T) {
	t.Parallel()
	const src = `version: 1
slos:
  - name: continuity
    description: "Ticket-only continuity burn."
    sli:
      good_events: "sum(rate(good[5m]))"
      valid_events: "sum(rate(valid[5m]))"
    objective: 99.0
    window: 7d
    owner: platform
    fast_burn_severity: ticket
    tags: [upstream, budget]
`
	c, err := parseCatalog(src)
	if err != nil {
		t.Fatalf("parseCatalog: %v", err)
	}
	if len(c.SLOs) != 1 {
		t.Fatalf("slos = %d, want 1", len(c.SLOs))
	}
	if got := c.SLOs[0].FastBurnSeverity; got != "ticket" {
		t.Errorf("FastBurnSeverity = %q, want ticket", got)
	}
	if err := validateCatalog(c); err != nil {
		t.Errorf("validateCatalog: %v", err)
	}
}

func TestParseCatalog_FastBurnSeverityOptional(t *testing.T) {
	t.Parallel()
	c, err := parseCatalog(minimalCatalog(""))
	if err != nil {
		t.Fatalf("parseCatalog: %v", err)
	}
	if got := c.SLOs[0].FastBurnSeverity; got != "" {
		t.Errorf("FastBurnSeverity = %q, want empty (defaults to page)", got)
	}
	if err := validateCatalog(c); err != nil {
		t.Errorf("validateCatalog: %v", err)
	}
}

func TestValidateCatalog_FastBurnSeverityValues(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{"empty defaults to page", "", false},
		{"page accepted", "page", false},
		{"ticket accepted", "ticket", false},
		{"email rejected", "email", true},
		{"warning rejected", "warning", true},
		{"case sensitive", "Ticket", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			c, err := parseCatalog(minimalCatalog(tt.value))
			if err != nil {
				t.Fatalf("parseCatalog: %v", err)
			}
			err = validateCatalog(c)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected a validation error")
				}
				if !strings.Contains(err.Error(), "fast_burn_severity") {
					t.Errorf("err = %v, want it to name fast_burn_severity", err)
				}
				return
			}
			if err != nil {
				t.Errorf("validateCatalog: %v", err)
			}
		})
	}
}

// The shipped catalog must load at runtime. This is the regression that took
// the admin SLO board down: cmd/slogen validated the file happily while the
// runtime parser rejected it.
func TestLoadCatalog_ShippedCatalogLoadsAtRuntime(t *testing.T) {
	t.Parallel()
	c, err := LoadCatalog(filepath.Join("..", "..", "slo", "catalog.yaml"))
	if err != nil {
		t.Fatalf("LoadCatalog(slo/catalog.yaml): %v", err)
	}
	if len(c.SLOs) == 0 {
		t.Fatal("shipped catalog parsed to zero SLOs")
	}
	// The continuity SLO that introduced fast_burn_severity must round-trip.
	var sawTicket bool
	for _, s := range c.SLOs {
		if s.FastBurnSeverity == "ticket" {
			sawTicket = true
		}
	}
	if !sawTicket {
		t.Error("expected at least one ticket-only fast-burn SLO in the shipped catalog")
	}
	// Both new data-quality SLOs must be present and resolvable.
	for _, name := range []string{
		"data_quality_read_availability",
		"data_quality_read_latency_2s",
	} {
		if c.LookupSLO(name) == nil {
			t.Errorf("shipped catalog missing SLO %q", name)
		}
	}
}

// rewriteWindow must handle the subquery form the continuity SLIs use.
// Runtime and codegen disagreeing here makes the admin board show a different
// number than the alert that pages.
func TestRewriteWindow_SubqueryForm(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		expr   string
		window string
		want   string
	}{
		{
			name:   "plain range",
			expr:   "sum(rate(x[5m]))",
			window: "1h",
			want:   "sum(rate(x[1h]))",
		},
		{
			name:   "subquery range",
			expr:   "sum_over_time((max(x) == bool 0)[5m:30s])",
			window: "6h",
			want:   "sum_over_time((max(x) == bool 0)[6h:30s])",
		},
		{
			name:   "subquery and plain range together",
			expr:   "sum_over_time((y)[5m:30s]) + sum(rate(z[5m]))",
			window: "30m",
			want:   "sum_over_time((y)[30m:30s]) + sum(rate(z[30m]))",
		},
		{
			name:   "no reference window is left alone",
			expr:   "sum(rate(x[1h]))",
			window: "6h",
			want:   "sum(rate(x[1h]))",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := rewriteWindow(tt.expr, tt.window); got != tt.want {
				t.Errorf("rewriteWindow = %q, want %q", got, tt.want)
			}
		})
	}
}

// A numerator that selects nothing (missing histogram bucket) must NOT reduce
// to the vector(1) "healthy" tail. The coalesced numerator keeps a real series
// present whenever there is traffic, so the ratio reads 0 and fails loudly.
func TestNonZeroTrafficRatioExpr_DoesNotMaskMissingNumerator(t *testing.T) {
	t.Parallel()
	expr := nonZeroTrafficRatioExpr("sum(rate(good[5m]))", "sum(rate(valid[5m]))")

	// The numerator must be coalesced against a zero-valued denominator term.
	if !strings.Contains(expr, "or on() (0 * (sum(rate(valid[5m]))))") {
		t.Errorf("numerator is not coalesced to 0 on absence: %s", expr)
	}
	// The zero-traffic tail is still present for the case it was written for.
	if !strings.HasSuffix(expr, "or on() vector(1)") {
		t.Errorf("zero-traffic vector(1) tail missing: %s", expr)
	}
	// The old, masking shape must not survive: `good` divided directly with
	// no coalescing meant an empty numerator fell straight through to 1.
	if strings.Contains(expr, "((sum(rate(good[5m]))) / (sum(rate(valid[5m]))))") {
		t.Errorf("uncoalesced numerator division still present: %s", expr)
	}
}

// The runtime tracker and the codegen must build byte-identical ratio
// expressions; a divergence means the board and the alerts disagree.
func TestGoodRatioExpr_UsesCoalescedNumerator(t *testing.T) {
	t.Parallel()
	s := SLO{SLI: SLI{
		GoodEvents:  "sum(rate(g[5m]))",
		ValidEvents: "sum(rate(v[5m]))",
	}}
	got := goodRatioExpr(s, "1h")
	if !strings.Contains(got, "[1h]") {
		t.Errorf("window not rewritten: %s", got)
	}
	if !strings.Contains(got, "0 * (sum(rate(v[1h])))") {
		t.Errorf("coalesced numerator missing after re-windowing: %s", got)
	}
	if strings.Contains(got, "[5m]") {
		t.Errorf("reference window leaked into rendered expression: %s", got)
	}
}

func minimalCatalog(fastBurnSeverity string) string {
	extra := ""
	if fastBurnSeverity != "" {
		extra = "    fast_burn_severity: " + fastBurnSeverity + "\n"
	}
	return `version: 1
slos:
  - name: sample
    description: "Sample."
    sli:
      good_events: "sum(rate(good[5m]))"
      valid_events: "sum(rate(valid[5m]))"
    objective: 99.0
    window: 30d
    owner: platform
` + extra + `    tags: [a]
`
}
