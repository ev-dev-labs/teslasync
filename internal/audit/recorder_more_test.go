package audit

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/otel/trace"
)

func TestCategoryValidate(t *testing.T) {
	t.Parallel()
	for _, c := range []Category{CategoryAuth, CategoryAdmin, CategoryData, CategoryConfig, CategorySecurity} {
		if err := c.Validate(); err != nil {
			t.Fatalf("%s: %v", c, err)
		}
	}
	if err := Category("nope").Validate(); err == nil {
		t.Fatal("want unknown category error")
	}
}

func TestRedactors(t *testing.T) {
	t.Parallel()
	if (DenyAllRedactor{}).Redact(CategoryAuth, "x", nil) != nil {
		t.Fatal("nil should stay nil")
	}
	if got := (AllowAllRedactor{}).Redact(CategoryAuth, "x", "secret"); got != "secret" {
		t.Fatalf("AllowAll=%v", got)
	}
}

func TestNew_NilPoolAndDefaultRedactor(t *testing.T) {
	t.Parallel()
	if New(nil, nil) != nil {
		t.Fatal("nil pool must return nil recorder")
	}
}

func TestNilRecorderMethods(t *testing.T) {
	t.Parallel()
	var r *Recorder
	if err := r.Hydrate(context.Background()); err != nil {
		t.Fatalf("Hydrate nil: %v", err)
	}
	if err := r.Record(context.Background(), Event{Actor: "a", Action: "b", EntityType: "c"}); err != nil {
		t.Fatalf("Record nil: %v", err)
	}
	id, n, err := r.VerifyChain(context.Background(), time.Now(), 10)
	if err != nil || id != 0 || n != 0 {
		t.Fatalf("VerifyChain nil id=%d n=%d err=%v", id, n, err)
	}
}

func TestRecord_RequiredFields(t *testing.T) {
	t.Parallel()
	r := &Recorder{redactor: AllowAllRedactor{}, now: time.Now}
	if err := r.Record(context.Background(), Event{}); err == nil {
		t.Fatal("want required-field error")
	}
}

func TestMarshalRedactedAndNullables(t *testing.T) {
	t.Parallel()
	b, err := marshalRedacted(AllowAllRedactor{}, CategoryData, "upd", nil)
	if err != nil || b != nil {
		t.Fatalf("nil value: %v %v", b, err)
	}
	b, err = marshalRedacted(DenyAllRedactor{}, CategoryData, "upd", map[string]string{"token": "x"})
	if err != nil || string(b) != `"[REDACTED]"` {
		t.Fatalf("redacted=%s err=%v", b, err)
	}
	if nullableStr("") != nil || nullableStr("ok") != "ok" {
		t.Fatal("nullableStr")
	}
	if nullableJSON(nil) != nil || nullableJSON([]byte{}) != nil {
		t.Fatal("nullableJSON empty")
	}
	if got := nullableJSON([]byte(`{}`)); string(got.([]byte)) != "{}" {
		t.Fatalf("nullableJSON=%v", got)
	}
}

func TestTraceIDFromContext_EmptyWithoutSpan(t *testing.T) {
	t.Parallel()
	if got := traceIDFromContext(context.Background()); got != "" {
		t.Fatalf("got %q", got)
	}
	// Invalid span context still empty.
	ctx := trace.ContextWithSpanContext(context.Background(), trace.SpanContext{})
	if got := traceIDFromContext(ctx); got != "" {
		t.Fatalf("invalid span got %q", got)
	}
}
