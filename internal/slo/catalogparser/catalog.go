// Package catalogparser parses the strict SLO catalog subset shared by runtime
// and code-generation code.
package catalogparser

import (
	"bufio"
	"fmt"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
)

const (
	RequiredVersion = 1
	indentUnit      = "  "
)

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
	Line             int
}

type SLI struct {
	GoodEvents  string
	ValidEvents string
}

var (
	NameRE          = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	WindowRE        = regexp.MustCompile(`^[0-9]+[mhdw]$`)
	objectiveNumber = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)
)

func Parse(text string) (*Catalog, error) {
	c := &Catalog{}
	scanner := bufio.NewScanner(strings.NewReader(text))
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)

	versionSeen := false
	slosSeen := false
	inSLOs := false
	var current *SLO
	var currentSeen map[string]bool
	inSLI := false
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		raw := scanner.Text()
		line := StripComment(raw)
		if strings.TrimSpace(line) == "" {
			continue
		}
		if strings.Contains(line[:leadingWhitespaceLen(line)], "\t") {
			return nil, fmt.Errorf("line %d: tabs are not allowed for indentation", lineNum)
		}

		indent := countLeadingSpaces(line)
		if indent == 0 {
			head, val, ok := strings.Cut(line, ":")
			if !ok {
				return nil, fmt.Errorf("line %d: expected key: value", lineNum)
			}
			head = strings.TrimSpace(head)
			val = strings.TrimSpace(val)
			switch head {
			case "version":
				if versionSeen {
					return nil, fmt.Errorf("line %d: duplicate top-level key %q", lineNum, head)
				}
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
				inSLI = false
			case "slos":
				if slosSeen {
					return nil, fmt.Errorf("line %d: duplicate top-level key %q", lineNum, head)
				}
				if val != "" {
					return nil, fmt.Errorf("line %d: slos must be a block mapping (no inline value)", lineNum)
				}
				slosSeen = true
				inSLOs = true
				current = nil
				inSLI = false
			default:
				return nil, fmt.Errorf("line %d: unknown top-level key %q", lineNum, head)
			}
			continue
		}

		if !inSLOs {
			return nil, fmt.Errorf("line %d: indented content outside slos block", lineNum)
		}

		if strings.HasPrefix(strings.TrimLeft(line, " "), "- ") && indent != 2 {
			return nil, fmt.Errorf("line %d: unexpected indentation %q", lineNum, line)
		}
		if indent == 2 && strings.HasPrefix(line, indentUnit+"- ") {
			if current != nil {
				c.SLOs = append(c.SLOs, *current)
			}
			rest := strings.TrimPrefix(line, indentUnit+"- ")
			head, val, ok := strings.Cut(rest, ":")
			if !ok {
				return nil, fmt.Errorf("line %d: expected key: value in SLO item", lineNum)
			}
			head = strings.TrimSpace(head)
			if head != "name" {
				return nil, fmt.Errorf("line %d: SLO item must start with `- name:`, got %q", lineNum, head)
			}
			val = strings.TrimSpace(val)
			if val == "" {
				return nil, fmt.Errorf("line %d: name requires a value", lineNum)
			}
			value, err := parseScalar(val, lineNum, "name")
			if err != nil {
				return nil, err
			}
			current = &SLO{Name: value, Line: lineNum}
			currentSeen = map[string]bool{"name": true}
			inSLI = false
			continue
		}

		if current == nil {
			return nil, fmt.Errorf("line %d: SLO field before any `- name:`", lineNum)
		}

		if indent == 6 {
			if !inSLI {
				return nil, fmt.Errorf("line %d: nested field outside `sli:`", lineNum)
			}
			rest := strings.TrimPrefix(line, indentUnit+indentUnit+indentUnit)
			head, val, ok := strings.Cut(rest, ":")
			if !ok {
				return nil, fmt.Errorf("line %d: expected key: value in sli block", lineNum)
			}
			head = strings.TrimSpace(head)
			if _, seen := currentSeen["sli."+head]; seen {
				return nil, fmt.Errorf("line %d: duplicate SLO field %q", lineNum, "sli."+head)
			}
			val = strings.TrimSpace(val)
			switch head {
			case "good_events":
				if val == "" {
					return nil, fmt.Errorf("line %d: good_events requires a value", lineNum)
				}
				value, err := parseScalar(val, lineNum, "good_events")
				if err != nil {
					return nil, err
				}
				current.SLI.GoodEvents = value
				currentSeen["sli."+head] = true
			case "valid_events":
				if val == "" {
					return nil, fmt.Errorf("line %d: valid_events requires a value", lineNum)
				}
				value, err := parseScalar(val, lineNum, "valid_events")
				if err != nil {
					return nil, err
				}
				current.SLI.ValidEvents = value
				currentSeen["sli."+head] = true
			default:
				return nil, fmt.Errorf("line %d: unknown sli field %q", lineNum, head)
			}
			continue
		}

		if indent != 4 {
			return nil, fmt.Errorf("line %d: unexpected indentation %q", lineNum, line)
		}
		rest := strings.TrimPrefix(line, indentUnit+indentUnit)
		head, val, ok := strings.Cut(rest, ":")
		if !ok {
			return nil, fmt.Errorf("line %d: expected key: value in SLO field", lineNum)
		}
		head = strings.TrimSpace(head)
		if _, seen := currentSeen[head]; seen {
			return nil, fmt.Errorf("line %d: duplicate SLO field %q", lineNum, head)
		}
		val = strings.TrimSpace(val)

		switch head {
		case "description":
			if val == "" {
				return nil, fmt.Errorf("line %d: description requires a value", lineNum)
			}
			value, err := parseScalar(val, lineNum, "description")
			if err != nil {
				return nil, err
			}
			current.Description = value
			currentSeen[head] = true
			inSLI = false
		case "sli":
			if val != "" {
				return nil, fmt.Errorf("line %d: sli must be a block mapping (no inline value)", lineNum)
			}
			currentSeen[head] = true
			inSLI = true
		case "objective":
			if val == "" {
				return nil, fmt.Errorf("line %d: objective requires a value", lineNum)
			}
			if !objectiveNumber.MatchString(val) {
				return nil, fmt.Errorf("line %d: objective: malformed number %q", lineNum, val)
			}
			f, err := strconv.ParseFloat(val, 64)
			if err != nil {
				return nil, fmt.Errorf("line %d: objective: %w", lineNum, err)
			}
			if math.IsNaN(f) || math.IsInf(f, 0) {
				return nil, fmt.Errorf("line %d: objective: number must be finite", lineNum)
			}
			current.Objective = f
			currentSeen[head] = true
			inSLI = false
		case "window":
			if val == "" {
				return nil, fmt.Errorf("line %d: window requires a value", lineNum)
			}
			value, err := parseScalar(val, lineNum, "window")
			if err != nil {
				return nil, err
			}
			current.Window = value
			currentSeen[head] = true
			inSLI = false
		case "owner":
			if val == "" {
				return nil, fmt.Errorf("line %d: owner requires a value", lineNum)
			}
			value, err := parseScalar(val, lineNum, "owner")
			if err != nil {
				return nil, err
			}
			current.Owner = value
			currentSeen[head] = true
			inSLI = false
		case "fast_burn_severity":
			if val == "" {
				return nil, fmt.Errorf("line %d: fast_burn_severity requires a value", lineNum)
			}
			value, err := parseScalar(val, lineNum, "fast_burn_severity")
			if err != nil {
				return nil, err
			}
			current.FastBurnSeverity = value
			currentSeen[head] = true
			inSLI = false
		case "tags":
			if val == "" {
				return nil, fmt.Errorf("line %d: tags requires an inline array value", lineNum)
			}
			tags, err := ParseInlineArray(val)
			if err != nil {
				return nil, fmt.Errorf("line %d: tags: %w", lineNum, err)
			}
			current.Tags = tags
			currentSeen[head] = true
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
	if !slosSeen {
		return nil, fmt.Errorf("missing top-level slos key")
	}
	return c, nil
}

