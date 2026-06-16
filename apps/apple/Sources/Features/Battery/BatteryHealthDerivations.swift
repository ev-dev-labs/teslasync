import Foundation

// Pure derivations for the Battery Health surface — direct ports of every web `useMemo`
// in `BatteryHealthPage.tsx` (insights, recommendations, the capacity-trend projection
// series, the range trend, the charge-level distribution, the charging-habit ratios, the
// AC/DC energy breakdown, and the new-vs-now comparison). Every value stays SI
// (kilometres, watt-hours, percent) — the view converts at the render boundary (ADR-005).
// The derived output types live in `BatteryHealthDerivedTypes.swift`.

public enum BatteryHealthDerivations {
    // MARK: Insights (web `buildInsights`)

    /// Web `buildInsights(health, sessions, t)` — SOH band, fast-charge habit, deep-discharge
    /// + Supercharger warnings (when sessions are loaded), and the low-degradation note.
    public static func insights(
        analytics: BatteryHealthAnalytics,
        sessions: [BatteryHealthChargingSession]?,
        prefs: UnitPreferences
    ) -> [BatteryHealthInsight] {
        var items: [BatteryHealthInsight] = [sohInsight(analytics), fastChargeInsight(analytics, prefs: prefs)]
        if let sessions { items.append(contentsOf: sessionInsights(sessions)) }
        if let low = lowDegradationInsight(analytics) { items.append(low) }
        return items
    }

    /// Web SOH band: ≥ 90 Excellent (good), ≥ 70 Good (warning), else Concern (critical).
    private static func sohInsight(_ analytics: BatteryHealthAnalytics) -> BatteryHealthInsight {
        let soh = BatteryHealthFormat.number(analytics.currentSoh, decimals: 0)
        if analytics.currentSoh >= 90 {
            return BatteryHealthInsight(
                id: "soh", titleKey: "battery.insight.excellentTitle",
                detail: BatteryHealthStrings.insightExcellent(soh: soh),
                severity: .success, systemImage: "checkmark.circle.fill"
            )
        }
        if analytics.currentSoh >= 70 {
            return BatteryHealthInsight(
                id: "soh", titleKey: "battery.insight.goodTitle",
                detail: BatteryHealthStrings.insightGood(soh: soh),
                severity: .warning, systemImage: "info.circle.fill"
            )
        }
        return BatteryHealthInsight(
            id: "soh", titleKey: "battery.insight.concernTitle",
            detail: BatteryHealthStrings.insightConcern(soh: soh),
            severity: .danger, systemImage: "exclamationmark.triangle.fill"
        )
    }

    /// Web fast-charge habit: > 50 % high-fast-charge warning, else good-habits note.
    private static func fastChargeInsight(
        _ analytics: BatteryHealthAnalytics,
        prefs: UnitPreferences
    ) -> BatteryHealthInsight {
        if analytics.fastChargePct > 50 {
            return BatteryHealthInsight(
                id: "fast-charge", titleKey: "battery.insight.highFastChargeTitle",
                detail: BatteryHealthStrings.insightHighFastCharge(
                    pct: BatteryHealthFormat.percent(analytics.fastChargePct, prefs)
                ),
                severity: .warning, systemImage: "exclamationmark.triangle.fill"
            )
        }
        return BatteryHealthInsight(
            id: "fast-charge", titleKey: "battery.insight.goodHabitsTitle",
            detail: String(localized: "battery.insight.goodHabitsDesc"),
            severity: .success, systemImage: "checkmark.circle.fill"
        )
    }

    /// Web session-derived warnings: deep discharges (> 3 below 10 %) and high Supercharger
    /// usage (> 60 % of sessions).
    private static func sessionInsights(_ sessions: [BatteryHealthChargingSession]) -> [BatteryHealthInsight] {
        var items: [BatteryHealthInsight] = []
        let deepDischarges = sessions.filter { $0.startSocPct < 10 }.count
        if deepDischarges > 3 {
            items.append(BatteryHealthInsight(
                id: "deep-discharge", titleKey: "battery.insight.deepDischargeTitle",
                detail: BatteryHealthStrings.insightDeepDischarge(count: deepDischarges),
                severity: .warning, systemImage: "exclamationmark.triangle.fill"
            ))
        }
        let superchargerCount = sessions.filter(\.isSupercharger).count
        if Double(superchargerCount) > Double(sessions.count) * 0.6 {
            items.append(BatteryHealthInsight(
                id: "supercharger", titleKey: "battery.insight.highSuperchargerTitle",
                detail: BatteryHealthStrings.insightHighSupercharger(count: superchargerCount),
                severity: .warning, systemImage: "info.circle.fill"
            ))
        }
        return items
    }

    /// Web low-degradation note: < 3 %/yr is below the 3–5 % industry average.
    private static func lowDegradationInsight(_ analytics: BatteryHealthAnalytics) -> BatteryHealthInsight? {
        guard analytics.degradationRateYr < 3 else { return nil }
        return BatteryHealthInsight(
            id: "low-degradation", titleKey: "battery.insight.lowDegTitle",
            detail: BatteryHealthStrings.insightLowDegradation(
                rate: BatteryHealthFormat.number(analytics.degradationRateYr, decimals: 1)
            ),
            severity: .success, systemImage: "target"
        )
    }

    // MARK: Recommendations + chart series

    /// Web `buildRecommendations(health, t)` — returns the i18n keys (the view localizes),
    /// falling back to the "looks great" tip when no risk threshold is crossed.
    public static func recommendationKeys(analytics: BatteryHealthAnalytics) -> [String] {
        var tips: [String] = []
        if analytics.fastChargePct > 30 { tips.append("battery.tip.reduceFast") }
        if analytics.fullChargePct > 40 { tips.append("battery.tip.avoid100") }
        if analytics.avgDepthOfDischarge > 70 { tips.append("battery.tip.avoidDeep") }
        if analytics.degradationRateYr > 3 { tips.append("battery.tip.aboveAvg") }
        if tips.isEmpty { tips.append("battery.tip.great") }
        return tips
    }

