package router

import (
	"bufio"
	"bytes"
	_ "embed"
	"fmt"
	"strings"
)

// routingYAML is the shipped routing.yaml content, baked into the
// binary via //go:embed so the router never depends on filesystem
// layout at runtime. The package's tests exercise alternative YAML
// strings via loadFrom; production code only ever sees this embedded
// payload through Load / LoadMap.
//
//go:embed routing.yaml
var routingYAML []byte

// validDestinations is the closed allow-list checked by validateEntries.
// Every Destination const in types.go MUST appear here; the package's
// tests do not enforce that link directly because the const set is
// small and visually obvious in code review. Adding a new Destination
// without adding it here would make routing.yaml unable to use it,
// which is the desired fail-fast behaviour.
var validDestinations = map[Destination]struct{}{
	DestPositions:         {},
	DestClimateSnapshot:   {},
	DestSecurityEvent:     {},
	DestMotorSnapshot:     {},
	DestTirePressure:      {},
	DestMediaSnapshot:     {},
	DestSafetySnapshot:    {},
	DestLocationSnapshot:  {},
	DestChargingTelemetry: {},
	DestDriveTelemetry:    {},
	DestSignalLog:         {},
	DestUnitHistory:       {},
	DestDrop:              {},
}

// Load parses the embedded routing.yaml and returns the validated
// list of entries in declaration order. Returns a non-nil error if
// the file is malformed, contains a duplicate Field, or names a
// Destination outside the closed set.
//
// Callers that need lookup-by-Field semantics should prefer LoadMap.
func Load() ([]Entry, error) {
	return loadFrom(routingYAML)
}

// LoadMap is Load + a final pass that builds map[Field] -> Entry.
// Duplicate keys are caught by the underlying validateEntries pass,
// not here, so the map is guaranteed unique on return.
func LoadMap() (map[string]Entry, error) {
	entries, err := Load()
	if err != nil {
		return nil, err
	}
	m := make(map[string]Entry, len(entries))
	for _, e := range entries {
		m[e.Field] = e
	}
	return m, nil
}

// loadFrom is the test entry point. It accepts an arbitrary YAML
// payload so the table-tests can feed the validator hand-crafted
// failure cases (duplicate field, unknown destination) without
// having to mutate the embedded routing.yaml file.
func loadFrom(b []byte) ([]Entry, error) {
	entries, err := parseRoutingYAML(b)
	if err != nil {
		return nil, fmt.Errorf("parse routing.yaml: %w", err)
	}
	if err := validateEntries(entries); err != nil {
		return nil, fmt.Errorf("validate routing.yaml: %w", err)
	}
	return entries, nil
}

// validateEntries enforces the two startup invariants from ADR-004 #8:
// no duplicate Field across entries, and every Destination is in the
// closed validDestinations set. Per-destination column requirements live
// with each writer's tests, so this loader stays intentionally minimal.
func validateEntries(entries []Entry) error {
	seen := make(map[string]struct{}, len(entries))
	for i, e := range entries {
		if e.Field == "" {
			return fmt.Errorf("entry %d: missing field", i)
		}
		if _, dup := seen[e.Field]; dup {
			return fmt.Errorf("duplicate routing entry for field %q", e.Field)
		}
		seen[e.Field] = struct{}{}
		if _, ok := validDestinations[e.Destination]; !ok {
			return fmt.Errorf("entry %d (%s): unknown destination %q", i, e.Field, e.Destination)
		}
	}
	return nil
}

