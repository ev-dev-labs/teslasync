package redaction

import (
	"context"
	"strings"
	"testing"

	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// newTestRedactor builds a Redactor with a fixed salt so hash output is
// deterministic across runs.
func newTestRedactor(t *testing.T) *Redactor {
	t.Helper()
	return NewRedactor(DefaultConfig("test-deployment-salt", DefaultGeoPrecision))
}

// findAttr returns the value of key in attrs, or false if absent.
func findAttr(attrs []attribute.KeyValue, key string) (attribute.Value, bool) {
	for _, kv := range attrs {
		if string(kv.Key) == key {
			return kv.Value, true
		}
	}
	return attribute.Value{}, false
}

func TestRedactAttributes_VIN_IsHashed(t *testing.T) {
	r := newTestRedactor(t)
	const rawVIN = "5YJ3E1EA7KF000316" // valid Tesla VIN check digit
	out := r.RedactAttributes([]attribute.KeyValue{
		attribute.String("vehicle.vin", rawVIN),
	})
	v, ok := findAttr(out, "vehicle.vin")
	if !ok {
		t.Fatal("vehicle.vin attribute missing from output")
	}
	got := v.AsString()
	if strings.Contains(got, rawVIN) {
		t.Fatalf("raw VIN leaked in output: %q", got)
	}
	if !strings.HasPrefix(got, hashPrefix) {
		t.Fatalf("expected hashed value with prefix %q, got %q", hashPrefix, got)
	}
}

func TestRedactAttributes_BareVinKey_IsHashed(t *testing.T) {
	// A developer doing span.SetAttribute("vin", vin) must not leak.
	r := newTestRedactor(t)
	const rawVIN = "5YJ3E1EA7KF000316"
	out := r.RedactAttributes([]attribute.KeyValue{attribute.String("vin", rawVIN)})
	v, _ := findAttr(out, "vin")
	if v.AsString() == rawVIN {
		t.Fatalf("bare 'vin' key not hashed: %q", v.AsString())
	}
	if !strings.HasPrefix(v.AsString(), hashPrefix) {
		t.Fatalf("expected hash prefix, got %q", v.AsString())
	}
}

func TestRedactAttributes_VIN_HashIsStableAndKeyed(t *testing.T) {
	const rawVIN = "5YJ3E1EA7KF000316"
	r1 := NewRedactor(DefaultConfig("salt-A", DefaultGeoPrecision))
	r2 := NewRedactor(DefaultConfig("salt-A", DefaultGeoPrecision))
	r3 := NewRedactor(DefaultConfig("salt-B", DefaultGeoPrecision))

	h1 := r1.hash(rawVIN)
	h2 := r2.hash(rawVIN)
	h3 := r3.hash(rawVIN)

	if h1 != h2 {
		t.Fatalf("same salt must produce same hash: %q vs %q", h1, h2)
	}
	if h1 == h3 {
		t.Fatal("different salts must produce different hashes (not cross-deployment correlatable)")
	}
}

func TestRedactAttributes_VehicleIDInt_IsHashed(t *testing.T) {
	r := newTestRedactor(t)
	out := r.RedactAttributes([]attribute.KeyValue{attribute.Int64("vehicle.id", 42)})
	v, _ := findAttr(out, "vehicle.id")
	if v.Type() != attribute.STRING {
		t.Fatalf("expected hashed string, got type %v", v.Type())
	}
	if !strings.HasPrefix(v.AsString(), hashPrefix) {
		t.Fatalf("vehicle.id not hashed: %q", v.AsString())
	}
	if v.AsString() == "42" {
		t.Fatal("raw vehicle id leaked")
	}
}

func TestRedactAttributes_Geo_RoundedToTwoDecimals(t *testing.T) {
	r := newTestRedactor(t)
	out := r.RedactAttributes([]attribute.KeyValue{
		attribute.Float64("geo.lat", 37.7749295),
		attribute.Float64("geo.lng", -122.4194155),
	})
	lat, _ := findAttr(out, "geo.lat")
	lng, _ := findAttr(out, "geo.lng")
	if lat.AsFloat64() != 37.77 {
		t.Fatalf("latitude not fuzzed to 2dp: got %v want 37.77", lat.AsFloat64())
	}
	if lng.AsFloat64() != -122.42 {
		t.Fatalf("longitude not fuzzed to 2dp: got %v want -122.42", lng.AsFloat64())
	}
}

func TestRedactAttributes_Geo_StringValueRounded(t *testing.T) {
	r := newTestRedactor(t)
	out := r.RedactAttributes([]attribute.KeyValue{
		attribute.String("vehicle.latitude", "37.7749295"),
	})
	v, _ := findAttr(out, "vehicle.latitude")
	if v.AsString() != "37.77" {
		t.Fatalf("string latitude not fuzzed: got %q want 37.77", v.AsString())
	}
}

func TestRedactAttributes_Geo_ConfigurablePrecision(t *testing.T) {
	r := NewRedactor(DefaultConfig("s", 3))
	out := r.RedactAttributes([]attribute.KeyValue{attribute.Float64("position.lat", 37.7749295)})
	v, _ := findAttr(out, "position.lat")
	if v.AsFloat64() != 37.775 {
		t.Fatalf("expected 3dp precision 37.775, got %v", v.AsFloat64())
	}
}

func TestRedactAttributes_GeoLookalikeKeyNotFuzzed(t *testing.T) {
	// "platitude" ends in "tude" but its final segment is not a geo suffix.
	r := newTestRedactor(t)
	out := r.RedactAttributes([]attribute.KeyValue{attribute.Float64("platitude", 37.7749295)})
	v, _ := findAttr(out, "platitude")
	if v.AsFloat64() != 37.7749295 {
		t.Fatalf("non-geo key was wrongly fuzzed: %v", v.AsFloat64())
	}
}

func TestRedactAttributes_BearerToken_IsRedacted(t *testing.T) {
	r := newTestRedactor(t)
	const secret = "Bearer abcDEF123456ghizyx789"
	out := r.RedactAttributes([]attribute.KeyValue{attribute.String("http.header.authorization", secret)})
	v, _ := findAttr(out, "http.header.authorization")
	got := v.AsString()
	if strings.Contains(got, "abcDEF123456ghizyx789") {
		t.Fatalf("bearer token leaked: %q", got)
	}
	if !strings.Contains(got, redactedToken) {
		t.Fatalf("expected redaction marker in %q", got)
	}
	if !strings.HasPrefix(strings.ToLower(got), "bearer ") {
		t.Fatalf("benign 'Bearer ' prefix should be preserved: %q", got)
	}
}

func TestRedactAttributes_JWT_IsRedacted(t *testing.T) {
	r := newTestRedactor(t)
	jwt := "eyJhbGciOiJIUzI1Ni1.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N"
	out := r.RedactAttributes([]attribute.KeyValue{attribute.String("token", jwt)})
	v, _ := findAttr(out, "token")
	if strings.Contains(v.AsString(), "eyJ") {
		t.Fatalf("JWT leaked: %q", v.AsString())
	}
}

func TestRedactAttributes_PEM_IsRedacted(t *testing.T) {
	r := newTestRedactor(t)
	pem := "-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBgkqhkiG9w0BAQEFAA\n-----END PRIVATE KEY-----"
	out := r.RedactAttributes([]attribute.KeyValue{attribute.String("config.key", pem)})
	v, _ := findAttr(out, "config.key")
	if strings.Contains(v.AsString(), "MIIBVgIBADANBgkqhkiG") {
		t.Fatalf("PEM body leaked: %q", v.AsString())
	}
	if v.AsString() != redactedToken {
		t.Fatalf("expected PEM collapsed to %q, got %q", redactedToken, v.AsString())
	}
}

func TestRedactAttributes_APIKeyValue_IsRedacted(t *testing.T) {
	r := newTestRedactor(t)
	out := r.RedactAttributes([]attribute.KeyValue{
		attribute.String("sk-key", "sk-abcdefghijklmnopqrstuvwx"),
		attribute.String("query", "api_key=supersecretvalue123&foo=bar"),
	})
	if v, _ := findAttr(out, "sk-key"); strings.Contains(v.AsString(), "abcdefghijklmnop") {
		t.Fatalf("sk- api key leaked: %q", v.AsString())
	}
	if v, _ := findAttr(out, "query"); strings.Contains(v.AsString(), "supersecretvalue123") {
		t.Fatalf("api_key=value leaked: %q", v.AsString())
	}
}

func TestRedactAttributes_BenignUntouched(t *testing.T) {
	r := newTestRedactor(t)
	in := []attribute.KeyValue{
		attribute.String("http.method", "GET"),
		attribute.String("db.sql.table", "drives"),
		attribute.Int("db.row_count", 17),
		attribute.String("handler", "ListDrives"),
		attribute.Bool("cache.hit", true),
	}
	out := r.RedactAttributes(in)
	// No change → identical slice returned.
	if &out[0] != &in[0] {
		t.Fatal("benign attributes should pass through without reallocation")
	}
	for _, kv := range out {
		if strings.Contains(kv.Value.Emit(), redactedToken) {
			t.Fatalf("benign attribute %q was wrongly redacted", kv.Key)
		}
	}
}

func TestRedactAttributes_NilAndEmpty(t *testing.T) {
	r := newTestRedactor(t)
	if got := r.RedactAttributes(nil); got != nil {
		t.Fatal("nil input should return nil")
	}
	var nilR *Redactor
	in := []attribute.KeyValue{attribute.String("vin", "x")}
	if got := nilR.RedactAttributes(in); len(got) != 1 || got[0].Value.AsString() != "x" {
		t.Fatal("nil redactor should pass attributes through unchanged")
	}
}

// --- Exporter decorator integration --------------------------------------

// capturingExporter records the spans it is asked to export.
type capturingExporter struct {
	spans []sdktrace.ReadOnlySpan
}

func (c *capturingExporter) ExportSpans(_ context.Context, spans []sdktrace.ReadOnlySpan) error {
	c.spans = append(c.spans, spans...)
	return nil
}
func (c *capturingExporter) Shutdown(context.Context) error { return nil }

// emitSpan creates one finished span carrying attrs and returns the ReadOnly
// snapshot the SDK would hand an exporter.
func emitSpan(t *testing.T, exp sdktrace.SpanExporter, attrs ...attribute.KeyValue) {
	t.Helper()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exp))
	_, span := tp.Tracer("test").Start(context.Background(), "op", trace.WithAttributes(attrs...))
	span.End()
	if err := tp.Shutdown(context.Background()); err != nil {
		t.Fatalf("provider shutdown: %v", err)
	}
}

