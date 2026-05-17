package redact

import (
	"strings"
	"testing"
)

func TestApply_DeniesEverythingByDefault(t *testing.T) {
	t.Parallel()
	text := "VIN 5YJ3E1EA2JF000316 emailed alice@example.com"
	out, m, classes := Apply(text, DefaultPolicy())
	if strings.Contains(out, "5YJ3E1EA2JF000316") {
		t.Errorf("VIN survived: %q", out)
	}
	if strings.Contains(out, "alice@example.com") {
		t.Errorf("email survived: %q", out)
	}
	if m.Len() != 2 {
		t.Errorf("manifest len = %d, want 2", m.Len())
	}
	wantClasses := map[PIIClass]bool{ClassVIN: true, ClassEmail: true}
	if len(classes) != 2 {
		t.Errorf("classes = %v, want 2", classes)
	}
	for _, c := range classes {
		if !wantClasses[c] {
			t.Errorf("unexpected class %v", c)
		}
	}
}

func TestApply_AllowsExplicitClass(t *testing.T) {
	t.Parallel()
	text := "VIN 5YJ3E1EA2JF000316 emailed alice@example.com"
	out, m, classes := Apply(text, Policy{
		Allow: []PIIClass{ClassVIN},
		Mode:  ModeRedactedTags,
	})
	if !strings.Contains(out, "5YJ3E1EA2JF000316") {
		t.Errorf("VIN should pass through: %q", out)
	}
	if strings.Contains(out, "alice@example.com") {
		t.Errorf("email should still be redacted: %q", out)
	}
	if m.Len() != 1 {
		t.Errorf("manifest len = %d, want 1 (only email)", m.Len())
	}
	if len(classes) != 1 || classes[0] != ClassEmail {
		t.Errorf("classes = %v, want [email]", classes)
	}
}

func TestApply_ModeRedactedTokens(t *testing.T) {
	t.Parallel()
	text := "VIN 5YJ3E1EA2JF000316"
	out, _, _ := Apply(text, Policy{Mode: ModeRedactedTokens})
	if !strings.Contains(out, "[VIN]") {
		t.Errorf("expected [VIN] token, got %q", out)
	}
}

func TestApply_ModeTruncate(t *testing.T) {
	t.Parallel()
	text := "VIN 5YJ3E1EA2JF000316 reported"
	out, _, _ := Apply(text, Policy{Mode: ModeTruncate})
	// VIN should be removed entirely.
	if strings.Contains(out, "5YJ3E1EA2JF000316") {
		t.Errorf("VIN survived truncate: %q", out)
	}
	if strings.Contains(out, "[VIN]") || strings.Contains(out, "<vin") {
		t.Errorf("truncate should not insert markers: %q", out)
	}
}

func TestApply_ModeRedactedTags_RoundTripFormat(t *testing.T) {
	t.Parallel()
	text := "VIN 5YJ3E1EA2JF000316"
	out, m, _ := Apply(text, Policy{Mode: ModeRedactedTags})
	if !strings.Contains(out, "<vin id='1'/>") {
		t.Errorf("expected tag token, got %q", out)
	}
	class, original, ok := m.Lookup(1)
	if !ok || class != ClassVIN || original != "5YJ3E1EA2JF000316" {
		t.Errorf("manifest entry wrong: class=%v original=%q ok=%v", class, original, ok)
	}
}

func TestApply_EmptyText(t *testing.T) {
	t.Parallel()
	out, m, classes := Apply("", DefaultPolicy())
	if out != "" {
		t.Errorf("empty in, want empty out, got %q", out)
	}
	if m.Len() != 0 {
		t.Errorf("manifest should be empty, got %d", m.Len())
	}
	if classes != nil {
		t.Errorf("classes should be nil, got %v", classes)
	}
}

func TestApply_NoPII(t *testing.T) {
	t.Parallel()
	text := "this prose has no personally identifying information"
	out, m, classes := Apply(text, DefaultPolicy())
	if out != text {
		t.Errorf("text should be unchanged, got %q", out)
	}
	if m.Len() != 0 {
		t.Errorf("manifest should be empty, got %d", m.Len())
	}
	if classes != nil {
		t.Errorf("classes should be nil, got %v", classes)
	}
}

func TestApply_DistinctClassesNoDuplicates(t *testing.T) {
	t.Parallel()
	// Two VINs in one text — classes slice should still report VIN
	// once.
	text := "VIN 5YJ3E1EA2JF000316 and VIN 1HGCM82633A004352"
	_, m, classes := Apply(text, DefaultPolicy())
	if m.Len() != 2 {
		t.Errorf("manifest len = %d, want 2", m.Len())
	}
	if len(classes) != 1 || classes[0] != ClassVIN {
		t.Errorf("classes = %v, want [vin]", classes)
	}
}

func TestApply_ManifestAcceptsMultipleClasses(t *testing.T) {
	t.Parallel()
	text := "VIN 5YJ3E1EA2JF000316, email alice@example.com, ip 8.8.8.8"
	_, m, classes := Apply(text, DefaultPolicy())
	if m.Len() != 3 {
		t.Errorf("manifest len = %d, want 3", m.Len())
	}
	if len(classes) != 3 {
		t.Errorf("classes len = %d, want 3", len(classes))
	}
}

func TestManifest_LookupOutOfRange(t *testing.T) {
	t.Parallel()
	m := &Manifest{}
	if _, _, ok := m.Lookup(0); ok {
		t.Error("Lookup(0) should be false")
	}
	if _, _, ok := m.Lookup(1); ok {
		t.Error("Lookup on empty manifest should be false")
	}
	var nilM *Manifest
	if _, _, ok := nilM.Lookup(1); ok {
		t.Error("Lookup on nil manifest should be false")
	}
}
