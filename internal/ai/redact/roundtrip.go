package redact

import (
	"fmt"
	"regexp"
	"strconv"
)

// reTagToken matches a [ModeRedactedTags] replacement: `<class id='N'/>`.
// Whitespace between attributes is tolerated so a model that paraphrases
// `<vin id="1"/>` (double quotes) is also stitched correctly.
var reTagToken = regexp.MustCompile(`<([a-z]+)\s+id\s*=\s*['"](\d+)['"]\s*/>`)

// Restore replaces every round-trippable token in text with the
// original value from manifest. Tokens whose id is out of range or
// whose class disagrees with the manifest entry are left in place
// (defensive — a hallucinated token MUST NOT be silently rewritten to
// some other user's PII).
//
// Manifest may be nil; in that case Restore is a no-op (returns the
// input unchanged). This makes the call site safe in the common case
// where redaction was not active for this turn.
func Restore(text string, m *Manifest) string {
	if m == nil || m.Len() == 0 || text == "" {
		return text
	}
	return reTagToken.ReplaceAllStringFunc(text, func(match string) string {
		groups := reTagToken.FindStringSubmatch(match)
		if len(groups) != 3 {
			return match
		}
		className := PIIClass(groups[1])
		id, err := strconv.Atoi(groups[2])
		if err != nil {
			return match
		}
		mClass, original, ok := m.Lookup(id)
		if !ok || mClass != className {
			return match
		}
		return original
	})
}

// FormatToken returns the canonical [ModeRedactedTags] replacement
// for class+id. Exposed so tests + future tooling can assert / build
// tokens consistently with [Apply]'s output.
func FormatToken(class PIIClass, id int) string {
	return fmt.Sprintf("<%s id='%d'/>", string(class), id)
}
