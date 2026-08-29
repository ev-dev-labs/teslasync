package worker

import (
	"context"
	"errors"
	"fmt"
	"runtime/debug"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	settingsmodel "github.com/ev-dev-labs/teslasync/internal/models/settings"

	authmodel "github.com/ev-dev-labs/teslasync/internal/models/auth"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/rs/zerolog/log"
)

// Start begins the polling loop, loading stored tokens and periodically
// refreshing them. Designed to be called inside SafeGoLoop so panics are
// recovered and the loop restarts automatically. Blocks until ctx is cancelled.
func (w *Worker) Start(ctx context.Context) {
	// Load tokens from DB
	if err := w.loadTokens(ctx); err != nil {
		log.Warn().Err(err).Msg("no stored tokens, waiting for authentication")
	}

	// When fleet telemetry is the primary data source, use the fallback poll
	// interval (default 60s) instead of the normal poll interval (default 15s).
	// This reduces Tesla API calls since telemetry handles active vehicles.
	pollInterval := w.cfg.PollInterval
	if w.FleetTelemetryEnabled && w.fallbackPollInterval > 0 {
		pollInterval = w.fallbackPollInterval
		log.Info().
			Dur("fallback_interval", pollInterval).
			Dur("normal_interval", w.cfg.PollInterval).
			Msg("fleet telemetry primary — worker using fallback poll interval")
	}

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	// Token refresh ticker (every 30 minutes)
	refreshTicker := time.NewTicker(config.AuthRefreshInterval)
	defer refreshTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("worker stopping")
			return

		case <-ticker.C:
			if !w.teslaClient.HasValidToken() {
				if err := w.loadTokens(ctx); err != nil {
					continue
				}
			}
			w.safePollAllVehicles(ctx)

		case <-refreshTicker.C:
			w.safeRefreshToken(ctx)
		}
	}
}

// safeRefreshToken wraps token refresh with panic recovery.
func (w *Worker) safeRefreshToken(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Str("panic", fmt.Sprintf("%v", r)).Str("stack", string(debug.Stack())).Msg("panic in token refresh")
		}
	}()
	w.refreshTokenIfNeeded(ctx)
}

// safePollAllVehicles wraps polling with panic recovery per-vehicle.
func (w *Worker) safePollAllVehicles(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Str("panic", fmt.Sprintf("%v", r)).Str("stack", string(debug.Stack())).Msg("panic in poll loop")
		}
	}()
	w.pollAllVehicles(ctx)
}

func (w *Worker) loadTokens(ctx context.Context) error {
	token, err := w.tokenRepo.Get(ctx)
	if err != nil || token == nil {
		return errors.New("no tokens stored")
	}
	w.teslaClient.SetTokens(token.AccessToken, token.RefreshToken, token.ExpiresAt)
	log.Info().Msg("loaded stored tokens")
	return nil
}

func (w *Worker) refreshTokenIfNeeded(ctx context.Context) {
	// Refresh if token is expired OR will expire within 5 minutes
	if !w.teslaClient.HasValidToken() || w.teslaClient.ExpiresWithin(5*time.Minute) {
		log.Info().Msg("token expired or expiring soon, refreshing")
		w.doRefreshToken(ctx)
	}
}

// doRefreshToken performs the actual token refresh and persists the new token.
func (w *Worker) doRefreshToken(ctx context.Context) bool {
	tokenResp, err := w.teslaClient.RefreshTokens(ctx)
	if err != nil {
		log.Error().Err(err).Msg("failed to refresh token")
		return false
	}

	expiresAt := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	token := &authmodel.Token{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		ExpiresAt:    expiresAt,
	}
	if err := w.tokenRepo.Upsert(ctx, token); err != nil {
		log.Error().Err(err).Msg("failed to persist refreshed token")
		return false
	}

	w.teslaClient.SetTokens(tokenResp.AccessToken, tokenResp.RefreshToken, expiresAt)
	log.Info().Time("expires_at", expiresAt).Msg("token refreshed successfully")
	return true
}

