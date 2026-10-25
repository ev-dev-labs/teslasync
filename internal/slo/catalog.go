// Package slo provides the runtime SLO tracker for TeslaSync.
//
// The codegen toolkit at cmd/slogen renders Prometheus recording rules,
// multi-window multi-burn-rate alerts, and Grafana dashboards from
// slo/catalog.yaml at build time. This package consumes the same catalogue at
// runtime so Grafana and the admin SLO page use the same source of truth.
//
// Three primitives:
//
//   - Catalog: a strict-YAML loader that mirrors cmd/slogen's parser
//     (no third-party YAML dep). Exposes the same Catalog/SLO/SLI shape.
//   - Tracker: queries the configured Prometheus HTTP API for current
//     burn ratios per SLO across short + long windows for both fast and
//     slow burn tiers (1h+5m, 6h+30m — same windows as the generated
//     alerts). Falls back to direct SLI evaluation when the recording
//     rules slo:<name>:ratio_<window> are unavailable.
//   - Evaluator: turns Prometheus samples into a Status — burn tier
//     (none/slow/fast), error budget remaining, expected exhaustion
//     date.
//
// The tracker is read-only and side-effect free. Failures are isolated
// per SLO so a slow Prometheus query doesn't block the whole admin
// dashboard.
package slo

import (
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/slo/catalogparser"
)

// Catalog holds the parsed slo/catalog.yaml.
type Catalog struct {
	Version int
	SLOs    []SLO
}

// SLO mirrors slo/catalog.schema.json.
type SLO = catalogparser.SLO

// SLI is the good/valid event pair used to compute the SLO ratio.
type SLI = catalogparser.SLI

const requiredCatalogVersion = catalogparser.RequiredVersion

var (
	nameRE   = catalogparser.NameRE
	windowRE = catalogparser.WindowRE
)

// LoadCatalog parses the catalog YAML at the given path. The accepted
// format is the strict subset documented in slo/catalog.yaml — same
// parser invariants as cmd/slogen.
func LoadCatalog(path string) (*Catalog, error) {
	parsed, err := catalogparser.Load(path)
	if err != nil {
		return nil, err
	}
	c := convertCatalog(parsed)
	if err := validateCatalog(c); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return c, nil
}

// LookupSLO returns the SLO with the given name or nil if missing.
func (c *Catalog) LookupSLO(name string) *SLO {
	for i := range c.SLOs {
		if c.SLOs[i].Name == name {
			return &c.SLOs[i]
		}
	}
	return nil
}

func validateCatalog(c *Catalog) error {
	return catalogparser.ValidateRuntime(convertCatalogBack(c))
}

func parseCatalog(text string) (*Catalog, error) {
	parsed, err := catalogparser.Parse(text)
	if err != nil {
		return nil, err
	}
	return convertCatalog(parsed), nil
}

func stripComment(line string) string {
	return catalogparser.StripComment(line)
}

func unquote(v string) string {
	return catalogparser.Unquote(v)
}

func parseInlineArray(v string) ([]string, error) {
	return catalogparser.ParseInlineArray(v)
}

func convertCatalog(c *catalogparser.Catalog) *Catalog {
	if c == nil {
		return nil
	}
	converted := &Catalog{Version: c.Version, SLOs: make([]SLO, len(c.SLOs))}
	copy(converted.SLOs, c.SLOs)
	return converted
}

func convertCatalogBack(c *Catalog) *catalogparser.Catalog {
	if c == nil {
		return nil
	}
	converted := &catalogparser.Catalog{Version: c.Version, SLOs: make([]catalogparser.SLO, len(c.SLOs))}
	copy(converted.SLOs, c.SLOs)
	return converted
}
