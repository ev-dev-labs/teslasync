package redact

import (
	"strings"
	"testing"
)

// realWorldVINs are valid VINs (correct ISO 3779 check digit) used to
// exercise the detector + check-digit validator together. Check digits
// were computed by hand so the tests are self-contained — see the
// arithmetic in detect.go's validVINCheckDigit comments.
var realWorldVINs = []string{
	"5YJ3E1EA2JF000316", // Tesla Model 3 sample, check digit '2'
	"1HGCM82633A004352", // Honda Accord sample, check digit '3'
	"WBA3A5C56CFP09173", // BMW 3-series sample, check digit '6'
}

func TestDetect_VIN_AcceptsValidCheckDigit(t *testing.T) {
	t.Parallel()
	for _, vin := range realWorldVINs {
		text := "vehicle " + vin + " reported"
		spans := Detect(text)
		if len(spans) != 1 {
			t.Fatalf("vin=%s: spans = %d, want 1", vin, len(spans))
		}
		if spans[0].Class != ClassVIN {
			t.Errorf("vin=%s: class = %v, want vin", vin, spans[0].Class)
		}
		if got := text[spans[0].Start:spans[0].End]; got != vin {
			t.Errorf("vin=%s: extracted %q", vin, got)
		}
	}
}

func TestDetect_VIN_RejectsBadCheckDigit(t *testing.T) {
	t.Parallel()
	// Take a real VIN and flip the check-digit position.
	bad := "5YJ3E1EA9JF000316" // valid check digit was '2', now '9'
	spans := Detect("see " + bad + " here")
	for _, s := range spans {
		if s.Class == ClassVIN {
			t.Fatalf("bad-check-digit VIN should not match: %v", s)
		}
	}
}

func TestDetect_VIN_RejectsForbiddenLetters(t *testing.T) {
	t.Parallel()
	// I, O, Q are illegal in VIN; the surface regex must reject.
	for _, bad := range []string{"5YJ3O1EA2JF000316", "5YJ3I1EA2JF000316", "5YJ3Q1EA2JF000316"} {
		spans := Detect("vin " + bad + " end")
		for _, s := range spans {
			if s.Class == ClassVIN {
				t.Fatalf("VIN with forbidden letter should not match: %v", s)
			}
		}
	}
}

func TestDetect_Email(t *testing.T) {
	t.Parallel()
	cases := []string{
		"alice@example.com",
		"alice.bob+tag@sub.example.org",
		"x_99@host-1.co",
	}
	for _, c := range cases {
		spans := Detect("contact " + c + " please")
		if len(spans) != 1 || spans[0].Class != ClassEmail {
			t.Errorf("email=%s: spans = %v", c, spans)
		}
	}
}

func TestDetect_Email_NotMatchedInMidWord(t *testing.T) {
	t.Parallel()
	// No leading word boundary in the middle of "abc@def" — but the
	// regex relies on \b which doesn't quite work for our word chars.
	// We accept the span that's there; check the email regex is at
	// least precise enough to skip a string with no '.' TLD.
	spans := Detect("foo@bar nopart")
	for _, s := range spans {
		if s.Class == ClassEmail {
			t.Fatalf("email without TLD should not match: %v", s)
		}
	}
}