func (w *Worker) pollAllVehicles(ctx context.Context) {
	// Check if Tesla API calls are suspended (e.g., vehicle in service)
	if suspended, err := w.settingsRepo.IsAPISuspended(ctx); err != nil {
		log.Warn().Err(err).Msg("failed to check api_suspended setting, continuing")
	} else if suspended {
		log.Debug().Msg("Tesla API calls suspended — skipping poll cycle")
		return
	}

	// Load polling config for this cycle (per-vehicle configs are in the
	// polling_config table; the worker still uses the legacy feature-flag
	// struct for endpoint selection until the full migration is complete).
	defaultPC := settingsmodel.DefaultPollingConfig()
	pc := &defaultPC
	w.pollingConfig = pc

	// When fleet telemetry is primary, periodically discover new vehicles
	// via a lightweight ListVehicles call (no per-vehicle data fetching).
	// Skipped if vehicle_discovery is disabled in polling config.
	if pc.VehicleDiscovery && w.FleetTelemetryEnabled && time.Since(w.lastDiscovery) >= w.discoveryInterval {
		w.discoverVehicles(ctx)
		w.lastDiscovery = time.Now()
	}

	// Skip vehicle data polling if all sub-endpoints are disabled
	if !pc.HasAnyVehicleDataEndpoint() {
		log.Debug().Msg("all vehicle_data sub-endpoints disabled — skipping poll cycle")
		return
	}

	vehicles, err := w.vehicleRepo.GetAll(ctx)
	if err != nil {
		log.Error().Err(err).Msg("failed to list vehicles for polling")
		return
	}
	if w.PollEngine != nil {
		vins := make([]string, 0, len(vehicles))
		for _, vehicle := range vehicles {
			vins = append(vins, vehicle.VIN)
		}
		w.PollEngine.ReconcileFleet(vins)
	}

	for _, vehicle := range vehicles {
		// Fleet Telemetry Primary Mode: if vehicle is actively streaming,
		// skip polling entirely — telemetry is the data source.
		if w.FleetTelemetryEnabled && w.IsVehicleStreaming != nil && w.IsVehicleStreaming(vehicle.VIN) {
			log.Debug().Int64("vehicle_id", vehicle.ID).Str("vin", vehicle.VIN).Msg("skipping poll — vehicle streaming via Fleet Telemetry (primary)")
			if w.PollEngine != nil {
				w.PollEngine.MarkStreamingSkip(vehicle.VIN)
			}
			continue
		}

		// Legacy hybrid mode (Fleet Telemetry not primary, but streaming check exists):
		// reduce polling to a 5-minute heartbeat for streaming vehicles.
		if !w.FleetTelemetryEnabled && w.IsVehicleStreaming != nil && w.IsVehicleStreaming(vehicle.VIN) {
			w.mu.Lock()
			vh, exists := w.vehicleHealth[vehicle.ID]
			if exists && time.Since(vh.lastError) < 5*time.Minute {
				w.mu.Unlock()
				log.Debug().Int64("vehicle_id", vehicle.ID).Msg("skipping vehicle (streaming via Fleet Telemetry, heartbeat mode)")
				continue
			}
			if !exists {
				vh = &vehicleHealth{}
				w.vehicleHealth[vehicle.ID] = vh
			}
			vh.lastError = time.Now()
			w.mu.Unlock()
		}

		// Check per-vehicle backoff — use PollEngine if available, else legacy
		if w.PollEngine != nil {
			shouldPoll, decision := w.PollEngine.ShouldPoll(vehicle.VIN)
			if !shouldPoll {
				log.Debug().Int64("vehicle_id", vehicle.ID).Str("vin", vehicle.VIN).
					Str("profile", string(decision.Profile)).
					Strs("reasons", decision.Reasons).
					Dur("next_in", decision.NextInterval).
					Msg("poll engine: skipping poll")
				continue
			}
		} else {
			// Legacy backoff
			w.mu.Lock()
			vh, exists := w.vehicleHealth[vehicle.ID]
			if exists && time.Now().Before(vh.backoffUntil) {
				w.mu.Unlock()
				log.Debug().Int64("vehicle_id", vehicle.ID).Time("backoff_until", vh.backoffUntil).Msg("skipping vehicle (backoff)")
				continue
			}
			w.mu.Unlock()
		}

		if w.FleetTelemetryEnabled {
			log.Info().Int64("vehicle_id", vehicle.ID).Str("vin", vehicle.VIN).Msg("polling via Tesla API (fallback — vehicle not streaming)")
		}
		w.pollVehicleSafe(ctx, vehicle)
	}
}

// discoverVehicles calls Tesla's ListVehicles endpoint to discover new vehicles
// and add them to the database. This is a lightweight call (no per-vehicle data)
// used in fleet-telemetry-primary mode to keep the vehicle list current.
func (w *Worker) discoverVehicles(ctx context.Context) {
	if !w.teslaClient.HasValidToken() {
		return
	}

	listCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	teslaVehicles, err := w.teslaClient.ListVehicles(listCtx)
	if err != nil {
		log.Warn().Err(err).Msg("fleet telemetry: vehicle discovery failed")
		return
	}

	for _, tv := range teslaVehicles {
		existing, _ := w.vehicleRepo.GetByVIN(ctx, tv.VIN)
		if existing != nil {
			continue
		}

		// New vehicle discovered — create it
		v := &vehiclemodel.Vehicle{
			TeslaID:     tv.VehicleID,
			VIN:         tv.VIN,
			DisplayName: tv.DisplayName,
		}
		if err := w.vehicleRepo.Create(ctx, v); err != nil {
			log.Error().Err(err).Str("vin", tv.VIN).Msg("fleet telemetry: failed to create discovered vehicle")
		} else {
			log.Info().Str("vin", tv.VIN).Str("name", tv.DisplayName).Msg("fleet telemetry: new vehicle discovered and added")
		}
	}
}

