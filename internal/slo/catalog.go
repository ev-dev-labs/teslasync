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
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// Catalog holds the parsed slo/catalog.yaml.
type Catalog struct {
	Version int
	SLOs    []SLO
}

// SLO mirrors slo/catalog.schema.json.
type SLO struct {
	Name        string
	Description string
	SLI         SLI
	Objective   float64
	Window      string
	Owner       string
	// FastBurnSeverity optionally routes the fast-burn alert tier to
	// "ticket" instead of the default "page". Continuity-style SLOs (e.g.
	// upstream polling-budget continuity) are operationally important but
	// must not page at 3am, so they declare ticket-only fast burn. Empty
	// means "page" — the cmd/slogen default. This field MUST stay in sync
	// with cmd/slogen's parser; a runtime parser that rejects it makes
	// LoadCatalog fail and blanks the whole admin SLO board.
	FastBurnSeverity string
	Tags             []string
}

// SLI is the good/valid event pair used to compute the SLO ratio.
type SLI struct {
	GoodEvents  string
	ValidEvents string
}

const requiredCatalogVersion = 1

var (
	nameRE   = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	windowRE = regexp.MustCompile(`^[0-9]+[mhdw]$`)
)

// LoadCatalog parses the catalog YAML at the given path. The accepted
// format is the strict subset documented in slo/catalog.yaml — same
// parser invariants as cmd/slogen.
func LoadCatalog(path string) (*Catalog, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	c, err := parseCatalog(string(raw))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
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
	if c.Version != requiredCatalogVersion {
		return fmt.Errorf("version: got %d want %d", c.Version, requiredCatalogVersion)
	}
	if len(c.SLOs) == 0 {
		return fmt.Errorf("slos: at least one entry required")
	}
	seen := make(map[string]struct{}, len(c.SLOs))
	for i, s := range c.SLOs {
		if !nameRE.MatchString(s.Name) {
			return fmt.Errorf("slos[%d].name: %q must match %s", i, s.Name, nameRE)
		}
		if s.SLI.GoodEvents == "" || s.SLI.ValidEvents == "" {
			return fmt.Errorf("slos[%d] (%s).sli: good_events and valid_events required", i, s.Name)
		}
		if s.Objective <= 0 || s.Objective >= 100 {
			return fmt.Errorf("slos[%d] (%s).objective: %v must be in (0, 100)", i, s.Name, s.Objective)
		}
		if !windowRE.MatchString(s.Window) {
			return fmt.Errorf("slos[%d] (%s).window: %q must match %s", i, s.Name, s.Window, windowRE)
		}
		if s.FastBurnSeverity != "" &&
			s.FastBurnSeverity != "page" && s.FastBurnSeverity != "ticket" {
			return fmt.Errorf(
				"slos[%d] (%s).fast_burn_severity: %q must be page or ticket",
				i, s.Name, s.FastBurnSeverity,
			)
		}
		if _, dup := seen[s.Name]; dup {
			return fmt.Errorf("slos[%d].name: %q duplicates earlier entry", i, s.Name)
		}
		seen[s.Name] = struct{}{}
	}
	return nil
}

