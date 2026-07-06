package external_test

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/port/external"
)

// fakeGeocodingProvider is an in-memory GeocodingProvider test double. It
// records the last coordinates it was asked to resolve and returns the injected
// address or error, mirroring the fallback-chain contract without network I/O.
type fakeGeocodingProvider struct {
	name    string
	addr    *external.Address
	err     error
	lastLat float64
	lastLon float64
}

func (f *fakeGeocodingProvider) ReverseGeocode(ctx context.Context, lat, lon float64) (*external.Address, error) {
	f.lastLat, f.lastLon = lat, lon
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.err != nil {
		return nil, f.err
	}
	return f.addr, nil
}

func (f *fakeGeocodingProvider) Name() string { return f.name }

// Compile-time assertion: the fake satisfies the port.
var _ external.GeocodingProvider = (*fakeGeocodingProvider)(nil)

func TestGeocodingProviderContract(t *testing.T) {
	t.Parallel()
	assertInterface(t, reflect.TypeOf((*external.GeocodingProvider)(nil)).Elem(), []methodSig{
		{
			name: "ReverseGeocode",
			in:   []reflect.Type{ctxType, float64Type, float64Type},
			out:  []reflect.Type{reflect.TypeOf((*external.Address)(nil)), errType},
		},
		{
			name: "Name",
			in:   []reflect.Type{},
			out:  []reflect.Type{stringType},
		},
	})
}

func TestAddressJSONContract(t *testing.T) {
	t.Parallel()
	wantKeys := []string{"city", "country", "formattedAddress", "latitude", "longitude", "postalCode", "state"}

	cases := []struct {
		name string
		in   external.Address
	}{
		{
			name: "populated",
			in: external.Address{
				FormattedAddress: "1 Infinite Loop, Cupertino, CA 95014",
				City:             "Cupertino", State: "CA", Country: "US", PostalCode: "95014",
				Latitude: 37.3318, Longitude: -122.0312,
			},
		},
		{"zero", external.Address{}},
		{
			name: "antimeridian boundary",
			in:   external.Address{FormattedAddress: "Null Island edge", Latitude: -90, Longitude: 180},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assertJSONKeys(t, tc.in, wantKeys)

			b, err := json.Marshal(tc.in)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var got external.Address
			if err := json.Unmarshal(b, &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if !reflect.DeepEqual(got, tc.in) {
				t.Errorf("round-trip mismatch:\n got %+v\nwant %+v", got, tc.in)
			}
		})
	}
}

func TestFakeGeocodingProviderBehavior(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("nominatim rate limited")
	addr := &external.Address{FormattedAddress: "1 Infinite Loop", City: "Cupertino", State: "CA", Country: "US", PostalCode: "95014", Latitude: 37.33, Longitude: -122.03}

	cases := []struct {
		name     string
		provider *fakeGeocodingProvider
		ctx      context.Context
		lat, lon float64
		wantAddr *external.Address
		wantErr  error
	}{
		{"success", &fakeGeocodingProvider{name: "nominatim", addr: addr}, context.Background(), 37.33, -122.03, addr, nil},
		{"error", &fakeGeocodingProvider{name: "nominatim", err: sentinel}, context.Background(), 0, 0, nil, sentinel},
		{"pole boundary", &fakeGeocodingProvider{name: "google", addr: addr}, context.Background(), -90, 180, addr, nil},
		{"cancelled ctx", &fakeGeocodingProvider{name: "azure", addr: addr}, cancelledContext(), 1, 2, nil, context.Canceled},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tc.provider.ReverseGeocode(tc.ctx, tc.lat, tc.lon)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if got != tc.wantAddr {
				t.Errorf("addr = %v, want %v", got, tc.wantAddr)
			}
			if tc.provider.lastLat != tc.lat || tc.provider.lastLon != tc.lon {
				t.Errorf("recorded coords = (%v, %v), want (%v, %v)", tc.provider.lastLat, tc.provider.lastLon, tc.lat, tc.lon)
			}
		})
	}

	t.Run("Name identifies provider", func(t *testing.T) {
		p := &fakeGeocodingProvider{name: "azure-maps"}
		if got := p.Name(); got != "azure-maps" {
			t.Errorf("Name() = %q, want %q", got, "azure-maps")
		}
	})
}