// Load reads and parses a catalog file.
func Load(path string) (*Catalog, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	c, err := Parse(string(raw))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return c, nil
}

// Validate applies the strict schema invariants and the catalog's uniqueness rules.
func Validate(c *Catalog) error {
	if c.Version != RequiredVersion {
		return fmt.Errorf("version: got %d want %d", c.Version, RequiredVersion)
	}
	if len(c.SLOs) == 0 {
		return fmt.Errorf("slos: at least one entry required")
	}
	seen := make(map[string]struct{}, len(c.SLOs))
	for i, s := range c.SLOs {
		if err := ValidateSLO(i, s); err != nil {
			return err
		}
		if _, dup := seen[s.Name]; dup {
			return fmt.Errorf("slos[%d] (line %d).name: %q duplicates earlier entry", i, s.Line, s.Name)
		}
		seen[s.Name] = struct{}{}
	}
	return nil
}

// ValidateRuntime applies the runtime catalog invariants. It is intentionally
// less restrictive than Validate because runtime consumers historically did
// not require code-generation-only fields such as description and owner.
func ValidateRuntime(c *Catalog) error {
	if c == nil {
		return fmt.Errorf("catalog is required")
	}
	if c.Version != RequiredVersion {
		return fmt.Errorf("version: got %d want %d", c.Version, RequiredVersion)
	}
	if len(c.SLOs) == 0 {
		return fmt.Errorf("slos: at least one entry required")
	}
	seen := make(map[string]struct{}, len(c.SLOs))
	for i, s := range c.SLOs {
		if !NameRE.MatchString(s.Name) {
			return fmt.Errorf("slos[%d].name: %q must match %s", i, s.Name, NameRE)
		}
		if s.SLI.GoodEvents == "" || s.SLI.ValidEvents == "" {
			return fmt.Errorf("slos[%d] (%s).sli: good_events and valid_events required", i, s.Name)
		}
		if s.Objective <= 0 || s.Objective >= 100 {
			return fmt.Errorf("slos[%d] (%s).objective: %v must be in (0, 100)", i, s.Name, s.Objective)
		}
		if !WindowRE.MatchString(s.Window) {
			return fmt.Errorf("slos[%d] (%s).window: %q must match %s", i, s.Name, s.Window, WindowRE)
		}
		if s.FastBurnSeverity != "" && s.FastBurnSeverity != "page" && s.FastBurnSeverity != "ticket" {
			return fmt.Errorf("slos[%d] (%s).fast_burn_severity: %q must be page or ticket", i, s.Name, s.FastBurnSeverity)
		}
		if _, dup := seen[s.Name]; dup {
			return fmt.Errorf("slos[%d].name: %q duplicates earlier entry", i, s.Name)
		}
		seen[s.Name] = struct{}{}
	}
	return nil
}

