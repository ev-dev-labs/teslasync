package external_test

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/port/external"
)

// fakeGasPriceProvider is an in-memory GasPriceProvider test double. It records
// the requested region, honours context cancellation, and returns the injected
// price or error — the minimum needed to verify the port contract without a
// real EIA HTTP call.
type fakeGasPriceProvider struct {
	price      *external.EnergyPrice
	err        error
	lastRegion string
	calls      int
}

func (f *fakeGasPriceProvider) GetCurrentPrice(ctx context.Context, region string) (*external.EnergyPrice, error) {
	f.calls++
	f.lastRegion = region
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.err != nil {
		return nil, f.err
	}
	return f.price, nil
}

// Compile-time assertion: the fake satisfies the port.
var _ external.GasPriceProvider = (*fakeGasPriceProvider)(nil)

func TestGasPriceProviderContract(t *testing.T) {
	t.Parallel()
	assertInterface(t, reflect.TypeOf((*external.GasPriceProvider)(nil)).Elem(), []methodSig{
		{
			name: "GetCurrentPrice",
			in:   []reflect.Type{ctxType, stringType},
			out:  []reflect.Type{reflect.TypeOf((*external.EnergyPrice)(nil)), errType},
		},
	})
}

func TestEnergyPriceJSONContract(t *testing.T) {
	t.Parallel()
	wantKeys := []string{"currency", "pricePerGallon", "pricePerKwh", "region"}

	cases := []struct {
		name string
		in   external.EnergyPrice
	}{
		{"populated", external.EnergyPrice{PricePerKWh: 0.14, PricePerGallon: 3.59, Currency: "USD", Region: "US"}},
		{"zero", external.EnergyPrice{}},
		{"negative", external.EnergyPrice{PricePerKWh: -1, PricePerGallon: -2.5, Currency: "EUR", Region: "EU"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assertJSONKeys(t, tc.in, wantKeys)

			b, err := json.Marshal(tc.in)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var got external.EnergyPrice
			if err := json.Unmarshal(b, &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if !reflect.DeepEqual(got, tc.in) {
				t.Errorf("round-trip mismatch:\n got %+v\nwant %+v", got, tc.in)
			}
		})
	}
}

func TestFakeGasPriceProviderBehavior(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("eia unavailable")
	price := &external.EnergyPrice{PricePerKWh: 0.2, PricePerGallon: 3.4, Currency: "USD", Region: "CA"}

	cases := []struct {
		name      string
		provider  *fakeGasPriceProvider
		ctx       context.Context
		region    string
		wantPrice *external.EnergyPrice
		wantErr   error
	}{
		{"success", &fakeGasPriceProvider{price: price}, context.Background(), "CA", price, nil},
		{"error", &fakeGasPriceProvider{err: sentinel}, context.Background(), "US", nil, sentinel},
		{"empty region", &fakeGasPriceProvider{price: price}, context.Background(), "", price, nil},
		{"cancelled ctx", &fakeGasPriceProvider{price: price}, cancelledContext(), "US", nil, context.Canceled},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tc.provider.GetCurrentPrice(tc.ctx, tc.region)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if got != tc.wantPrice {
				t.Errorf("price = %v, want %v", got, tc.wantPrice)
			}
			if tc.provider.lastRegion != tc.region {
				t.Errorf("recorded region = %q, want %q", tc.provider.lastRegion, tc.region)
			}
			if tc.provider.calls != 1 {
				t.Errorf("calls = %d, want 1", tc.provider.calls)
			}
		})
	}
}
