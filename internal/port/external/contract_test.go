package external_test

import (
	"context"
	"encoding/json"
	"io"
	"reflect"
	"sort"
	"testing"
	"time"
)

// Shared reflect.Type handles used to lock the port interface signatures.
// The port seam is the hexagonal boundary between the application and its
// outbound integrations (Tesla, geocoding, gas prices, object storage); the
// reflective assertions below fail loudly if a method is added, removed, or
// its parameter / return shape drifts.
var (
	ctxType      = reflect.TypeOf((*context.Context)(nil)).Elem()
	errType      = reflect.TypeOf((*error)(nil)).Elem()
	ioReaderType = reflect.TypeOf((*io.Reader)(nil)).Elem()
	stringType   = reflect.TypeOf("")
	float64Type  = reflect.TypeOf(float64(0))
	durationType = reflect.TypeOf(time.Duration(0))
	anyMapType   = reflect.TypeOf(map[string]any(nil))
)

// methodSig describes the expected signature of a single interface method,
// excluding the (implicit) receiver.
type methodSig struct {
	name string
	in   []reflect.Type
	out  []reflect.Type
}

// typeMatches reports whether got is exactly want, or — when want is an
// interface such as context.Context / io.Reader / error — whether got
// implements it.
func typeMatches(got, want reflect.Type) bool {
	if got == want {
		return true
	}
	return want.Kind() == reflect.Interface && got.Implements(want)
}

func ifaceMethodNames(iface reflect.Type) []string {
	names := make([]string, 0, iface.NumMethod())
	for i := 0; i < iface.NumMethod(); i++ {
		names = append(names, iface.Method(i).Name)
	}
	return names
}

// assertInterface locks an interface's method set: kind, count, and each
// method's parameter and return types. It is the reflective backstop that
// keeps the hexagonal port seam from silently growing or drifting.
func assertInterface(t *testing.T, iface reflect.Type, want []methodSig) {
	t.Helper()
	if iface.Kind() != reflect.Interface {
		t.Fatalf("%v: expected interface, got %v", iface, iface.Kind())
	}
	if got := iface.NumMethod(); got != len(want) {
		t.Fatalf("%v: method count = %d %v, want %d", iface, got, ifaceMethodNames(iface), len(want))
	}
	for _, w := range want {
		m, ok := iface.MethodByName(w.name)
		if !ok {
			t.Errorf("%v: missing method %q", iface, w.name)
			continue
		}
		ft := m.Type
		if got := ft.NumIn(); got != len(w.in) {
			t.Errorf("%v.%s: in-param count = %d, want %d", iface, w.name, got, len(w.in))
		} else {
			for i, in := range w.in {
				if !typeMatches(ft.In(i), in) {
					t.Errorf("%v.%s: in-param %d = %v, want %v", iface, w.name, i, ft.In(i), in)
				}
			}
		}
		if got := ft.NumOut(); got != len(w.out) {
			t.Errorf("%v.%s: out-param count = %d, want %d", iface, w.name, got, len(w.out))
		} else {
			for i, out := range w.out {
				if !typeMatches(ft.Out(i), out) {
					t.Errorf("%v.%s: out-param %d = %v, want %v", iface, w.name, i, ft.Out(i), out)
				}
			}
		}
	}
}

// jsonTopLevelKeys marshals v and returns its sorted set of top-level JSON
// object keys — the wire contract exposed by the DTO's struct tags.
func jsonTopLevelKeys(t *testing.T, v any) []string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal(%T): %v", v, err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("json.Unmarshal(%T) into map: %v", v, err)
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// assertJSONKeys asserts the exact top-level JSON key set of v. This pins the
// serialized field names (the outbound contract) so an accidental struct-tag
// rename or a stray omitempty is caught immediately.
func assertJSONKeys(t *testing.T, v any, want []string) {
	t.Helper()
	got := jsonTopLevelKeys(t, v)
	w := append([]string(nil), want...)
	sort.Strings(w)
	if !reflect.DeepEqual(got, w) {
		t.Errorf("%T JSON keys = %v, want %v", v, got, w)
	}
}

// cancelledContext returns a context that is already cancelled, for exercising
// the cancellation-propagation paths of the port fakes.
func cancelledContext() context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return ctx
}
