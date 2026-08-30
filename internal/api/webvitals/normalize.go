package webvitals

import (
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
)

// Label normalisation and privacy redaction for RUM ingest.
//
// Nothing in this file may ever emit a label derived from user-identifying
// data. The redaction rules below are deliberately over-eager: a segment that
// *might* carry an identifier is replaced with `:id` rather than risking a VIN,
// a database key, an e-mail address or a coordinate pair landing in Prometheus
// (where it would persist for the full retention window and be readable by
// anyone with dashboard access).

const (
	// maxRouteLabelLength caps the route label AFTER normalisation. Browsers
	// can produce arbitrarily deep paths via SPA history.
	maxRouteLabelLength = 50

	// maxRouteSegments caps route depth before length truncation so a deep
	// path degrades to a readable prefix instead of a mid-word cut.
	maxRouteSegments = 6

	// maxReleaseLabelLength caps the release label. Semver plus a build
	// suffix fits comfortably.
	maxReleaseLabelLength = 32

	// idPlaceholder is the single sink for every redacted path segment. Using
	// one placeholder (rather than :id/:vin/:geo/:token) keeps the route
	// template set small and avoids leaking *what kind* of identifier the URL
	// carried.
	idPlaceholder = ":id"
)

var (
	intSegmentRE  = regexp.MustCompile(`^\d+$`)
	uuidSegmentRE = regexp.MustCompile(`^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$`)
	hexBlobRE     = regexp.MustCompile(`^[0-9a-fA-F]{20,}$`)
	// vinRE matches the 17-character VIN alphabet (I, O and Q are excluded by
	// ISO 3779). Requiring at least one digit avoids redacting a 17-letter
	// English word.
	vinRE = regexp.MustCompile(`^[A-HJ-NPR-Z0-9]{17}$`)
	// geoRE matches decimal coordinates, optionally as a lat,lng pair.
	geoRE = regexp.MustCompile(`^-?\d{1,3}\.\d+(,-?\d{1,3}\.\d+)?$`)
	// digitTokenRE matches long opaque tokens that mix digits with other
	// characters — share slugs, base64 fragments, composite keys.
	digitTokenRE = regexp.MustCompile(`^[A-Za-z0-9_.\-]{12,}$`)
	// safeSegmentRE is the allow-list for a segment that survives verbatim.
	safeSegmentRE = regexp.MustCompile(`^[a-z0-9]+([._-][a-z0-9]+)*$`)
	// releaseRE bounds the release label charset (semver + build metadata).
	releaseRE  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+\-]*$`)
	hasDigitRE = regexp.MustCompile(`\d`)
)

// routeShape is one canonical SPA route, pre-split for matching.
type routeShape struct {
	// segments holds lower-cased literal segments; parameter positions hold "".
	segments []string
	paramAt  []bool
	// paramCount orders candidates so a literal route always wins over a
	// parameterised one of the same length (`/automations/new` must never
	// resolve through `/automations/:id`).
	paramCount int
}

var (
	routeShapeOnce  sync.Once
	routeShapeIndex map[int][]routeShape
)

// buildRouteShapeIndex indexes the generated route table by segment count.
// Built once, lazily; the generated table is a compile-time constant so there
// is no runtime dependency on the web tree.
func buildRouteShapeIndex() {
	routeShapeIndex = make(map[int][]routeShape, 8)
	for _, p := range generatedRoutePaths {
		raw := splitPathSegments(p)
		shape := routeShape{
			segments: make([]string, len(raw)),
			paramAt:  make([]bool, len(raw)),
		}
		for i, seg := range raw {
			if strings.HasPrefix(seg, ":") {
				shape.paramAt[i] = true
				shape.paramCount++
				continue
			}
			shape.segments[i] = strings.ToLower(seg)
		}
		routeShapeIndex[len(raw)] = append(routeShapeIndex[len(raw)], shape)
	}
	for _, shapes := range routeShapeIndex {
		sort.SliceStable(shapes, func(i, j int) bool {
			return shapes[i].paramCount < shapes[j].paramCount
		})
	}
}

func splitPathSegments(p string) []string {
	out := make([]string, 0, 8)
	for _, part := range strings.Split(p, "/") {
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

// matchRouteTemplate returns the parameter mask of the canonical route whose
// literal segments all match, or nil when the path is not a known SPA route.
func matchRouteTemplate(lowerSegments []string) []bool {
	routeShapeOnce.Do(buildRouteShapeIndex)
	candidates := routeShapeIndex[len(lowerSegments)]
	for _, candidate := range candidates {
		ok := true
		for i := range lowerSegments {
			if candidate.paramAt[i] {
				continue
			}
			if candidate.segments[i] != lowerSegments[i] {
				ok = false
				break
			}
		}
		if ok {
			return candidate.paramAt
		}
	}
	return nil
}

// NormalizeRoute converts a browser-reported pathname into a bounded,
// privacy-safe route template. It is more permissive than saved-view route
// validation because browsers report arbitrary SPA pathnames, and stricter
// about identifiers because the result becomes a Prometheus label.
//
// A segment is replaced with `:id` when EITHER the canonical route table says
// that position is a `:param`, OR its shape is identifier-like. The route table
// is not optional: `/year-review/private-share-slug`,
// `/trips/customer-private-slug` and `/s/share-token-abc` are opaque,
// digit-free, hyphenated words with exactly the shape of a real page name, so
// heuristics alone would preserve them.
//
// This function is shared verbatim by the web-vitals and web-errors ingest
// paths (see internal/api/weberrors) so both surfaces produce identical labels.
//
// The result is NOT yet cardinality-capped — call admitRoute for that.
func NormalizeRoute(p string) string {
	if p == "" {
		return "/"
	}

	// Be defensive even though clients should send pathnames only. Query
	// strings and fragments routinely carry tokens, filters and coordinates.
	if i := strings.IndexAny(p, "?#"); i >= 0 {
		p = p[:i]
	}

	// A client may hand us an absolute or protocol-relative URL. Drop scheme +
	// authority so the host (which can encode a tenant) never becomes part of
	// the label.
	if i := strings.Index(p, "://"); i >= 0 {
		rest := p[i+3:]
		if j := strings.Index(rest, "/"); j >= 0 {
			p = rest[j:]
		} else {
			p = "/"
		}
	} else if strings.HasPrefix(p, "//") {
		rest := strings.TrimPrefix(p, "//")
		if j := strings.Index(rest, "/"); j >= 0 {
			p = rest[j:]
		} else {
			p = "/"
		}
	}

	segments := splitPathSegments(p)
	if len(segments) == 0 {
		return "/"
	}

	// Percent-decode before matching so an encoded literal (`/year%2Dreview`)
	// still resolves to its canonical route. A segment whose encoding is
	// malformed, or which decodes to something structural, is opaque by
	// definition and is redacted outright.
	decoded := make([]string, len(segments))
	opaque := make([]bool, len(segments))
	lower := make([]string, len(segments))
	for i, seg := range segments {
		decoded[i], opaque[i] = safeDecodeSegment(seg)
		lower[i] = strings.ToLower(decoded[i])
	}

	paramAt := matchRouteTemplate(lower)

	for i := range segments {
		switch {
		case paramAt != nil && paramAt[i]:
			segments[i] = idPlaceholder
		case opaque[i]:
			segments[i] = idPlaceholder
		default:
			segments[i] = normalizeSegment(decoded[i])
		}
	}

	if len(segments) > maxRouteSegments {
		segments = segments[:maxRouteSegments]
	}

	out := "/" + strings.Join(segments, "/")

	if len(out) > maxRouteLabelLength {
		out = out[:maxRouteLabelLength]
		// Prefer cutting at a segment boundary so the label stays readable
		// and two different deep routes don't collide on a half-word.
		if idx := strings.LastIndex(out, "/"); idx > 0 {
			out = out[:idx]
		}
	}
	if out == "" {
		return "/"
	}
	return out
}

// safeDecodeSegment percent-decodes one path segment. It reports opaque=true
// when the encoding is malformed or the decoded value reintroduces structural
// characters — both cases mean the caller must redact rather than interpret.
func safeDecodeSegment(seg string) (string, bool) {
	if !strings.Contains(seg, "%") {
		return seg, false
	}
	decoded, err := url.PathUnescape(seg)
	if err != nil {
		return seg, true
	}
	if strings.ContainsAny(decoded, "/?#\\") {
		return seg, true
	}
	return decoded, false
}

// normalizeSegment applies the privacy rules to a single path segment.
func normalizeSegment(part string) string {
	switch {
	case intSegmentRE.MatchString(part):
		return idPlaceholder
	case uuidSegmentRE.MatchString(part):
		return idPlaceholder
	case hexBlobRE.MatchString(part):
		return idPlaceholder
	case vinRE.MatchString(strings.ToUpper(part)) && hasDigitRE.MatchString(part):
		return idPlaceholder
	case geoRE.MatchString(part):
		return idPlaceholder
	case strings.ContainsAny(part, "@%:="):
		// e-mail addresses, percent-encoded payloads, matrix params.
		return idPlaceholder
	case digitTokenRE.MatchString(part) && hasDigitRE.MatchString(part):
		return idPlaceholder
	}
	lower := strings.ToLower(part)
	if !safeSegmentRE.MatchString(lower) {
		// Anything outside the conservative allow-list (unicode, spaces,
		// punctuation) could carry free-text; redact rather than guess.
		return idPlaceholder
	}
	return lower
}

// isAdmissibleRouteTemplate decides whether a normalised route may take its
// own Prometheus series, or must be folded into the overflow bucket.
//
// A genuine SPA route always starts with a word segment: `/dashboard`,
// `/drives/:id`, `/analytics/battery-degradation`. A template whose first
// segment is an identifier (`/:id/...`) is either a client bug or a caller
// probing the registry with synthetic paths, and is never worth a series.
// Root (`/`) is always admissible.
func isAdmissibleRouteTemplate(route string) bool {
	if route == "/" {
		return true
	}
	if route == overflowRoute {
		return false
	}
	if !strings.HasPrefix(route, "/") {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(route, "/"), "/")
	if len(parts) == 0 || len(parts) > maxRouteSegments {
		return false
	}
	first := parts[0]
	if first == "" || first == idPlaceholder {
		return false
	}
	if !safeSegmentRE.MatchString(first) {
		return false
	}
	// Every remaining segment must already be either a redacted placeholder or
	// a safe word — NormalizeRoute guarantees this, so a failure here means a
	// caller reached admitRoute without normalising.
	for _, p := range parts[1:] {
		if p == idPlaceholder {
			continue
		}
		if !safeSegmentRE.MatchString(p) {
			return false
		}
	}
	return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared, bounded route admission
// ─────────────────────────────────────────────────────────────────────────────

// OverflowRoute is the closed label every ingest surface folds an
// un-admittable route into. Exported so other surfaces (and their tests) can
// assert against it rather than hard-coding the literal.
const OverflowRoute = overflowRoute

// RouteAdmitter bounds the cardinality of client-supplied route labels for ONE
// ingest surface.
//
// Each surface gets its OWN registry rather than sharing a global one. Sharing
// would be simpler, but it would let a burst on `/api/v1/web-errors` consume
// the budget that `/api/v1/web-vitals` needs for its real routes (and vice
// versa) — one anonymous endpoint starving another is not an acceptable
// failure mode. The normalisation rules, caps and overflow semantics are
// identical; only the accounting is separate, and the overflow counters are
// labelled per surface so the split is observable.
type RouteAdmitter struct {
	registry   *boundedRegistry
	perRequest int
	labelBase  string
}

// NewRouteAdmitter builds an admitter for a named surface.
//
//	surface     label prefix for the overflow counters ("" for web-vitals,
//	            which keeps the historical unprefixed label values).
//	limit       maximum distinct route templates admitted for the process
//	            lifetime.
//	perRequest  maximum NEW templates a single request may introduce.
func NewRouteAdmitter(surface string, limit, perRequest int) *RouteAdmitter {
	base := "route"
	if surface != "" {
		base = surface + "_route"
	}
	return &RouteAdmitter{
		registry:   newBoundedRegistry(base, limit, overflowRoute),
		perRequest: perRequest,
		labelBase:  base,
	}
}

// Size reports how many distinct route templates this surface has admitted.
func (a *RouteAdmitter) Size() int { return a.registry.Size() }

// RouteBatch carries the per-request admission budget. One batch per inbound
// HTTP request; a batch that admits nothing costs nothing.
type RouteBatch struct {
	admitter *RouteAdmitter
	budget   *admissionBudget
}

// NewBatch starts a per-request admission budget.
func (a *RouteAdmitter) NewBatch() *RouteBatch {
	return &RouteBatch{admitter: a, budget: newAdmissionBudget(a.perRequest)}
}

// Admit normalises a client-supplied route and folds it onto this surface's
// bounded label set.
//
// The caller MUST have validated that the enclosing request carried acceptable
// content before calling this — that ordering is what stops an invalid
// anonymous batch from consuming registry capacity.
func (b *RouteBatch) Admit(rawRoute string) string {
	normalized := NormalizeRoute(rawRoute)
	if !isAdmissibleRouteTemplate(normalized) {
		cardinalityOverflowTotal.WithLabelValues(b.admitter.labelBase + "_shape").Inc()
		return overflowRoute
	}
	return b.admitter.registry.Admit(normalized, b.budget)
}

// defaultRouteAdmitter backs the web-vitals ingest surface. The empty surface
// name preserves the historical `route` / `route_batch_budget` / `route_shape`
// overflow label values.
//
// A package variable rather than a constant so specs can swap in a
// small-capacity admitter; production code never reassigns it.
var defaultRouteAdmitter = NewRouteAdmitter("", maxTrackedRoutes, maxNewRoutesPerBatch)

// dimensions is the bounded set of client-context labels attached to every
// sample. All fields are already normalised to a closed set.
type dimensions struct {
	Device     string
	Connection string
	Theme      string
	Release    string
}

// Closed label sets. Anything outside these becomes unknownLabel, so a client
// cannot mint new series by inventing values.
var (
	allowedDeviceClasses = map[string]struct{}{
		"mobile":  {},
		"tablet":  {},
		"desktop": {},
	}
	allowedConnectionClasses = map[string]struct{}{
		"slow-2g": {},
		"2g":      {},
		"3g":      {},
		"4g":      {},
		"5g":      {},
	}
	allowedThemes = map[string]struct{}{
		"dark":  {},
		"light": {},
	}
	allowedRatings = map[string]struct{}{
		"good":              {},
		"needs-improvement": {},
		"poor":              {},
	}
)

func normalizeDevice(v string) string { return normalizeEnum(v, allowedDeviceClasses) }
func normalizeTheme(v string) string  { return normalizeEnum(v, allowedThemes) }
func normalizeRating(v string) string { return normalizeEnum(v, allowedRatings) }

func normalizeConnection(v string) string {
	return normalizeEnum(v, allowedConnectionClasses)
}

func normalizeEnum(v string, allowed map[string]struct{}) string {
	v = strings.ToLower(strings.TrimSpace(v))
	if _, ok := allowed[v]; ok {
		return v
	}
	return unknownLabel
}

// validateRelease checks the charset and length of a client-supplied release
// string WITHOUT touching the capped registry. Returns "" when the value is
// unusable. Splitting validation from admission is what lets the handler
// refuse to spend registry capacity (or publish a deployment annotation) on a
// batch that carried no acceptable content.
func validateRelease(v string) string {
	v = strings.TrimSpace(v)
	if v == "" || v == unknownLabel {
		return ""
	}
	if len(v) > maxReleaseLabelLength {
		return ""
	}
	if !releaseRE.MatchString(v) {
		return ""
	}
	return v
}

// admitRelease folds a pre-validated release through the capped registry,
// publishing the deployment-annotation gauges on first sight. Call ONLY after
// the request has been shown to carry at least one acceptable sample.
func admitRelease(validated string, budget *admissionBudget) string {
	if validated == "" {
		return unknownLabel
	}
	return releaseRegistry.Admit(validated, budget)
}

// normalizeRelease validates and admits in one step. Retained for tests and
// for callers that have already established the request is acceptable.
func normalizeRelease(v string) string {
	return admitRelease(validateRelease(v), nil)
}

// UX event closed sets.
var (
	allowedUXKinds = map[string]struct{}{
		"error":        {},
		"resource":     {},
		"query":        {},
		"retry":        {},
		"cache":        {},
		"cancellation": {},
		"user_action":  {},
	}
	allowedUXOutcomes = map[string]struct{}{
		"success":   {},
		"failure":   {},
		"hit":       {},
		"miss":      {},
		"timeout":   {},
		"cancelled": {},
		"blocked":   {},
		"retried":   {},
	}
)

// normalizeUXKind returns the kind label and whether it was recognised.
// Unrecognised kinds are rejected outright (rather than bucketed) because an
// "unknown" UX kind carries no analytical value and would only mask a client
// bug.
func normalizeUXKind(v string) (string, bool) {
	v = strings.ToLower(strings.TrimSpace(v))
	_, ok := allowedUXKinds[v]
	return v, ok
}

func normalizeUXOutcome(v string) (string, bool) {
	v = strings.ToLower(strings.TrimSpace(v))
	_, ok := allowedUXOutcomes[v]
	return v, ok
}