func TestRedactingExporter_NoRawIdentifierGeoOrSecretReachesExporter(t *testing.T) {
	cap := &capturingExporter{}
	r := newTestRedactor(t)
	dec := NewRedactingExporter(cap, r)

	const rawVIN = "5YJ3E1EA7KF000316"
	emitSpan(t, dec,
		attribute.String("vehicle.vin", rawVIN),
		attribute.Float64("geo.lat", 37.7749295),
		attribute.String("authorization", "Bearer leakedtokenvalue12345"),
		attribute.String("http.method", "GET"),
	)

	if len(cap.spans) != 1 {
		t.Fatalf("expected 1 exported span, got %d", len(cap.spans))
	}
	attrs := cap.spans[0].Attributes()

	vin, _ := findAttr(attrs, "vehicle.vin")
	if vin.AsString() == rawVIN || strings.Contains(vin.AsString(), rawVIN) {
		t.Fatalf("raw VIN reached exporter: %q", vin.AsString())
	}
	lat, _ := findAttr(attrs, "geo.lat")
	if lat.AsFloat64() != 37.77 {
		t.Fatalf("un-fuzzed geo reached exporter: %v", lat.AsFloat64())
	}
	auth, _ := findAttr(attrs, "authorization")
	if strings.Contains(auth.AsString(), "leakedtokenvalue12345") {
		t.Fatalf("raw bearer token reached exporter: %q", auth.AsString())
	}
	method, _ := findAttr(attrs, "http.method")
	if method.AsString() != "GET" {
		t.Fatalf("benign attribute mangled: %q", method.AsString())
	}
}

