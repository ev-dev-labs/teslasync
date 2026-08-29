package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateRealCatalog(t *testing.T) {
	t.Parallel()
	path, err := filepath.Abs(filepath.Join("..", "..", "slo", "catalog.yaml"))
	if err != nil {
		t.Fatalf("abs: %v", err)
	}
	if err := validateFile(path); err != nil {
		t.Fatalf("real catalog must validate: %v", err)
	}
}

func TestValidateCatalog_InvalidObjective(t *testing.T) {
	t.Parallel()
	cat := &Catalog{
		Version: 1,
		SLOs: []SLO{{
			Name:        "ok",
			Description: "minimum length OK",
			SLI:         SLI{GoodEvents: "x", ValidEvents: "y"},
			Objective:   100, // exclusiveMaximum
			Window:      "30d",
			Owner:       "team",
		}},
	}
	err := validateCatalog(cat)
	if err == nil || !strings.Contains(err.Error(), "objective") {
		t.Fatalf("expected objective error, got %v", err)
	}
}

func TestValidateCatalog_DuplicateName(t *testing.T) {
	t.Parallel()
	good := SLO{
		Name:        "dup",
		Description: "decent description",
		SLI:         SLI{GoodEvents: "x", ValidEvents: "y"},
		Objective:   99,
		Window:      "7d",
		Owner:       "team",
	}
	cat := &Catalog{Version: 1, SLOs: []SLO{good, good}}
	err := validateCatalog(cat)
	if err == nil || !strings.Contains(err.Error(), "duplicates") {
		t.Fatalf("expected duplicates error, got %v", err)
	}
}

func TestValidateCatalog_BadWindow(t *testing.T) {
	t.Parallel()
	cat := &Catalog{
		Version: 1,
		SLOs: []SLO{{
			Name:        "win",
			Description: "decent description",
			SLI:         SLI{GoodEvents: "x", ValidEvents: "y"},
			Objective:   99,
			Window:      "thirty-days",
			Owner:       "team",
		}},
	}
	err := validateCatalog(cat)
	if err == nil || !strings.Contains(err.Error(), "window") {
		t.Fatalf("expected window error, got %v", err)
	}
}

func TestValidateCatalog_BadName(t *testing.T) {
	t.Parallel()
	cat := &Catalog{
		Version: 1,
		SLOs: []SLO{{
			Name:        "Bad-Name",
			Description: "decent description",
			SLI:         SLI{GoodEvents: "x", ValidEvents: "y"},
			Objective:   99,
			Window:      "7d",
			Owner:       "team",
		}},
	}
	err := validateCatalog(cat)
	if err == nil || !strings.Contains(err.Error(), "name") {
		t.Fatalf("expected name error, got %v", err)
	}
}

func TestParseCatalog_HandlesInlineArrayAndQuotedExpr(t *testing.T) {
	t.Parallel()
	src := `version: 1
slos:
  - name: api_avail
    description: "HTTP request success ratio across /api/v1/."
    sli:
      good_events: "sum(rate(x{status_class!=\"5xx\"}[5m]))"
      valid_events: "sum(rate(x[5m]))"
    objective: 99.5
    window: 30d
    owner: platform
    fast_burn_severity: ticket
    tags: [http, red]
`
	c, err := parseCatalog(src)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if c.Version != 1 || len(c.SLOs) != 1 {
		t.Fatalf("unexpected catalog: %+v", c)
	}
	got := c.SLOs[0]
	if got.Name != "api_avail" {
		t.Fatalf("name: got %q", got.Name)
	}
	if got.SLI.GoodEvents != `sum(rate(x{status_class!="5xx"}[5m]))` {
		t.Fatalf("good_events not unquoted: %q", got.SLI.GoodEvents)
	}
	if len(got.Tags) != 2 || got.Tags[0] != "http" || got.Tags[1] != "red" {
		t.Fatalf("tags: %v", got.Tags)
	}
	if got.FastBurnSeverity != "ticket" {
		t.Fatalf("fast_burn_severity: got %q want ticket", got.FastBurnSeverity)
	}
	if err := validateCatalog(c); err != nil {
		t.Fatalf("validate: %v", err)
	}
}

func TestValidateCatalog_BadFastBurnSeverity(t *testing.T) {
	t.Parallel()
	cat := &Catalog{
		Version: 1,
		SLOs: []SLO{{
			Name:             "budget_signal",
			Description:      "Budget planning signal for operators",
			SLI:              SLI{GoodEvents: "x", ValidEvents: "y"},
			Objective:        99,
			Window:           "7d",
			Owner:            "platform",
			FastBurnSeverity: "email",
		}},
	}
	err := validateCatalog(cat)
	if err == nil || !strings.Contains(err.Error(), "fast_burn_severity") {
		t.Fatalf("expected fast_burn_severity error, got %v", err)
	}
}

func TestStripComment_PreservesHashInsideQuotes(t *testing.T) {
	t.Parallel()
	got := stripComment(`good_events: "rate(x{tag=\"#foo\"}[5m])" # tail`)
	want := `good_events: "rate(x{tag=\"#foo\"}[5m])"`
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