func ValidateSLO(idx int, s SLO) error {
	tag := func(field string) string {
		return fmt.Sprintf("slos[%d] (line %d).%s", idx, s.Line, field)
	}
	if !NameRE.MatchString(s.Name) {
		return fmt.Errorf("%s: %q must match %s", tag("name"), s.Name, NameRE)
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
	if !WindowRE.MatchString(s.Window) {
		return fmt.Errorf("%s: %q must match %s", tag("window"), s.Window, WindowRE)
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

func StripComment(line string) string {
	out := make([]byte, 0, len(line))
	inQuote := false
	escaped := false
	for i := 0; i < len(line); i++ {
		ch := line[i]
		if ch == '"' && !escaped {
			inQuote = !inQuote
		}
		if ch == '#' && !inQuote {
			break
		}
		out = append(out, ch)
		if ch == '\\' && !escaped {
			escaped = true
		} else {
			escaped = false
		}
	}
	return strings.TrimRight(string(out), " \t\r")
}

func Unquote(v string) string {
	value, err := parseScalar(v, 0, "scalar")
	if err == nil {
		return value
	}
	return v
}

func ParseInlineArray(v string) ([]string, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil, fmt.Errorf("expected inline array `[a, b]`")
	}
	if v[0] != '[' || v[len(v)-1] != ']' {
		return nil, fmt.Errorf("expected inline array `[a, b]`, got %q", v)
	}
	body := strings.TrimSpace(v[1 : len(v)-1])
	if body == "" {
		return []string{}, nil
	}
	parts, err := splitInlineArray(body)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			return nil, fmt.Errorf("empty inline array element")
		}
		value, err := parseScalar(p, 0, "tag")
		if err != nil {
			return nil, err
		}
		out = append(out, value)
	}
	return out, nil
}

