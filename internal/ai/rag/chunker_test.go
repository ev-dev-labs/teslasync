package rag

import (
	"strings"
	"testing"
)

func TestChunkText_Empty(t *testing.T) {
	t.Parallel()
	cases := []string{
		"",
		"   ",
		"\n\n\n",
		"\t\n  \n  \t",
	}
	for _, in := range cases {
		got := ChunkText(in, 100)
		if len(got) != 0 {
			t.Fatalf("input %q: want 0 chunks, got %d (%v)", in, len(got), got)
		}
	}
}

func TestChunkText_SingleShort(t *testing.T) {
	t.Parallel()
	got := ChunkText("hello world", 1024)
	if len(got) != 1 {
		t.Fatalf("want 1 chunk, got %d (%v)", len(got), got)
	}
	if got[0] != "hello world" {
		t.Fatalf("got %q", got[0])
	}
}

func TestChunkText_MergesParagraphs(t *testing.T) {
	t.Parallel()
	in := "alpha paragraph.\n\nbeta paragraph.\n\ngamma paragraph."
	got := ChunkText(in, 1024)
	if len(got) != 1 {
		t.Fatalf("want 1 chunk (merged), got %d (%v)", len(got), got)
	}
	for _, expect := range []string{"alpha", "beta", "gamma"} {
		if !strings.Contains(got[0], expect) {
			t.Fatalf("chunk missing %q: %s", expect, got[0])
		}
	}
}

func TestChunkText_SplitsOnParagraphWhenOversized(t *testing.T) {
	t.Parallel()
	// Two paragraphs each ~30 bytes; maxBytes=40 forces a split.
	a := strings.Repeat("a", 30)
	b := strings.Repeat("b", 30)
	in := a + "\n\n" + b
	got := ChunkText(in, 40)
	if len(got) != 2 {
		t.Fatalf("want 2 chunks, got %d (%v)", len(got), got)
	}
	if got[0] != a || got[1] != b {
		t.Fatalf("unexpected split: %v", got)
	}
}

func TestChunkText_RespectsMaxBytes(t *testing.T) {
	t.Parallel()
	// Single paragraph longer than maxBytes — must split via
	// sentence/hard fallback.
	in := strings.Repeat("alpha. ", 200) // ~1400 bytes
	maxBytes := 200
	got := ChunkText(in, maxBytes)
	if len(got) < 2 {
		t.Fatalf("want multiple chunks, got %d", len(got))
	}
	for i, c := range got {
		if len(c) > maxBytes {
			t.Fatalf("chunk %d is %d bytes, max %d (%q)", i, len(c), maxBytes, c)
		}
	}
}

func TestChunkText_HardSplitOnRuneBoundary(t *testing.T) {
	t.Parallel()
	// Single "sentence" (no whitespace) longer than maxBytes — must
	// hard-split on rune boundaries (not mid-UTF-8).
	in := strings.Repeat("héllo", 200) // each "héllo" is 6 bytes (é = 2 bytes)
	got := ChunkText(in, 50)
	if len(got) < 2 {
		t.Fatalf("want multiple chunks, got %d", len(got))
	}
	for i, c := range got {
		if !isValidUTF8(c) {
			t.Fatalf("chunk %d invalid UTF-8: %q", i, c)
		}
	}
}

func TestChunkText_DefaultMaxBytes(t *testing.T) {
	t.Parallel()
	// Negative or zero maxBytes falls back to DefaultChunkBytes.
	in := strings.Repeat("x", DefaultChunkBytes-1)
	got := ChunkText(in, 0)
	if len(got) != 1 {
		t.Fatalf("want 1 chunk, got %d", len(got))
	}
	got = ChunkText(in, -1)
	if len(got) != 1 {
		t.Fatalf("want 1 chunk for -1, got %d", len(got))
	}
}

func isValidUTF8(s string) bool {
	for _, r := range s {
		if r == '\uFFFD' {
			return false
		}
	}
	return true
}
