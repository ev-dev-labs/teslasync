package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	"github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var climateScheduleChecks = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_climate_schedule_checks_total",
	Help:      "Private scheduled climate evaluations without subject, schedule, or vehicle labels.",
}, []string{"outcome"})

var parkReserveChecks = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_park_reserve_checks_total",
	Help:      "Private parked reserve decisions and explicit consent changes without identifying labels.",
}, []string{"outcome"})

var overnightDrainChecks = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_overnight_drain_checks_total",
	Help:      "Private overnight drain reviews and explicit responses without identifying labels.",
}, []string{"outcome"})

var capacityDigestChecks = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_capacity_digest_checks_total",
	Help:      "Private monthly battery digest evaluations and responses without identifying labels.",
}, []string{"outcome"})

var windowRainChecks = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_window_rain_checks_total",
	Help:      "Private window rain checks and delivery outcomes without identifying labels.",
}, []string{"outcome"})

func RecordWindowRain(outcome string, count int) {
	if count <= 0 {
		return
	}
	switch outcome {
	case "confirmed", "paused", "cleared", "accepted", "failed", "unknown", "claimed", "quiet_hours", "suppressed",
		string(smartreadiness.WindowRainUnknownState), string(smartreadiness.WindowRainMoved),
		string(smartreadiness.WindowRainNoOpenWindow), string(smartreadiness.WindowRainNoForecast),
		string(smartreadiness.WindowRainDry), string(smartreadiness.WindowRainAtRisk):
		windowRainChecks.WithLabelValues(outcome).Add(float64(count))
	}
}

var parkedClosureChecks = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_parked_closure_checks_total",
	Help:      "Private parked closure checks and delivery outcomes without identifying labels.",
}, []string{"outcome"})

func RecordParkedClosure(outcome string, count int) {
	if count <= 0 {
		return
	}
	switch outcome {
	case "confirmed", "paused", "snoozed", "cleared", "accepted", "failed", "unknown", "claimed", "quiet_hours", "suppressed",
		string(smartreadiness.ClosureUnknown), string(smartreadiness.ClosureActive), string(smartreadiness.ClosureClosed),
		string(smartreadiness.ClosureGrace), string(smartreadiness.ClosureAtRisk):
		parkedClosureChecks.WithLabelValues(outcome).Add(float64(count))
	}
}

var parkedUnlockChecks = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_parked_unlock_checks_total",
	Help:      "Private parked unlock checks and delivery outcomes without identifying labels.",
}, []string{"outcome"})

var softwareWindowChecks = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_software_window_checks_total",
	Help:      "Private software update window evaluations and consent actions without identifying labels.",
}, []string{"outcome"})

func RecordSoftwareWindow(outcome string) {
	switch outcome {
	case "confirmed", "paused", "snoozed", "cleared",
		string(smartreadiness.SoftwareWindowNoEvidence), string(smartreadiness.SoftwareWindowNotReady),
		string(smartreadiness.SoftwareWindowNotIdle), string(smartreadiness.SoftwareWindowTooShort),
		string(smartreadiness.SoftwareWindowHeld), string(smartreadiness.SoftwareWindowExpired),
		string(smartreadiness.SoftwareWindowFits):
		softwareWindowChecks.WithLabelValues(outcome).Inc()
	}
}

var privatePlaylistOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_private_playlist_outcomes_total",
	Help:      "Private playlist review outcomes without track, listener, or vehicle identity.",
}, []string{"outcome"})

func RecordPrivatePlaylist(outcome string) {
	switch outcome {
	case "previewed", "pause", "snooze", "cleared", "saved", "rejected", "created_only", "unknown", "track_unverified":
		privatePlaylistOutcomes.WithLabelValues(outcome).Inc()
	}
}

var journeySoundtrackOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_journey_soundtrack_outcomes_total",
	Help:      "Private journey soundtrack review outcomes without track, listener, or vehicle identity.",
}, []string{"outcome"})

func RecordJourneySoundtrack(outcome string) {
	switch outcome {
	case "confirmed", "pause", "snooze", "cleared", "off", "journey_unmatched", "journey_changed",
		"expired", "held", "missing_evidence", "evidence_limit", "observed":
		journeySoundtrackOutcomes.WithLabelValues(outcome).Inc()
	}
}

var driveTrackOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_drive_track_outcomes_total",
	Help:      "Private historical track lookup and explicit library save outcomes.",
}, []string{"outcome"})

func RecordDriveTrack(outcome string) {
	switch outcome {
	case "confirmed", "cleared", "off", "drive_unmatched", "drive_changed", "expired", "missing_evidence",
		"evidence_limit", "observed", "track_unverified", "saved", "rejected", "unknown":
		driveTrackOutcomes.WithLabelValues(outcome).Inc()
	}
}

var episodeReviewOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_episode_review_outcomes_total",
	Help:      "Private episode fit reads and explicit review actions, not notifications or playback.",
}, []string{"method", "route", "status_class", "outcome"})

func RecordEpisodeReview(outcome string) {
	method, route := "GET", "/api/v1/media/episode-review"
	switch outcome {
	case "off", "expired", "awaiting_progress", "drive_unmatched", "unknown_progress", "completed", "not_fit", "fits":
	case "confirmed_manual", "authorized_progress_requested":
		method = "PUT"
	case "cleared":
		method = "DELETE"
	case "progress_received", "progress_not_received":
		episodeReviewOutcomes.WithLabelValues(method, "/api/v1/media/spotify/callback", "3xx", outcome).Inc()
		return
	default:
		return
	}
	episodeReviewOutcomes.WithLabelValues(method, route, "2xx", outcome).Inc()
}

var favoriteDigestOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_favorite_digest_outcomes_total",
	Help:      "Private weekly favorite shortlist publications, suppressions, and explicit local choices.",
}, []string{"outcome"})

func RecordFavoriteDigest(outcome string, count int) {
	if count <= 0 {
		return
	}
	switch outcome {
	case "enabled", "paused", "cleared", "confirm", "remove", "dismiss", "checked", "published_in_app", "not_qualified", "evidence_limit":
		favoriteDigestOutcomes.WithLabelValues(outcome).Add(float64(count))
	}
}

var invoiceVarianceOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_invoice_variance_outcomes_total",
	Help:      "Private invoice consent changes and comparison results served, not disputes or recovered money.",
}, []string{"method", "route", "status_class", "outcome"})

func RecordInvoiceVariance(outcome string) {
	switch outcome {
	case "imported":
		invoiceVarianceOutcomes.WithLabelValues("POST", "/api/v1/charging-reconciliation/invoices", "2xx", outcome).Inc()
	case "review", "no_material_difference", "insufficient", "handled":
		invoiceVarianceOutcomes.WithLabelValues("GET", "/api/v1/charging-reconciliation/invoices/{id}/report", "2xx", outcome).Inc()
	case "edited":
		invoiceVarianceOutcomes.WithLabelValues("PUT", "/api/v1/charging-reconciliation/invoices/{id}/review", "2xx", outcome).Inc()
	case "cleared":
		invoiceVarianceOutcomes.WithLabelValues("DELETE", "/api/v1/charging-reconciliation/invoices/{id}/review", "2xx", outcome).Inc()
	}
}

var chargingCostDigestOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_charging_cost_digest_outcomes_total",
	Help:      "Private monthly charging cost review lifecycle and evidence outcomes.",
}, []string{"method", "route", "status_class", "outcome"})

func RecordChargingCostDigest(outcome string, count int) {
	if count <= 0 {
		return
	}
	var method, status string
	switch outcome {
	case "confirmed", "paused":
		method, status = "PUT", "2xx"
	case "dismissed":
		method, status = "PATCH", "2xx"
	case "cleared":
		method, status = "DELETE", "2xx"
	case "comparable_change", "insufficient_coverage", "below_material_threshold", "published_in_app":
		method, status = "BACKGROUND", "evaluated"
	default:
		return
	}
	chargingCostDigestOutcomes.WithLabelValues(method, "/api/v1/analytics/tco/charging-cost-digest", status, outcome).Add(float64(count))
}

var monthlyTariffOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_monthly_tariff_review_outcomes_total",
	Help:      "Private monthly tariff review lifecycle and evidence outcomes.",
}, []string{"method", "route", "status_class", "outcome"})

