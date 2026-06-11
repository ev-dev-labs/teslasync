//
//  PollingEngine.Projection.swift
//  TeslaSync — P4 shared surface · 0098 · PollingEngine (Apple)
//
//  The pure projection from the input snapshot to the resolved view-state (see ViewState.swift) — the
//  native port of the web component body (the `!status.enabled → null` withdraw, the `SavingsCard`
//  four metrics + stacked breakdown bar + legend, the `VehicleActivity` rows with their expanded
//  detail + prediction, and the no-vehicles empty message) plus the P4 leaf contract. Localization is
//  applied here (P1/S10) so the view is a pure function of the result; every branch is unit tested
//  with no store and no SwiftUI.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `PollingEnginePanel` render plus the P4 leaf contract. Unit tested across disabled / loading /
/// error / ready, the savings tiles + breakdown, the vehicle rows + prediction, and the empty case.
public enum PollingProjection {
    public static func resolve(_ input: PollingInput, now: Date = Date()) -> PollingResolved {
        switch input.status {
        case .loading:
            return PollingResolved(phase: .loading, ready: nil)
        case let .failed(message):
            return PollingResolved(phase: .error(message), ready: nil)
        case let .loaded(snapshot):
            guard snapshot.enabled else { return PollingResolved(phase: .disabled, ready: nil) }
            return PollingResolved(phase: .ready, ready: ready(for: snapshot, savings: input.savings, now: now))
        }
    }

    // MARK: Ready panel (web GlassPanel body)

    private static func ready(
        for snapshot: PollingStatusSnapshot,
        savings: PollingCostSnapshot?,
        now: Date
    ) -> PollingReady {
        PollingReady(
            title: tr("polling.title", "Adaptive Polling Engine"),
            activeBadge: tr("polling.active", "Active"),
            savings: savings.map(savingsCard(for:)),
            vehiclesTitle: tr("polling.vehicleActivity", "Vehicle Activity"),
            vehicles: snapshot.vehicles.map { vehicle(for: $0, now: now) },
            emptyMessage: tr(
                "polling.empty",
                "No vehicles tracked yet. Polling engine will activate on first poll."
            )
        )
    }

    // MARK: Savings card (web `SavingsCard`)

    private static func savingsCard(for cost: PollingCostSnapshot) -> PollingSavingsVM {
        let metrics = savingsMetrics(for: cost)
        let segments = savingsSegments(for: cost)
        return PollingSavingsVM(
            metrics: metrics,
            segments: segments,
            legend: savingsLegend(hasSegments: !segments.isEmpty),
            accessibilityLabel: metrics.map(\.accessibilityLabel).joined(separator: ", ")
        )
    }

    /// The four metric tiles — the web `SavingsCard` `<AnimatedNumber/>` values with their fixed
    /// decimals + literal `$` / `%` affixes.
    private static func savingsMetrics(for cost: PollingCostSnapshot) -> [PollingMetricVM] {
        [
            metric(
                id: "pollsSaved",
                value: PollingNumber.fixed(cost.savingsPercent, decimals: 1) + "%",
                label: tr("polling.pollsSaved", "Polls Saved"),
                tone: .success
            ),
            metric(
                id: "savedAmount",
                value: "$" + PollingNumber.fixed(cost.estimatedSavings, decimals: 2),
                label: tr("polling.savedAmount", "$ Saved"),
                tone: .success
            ),
            metric(
                id: "pollsMade",
                value: PollingNumber.fixed(cost.pollsMade, decimals: 0),
                label: tr("polling.pollsMade", "Polls Made"),
                tone: .primary
            ),
            metric(
                id: "creditLeft",
                value: "$" + PollingNumber.fixed(cost.remainingCredit, decimals: 2),
                label: tr("polling.creditLeft", "Credit Left"),
                tone: .primary
            )
        ]
    }

    /// The rendered breakdown segments — the canonical-order, positive-value subset with their
    /// fraction of the full total + the "{label}: {value}" tooltip / VoiceOver string.
    private static func savingsSegments(for cost: PollingCostSnapshot) -> [PollingSegmentVM] {
        PollingBreakdown.segments(from: cost.savingsBreakdown).map { segment in
            let label = tr(segment.category.labelKey, segment.category.fallback)
            let valueText = PollingNumber.plain(segment.value)
            return PollingSegmentVM(
                id: segment.id,
                fraction: segment.fraction,
                tone: segment.category.tone,
                accessibilityLabel: "\(label): \(valueText)"
            )
        }
    }

