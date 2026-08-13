package telemetry

import (
	"context"
	"fmt"
	"strings"
	"time"

	dbadmin "github.com/ev-dev-labs/teslasync/internal/database/admin"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	"github.com/ev-dev-labs/teslasync/internal/tracing"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
)

// =============================================================================
// telemetry_sessions_charge_geofence_pricing.go — charging-place geofence
// discovery + rate-based cost calculation for the geofence-based
// charging-place pricing feature (migration
// 000228_geofence_charging_place_pricing).
//
// Live-session entry points are invoked via safeGo after a confirmed session
// row commits. The legacy-history path runs once at startup in its own safeGo.
// A raw cable-attached event never reaches either path, so discovery latency
// and failures cannot block or fail MQTT/telemetry ingest.
// =============================================================================

// applyGeofencePricingAsync resolves the charging-place geofence for a
// confirmed charging session and, when energy is available plus a rate is
// configured for the instant the session STARTED (never "now"), computes its
// cost. Calling it at session start creates/attaches the place promptly;
// calling it again at completion performs the monetary calculation.
//
// Sequence:
//  1. Match an existing geofence (any origin) containing (lat, lon) — see
//     resolveChargingGeofence. Reuses the exact matching behavior that
//     previously only fed `start_place` naming.
//  2. If nothing matches, idempotently discover a provisional
//     charging-place geofence (75m circle, needs_review=true) via
//     GeofenceRepo.FindOrCreateForCharging, deduplicated by an in-database
//     advisory lock so concurrent completions at the same spot (e.g. two
//     vehicles finishing a charge at the same Supercharger at once) can
//     never create more than one place.
//  3. Whichever geofence resolved, attach its id + display name to the
//     session, then look up the rate active at the session's StartedAt via
//     GeofenceRepo.GetActiveRateAt and, if found, apply it via
//     ChargingRepo.ApplyGeofenceTariff — which computes cost with
//     PostgreSQL NUMERIC arithmetic and is guarded to only ever
//     (re)write a session whose cost is unset or geofence/default-derived,
//     NEVER a manual, Tesla-actual, or existing unknown-provenance cost.
//
// Retry-safety: every database operation this method calls
// (FindOrCreateForCharging, ApplyGeofenceTariff) is independently
// idempotent, so re-running this exact sequence for the same session after
// a transient failure can never create a duplicate geofence or replace a
// historical tariff with a different rate version.
func (t *TelemetrySessionTracker) applyGeofencePricingAsync(sessionID, vehicleID int64, lat, lon float64, startedAt time.Time, fields map[string]interface{}) {
	gctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	gctx, span := tracing.StartSpan(gctx, "telemetry.charge_geofence_pricing",
		tracing.ChargeID(sessionID), tracing.VehicleID(vehicleID))
	defer span.End()

	geofenceID, geofenceName, err := t.resolveChargingGeofence(gctx, sessionID, lat, lon)
	if err != nil {
		log.Warn().Err(err).Int64("session_id", sessionID).Int64("vehicle_id", vehicleID).
			Msg("telemetry: geofence match/discovery failed for charging session; left unattributed")
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		if uerr := t.chargeRepo.PartialUpdate(gctx, sessionID, fields); uerr != nil {
			log.Warn().Err(uerr).Int64("session_id", sessionID).
				Msg("telemetry: failed to persist charge enhanced fields after geofence resolution failure")
		}
		return
	}

	fields["start_place"] = geofenceName
	fields["geofence_id"] = geofenceID
	if err := t.chargeRepo.PartialUpdate(gctx, sessionID, fields); err != nil {
		log.Warn().Err(err).Int64("session_id", sessionID).Int64("geofence_id", geofenceID).
			Msg("telemetry: failed to attach geofence to charging session")
	}

	rate, err := t.geofenceRepo.GetActiveRateAt(gctx, geofenceID, startedAt)
	if err != nil {
		metrics.GeofenceRateApplyTotal.WithLabelValues("error").Inc()
		log.Warn().Err(err).Int64("session_id", sessionID).Int64("geofence_id", geofenceID).
			Msg("telemetry: geofence rate lookup failed")
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return
	}
	if rate == nil {
		// No rate configured for this place/instant yet — leave
		// cost_source/cost_decimal/cost_currency unset (implicitly
		// "unknown"); the Charging Places UI surfaces this as a place
		// needing rate setup, not an error.
		metrics.GeofenceRateApplyTotal.WithLabelValues("no_rate").Inc()
		return
	}

	applied, err := t.chargeRepo.ApplyGeofenceTariff(gctx, sessionID, geofenceID, rate.ID, rate.RatePerWh, rate.Currency)
	if err != nil {
		metrics.GeofenceRateApplyTotal.WithLabelValues("error").Inc()
		log.Warn().Err(err).Int64("session_id", sessionID).Int64("geofence_id", geofenceID).Int64("rate_id", rate.ID).
			Msg("telemetry: failed to apply geofence tariff to charging session")
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return
	}
	if applied {
		metrics.GeofenceRateApplyTotal.WithLabelValues("applied").Inc()
	} else {
		// ApplyGeofenceTariff's WHERE guard correctly declined to touch a
		// session that already carries a protected cost, or has no
		// energy-added value yet — expected, not an error.
		metrics.GeofenceRateApplyTotal.WithLabelValues("skipped").Inc()
	}
}