func RecordMonthlyTariffReview(outcome string, count int) {
	if count <= 0 {
		return
	}
	var method, status string
	switch outcome {
	case "confirmed", "paused":
		method, status = "PUT", "2xx"
	case "dismissed":
		method, status = "PATCH", "2xx"
	case "cleared":
		method, status = "DELETE", "2xx"
	case "material_savings", "insufficient_evidence", "unsupported_tariff", "terms_do_not_match", "below_minimum", "published_in_app":
		method, status = "BACKGROUND", "evaluated"
	default:
		return
	}
	monthlyTariffOutcomes.WithLabelValues(method, "/api/v1/tariff-lab/monthly-review", status, outcome).Add(float64(count))
}

var mileageTermReviewOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_mileage_term_review_outcomes_total",
	Help:      "Private monthly mileage review lifecycle and evidence outcomes.",
}, []string{"method", "route", "status_class", "outcome"})

func RecordMileageTermReview(outcome string, count int) {
	if count <= 0 {
		return
	}
	var method, status string
	switch outcome {
	case "confirmed", "paused":
		method, status = "PUT", "2xx"
	case "dismissed":
		method, status = "PATCH", "2xx"
	case "cleared":
		method, status = "DELETE", "2xx"
	case "not_actionable", "insufficient_evidence", "conflicting_evidence", "not_material", "off_pace", "published_in_app":
		method, status = "BACKGROUND", "evaluated"
	default:
		return
	}
	mileageTermReviewOutcomes.WithLabelValues(method, "/api/v1/analytics/mileage-budget/review", status, outcome).Add(float64(count))
}

var tripPacketOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_trip_packet_outcomes_total",
	Help:      "Private monthly trip packet lifecycle and evidence outcomes.",
}, []string{"method", "route", "status_class", "outcome"})

func RecordTripPacket(outcome string, count int) {
	if count <= 0 {
		return
	}
	var method, status string
	switch outcome {
	case "confirmed", "paused":
		method, status = "PUT", "2xx"
	case "entry_saved", "dismissed":
		method, status = "PATCH", "2xx"
	case "exported":
		method, status = "POST", "2xx"
	case "cleared":
		method, status = "DELETE", "2xx"
	case "ready", "no_business_tags", "missing_business_evidence", "uncertain_coverage", "published_in_app":
		method, status = "BACKGROUND", "evaluated"
	default:
		return
	}
	tripPacketOutcomes.WithLabelValues(method, "/api/v1/ownership/trip-packet", status, outcome).Add(float64(count))
}

var subscriptionRenewalOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_subscription_renewal_outcomes_total",
	Help:      "Private subscription renewal review lifecycle and scheduling outcomes.",
}, []string{"method", "route", "status_class", "outcome"})

func RecordSubscriptionRenewal(outcome string, count int) {
	if count <= 0 {
		return
	}
	var method, status string
	switch outcome {
	case "confirmed", "paused":
		method, status = "PUT", "2xx"
	case "dismissed":
		method, status = "PATCH", "2xx"
	case "cleared":
		method, status = "DELETE", "2xx"
	case "ready", "not_due", "expired", "ineligible_terms", "published_in_app":
		method, status = "BACKGROUND", "evaluated"
	default:
		return
	}
	subscriptionRenewalOutcomes.WithLabelValues(method, "/api/v1/subscription-roi/renewal", status, outcome).Add(float64(count))
}

var weeklyDriveEfficiencyOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_weekly_drive_efficiency_outcomes_total",
	Help:      "Private weekly drive efficiency settings and comparison decisions.",
}, []string{"method", "route", "status_class", "outcome"})

func RecordWeeklyDriveEfficiency(outcome string, count int) {
	if count <= 0 {
		return
	}
	var method, status string
	switch outcome {
	case "confirmed", "paused":
		method, status = "PUT", "2xx"
	case "dismissed":
		method, status = "PATCH", "2xx"
	case "cleared":
		method, status = "DELETE", "2xx"
	case "insufficient_comparable_coverage", "within_observed_variation", "material_sustained_change",
		"review_window_passed", "lease_revoked", "published_in_app":
		method, status = "BACKGROUND", "evaluated"
	default:
		return
	}
	weeklyDriveEfficiencyOutcomes.WithLabelValues(method, "/api/v1/analytics/route-efficiency/weekly-digest", status, outcome).Add(float64(count))
}

