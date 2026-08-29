package worker

import (
	"context"
	"errors"
	"fmt"
	"time"

	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/rs/zerolog/log"
)

func (w *Worker) pollVehicle(ctx context.Context, vehicle *vehiclemodel.Vehicle) {
	logger := log.With().Int64("vehicle_id", vehicle.ID).Str("vin", vehicle.VIN).Logger()
	pollStart := time.Now()

	pollCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var endpoints []string
	if w.pollingConfig != nil {
		endpoints = w.pollingConfig.EnabledVehicleDataEndpoints()
	}

	data, err := w.teslaClient.GetVehicleData(pollCtx, vehicle.VIN, endpoints...)
	if errors.Is(err, tesla.ErrVehicleAsleep) {
		w.publishMQTT(vehicle, "state", enums.StateAsleep)
		w.recordVehicleAsleep(vehicle.ID)
		if w.PollEngine != nil {
			w.PollEngine.MarkSleeping(vehicle.VIN)
		}
		return
	}
	if errors.Is(err, tesla.ErrBudgetExceeded) {
		now := time.Now().UTC()
		backoffUntil := now.Add(time.Hour)
		var budgetErr *tesla.BudgetExceededError
		if errors.As(err, &budgetErr) && budgetErr.Snapshot.ResetAt.After(now) {
			backoffUntil = budgetErr.Snapshot.ResetAt
		}
		logger.Warn().
			Time("backoff_until", backoffUntil).
			Msg("Tesla Fleet API daily budget reached — pausing vehicle polling")
		if w.PollEngine != nil {
			w.PollEngine.MarkBudgetExhausted(vehicle.VIN, backoffUntil)
		} else {
			w.mu.Lock()
			vh, ok := w.vehicleHealth[vehicle.ID]
			if !ok {
				vh = &vehicleHealth{}
				w.vehicleHealth[vehicle.ID] = vh
			}
			vh.backoffUntil = backoffUntil
			w.mu.Unlock()
		}
		metrics.PollsTotal.WithLabelValues("budget_limited").Inc()
		return
	}
	if errors.Is(err, tesla.ErrBudgetUnavailable) {
		backoffUntil := time.Now().Add(time.Minute)
		logger.Error().
			Err(err).
			Time("backoff_until", backoffUntil).
			Msg("Tesla Fleet API budget evidence unavailable — failing closed")
		if w.PollEngine != nil {
			w.PollEngine.MarkBudgetUnavailable(vehicle.VIN, backoffUntil)
		} else {
			w.mu.Lock()
			vh, ok := w.vehicleHealth[vehicle.ID]
			if !ok {
				vh = &vehicleHealth{}
				w.vehicleHealth[vehicle.ID] = vh
			}
			vh.backoffUntil = backoffUntil
			w.mu.Unlock()
		}
		metrics.PollsTotal.WithLabelValues("budget_unavailable").Inc()
		return
	}
	if errors.Is(err, tesla.ErrRateLimited) {
		logger.Warn().Msg("Tesla API rate limited (429) — backing off without counting as failure")
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
			retryCtx, retryCancel := context.WithTimeout(ctx, 30*time.Second)
			defer retryCancel()
			data, err = w.teslaClient.GetVehicleData(retryCtx, vehicle.VIN, endpoints...)
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
		metrics.PollsTotal.WithLabelValues("error").Inc()
		w.recordVehicleFailure(vehicle.ID)
		return
	}

	w.recordVehicleSuccess(vehicle.ID)
	metrics.PollsTotal.WithLabelValues("success").Inc()
	metrics.PollCycleDuration.Observe(time.Since(pollStart).Seconds())

	pos := w.buildPosition(vehicle.ID, data)
	if err := w.posRepo.BulkInsert(ctx, []telemetrymodel.Position{*pos}); err != nil {
		logger.Error().Err(err).Msg("failed to insert position")
	}

	// Persist Tesla-reported timezone so vehicle-anchored timestamps render
	// in the car's local time. Only writes on change, with a short DB timeout
	// so timezone metadata cannot extend the poll path beyond its budget.
	w.maybeUpdateVehicleTimezone(ctx, vehicle, data)

	w.trackDriving(ctx, vehicle, data)

	w.trackCharging(ctx, vehicle, data)

	w.evaluateAlerts(ctx, vehicle, data)

	w.publishVehicleData(vehicle, data)

	// Feed response to the adaptive polling engine for next-interval decision
	if w.PollEngine != nil {
		decision := w.PollEngine.Assess(vehicle.VIN, data)
		if snapshot, enabled, budgetErr := w.teslaClient.BudgetSnapshot(ctx); budgetErr != nil {
			logger.Warn().Err(budgetErr).Msg("could not calculate Fleet API budget pacing")
		} else if enabled {
			if pacedInterval := w.PollEngine.ApplyBudgetPacing(vehicle.VIN, snapshot); pacedInterval > decision.NextInterval {
				decision.NextInterval = pacedInterval
				decision.Reasons = append(
					decision.Reasons,
					"Fleet API budget pacing preserves coverage through the UTC day",
				)
			}
		}
		logger.Debug().
			Str("state", data.State).
			Int("battery", data.ChargeState.BatteryLevel).
			Str("engine_profile", string(decision.Profile)).
			Str("engine_activity", decision.Activity.String()).
			Dur("engine_next", decision.NextInterval).
			Msg("polled vehicle (engine-managed)")
	} else {
		logger.Debug().Str("state", data.State).Int("battery", data.ChargeState.BatteryLevel).Msg("polled vehicle")
	}
}

