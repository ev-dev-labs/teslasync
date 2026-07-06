package external_test

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/port/external"
)

// fakeTeslaClient is an in-memory TeslaClient test double. It records the last
// VIN / command / params it observed and returns injected values, so the port
// contract can be exercised without touching the Tesla Fleet API.
type fakeTeslaClient struct {
	state       *external.VehicleState
	data        map[string]any
	tokens      *external.TokenPair
	err         error
	lastVIN     string
	lastCommand string
	lastParams  map[string]any
	woke        bool
	revoked     bool
}

func (f *fakeTeslaClient) GetVehicleState(ctx context.Context, vin string) (*external.VehicleState, error) {
	f.lastVIN = vin
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.err != nil {
		return nil, f.err
	}
	return f.state, nil
}

func (f *fakeTeslaClient) GetVehicleData(ctx context.Context, vin string) (map[string]any, error) {
	f.lastVIN = vin
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.err != nil {
		return nil, f.err
	}
	return f.data, nil
}

func (f *fakeTeslaClient) WakeUp(ctx context.Context, vin string) error {
	f.lastVIN = vin
	if err := ctx.Err(); err != nil {
		return err
	}
	if f.err != nil {
		return f.err
	}
	f.woke = true
	return nil
}

func (f *fakeTeslaClient) SendCommand(ctx context.Context, vin, command string, params map[string]any) error {
	f.lastVIN, f.lastCommand, f.lastParams = vin, command, params
	if err := ctx.Err(); err != nil {
		return err
	}
	if f.err != nil {
		return f.err
	}
	return nil
}

func (f *fakeTeslaClient) RefreshToken(ctx context.Context, refreshToken string) (*external.TokenPair, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.err != nil {
		return nil, f.err
	}
	return f.tokens, nil
}

func (f *fakeTeslaClient) RevokeToken(ctx context.Context, accessToken string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if f.err != nil {
		return f.err
	}
	f.revoked = true
	return nil
}

// Compile-time assertion: the fake satisfies the port.
var _ external.TeslaClient = (*fakeTeslaClient)(nil)

func TestTeslaClientContract(t *testing.T) {
	t.Parallel()
	assertInterface(t, reflect.TypeOf((*external.TeslaClient)(nil)).Elem(), []methodSig{
		{
			name: "GetVehicleState",
			in:   []reflect.Type{ctxType, stringType},
			out:  []reflect.Type{reflect.TypeOf((*external.VehicleState)(nil)), errType},
		},
		{
			name: "GetVehicleData",
			in:   []reflect.Type{ctxType, stringType},
			out:  []reflect.Type{anyMapType, errType},
		},
		{
			name: "WakeUp",
			in:   []reflect.Type{ctxType, stringType},
			out:  []reflect.Type{errType},
		},
		{
			name: "SendCommand",
			in:   []reflect.Type{ctxType, stringType, stringType, anyMapType},
			out:  []reflect.Type{errType},
		},
		{
			name: "RefreshToken",
			in:   []reflect.Type{ctxType, stringType},
			out:  []reflect.Type{reflect.TypeOf((*external.TokenPair)(nil)), errType},
		},
		{
			name: "RevokeToken",
			in:   []reflect.Type{ctxType, stringType},
			out:  []reflect.Type{errType},
		},
	})
}

func TestVehicleStateJSONContract(t *testing.T) {
	t.Parallel()
	wantKeys := []string{
		"batteryLevel", "batteryRange", "chargePowerKw", "chargeRate", "chargerConnected",
		"insideTemp", "isCharging", "isClimateOn", "latitude", "longitude", "odometerMiles",
		"outsideTemp", "softwareVersion", "speed", "state", "timestamp", "vin",
	}
	// Zero value still emits every key (no accidental omitempty).
	assertJSONKeys(t, external.VehicleState{}, wantKeys)

	want := external.VehicleState{
		VIN: "5YJ3E1EA7KF000001", State: "online", BatteryLevel: 82, BatteryRange: 240.5,
		IsCharging: true, ChargeRate: 24, ChargePowerKW: 11, OdometerMiles: 12345.6,
		Latitude: 37.42, Longitude: -122.08, Speed: 0, IsClimateOn: true, InsideTemp: 21.5,
		OutsideTemp: 18, ChargerConnected: true, SoftwareVersion: "2026.20.1",
		Timestamp: time.Date(2026, 7, 5, 12, 0, 0, 0, time.UTC),
	}
	assertJSONKeys(t, want, wantKeys)

	b, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got external.VehicleState
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !got.Timestamp.Equal(want.Timestamp) {
		t.Errorf("timestamp: got %v, want %v", got.Timestamp, want.Timestamp)
	}
	got.Timestamp = want.Timestamp // normalise monotonic/location for DeepEqual of the rest
	if !reflect.DeepEqual(got, want) {
		t.Errorf("round-trip mismatch:\n got %+v\nwant %+v", got, want)
	}
	b2, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("re-marshal: %v", err)
	}
	if string(b2) != string(b) {
		t.Errorf("marshal not idempotent:\n b1=%s\n b2=%s", b, b2)
	}
}

