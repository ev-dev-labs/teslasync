package redact

import "sort"

// PIIClass enumerates the categories of personally-identifying or
// sensitive data the redactor recognises. Adding a new class is a
// three-line change: a new constant, an entry in [allClasses], and a
// detector in detect.go.
//
// Class identifiers are short, lowercase, and stable on the wire: they
// appear in the serialised round-trip token (e.g. `<vin id='1'/>`),
// in the per-feature [Policy.Allow] list, and in the
// `ai_call_log.redacted_classes` column. Renaming a constant is a
// breaking change for an operator's audit history.
type PIIClass string

const (
	// ClassVIN is a Tesla / NHTSA 17-character vehicle identification
	// number. Detector pattern excludes I, O, Q per ISO 3779 §5.3.
	ClassVIN PIIClass = "vin"
	// ClassEmail is an RFC 5322 (simplified) email address. Common
	// owner-app surface: feedback forms, share-link recipients.
	ClassEmail PIIClass = "email"
	// ClassPhone is an E.164 number or a North-American 10/11-digit
	// formatted variant.
	ClassPhone PIIClass = "phone"
	// ClassLatLong is a latitude/longitude pair. Matches both the
	// "37.7749, -122.4194" decimal-pair form and the JSON
	// {"lat":..,"lng":..} / {"latitude":..,"longitude":..} object
	// form most TeslaSync handlers serialise.
	ClassLatLong PIIClass = "latlong"
	// ClassStreetAddr is a free-form US street address. The detector
	// is conservative — favours false negatives over false positives
	// because a missed match is fixable in policy, but a misclassified
	// non-PII word that gets replaced with [ADDRESS] silently corrupts
	// the prompt.
	ClassStreetAddr PIIClass = "address"
	// ClassIPAddress is an IPv4 or IPv6 address. RFC1918 / loopback
	// addresses are intentionally NOT redacted — those are
	// infrastructure metadata, not PII.
	ClassIPAddress PIIClass = "ip"
	// ClassUserID is an opaque application-level user identifier
	// (e.g. FORWARD_AUTH_HEADER subject value). No automatic
	// detector; emitted by code paths that explicitly mark a user
	// identifier in flight.
	ClassUserID PIIClass = "userid"
	// ClassVehicleName is the user-set car name. Often equals
	// "Joe's Tesla" so it leaks the owner's first name. Detector is
	// also explicit (no automatic regex) because the value lives in a
	// known DB column.
	ClassVehicleName PIIClass = "vehname"
	// ClassPlate is a state license plate. State-specific patterns;
	// opt-in via class because false positives are common.
	ClassPlate PIIClass = "plate"
	// ClassCreditCard is a Luhn-validated 13–19 digit credit-card
	// number. Defensive — TeslaSync should never have one in flight,
	// but if a future Stripe integration leaks one we want it caught.
	ClassCreditCard PIIClass = "cc"
	// ClassSSN is a US social security number. Defensive — same
	// rationale as ClassCreditCard.
	ClassSSN PIIClass = "ssn"
)

// allClasses is the canonical list of every supported [PIIClass] in
// stable order. Used by [AllClasses] (public accessor), the bypass
// report, and the per-class test fixtures.
var allClasses = []PIIClass{
	ClassVIN,
	ClassEmail,
	ClassPhone,
	ClassLatLong,
	ClassStreetAddr,
	ClassIPAddress,
	ClassUserID,
	ClassVehicleName,
	ClassPlate,
	ClassCreditCard,
	ClassSSN,
}

// AllClasses returns a copy of every supported [PIIClass] in stable
// order. Defensive copy so callers cannot mutate the package-private
// slice.
func AllClasses() []PIIClass {
	out := make([]PIIClass, len(allClasses))
	copy(out, allClasses)
	return out
}

// IsKnown reports whether c is one of the supported [PIIClass]
// constants. Used to validate [Policy.Allow] entries at construction
// time so a typo in a per-feature policy fails loudly.
func IsKnown(c PIIClass) bool {
	for _, k := range allClasses {
		if k == c {
			return true
		}
	}
	return false
}

// Span identifies one detected PII match in an input string. End is
// exclusive (matching Go slice semantics); Score is in [0,1] and
// reflects the detector's confidence (1.0 for hard regex matches such
// as VIN check-digit-validated, lower for heuristic matches such as
// street addresses).
type Span struct {
	Start int
	End   int
	Class PIIClass
	Score float64
}

// sortSpans sorts a span slice by Start ascending so callers can
// iterate and rewrite without bookkeeping. End-tie-broken by the
// longer span winning so overlapping detectors prefer the more
// specific match.
func sortSpans(spans []Span) {
	sort.SliceStable(spans, func(i, j int) bool {
		if spans[i].Start != spans[j].Start {
			return spans[i].Start < spans[j].Start
		}
		// Longer span wins on ties so a VIN nested inside a sentence
		// is preferred over a partial alphanumeric token at the same
		// start offset.
		return spans[i].End-spans[i].Start > spans[j].End-spans[j].Start
	})
}

// dedupeAndMergeSpans removes spans that fully overlap a higher-score
// span and keeps non-overlapping spans intact. Input MUST be sorted by
// [sortSpans]. The algorithm walks the sorted slice keeping a running
// "current best" and emitting it when a span starts past the current
// end. Two spans with identical (start, end) are de-duplicated by
// keeping the higher Score (or the earlier-listed class on tie, for
// determinism).
func dedupeAndMergeSpans(spans []Span) []Span {
	if len(spans) == 0 {
		return spans
	}
	out := make([]Span, 0, len(spans))
	cur := spans[0]
	for i := 1; i < len(spans); i++ {
		s := spans[i]
		if s.Start >= cur.End {
			out = append(out, cur)
			cur = s
			continue
		}
		// Overlap: keep the one with higher score; ties go to the
		// span that starts earlier (already cur, since sorted) and
		// covers more (already cur if same start).
		if s.Score > cur.Score {
			cur = s
		}
	}
	out = append(out, cur)
	return out
}
