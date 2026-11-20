package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var SmartChargingEvaluations = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_charging_evaluations_total",
	Help:      "Charging readiness evaluations by bounded decision reason, without recipient or vehicle labels.",
}, []string{"reason"})

var smartCommuteTrafficEvaluations = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_commute_traffic_evaluations_total",
	Help:      "Private Smart Commute traffic checks by bounded outcome, without identity or location labels.",
}, []string{"reason"})

func RecordSmartCommuteTraffic(reason string) {
	switch reason {
	case "eligible", "duplicate_or_skipped", "expired_or_revoked", "quiet_hours", "not_at_origin", "provider_unqualified", "not_material_or_stale":
		smartCommuteTrafficEvaluations.WithLabelValues(reason).Inc()
	}
}

var smartPersonalPushEvents = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_personal_push_events_total",
	Help:      "Personal push outcomes without recipient, vehicle, endpoint, or location labels.",
}, []string{"outcome"})

func RecordSmartPersonalPush(outcome string) {
	switch outcome {
	case "accepted", "failed", "unknown", "claimed", "quiet_hours", "suppressed":
		smartPersonalPushEvents.WithLabelValues(outcome).Inc()
	}
}
