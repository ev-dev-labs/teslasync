// Command slogen is the SLO codegen toolkit.
//
// Usage:
//
//	slogen validate <catalog.yaml>
//	    Validates the catalog against the embedded schema and exits non-zero
//	    on any violation.
//
//	slogen generate recording [--catalog slo/catalog.yaml] [--out <file>]
//	    Regenerates the Prometheus recording rules YAML from the catalog.
//	    Default output: helm/teslasync/files/prometheus/recording-rules.yaml.
//
// Implementation note:
//
//	cmd/slogen intentionally depends only on the Go standard library so
//	that the codegen toolkit does not pull new modules into go.mod. The
//	catalogue therefore obeys a strict YAML subset (single-line scalars,
//	inline arrays for `tags`, two-space indentation) that the parser in
//	this file enforces. The strict subset is documented in
//	`slo/catalog.yaml` and pinned by `slo/catalog.schema.json`.
package main

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

const (
	requiredVersion = 1
	indentUnit      = "  "
)

// Catalog mirrors the strict YAML subset described above and the JSON
// Schema in slo/catalog.schema.json.
type Catalog struct {
	Version int
	SLOs    []SLO
}

type SLO struct {
	Name             string
	Description      string
	SLI              SLI
	Objective        float64
	Window           string
	Owner            string
	FastBurnSeverity string
	Tags             []string

	line int // 1-based line number of the `- name:` marker, used in errors.
}

type SLI struct {
	GoodEvents  string
	ValidEvents string
}

var (
	nameRE   = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	windowRE = regexp.MustCompile(`^[0-9]+[mhdw]$`)
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "validate":
		if len(os.Args) < 3 {
			usage()
			os.Exit(2)
		}
		if err := validateFile(os.Args[2]); err != nil {
			fmt.Fprintf(os.Stderr, "validate: %v\n", err)
			os.Exit(1)
		}
		fmt.Fprintln(os.Stdout, "catalog OK")
	case "generate":
		if err := runGenerate(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "generate: %v\n", err)
			os.Exit(1)
		}
	case "-h", "--help", "help":
		usage()
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage:")
	fmt.Fprintln(os.Stderr, "  slogen validate <catalog.yaml>")
	fmt.Fprintln(os.Stderr, "  slogen generate recording  [--catalog FILE] [--out FILE]")
	fmt.Fprintln(os.Stderr, "  slogen generate alerts     [--catalog FILE] [--out FILE]")
	fmt.Fprintln(os.Stderr, "  slogen generate dashboards [--catalog FILE] [--out-dir DIR]")
}

// validateFile parses the catalogue and applies the schema invariants.
// Returns the first violation as an error.
func validateFile(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	cat, err := parseCatalog(string(raw))
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return validateCatalog(cat)
}

func validateCatalog(c *Catalog) error {
	if c.Version != requiredVersion {
		return fmt.Errorf("version: got %d want %d", c.Version, requiredVersion)
	}
	if len(c.SLOs) == 0 {
		return fmt.Errorf("slos: at least one entry required")
	}
	seen := make(map[string]struct{}, len(c.SLOs))
	for i, s := range c.SLOs {
		if err := validateSLO(i, s); err != nil {
			return err
		}
		if _, dup := seen[s.Name]; dup {
			return fmt.Errorf("slos[%d] (line %d).name: %q duplicates earlier entry", i, s.line, s.Name)
		}
		seen[s.Name] = struct{}{}
	}
	return nil
}

