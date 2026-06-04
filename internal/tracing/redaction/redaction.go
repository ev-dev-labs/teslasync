// Package redaction implements the mandatory telemetry-redaction processor
// chain mandated by ADR-0074. It scrubs identifiers, geo-coordinates, and
// secret-shaped values from OpenTelemetry span attributes at the SDK source
// (before any exporter sees them) so the redaction is symmetric across every
// exporter — Tempo, Loki, Prometheus, and local debug dumps alike.
//
// ADR-0074 describes the mechanism as a "SpanProcessor chain". The
// OpenTelemetry Go SDK only hands a mutable span to a SpanProcessor at
// OnStart (before attributes are set) and an immutable ReadOnlySpan at
// OnEnd, so attribute rewriting has to happen at the export boundary. We
// therefore implement the chain as a SpanExporter decorator (see
// exporter.go) wrapping the pure Redactor defined here. The Redactor is kept
// dependency-free and side-effect-free (H31) so it is trivially unit-testable
// and fuzzable; all tuning — salt, geo precision, key sets, secret patterns —
// is injected via Config rather than baked in as literals.
package redaction

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"regexp"
	"strconv"
	"strings"

	"go.opentelemetry.io/otel/attribute"
)

// DefaultGeoPrecision is the number of fractional decimal digits a latitude
// or longitude is rounded to when Config does not specify one. Two decimals
// is ~1.1 km of resolution at the equator — enough for "which city" analytics
// while making a home address unrecoverable per ADR-0074.
const DefaultGeoPrecision = 2

// hashPrefix is prepended to every keyed-hash output so a downstream reader
// can tell a value was redacted-by-hash rather than left raw. The salt makes
// the hash correlatable within a deployment but not reversible or comparable
// across deployments.
const hashPrefix = "h:"

// hashHexLen bounds the emitted hash to 16 hex chars (64 bits). That is far
// more than enough to keep per-deployment collisions negligible for trace
// correlation while keeping span attributes compact.
const hashHexLen = 16

// redactedToken is the replacement emitted for secret-shaped substrings.
const redactedToken = "***"

// SecretRule is a single secret-pattern matcher together with the replacement
// template applied to matches. Repl may reference capture groups (e.g. "$1")
// so a rule can preserve a benign prefix ("Bearer ") while scrubbing the
// sensitive remainder.
type SecretRule struct {
	Re   *regexp.Regexp
	Repl string
}

// Config carries every tunable input to the redactor. Nothing here is a
// literal inside the hot path — callers (production wiring + tests) supply it
// so behaviour stays configurable per ADR-0074 and the pure logic stays
// deterministic.
type Config struct {
	// Salt is the per-deployment keyed-hash salt. An empty salt still
	// produces non-reversible output but loses cross-restart correlation,
	// so production wiring should always set OTEL_REDACTION_SALT.
	Salt string

	// GeoPrecision is the number of fractional decimals a lat/long is
	// rounded to. Values < 0 fall back to DefaultGeoPrecision.
	GeoPrecision int

	// IdentifierKeys is the set of attribute keys whose values are keyed-
	// hashed (VIN / vehicle-id / user-id and peers). Matched
	// case-insensitively against the full key.
	IdentifierKeys []string

	// IdentifierKeySuffixes catches namespaced identifier keys (e.g.
	// "teslasync.vehicle_id", "request.user.id", "owner.email") that an
	// exact IdentifierKeys match would miss. A key matches when its
	// lower-cased form ends with one of these suffixes. Kept deliberately
	// specific (".vin", "user_id", ".email", …) so internal row ids like
	// "drive.id" are NOT swept up.
	IdentifierKeySuffixes []string

	// GeoKeySuffixes is the set of trailing key segments that mark a
	// coordinate value (e.g. "lat", "longitude"). A key matches when its
	// final '.'- or '_'-delimited segment equals one of these.
	GeoKeySuffixes []string

	// SecretPatterns is the ordered list of secret-shaped matchers applied
	// to every non-identifier string value.
	SecretPatterns []SecretRule
}

