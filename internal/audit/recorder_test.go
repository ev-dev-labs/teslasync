package audit

import (
	"testing"
	"time"
)

func TestComputeRowHash_Deterministic(t *testing.T) {
	ev := Event{
		Actor:      "alice@example.com",
		Category:   CategorySecurity,
		Action:     "login_success",
		EntityType: "user",
		Detail:     "via password",
		Success:    true,
	}
	ts := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	h1 := computeRowHash("prev123", ts, ev, []byte(`{"ip":"1.2.3.4"}`), nil, "trace-x")
	h2 := computeRowHash("prev123", ts, ev, []byte(`{"ip":"1.2.3.4"}`), nil, "trace-x")
	if h1 != h2 {
		t.Fatalf("hash not deterministic: %s vs %s", h1, h2)
	}
	if len(h1) != 64 {
		t.Fatalf("expected 64-char sha256 hex, got %d", len(h1))
	}
}

func TestComputeRowHash_ChainsForward(t *testing.T) {
	ev := Event{Actor: "x", Category: CategoryData, Action: "read", EntityType: "vehicle"}
	ts := time.Now().UTC()
	h1 := computeRowHash("", ts, ev, nil, nil, "")
	h2 := computeRowHash(h1, ts, ev, nil, nil, "")
	if h1 == h2 {
		t.Fatal("hash with different prev should differ")
	}
}

func TestComputeRowHash_TamperDetection(t *testing.T) {
	ts := time.Now().UTC()
	base := Event{Actor: "x", Category: CategoryData, Action: "read", EntityType: "v"}
	tampered := Event{Actor: "x", Category: CategoryData, Action: "read", EntityType: "DELETED"}
	h := computeRowHash("p", ts, base, nil, nil, "")
	h2 := computeRowHash("p", ts, tampered, nil, nil, "")
	if h == h2 {
		t.Fatal("tampered event must produce different hash")
	}
}

func TestDenyAllRedactor(t *testing.T) {
	got := DenyAllRedactor{}.Redact(CategorySecurity, "password", "supersecret")
	if got != "[REDACTED]" {
		t.Fatalf("expected [REDACTED], got %v", got)
	}
}