const chargingPlaceHistoryBackfillBatch = 100

// StartChargingPlaceHistoryBackfill starts the one-shot, panic-isolated
// startup pass that discovers places for completed sessions predating the
// Charging Places feature.
func (t *TelemetrySessionTracker) StartChargingPlaceHistoryBackfill(ctx context.Context) {
	if t == nil {
		return
	}
	safeGo("charging_place_history_backfill", func() {
		t.BackfillChargingPlaces(ctx)
	})
}

// BackfillChargingPlaces attaches completed legacy charging sessions to an
// existing or newly-discovered place. The rate active at session start wins;
// when no historical interval exists, the rate active at startup is applied
// as default_estimate provenance. Existing actual or unknown-provenance costs
// remain protected by the repository write guards.
func (t *TelemetrySessionTracker) BackfillChargingPlaces(ctx context.Context) {
	if t == nil || t.geofenceRepo == nil || t.chargeRepo == nil {
		return
	}

	ctx, span := tracing.StartSpan(ctx, "telemetry.charging_place_history_backfill")
	var runErr error
	defer func() { tracing.EndSpan(span, runErr) }()

	now := time.Now().UTC()
	var afterID int64
	processed := 0
	outcomes := map[string]int{}

	for {
		if ctx.Err() != nil {
			break
		}
		candidates, err := t.geofenceRepo.ListChargingPlaceBackfillCandidates(
			ctx,
			afterID,
			chargingPlaceHistoryBackfillBatch,
		)
		if err != nil {
			runErr = err
			log.Error().
				Err(err).
				Str("trace_id", span.SpanContext().TraceID().String()).
				Msg("charging place history backfill: failed to load candidates")
			break
		}
		if len(candidates) == 0 {
			break
		}

		for _, candidate := range candidates {
			if ctx.Err() != nil {
				break
			}
			afterID = candidate.SessionID
			outcome, err := t.backfillChargingPlace(ctx, candidate, now)
			if err != nil {
				outcome = "error"
				log.Warn().
					Err(err).
					Int64("session_id", candidate.SessionID).
					Int64("vehicle_id", candidate.VehicleID).
					Msg("charging place history backfill: session deferred until next startup")
			}
			processed++
			outcomes[outcome]++
			metrics.GeofenceHistoricalBackfillTotal.WithLabelValues(outcome).Inc()
		}

		if len(candidates) < chargingPlaceHistoryBackfillBatch {
			break
		}
	}

	span.SetAttributes(
		attribute.Int("charging_place_backfill.processed", processed),
		attribute.Int("charging_place_backfill.historical_rate", outcomes["historical_rate"]),
		attribute.Int("charging_place_backfill.current_estimate", outcomes["current_estimate"]),
		attribute.Int("charging_place_backfill.attributed_only", outcomes["attributed_only"]),
		attribute.Int("charging_place_backfill.skipped", outcomes["skipped"]),
		attribute.Int("charging_place_backfill.errors", outcomes["error"]),
	)
	if runErr != nil {
		log.Warn().
			Int("processed", processed).
			Int("historical_rate", outcomes["historical_rate"]).
			Int("current_estimate", outcomes["current_estimate"]).
			Int("attributed_only", outcomes["attributed_only"]).
			Int("skipped", outcomes["skipped"]).
			Int("errors", outcomes["error"]).
			Msg("charging place history backfill stopped before backlog drained")
		return
	}
	log.Info().
		Int("processed", processed).
		Int("historical_rate", outcomes["historical_rate"]).
		Int("current_estimate", outcomes["current_estimate"]).
		Int("attributed_only", outcomes["attributed_only"]).
		Int("skipped", outcomes["skipped"]).
		Int("errors", outcomes["error"]).
		Msg("charging place history backfill complete")
}