    /// The legend — the full four-category list when the bar renders (web shows every category once
    /// `total > 0`), empty otherwise.
    private static func savingsLegend(hasSegments: Bool) -> [PollingLegendItemVM] {
        guard hasSegments else { return [] }
        return PollingBreakdownCategory.allCases.map { category in
            PollingLegendItemVM(
                id: category.rawValue,
                label: tr(category.labelKey, category.fallback),
                tone: category.tone
            )
        }
    }

    private static func metric(id: String, value: String, label: String, tone: PollingTone) -> PollingMetricVM {
        PollingMetricVM(
            id: id,
            value: value,
            label: label,
            tone: tone,
            accessibilityLabel: PollingEngineAccessibility.metricLabel(label: label, value: value)
        )
    }

    // MARK: Vehicle row (web `VehicleActivity`)

    private static func vehicle(for status: PollingVehicleStatus, now: Date) -> PollingVehicleVM {
        let vinShort = PollingVIN.short(status.vin)
        let activityWord = word(forKey: status.activity.labelKey, fallback: status.activity.raw)
        let profileWord = word(forKey: status.profile.labelKey, fallback: status.profile.fallback)
        let activityChip = "\(activityWord) · \(profileWord)"
        let nextDuration = durationText(PollingDuration.untilParts(target: status.nextPollAfter, now: now))
        let nextLabel = "\(tr("polling.nextLabel", "Next:")) \(nextDuration)"

        return PollingVehicleVM(
            id: status.vin,
            vinShort: vinShort,
            activityChip: activityChip,
            tone: status.activity.tone,
            symbolName: status.activity.symbolName,
            pulses: status.activity.pulses,
            nextLabel: nextLabel,
            detail: status.lastDecision.map { detail(for: $0, status: status) },
            accessibilityLabel: PollingEngineAccessibility.vehicleLabel(
                vin: vinShort,
                activity: activityWord,
                profile: profileWord,
                next: nextDuration
            )
        )
    }

    private static func detail(for decision: PollingDecision, status: PollingVehicleStatus) -> PollingVehicleDetailVM {
        let interval = "\(tr("polling.intervalLabel", "Interval:")) "
            + durationText(PollingDuration.decompose(milliseconds: decision.nextIntervalMs))
        let consecIdle = "\(tr("polling.consecIdleLabel", "Consecutive idle:")) \(status.consecIdle)"
        let battery = "\(tr("polling.batteryLabel", "Battery:")) \(PollingNumber.plain(status.batteryLevel))%"
        let reasons = decision.reasons.enumerated().map { offset, reason in
            PollingReasonVM(id: String(offset), text: reason)
        }
        return PollingVehicleDetailVM(
            interval: interval,
            consecIdle: consecIdle,
            battery: battery,
            reasons: reasons,
            prediction: decision.prediction.map(prediction(for:))
        )
    }

    private static func prediction(for info: PollingPrediction) -> PollingPredictionVM {
        let estimated = durationText(
            PollingDuration.decompose(milliseconds: PollingNumber.nanosToMillis(info.estimatedInNanos))
        )
        let percent = PollingNumber.roundedPercent(info.confidence)
        let summary = PollingEngineStrings.format(
            "polling.predictionSummary",
            "Prediction: %1$@ in %2$@ (%3$d%% conf)",
            info.nextState,
            estimated,
            percent
        )
        let basedOn = PollingEngineStrings.format("polling.basedOn", "Based on: %@", info.basedOn)
        return PollingPredictionVM(
            summary: summary,
            basedOn: basedOn,
            accessibilityLabel: "\(summary). \(basedOn)"
        )
    }

    // MARK: Localization helpers

    /// Resolves a known vocabulary word through its key, or returns the verbatim fallback for an
    /// unrecognised value (web `default` branches return the raw string).
    private static func word(forKey key: String?, fallback: String) -> String {
        guard let key else { return fallback }
        return tr(key, fallback)
    }

    /// Localizes a structural `PollingDurationParts` into the web display (`now` / `Ns` / `Nm` /
    /// `Nh Mm`), keeping word order translator-controlled.
    private static func durationText(_ parts: PollingDurationParts) -> String {
        switch parts {
        case .now:
            tr("polling.now", "now")
        case let .seconds(value):
            PollingEngineStrings.format("polling.durationSeconds", "%ds", value)
        case let .minutes(value):
            PollingEngineStrings.format("polling.durationMinutes", "%dm", value)
        case let .hoursMinutes(hours, minutes):
            PollingEngineStrings.format("polling.durationHoursMinutes", "%1$dh %2$dm", hours, minutes)
        }
    }

    private static func tr(_ key: String, _ fallback: String) -> String {
        PollingEngineStrings.string(key, fallback)
    }
}