// DefaultConfig returns a Config seeded with TeslaSync's identifier keys, geo
// suffixes, and secret patterns. Callers override individual slices when a
// deployment needs extra coverage.
func DefaultConfig(salt string, geoPrecision int) Config {
	if geoPrecision < 0 {
		geoPrecision = DefaultGeoPrecision
	}
	return Config{
		Salt:                  salt,
		GeoPrecision:          geoPrecision,
		IdentifierKeys:        defaultIdentifierKeys(),
		IdentifierKeySuffixes: defaultIdentifierKeySuffixes(),
		GeoKeySuffixes:        defaultGeoKeySuffixes(),
		SecretPatterns:        defaultSecretRules(),
	}
}

// defaultIdentifierKeys lists the attribute keys this codebase actually stamps
// with reversible identifiers — see internal/tracing/span.go (VehicleVIN,
// VehicleID, …) plus the snake_case variants the HTTP/MQTT instrumentation
// emits. Keys are compared lower-cased.
func defaultIdentifierKeys() []string {
	return []string{
		"vin",
		"vehicle.vin",
		"vehicle_vin",
		"vehicle.id",
		"vehicle_id",
		"vehicleid",
		"user.id",
		"user_id",
		"userid",
		"user.email",
		"driver.id",
		"driver_id",
		"account.id",
		"account_id",
		"enduser.id",
	}
}

// defaultIdentifierKeySuffixes catches namespaced identifier keys an exact
// match would miss. Suffixes are deliberately specific so bare internal row
// ids (drive.id, charge.id, db.row_count) are not swept up.
func defaultIdentifierKeySuffixes() []string {
	return []string{
		".vin", "_vin",
		"vehicle.id", "vehicle_id",
		"user.id", "user_id",
		"driver.id", "driver_id",
		"account.id", "account_id",
		"enduser.id", "enduser_id",
		".email", "_email",
	}
}

// defaultGeoKeySuffixes lists the trailing segments that denote a coordinate.
func defaultGeoKeySuffixes() []string {
	return []string{
		"lat", "latitude",
		"lng", "lon", "long", "longitude",
	}
}

// defaultSecretRules returns the built-in secret matchers. Each rule keeps any
// benign prefix it captures and replaces only the sensitive remainder, so a
// log line stays legible while the credential is gone.
func defaultSecretRules() []SecretRule {
	return []SecretRule{
		// Authorization: Bearer <token> / "bearer <token>".
		{Re: regexp.MustCompile(`(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{8,}`), Repl: "$1" + redactedToken},
		// Basic auth header values.
		{Re: regexp.MustCompile(`(?i)(basic\s+)[A-Za-z0-9+/=]{8,}`), Repl: "$1" + redactedToken},
		// JWT (header.payload.signature) — three base64url segments.
		{Re: regexp.MustCompile(`\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`), Repl: redactedToken},
		// PEM private/secret blocks (collapse the whole armoured body).
		{Re: regexp.MustCompile(`(?s)-----BEGIN [A-Z0-9 ]+-----.*?-----END [A-Z0-9 ]+-----`), Repl: redactedToken},
		// Provider-prefixed API keys: OpenAI sk-…, GitHub ghp_/gho_/…,
		// AWS access-key IDs, Slack xox*, Google AIza…
		{Re: regexp.MustCompile(`\bsk-[A-Za-z0-9]{16,}`), Repl: redactedToken},
		{Re: regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{16,}`), Repl: redactedToken},
		{Re: regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`), Repl: redactedToken},
		{Re: regexp.MustCompile(`\bxox[baprs]-[A-Za-z0-9-]{10,}`), Repl: redactedToken},
		{Re: regexp.MustCompile(`\bAIza[0-9A-Za-z_-]{20,}`), Repl: redactedToken},
		// Generic key=value / key: value secrets (api_key, token, secret,
		// password, access_token, …). Preserves the field name + delimiter.
		{
			Re:   regexp.MustCompile(`(?i)\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|token|authorization)\b\s*[:=]\s*)["']?[^\s"',;}{&]{6,}`),
			Repl: "$1" + redactedToken,
		},
	}
}

