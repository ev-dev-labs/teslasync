package worker

import (
	"context"
	"errors"
	"fmt"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/teslasync/teslasync/internal/config"
	"github.com/teslasync/teslasync/internal/database"
	"github.com/teslasync/teslasync/internal/models"
	"github.com/teslasync/teslasync/internal/mqtt"
	"github.com/teslasync/teslasync/internal/tesla"
)

// vehicleHealth tracks per-vehicle polling state for backoff.
type vehicleHealth struct {
	consecFails int
	lastError   time.Time
	backoffUntil time.Time
}

// vehiclePollingState tracks adaptive polling intervals per vehicle.
type vehiclePollingState struct {
	lastState    string
	lastPollAt   time.Time
	pollInterval time.Duration
}

// skippedPolls tracks the number of polls skipped by adaptive polling (for metrics).
var skippedPolls int64

// GetSkippedPolls returns the total number of polls skipped by adaptive polling.
func GetSkippedPolls() int64 {
	return atomic.LoadInt64(&skippedPolls)
}

// Worker polls Tesla API for vehicle data and stores it.
type Worker struct {
	db          *database.DB
	vehicleRepo *database.VehicleRepo
	posRepo     *database.PositionRepo
	driveRepo   *database.DriveRepo
	chargeRepo  *database.ChargingRepo
	tokenRepo   *database.TokenRepo
	teslaClient *tesla.Client
	mqttClient  *mqtt.Client
	cfg         config.WorkerConfig

	// Track active sessions per vehicle
	activeDrives  map[int64]int64 // vehicleID -> driveID
	activeCharges map[int64]int64 // vehicleID -> chargingSessionID

	// Per-vehicle health tracking for adaptive backoff
	mu             sync.Mutex
	vehicleHealth  map[int64]*vehicleHealth

	// Per-vehicle adaptive polling state
	pollingStates  map[int64]*vehiclePollingState
}

// New creates a new Worker that polls the Tesla API at the configured interval,
// persists data to the database, and publishes updates via MQTT.
func New(db *database.DB, tc *tesla.Client, mc *mqtt.Client, cfg config.WorkerConfig) *Worker {
	return &Worker{
		db:            db,
		vehicleRepo:   database.NewVehicleRepo(db),
		posRepo:       database.NewPositionRepo(db),
		driveRepo:     database.NewDriveRepo(db),
		chargeRepo:    database.NewChargingRepo(db),
		tokenRepo:     database.NewTokenRepo(db),
		teslaClient:   tc,
		mqttClient:    mc,
		cfg:           cfg,
		activeDrives:  make(map[int64]int64),
		activeCharges: make(map[int64]int64),
		vehicleHealth: make(map[int64]*vehicleHealth),
		pollingStates: make(map[int64]*vehiclePollingState),
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

	// Status check ticker: ListVehicles + poll active ones (15 min)
	ticker := time.NewTicker(w.cfg.StatusCheckInterval)
	defer ticker.Stop()

	// Fast ticker: re-fetch data for driving/charging vehicles only (2 min)
	fastTicker := time.NewTicker(w.cfg.DrivingPollInterval)
	defer fastTicker.Stop()

	// Token refresh ticker (every 30 minutes)
	refreshTicker := time.NewTicker(30 * time.Minute)
	defer refreshTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("worker stopping")
			return

		case <-refreshTicker.C:
			w.safeRefreshToken(ctx)

		case <-ticker.C:
			if !w.teslaClient.HasValidToken() {
				if err := w.loadTokens(ctx); err != nil {
					continue
				}
			}
			w.safePollAllVehicles(ctx)

		case <-fastTicker.C:
			if !w.teslaClient.HasValidToken() {
				continue
			}
			w.safePollActiveVehicles(ctx)
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

// safePollActiveVehicles wraps active-vehicle polling with panic recovery.
func (w *Worker) safePollActiveVehicles(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Str("panic", fmt.Sprintf("%v", r)).Str("stack", string(debug.Stack())).Msg("panic in active poll loop")
		}
	}()
	w.pollActiveVehicles(ctx)
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
	// ONE API call to get status of ALL vehicles
	teslaVehicles, err := w.teslaClient.ListVehicles(ctx)
	if err != nil {
		log.Error().Err(err).Msg("failed to list vehicles")
		return
	}

	// Build state map from the list response
	stateMap := make(map[int64]string) // vehicleID → state
	for _, tv := range teslaVehicles {
		stateMap[tv.VehicleID] = tv.State
	}

	// Get our DB vehicles
	vehicles, err := w.vehicleRepo.GetAll(ctx)
	if err != nil {
		log.Error().Err(err).Msg("failed to list vehicles for polling")
		return
	}

	for _, vehicle := range vehicles {
		state := stateMap[vehicle.VehicleID]
		if state == "" {
			state = "unknown"
		}

		// Update state in DB from the list response (no per-vehicle API call)
		_ = w.vehicleRepo.UpdateState(ctx, vehicle.ID, state, state != "offline")
		w.publishMQTT(vehicle, "state", state)

		// NEVER call any API for sleeping/offline vehicles
		if state == "asleep" || state == "offline" {
			w.updatePollingState(vehicle.ID, state)
			continue
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

		// Only call expensive vehicle_data for active vehicles
		if !w.shouldPollVehicle(vehicle.ID, state) {
			atomic.AddInt64(&skippedPolls, 1)
			log.Debug().Int64("vehicle_id", vehicle.ID).Str("state", state).Msg("skipping vehicle (adaptive interval)")
			continue
		}

		w.pollVehicleSafe(ctx, vehicle)
	}
}

// shouldPollVehicle returns true if enough time has elapsed since the last poll
// based on the vehicle's current state. This implements adaptive polling to
// minimize API requests and billing costs.
func (w *Worker) shouldPollVehicle(vehicleID int64, lastState string) bool {
	w.mu.Lock()
	state := w.pollingStates[vehicleID]
	w.mu.Unlock()

	if state == nil {
		return true // First poll
	}

	var interval time.Duration
	switch lastState {
	case "driving":
		interval = w.cfg.DrivingPollInterval // 120s
	case "charging":
		interval = w.cfg.ChargingPollInterval // 600s
	case "asleep", "offline":
		return false // NEVER poll sleeping/offline vehicles
	default: // online, idle
		interval = w.cfg.PollInterval // 900s
	}

	return time.Since(state.lastPollAt) >= interval
}

// updatePollingState records the poll time and detected state for a vehicle.
func (w *Worker) updatePollingState(vehicleID int64, state string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	ps := w.pollingStates[vehicleID]
	if ps == nil {
		ps = &vehiclePollingState{}
		w.pollingStates[vehicleID] = ps
	}
	ps.lastState = state
	ps.lastPollAt = time.Now()
}

// pollVehicleSafe wraps pollVehicleData with per-vehicle panic recovery.
func (w *Worker) pollVehicleSafe(ctx context.Context, vehicle *models.Vehicle) {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Int64("vehicle_id", vehicle.ID).Str("vin", vehicle.VIN).Str("panic", fmt.Sprintf("%v", r)).Msg("panic polling vehicle — applying backoff")
			w.recordVehicleFailure(vehicle.ID)
		}
	}()
	w.pollVehicleData(ctx, vehicle)
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
	}
}

