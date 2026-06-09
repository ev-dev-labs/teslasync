//
//  ChargingOptimizerWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0022 · ChargingOptimizerWidget (Apple)
//
//  Pure formatters + projection builder — the unit-tested cached→projection
//  adapter, a faithful Swift port of the data pipeline in
//  features/dashboard/widgets/ChargingOptimizerWidget.tsx (the `formatHour`
//  clock label, the `fmtInt` / `fmtNumber` formatters, the defensive
//  `?? 0` / `?? []` reads, the `peakPct < 30` schedule-match test, the 24-hour
//  rate-timeline cells, and the recommendation→tip mapping). No SwiftUI /
//  transport here — this is the deterministic core every platform agrees on.
//

import Foundation

/// Resolves an i18n key to its localized string (web `t(key, default)`). Injected
/// so the adapter stays free of the SwiftUI localization facade and is testable
/// against the English fallbacks.
public typealias ChargingOptimizerLocalize = (_ key: String, _ fallback: String) -> String

/// Pure adapters that fold the cached optimizer payload into a
/// `ChargingOptimizerProjection`. Mirrors the web source exactly so every
/// platform renders the same metrics, schedule chip, timeline, and tips.
public enum ChargingOptimizerProjectionBuilder {
    /// The em dash the web uses for every missing recommendation field (`?? '—'`).
    static let emDash = "—"
    /// Non-localized percent symbol — the web literal `%`.
    static let percentSymbol = "%"
    /// The schedule is "optimized" below this peak-usage share (web `peakPct < 30`).
    static let optimalPeakThreshold = 30.0

    // MARK: Clock label (web `formatHour`)

    /// Web `formatHour(hour)` — a 12-hour clock label with an `AM` / `PM`
    /// suffix. `0` and `24` render as `12 AM`, `12` as `12 PM`. These are
    /// formatting literals (the web does not localize them, like `%`).
    public static func formatHour(_ hour: Int) -> String {
        if hour == 0 || hour == 24 { return "12 AM" }
        if hour == 12 { return "12 PM" }
        return hour < 12 ? "\(hour) AM" : "\(hour - 12) PM"
    }

    // MARK: Number formatting (web `fmtNumber` / `fmtInt`)