// pollVehicleSafe wraps pollVehicle with per-vehicle panic recovery.
func (w *Worker) pollVehicleSafe(ctx context.Context, vehicle *vehiclemodel.Vehicle) {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Int64("vehicle_id", vehicle.ID).Str("vin", vehicle.VIN).Str("panic", fmt.Sprintf("%v", r)).Msg("panic polling vehicle — applying backoff")
			w.recordVehicleFailure(vehicle.ID)
		}
	}()
	w.pollVehicle(ctx, vehicle)
}

// HealthSnapshot reports how many vehicles the worker has ever recorded a
// polling outcome for ("tracked") and how many of those currently have at
// least degradedThreshold consecutive failures ("degraded"). It is the
// probe the API server's health watchdog (internal/app) uses for the
// "worker" component — see runHealthWatchdogTick.
//
// Semantics are deliberately conservative:
//   - A vehicle fully covered by Fleet Telemetry streaming (so the
//     worker never polls it — see IsVehicleStreaming/FleetTelemetryEnabled)
//     never appears in vehicleHealth, so tracked stays 0 for an
//     all-streaming fleet. tracked==0 means "no signal", not "healthy" —
//     callers must NOT call RecordSuccess in that case.
//   - degraded only counts vehicles at or above degradedThreshold
//     consecutive failures, matching resilience.HealthMonitor's own
//     degraded bar so the two layers agree on what "degraded" means.
//   - Failure is reported only when EVERY tracked vehicle is degraded —
//     a single flaky vehicle must not flip the whole worker component
//     unhealthy; a fleet-wide failure (e.g. Tesla API outage, invalid
//     token) degrades every polled vehicle at once and IS worth
//     surfacing.
func (w *Worker) HealthSnapshot(degradedThreshold int) (tracked, degraded int) {
	if w == nil {
		return 0, 0
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, vh := range w.vehicleHealth {
		tracked++
		if vh.consecFails >= degradedThreshold {
			degraded++
		}
	}
	return tracked, degraded
}

// recordVehicleFailure applies exponential backoff for a repeatedly failing vehicle.
func (w *Worker) recordVehicleFailure(vehicleID int64) {
	w.mu.Lock()
	defer w.mu.Unlock()
	vh, ok := w.vehicleHealth[vehicleID]
	if !ok {
		vh = &vehicleHealth{}
		w.vehicleHealth[vehicleID] = vh
	}
	vh.consecFails++
	vh.lastError = time.Now()
	// Backoff: 30s, 60s, 120s, 240s, max 5 min
	backoff := time.Duration(30<<uint(vh.consecFails-1)) * time.Second
	if backoff > 5*time.Minute {
		backoff = 5 * time.Minute
	}
	vh.backoffUntil = time.Now().Add(backoff)
	log.Warn().Int64("vehicle_id", vehicleID).Int("consec_fails", vh.consecFails).Dur("backoff", backoff).Msg("vehicle polling backoff applied")
}

// recordVehicleSuccess resets the backoff for a vehicle.
func (w *Worker) recordVehicleSuccess(vehicleID int64) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if vh, ok := w.vehicleHealth[vehicleID]; ok {
		vh.consecFails = 0
		vh.backoffUntil = time.Time{}
		vh.consecAsleep = 0
		vh.lastError = time.Time{}
	}
}

// recordVehicleAsleep applies escalating backoff for a sleeping vehicle.
// Uses SleepPollMult as the base multiplier, then doubles on each
// consecutive asleep response, capping at 10 minutes.
func (w *Worker) recordVehicleAsleep(vehicleID int64) {
	w.mu.Lock()
	defer w.mu.Unlock()
	vh, ok := w.vehicleHealth[vehicleID]
	if !ok {
		vh = &vehicleHealth{}
		w.vehicleHealth[vehicleID] = vh
	}
	vh.consecFails = 0 // asleep is not an error
	vh.consecAsleep++

	// Base backoff = PollInterval * SleepPollMult (default 15s * 4 = 60s)
	// Then double for each consecutive asleep: 60s, 120s, 240s, 480s, max 10m
	mult := w.cfg.SleepPollMult
	if mult < 1 {
		mult = 4
	}
	base := w.cfg.PollInterval * time.Duration(mult)
	backoff := base * time.Duration(1<<uint(vh.consecAsleep-1))
	if backoff > 10*time.Minute {
		backoff = 10 * time.Minute
	}
	vh.backoffUntil = time.Now().Add(backoff)
	log.Info().Int64("vehicle_id", vehicleID).Int("consec_asleep", vh.consecAsleep).Dur("backoff", backoff).Msg("vehicle asleep — backing off")
}
