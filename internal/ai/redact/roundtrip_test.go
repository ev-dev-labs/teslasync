package redact

import (
	"strings"
	"testing"
)

func TestRestore_RoundTripsTokens(t *testing.T) {
	t.Parallel()
	original := "VIN 5YJ3E1EA2JF000316 belongs to alice@example.com"
	clean, m, _ := Apply(original, DefaultPolicy())
	// Simulate the LLM echoing the tokens back in its reply.
	llmReply := "I checked " + clean + " for you."
	restored := Restore(llmReply, m)
	if !strings.Contains(restored, "5YJ3E1EA2JF000316") {
		t.Errorf("restored text missing VIN: %q", restored)
	}
	if !strings.Contains(restored, "alice@example.com") {
		t.Errorf("restored text missing email: %q", restored)
	}
}

func TestRestore_LeavesUnknownTokensInPlace(t *testing.T) {
	t.Parallel()
	// Manifest has only one entry but the model emits a second token.
	original := "VIN 5YJ3E1EA2JF000316"
	clean, m, _ := Apply(original, DefaultPolicy())
	hallucinated := clean + " and <vin id='99'/>"
	restored := Restore(hallucinated, m)
	if !strings.Contains(restored, "<vin id='99'/>") {
		t.Errorf("unknown token id should be left in place, got %q", restored)
	}
}

func TestRestore_RejectsClassMismatch(t *testing.T) {
	t.Parallel()
	// Manifest entry 1 is ClassVIN; the model emits an <email id='1'/>
	// token. Must NOT swap in the VIN as if it were an email.
	original := "VIN 5YJ3E1EA2JF000316"
	_, m, _ := Apply(original, DefaultPolicy())
	llmReply := "I saw <email id='1'/>."
	restored := Restore(llmReply, m)
	if !strings.Contains(restored, "<email id='1'/>") {
		t.Errorf("class-mismatched token should be left in place, got %q", restored)
	}
	if strings.Contains(restored, "5YJ3E1EA2JF000316") {
		t.Errorf("must NOT swap VIN into mismatched email token: %q", restored)
	}
}

func TestRestore_NilManifest(t *testing.T) {
	t.Parallel()
	if got := Restore("hello world", nil); got != "hello world" {
		t.Errorf("nil manifest should be no-op, got %q", got)
	}
	empty := &Manifest{}
	if got := Restore("hello", empty); got != "hello" {
		t.Errorf("empty manifest should be no-op, got %q", got)
	}
}

func TestRestore_HandlesDoubleQuotes(t *testing.T) {
	t.Parallel()
	original := "VIN 5YJ3E1EA2JF000316"
	_, m, _ := Apply(original, DefaultPolicy())
	// Some models normalise to double quotes.
	llmReply := `I saw <vin id="1"/>.`
	restored := Restore(llmReply, m)
	if !strings.Contains(restored, "5YJ3E1EA2JF000316") {
		t.Errorf("double-quote token form should restore: %q", restored)
	}
}

func TestFormatToken(t *testing.T) {
	t.Parallel()
	if got := FormatToken(ClassVIN, 7); got != "<vin id='7'/>" {
		t.Errorf("FormatToken = %q", got)
	}
}