func TestTokenPairJSONContract(t *testing.T) {
	t.Parallel()
	wantKeys := []string{"accessToken", "expiresAt", "refreshToken"}
	assertJSONKeys(t, external.TokenPair{}, wantKeys)

	want := external.TokenPair{
		AccessToken:  "at-abc",
		RefreshToken: "rt-xyz",
		ExpiresAt:    time.Date(2026, 7, 5, 13, 30, 0, 0, time.UTC),
	}
	assertJSONKeys(t, want, wantKeys)

	b, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got external.TokenPair
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !got.ExpiresAt.Equal(want.ExpiresAt) {
		t.Errorf("expiresAt: got %v, want %v", got.ExpiresAt, want.ExpiresAt)
	}
	if got.AccessToken != want.AccessToken || got.RefreshToken != want.RefreshToken {
		t.Errorf("token round-trip mismatch: got %+v, want %+v", got, want)
	}
}

func TestFakeTeslaClientSuccess(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	state := &external.VehicleState{VIN: "VINSTATE", State: "asleep", BatteryLevel: 50}
	tokens := &external.TokenPair{AccessToken: "a", RefreshToken: "r", ExpiresAt: time.Unix(1_800_000_000, 0)}
	c := &fakeTeslaClient{
		state:  state,
		data:   map[string]any{"battery_level": 50.0},
		tokens: tokens,
	}

	gotState, err := c.GetVehicleState(ctx, "VIN1")
	if err != nil || gotState != state {
		t.Fatalf("GetVehicleState = (%v, %v), want (%v, nil)", gotState, err, state)
	}
	if c.lastVIN != "VIN1" {
		t.Errorf("lastVIN = %q, want VIN1", c.lastVIN)
	}

	data, err := c.GetVehicleData(ctx, "VIN2")
	if err != nil {
		t.Fatalf("GetVehicleData err: %v", err)
	}
	if v, ok := data["battery_level"]; !ok || v != 50.0 {
		t.Errorf("data[battery_level] = %v (ok=%v), want 50", v, ok)
	}

	if err := c.WakeUp(ctx, "VIN3"); err != nil || !c.woke {
		t.Errorf("WakeUp err=%v woke=%v, want nil/true", err, c.woke)
	}

	params := map[string]any{"temp": 21}
	if err := c.SendCommand(ctx, "VIN4", "set_temps", params); err != nil {
		t.Fatalf("SendCommand err: %v", err)
	}
	if c.lastCommand != "set_temps" || !reflect.DeepEqual(c.lastParams, params) {
		t.Errorf("recorded command=%q params=%v, want set_temps/%v", c.lastCommand, c.lastParams, params)
	}

	gotTokens, err := c.RefreshToken(ctx, "refresh")
	if err != nil || gotTokens != tokens {
		t.Fatalf("RefreshToken = (%v, %v), want (%v, nil)", gotTokens, err, tokens)
	}

	if err := c.RevokeToken(ctx, "access"); err != nil || !c.revoked {
		t.Errorf("RevokeToken err=%v revoked=%v, want nil/true", err, c.revoked)
	}
}

func TestFakeTeslaClientErrorPropagation(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("fleet api 503")

	ops := []struct {
		name string
		call func(context.Context, *fakeTeslaClient) error
	}{
		{"GetVehicleState", func(ctx context.Context, c *fakeTeslaClient) error {
			_, err := c.GetVehicleState(ctx, "v")
			return err
		}},
		{"GetVehicleData", func(ctx context.Context, c *fakeTeslaClient) error {
			_, err := c.GetVehicleData(ctx, "v")
			return err
		}},
		{"WakeUp", func(ctx context.Context, c *fakeTeslaClient) error {
			return c.WakeUp(ctx, "v")
		}},
		{"SendCommand", func(ctx context.Context, c *fakeTeslaClient) error {
			return c.SendCommand(ctx, "v", "flash_lights", nil)
		}},
		{"RefreshToken", func(ctx context.Context, c *fakeTeslaClient) error {
			_, err := c.RefreshToken(ctx, "r")
			return err
		}},
		{"RevokeToken", func(ctx context.Context, c *fakeTeslaClient) error {
			return c.RevokeToken(ctx, "a")
		}},
	}

	for _, op := range ops {
		t.Run(op.name+"/injected error", func(t *testing.T) {
			c := &fakeTeslaClient{err: sentinel}
			if err := op.call(context.Background(), c); !errors.Is(err, sentinel) {
				t.Errorf("%s err = %v, want %v", op.name, err, sentinel)
			}
		})
		t.Run(op.name+"/cancelled context", func(t *testing.T) {
			c := &fakeTeslaClient{}
			if err := op.call(cancelledContext(), c); !errors.Is(err, context.Canceled) {
				t.Errorf("%s err = %v, want context.Canceled", op.name, err)
			}
		})
	}
}