// parseRoutingYAML is a deliberately tiny YAML parser tailored to the
// restricted shape routing.yaml is allowed to take. It exists because
// pulling in gopkg.in/yaml.v3 as a direct dependency would be excessive
// for this constrained routing format.
//
// The grammar handled is:
//
//	# comment lines and blank lines are skipped
//	routes: []                             # empty-list shorthand
//	routes:                                # multi-entry form
//	  - field: <CanonicalName>
//	    dest: <destination>
//	    column: <optional_column>          # optional
//	    also_signal_log: true|false        # optional
//
// Anything outside this grammar — quoted multi-line scalars, anchors,
// flow-style mappings beyond `[]`, alternative top-level keys — is a
// parse error so subtly malformed entries cannot be accepted silently.
func parseRoutingYAML(b []byte) ([]Entry, error) {
	var (
		entries []Entry
		current *Entry
	)
	scanner := bufio.NewScanner(bytes.NewReader(b))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	sawRoutesKey := false
	emptyListSeen := false
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		raw := scanner.Text()
		// Strip inline comments. The restricted grammar disallows
		// quoted scalars containing '#', so the first '#' always
		// starts a comment.
		if i := strings.Index(raw, "#"); i >= 0 {
			raw = raw[:i]
		}
		line := strings.TrimRight(raw, " \t")
		if line == "" {
			continue
		}

		trimmed := strings.TrimLeft(line, " \t")
		indent := len(line) - len(trimmed)

		if indent == 0 {
			// Top-level key. Only `routes:` is recognised.
			switch {
			case trimmed == "routes:":
				if sawRoutesKey {
					return nil, fmt.Errorf("line %d: duplicate top-level key %q", lineNum, "routes")
				}
				sawRoutesKey = true
			case trimmed == "routes: []":
				if sawRoutesKey {
					return nil, fmt.Errorf("line %d: duplicate top-level key %q", lineNum, "routes")
				}
				sawRoutesKey = true
				emptyListSeen = true
			default:
				return nil, fmt.Errorf("line %d: unsupported top-level token %q (only `routes:` or `routes: []` allowed)", lineNum, trimmed)
			}
			continue
		}

		if !sawRoutesKey {
			return nil, fmt.Errorf("line %d: indented entry before `routes:` key", lineNum)
		}
		if emptyListSeen {
			return nil, fmt.Errorf("line %d: indented entry after `routes: []` empty-list shorthand", lineNum)
		}

		// Indented line: either `- key: value` (new list item) or
		// `key: value` (continuation of the current item).
		if strings.HasPrefix(trimmed, "- ") {
			if current != nil {
				entries = append(entries, *current)
			}
			current = &Entry{}
			rest := strings.TrimPrefix(trimmed, "- ")
			if err := setEntryField(current, rest, lineNum); err != nil {
				return nil, err
			}
			continue
		}

		if current == nil {
			return nil, fmt.Errorf("line %d: continuation key %q without enclosing list item", lineNum, trimmed)
		}
		if err := setEntryField(current, trimmed, lineNum); err != nil {
			return nil, err
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan routing.yaml: %w", err)
	}
	if current != nil {
		entries = append(entries, *current)
	}
	if !sawRoutesKey {
		return nil, fmt.Errorf("missing `routes:` top-level key")
	}
	return entries, nil
}

// setEntryField mutates e with one `key: value` pair. Unknown keys
// are a parse error so a typo in routing.yaml fails fast at startup
// rather than silently dropping the field's destination.
func setEntryField(e *Entry, kv string, lineNum int) error {
	colon := strings.Index(kv, ":")
	if colon < 0 {
		return fmt.Errorf("line %d: missing `:` in %q", lineNum, kv)
	}
	key := strings.TrimSpace(kv[:colon])
	val := strings.TrimSpace(kv[colon+1:])
	// Strip a single layer of surrounding double quotes if present;
	// the restricted grammar does not support escapes inside.
	if len(val) >= 2 && val[0] == '"' && val[len(val)-1] == '"' {
		val = val[1 : len(val)-1]
	}

	switch key {
	case "field":
		if val == "" {
			return fmt.Errorf("line %d: empty field name", lineNum)
		}
		if e.Field != "" {
			return fmt.Errorf("line %d: duplicate `field:` within entry (already %q)", lineNum, e.Field)
		}
		e.Field = val
	case "dest":
		if val == "" {
			return fmt.Errorf("line %d: empty dest", lineNum)
		}
		e.Destination = Destination(val)
	case "column":
		e.Column = val
	case "also_signal_log":
		switch val {
		case "true":
			e.ToColdLogToo = true
		case "false":
			e.ToColdLogToo = false
		default:
			return fmt.Errorf("line %d: also_signal_log must be true or false, got %q", lineNum, val)
		}
	default:
		return fmt.Errorf("line %d: unknown entry key %q (allowed: field, dest, column, also_signal_log)", lineNum, key)
	}
	return nil
}
