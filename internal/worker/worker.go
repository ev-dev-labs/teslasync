package worker

import (
	"context"
	"errors"
	"fmt"
	"runtime/debug"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// vehicleHealth tracks per-vehicle polling state for backoff.
type vehicleHealth struct {
	consecFails  int
	consecAsleep int
	lastError    time.Time
	backoffUntil time.Time
}

// Worker polls Tesla API for vehicle data and stores it.
type Worker struct {
	db            *database.DB
	vehicleRepo   *database.VehicleRepo
	posRepo       *database.PositionRepo
	driveRepo     *database.DriveRepo
	chargeRepo    *database.ChargingRepo
	tokenRepo     *database.TokenRepo
	alertRuleRepo *database.AlertRuleRepo
	alertRepo     *database.AlertRepo
	settingsRepo  *database.SettingsRepo
	teslaClient   *tesla.Client
	mqttClient    *mqtt.Client
	eventBus      *events.Bus
	cfg           config.WorkerConfig

	// Fleet Telemetry integration — when enabled, telemetry is primary and
	// the worker only polls as a fallback for non-streaming vehicles.
	FleetTelemetryEnabled bool

	// Optional streaming checker — when set, vehicles that are actively
	// streaming via Fleet Telemetry are skipped entirely (telemetry-primary
	// mode) or get reduced polling (hybrid mode).
	IsVehicleStreaming func(vin string) bool

	// Track active sessions per vehicle (guarded by sessionMu)
	sessionMu     sync.Mutex
	activeDrives  map[int64]int64 // vehicleID -> driveID
	activeCharges map[int64]int64 // vehicleID -> chargingSessionID

	// Per-vehicle health tracking for adaptive backoff (guarded by mu)
	mu             sync.Mutex
	vehicleHealth  map[int64]*vehicleHealth

	// Vehicle discovery ticker interval when fleet telemetry is primary
	discoveryInterval    time.Duration
	lastDiscovery        time.Time
	fallbackPollInterval time.Duration // overrides cfg.PollInterval when fleet telemetry is primary
}

// New creates a new Worker that polls the Tesla API at the configured interval,
// persists data to the database, and publishes updates via MQTT.
func New(db *database.DB, tc *tesla.Client, mc *mqtt.Client, cfg config.WorkerConfig, eb *events.Bus, enc *crypto.Encryptor) *Worker {
	return &Worker{
		db:                db,
		vehicleRepo:       database.NewVehicleRepo(db),
		posRepo:           database.NewPositionRepo(db),
		driveRepo:         database.NewDriveRepo(db),
		chargeRepo:        database.NewChargingRepo(db),
		tokenRepo:         database.NewTokenRepo(db, enc),
		alertRuleRepo:     database.NewAlertRuleRepo(db),
		alertRepo:         database.NewAlertRepo(db),
		settingsRepo:      database.NewSettingsRepo(db),
		teslaClient:       tc,
		mqttClient:        mc,
		eventBus:          eb,
		cfg:               cfg,
		activeDrives:      make(map[int64]int64),
		activeCharges:     make(map[int64]int64),
		vehicleHealth:     make(map[int64]*vehicleHealth),
		discoveryInterval: 5 * time.Minute,
	}
}

// SetFallbackPollInterval sets the polling interval used when fleet telemetry
// is the primary data source. In this mode, the worker only polls non-streaming
// vehicles as a fallback, so a longer interval (e.g., 60s) reduces API costs.
func (w *Worker) SetFallbackPollInterval(d time.Duration) {
	if d > 0 {
		w.fallbackPollInterval = d
	}
}

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
	refreshTicker := time.NewTicker(30 * time.Minute)
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
	token := &models.Token{
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

	// When fleet telemetry is primary, periodically discover new vehicles
	// via a lightweight ListVehicles call (no per-vehicle data fetching).
	if w.FleetTelemetryEnabled && time.Since(w.lastDiscovery) >= w.discoveryInterval {
		w.discoverVehicles(ctx)
		w.lastDiscovery = time.Now()
	}

	vehicles, err := w.vehicleRepo.GetAll(ctx)
	if err != nil {
		log.Error().Err(err).Msg("failed to list vehicles for polling")
		return
	}

	for _, vehicle := range vehicles {
		// Fleet Telemetry Primary Mode: if vehicle is actively streaming,
		// skip polling entirely — telemetry is the data source.
		if w.FleetTelemetryEnabled && w.IsVehicleStreaming != nil && w.IsVehicleStreaming(vehicle.VIN) {
			log.Debug().Int64("vehicle_id", vehicle.ID).Str("vin", vehicle.VIN).Msg("skipping poll — vehicle streaming via Fleet Telemetry (primary)")
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

		// Check per-vehicle backoff
		w.mu.Lock()
		vh, exists := w.vehicleHealth[vehicle.ID]
		if exists && time.Now().Before(vh.backoffUntil) {
			w.mu.Unlock()
			log.Debug().Int64("vehicle_id", vehicle.ID).Time("backoff_until", vh.backoffUntil).Msg("skipping vehicle (backoff)")
			continue
		}
		w.mu.Unlock()

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
		v := &models.Vehicle{
			VehicleID:   tv.VehicleID,
			VIN:         tv.VIN,
			DisplayName: tv.DisplayName,
			State:       tv.State,
			Healthy:     true,
		}
		if err := w.vehicleRepo.Create(ctx, v); err != nil {
			log.Error().Err(err).Str("vin", tv.VIN).Msg("fleet telemetry: failed to create discovered vehicle")
		} else {
			log.Info().Str("vin", tv.VIN).Str("name", tv.DisplayName).Msg("fleet telemetry: new vehicle discovered and added")
		}
	}
}

// pollVehicleSafe wraps pollVehicle with per-vehicle panic recovery.
func (w *Worker) pollVehicleSafe(ctx context.Context, vehicle *models.Vehicle) {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Int64("vehicle_id", vehicle.ID).Str("vin", vehicle.VIN).Str("panic", fmt.Sprintf("%v", r)).Msg("panic polling vehicle — applying backoff")
			w.recordVehicleFailure(vehicle.ID)
		}
	}()
	w.pollVehicle(ctx, vehicle)
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
	delete(w.vehicleHealth, vehicleID)
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

func (w *Worker) pollVehicle(ctx context.Context, vehicle *models.Vehicle) {
	logger := log.With().Int64("vehicle_id", vehicle.ID).Str("vin", vehicle.VIN).Logger()

	// Apply timeout to prevent hanging on unresponsive Tesla API
	pollCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	data, err := w.teslaClient.GetVehicleData(pollCtx, vehicle.VIN)
	if errors.Is(err, tesla.ErrVehicleAsleep) {
		if err := w.vehicleRepo.UpdateState(ctx, vehicle.ID, "asleep", true); err != nil {
			logger.Error().Err(err).Msg("failed to update vehicle state")
		}
		w.publishMQTT(vehicle, "state", "asleep")
		w.recordVehicleAsleep(vehicle.ID)
		return
	}
	if errors.Is(err, tesla.ErrRateLimited) {
		logger.Warn().Msg("Tesla API rate limited (429) — backing off without counting as failure")
		// Apply temporary backoff but don't count as a failure
		w.mu.Lock()
		if vh, ok := w.vehicleHealth[vehicle.ID]; ok {
			vh.backoffUntil = time.Now().Add(60 * time.Second)
		}
		w.mu.Unlock()
		return
	}
	if errors.Is(err, tesla.ErrUnauthorized) {
		logger.Warn().Msg("received 401 — attempting token refresh")
		if w.doRefreshToken(ctx) {
			// Retry once after successful refresh
			retryCtx, retryCancel := context.WithTimeout(ctx, 30*time.Second)
			defer retryCancel()
			data, err = w.teslaClient.GetVehicleData(retryCtx, vehicle.VIN)
			if err != nil {
				logger.Warn().Err(err).Msg("retry after token refresh still failed")
				w.recordVehicleFailure(vehicle.ID)
				return
			}
		} else {
			w.recordVehicleFailure(vehicle.ID)
			return
		}
	} else if err != nil {
		logger.Warn().Err(err).Msg("failed to get vehicle data")
		if err := w.vehicleRepo.UpdateState(ctx, vehicle.ID, vehicle.State, false); err != nil {
			logger.Error().Err(err).Msg("failed to mark vehicle unhealthy")
		}
		w.recordVehicleFailure(vehicle.ID)
		return
	}

	// Successful poll — reset backoff
	w.recordVehicleSuccess(vehicle.ID)

	// Update vehicle state
	if err := w.vehicleRepo.UpdateState(ctx, vehicle.ID, data.State, true); err != nil {
		logger.Error().Err(err).Msg("failed to update vehicle state")
	}

	// Store position
	pos := w.buildPosition(vehicle.ID, data)
	if err := w.posRepo.Insert(ctx, pos); err != nil {
		logger.Error().Err(err).Msg("failed to insert position")
	}

	// Track driving sessions
	w.trackDriving(ctx, vehicle, data)

	// Track charging sessions
	w.trackCharging(ctx, vehicle, data)

	// Evaluate alert rules
	w.evaluateAlerts(ctx, vehicle, data)

	// Publish to MQTT
	w.publishVehicleData(vehicle, data)

	logger.Debug().Str("state", data.State).Int("battery", data.ChargeState.BatteryLevel).Msg("polled vehicle")
}

func (w *Worker) buildPosition(vehicleID int64, data *tesla.VehicleDataResponse) *models.Position {
	p := &models.Position{
		VehicleID:  vehicleID,
		Latitude:   data.DriveState.Latitude,
		Longitude:  data.DriveState.Longitude,
		Odometer:   data.VehicleState.Odometer,
		BatteryLvl: data.ChargeState.BatteryLevel,
	}

	if data.DriveState.Speed != nil {
		s := float64(*data.DriveState.Speed)
		p.Speed = &s
	}
	power := float64(data.DriveState.Power)
	p.Power = &power
	heading := data.DriveState.Heading
	p.Heading = &heading

	idealRange := data.ChargeState.IdealBatteryRange
	p.IdealRange = &idealRange
	ratedRange := data.ChargeState.BatteryRange
	p.RatedRange = &ratedRange
	insideTemp := data.ClimateState.InsideTemp
	p.InsideTemp = &insideTemp
	outsideTemp := data.ClimateState.OutsideTemp
	p.OutsideTemp = &outsideTemp
	fanStatus := data.ClimateState.FanStatus
	p.FanStatus = &fanStatus
	isClimate := data.ClimateState.IsClimateOn
	p.IsClimate = &isClimate

	return p
}

func (w *Worker) trackDriving(ctx context.Context, vehicle *models.Vehicle, data *tesla.VehicleDataResponse) {
	isDriving := data.DriveState.Speed != nil && *data.DriveState.Speed > 0

	w.sessionMu.Lock()
	activeDriveID, hasActiveDrive := w.activeDrives[vehicle.ID]
	w.sessionMu.Unlock()

	if isDriving && !hasActiveDrive {
		// Start new drive
		drive := &models.Drive{
			VehicleID:   vehicle.ID,
			StartDate:   time.Now().UTC(),
			StartBatteryLvl: &data.ChargeState.BatteryLevel,
		}
		range_ := data.ChargeState.BatteryRange
		drive.StartRangeKm = &range_

		if err := w.driveRepo.Create(ctx, drive); err != nil {
			log.Error().Err(err).Int64("vehicleID", vehicle.ID).Msg("failed to create drive")
			return
		}
		w.sessionMu.Lock()
		w.activeDrives[vehicle.ID] = drive.ID
		w.sessionMu.Unlock()
		log.Info().Int64("vehicleID", vehicle.ID).Int64("driveID", drive.ID).Msg("drive started")
		if w.eventBus != nil {
			w.eventBus.Publish(events.Event{Type: events.DriveStarted, VehicleID: vehicle.ID, VIN: vehicle.VIN, Data: map[string]interface{}{"drive_id": drive.ID, "battery_level": data.ChargeState.BatteryLevel}})
		}
	} else if !isDriving && hasActiveDrive {
		// End drive
		endRange := data.ChargeState.BatteryRange
		endBattery := data.ChargeState.BatteryLevel
		if err := w.driveRepo.Complete(ctx, activeDriveID, time.Now().UTC(),
			nil, nil, 0, 0, &endRange, &endBattery, nil, nil, nil, nil, nil); err != nil {
			log.Error().Err(err).Int64("driveID", activeDriveID).Msg("failed to complete drive")
		}
		w.sessionMu.Lock()
		delete(w.activeDrives, vehicle.ID)
		w.sessionMu.Unlock()
		log.Info().Int64("vehicleID", vehicle.ID).Int64("driveID", activeDriveID).Msg("drive ended")
		if w.eventBus != nil {
			w.eventBus.Publish(events.Event{Type: events.DriveEnded, VehicleID: vehicle.ID, VIN: vehicle.VIN, Data: map[string]interface{}{"drive_id": activeDriveID, "battery_level": data.ChargeState.BatteryLevel}})
		}
	}
}

func (w *Worker) trackCharging(ctx context.Context, vehicle *models.Vehicle, data *tesla.VehicleDataResponse) {
	isCharging := data.ChargeState.ChargingState == "Charging"

	w.sessionMu.Lock()
	activeChargeID, hasActiveCharge := w.activeCharges[vehicle.ID]
	w.sessionMu.Unlock()

	if isCharging && !hasActiveCharge {
		session := &models.ChargingSession{
			VehicleID:         vehicle.ID,
			StartDate:         time.Now().UTC(),
			StartBatteryLevel: data.ChargeState.BatteryLevel,
		}
		range_ := data.ChargeState.BatteryRange
		session.StartRangeKm = &range_

		if err := w.chargeRepo.Create(ctx, session); err != nil {
			log.Error().Err(err).Int64("vehicleID", vehicle.ID).Msg("failed to create charging session")
			return
		}
		w.sessionMu.Lock()
		w.activeCharges[vehicle.ID] = session.ID
		w.sessionMu.Unlock()
		log.Info().Int64("vehicleID", vehicle.ID).Int64("sessionID", session.ID).Msg("charging started")
		if w.eventBus != nil {
			w.eventBus.Publish(events.Event{Type: events.ChargeStarted, VehicleID: vehicle.ID, VIN: vehicle.VIN, Data: map[string]interface{}{"session_id": session.ID, "battery_level": data.ChargeState.BatteryLevel}})
		}
	} else if !isCharging && hasActiveCharge {
		endBattery := data.ChargeState.BatteryLevel
		endRange := data.ChargeState.BatteryRange
		power := data.ChargeState.ChargerPower
		voltage := data.ChargeState.ChargerVoltage
		current := data.ChargeState.ChargerActualCurrent

		if err := w.chargeRepo.Complete(ctx, activeChargeID, time.Now().UTC(),
			data.ChargeState.ChargeEnergyAdded, nil, &endBattery, &endRange,
			data.ChargeState.ChargerPhases, &voltage, &current, &power,
			nil, nil, nil, nil, 0); err != nil {
			log.Error().Err(err).Int64("sessionID", activeChargeID).Msg("failed to complete charging session")
		}
		w.sessionMu.Lock()
		delete(w.activeCharges, vehicle.ID)
		w.sessionMu.Unlock()
		log.Info().Int64("vehicleID", vehicle.ID).Int64("sessionID", activeChargeID).Msg("charging ended")
		if w.eventBus != nil {
			w.eventBus.Publish(events.Event{Type: events.ChargeCompleted, VehicleID: vehicle.ID, VIN: vehicle.VIN, Data: map[string]interface{}{"session_id": activeChargeID, "battery_level": data.ChargeState.BatteryLevel, "energy_added": data.ChargeState.ChargeEnergyAdded}})
		}
	}
}

func (w *Worker) evaluateAlerts(ctx context.Context, vehicle *models.Vehicle, data *tesla.VehicleDataResponse) {
	rules, err := w.alertRuleRepo.GetAll(ctx)
	if err != nil {
		return
	}

	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		// If rule is vehicle-specific, skip other vehicles
		if rule.VehicleID != nil && *rule.VehicleID != vehicle.ID {
			continue
		}

		var triggered bool
		var message string

		switch rule.Type {
		case "battery_low":
			if float64(data.ChargeState.BatteryLevel) <= rule.Threshold {
				triggered = true
				message = fmt.Sprintf("Battery at %d%% (threshold: %.0f%%)", data.ChargeState.BatteryLevel, rule.Threshold)
			}
		case "battery_high":
			if float64(data.ChargeState.BatteryLevel) >= rule.Threshold {
				triggered = true
				message = fmt.Sprintf("Battery at %d%% (threshold: %.0f%%)", data.ChargeState.BatteryLevel, rule.Threshold)
			}
		case "speed_limit":
			if data.DriveState.Speed != nil && float64(*data.DriveState.Speed) > rule.Threshold {
				triggered = true
				message = fmt.Sprintf("Speed %d km/h exceeds limit of %.0f km/h", *data.DriveState.Speed, rule.Threshold)
			}
		case "charge_complete":
			if data.ChargeState.ChargingState == "Complete" {
				triggered = true
				message = fmt.Sprintf("Charging complete at %d%%", data.ChargeState.BatteryLevel)
			}
		case "vehicle_offline":
			if data.State == "offline" {
				triggered = true
				message = "Vehicle is offline"
			}
		}

		if triggered {
			vid := vehicle.ID
			alert := &models.Alert{
				VehicleID: &vid,
				Type:      rule.Type,
				Title:     rule.Name,
				Message:   message,
			}
			if err := w.alertRepo.Create(ctx, alert); err != nil {
				log.Warn().Err(err).Str("type", rule.Type).Msg("failed to create alert")
			}

			if w.eventBus != nil {
				w.eventBus.Publish(events.Event{
					Type:      events.AlertTriggered,
					VehicleID: vehicle.ID,
					VIN:       vehicle.VIN,
					Data: map[string]interface{}{
						"rule_type": rule.Type,
						"message":   message,
						"threshold": rule.Threshold,
					},
				})
			}

			// Send notification to all enabled channels
			w.sendAlertNotifications(ctx, vehicle, rule.Name, message)
		}
	}
}