// pollActiveVehicles polls only vehicles whose last known state is "driving" or "charging".
// This is called on the fast ticker and does NOT call ListVehicles.
func (w *Worker) pollActiveVehicles(ctx context.Context) {
	vehicles, err := w.vehicleRepo.GetAll(ctx)
	if err != nil {
		log.Error().Err(err).Msg("failed to list vehicles for active polling")
		return
	}
	for _, v := range vehicles {
		w.mu.Lock()
		ps := w.pollingStates[v.ID]
		w.mu.Unlock()
		if ps != nil && (ps.lastState == "driving" || ps.lastState == "charging") && w.shouldPollVehicle(v.ID, ps.lastState) {
			w.pollVehicleSafe(ctx, v)
		}
	}
}

// pollVehicleData fetches the full vehicle_data for a vehicle.
// Status is already known from ListVehicles, so no GetVehicleStatus call is needed.
func (w *Worker) pollVehicleData(ctx context.Context, vehicle *models.Vehicle) {
	logger := log.With().Int64("vehicle_id", vehicle.ID).Str("vin", vehicle.VIN).Logger()

	data, err := w.teslaClient.GetVehicleData(ctx, vehicle.VehicleID)
	if errors.Is(err, tesla.ErrVehicleAsleep) {
		if err := w.vehicleRepo.UpdateState(ctx, vehicle.ID, "asleep", true); err != nil {
			logger.Error().Err(err).Msg("failed to update vehicle state")
		}
		w.publishMQTT(vehicle, "state", "asleep")
		w.recordVehicleSuccess(vehicle.ID) // Asleep is not a failure
		w.updatePollingState(vehicle.ID, "asleep")
		return
	}
	if errors.Is(err, tesla.ErrUnauthorized) {
		logger.Warn().Msg("received 401 — attempting token refresh")
		if w.doRefreshToken(ctx) {
			// Retry once after successful refresh
			data, err = w.teslaClient.GetVehicleData(ctx, vehicle.VehicleID)
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

	// Determine effective state for adaptive polling
	effectiveState := data.State
	if data.DriveState.Speed != nil && *data.DriveState.Speed > 0 {
		effectiveState = "driving"
	} else if data.ChargeState.ChargingState == "Charging" {
		effectiveState = "charging"
	}
	w.updatePollingState(vehicle.ID, effectiveState)

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

	// Publish to MQTT
	w.publishVehicleData(vehicle, data)

	logger.Debug().Str("state", data.State).Str("effective_state", effectiveState).Int("battery", data.ChargeState.BatteryLevel).Msg("polled vehicle")
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

	activeDriveID, hasActiveDrive := w.activeDrives[vehicle.ID]

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
		w.activeDrives[vehicle.ID] = drive.ID
		log.Info().Int64("vehicleID", vehicle.ID).Int64("driveID", drive.ID).Msg("drive started")
	} else if !isDriving && hasActiveDrive {
		// End drive
		endRange := data.ChargeState.BatteryRange
		endBattery := data.ChargeState.BatteryLevel
		if err := w.driveRepo.Complete(ctx, activeDriveID, time.Now().UTC(),
			nil, nil, 0, 0, &endRange, &endBattery, nil, nil, nil, nil, nil); err != nil {
			log.Error().Err(err).Int64("driveID", activeDriveID).Msg("failed to complete drive")
		}
		delete(w.activeDrives, vehicle.ID)
		log.Info().Int64("vehicleID", vehicle.ID).Int64("driveID", activeDriveID).Msg("drive ended")
	}
}

func (w *Worker) trackCharging(ctx context.Context, vehicle *models.Vehicle, data *tesla.VehicleDataResponse) {
	isCharging := data.ChargeState.ChargingState == "Charging"
	activeChargeID, hasActiveCharge := w.activeCharges[vehicle.ID]

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
		w.activeCharges[vehicle.ID] = session.ID
		log.Info().Int64("vehicleID", vehicle.ID).Int64("sessionID", session.ID).Msg("charging started")
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
		delete(w.activeCharges, vehicle.ID)
		log.Info().Int64("vehicleID", vehicle.ID).Int64("sessionID", activeChargeID).Msg("charging ended")
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
