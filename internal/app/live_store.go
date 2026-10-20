package app

import (
	"fmt"

	sigsvc "github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/rs/zerolog/log"
)

// initLiveSignalStore constructs the reader layers before optional telemetry
// ownership. It does no I/O, hydration, or subscriber/FSM startup.
func (a *App) initLiveSignalStore() error {
	local := sigsvc.New()
	var redisCache *sigsvc.RedisSignalCache
	if a.Cache != nil {
		if rdb := a.Cache.Underlying(); rdb != nil {
			redisCache = sigsvc.NewRedisSignalCache(rdb)
		}
	}
	live, err := sigsvc.NewLiveSignalStore(local, redisCache, a.Cfg.FleetTelemetry.LiveSignalStoreMode)
	if err != nil {
		return fmt.Errorf("invalid LIVE_SIGNAL_STORE_MODE %q: %w", a.Cfg.FleetTelemetry.LiveSignalStoreMode, err)
	}
	a.SignalStore = local
	a.LiveSignalStore = live
	a.redisSignalCache = redisCache
	log.Info().
		Str("mode", a.Cfg.FleetTelemetry.LiveSignalStoreMode).
		Bool("redis_l2", redisCache != nil).
		Msg("live signal store initialized")
	return nil
}

// wireTelemetryLiveStores attaches the already-constructed reader layers.
// Warmup remains in initTelemetryHandler, after these setters and before
// session recovery, reconciliation, and pipeline subscriber startup.
func (a *App) wireTelemetryLiveStores() {
	a.TelemetryHandler.SetSignalStore(a.SignalStore)
	a.TelemetryHandler.FSMHandler().SetSignalStore(a.SignalStore)
	if a.redisSignalCache != nil {
		a.TelemetryHandler.SetRedisCache(a.redisSignalCache)
		log.Info().Msg("redis signal cache enabled")
	}
	a.TelemetryHandler.SetLiveSignalStore(a.LiveSignalStore)
}