func RecordParkedUnlock(outcome string, count int) {
	if count <= 0 {
		return
	}
	switch outcome {
	case "confirmed", "paused", "snoozed", "cleared", "accepted", "failed", "unknown", "claimed", "quiet_hours", "suppressed",
		string(smartreadiness.UnlockPlaceChanged), string(smartreadiness.UnlockUnknown), string(smartreadiness.UnlockOutsidePlace),
		string(smartreadiness.UnlockLocked), string(smartreadiness.UnlockGrace), string(smartreadiness.UnlockAtRisk):
		parkedUnlockChecks.WithLabelValues(outcome).Add(float64(count))
	}
}

func RecordCapacityDigest(outcome string, count int) {
	if count <= 0 {
		return
	}
	switch outcome {
	case "confirmed", "paused", "cleared", "published_in_app", "dismissed",
		string(smartreadiness.CapacityTrendSparse), string(smartreadiness.CapacityTrendWithin), string(smartreadiness.CapacityTrendChanged):
		capacityDigestChecks.WithLabelValues(outcome).Add(float64(count))
	}
}

func RecordOvernightDrain(outcome string, count int) {
	if count <= 0 {
		return
	}
	switch outcome {
	case "confirmed", "paused", "cleared", "published_in_app", "dismissed",
		string(smartreadiness.OvernightMissingEvidence), string(smartreadiness.OvernightInsufficientNights),
		string(smartreadiness.OvernightWithinUsualRange), string(smartreadiness.OvernightNoObservedFactors),
		string(smartreadiness.OvernightAboveUsualRange):
		overnightDrainChecks.WithLabelValues(outcome).Add(float64(count))
	}
}

func RecordParkReserve(outcome string, count int) {
	switch outcome {
	case "confirmed", "cleared",
		string(smartreadiness.ParkReserveInvalidPlan), string(smartreadiness.ParkReserveUnknownState),
		string(smartreadiness.ParkReserveInsufficient), string(smartreadiness.ParkReserveAbove),
		string(smartreadiness.ParkReserveAlreadyLow), string(smartreadiness.ParkReserveAtRisk),
		string(smartreadiness.ParkReserveChanged), string(smartreadiness.ParkReserveExpired):
		parkReserveChecks.WithLabelValues(outcome).Add(float64(count))
	}
}

var climateScheduleLifecycle = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_climate_schedule_lifecycle_total",
	Help:      "Private in-app schedule review publications and explicit responses, not schedule edits.",
}, []string{"outcome"})

func RecordClimateScheduleChecks(matched, quiet, changed int) {
	climateScheduleChecks.WithLabelValues("eligible").Add(float64(matched))
	climateScheduleChecks.WithLabelValues("insufficient_evidence").Add(float64(quiet))
	climateScheduleChecks.WithLabelValues("scope_changed").Add(float64(changed))
}

func RecordClimateSchedulePublications(count int) {
	if count > 0 {
		climateScheduleLifecycle.WithLabelValues("published_to_inbox").Add(float64(count))
	}
}

func RecordClimateScheduleAction(action actioncenter.ActionType) {
	switch action {
	case actioncenter.ActionDismiss:
		climateScheduleLifecycle.WithLabelValues("dismissed").Inc()
	case actioncenter.ActionAcknowledge:
		climateScheduleLifecycle.WithLabelValues("explicitly_acknowledged").Inc()
	}
}

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
	case "eligible", "duplicate_or_skipped", "expired_or_revoked", "quiet_hours", "not_at_origin", "provider_unqualified", "upstream_paused", "not_material_or_stale":
		smartCommuteTrafficEvaluations.WithLabelValues(reason).Inc()
	}
}

var smartCommuteNavigationOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_commute_navigation_outcomes_total",
	Help:      "Fenced Smart Commute navigation attempts by outcome, without identity or destination labels.",
}, []string{"outcome"})