    /// Web `predictionChartData` — the actual SOH history joined to the projected future
    /// (only when the projection is trustworthy), with the last actual point overlapped
    /// into the projection's first point for line continuity.
    public static func trendRows(
        analytics: BatteryHealthAnalytics,
        prediction: BatteryHealthPrediction?
    ) -> [BatteryHealthTrendRow] {
        var rows: [BatteryHealthTrendRow] = analytics.history.enumerated().map { index, point in
            BatteryHealthTrendRow(
                index: index,
                label: BatteryHealthFormat.dateShort(point.date),
                actual: point.sohPct,
                predicted: nil
            )
        }

        let trustworthy = prediction?.isTrustworthy ?? false
        let projection = trustworthy ? (prediction?.projectionPoints ?? []) : []
        guard !projection.isEmpty else { return rows }

        let lastActual = rows.last?.actual
        let base = rows.count
        for (offset, point) in projection.enumerated() {
            // Overlap the last actual into the first projected point (web continuity).
            let actual = offset == 0 ? lastActual : nil
            rows.append(BatteryHealthTrendRow(
                index: base + offset,
                label: BatteryHealthFormat.monthLabel(point.month),
                actual: actual,
                predicted: point.healthPct
            ))
        }
        return rows
    }

    /// Web `rangeTrend` — per-snapshot range, empty when there is no history or every
    /// sample is zero (the backend emits `range_km = 0` when no derivation path exists).
    public static func rangeRows(analytics: BatteryHealthAnalytics) -> [BatteryHealthRangeRow] {
        let rows = analytics.history.enumerated().map { index, point in
            BatteryHealthRangeRow(
                index: index,
                label: BatteryHealthFormat.dateShort(point.date),
                rangeKm: point.rangeKm
            )
        }
        if rows.isEmpty || rows.allSatisfy({ $0.rangeKm <= 0 }) { return [] }
        return rows
    }

    // MARK: Sessions (distribution, habits, breakdown) + new-vs-now

    /// Web `chargeLevelDist` — ten 10 %-wide buckets tallying session start/end SOC.
    public static func chargeBuckets(
        sessions: [BatteryHealthChargingSession]
    ) -> [BatteryHealthChargeBucket] {
        guard !sessions.isEmpty else { return [] }
        var start = Array(repeating: 0, count: 10)
        var end = Array(repeating: 0, count: 10)
        for session in sessions {
            start[bucketIndex(session.startSocPct)] += 1
            if let endSoc = session.endSocPct { end[bucketIndex(endSoc)] += 1 }
        }
        return (0 ..< 10).map { index in
            BatteryHealthChargeBucket(
                bucket: index,
                rangeLabel: "\(index * 10)–\(index * 10 + 10)%",
                startCount: start[index],
                endCount: end[index]
            )
        }
    }

    /// Web `Math.min(Math.floor(soc / 10), 9)`, clamped non-negative.
    private static func bucketIndex(_ soc: Double) -> Int {
        min(max(Int(floor(soc / 10)), 0), 9)
    }

    /// Web `chargingHabits` — average start/end SOC (end defaults to 80 when unknown) and
    /// the Supercharger / DC-fast tallies.
    public static func habits(sessions: [BatteryHealthChargingSession]) -> BatteryHealthHabits? {
        guard !sessions.isEmpty else { return nil }
        let startLevels = sessions.map(\.startSocPct)
        let endLevels = sessions.compactMap(\.endSocPct)
        let avgStart = startLevels.isEmpty ? 0 : startLevels.reduce(0, +) / Double(startLevels.count)
        let avgEnd = endLevels.isEmpty ? 80 : endLevels.reduce(0, +) / Double(endLevels.count)
        return BatteryHealthHabits(
            avgStart: avgStart,
            avgEnd: avgEnd,
            superchargerCount: sessions.filter(\.isSupercharger).count,
            dcFastCount: sessions.filter(\.isDCFast).count,
            total: sessions.count
        )
    }

    /// Web `energyBreakdown` — aggregate AC vs DC energy (kWh) + counts across sessions.
    public static func energyBreakdown(
        sessions: [BatteryHealthChargingSession]
    ) -> BatteryHealthEnergyBreakdown? {
        guard !sessions.isEmpty else { return nil }
        var acEnergy = 0.0
        var dcEnergy = 0.0
        var acCount = 0
        var dcCount = 0
        for session in sessions {
            let energy = BatteryHealthFormat.kilowattHours(fromWh: session.totalEnergyAddedWh ?? 0)
            if session.isDC {
                dcEnergy += energy
                dcCount += 1
            } else {
                acEnergy += energy
                acCount += 1
            }
        }
        return BatteryHealthEnergyBreakdown(
            acEnergyKwh: acEnergy,
            dcEnergyKwh: dcEnergy,
            acCount: acCount,
            dcCount: dcCount,
            totalSessions: sessions.count
        )
    }

    /// Web section 8 new-vs-now scalars: original vs estimated capacity and the first vs
    /// last history range.
    public static func newVsNow(analytics: BatteryHealthAnalytics) -> BatteryHealthNewVsNow {
        BatteryHealthNewVsNow(
            capNewKwh: analytics.originalCapacityKwh,
            capNowKwh: analytics.estimatedCapacityKwh,
            rangeNewKm: analytics.history.first?.rangeKm,
            rangeNowKm: analytics.history.last?.rangeKm,
            historyCount: analytics.history.count
        )
    }
}