func splitInlineArray(body string) ([]string, error) {
	var parts []string
	start := 0
	inQuote := false
	quote := byte(0)
	escaped := false
	for i := 0; i < len(body); i++ {
		ch := body[i]
		if inQuote {
			if quote == '"' {
				if ch == '"' && !escaped {
					inQuote = false
					quote = 0
				}
			} else if ch == quote {
				if i+1 < len(body) && body[i+1] == '\'' {
					i++
				} else {
					inQuote = false
					quote = 0
				}
			}
			if ch == '\\' && quote == '"' && !escaped {
				escaped = true
			} else {
				escaped = false
			}
			continue
		}
		if ch == '"' || ch == '\'' {
			inQuote = true
			quote = ch
			continue
		}
		if ch == ',' {
			parts = append(parts, body[start:i])
			start = i + 1
		}
		if ch == '[' || ch == '{' || ch == ']' || ch == '}' {
			return nil, fmt.Errorf("nested inline array or flow map is forbidden")
		}
	}
	if inQuote {
		return nil, fmt.Errorf("unterminated quoted inline array element")
	}
	parts = append(parts, body[start:])
	return parts, nil
}

func parseScalar(v string, line int, field string) (string, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		if line > 0 {
			return "", fmt.Errorf("line %d: %s requires a value", line, field)
		}
		return "", fmt.Errorf("%s requires a value", field)
	}
	if v[0] == '"' {
		if len(v) < 2 || v[len(v)-1] != '"' {
			if line > 0 {
				return "", fmt.Errorf("line %d: %s: unterminated double quote", line, field)
			}
			return "", fmt.Errorf("%s: unterminated double quote", field)
		}
		s, err := strconv.Unquote(v)
		if err != nil {
			if line > 0 {
				return "", fmt.Errorf("line %d: %s: invalid escape: %w", line, field, err)
			}
			return "", fmt.Errorf("%s: invalid escape: %w", field, err)
		}
		return s, nil
	}
	if v[0] == '\'' {
		if len(v) < 2 || v[len(v)-1] != '\'' {
			if line > 0 {
				return "", fmt.Errorf("line %d: %s: unterminated single quote", line, field)
			}
			return "", fmt.Errorf("%s: unterminated single quote", field)
		}
		inner := v[1 : len(v)-1]
		return strings.ReplaceAll(inner, "''", "'"), nil
	}
	if strings.ContainsAny(v, "\"'") {
		if line > 0 {
			return "", fmt.Errorf("line %d: %s: unexpected quote in plain scalar", line, field)
		}
		return "", fmt.Errorf("%s: unexpected quote in plain scalar", field)
	}
	return v, nil
}

func unquote(v string) string {
	value, err := parseScalar(v, 0, "scalar")
	if err == nil {
		return value
	}
	return v
}

func leadingWhitespaceLen(line string) int {
	i := 0
	for i < len(line) && (line[i] == ' ' || line[i] == '\t') {
		i++
	}
	return i
}

func countLeadingSpaces(line string) int {
	i := 0
	for i < len(line) && line[i] == ' ' {
		i++
	}
	return i
}
