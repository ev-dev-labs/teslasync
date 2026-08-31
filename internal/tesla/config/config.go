package config

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"text/template"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// subscriptionTemplate is the Go text/template that renders the Fleet
// Telemetry subscription body. It is intentionally flat: it owns
// whitespace and punctuation only; field selection and per-field
// cadence come from intervals.go. The template output is parsed back
// through encoding/json before being returned so a malformed template
// fails loudly at build time rather than at the Tesla edge.
//
//go:embed templates/full_subscription.json.tmpl
var subscriptionTemplate string

// DefaultHostname is the placeholder Fleet Telemetry endpoint the
// builder emits when no override is supplied. The production deployment
// replaces this via Builder.Hostname before sending the body to the
// vehicle command proxy; the default exists so test fixtures and
// preview tooling produce parseable JSON without extra plumbing.
const DefaultHostname = "fleet-telemetry.local"

// DefaultPort is the placeholder Fleet Telemetry TLS port. Same
// rationale as DefaultHostname: production overrides via Builder.Port.
const DefaultPort = 443

// Builder produces Tesla Fleet Telemetry subscription JSON bodies.
//
// Builder is intentionally stateless other than the optional Hostname
// and Port overrides: the field list and per-field cadences derive
// entirely from protomodel.Signals + intervals.go, both of which are
// package-level constants. A single Builder instance is safe for
// concurrent use and can be shared across the process.
//
// HTTP delivery is NOT a Builder responsibility. The Tesla
// VehicleCommand proxy client at internal/tesla/client_fleet_telemetry.go
// owns the POST /api/1/vehicles/fleet_telemetry_config call; Builder
// only produces the JSON body that client sends.
type Builder struct {
	// Hostname is the Fleet Telemetry server VINs should connect to.
	// Empty falls back to DefaultHostname.
	Hostname string

	// Port is the Fleet Telemetry TLS port VINs should connect to.
	// Zero falls back to DefaultPort.
	Port int
}

// NewBuilder returns a Builder configured with the placeholder hostname
// and port. Production callers should set Hostname and Port explicitly
// before calling BuildFor.
func NewBuilder() *Builder {
	return &Builder{Hostname: DefaultHostname, Port: DefaultPort}
}

// FieldEntry is one rendered Fleet Telemetry field policy. Exposed so tests
// and previews can inspect the exact list the Builder will send to Tesla
// without parsing the JSON body back.
type FieldEntry struct {
	Name            string
	IntervalSeconds int
	MinimumDelta    *float64
	IncludeFields   []string
}

// templateData is the input to full_subscription.json.tmpl. Kept
// unexported because the template's exact field shape is an
// implementation detail of the Builder.
type templateData struct {
	Hostname string
	Port     int
	VINs     []string
	Fields   []FieldEntry
}

// SubscriptionFields returns the alphabetically-sorted list of
// (Field, interval_seconds) pairs that BuildSubscription/BuildFor will
// emit. Iterating protomodel.Signals once and sorting by Field name
// keeps the output byte-stable across Go map-iteration order.
//
// Signals with Category == "metadata" are skipped: the metadata bucket
// holds the Tesla proto's Unknown / Deprecated_* / Experimental_*
// sentinel Fields, none of which produce real telemetry, and
// subscribing to them would only waste signal_log row budget on values
// that can never decode.
func (b *Builder) SubscriptionFields() []FieldEntry {
	out := make([]FieldEntry, 0, len(protomodel.Signals))
	for i := range protomodel.Signals {
		s := &protomodel.Signals[i]
		if s.Category == "metadata" {
			continue
		}
		policy, ok := PolicyFor(s.Field)
		if !ok || policy.IntervalSeconds <= 0 {
			continue
		}
		out = append(out, FieldEntry{
			Name:            s.Field,
			IntervalSeconds: policy.IntervalSeconds,
			MinimumDelta:    policy.MinimumDelta,
			IncludeFields:   policy.IncludeFields,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// BuildSubscription returns the JSON body Tesla expects for the
// fleet_telemetry_config endpoint with no VINs attached. Useful for
// previewing the subscription shape and for tests that only care about
// the fields map.
func (b *Builder) BuildSubscription() ([]byte, error) {
	return b.BuildFor(nil)
}

// BuildFor returns a per-vehicle subscription body. Tesla requires the
// VINs to appear in the request even when the field list is identical
// for every vehicle, so callers pass them explicitly rather than the
// Builder learning them by side effect.
//
// VINs are sorted alphabetically before emit so two callers passing
// the same set in different orders produce byte-identical output (a
// precondition for the deterministic-output test).
func (b *Builder) BuildFor(vins []string) ([]byte, error) {
	hostname := b.Hostname
	if hostname == "" {
		hostname = DefaultHostname
	}
	port := b.Port
	if port == 0 {
		port = DefaultPort
	}

	// Defensive copy + sort. We never want to mutate the caller's
	// slice, and json.Marshal on a nil slice emits "null" while we
	// want "[]" so the body is always parseable as an array.
	sortedVINs := make([]string, 0, len(vins))
	sortedVINs = append(sortedVINs, vins...)
	sort.Strings(sortedVINs)

	data := templateData{
		Hostname: hostname,
		Port:     port,
		VINs:     sortedVINs,
		Fields:   b.SubscriptionFields(),
	}

	tmpl, err := template.New("subscription").Funcs(template.FuncMap{
		// json escapes a value into a valid JSON literal. Used for
		// every string the template emits so VINs and Field names
		// containing reserved characters can never break the output.
		"json": func(v interface{}) (string, error) {
			b, err := json.Marshal(v)
			if err != nil {
				return "", err
			}
			return string(b), nil
		},
	}).Parse(subscriptionTemplate)
	if err != nil {
		return nil, fmt.Errorf("parse subscription template: %w", err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return nil, fmt.Errorf("execute subscription template: %w", err)
	}

	// Round-trip through encoding/json so the returned bytes are both
	// validated as parseable JSON and pretty-printed canonically.
	// json.MarshalIndent sorts map keys alphabetically, which combines
	// with the alphabetically-sorted Fields slice and sorted VINs to
	// guarantee byte-stability across Builder invocations.
	var v interface{}
	if err := json.Unmarshal(buf.Bytes(), &v); err != nil {
		return nil, fmt.Errorf("validate subscription JSON: %w", err)
	}
	out, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal subscription JSON: %w", err)
	}
	return out, nil
}
