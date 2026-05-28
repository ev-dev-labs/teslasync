package automation

import (
	"context"
	"fmt"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// RedisStateProvider implements StateProvider by reading signals from the
// Redis signal cache and mapping them to a VehicleState. This replaces any
// need to query the database for real-time vehicle state.
type RedisStateProvider struct {
	cache *signal.RedisSignalCache
}

// NewRedisStateProvider creates a provider backed by the Redis signal cache.
func NewRedisStateProvider(cache *signal.RedisSignalCache) *RedisStateProvider {
	return &RedisStateProvider{cache: cache}
}

// GetVehicleState reads all cached signals for a vehicle from Redis and maps
// them to a VehicleState suitable for state_check condition evaluation.
// Returns (nil, nil) if no signals are cached for the vehicle.
func (p *RedisStateProvider) GetVehicleState(ctx context.Context, vehicleID int64) (*vehiclemodel.VehicleState, error) {
	signals, err := p.cache.GetAll(ctx, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("redis state provider: get signals for vehicle %d: %w", vehicleID, err)
	}
	if len(signals) == 0 {
		return nil, nil
	}

	state := &vehiclemodel.VehicleState{VehicleID: vehicleID}

	if v, ok := signals["VehicleSpeed"]; ok {
		if f, ok := v.(float64); ok {
			state.Speed = f
		}
	}
	if v, ok := signals["BatteryLevel"]; ok {
		switch bv := v.(type) {
		case float64:
			state.BatteryLevel = int(bv)
		case int:
			state.BatteryLevel = bv
		}
	}
	if v, ok := signals["Soc"]; ok && state.BatteryLevel == 0 {
		if f, ok := v.(float64); ok {
			state.BatteryLevel = int(f)
		}
	}
	if v, ok := signals["InsideTemp"]; ok {
		if f, ok := v.(float64); ok {
			state.InsideTemp = f
		}
	}
	if v, ok := signals["OutsideTemp"]; ok {
		if f, ok := v.(float64); ok {
			state.OutsideTemp = f
		}
	}
	if v, ok := signals["Locked"]; ok {
		switch lv := v.(type) {
		case bool:
			state.IsLocked = lv
		case string:
			state.IsLocked = lv == "true" || lv == "1"
		}
	}
	if v, ok := signals["SentryMode"]; ok {
		state.SentryMode = enums.ParseEnumBool(v)
	}
	if v, ok := signals["DetailedChargeState"]; ok {
		if cs, ok := v.(string); ok {
			state.IsCharging = enums.IsCharging(cs)
		}
	}
	if v, ok := signals["ChargeAmps"]; ok && !state.IsCharging {
		if f, ok := v.(float64); ok {
			state.IsCharging = f > 1.0
		}
	}
	if v, ok := signals["HvacPower"]; ok {
		switch hv := v.(type) {
		case bool:
			state.IsClimateOn = hv
		case string:
			state.IsClimateOn = enums.ParseHvacPower(hv)
		case float64:
			state.IsClimateOn = hv > 0
		}
	}

	return state, nil
}
