package redact

import (
	"fmt"
	"strings"
)

// Mode controls how a detected PII span is rewritten by [Apply] when
// the span's [PIIClass] is NOT in the active [Policy.Allow] set.
type Mode int

const (
	// ModeRedactedTags replaces a span with a self-closing XML-style
	// token like `<vin id='1'/>`. This is the default because it is
	// round-trippable: [Restore] can substitute the original value
	// back in when the LLM mentions the token in its reply.
	ModeRedactedTags Mode = iota
	// ModeRedactedTokens replaces a span with a class-name placeholder
	// like `[VIN]`. NOT round-trippable — every value of a class
	// collapses to the same token. Use when the model's reply is
	// shown to a different user (e.g. analytics) so a stitched-back
	// VIN would itself be a leak.
	ModeRedactedTokens
	// ModeTruncate removes the span entirely (replaces with empty
	// string). Use when even the existence of a value is sensitive.
	ModeTruncate
)

// Manifest is the in-process map from a per-message token ID back to
// the original PII value. It is a function-scoped artefact: callers
// keep it for the lifetime of the request and pass it to [Restore]
// when stitching the LLM's reply.
//
// Manifests are NEVER persisted, NEVER serialised, NEVER sent to the
// provider. Their only role is to let a chatbot answer "your battery
// at VIN 5YJ3E1EA2JF000316 is at 78%" instead of "your battery at
// <vin id='1'/> is at 78%".
type Manifest struct {
	// entries indexed 0..N-1. The token ID embedded in the rewritten
	// text is `index+1` (one-based) so id='0' never appears — easier
	// for humans to scan during debugging.
	entries []manifestEntry
}

type manifestEntry struct {
	Class    PIIClass
	Original string
}

// Lookup returns the original value for token id (one-based) and a
// boolean ok flag. Returns false for any id outside the manifest.
func (m *Manifest) Lookup(id int) (PIIClass, string, bool) {
	if m == nil || id < 1 || id > len(m.entries) {
		return "", "", false
	}
	e := m.entries[id-1]
	return e.Class, e.Original, true
}

// Len returns the number of entries in the manifest.
func (m *Manifest) Len() int {
	if m == nil {
		return 0
	}
	return len(m.entries)
}

// Apply runs every detector over text and replaces each span whose
// [PIIClass] is NOT in policy.Allow according to policy.Mode. Returns
// the rewritten text, the manifest (empty when policy is fully
// permissive or no PII was detected), and the set of classes that
// were actually redacted on this call.
//
// Spans for allowed classes are LEFT IN PLACE — they are not in the
// manifest and not in the redacted-classes return set. This is the
// "explicit opt-in" semantic: a feature that allows ClassVehicleName
// receives the vehicle name verbatim in the prompt while every other
// class is still cleansed.
func Apply(text string, policy Policy) (string, *Manifest, []PIIClass) {
	if text == "" {
		return text, &Manifest{}, nil
	}
	allowed := policy.allowSet()
	var spans []Span
	if policy.EnablePlate {
		spans = DetectAll(text)
	} else {
		spans = Detect(text)
	}
	if len(spans) == 0 {
		return text, &Manifest{}, nil
	}

	var (
		out      strings.Builder
		manifest = &Manifest{entries: make([]manifestEntry, 0, len(spans))}
		classes  = make([]PIIClass, 0, 4)
		seen     = make(map[PIIClass]bool, 4)
		cursor   = 0
	)
	out.Grow(len(text) + len(spans)*16)

	for _, sp := range spans {
		if sp.Start < cursor {
			// Overlap survived dedupe (defensive); skip the inner span.
			continue
		}
		// Allowed class? Pass it through verbatim.
		if allowed[sp.Class] {
			out.WriteString(text[cursor:sp.End])
			cursor = sp.End
			continue
		}
		// Write everything before the span unchanged.
		out.WriteString(text[cursor:sp.Start])
		// Rewrite the span according to mode.
		original := text[sp.Start:sp.End]
		token := writeReplacement(&out, manifest, sp.Class, original, policy.Mode)
		_ = token // captured inside writeReplacement
		cursor = sp.End
		if !seen[sp.Class] {
			seen[sp.Class] = true
			classes = append(classes, sp.Class)
		}
	}
	out.WriteString(text[cursor:])
	return out.String(), manifest, classes
}

// writeReplacement emits the rewrite for one span and updates the
// manifest. Returns the token string (used by tests; production
// callers can ignore).
func writeReplacement(out *strings.Builder, m *Manifest, class PIIClass, original string, mode Mode) string {
	switch mode {
	case ModeRedactedTokens:
		token := fmt.Sprintf("[%s]", strings.ToUpper(string(class)))
		out.WriteString(token)
		// Manifest still tracks the original so Restore could swap
		// it back if the caller switches to tag mode later.
		m.entries = append(m.entries, manifestEntry{Class: class, Original: original})
		return token
	case ModeTruncate:
		// Empty replacement — manifest still records for audit.
		m.entries = append(m.entries, manifestEntry{Class: class, Original: original})
		return ""
	default: // ModeRedactedTags
		m.entries = append(m.entries, manifestEntry{Class: class, Original: original})
		token := fmt.Sprintf("<%s id='%d'/>", string(class), len(m.entries))
		out.WriteString(token)
		return token
	}
}