func validateSLO(idx int, s SLO) error {
	tag := func(field string) string {
		return fmt.Sprintf("slos[%d] (line %d).%s", idx, s.line, field)
	}
	if !nameRE.MatchString(s.Name) {
		return fmt.Errorf("%s: %q must match %s", tag("name"), s.Name, nameRE)
	}
	if len(s.Description) < 10 {
		return fmt.Errorf("%s: must be >= 10 chars", tag("description"))
	}
	if s.SLI.GoodEvents == "" {
		return fmt.Errorf("%s: required", tag("sli.good_events"))
	}
	if s.SLI.ValidEvents == "" {
		return fmt.Errorf("%s: required", tag("sli.valid_events"))
	}
	if s.Objective <= 0 || s.Objective >= 100 {
		return fmt.Errorf("%s: %v must be in (0, 100)", tag("objective"), s.Objective)
	}
	if !windowRE.MatchString(s.Window) {
		return fmt.Errorf("%s: %q must match %s", tag("window"), s.Window, windowRE)
	}
	if s.Owner == "" {
		return fmt.Errorf("%s: required", tag("owner"))
	}
	if s.FastBurnSeverity != "" && s.FastBurnSeverity != "page" && s.FastBurnSeverity != "ticket" {
		return fmt.Errorf("%s: %q must be page or ticket", tag("fast_burn_severity"), s.FastBurnSeverity)
	}
	tagSet := make(map[string]struct{}, len(s.Tags))
	for _, t := range s.Tags {
		if t == "" {
			return fmt.Errorf("%s: empty tag forbidden", tag("tags"))
		}
		if _, dup := tagSet[t]; dup {
			return fmt.Errorf("%s: duplicate %q", tag("tags"), t)
		}
		tagSet[t] = struct{}{}
	}
	return nil
}

// parseCatalog implements a small, strict YAML parser tailored to the
// catalogue layout. The parser rejects any structure that does not match
// the documented subset (no block scalars, no flow maps, two-space
// indentation only).
func parseCatalog(text string) (*Catalog, error) {
	c := &Catalog{}
	scanner := bufio.NewScanner(strings.NewReader(text))
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)

	versionSeen := false
	inSLOs := false
	var current *SLO
	var inSLI bool
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		raw := scanner.Text()
		line := stripComment(raw)
		if strings.TrimSpace(line) == "" {
			continue
		}

		// Top-level keys: version: / slos:
		if !strings.HasPrefix(line, " ") {
			head, val, _ := strings.Cut(line, ":")
			head = strings.TrimSpace(head)
			val = strings.TrimSpace(val)
			switch head {
			case "version":
				if val == "" {
					return nil, fmt.Errorf("line %d: version requires a value", lineNum)
				}
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
					return nil, fmt.Errorf("line %d: slos must be a block mapping (no inline value)", lineNum)
				}
				inSLOs = true
				current = nil
			default:
				return nil, fmt.Errorf("line %d: unknown top-level key %q", lineNum, head)
			}
			continue
		}

		if !inSLOs {
			return nil, fmt.Errorf("line %d: indented content outside slos block", lineNum)
		}

		// Item start: `  - name: <value>`
		if strings.HasPrefix(line, indentUnit+"- ") {
			if current != nil {
				c.SLOs = append(c.SLOs, *current)
			}
			rest := strings.TrimPrefix(line, indentUnit+"- ")
			head, val, _ := strings.Cut(rest, ":")
			head = strings.TrimSpace(head)
			val = unquote(strings.TrimSpace(val))
			if head != "name" {
				return nil, fmt.Errorf("line %d: SLO item must start with `- name:`, got %q", lineNum, head)
			}
			current = &SLO{Name: val, line: lineNum}
			inSLI = false
			continue
		}

		if current == nil {
			return nil, fmt.Errorf("line %d: SLO field before any `- name:`", lineNum)
		}

		// Field lines must use 4-space indentation (one level deeper than `-`).
		const fieldIndent = indentUnit + indentUnit
		const subFieldIndent = fieldIndent + indentUnit

		if strings.HasPrefix(line, subFieldIndent) {
			if !inSLI {
				return nil, fmt.Errorf("line %d: nested field outside `sli:` not supported", lineNum)
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
			return nil, fmt.Errorf("line %d: unexpected indentation %q", lineNum, line)
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
				return nil, fmt.Errorf("line %d: sli must be a block mapping (no inline value)", lineNum)
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
			return nil, fmt.Errorf("line %d: unknown SLO field %q", lineNum, head)
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
	// A `#` outside a quoted string starts a comment. Walk the line and
	// honour double-quoted scalars (the only quoting style the catalogue
	// uses) so a `#` inside a PromQL label value is preserved.
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
		return nil, fmt.Errorf("expected inline array `[a, b]`, got %q", v)
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