func TestRedactingExporter_NilRedactorPassThrough(t *testing.T) {
	cap := &capturingExporter{}
	dec := NewRedactingExporter(cap, nil)
	emitSpan(t, dec, attribute.String("vehicle.vin", "5YJ3E1EA7KF000316"))
	if len(cap.spans) != 1 {
		t.Fatalf("expected span to pass through, got %d", len(cap.spans))
	}
}

func TestRedactAttributes_NamespacedIdentifierSuffix_IsHashed(t *testing.T) {
	r := newTestRedactor(t)
	out := r.RedactAttributes([]attribute.KeyValue{
		attribute.String("teslasync.vehicle_id", "12345"),
		attribute.String("request.user.id", "user-99"),
		attribute.String("owner.email", "alice@example.com"),
	})
	for _, key := range []string{"teslasync.vehicle_id", "request.user.id", "owner.email"} {
		v, _ := findAttr(out, key)
		if !strings.HasPrefix(v.AsString(), hashPrefix) {
			t.Fatalf("namespaced identifier %q not hashed: %q", key, v.AsString())
		}
	}
}

func TestRedactAttributes_InternalRowIDNotHashed(t *testing.T) {
	// drive.id / charge.id are internal row ids, not personal identifiers —
	// hashing them would needlessly break trace correlation.
	r := newTestRedactor(t)
	out := r.RedactAttributes([]attribute.KeyValue{
		attribute.Int64("drive.id", 7),
		attribute.Int64("charge.id", 8),
		attribute.Int("db.row_count", 42),
	})
	// No identifier/geo/secret → unchanged slice returned.
	if v, _ := findAttr(out, "drive.id"); v.AsInt64() != 7 {
		t.Fatalf("drive.id should be untouched, got %v", v.Emit())
	}
	if v, _ := findAttr(out, "charge.id"); v.AsInt64() != 8 {
		t.Fatalf("charge.id should be untouched, got %v", v.Emit())
	}
}

