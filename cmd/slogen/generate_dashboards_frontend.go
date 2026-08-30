package main

import (
	"fmt"
	"regexp"
	"strings"
)

// Frontend / RUM dashboard specialisation.
//
// Generic SLO dashboards assume the SLI denominator is the HTTP RED histogram.
// That assumption is wrong for browser-side SLOs: their denominator is a
// `teslasync_frontend_*` histogram fed by POST /api/v1/web-vitals. For any SLO
// tagged `frontend` we therefore:
//
//   1. Point the exemplar/quantile panel at the SLO's own histogram, using the
//      correct unit (seconds vs unitless CLS score).
//   2. Attach a Prometheus-backed release annotation so a burn-rate cliff can
//      be read against the deploy that caused it.
//
// Non-frontend dashboards render byte-identically to before, so regenerating
// the catalogue never churns unrelated files.

// releaseAnnotationExpr fires one annotation the first time a frontend release
// reports a RUM sample. `teslasync_frontend_release_first_seen_timestamp_seconds`
// is published by internal/api/webvitals when a new release label is admitted.
const releaseAnnotationExpr = "changes(teslasync_frontend_release_first_seen_timestamp_seconds[$__rate_interval]) > 0"

// sliBucketRE extracts the histogram base name from an SLI numerator such as
// `sum(rate(teslasync_frontend_web_vitals_lcp_seconds_bucket{le="2.5"}[5m]))`.
var sliBucketRE = regexp.MustCompile(`([a-zA-Z_:][a-zA-Z0-9_:]*)_bucket`)

func hasTag(s SLO, want string) bool {
	for _, t := range s.Tags {
		if t == want {
			return true
		}
	}
	return false
}

// sliHistogramBase returns the histogram metric name backing an SLO's SLI, or
// "" when the SLI is not histogram-based.
func sliHistogramBase(s SLO) string {
	if m := sliBucketRE.FindStringSubmatch(s.SLI.GoodEvents); len(m) == 2 {
		return m[1]
	}
	return ""
}

// frontendPanelUnit maps a RUM histogram onto its Grafana unit. CLS is a
// unitless layout score; everything else is seconds.
func frontendPanelUnit(metric string) string {
	if strings.HasSuffix(metric, "_ratio") {
		return "none"
	}
	return "s"
}

// frontendDistributionPanel replaces the generic HTTP-latency panel with the
// p75/p95 of the SLO's own RUM histogram. p75 is the quantile Core Web Vitals
// objectives are defined against.
func frontendDistributionPanel(s SLO) (panel, bool) {
	metric := sliHistogramBase(s)
	if metric == "" {
		return panel{}, false
	}
	unit := frontendPanelUnit(metric)
	return panel{
		ID:   6,
		Type: "timeseries",
		Title: fmt.Sprintf(
			"%s distribution (p75 / p95, with Tempo exemplars)",
			strings.TrimPrefix(metric, "teslasync_frontend_"),
		),
		Description: "Real-user distribution behind this SLO. p75 is the quantile the Core Web Vitals objective is defined against. Exemplars link to Tempo for the trace that served the navigation.",
		Datasource:  prometheusDS,
		GridPos:     gridPos{X: 0, Y: 20, W: 24, H: 8},
		FieldConfig: fieldCfg{Defaults: fieldDefaults{Unit: unit}},
		Targets: []target{
			{
				RefID:        "A",
				Expr:         fmt.Sprintf("histogram_quantile(0.75, sum by (le) (rate(%s_bucket[5m])))", metric),
				LegendFormat: "p75",
				Exemplar:     true,
			},
			{
				RefID:        "B",
				Expr:         fmt.Sprintf("histogram_quantile(0.95, sum by (le) (rate(%s_bucket[5m])))", metric),
				LegendFormat: "p95",
			},
		},
	}, true
}

// frontendRoutePanel breaks the SLO's histogram down by normalised route
// template so a regression can be attributed to a page. The route label is
// cardinality-capped server-side (internal/api/webvitals/metrics.go).
func frontendRoutePanel(s SLO) (panel, bool) {
	metric := sliHistogramBase(s)
	if metric == "" {
		return panel{}, false
	}
	return panel{
		ID:          7,
		Type:        "timeseries",
		Title:       "p75 by route template",
		Description: "Per-route p75. Route labels are ID-, VIN- and coordinate-redacted templates, capped server-side to bound cardinality.",
		Datasource:  prometheusDS,
		GridPos:     gridPos{X: 0, Y: 28, W: 24, H: 8},
		FieldConfig: fieldCfg{Defaults: fieldDefaults{Unit: frontendPanelUnit(metric)}},
		Targets: []target{{
			RefID:        "A",
			Expr:         fmt.Sprintf("histogram_quantile(0.75, sum by (le, route) (rate(%s_bucket[5m])))", metric),
			LegendFormat: "{{route}}",
		}},
	}, true
}

// releaseAnnotations returns the Grafana annotation list that marks frontend
// deployments. Uses only in-cluster Prometheus — no credentials, no external
// datasource, nothing that could embed a secret in a checked-in dashboard.
func releaseAnnotations() annotationsList {
	return annotationsList{List: []any{
		map[string]any{
			"name":        "Frontend releases",
			"enable":      true,
			"hide":        false,
			"iconColor":   "rgba(0, 211, 255, 1)",
			"datasource":  map[string]any{"type": prometheusDS.Type, "uid": prometheusDS.UID},
			"expr":        releaseAnnotationExpr,
			"step":        "60s",
			"tagKeys":     "release",
			"titleFormat": "Frontend release {{release}}",
			"textFormat":  "First real-user sample reported by release {{release}}",
		},
	}}
}

// applyFrontendSpecialisation mutates a rendered dashboard model in place when
// the SLO is browser-side. Returns the dashboard unchanged otherwise.
func applyFrontendSpecialisation(d dashboard, s SLO) dashboard {
	if !hasTag(s, "frontend") {
		return d
	}
	if p, ok := frontendDistributionPanel(s); ok {
		for i := range d.Panels {
			if d.Panels[i].ID == 6 {
				d.Panels[i] = p
			}
		}
	}
	if p, ok := frontendRoutePanel(s); ok {
		d.Panels = append(d.Panels, p)
	}
	d.Annotations = releaseAnnotations()
	return d
}
