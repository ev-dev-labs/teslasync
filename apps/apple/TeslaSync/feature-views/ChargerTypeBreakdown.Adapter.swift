//
//  ChargerTypeBreakdown.Adapter.swift
//  TeslaSync — P4 feature view · 0108 · ChargerTypeBreakdown (Apple)
//
//  The testable projection core for the "Cost by Charger Type" surface: the
//  decoded domain model (parity with the web `ChargerTypeData[]` prop), the
//  `safe()` numeric guard (port of the web `safe` from `@/components/charts`), the
//  per-type breakdown rows (web `data.map` — `pct = cost / totalCost * 100`, the
//  `cost / energy` $/kWh rate, the kWh energy), the donut-share helper (web
//  Recharts `Pie dataKey="cost"` slice proportions), and the VoiceOver summary
//  builders. Everything here is pure + dependency-free (Foundation only) so it can
//  be unit-tested without a store or a rendered view.
//

import Foundation

// MARK: - Numeric guard (port of the web `safe`)

/// Numeric helpers shared by the projection. `safe` is the native port of the web
/// `safe = (v) => typeof v === 'number' && isFinite(v) ? v : 0`, used everywhere a
/// cost / energy / count feeds arithmetic so a `NaN` / `Infinity` never reaches a
/// bar width, a donut angle, or a label.
public enum ChargerTypeNumeric {
    /// Returns the value when it is finite, else `0` (web `safe`).
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }
}

// MARK: - Domain model (port of `ChargerTypeData`)

/// One charger-type datum (web `ChargerTypeData` — `{ name, cost, energy,
/// sessions, color }`). The web `color` is a caller-assigned hex; native colors
/// are token-driven, so the projection assigns a palette `colorIndex` by source
/// order (web `CHART_COLORS[i]` parity) rather than carrying a raw hex.
public struct ChargerTypeDatum: Identifiable, Equatable, Sendable {
    public var name: String
    public var cost: Double
    public var energy: Double
    public var sessions: Double

    public var id: String {
        name
    }

    public init(name: String, cost: Double, energy: Double, sessions: Double) {
        self.name = name
        self.cost = cost
        self.energy = energy
        self.sessions = sessions
    }
}

// MARK: - Breakdown row (port of the web `data.map`)

/// One breakdown row — the projection of a `ChargerTypeDatum` against `totalCost`.
/// `fraction` is `cost / totalCost` (web `pct`, kept as a `0…1` fraction so the
/// view multiplies by the track width); `percent` is that as `0…100` (web
/// `fmtNumber(pct, 1)`); `ratePerKwh` is `cost / energy` or `nil` when energy is
/// `0` (web `energy > 0 ? formatCurrency(cost / energy, 3) + '/kWh' : '—'`);
/// `colorIndex` is the source index (the palette wraps it, web
/// `CHART_COLORS[i % CHART_COLORS.length]`).
public struct ChargerTypeRow: Identifiable, Equatable, Sendable {
    public var name: String
    public var cost: Double
    public var energy: Double
    public var sessions: Double
    public var fraction: Double
    public var percent: Double
    public var ratePerKwh: Double?
    public var colorIndex: Int

    public var id: String {
        "\(colorIndex)-\(name)"
    }

    public init(
        name: String,
        cost: Double,
        energy: Double,
        sessions: Double,
        fraction: Double,
        percent: Double,
        ratePerKwh: Double?,
        colorIndex: Int
    ) {
        self.name = name
        self.cost = cost
        self.energy = energy
        self.sessions = sessions
        self.fraction = fraction
        self.percent = percent
        self.ratePerKwh = ratePerKwh
        self.colorIndex = colorIndex
    }
}

// MARK: - Projection (port of the web memos)