func (w *Worker) buildPosition(vehicleID int64, data *tesla.VehicleDataResponse) *telemetrymodel.Position {
	p := &telemetrymodel.Position{
		VehicleID: vehicleID,
		Ts:        time.Now(),
		Latitude:  data.DriveState.Latitude,
		Longitude: data.DriveState.Longitude,
		Source:    "polling",
	}

	if data.DriveState.Speed != nil {
		s := float64(*data.DriveState.Speed)
		p.SpeedMph = &s
	}
	heading := int16(data.DriveState.Heading)
	p.Heading = &heading

	return p
}

func (w *Worker) trackDriving(ctx context.Context, vehicle *vehiclemodel.Vehicle, data *tesla.VehicleDataResponse) {
	w.sessionSvc.TrackDriveFromAPI(ctx, vehicle, data)
}

func (w *Worker) trackCharging(ctx context.Context, vehicle *vehiclemodel.Vehicle, data *tesla.VehicleDataResponse) {
	w.sessionSvc.TrackChargeFromAPI(ctx, vehicle, data)
}

// maybeUpdateVehicleTimezone persists the IANA tz reported in
// vehicle_state.timezone when it differs from the cached value on the
// vehicles row. Skipped when the API didn't include a timezone (empty
// string) so we never overwrite a known-good value with an unknown.
// Bounded with a 5s context so a slow DB write can't extend the poll
// path beyond its budget; failures are logged but never propagated
// (timezone is metadata, not in the critical path).
func (w *Worker) maybeUpdateVehicleTimezone(ctx context.Context, vehicle *vehiclemodel.Vehicle, data *tesla.VehicleDataResponse) {
	tz := data.VehicleState.Timezone
	if tz == "" || tz == vehicle.Timezone {
		return
	}
	updateCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := w.vehicleRepo.UpdateTimezone(updateCtx, vehicle.ID, tz); err != nil {
		log.Warn().
			Err(err).
			Int64("vehicle_id", vehicle.ID).
			Str("vin", vehicle.VIN).
			Str("timezone", tz).
			Msg("failed to persist vehicle timezone")
		return
	}
	vehicle.Timezone = tz
}

func (w *Worker) evaluateAlerts(ctx context.Context, vehicle *vehiclemodel.Vehicle, data *tesla.VehicleDataResponse) {
	rules, err := w.alertRuleRepo.GetAll(ctx)
	if err != nil {
		return
	}

	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		// AppliesTo handles both fleet-wide rules and explicit vehicle subsets.
		if !rule.AppliesTo(vehicle.ID) {
			continue
		}

		var triggered bool
		var message string

		threshold := float64(0)
		if rule.ValueNum != nil {
			threshold = *rule.ValueNum
		}

		switch rule.SignalName {
		case "battery_level":
			val := float64(data.ChargeState.BatteryLevel)
			if alertNumericOp(val, rule.Op, threshold) {
				triggered = true
				message = fmt.Sprintf("Battery at %d%% (threshold: %.0f%%)", data.ChargeState.BatteryLevel, threshold)
			}
		case "vehicle_speed":
			if data.DriveState.Speed != nil {
				val := float64(*data.DriveState.Speed)
				if alertNumericOp(val, rule.Op, threshold) {
					triggered = true
					message = fmt.Sprintf("Speed %d km/h exceeds limit of %.0f km/h", *data.DriveState.Speed, threshold)
				}
			}
		case "charging_state":
			if rule.ValueText != nil && data.ChargeState.ChargingState == *rule.ValueText {
				triggered = true
				message = fmt.Sprintf("Charging complete at %d%%", data.ChargeState.BatteryLevel)
			}
		case "vehicle_state":
			if rule.ValueText != nil && data.State == *rule.ValueText {
				triggered = true
				message = fmt.Sprintf("Vehicle is %s", data.State)
			}
		}

		if triggered {
			if w.eventBus != nil {
				w.eventBus.Publish(events.Event{
					Type:      events.AlertTriggered,
					VehicleID: vehicle.ID,
					VIN:       vehicle.VIN,
					Data: map[string]interface{}{
						"rule_type": rule.SignalName,
						"message":   message,
						"threshold": threshold,
					},
				})
			}

			w.sendAlertNotifications(ctx, vehicle, rule.Name, message)
		}
	}
}

// alertNumericOp evaluates val <op> threshold for alert rule evaluation.
func alertNumericOp(val float64, op string, threshold float64) bool {
	switch op {
	case "<=":
		return val <= threshold
	case ">=":
		return val >= threshold
	case ">":
		return val > threshold
	case "<":
		return val < threshold
	case "=":
		return val == threshold
	case "!=":
		return val != threshold
	}
	return false
}

func (w *Worker) sendAlertNotifications(ctx context.Context, vehicle *vehiclemodel.Vehicle, title, message string) {
	notifRepo := dbnotif.NewNotificationRepo(w.db)
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
			if err := notification.PublishCtx(ctx, w.mqttClient.Underlying(), req); err != nil {
				log.Warn().Err(err).Int64("channel_id", ch.ID).Msg("alert: failed to publish notification")
			}
		}
	}
}

func (w *Worker) publishMQTT(vehicle *vehiclemodel.Vehicle, topic, payload string) {
	if w.mqttClient == nil {
		return
	}
	w.mqttClient.Publish(vehicle.VIN+"/"+topic, payload)
}

func (w *Worker) publishVehicleData(vehicle *vehiclemodel.Vehicle, data *tesla.VehicleDataResponse) {
	if w.mqttClient == nil {
		return
	}
	w.mqttClient.PublishVehicleData(vehicle.VIN, data)
}
