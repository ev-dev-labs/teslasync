// Package metrics — charging-place (geofence) discovery + rate-based
// pricing counters for the geofence-based charging-place pricing feature
// (migration 000228_geofence_charging_place_pricing).
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// ── Charging-place discovery/pricing ──────────────────────────────────────
//
// These counters are incremented from the async post-completion tracker and
// the one-shot startup history backfill. They make discovery/pricing trouble
// visible even though neither path may fail charge completion or MQTT ingest.

var (
	// GeofenceDiscoveryTotal counts charging-session geofence resolution
	// attempts by outcome:
	//   - matched: an existing (manual or previously-discovered) geofence
	//     already contained the session's coordinates.
	//   - created: no geofence matched, so a new provisional
	//     charging-place geofence was created (origin=charging_discovery).
	//   - error: coordinates were invalid/missing, or the match-or-create
	//     database operation failed; the session is left unattributed.
	GeofenceDiscoveryTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "geofence_discovery_total",
		Help:      "Charging-place geofence discovery attempts from confirmed charging sessions, by outcome",
	}, []string{"result"})

	// GeofenceRateApplyTotal counts charging-session rate-based cost
	// application attempts by outcome:
	//   - applied: a configured rate was found and the session was priced
	//     (or re-priced) via PostgreSQL NUMERIC arithmetic.
	//   - no_rate: the geofence resolved but has no rate configured for
	//     the session's started_at yet.
	//   - skipped: a rate was found but the session was not updated
	//     because it already carries a manual/Tesla-actual cost, or has
	//     no energy-added value yet to price against.
	//   - error: the rate lookup or apply database operation failed.
	GeofenceRateApplyTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "geofence_rate_apply_total",
		Help:      "Charging session geofence-tariff pricing attempts, by outcome",
	}, []string{"result"})

	// GeofenceHistoricalBackfillTotal counts completed legacy charging
	// sessions processed by the startup Charging Places backfill:
	//   - historical_rate: priced with the rate active at session start.
	//   - current_estimate: no historical rate existed, so today's rate was
	//     applied with default_estimate provenance.
	//   - attributed_only: place attached but no usable rate was configured.
	//   - skipped: place attached, monetary fields protected or incomplete.
	//   - error: discovery, attribution, lookup, or pricing failed.
	GeofenceHistoricalBackfillTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "geofence_historical_backfill_total",
		Help:      "Legacy charging sessions processed by Charging Places startup backfill, by outcome",
	}, []string{"result"})
)
