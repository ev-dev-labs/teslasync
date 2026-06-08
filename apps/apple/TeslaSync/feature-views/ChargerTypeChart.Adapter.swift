//
//  ChargerTypeChart.Adapter.swift
//  TeslaSync — P4 feature view · 0087 · ChargerTypeChart (Apple)
//
//  The testable projection core for the "Charge Rate by Charger Type" surface —
//  the faithful port of the grouped bar chart in
//  features/charging/components/charging-curve/ChargerTypeChart.tsx (and the
//  `getChargerLabel` / `avg` / `durationMinutes` helpers it consumes). Everything
//  here is pure and dependency-free (Foundation only) so it can be unit-tested
//  without a bundle or a rendered view. The value types it projects live in
//  `ChargerTypeChart.Models.swift`.
//
//  Web parity notes:
//    • `classify` is the native `getChargerLabel`: Tesla → Supercharger; any other
//      charger_type → DC Fast; else peak power > 20 kW → DC Fast; else Home / AC.
//    • `points` is the web `chargerTypeStats` useMemo — group by charger type in
//      first-occurrence order (web `Map` insertion order) and compute count, avg kW
//      (`peak_power_w / 1000`), avg kWh (`total_energy_added_wh / 1000`), avg minutes.
//    • `chartRows` flattens to two rows per charger (Power before Energy — web bar order).
//    • The web `chargerTypeStats` empty array → the resolved `.empty` phase.
//

import Foundation

// MARK: - Projection core (pure)

/// The dependency-free projection from raw sessions to chart-ready columns +
/// render phase. A faithful port of the web `chargerTypeStats` useMemo and the
/// `getChargerLabel` / `avg` / `durationMinutes` helpers.
public enum ChargerTypeChartProjection {
    /// Buckets a session into a `ChargerType` — the native `getChargerLabel`.
    /// Tesla → Supercharger; any other non-empty charger type → DC Fast; else a
    /// peak above 20 kW → DC Fast; otherwise Home / AC.
    public static func classify(chargerType: String?, peakPowerW: Double?) -> ChargerType {
        let trimmed = chargerType?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty {
            if trimmed == "Tesla" || trimmed.lowercased().contains("tesla") {
                return .supercharger
            }
            return .dcFast
        }
        if let power = peakPowerW, power > 20000 {
            return .dcFast
        }
        return .homeAC
    }

    /// The per-charger aggregates in first-occurrence order (web `Map` insertion
    /// order over the grouped sessions), each carrying count, avg kW, avg kWh, and
    /// avg minutes (web `chargerTypeStats`).
    public static func points(from sessions: [ChargingSessionInput]) -> [ChargerTypePoint] {
        var order: [ChargerType] = []
        var groups: [ChargerType: [ChargingSessionInput]] = [:]
        for session in sessions {
            let type = classify(chargerType: session.chargerType, peakPowerW: session.peakPowerW)
            if groups[type] == nil { order.append(type) }
            groups[type, default: []].append(session)
        }
        return order.map { type in
            let items = groups[type] ?? []
            return ChargerTypePoint(
                type: type,
                count: items.count,
                avgKw: avg(items.map { ($0.peakPowerW ?? 0) / 1000 }),
                avgKwh: avg(items.map { $0.totalEnergyAddedWh / 1000 }),
                avgDurationMin: avg(items.map { durationMinutes(startedAt: $0.startedAt, endedAt: $0.endedAt) })
            )
        }
    }

    /// The flattened `(charger, metric)` rows for the clustered Swift Charts grid,
    /// in plot order (web kW bar before kWh bar) within each charger.
    public static func chartRows(from points: [ChargerTypePoint]) -> [ChargerChartRow] {
        points.flatMap { point in
            ChargerMetric.allCases
                .sorted { $0.order < $1.order }
                .map { metric in
                    ChargerChartRow(type: point.type, metric: metric, value: point.value(for: metric))
                }
        }
    }

    /// Resolves the render phase from the bound load status + whether any charger
    /// resolved (web `chargerTypeStats.length > 0 ? chart : empty`).
    public static func resolvePhase(_ status: ChargerTypeLoadStatus, hasRows: Bool) -> ChargerTypePhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasRows ? .content : .empty
        }
    }

    /// Total sessions across all charger groups (chart summary / a11y).
    public static func totalSessions(_ points: [ChargerTypePoint]) -> Int {
        points.reduce(0) { $0 + $1.count }
    }

    /// The web `durationMinutes(startedAt, endedAt)` — whole minutes between the
    /// two timestamps, `0` when the end is missing or not after the start.
    public static func durationMinutes(startedAt: Date?, endedAt: Date?) -> Double {
        guard let start = startedAt, let end = endedAt else { return 0 }
        let seconds = end.timeIntervalSince(start)
        guard seconds > 0 else { return 0 }
        return (seconds / 60).rounded()
    }

    /// The web `avg(nums)` — arithmetic mean, `0` for an empty slice.
    public static func avg(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        return values.reduce(0, +) / Double(values.count)
    }

    /// The web `fmtNumber(value, decimals)` — a locale-aware decimal string with a
    /// fixed fraction width and grouping separators.
    public static func decimalString(_ value: Double, decimals: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// The web `fmtInt(value)` — `fmtNumber(value, 0)`.
    public static func intString(_ value: Double, locale: Locale) -> String {
        decimalString(value, decimals: 0, locale: locale)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum ChargerTypeSurface {
    public static let slug = "ChargerTypeChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without
/// a bundle, exactly like the view's P1/S10 facade.
public enum ChargerTypeChartAccessibility {
    /// The chart-level summary: title + charger-type count + total sessions.
    public static func chartSummary(
        points: [ChargerTypePoint],
        localize: (String, String) -> String
    ) -> String {
        let title = localize("charging.curve.chargerType", "Charge Rate by Charger Type")
        guard !points.isEmpty else {
            return "\(title): \(localize("common.noData", "No data available"))"
        }
        let categories = localize("charging.curve.categoryCount", "charger types")
        let sessionsLabel = localize("charging.curve.col.sessions", "Sessions")
        let total = ChargerTypeChartProjection.totalSessions(points)
        return "\(title): \(points.count) \(categories), \(total) \(sessionsLabel)"
    }

    /// One charger's VoiceOver value, carrying the same figures as the data table
    /// row (web `dataColumns`): "{name}: Sessions N, Avg kW X, Avg kWh Y, Avg minutes Z".
    public static func rowLabel(
        _ point: ChargerTypePoint,
        name: String,
        locale: Locale,
        localize: (String, String) -> String
    ) -> String {
        let sessions = localize("charging.curve.col.sessions", "Sessions")
        let avgKw = localize("charging.curve.col.avgKw", "Avg kW")
        let avgKwh = localize("charging.curve.col.avgKwh", "Avg kWh")
        let avgMin = localize("charging.curve.col.avgMin", "Avg minutes")
        let count = ChargerTypeChartProjection.intString(Double(point.count), locale: locale)
        let kw = ChargerTypeChartProjection.decimalString(point.avgKw, decimals: 1, locale: locale)
        let kwh = ChargerTypeChartProjection.decimalString(point.avgKwh, decimals: 1, locale: locale)
        let mins = ChargerTypeChartProjection.intString(point.avgDurationMin, locale: locale)
        return "\(name): \(sessions) \(count), \(avgKw) \(kw), \(avgKwh) \(kwh), \(avgMin) \(mins)"
    }
}
