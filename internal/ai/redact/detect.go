package redact

import (
	"net"
	"regexp"
	"strconv"
	"strings"
)

// Detect runs the default-on detector chain over text and returns the
// merged span list. Spans are sorted by Start ascending and
// de-duplicated so a VIN that also matches the alphanumeric heuristic
// of another class only appears once.
//
// Plate detection is OPT-IN per prompt D9.2 and is NOT included by
// Detect. Use [DetectAll] (tests/admin) or [Apply] with
// [Policy.EnablePlate] = true to enable it. The plate regex has a
// high false-positive rate on common alphanumeric IDs, so the
// default-off stance protects every other feature from accidental
// over-redaction.
//
// Each detector is intentionally regex-driven (or pure-Go scan for
// IP-aware classes) so the whole package has zero external runtime
// dependencies and is trivially fuzzable.
func Detect(text string) []Span {
	return detectInternal(text, false)
}

// DetectAll runs every detector including the opt-in plate detector.
// Used by tests and the admin bypass-report tooling. Production
// redaction goes through [Apply] which gates plates via
// [Policy.EnablePlate].
func DetectAll(text string) []Span {
	return detectInternal(text, true)
}

func detectInternal(text string, includePlate bool) []Span {
	if text == "" {
		return nil
	}
	spans := make([]Span, 0, 8)
	spans = append(spans, detectVIN(text)...)
	spans = append(spans, detectEmail(text)...)
	spans = append(spans, detectPhone(text)...)
	spans = append(spans, detectLatLong(text)...)
	spans = append(spans, detectStreetAddress(text)...)
	spans = append(spans, detectIP(text)...)
	if includePlate {
		spans = append(spans, detectPlate(text)...)
	}
	spans = append(spans, detectCreditCard(text)...)
	spans = append(spans, detectSSN(text)...)
	sortSpans(spans)
	return dedupeAndMergeSpans(spans)
}

// reVIN is the surface regex for a VIN: 17 characters, no I/O/Q. The
// detector then runs the ISO 3779 check-digit calculation to discard
// random alphanumeric strings that happen to match the surface.
//
// The leading and trailing word boundaries cap the match so a longer
// string that happens to contain 17 valid chars is not captured.
var reVIN = regexp.MustCompile(`\b[A-HJ-NPR-Z0-9]{17}\b`)

func detectVIN(text string) []Span {
	hits := reVIN.FindAllStringIndex(strings.ToUpper(text), -1)
	if len(hits) == 0 {
		return nil
	}
	out := make([]Span, 0, len(hits))
	for _, h := range hits {
		candidate := strings.ToUpper(text[h[0]:h[1]])
		if !validVINCheckDigit(candidate) {
			continue
		}
		out = append(out, Span{Start: h[0], End: h[1], Class: ClassVIN, Score: 1.0})
	}
	return out
}

// vinTransliteration is the ISO 3779 §B.2 alpha→digit table for the
// check-digit calculation. Letters not in the table are ignored by
// virtue of the surface regex (which already excludes I, O, Q).
var vinTransliteration = map[byte]int{
	'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'H': 8,
	'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 5, 'P': 7, 'R': 9,
	'S': 2, 'T': 3, 'U': 4, 'V': 5, 'W': 6, 'X': 7, 'Y': 8, 'Z': 9,
}

// vinWeights is the per-position weight schedule from ISO 3779 §B.3.
// Position 8 (index 8) is the check-digit slot and has weight 0.
var vinWeights = [17]int{8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2}

// validVINCheckDigit returns true when vin's 9th character is the
// expected ISO 3779 check digit. Pure-Go to avoid pulling in a VIN
// library for two dozen lines of arithmetic.
func validVINCheckDigit(vin string) bool {
	if len(vin) != 17 {
		return false
	}
	sum := 0
	for i := 0; i < 17; i++ {
		c := vin[i]
		var v int
		switch {
		case c >= '0' && c <= '9':
			v = int(c - '0')
		default:
			n, ok := vinTransliteration[c]
			if !ok {
				return false
			}
			v = n
		}
		sum += v * vinWeights[i]
	}
	rem := sum % 11
	expected := byte('0' + rem)
	if rem == 10 {
		expected = 'X'
	}
	return vin[8] == expected
}