// Redactor applies the ADR-0074 redactions to a slice of span attributes. It
// is immutable after construction and safe for concurrent use.
type Redactor struct {
	hmacKey      []byte
	geoPrecision int
	idKeys       map[string]struct{}
	idSuffixes   []string
	geoSuffixes  map[string]struct{}
	secretRules  []SecretRule
}

// NewRedactor compiles cfg into a ready-to-use Redactor.
func NewRedactor(cfg Config) *Redactor {
	geoPrecision := cfg.GeoPrecision
	if geoPrecision < 0 {
		geoPrecision = DefaultGeoPrecision
	}
	idKeys := make(map[string]struct{}, len(cfg.IdentifierKeys))
	for _, k := range cfg.IdentifierKeys {
		idKeys[strings.ToLower(strings.TrimSpace(k))] = struct{}{}
	}
	idSuffixes := make([]string, 0, len(cfg.IdentifierKeySuffixes))
	for _, s := range cfg.IdentifierKeySuffixes {
		s = strings.ToLower(strings.TrimSpace(s))
		if s != "" {
			idSuffixes = append(idSuffixes, s)
		}
	}
	geoSuffixes := make(map[string]struct{}, len(cfg.GeoKeySuffixes))
	for _, s := range cfg.GeoKeySuffixes {
		geoSuffixes[strings.ToLower(strings.TrimSpace(s))] = struct{}{}
	}
	return &Redactor{
		hmacKey:      []byte(cfg.Salt),
		geoPrecision: geoPrecision,
		idKeys:       idKeys,
		idSuffixes:   idSuffixes,
		geoSuffixes:  geoSuffixes,
		secretRules:  cfg.SecretPatterns,
	}
}

// RedactAttributes returns a redacted copy of in. The original slice is never
// mutated. When no attribute needs changing the original slice is returned
// unchanged to avoid a needless allocation on the export hot path.
func (r *Redactor) RedactAttributes(in []attribute.KeyValue) []attribute.KeyValue {
	if r == nil || len(in) == 0 {
		return in
	}
	var out []attribute.KeyValue
	for i, kv := range in {
		nv, changed := r.redactOne(kv)
		if !changed {
			if out != nil {
				out = append(out, kv)
			}
			continue
		}
		if out == nil {
			// First change: copy the untouched prefix, then diverge.
			out = make([]attribute.KeyValue, 0, len(in))
			out = append(out, in[:i]...)
		}
		out = append(out, nv)
	}
	if out == nil {
		return in
	}
	return out
}

// redactOne classifies a single attribute and returns its redacted form. The
// bool reports whether the value changed.
func (r *Redactor) redactOne(kv attribute.KeyValue) (attribute.KeyValue, bool) {
	key := strings.ToLower(string(kv.Key))
	switch {
	case r.isIdentifierKey(key):
		return r.hashAttr(kv), true
	case r.isGeoKey(key):
		return r.fuzzGeo(kv)
	default:
		return r.redactSecretValue(kv)
	}
}

// hashAttr keyed-hashes an identifier attribute. String slices are hashed
// element-by-element so a list of VINs is each individually redacted; every
// other value type is hashed via its string form.
func (r *Redactor) hashAttr(kv attribute.KeyValue) attribute.KeyValue {
	if kv.Value.Type() == attribute.STRINGSLICE {
		in := kv.Value.AsStringSlice()
		out := make([]string, len(in))
		for i, s := range in {
			out[i] = r.hash(s)
		}
		return attribute.StringSlice(string(kv.Key), out)
	}
	return attribute.String(string(kv.Key), r.hash(kv.Value.Emit()))
}

func (r *Redactor) isIdentifierKey(lowerKey string) bool {
	if _, ok := r.idKeys[lowerKey]; ok {
		return true
	}
	for _, suf := range r.idSuffixes {
		if strings.HasSuffix(lowerKey, suf) {
			return true
		}
	}
	return false
}

