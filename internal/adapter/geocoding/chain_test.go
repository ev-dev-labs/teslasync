package geocoding

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/port/external"
)

// compile-time assertion: ChainProvider must satisfy the outbound port.
var _ external.GeocodingProvider = (*ChainProvider)(nil)

// fakeProvider is a test double for external.GeocodingProvider. It records how
// many times it was called and the arguments it received so tests can assert on
// call ordering, short-circuiting, and argument propagation.
type fakeProvider struct {
	name   string
	addr   *external.Address
	err    error
	calls  int
	gotCtx context.Context
	gotLat float64
	gotLon float64
}

func (f *fakeProvider) ReverseGeocode(ctx context.Context, lat, lon float64) (*external.Address, error) {
	f.calls++
	f.gotCtx = ctx
	f.gotLat = lat
	f.gotLon = lon
	return f.addr, f.err
}

func (f *fakeProvider) Name() string { return f.name }

func TestChainProvider_Name(t *testing.T) {
	if got := NewChainProvider().Name(); got != "chain" {
		t.Errorf("Name() = %q, want %q", got, "chain")
	}
}

func TestNewChainProvider_StoresProviders(t *testing.T) {
	p1 := &fakeProvider{name: "a"}
	p2 := &fakeProvider{name: "b"}
	c := NewChainProvider(p1, p2)
	if len(c.providers) != 2 {
		t.Fatalf("expected 2 providers, got %d", len(c.providers))
	}
	if c.providers[0] != p1 || c.providers[1] != p2 {
		t.Errorf("providers stored in wrong order: %+v", c.providers)
	}
}

func TestChainProvider_ReverseGeocode(t *testing.T) {
	addrA := &external.Address{FormattedAddress: "1 Alpha St", City: "Alpha"}
	addrB := &external.Address{FormattedAddress: "2 Beta Ave", City: "Beta"}

	tests := []struct {
		name      string
		providers []*fakeProvider
		wantAddr  *external.Address
		wantErr   bool
		wantCalls []int // expected call count, parallel to providers
	}{
		{
			name: "first provider succeeds and short-circuits",
			providers: []*fakeProvider{
				{name: "primary", addr: addrA},
				{name: "secondary", addr: addrB},
			},
			wantAddr:  addrA,
			wantCalls: []int{1, 0},
		},
		{
			name: "first fails then second succeeds",
			providers: []*fakeProvider{
				{name: "primary", err: errors.New("REQUEST_DENIED")},
				{name: "secondary", addr: addrB},
			},
			wantAddr:  addrB,
			wantCalls: []int{1, 1},
		},
		{
			name: "third succeeds after two failures",
			providers: []*fakeProvider{
				{name: "google", err: errors.New("denied")},
				{name: "azure", err: errors.New("expired")},
				{name: "nominatim", addr: addrA},
			},
			wantAddr:  addrA,
			wantCalls: []int{1, 1, 1},
		},
		{
			name: "all providers fail",
			providers: []*fakeProvider{
				{name: "primary", err: errors.New("boom1")},
				{name: "secondary", err: errors.New("boom2")},
			},
			wantErr:   true,
			wantCalls: []int{1, 1},
		},
		{
			name: "single provider success",
			providers: []*fakeProvider{
				{name: "only", addr: addrA},
			},
			wantAddr:  addrA,
			wantCalls: []int{1},
		},
		{
			name: "single provider failure",
			providers: []*fakeProvider{
				{name: "only", err: errors.New("nope")},
			},
			wantErr:   true,
			wantCalls: []int{1},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ps := make([]external.GeocodingProvider, len(tc.providers))
			for i, p := range tc.providers {
				ps[i] = p
			}
			chain := NewChainProvider(ps...)

			got, err := chain.ReverseGeocode(context.Background(), 47.6, -122.3)

			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (addr=%+v)", got)
				}
				if got != nil {
					t.Errorf("expected nil address on error, got %+v", got)
				}
			} else {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if got != tc.wantAddr {
					t.Errorf("address = %+v, want %+v", got, tc.wantAddr)
				}
			}

			for i, want := range tc.wantCalls {
				if tc.providers[i].calls != want {
					t.Errorf("provider %q calls = %d, want %d", tc.providers[i].name, tc.providers[i].calls, want)
				}
			}
		})
	}
}