// reEmail is a deliberately conservative RFC 5322 surface match. It
// catches the cases that matter for owner-app PII (alice@example.com,
// alice+tag@sub.example.org) and rejects the legal-but-rare quoted
// local-part forms.
var reEmail = regexp.MustCompile(`(?i)\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b`)

func detectEmail(text string) []Span {
	hits := reEmail.FindAllStringIndex(text, -1)
	if len(hits) == 0 {
		return nil
	}
	out := make([]Span, 0, len(hits))
	for _, h := range hits {
		out = append(out, Span{Start: h[0], End: h[1], Class: ClassEmail, Score: 1.0})
	}
	return out
}

// rePhone matches:
//   - E.164 (+CCNNNNNNNNNN, 8–15 digits after the +)
//   - North-American formatted: (NNN) NNN-NNNN, NNN-NNN-NNNN, NNN.NNN.NNNN
//
// The detector is biased to reduce false positives on long numeric
// runs (timestamps, IDs) — pure 7-digit and 10-digit unspaced runs are
// NOT phone matches by design.
var rePhone = regexp.MustCompile(
	`(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\d{3}[\s.-])\d{3}[\s.-]?\d{4}\b` +
		`|\+\d{1,3}(?:[\s.-]?\d{1,4}){2,5}\b` +
		`|\+\d{8,15}\b`,
)

func detectPhone(text string) []Span {
	hits := rePhone.FindAllStringIndex(text, -1)
	if len(hits) == 0 {
		return nil
	}
	out := make([]Span, 0, len(hits))
	for _, h := range hits {
		out = append(out, Span{Start: h[0], End: h[1], Class: ClassPhone, Score: 0.95})
	}
	return out
}

// reLatLong matches a decimal-degree pair separated by a comma. Both
// sides must have ≥4 fractional digits — that filters out integer
// IDs and currency strings that happen to use comma separators.
var reLatLong = regexp.MustCompile(
	`-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}`,
)

// reLatLongJSON matches the {"lat":..,"lng":..} / "latitude"/"longitude"
// shapes the TeslaSync handlers serialise. Only the value pair is
// captured; the surrounding JSON braces are kept in the output so the
// model still sees structure.
var reLatLongJSON = regexp.MustCompile(
	`(?i)"lat(?:itude)?"\s*:\s*-?\d{1,3}\.\d{2,}\s*,\s*"lng|"lat(?:itude)?"\s*:\s*-?\d{1,3}\.\d{2,}\s*,\s*"lon(?:gitude)?"`,
)

func detectLatLong(text string) []Span {
	out := make([]Span, 0, 4)
	for _, h := range reLatLong.FindAllStringIndex(text, -1) {
		// Range-check: latitude in [-90,90], longitude in [-180,180].
		match := text[h[0]:h[1]]
		comma := strings.Index(match, ",")
		if comma < 0 {
			continue
		}
		lat, err1 := strconv.ParseFloat(strings.TrimSpace(match[:comma]), 64)
		lon, err2 := strconv.ParseFloat(strings.TrimSpace(match[comma+1:]), 64)
		if err1 != nil || err2 != nil {
			continue
		}
		if lat < -90 || lat > 90 || lon < -180 || lon > 180 {
			continue
		}
		out = append(out, Span{Start: h[0], End: h[1], Class: ClassLatLong, Score: 1.0})
	}
	for _, h := range reLatLongJSON.FindAllStringIndex(text, -1) {
		out = append(out, Span{Start: h[0], End: h[1], Class: ClassLatLong, Score: 0.9})
	}
	return out
}

// addressSuffixes lists the street-suffix tokens the address detector
// recognises. Lowercase comparison happens at match time so casing
// does not need to be maintained here. The list is conservative on
// purpose.
var addressSuffixes = map[string]bool{
	"st": true, "street": true,
	"ave": true, "avenue": true,
	"blvd": true, "boulevard": true,
	"rd": true, "road": true,
	"ln": true, "lane": true,
	"dr": true, "drive": true,
	"ct": true, "court": true,
	"pl": true, "place": true,
	"way": true,
	"hwy": true, "highway": true,
	"pkwy": true, "parkway": true,
	"ter": true, "terrace": true,
	"sq": true, "square": true,
	"trl": true, "trail": true,
}