    /// Locale-grouped decimal with a fixed number of fraction digits — the web
    /// `fmtNumber(value, decimals)` (`toLocaleString` with min == max fraction
    /// digits over `safeNumber`). Ties round half away from zero and non-finite
    /// input collapses to `0`, matching the JS `safeNumber` guard.
    public static func decimal(_ value: Double, fractionDigits: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.roundingMode = .halfUp
        formatter.minimumFractionDigits = max(0, fractionDigits)
        formatter.maximumFractionDigits = max(0, fractionDigits)
        formatter.usesGroupingSeparator = true
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe))
            ?? String(format: "%.\(max(0, fractionDigits))f", safe)
    }

    /// Web `fmtInt(value)` — `fmtNumber(value, 0)`, a grouped integer.
    public static func intText(_ value: Double, locale: Locale) -> String {
        decimal(value, fractionDigits: 0, locale: locale)
    }

    // MARK: Token interpolation (web i18next `{{token}}`)

    /// Replaces `{{token}}` occurrences in a localized template, mirroring the
    /// web `t(key, { pct, amount })` interpolation so the catalog values stay
    /// byte-identical to the web English fallbacks.
    static func interpolate(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }

    // MARK: Tone maps (web schedule badge + `impactBadgeMap`)

    /// Maps a recommendation priority to its impact tone — faithful to the web
    /// `PRIORITY_IMPACT` + `impactBadgeMap` (`high`→success, `medium`→warning,
    /// `low`→neutral). An unknown / missing priority yields `nil` so no impact
    /// chip renders (web `?? undefined`).
    public static func tone(forPriority priority: String?) -> ChargingOptimizerTone? {
        switch priority {
        case "high":
            .success
        case "medium":
            .warning
        case "low":
            .neutral
        default:
            nil
        }
    }

    // MARK: Rate-timeline cell classification (web per-cell branch)

    /// Web per-cell rate classification: `peak` when the hour is in `peak_hours`,
    /// else `offpeak` when it is in `offpeak_hours`, else `standard`. Peak wins a
    /// tie, matching the web `title` ternary (`isPeak ? … : isOffpeak ? … : …`).
    public static func slotKind(
        hour: Int,
        peakHours: [Int],
        offpeakHours: [Int]
    ) -> ChargingOptimizerSlotKind {
        if peakHours.contains(hour) { return .peak }
        if offpeakHours.contains(hour) { return .offpeak }
        return .standard
    }

    /// Localized label for a timeline cell's rate kind (web `Peak` / `Off-peak` /
    /// `Standard`).
    static func slotLabel(_ kind: ChargingOptimizerSlotKind, localize: ChargingOptimizerLocalize) -> String {
        switch kind {
        case .peak:
            localize("widget.chargingOptimizer.peak", "Peak")
        case .offpeak:
            localize("widget.chargingOptimizer.offpeak", "Off-peak")
        case .standard:
            localize("widget.chargingOptimizer.standard", "Standard")
        }
    }

    /// Builds the 24 hour cells of the wide-mode rate timeline (web
    /// `Array.from({length: 24})` map).
    static func buildTimeline(
        optimalStartHour: Int,
        peakHours: [Int],
        offpeakHours: [Int],
        localize: ChargingOptimizerLocalize
    ) -> [ChargingOptimizerHourSlot] {
        (0 ..< 24).map { hour in
            let kind = slotKind(hour: hour, peakHours: peakHours, offpeakHours: offpeakHours)
            return ChargingOptimizerHourSlot(
                id: hour,
                kind: kind,
                isOptimalStart: hour == optimalStartHour,
                hourText: formatHour(hour),
                kindLabel: slotLabel(kind, localize: localize)
            )
        }
    }

    /// The five evenly-spaced axis labels under the timeline — `formatHour` at
    /// hours 0 / 6 / 12 / 18 / 24 (web `12 AM`, `6 AM`, `12 PM`, `6 PM`, `12 AM`).
    static let timelineAxisHours = [0, 6, 12, 18, 24]

    // MARK: Tips (web `recommendations.map(...)`)

    /// Builds the recommendation tip cards (web `tips`): the `?? '—'` title /
    /// detail fallbacks, the impact tone, and the localized impact label (only
    /// when the priority resolves to a tone, matching the web render guard).
    static func buildTips(
        _ recommendations: [ChargingOptimizerRecommendationInput],
        localize: ChargingOptimizerLocalize
    ) -> [ChargingOptimizerTip] {
        recommendations.enumerated().map { index, rec in
            let impact = tone(forPriority: rec.priority)
            let impactLabel: String? = impact != nil
                ? localize("widget.chargingOptimizer.priority.\(rec.priority ?? "")", rec.priority ?? "")
                : nil
            return ChargingOptimizerTip(
                id: index,
                title: rec.title ?? emDash,
                detail: rec.detail ?? emDash,
                impact: impact,
                impactLabel: impactLabel
            )
        }
    }

    // MARK: Projection

    /// Builds the full projection from the cached optimizer payload, faithful to
    /// the web `ChargingOptimizerWidget` body. A `nil` payload yields `.empty`
    /// (the web `!data` top-level empty state); a present payload renders the
    /// content body with the web defensive `?? 0` / `?? []` reads.
    public static func build(
        data: ChargingOptimizerInput?,
        format: ChargingOptimizerFormatting,
        localize: ChargingOptimizerLocalize
    ) -> ChargingOptimizerProjection {
        guard let data else { return .empty }

        let optimalStartHour = data.schedule?.mostCommonStartHour ?? 0
        let targetSoc = data.schedule?.avgChargeToPct ?? 0
        let monthlySavings = data.cost?.potentialMonthlySavings ?? 0
        let peakPct = data.cost?.sessionsDuringPeakPct ?? 0
        let peakHours = data.cost?.peakHours ?? []
        let offpeakHours = data.cost?.offpeakHours ?? []
        let matchesOptimal = peakPct < optimalPeakThreshold

        let savingsAmount = decimal(monthlySavings, fractionDigits: 0, locale: format.locale)
        let targetSocInt = intText(targetSoc, locale: format.locale)

        let savingsShortText: String? = monthlySavings > 0
            ? interpolate(
                localize("widget.chargingOptimizer.savingsShort", "${{amount}}/mo"),
                ["amount": savingsAmount]
            )
            : nil

        return ChargingOptimizerProjection(
            hasData: true,
            optimalStartHour: optimalStartHour,
            optimalStartText: formatHour(optimalStartHour),
            targetSocText: "\(targetSocInt)\(percentSymbol)",
            targetSocShortText: interpolate(
                localize("widget.chargingOptimizer.targetSocShort", "SOC {{pct}}%"),
                ["pct": targetSocInt]
            ),
            savingsText: "\(format.currencySymbol)\(savingsAmount)",
            savingsShortText: savingsShortText,
            monthlySavings: monthlySavings,
            peakUsageText: interpolate(
                localize("widget.chargingOptimizer.peakUsage", "Peak charging: {{pct}}%"),
                ["pct": intText(peakPct, locale: format.locale)]
            ),
            scheduleMatchesOptimal: matchesOptimal,
            scheduleBadgeText: matchesOptimal
                ? localize("widget.chargingOptimizer.optimized", "Optimized")
                : localize("widget.chargingOptimizer.canImprove", "Can improve"),
            scheduleBadgeTone: matchesOptimal ? .success : .warning,
            timeline: buildTimeline(
                optimalStartHour: optimalStartHour,
                peakHours: peakHours,
                offpeakHours: offpeakHours,
                localize: localize
            ),
            timelineAxisLabels: timelineAxisHours.map(formatHour),
            tips: buildTips(data.recommendations, localize: localize)
        )
    }
}