func (t *TelemetrySessionTracker) backfillChargingPlace(ctx context.Context, candidate *systemmodel.ChargingPlaceBackfillCandidate, now time.Time) (string, error) {
	if candidate == nil {
		return "", fmt.Errorf("charging place history backfill: nil candidate")
	}
	suggestedName := ""
	if candidate.StartPlace != nil {
		suggestedName = strings.TrimSpace(*candidate.StartPlace)
	}
	geofenceID, geofenceName, err := t.resolveChargingGeofenceWithName(
		ctx,
		candidate.SessionID,
		candidate.StartLat,
		candidate.StartLng,
		suggestedName,
		false,
	)
	if err != nil {
		return "", err
	}
	if err := t.chargeRepo.PartialUpdate(ctx, candidate.SessionID, map[string]interface{}{
		"start_place": geofenceName,
		"geofence_id": geofenceID,
	}); err != nil {
		return "", err
	}

	historicalRate, err := t.geofenceRepo.GetActiveRateAt(ctx, geofenceID, candidate.StartedAt)
	if err != nil {
		return "", err
	}
	if historicalRate != nil {
		applied, err := t.chargeRepo.ApplyGeofenceTariff(
			ctx,
			candidate.SessionID,
			geofenceID,
			historicalRate.ID,
			historicalRate.RatePerWh,
			historicalRate.Currency,
		)
		if err != nil {
			return "", err
		}
		if applied {
			return "historical_rate", nil
		}
		return "skipped", nil
	}

	currentRate, err := t.geofenceRepo.GetActiveRateAt(ctx, geofenceID, now)
	if err != nil {
		return "", err
	}
	if currentRate == nil {
		return "attributed_only", nil
	}
	applied, err := t.geofenceRepo.ApplyCurrentRateEstimate(
		ctx,
		candidate.SessionID,
		geofenceID,
		currentRate.ID,
		now,
	)
	if err != nil {
		return "", err
	}
	if applied {
		return "current_estimate", nil
	}
	return "skipped", nil
}

// resolveChargingGeofence matches (or, failing that, discovers) the
// charging-place geofence for (lat, lon), returning its id and display
// name. Counts the outcome via metrics.GeofenceDiscoveryTotal.
func (t *TelemetrySessionTracker) resolveChargingGeofence(ctx context.Context, sessionID int64, lat, lon float64) (int64, string, error) {
	return t.resolveChargingGeofenceWithName(ctx, sessionID, lat, lon, "", true)
}

func (t *TelemetrySessionTracker) resolveChargingGeofenceWithName(
	ctx context.Context,
	sessionID int64,
	lat, lon float64,
	suggestedName string,
	allowReverseGeocode bool,
) (int64, string, error) {
	if geofences, err := t.geofenceRepo.FindByCoordinates(ctx, lat, lon); err == nil && len(geofences) > 0 {
		metrics.GeofenceDiscoveryTotal.WithLabelValues("matched").Inc()
		return geofences[0].ID, geofences[0].Name, nil
	}

	if strings.TrimSpace(suggestedName) == "" && allowReverseGeocode {
		suggestedName = t.suggestChargingPlaceName(ctx, lat, lon)
	}
	discovered, created, err := t.geofenceRepo.FindOrCreateForCharging(ctx, lat, lon, suggestedName)
	if err != nil {
		metrics.GeofenceDiscoveryTotal.WithLabelValues("error").Inc()
		return 0, "", err
	}
	if created {
		metrics.GeofenceDiscoveryTotal.WithLabelValues("created").Inc()
		log.Info().Int64("session_id", sessionID).Int64("geofence_id", discovered.ID).Str("name", discovered.Name).
			Msg("telemetry: auto-discovered charging-place geofence")
	} else {
		// Lost the discovery race to a concurrent caller (or a previous
		// attempt for this exact session already created it) — the
		// advisory-lock re-check inside FindOrCreateForCharging returned
		// the winner's place instead of creating a duplicate.
		metrics.GeofenceDiscoveryTotal.WithLabelValues("matched").Inc()
	}
	return discovered.ID, discovered.Name, nil
}

// suggestChargingPlaceName resolves a friendly name for a possibly-new
// charging place: the places cache first (no external call), else reverse
// geocoding (cached afterward for next time). Returns "" — NOT an error —
// when neither source has an answer; FindOrCreateForCharging substitutes a
// safe neutral name in that case.
func (t *TelemetrySessionTracker) suggestChargingPlaceName(ctx context.Context, lat, lon float64) string {
	if t.placesCache != nil {
		if cached, err := t.placesCache.FindNearby(ctx, lat, lon, 50); err == nil && cached != nil {
			_ = t.placesCache.IncrementHitCount(ctx, cached.ID)
			return cached.DisplayName
		}
	}
	if t.geocoder == nil {
		return ""
	}

	result, err := t.geocoder.ReverseGeocode(ctx, lat, lon)
	if err != nil {
		return ""
	}
	if result == nil {
		// A Geocoder implementation returning (nil, nil) — "no result, no
		// error" — is a valid, common outcome (see resolveAndUpdateAddress's
		// identical guard in telemetry_sessions_drive_tracking.go), not an
		// error: fall back to the safe neutral name FindOrCreateForCharging
		// substitutes for an empty string.
		return ""
	}
	name := result.ShortName()
	if t.placesCache != nil {
		_ = t.placesCache.Upsert(ctx, &dbadmin.PlaceCacheEntry{
			Latitude: lat, Longitude: lon, DisplayName: name, Source: "geocoding",
			City: ptrStrOrNil(result.City), State: ptrStrOrNil(result.State),
			Country: ptrStrOrNil(result.Country), Postcode: ptrStrOrNil(result.PostCode),
		})
	}
	return name
}