func (w *Worker) sendAlertNotifications(ctx context.Context, vehicle *models.Vehicle, title, message string) {
	notifRepo := database.NewNotificationRepo(w.db)
	channels, err := notifRepo.GetAllChannels(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("alert: failed to fetch notification channels")
		return
	}
	for _, ch := range channels {
		if !ch.Enabled {
			continue
		}
		fullTitle := fmt.Sprintf("🚗 %s: %s", vehicle.DisplayName, title)
		if w.mqttClient != nil {
			req := &notification.Request{
				ChannelType: ch.Type,
				Config:      ch.Config,
				Title:       fullTitle,
				Message:     message,
				ChannelID:   ch.ID,
			}
			if err := notification.Publish(w.mqttClient.Underlying(), req); err != nil {
				log.Warn().Err(err).Int64("channel_id", ch.ID).Msg("alert: failed to publish notification")
			}
		}
	}
}

func (w *Worker) publishMQTT(vehicle *models.Vehicle, topic, payload string) {
	if w.mqttClient == nil {
		return
	}
	w.mqttClient.Publish(vehicle.VIN+"/"+topic, payload)
}

func (w *Worker) publishVehicleData(vehicle *models.Vehicle, data *tesla.VehicleDataResponse) {
	if w.mqttClient == nil {
		return
	}
	w.mqttClient.PublishVehicleData(vehicle.VIN, data)
}
