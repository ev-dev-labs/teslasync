package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const defaultDashboardsDir = "helm/teslasync/files/grafana/dashboards"

// dashboard is a minimal Grafana v10 dashboard model — just enough to
// produce panels backed by Prometheus + a Tempo exemplar link. The model
// uses public Grafana JSON keys so the output round-trips through the
// "Import dashboard" UI.
type dashboard struct {
	UID         string          `json:"uid"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Tags        []string        `json:"tags"`
	Schema      int             `json:"schemaVersion"`
	Version     int             `json:"version"`
	Time        timeRange       `json:"time"`
	Refresh     string          `json:"refresh"`
	Panels      []panel         `json:"panels"`
	Templating  templating      `json:"templating"`
	Links       []dashboardLink `json:"links,omitempty"`
	Annotations annotationsList `json:"annotations,omitempty"`
}

type timeRange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type templating struct {
	List []any `json:"list"`
}

type annotationsList struct {
	List []any `json:"list"`
}

type dashboardLink struct {
	Title string   `json:"title"`
	Type  string   `json:"type"`
	URL   string   `json:"url"`
	Tags  []string `json:"tags,omitempty"`
}

type panel struct {
	ID          int            `json:"id"`
	Type        string         `json:"type"`
	Title       string         `json:"title"`
	Description string         `json:"description,omitempty"`
	Datasource  datasource     `json:"datasource"`
	GridPos     gridPos        `json:"gridPos"`
	Targets     []target       `json:"targets"`
	FieldConfig fieldCfg       `json:"fieldConfig"`
	Options     map[string]any `json:"options,omitempty"`
}

type datasource struct {
	Type string `json:"type"`
	UID  string `json:"uid"`
}

type gridPos struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

type target struct {
	RefID        string `json:"refId"`
	Expr         string `json:"expr"`
	LegendFormat string `json:"legendFormat,omitempty"`
	Exemplar     bool   `json:"exemplar,omitempty"`
}

type fieldCfg struct {
	Defaults  fieldDefaults `json:"defaults"`
	Overrides []any         `json:"overrides"`
}

type fieldDefaults struct {
	Unit       string      `json:"unit,omitempty"`
	Min        *float64    `json:"min,omitempty"`
	Max        *float64    `json:"max,omitempty"`
	Decimals   *int        `json:"decimals,omitempty"`
	Thresholds *thresholds `json:"thresholds,omitempty"`
}

type thresholds struct {
	Mode  string          `json:"mode"`
	Steps []thresholdStep `json:"steps"`
}

type thresholdStep struct {
	Color string   `json:"color"`
	Value *float64 `json:"value"`
}

func runGenerateDashboards(args []string) error {
	fs := flag.NewFlagSet("generate dashboards", flag.ContinueOnError)
	catalog := fs.String("catalog", "slo/catalog.yaml", "path to SLO catalog YAML")
	outDir := fs.String("out-dir", defaultDashboardsDir, "output directory for dashboards")
	if err := fs.Parse(args); err != nil {
		return err
	}
	cat, err := loadCatalog(*catalog)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		return err
	}

	written := 0
	for _, s := range cat.SLOs {
		path := filepath.Join(*outDir, "slo-"+s.Name+".json")
		body, err := renderSLODashboard(s)
		if err != nil {
			return err
		}
		if err := writeFileIdempotent(path, body); err != nil {
			return err
		}
		written++
	}
	overviewPath := filepath.Join(*outDir, "slo-overview.json")
	overviewBody, err := renderOverviewDashboard(cat)
	if err != nil {
		return err
	}
	if err := writeFileIdempotent(overviewPath, overviewBody); err != nil {
		return err
	}
	written++
	fmt.Fprintf(os.Stdout, "wrote %d dashboards to %s\n", written, *outDir)
	return nil
}

var prometheusDS = datasource{Type: "prometheus", UID: "DS_TESLASYNC_PROMETHEUS"}

func renderSLODashboard(s SLO) (string, error) {
	var min0 float64 = 0
	var max1 float64 = 1
	var dec3 int = 3
	pct := fieldCfg{Defaults: fieldDefaults{Unit: "percentunit", Min: &min0, Max: &max1, Decimals: &dec3}}
	plain := fieldCfg{Defaults: fieldDefaults{Decimals: &dec3}}

	panels := []panel{
		{
			ID: 1, Type: "stat", Title: "SLI (5m)",
			Description: "Current good/valid ratio.",
			Datasource:  prometheusDS,
			GridPos:     gridPos{X: 0, Y: 0, W: 6, H: 4},
			FieldConfig: pct,
			Targets: []target{{
				RefID:        "A",
				Expr:         fmt.Sprintf("slo:%s:ratio_rate5m", s.Name),
				LegendFormat: "ratio_5m",
			}},
		},
		{
			ID: 2, Type: "stat", Title: "Objective",
			Description: "SLO target.",
			Datasource:  prometheusDS,
			GridPos:     gridPos{X: 6, Y: 0, W: 6, H: 4},
			FieldConfig: pct,
			Targets: []target{{
				RefID:        "A",
				Expr:         fmt.Sprintf("vector(%g)", s.Objective/100),
				LegendFormat: "objective",
			}},
		},
		{
			ID: 3, Type: "stat", Title: "Error budget remaining (30d)",
			Description: "1 - (1 - SLI_30d) / (1 - objective). Negative = budget blown.",
			Datasource:  prometheusDS,
			GridPos:     gridPos{X: 12, Y: 0, W: 12, H: 4},
			FieldConfig: pct,
			Targets: []target{{
				RefID: "A",
				Expr: fmt.Sprintf(
					"1 - ((1 - slo:%s:ratio_rate30d) / (1 - %g))",
					s.Name, s.Objective/100,
				),
				LegendFormat: "budget_remaining",
			}},
		},
		{
			ID: 4, Type: "timeseries", Title: "SLI over time (5m / 1h / 6h)",
			Datasource:  prometheusDS,
			GridPos:     gridPos{X: 0, Y: 4, W: 24, H: 8},
			FieldConfig: pct,
			Targets: []target{
				{RefID: "A", Expr: fmt.Sprintf("slo:%s:ratio_rate5m", s.Name), LegendFormat: "5m"},
				{RefID: "B", Expr: fmt.Sprintf("slo:%s:ratio_rate1h", s.Name), LegendFormat: "1h"},
				{RefID: "C", Expr: fmt.Sprintf("slo:%s:ratio_rate6h", s.Name), LegendFormat: "6h"},
			},
		},
		{
			ID: 5, Type: "timeseries", Title: "Burn rate (1h / 6h)",
			Description: "Bad-event ratio multiplied so the y-axis is in 'budgets per hour' units.",
			Datasource:  prometheusDS,
			GridPos:     gridPos{X: 0, Y: 12, W: 24, H: 8},
			FieldConfig: plain,
			Targets: []target{
				{RefID: "A", Expr: fmt.Sprintf("(1 - slo:%s:ratio_rate1h) / (1 - %g)", s.Name, s.Objective/100), LegendFormat: "1h"},
				{RefID: "B", Expr: fmt.Sprintf("(1 - slo:%s:ratio_rate6h) / (1 - %g)", s.Name, s.Objective/100), LegendFormat: "6h"},
			},
		},
		{
			ID: 6, Type: "timeseries", Title: "Latency (with Tempo exemplars)",
			Description: "Histogram of the underlying SLI denominator. Exemplars link to Tempo for trace IDs that touched the latency bucket.",
			Datasource:  prometheusDS,
			GridPos:     gridPos{X: 0, Y: 20, W: 24, H: 8},
			FieldConfig: fieldCfg{Defaults: fieldDefaults{Unit: "s"}},
			Targets: []target{{
				RefID:        "A",
				Expr:         "histogram_quantile(0.99, sum by (le) (rate(teslasync_red_http_request_duration_seconds_bucket[5m])))",
				LegendFormat: "p99",
				Exemplar:     true,
			}},
		},
	}

	d := dashboard{
		UID:         "slo-" + s.Name,
		Title:       fmt.Sprintf("SLO: %s", s.Name),
		Description: s.Description,
		Tags:        append([]string{"slo", "owner:" + s.Owner}, s.Tags...),
		Schema:      38,
		Version:     1,
		Time:        timeRange{From: "now-24h", To: "now"},
		Refresh:     "30s",
		Panels:      panels,
		Templating:  templating{List: []any{}},
		Annotations: annotationsList{List: []any{}},
		Links: []dashboardLink{{
			Title: "Tempo (traces)",
			Type:  "link",
			URL:   "/explore?left=%7B%22datasource%22:%22tempo%22%7D",
		}},
	}
	return marshalDashboard(applyFrontendSpecialisation(d, s))
}

func renderOverviewDashboard(cat *Catalog) (string, error) {
	var panels []panel
	id := 1
	x, y := 0, 0
	for _, s := range cat.SLOs {
		var min0, max1 float64 = 0, 1
		var dec3 int = 3
		panels = append(panels, panel{
			ID:          id,
			Type:        "stat",
			Title:       s.Name,
			Description: fmt.Sprintf("Objective: %g%%; owner: %s", s.Objective, s.Owner),
			Datasource:  prometheusDS,
			GridPos:     gridPos{X: x, Y: y, W: 6, H: 4},
			FieldConfig: fieldCfg{Defaults: fieldDefaults{Unit: "percentunit", Min: &min0, Max: &max1, Decimals: &dec3}},
			Targets: []target{{
				RefID:        "A",
				Expr:         fmt.Sprintf("slo:%s:ratio_rate1h", s.Name),
				LegendFormat: "1h",
			}},
			Options: map[string]any{
				"reduceOptions": map[string]any{"calcs": []string{"lastNotNull"}, "fields": "", "values": false},
				"orientation":   "horizontal",
				"colorMode":     "value",
			},
		})
		id++
		x += 6
		if x >= 24 {
			x = 0
			y += 4
		}
	}

	d := dashboard{
		UID:         "slo-overview",
		Title:       "SLO: overview",
		Description: "Single-pane view of every SLO. Each cell shows the 1h SLI; click through to the per-SLO dashboard for burn-rate and budget detail.",
		Tags:        []string{"slo", "overview"},
		Schema:      38,
		Version:     1,
		Time:        timeRange{From: "now-24h", To: "now"},
		Refresh:     "30s",
		Panels:      panels,
		Templating:  templating{List: []any{}},
		Annotations: annotationsList{List: []any{}},
	}
	return marshalDashboard(d)
}

func marshalDashboard(d dashboard) (string, error) {
	var buf strings.Builder
	enc := json.NewEncoder(&buf)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	if err := enc.Encode(d); err != nil {
		return "", err
	}
	return buf.String(), nil
}
