package metrics

import (
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	FleetTelemetryCoverageRatio = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "fleet_telemetry_coverage_ratio",
		Help:      "Ratio of vehicles recently observed by this process backed by current verified telemetry",
	})

	FleetTelemetryOldestObservationAge = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "fleet_telemetry_oldest_observation_age_seconds",
		Help:      "Age in seconds of the oldest real observation among vehicles recently observed by this process",
	})

	FleetStateFallbackTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "fleet_state_fallback_total",
		Help:      "Distinct vehicle transitions into a non-current fleet-state evidence outcome, by bounded reason",
	}, []string{"reason"})

	FleetStateEvidenceCurrent = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "fleet_state_evidence_current",
		Help:      "Vehicles recently observed by this process by their latest bounded evidence outcome",
	}, []string{"reason"})
)

var fleetStateReasons = [...]string{
	"verified",
	"unverified",
	"stale",
	"unknown",
	"missing",
	"failed",
	"retained",
	"other",
}

// fleetStateMetricRecordTTL spans ten normal fleet polls and more than two
// Data Saver polls. It keeps independently completed pages in one fleet view
// while ensuring deleted or no-longer-observed vehicles cannot skew gauges for
// the lifetime of the process.
const fleetStateMetricRecordTTL = 5 * time.Minute

type FleetStateMetricObservation struct {
	VehicleID  int64
	Verified   bool
	ObservedAt time.Time
	Reason     string
}

type fleetStateMetricRecord struct {
	verified   bool
	observedAt time.Time
	reason     string
	lastSeen   time.Time
}

var (
	fleetStateMetricMu      sync.Mutex
	fleetStateMetricRecords = map[int64]fleetStateMetricRecord{}
)

func boundedFleetStateReason(verified bool, reason string) string {
	if verified {
		return "verified"
	}
	switch reason {
	case "unverified", "stale", "unknown", "missing", "failed", "retained":
		return reason
	default:
		return "other"
	}
}

// ObserveFleetStateBatch merges one authoritative fleet-state response into
// the process-wide diagnostics. Responses can be disjoint pages, so replacing
// the record set here would manufacture fallback transitions and make gauges
// describe whichever page happened to finish last. Vehicle identifiers remain
// in-process aggregation keys and never become Prometheus labels.
func ObserveFleetStateBatch(now time.Time, observations []FleetStateMetricObservation) {
	fleetStateMetricMu.Lock()
	defer fleetStateMetricMu.Unlock()

	cutoff := now.Add(-fleetStateMetricRecordTTL)
	for vehicleID, record := range fleetStateMetricRecords {
		if record.lastSeen.Before(cutoff) {
			delete(fleetStateMetricRecords, vehicleID)
		}
	}

	for _, observation := range observations {
		reason := boundedFleetStateReason(observation.Verified, observation.Reason)
		previous, hadPrevious := fleetStateMetricRecords[observation.VehicleID]
		if hadPrevious && previous.lastSeen.After(now) {
			continue
		}
		record := fleetStateMetricRecord{
			verified:   observation.Verified,
			observedAt: observation.ObservedAt,
			reason:     reason,
			lastSeen:   now,
		}
		if !observation.Verified {
			if !hadPrevious || previous.reason != reason {
				FleetStateFallbackTotal.WithLabelValues(reason).Inc()
			}
		}
		fleetStateMetricRecords[observation.VehicleID] = record
	}

	counts := make(map[string]int, len(fleetStateReasons))
	verifiedCount := 0
	var oldest time.Time
	for _, record := range fleetStateMetricRecords {
		counts[record.reason]++
		if record.verified {
			verifiedCount++
		}
		if !record.observedAt.IsZero() && (oldest.IsZero() || record.observedAt.Before(oldest)) {
			oldest = record.observedAt
		}
	}

	for _, reason := range fleetStateReasons {
		FleetStateEvidenceCurrent.WithLabelValues(reason).Set(float64(counts[reason]))
	}
	if len(fleetStateMetricRecords) == 0 {
		FleetTelemetryCoverageRatio.Set(0)
		FleetTelemetryOldestObservationAge.Set(0)
		return
	}
	FleetTelemetryCoverageRatio.Set(float64(verifiedCount) / float64(len(fleetStateMetricRecords)))
	if oldest.IsZero() {
		FleetTelemetryOldestObservationAge.Set(0)
		return
	}
	age := now.Sub(oldest).Seconds()
	if age < 0 {
		age = 0
	}
	FleetTelemetryOldestObservationAge.Set(age)
}

func ResetFleetStateMetricsForTests() {
	fleetStateMetricMu.Lock()
	defer fleetStateMetricMu.Unlock()
	fleetStateMetricRecords = map[int64]fleetStateMetricRecord{}
	FleetTelemetryCoverageRatio.Set(0)
	FleetTelemetryOldestObservationAge.Set(0)
	FleetStateFallbackTotal.Reset()
	FleetStateEvidenceCurrent.Reset()
}