// reAddressStart matches the leading number + whitespace of a candidate
// street address. The detector then scans subsequent word tokens
// looking for the first one that is a recognised street suffix.
var reAddressStart = regexp.MustCompile(`\b\d{1,5}\s+`)

// reAddressWord matches a single street-name word token (capital first
// letter optional; the scanner below normalises before lookup).
var reAddressWord = regexp.MustCompile(`^[A-Za-z][a-zA-Z'.-]*`)

// detectStreetAddress walks the text token-by-token rather than
// relying on a single regex. Pure-regex approaches absorb non-suffix
// words greedily ("123 Main St yesterday") which makes the suffix
// look like "yesterday" and the address detector misses real
// addresses. The scanner takes the FIRST suffix it sees after at
// least one street-name token, which is the conservative reading
// per ADR-015 (favour false negatives over false positives).
func detectStreetAddress(text string) []Span {
	out := make([]Span, 0, 2)
	cursor := 0
	for cursor < len(text) {
		hit := reAddressStart.FindStringIndex(text[cursor:])
		if hit == nil {
			break
		}
		startAbs := cursor + hit[0]
		i := cursor + hit[1]
		var ends []int
		var words []string
		// Scan up to 5 word tokens after the number.
		for w := 0; w < 5 && i < len(text); w++ {
			m := reAddressWord.FindString(text[i:])
			if m == "" {
				break
			}
			words = append(words, m)
			i += len(m)
			ends = append(ends, i)
			// Consume one whitespace run before the next word.
			j := i
			for j < len(text) && (text[j] == ' ' || text[j] == '\t') {
				j++
			}
			if j == i {
				break
			}
			i = j
		}
		matched := false
		for k := 1; k < len(words); k++ {
			suffix := strings.ToLower(strings.TrimRight(words[k], ".,"))
			if !addressSuffixes[suffix] {
				continue
			}
			end := ends[k]
			// Include trailing period if present and not already part
			// of the word.
			if end < len(text) && text[end-1] != '.' && text[end] == '.' {
				end++
			}
			out = append(out, Span{Start: startAbs, End: end, Class: ClassStreetAddr, Score: 0.7})
			matched = true
			break
		}
		_ = matched
		cursor = cursor + hit[1]
	}
	return out
}

// reIPv4 matches dotted-quad IPv4. Accept everything that parses; the
// per-octet bounds check is below.
var reIPv4 = regexp.MustCompile(`\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b`)

// reIPv6 matches a coarse IPv6 candidate including the `::`
// compressed form. We then defer to net.ParseIP for validation so a
// bad candidate is rejected without a custom parser.
//
// Three alternations cover the most common shapes:
//   - fully expanded `X:X:X:X:X:X:X:X` (2-7 leading colon groups + tail)
//   - left-truncated `::X[:X]*`
//   - mid-truncated  `X[:X]*::X[:X]*` (with optional tail)
//   - bare `::1` loopback
var reIPv6 = regexp.MustCompile(
	`\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b` +
		`|\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6}::[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{1,4}){0,6}\b` +
		`|::1\b` +
		`|::\b`,
)

// detectIP returns spans for IPv4/IPv6 addresses, EXCLUDING RFC1918
// and loopback ranges. Per ADR-015 §I9 those are infra metadata, not
// PII — treating them as PII would force every "couldn't reach
// 192.168.1.1" diagnostic message to lose context.
func detectIP(text string) []Span {
	out := make([]Span, 0, 4)
	for _, h := range reIPv4.FindAllStringIndex(text, -1) {
		ip := net.ParseIP(text[h[0]:h[1]])
		if ip == nil {
			continue
		}
		if isInfrastructureIP(ip) {
			continue
		}
		out = append(out, Span{Start: h[0], End: h[1], Class: ClassIPAddress, Score: 1.0})
	}
	for _, h := range reIPv6.FindAllStringIndex(text, -1) {
		ip := net.ParseIP(text[h[0]:h[1]])
		if ip == nil {
			continue
		}
		if isInfrastructureIP(ip) {
			continue
		}
		out = append(out, Span{Start: h[0], End: h[1], Class: ClassIPAddress, Score: 0.95})
	}
	return out
}