/// The pure projection from the decoded `[ChargerTypeDatum]` + `totalCost` to the
/// rows the surface renders. Mirrors the web computations exactly.
public enum ChargerTypeProjection {
    /// The breakdown rows (web `data.map`): each `fraction` is `cost / totalCost`
    /// (`0` when `totalCost <= 0`, web `totalCost > 0 ? … : 0`), `percent` is that
    /// as `0…100`, `ratePerKwh` is `cost / energy` (or `nil` when energy is `0`),
    /// and `colorIndex` is the source index (the palette wraps it).
    public static func rows(_ data: [ChargerTypeDatum], totalCost: Double) -> [ChargerTypeRow] {
        let total = ChargerTypeNumeric.safe(totalCost)
        return data.enumerated().map { index, datum in
            let cost = ChargerTypeNumeric.safe(datum.cost)
            let energy = ChargerTypeNumeric.safe(datum.energy)
            let sessions = ChargerTypeNumeric.safe(datum.sessions)
            let fraction = total > 0 ? cost / total : 0
            return ChargerTypeRow(
                name: datum.name,
                cost: cost,
                energy: energy,
                sessions: sessions,
                fraction: fraction,
                percent: fraction * 100,
                ratePerKwh: energy > 0 ? cost / energy : nil,
                colorIndex: index
            )
        }
    }

    /// The donut slice shares (web Recharts `Pie dataKey="cost"`): each slice's
    /// share of the SUM of the visible costs (distinct from `percent`, which is of
    /// `totalCost`). Returned as `0…100` keyed by row `id`, for the accessible
    /// summary so the spoken donut matches what is drawn.
    public static func donutShares(_ rows: [ChargerTypeRow]) -> [String: Double] {
        let sum = rows.reduce(0.0) { $0 + ChargerTypeNumeric.safe($1.cost) }
        guard sum > 0 else { return [:] }
        var shares: [String: Double] = [:]
        for row in rows {
            shares[row.id] = ChargerTypeNumeric.safe(row.cost) / sum * 100
        }
        return shares
    }
}

// MARK: - Accessibility summaries (testable seam)

/// The unit / word labels a row summary needs, bundled so the summary stays a
/// small function (and avoids a wide parameter list). All values are pre-localized.
public struct ChargerTypeRowLabels: Equatable, Sendable {
    public var sessions: String
    public var energyUnit: String
    public var perKwhSuffix: String
    public var rateUnavailable: String

    public init(sessions: String, energyUnit: String, perKwhSuffix: String, rateUnavailable: String) {
        self.sessions = sessions
        self.energyUnit = energyUnit
        self.perKwhSuffix = perKwhSuffix
        self.rateUnavailable = rateUnavailable
    }
}

/// Builds the VoiceOver strings for the surface's data so the spoken content can
/// be unit-tested without rendering a view. Each builder takes pre-resolved
/// formatters + the P1/S10 labels, so no literal is hardcoded.
public enum ChargerTypeAccessibility {
    /// "Supercharger, $812.40, 980 sessions, 184.0 kWh, $4.412/kWh, 63.0%" — the
    /// full visible row spoken as one element (name, cost, sessions, energy, rate,
    /// percent-of-total), matching the web row composition.
    public static func rowSummary(
        _ row: ChargerTypeRow,
        labels: ChargerTypeRowLabels,
        formatCurrency: (Double, Int) -> String,
        formatInt: (Double) -> String,
        formatNumber: (Double, Int) -> String
    ) -> String {
        let rate: String = if let ratePerKwh = row.ratePerKwh {
            formatCurrency(ratePerKwh, 3) + labels.perKwhSuffix
        } else {
            labels.rateUnavailable
        }
        let parts = [
            row.name,
            formatCurrency(ChargerTypeNumeric.safe(row.cost), 2),
            "\(formatInt(row.sessions)) \(labels.sessions)",
            "\(formatNumber(row.energy, 1)) \(labels.energyUnit)",
            rate,
            "\(formatNumber(row.percent, 1))%"
        ]
        return parts.joined(separator: ", ")
    }

    /// "Cost by Charger Type. Supercharger 58%, Level 2 24%, …" — the donut spoken
    /// as a share list (each type's share of the summed visible cost), so the
    /// chart is not an opaque image to VoiceOver.
    public static func chartSummary(
        _ rows: [ChargerTypeRow],
        title: String,
        formatNumber: (Double, Int) -> String
    ) -> String {
        let shares = ChargerTypeProjection.donutShares(rows)
        guard !shares.isEmpty else { return title }
        let parts = rows.map { row in
            "\(row.name) \(formatNumber(shares[row.id] ?? 0, 0))%"
        }
        return "\(title). \(parts.joined(separator: ", "))"
    }
}