func RecordSmartCommuteNavigationOutcome(outcome smartcommute.NavigationOutcome) {
	switch outcome {
	case smartcommute.NavigationAccepted, smartcommute.NavigationRejected, smartcommute.NavigationUnknown,
		smartcommute.NavigationExpired, smartcommute.NavigationNotSent:
		smartCommuteNavigationOutcomes.WithLabelValues(string(outcome)).Inc()
	}
}

var smartCommuteSuggestionResolutions = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_commute_suggestion_resolutions_total",
	Help:      "Saved confirmations and dismissals of Smart Commute suggestions, without identity or location labels.",
}, []string{"outcome"})

func RecordSmartCommuteSuggestionResolution(outcome smartcommute.RoutineStatus) {
	switch outcome {
	case smartcommute.RoutineConfirmed, smartcommute.RoutineDeclined:
		smartCommuteSuggestionResolutions.WithLabelValues(string(outcome)).Inc()
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

var smartTripStopEvents = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_trip_stop_events_total",
	Help:      "Private trip stop check and disconnect outcomes without plan, subject, vehicle, or place labels.",
}, []string{"outcome"})

func RecordSmartTripStop(outcome string) {
	switch outcome {
	case "disconnect_completed", "connector_disabled", "setup_missing_or_stale", "cooldown",
		"check_claimed", "scope_invalidated", "insufficient_history", "eligible", "provider_unqualified",
		"no_comparison", "comparison_ready":
		smartTripStopEvents.WithLabelValues(outcome).Inc()
	}
}

var warrantyReminderChecks = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_warranty_reminder_checks_total",
	Help:      "Private warranty projection checks by outcome, without subject, warranty or vehicle labels.",
}, []string{"outcome"})

func RecordWarrantyReminderCheck(outcome ownershipintel.WarrantyReminderOutcome, count int) {
	switch outcome {
	case ownershipintel.WarrantyEligible, ownershipintel.WarrantyInvalidTerm, ownershipintel.WarrantyInsufficientEvidence,
		ownershipintel.WarrantyStaleEvidence, ownershipintel.WarrantyInconsistentEvidence, ownershipintel.WarrantyLimitReached,
		ownershipintel.WarrantyCalendarFirst, ownershipintel.WarrantyNotActionable, ownershipintel.WarrantyClaimInvalidated:
		warrantyReminderChecks.WithLabelValues(string(outcome)).Add(float64(count))
	}
}

var warrantyReminderLifecycle = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_warranty_reminder_lifecycle_total",
	Help:      "Private in-app warranty publications and explicit outcomes, not coverage or user benefit.",
}, []string{"outcome"})

func RecordWarrantyReminderPublication(count int) {
	if count > 0 {
		warrantyReminderLifecycle.WithLabelValues("published_to_inbox").Add(float64(count))
	}
}

func RecordWarrantyReminderAction(action actioncenter.ActionType) {
	switch action {
	case actioncenter.ActionDismiss:
		warrantyReminderLifecycle.WithLabelValues("dismissed").Inc()
	case actioncenter.ActionAcknowledge:
		warrantyReminderLifecycle.WithLabelValues("explicitly_acknowledged").Inc()
	}
}

var tripMaintenanceChecks = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_trip_maintenance_checks_total",
	Help:      "Private trip maintenance checks by outcome without plan, subject or vehicle labels.",
}, []string{"outcome"})

func RecordTripMaintenanceCheck(reason smartreadiness.TripMaintenanceReason, count int) {
	switch reason {
	case smartreadiness.TripMaintenanceEligible, smartreadiness.TripMaintenancePlanUnavailable, smartreadiness.TripMaintenanceSetupInvalid,
		smartreadiness.TripMaintenanceOutsideWindow, smartreadiness.TripMaintenanceUnknownOdometer,
		smartreadiness.TripMaintenanceAlreadyDue, smartreadiness.TripMaintenanceBelowInterval:
		tripMaintenanceChecks.WithLabelValues(string(reason)).Add(float64(count))
	}
}

var tripMaintenanceLifecycle = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_trip_maintenance_lifecycle_total",
	Help:      "Private in-app maintenance publications and explicit outcomes, not completed service.",
}, []string{"outcome"})

func RecordTripMaintenancePublication(count int) {
	if count > 0 {
		tripMaintenanceLifecycle.WithLabelValues("published_to_inbox").Add(float64(count))
	}
}