// parseCatalog is a minimal strict-YAML parser purposefully duplicated
// from cmd/slogen so the runtime tracker has zero third-party YAML
// dependency. Any divergence between the two parsers is caught by the
// shared catalogue and the cmd/slogen validate tests.
func parseCatalog(text string) (*Catalog, error) {
	c := &Catalog{}
	scanner := bufio.NewScanner(strings.NewReader(text))
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)

	versionSeen := false
	inSLOs := false
	var current *SLO
	var inSLI bool
	lineNum := 0

	const indentUnit = "  "
	const fieldIndent = indentUnit + indentUnit
	const subFieldIndent = fieldIndent + indentUnit

	for scanner.Scan() {
		lineNum++
		raw := scanner.Text()
		line := stripComment(raw)
		if strings.TrimSpace(line) == "" {
			continue
		}

		if !strings.HasPrefix(line, " ") {
			head, val, _ := strings.Cut(line, ":")
			head = strings.TrimSpace(head)
			val = strings.TrimSpace(val)
			switch head {
			case "version":
				v, err := strconv.Atoi(val)
				if err != nil {
					return nil, fmt.Errorf("line %d: version: %w", lineNum, err)
				}
				c.Version = v
				versionSeen = true
				inSLOs = false
				current = nil
			case "slos":
				if val != "" {
					return nil, fmt.Errorf("line %d: slos must be a block mapping", lineNum)
				}
				inSLOs = true
				current = nil
			default:
				return nil, fmt.Errorf("line %d: unknown top-level key %q", lineNum, head)
			}
			continue
		}

		if !inSLOs {
			return nil, fmt.Errorf("line %d: indented content outside slos", lineNum)
		}

		if strings.HasPrefix(line, indentUnit+"- ") {
			if current != nil {
				c.SLOs = append(c.SLOs, *current)
			}
			rest := strings.TrimPrefix(line, indentUnit+"- ")
			head, val, _ := strings.Cut(rest, ":")
			head = strings.TrimSpace(head)
			val = unquote(strings.TrimSpace(val))
			if head != "name" {
				return nil, fmt.Errorf("line %d: SLO must start with `- name:`", lineNum)
			}
			current = &SLO{Name: val}
			inSLI = false
			continue
		}

		if current == nil {
			return nil, fmt.Errorf("line %d: SLO field before any `- name:`", lineNum)
		}

		if strings.HasPrefix(line, subFieldIndent) {
			if !inSLI {
				return nil, fmt.Errorf("line %d: nested field outside `sli:`", lineNum)
			}
			rest := strings.TrimPrefix(line, subFieldIndent)
			head, val, _ := strings.Cut(rest, ":")
			head = strings.TrimSpace(head)
			val = unquote(strings.TrimSpace(val))
			switch head {
			case "good_events":
				current.SLI.GoodEvents = val
			case "valid_events":
				current.SLI.ValidEvents = val
			default:
				return nil, fmt.Errorf("line %d: unknown sli field %q", lineNum, head)
			}
			continue
		}

		if !strings.HasPrefix(line, fieldIndent) {
			return nil, fmt.Errorf("line %d: unexpected indentation", lineNum)
		}
		rest := strings.TrimPrefix(line, fieldIndent)
		head, val, _ := strings.Cut(rest, ":")
		head = strings.TrimSpace(head)
		val = strings.TrimSpace(val)
		switch head {
		case "description":
			current.Description = unquote(val)
			inSLI = false
		case "sli":
			if val != "" {
				return nil, fmt.Errorf("line %d: sli must be a block mapping", lineNum)
			}
			inSLI = true
		case "objective":
			f, err := strconv.ParseFloat(val, 64)
			if err != nil {
				return nil, fmt.Errorf("line %d: objective: %w", lineNum, err)
			}
			current.Objective = f
			inSLI = false
		case "window":
			current.Window = unquote(val)
			inSLI = false
		case "owner":
			current.Owner = unquote(val)
			inSLI = false
		case "fast_burn_severity":
			current.FastBurnSeverity = unquote(val)
			inSLI = false
		case "tags":
			tags, err := parseInlineArray(val)
			if err != nil {
				return nil, fmt.Errorf("line %d: tags: %w", lineNum, err)
			}
			current.Tags = tags
			inSLI = false
		default:
			return nil, fmt.Errorf("line %d: unknown field %q", lineNum, head)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan: %w", err)
	}
	if current != nil {
		c.SLOs = append(c.SLOs, *current)
	}
	if !versionSeen {
		return nil, fmt.Errorf("missing top-level version key")
	}
	return c, nil
}

func stripComment(line string) string {
	out := make([]byte, 0, len(line))
	inQuote := false
	for i := 0; i < len(line); i++ {
		ch := line[i]
		if ch == '"' && (i == 0 || line[i-1] != '\\') {
			inQuote = !inQuote
		}
		if ch == '#' && !inQuote {
			break
		}
		out = append(out, ch)
	}
	return strings.TrimRight(string(out), " \t\r")
}

func unquote(v string) string {
	if len(v) >= 2 && v[0] == '"' && v[len(v)-1] == '"' {
		s, err := strconv.Unquote(v)
		if err == nil {
			return s
		}
	}
	if len(v) >= 2 && v[0] == '\'' && v[len(v)-1] == '\'' {
		return v[1 : len(v)-1]
	}
	return v
}

func parseInlineArray(v string) ([]string, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil, nil
	}
	if v[0] != '[' || v[len(v)-1] != ']' {
		return nil, fmt.Errorf("expected inline array")
	}
	body := strings.TrimSpace(v[1 : len(v)-1])
	if body == "" {
		return []string{}, nil
	}
	parts := strings.Split(body, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		out = append(out, unquote(strings.TrimSpace(p)))
	}
	return out, nil
}
