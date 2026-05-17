package rag

import (
	"strings"
	"unicode/utf8"
)

// DefaultChunkBytes is the target chunk size in bytes. Empirical
// guidance for nomic-embed-text and text-embedding-3-small is ~500
// tokens per chunk. With ~4 chars per English token the byte target
// lands at ~2000; we round to 2048 to fit cleanly in a 2KB page.
const DefaultChunkBytes = 2048

// ChunkText splits text into chunks no larger than maxBytes, preferring
// paragraph and sentence boundaries to preserve semantic locality.
//
// The algorithm:
//  1. Split on double-newline (paragraph boundary).
//  2. Greedily merge paragraphs until adding another would exceed
//     maxBytes; emit the merged block.
//  3. If a single paragraph exceeds maxBytes, fall through to a
//     sentence-level split (split on ". ", "! ", "? ").
//  4. If a single sentence still exceeds maxBytes, hard-split at
//     the rune-aligned byte boundary nearest maxBytes (so we never
//     split a multi-byte UTF-8 character).
//
// Empty input yields an empty slice. Whitespace-only input yields an
// empty slice. The returned chunks are always non-empty and trimmed
// of leading/trailing whitespace.
//
// maxBytes <= 0 falls back to [DefaultChunkBytes] so a caller can
// pass 0 to mean "use the default" without a separate sentinel.
//
// The function is named ChunkText (not Chunk) to avoid colliding
// with the [Chunk] result type — Go disallows a type and a function
// sharing a name in the same package.
func ChunkText(text string, maxBytes int) []string {
	if maxBytes <= 0 {
		maxBytes = DefaultChunkBytes
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}

	paragraphs := splitNonEmpty(text, "\n\n")
	if len(paragraphs) == 0 {
		// Single line, no paragraph break.
		paragraphs = []string{text}
	}

	var out []string
	var cur strings.Builder
	flush := func() {
		s := strings.TrimSpace(cur.String())
		if s != "" {
			out = append(out, s)
		}
		cur.Reset()
	}

	for _, p := range paragraphs {
		// Single paragraph fits → either start a new chunk or
		// append to the current one.
		if len(p) <= maxBytes {
			if cur.Len() == 0 {
				cur.WriteString(p)
				continue
			}
			// Will appending overflow the current chunk?
			if cur.Len()+len("\n\n")+len(p) > maxBytes {
				flush()
				cur.WriteString(p)
			} else {
				cur.WriteString("\n\n")
				cur.WriteString(p)
			}
			continue
		}

		// Paragraph too large — flush whatever we have, then split
		// the paragraph itself.
		flush()
		for _, sub := range splitLargeParagraph(p, maxBytes) {
			out = append(out, sub)
		}
	}
	flush()

	return out
}

// splitNonEmpty splits s by sep and drops empty fragments (e.g. when
// the input has trailing newlines or a run of blank lines).
func splitNonEmpty(s, sep string) []string {
	parts := strings.Split(s, sep)
	out := parts[:0]
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// splitLargeParagraph fans a single oversized paragraph down to
// chunks no larger than maxBytes, preferring sentence boundaries
// before falling back to a hard byte split.
func splitLargeParagraph(p string, maxBytes int) []string {
	// Sentence-ish split — covers English prose without pulling a
	// sentence-tokeniser dependency. Multi-language deployments can
	// still index correctly, just with chunks aligned to whitespace
	// runs rather than grammatical sentences.
	sentences := splitOnAny(p, []string{". ", "! ", "? ", ".\n", "!\n", "?\n"})
	if len(sentences) == 1 && len(sentences[0]) > maxBytes {
		// Couldn't find a sentence boundary; hard-split.
		return hardSplit(p, maxBytes)
	}

	var out []string
	var cur strings.Builder
	flush := func() {
		s := strings.TrimSpace(cur.String())
		if s != "" {
			out = append(out, s)
		}
		cur.Reset()
	}
	for _, s := range sentences {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if len(s) > maxBytes {
			// One sentence still too big — hard-split it.
			flush()
			out = append(out, hardSplit(s, maxBytes)...)
			continue
		}
		if cur.Len()+1+len(s) > maxBytes {
			flush()
			cur.WriteString(s)
			continue
		}
		if cur.Len() > 0 {
			cur.WriteString(" ")
		}
		cur.WriteString(s)
	}
	flush()
	return out
}

// splitOnAny is strings.SplitN-but-multi-separator. We need it
// because strings.Split takes a single separator and we want to
// split on a small set of sentence terminators while preserving
// the rest of the punctuation.
func splitOnAny(s string, seps []string) []string {
	out := []string{s}
	for _, sep := range seps {
		next := out[:0]
		for _, frag := range out {
			next = append(next, strings.Split(frag, sep)...)
		}
		out = next
	}
	return out
}

// hardSplit chops s into byte-bounded chunks aligned on rune
// boundaries so we never produce invalid UTF-8 mid-chunk. Used as
// the last-resort split when neither paragraph nor sentence
// boundaries can satisfy maxBytes.
func hardSplit(s string, maxBytes int) []string {
	if maxBytes <= 0 {
		maxBytes = DefaultChunkBytes
	}
	var out []string
	for len(s) > maxBytes {
		cut := maxBytes
		// Walk back to the nearest rune boundary so we don't split
		// a multi-byte UTF-8 sequence.
		for cut > 0 && !utf8.RuneStart(s[cut]) {
			cut--
		}
		if cut == 0 {
			// Pathological input (single multi-byte rune > maxBytes);
			// fall back to byte-truncation. This is unreachable for
			// any real text but the safety net keeps the loop bounded.
			cut = maxBytes
		}
		out = append(out, strings.TrimSpace(s[:cut]))
		s = s[cut:]
	}
	if t := strings.TrimSpace(s); t != "" {
		out = append(out, t)
	}
	return out
}