func RecordTripMaintenanceAction(action actioncenter.ActionType) {
	switch action {
	case actioncenter.ActionDismiss:
		tripMaintenanceLifecycle.WithLabelValues("dismissed").Inc()
	case actioncenter.ActionAcknowledge:
		tripMaintenanceLifecycle.WithLabelValues("explicitly_acknowledged").Inc()
	}
}

var coldTireChecks = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_cold_tire_checks_total",
	Help:      "Checks of private gauge readings by result, without identity or wheel labels.",
}, []string{"outcome"})

var coldTireLifecycle = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_cold_tire_lifecycle_total",
	Help:      "Private in-app cold-tire decisions and explicit responses, not confirmed service.",
}, []string{"outcome"})

func RecordColdTireCheck(reason smartreadiness.ColdTireDriftReason, published bool) {
	switch reason {
	case smartreadiness.ColdTireDriftEligible, smartreadiness.ColdTireDriftNoRecentReading, smartreadiness.ColdTireDriftInsufficientEvidence,
		smartreadiness.ColdTireDriftInvalidReading, smartreadiness.ColdTireDriftNoRepeatedDrift:
		coldTireChecks.WithLabelValues(string(reason)).Inc()
	}
	if published {
		coldTireLifecycle.WithLabelValues("published_to_inbox").Inc()
	}
}

func RecordColdTireAction(action actioncenter.ActionType) {
	switch action {
	case actioncenter.ActionDismiss:
		coldTireLifecycle.WithLabelValues("dismissed").Inc()
	case actioncenter.ActionAcknowledge:
		coldTireLifecycle.WithLabelValues("explicitly_acknowledged").Inc()
	}
}

var recallWatchChecks = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_recall_watch_checks_total",
	Help:      "Private recall watch checks by outcome, without subject, campaign or model labels.",
}, []string{"outcome"})

var recallWatchLifecycle = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_recall_watch_lifecycle_total",
	Help:      "Private inbox publications and explicit responses, not confirmed VIN eligibility or remedy.",
}, []string{"outcome"})

func RecordRecallWatchCheck(outcome smartreadiness.RecallWatchOutcome, count int) {
	switch outcome {
	case smartreadiness.RecallWatchMatched, smartreadiness.RecallWatchNoMatch,
		smartreadiness.RecallWatchUnavailable, smartreadiness.RecallWatchChanged:
		recallWatchChecks.WithLabelValues(string(outcome)).Add(float64(count))
	}
}

func RecordRecallWatchPublication(count int) {
	if count > 0 {
		recallWatchLifecycle.WithLabelValues("published_to_inbox").Add(float64(count))
	}
}

func RecordRecallWatchAction(action actioncenter.ActionType) {
	switch action {
	case actioncenter.ActionDismiss:
		recallWatchLifecycle.WithLabelValues("dismissed").Inc()
	case actioncenter.ActionAcknowledge:
		recallWatchLifecycle.WithLabelValues("explicitly_acknowledged").Inc()
	}
}

var serviceCaseEvents = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_service_case_events_total",
	Help:      "Private case review events without case, evidence, vehicle or subject labels. Serving a file does not imply sharing.",
}, []string{"outcome"})

func RecordServiceCaseEvent(outcome string) {
	switch outcome {
	case "no_case", "no_notes", "card_eligible", "card_served", "card_dismissed", "card_acknowledged",
		"preview_ready", "selection_rejected", "case_changed", "download_served":
		serviceCaseEvents.WithLabelValues(outcome).Inc()
	}
}

var cabinPrepLifecycle = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Name:      "smart_cabin_prep_lifecycle_total",
	Help:      "Private cabin reminder decisions and explicit consent changes, without subject or vehicle labels.",
}, []string{"outcome"})

func RecordCabinPrepLifecycle(outcome string, count int) {
	switch outcome {
	case "confirmed", "cleared", "eligible", "invalid_plan", "unknown_state", "already_active", "within_comfort_band",
		"insufficient_comparable_mornings", "variable_prep_time", "departure_observed", "changed_conditions", "expired":
		if count > 0 {
			cabinPrepLifecycle.WithLabelValues(outcome).Add(float64(count))
		}
	}
}