// rfc1918Nets is the standard private-network set; loopback is
// handled by ip.IsLoopback. Multicast / link-local also count as
// infrastructure for redaction purposes.
var rfc1918Nets = func() []*net.IPNet {
	cidrs := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"169.254.0.0/16", // link-local
		"100.64.0.0/10",  // CGNAT (RFC 6598)
		"fc00::/7",       // IPv6 ULA
		"fe80::/10",      // IPv6 link-local
	}
	out := make([]*net.IPNet, 0, len(cidrs))
	for _, c := range cidrs {
		_, n, err := net.ParseCIDR(c)
		if err == nil {
			out = append(out, n)
		}
	}
	return out
}()

func isInfrastructureIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() {
		return true
	}
	for _, n := range rfc1918Nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// rePlate is a very conservative US plate detector. The pattern
// matches "ABC1234" / "ABC-1234" / "1ABC234" with 4–8 alphanumeric
// chars total. This will false-positive on many alphanumeric IDs, so
// callers should prefer the explicit ClassPlate opt-in (per
// [Policy.Allow]) only on text known to contain plates.
var rePlate = regexp.MustCompile(`\b[A-Z]{1,3}[-\s]?\d{1,4}[A-Z]{0,3}\b|\b\d{1,2}[-\s]?[A-Z]{2,3}[-\s]?\d{2,4}\b`)

func detectPlate(text string) []Span {
	hits := rePlate.FindAllStringIndex(strings.ToUpper(text), -1)
	if len(hits) == 0 {
		return nil
	}
	out := make([]Span, 0, len(hits))
	for _, h := range hits {
		out = append(out, Span{Start: h[0], End: h[1], Class: ClassPlate, Score: 0.6})
	}
	return out
}

// reCreditCard matches 13–19 contiguous digits, optionally separated by
// spaces or dashes in groups of 4. The Luhn check below filters random
// digit runs that happen to match the surface.
var reCreditCard = regexp.MustCompile(`\b(?:\d[ -]?){13,19}\b`)

func detectCreditCard(text string) []Span {
	hits := reCreditCard.FindAllStringIndex(text, -1)
	if len(hits) == 0 {
		return nil
	}
	out := make([]Span, 0, len(hits))
	for _, h := range hits {
		raw := text[h[0]:h[1]]
		digits := stripNonDigits(raw)
		if len(digits) < 13 || len(digits) > 19 {
			continue
		}
		if !luhnValid(digits) {
			continue
		}
		out = append(out, Span{Start: h[0], End: h[1], Class: ClassCreditCard, Score: 1.0})
	}
	return out
}

func stripNonDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func luhnValid(digits string) bool {
	sum := 0
	parity := len(digits) % 2
	for i, c := range digits {
		d := int(c - '0')
		if i%2 == parity {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
	}
	return sum%10 == 0
}

// reSSN matches a US social security number in NNN-NN-NNNN form. The
// loose NNNNNNNNN form is intentionally NOT matched — any 9-digit
// run would otherwise false-positive on session IDs and timestamps.
var reSSN = regexp.MustCompile(`\b\d{3}-\d{2}-\d{4}\b`)

func detectSSN(text string) []Span {
	hits := reSSN.FindAllStringIndex(text, -1)
	if len(hits) == 0 {
		return nil
	}
	out := make([]Span, 0, len(hits))
	for _, h := range hits {
		// Reject obviously-invalid SSNs (000-XX-XXXX, 666-XX-XXXX,
		// 9XX-XX-XXXX) per SSA assignment rules.
		s := text[h[0]:h[1]]
		area, _ := strconv.Atoi(s[:3])
		if area == 0 || area == 666 || area >= 900 {
			continue
		}
		out = append(out, Span{Start: h[0], End: h[1], Class: ClassSSN, Score: 1.0})
	}
	return out
}