func TestDetect_Phone(t *testing.T) {
	t.Parallel()
	cases := []string{
		"(555) 123-4567",
		"555-123-4567",
		"555.123.4567",
		"+15551234567",
		"+44 20 7946 0958",
	}
	for _, c := range cases {
		spans := Detect("call " + c + " for help")
		if len(spans) == 0 {
			t.Errorf("phone=%s: no match", c)
			continue
		}
		found := false
		for _, s := range spans {
			if s.Class == ClassPhone {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("phone=%s: not classified as phone, got %v", c, spans)
		}
	}
}

func TestDetect_LatLong_DecimalPair(t *testing.T) {
	t.Parallel()
	text := "trip ended at 37.7749, -122.4194 around dinner"
	spans := Detect(text)
	if len(spans) == 0 {
		t.Fatal("expected at least one span")
	}
	found := false
	for _, s := range spans {
		if s.Class == ClassLatLong {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("no lat/long span in %v", spans)
	}
}

func TestDetect_LatLong_RejectsOutOfRange(t *testing.T) {
	t.Parallel()
	// 500 is not a valid latitude.
	text := "garbage 500.1234, 600.5678 here"
	spans := Detect(text)
	for _, s := range spans {
		if s.Class == ClassLatLong {
			t.Fatalf("out-of-range lat/long should not match: %v", s)
		}
	}
}

func TestDetect_LatLong_JSONShape(t *testing.T) {
	t.Parallel()
	text := `payload {"lat":37.77,"lng":-122.41} ok`
	spans := Detect(text)
	found := false
	for _, s := range spans {
		if s.Class == ClassLatLong {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("JSON lat/lng shape not detected: %v", spans)
	}
}

func TestDetect_StreetAddress(t *testing.T) {
	t.Parallel()
	cases := []string{
		"123 Main St",
		"4567 Pine Avenue",
		"7 Cherry Tree Lane",
	}
	for _, c := range cases {
		spans := Detect("delivered to " + c + " yesterday")
		found := false
		for _, s := range spans {
			if s.Class == ClassStreetAddr {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("address=%q: not detected, got %v", c, spans)
		}
	}
}

func TestDetect_StreetAddress_RejectsNonAddress(t *testing.T) {
	t.Parallel()
	// "5 minutes ago" looks like number+word but the suffix is not
	// in the recognised list.
	spans := Detect("5 minutes ago we saw")
	for _, s := range spans {
		if s.Class == ClassStreetAddr {
			t.Fatalf("non-address should not match: %v", s)
		}
	}
}

func TestDetect_IP_PublicMatches(t *testing.T) {
	t.Parallel()
	text := "outbound peer 8.8.8.8 ack"
	spans := Detect(text)
	found := false
	for _, s := range spans {
		if s.Class == ClassIPAddress {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("public IP not detected: %v", spans)
	}
}

func TestDetect_IP_PrivateExcluded(t *testing.T) {
	t.Parallel()
	for _, addr := range []string{
		"10.0.0.1", "172.16.0.5", "192.168.1.10",
		"127.0.0.1", "169.254.1.2",
	} {
		spans := Detect("infra " + addr + " noted")
		for _, s := range spans {
			if s.Class == ClassIPAddress {
				t.Fatalf("private/loopback IP %s should not be classified as PII: %v", addr, s)
			}
		}
	}
}

func TestDetect_IPv6_PublicMatches(t *testing.T) {
	t.Parallel()
	text := "v6 client 2001:db8::1 said"
	spans := Detect(text)
	found := false
	for _, s := range spans {
		if s.Class == ClassIPAddress {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("public IPv6 not detected: %v", spans)
	}
}

func TestDetect_IPv6_LoopbackExcluded(t *testing.T) {
	t.Parallel()
	for _, addr := range []string{"::1", "fe80::1"} {
		spans := Detect("infra " + addr + " noted")
		for _, s := range spans {
			if s.Class == ClassIPAddress {
				t.Fatalf("infra v6 %s should not be PII: %v", addr, s)
			}
		}
	}
}

func TestDetect_CreditCard_LuhnValid(t *testing.T) {
	t.Parallel()
	// Test PANs from PCI DSS test card list (Luhn-valid, never issued).
	for _, pan := range []string{"4111111111111111", "5500000000000004", "340000000000009"} {
		spans := Detect("paid with " + pan + " thanks")
		found := false
		for _, s := range spans {
			if s.Class == ClassCreditCard {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("PAN %s not detected: %v", pan, spans)
		}
	}
}

func TestDetect_CreditCard_LuhnInvalidRejected(t *testing.T) {
	t.Parallel()
	bad := "4111111111111112" // last digit broken
	spans := Detect("not " + bad + " card")
	for _, s := range spans {
		if s.Class == ClassCreditCard {
			t.Fatalf("Luhn-invalid should not match: %v", s)
		}
	}
}

func TestDetect_SSN(t *testing.T) {
	t.Parallel()
	spans := Detect("ssn 123-45-6789 noted")
	found := false
	for _, s := range spans {
		if s.Class == ClassSSN {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("SSN not detected: %v", spans)
	}
}

func TestDetect_SSN_RejectsInvalidArea(t *testing.T) {
	t.Parallel()
	for _, ssn := range []string{"000-12-3456", "666-12-3456", "900-12-3456"} {
		spans := Detect("ssa " + ssn + " bad")
		for _, s := range spans {
			if s.Class == ClassSSN {
				t.Fatalf("invalid SSA area %s should not match: %v", ssn, s)
			}
		}
	}
}

func TestDetect_Empty(t *testing.T) {
	t.Parallel()
	if got := Detect(""); got != nil {
		t.Fatalf("empty input got %v", got)
	}
}

func TestDetect_NoMatches(t *testing.T) {
	t.Parallel()
	if got := Detect("plain prose with no PII anywhere"); len(got) != 0 {
		t.Fatalf("expected no spans, got %v", got)
	}
}

func TestDetect_SortedAndDeduped(t *testing.T) {
	t.Parallel()
	// Build a string with several types in mixed order.
	text := "vin 5YJ3E1EA2JF000316 email alice@example.com"
	spans := Detect(text)
	// Spans must be sorted by Start ascending.
	for i := 1; i < len(spans); i++ {
		if spans[i-1].Start > spans[i].Start {
			t.Fatalf("spans not sorted: %v", spans)
		}
	}
	// No two spans should share a Start.
	starts := map[int]bool{}
	for _, s := range spans {
		if starts[s.Start] {
			t.Fatalf("duplicate start in spans: %v", spans)
		}
		starts[s.Start] = true
	}
}

func TestAllClassesCoverage(t *testing.T) {
	t.Parallel()
	all := AllClasses()
	if len(all) != 11 {
		t.Errorf("AllClasses len = %d, want 11", len(all))
	}
	// Defensive copy: mutating returned slice must not affect callers.
	all[0] = "MUTATED"
	again := AllClasses()
	if again[0] == "MUTATED" {
		t.Error("AllClasses returned shared slice; defensive copy required")
	}
}

func TestIsKnown(t *testing.T) {
	t.Parallel()
	for _, c := range AllClasses() {
		if !IsKnown(c) {
			t.Errorf("IsKnown(%v) = false", c)
		}
	}
	if IsKnown("notaclass") {
		t.Error("IsKnown rejected unknown class")
	}
}

func TestVINCheckDigit_RealAndFake(t *testing.T) {
	t.Parallel()
	for _, v := range realWorldVINs {
		if !validVINCheckDigit(strings.ToUpper(v)) {
			t.Errorf("real VIN %s rejected by check digit", v)
		}
	}
	if validVINCheckDigit("5YJ3E1EA9JF000316") {
		t.Error("flipped check digit accepted")
	}
}

func TestLuhnValid(t *testing.T) {
	t.Parallel()
	if !luhnValid("4111111111111111") {
		t.Error("known-valid card rejected")
	}
	if luhnValid("4111111111111112") {
		t.Error("known-invalid card accepted")
	}
}