// isGeoKey matches when the final '.'- or '_'-delimited segment of the key is
// a known coordinate suffix. So "geo.lat", "vehicle_latitude", and bare "lat"
// all match, but "platitude" does not.
func (r *Redactor) isGeoKey(lowerKey string) bool {
	seg := lowerKey
	if i := strings.LastIndexAny(lowerKey, "._"); i >= 0 {
		seg = lowerKey[i+1:]
	}
	_, ok := r.geoSuffixes[seg]
	return ok
}

// hash returns the salted keyed hash of v, prefixed so readers know it was
// redacted. HMAC-SHA256 keeps the same input mapping to the same output
// within a deployment (stable salt) while being non-reversible.
func (r *Redactor) hash(v string) string {
	mac := hmac.New(sha256.New, r.hmacKey)
	mac.Write([]byte(v))
	sum := hex.EncodeToString(mac.Sum(nil))
	if len(sum) > hashHexLen {
		sum = sum[:hashHexLen]
	}
	return hashPrefix + sum
}

// fuzzGeo rounds a coordinate value to the configured precision. It handles
// both float attributes and numeric string attributes; non-numeric values are
// left untouched (changed=false).
func (r *Redactor) fuzzGeo(kv attribute.KeyValue) (attribute.KeyValue, bool) {
	switch kv.Value.Type() {
	case attribute.FLOAT64:
		rounded := roundTo(kv.Value.AsFloat64(), r.geoPrecision)
		if rounded == kv.Value.AsFloat64() {
			return kv, false
		}
		return attribute.Float64(string(kv.Key), rounded), true
	case attribute.STRING:
		s := kv.Value.AsString()
		f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
		if err != nil {
			// Not a bare coordinate — still scan for secret shapes.
			return r.redactSecretValue(kv)
		}
		rounded := roundTo(f, r.geoPrecision)
		return attribute.String(string(kv.Key), strconv.FormatFloat(rounded, 'f', -1, 64)), true
	default:
		return kv, false
	}
}

// redactSecretValue scans a string (or string-slice) attribute for secret-
// shaped substrings. Other value types are returned unchanged.
func (r *Redactor) redactSecretValue(kv attribute.KeyValue) (attribute.KeyValue, bool) {
	switch kv.Value.Type() {
	case attribute.STRING:
		orig := kv.Value.AsString()
		scrubbed := r.scrubSecrets(orig)
		if scrubbed == orig {
			return kv, false
		}
		return attribute.String(string(kv.Key), scrubbed), true
	case attribute.STRINGSLICE:
		in := kv.Value.AsStringSlice()
		out := make([]string, len(in))
		changed := false
		for i, s := range in {
			out[i] = r.scrubSecrets(s)
			if out[i] != s {
				changed = true
			}
		}
		if !changed {
			return kv, false
		}
		return attribute.StringSlice(string(kv.Key), out), true
	default:
		return kv, false
	}
}

// ScrubText applies the secret-pattern rules to free-form text (span names,
// status descriptions, event names). It is the only redaction available for
// non-key/value fields, where identifier-hashing and geo-fuzzing cannot apply
// for lack of a classifying key.
func (r *Redactor) ScrubText(s string) string {
	if r == nil {
		return s
	}
	return r.scrubSecrets(s)
}

// scrubSecrets applies every secret rule in order and returns the result.
func (r *Redactor) scrubSecrets(s string) string {
	for _, rule := range r.secretRules {
		if rule.Re == nil {
			continue
		}
		if rule.Re.MatchString(s) {
			s = rule.Re.ReplaceAllString(s, rule.Repl)
		}
	}
	return s
}

// roundTo rounds f to the given number of decimal places. A non-positive
// precision rounds to whole units.
func roundTo(f float64, decimals int) float64 {
	if decimals <= 0 {
		return math.Round(f)
	}
	pow := math.Pow(10, float64(decimals))
	return math.Round(f*pow) / pow
}