func TestChainProvider_ReverseGeocode_EmptyProviders(t *testing.T) {
	chain := NewChainProvider()

	got, err := chain.ReverseGeocode(context.Background(), 1, 2)
	if err == nil {
		t.Fatal("expected error when no providers configured, got nil")
	}
	if got != nil {
		t.Errorf("expected nil address, got %+v", got)
	}
	// Regression guard: the old implementation wrapped a nil lastErr producing a
	// malformed "%!w(<nil>)" message. Ensure the message is well-formed.
	if strings.Contains(err.Error(), "%!w") || strings.Contains(err.Error(), "<nil>") {
		t.Errorf("malformed error message: %q", err.Error())
	}
}

func TestChainProvider_ReverseGeocode_SkipsNilProviders(t *testing.T) {
	good := &fakeProvider{name: "good", addr: &external.Address{City: "X"}}
	// A nil provider in the slice must be skipped, not panicked on.
	chain := NewChainProvider(nil, good)

	got, err := chain.ReverseGeocode(context.Background(), 1, 2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil || got.City != "X" {
		t.Fatalf("expected address from good provider, got %+v", got)
	}
	if good.calls != 1 {
		t.Errorf("good provider calls = %d, want 1", good.calls)
	}
}

func TestChainProvider_ReverseGeocode_AllNilProviders(t *testing.T) {
	chain := NewChainProvider(nil, nil)

	got, err := chain.ReverseGeocode(context.Background(), 1, 2)
	if err == nil {
		t.Fatal("expected error when every provider is nil, got nil")
	}
	if got != nil {
		t.Errorf("expected nil address, got %+v", got)
	}
	if strings.Contains(err.Error(), "%!w") || strings.Contains(err.Error(), "<nil>") {
		t.Errorf("malformed error message: %q", err.Error())
	}
}

func TestChainProvider_ReverseGeocode_WrapsUnderlyingErrors(t *testing.T) {
	errDenied := errors.New("REQUEST_DENIED")
	errTimeout := errors.New("timeout")
	chain := NewChainProvider(
		&fakeProvider{name: "google", err: errDenied},
		&fakeProvider{name: "azure", err: errTimeout},
	)

	_, err := chain.ReverseGeocode(context.Background(), 1, 2)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.Is(err, errDenied) {
		t.Errorf("error should wrap errDenied: %v", err)
	}
	if !errors.Is(err, errTimeout) {
		t.Errorf("error should wrap errTimeout: %v", err)
	}
	// Provider names must be present for debuggability.
	if !strings.Contains(err.Error(), "google") || !strings.Contains(err.Error(), "azure") {
		t.Errorf("error should name failing providers, got %q", err.Error())
	}
}

func TestChainProvider_ReverseGeocode_PropagatesArgs(t *testing.T) {
	type ctxKey string
	const traceKey ctxKey = "trace"
	ctx := context.WithValue(context.Background(), traceKey, "abc-123")

	p := &fakeProvider{name: "p", addr: &external.Address{}}
	chain := NewChainProvider(p)

	if _, err := chain.ReverseGeocode(ctx, 12.5, -34.75); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.gotCtx == nil || p.gotCtx.Value(traceKey) != "abc-123" {
		t.Errorf("context not propagated to provider")
	}
	if p.gotLat != 12.5 || p.gotLon != -34.75 {
		t.Errorf("coords not propagated: lat=%v lon=%v, want 12.5, -34.75", p.gotLat, p.gotLon)
	}
}

func TestChainProvider_ReverseGeocode_SkipsNilThenFails(t *testing.T) {
	failing := &fakeProvider{name: "failing", err: errors.New("boom")}
	// nil in the middle must not stop the chain from trying the real provider.
	chain := NewChainProvider(nil, failing, nil)

	_, err := chain.ReverseGeocode(context.Background(), 1, 2)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if failing.calls != 1 {
		t.Errorf("failing provider calls = %d, want 1", failing.calls)
	}
	if !strings.Contains(err.Error(), "failing") {
		t.Errorf("error should name the failing provider, got %q", err.Error())
	}
}