func TestRedactAttributes_StringSliceIdentifiersHashedAndSecretsScrubbed(t *testing.T) {
	r := newTestRedactor(t)
	out := r.RedactAttributes([]attribute.KeyValue{
		attribute.StringSlice("vehicle.vin", []string{"5YJ3E1EA7KF000316", "5YJ3E1EA7KF000317"}),
		attribute.StringSlice("headers", []string{"Bearer abcDEF123456ghizyx789", "GET"}),
	})
	vins, _ := findAttr(out, "vehicle.vin")
	for _, h := range vins.AsStringSlice() {
		if !strings.HasPrefix(h, hashPrefix) {
			t.Fatalf("slice VIN not hashed: %q", h)
		}
	}
	hdrs, _ := findAttr(out, "headers")
	got := hdrs.AsStringSlice()
	if strings.Contains(got[0], "abcDEF123456ghizyx789") {
		t.Fatalf("slice bearer token leaked: %q", got[0])
	}
	if got[1] != "GET" {
		t.Fatalf("benign slice element mangled: %q", got[1])
	}
}

func TestRedactAttributes_QueryTailNotOverRedacted(t *testing.T) {
	r := newTestRedactor(t)
	out := r.RedactAttributes([]attribute.KeyValue{
		attribute.String("url.query", "api_key=supersecretvalue123&page=2&sort=asc"),
	})
	v, _ := findAttr(out, "url.query")
	got := v.AsString()
	if strings.Contains(got, "supersecretvalue123") {
		t.Fatalf("secret not redacted: %q", got)
	}
	if !strings.Contains(got, "page=2") || !strings.Contains(got, "sort=asc") {
		t.Fatalf("benign query params were over-redacted: %q", got)
	}
}

func TestScrubText_RedactsSecretsInFreeText(t *testing.T) {
	r := newTestRedactor(t)
	in := "failed: Authorization: Bearer leakedtokenvalue12345 returned 401"
	out := r.ScrubText(in)
	if strings.Contains(out, "leakedtokenvalue12345") {
		t.Fatalf("free-text secret leaked: %q", out)
	}
}

func TestRedactingExporter_NoLeakViaNameStatusEventsLinks(t *testing.T) {
	cap := &capturingExporter{}
	r := newTestRedactor(t)
	dec := NewRedactingExporter(cap, r)

	tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(dec))
	_, span := tp.Tracer("test").Start(context.Background(), "op",
		trace.WithLinks(trace.Link{Attributes: []attribute.KeyValue{
			attribute.String("vehicle.vin", "5YJ3E1EA7KF000316"),
		}}),
	)
	// Event whose attributes + name carry sensitive data.
	span.AddEvent("Bearer leakedtokenvalue12345", trace.WithAttributes(
		attribute.Float64("geo.lat", 37.7749295),
	))
	// Status description carrying a token (the SetStatus(err.Error()) path).
	span.SetStatus(2 /*codes.Error*/, "auth failed: Bearer leakedtokenvalue12345")
	span.End()
	if err := tp.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown: %v", err)
	}

	if len(cap.spans) != 1 {
		t.Fatalf("expected 1 span, got %d", len(cap.spans))
	}
	s := cap.spans[0]

	if strings.Contains(s.Status().Description, "leakedtokenvalue12345") {
		t.Fatalf("token leaked via status description: %q", s.Status().Description)
	}
	evs := s.Events()
	if len(evs) != 1 {
		t.Fatalf("expected 1 event, got %d", len(evs))
	}
	if strings.Contains(evs[0].Name, "leakedtokenvalue12345") {
		t.Fatalf("token leaked via event name: %q", evs[0].Name)
	}
	if lat, ok := findAttr(evs[0].Attributes, "geo.lat"); ok && lat.AsFloat64() != 37.77 {
		t.Fatalf("geo leaked via event attributes: %v", lat.AsFloat64())
	}
	links := s.Links()
	if len(links) != 1 {
		t.Fatalf("expected 1 link, got %d", len(links))
	}
	if vin, _ := findAttr(links[0].Attributes, "vehicle.vin"); vin.AsString() == "5YJ3E1EA7KF000316" {
		t.Fatalf("VIN leaked via link attributes: %q", vin.AsString())
	}
}
