//
//  AcDcStatsPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0096 · AcDcStatsPanel (Apple)
//
//  The testable projection core for the AC-vs-DC charging stats panel — the
//  SwiftUI parity of features/charging/components/charging-list/AcDcStatsPanel.tsx
//  plus the web helpers it is fed by: `fmtPercent` / `fmtWithUnit` / `fmtNumber`
//  (lib/numberFormat.ts) and `formatDurationMinutes` (lib/dateFormat.ts). Everything
//  here is pure + dependency-free (no store, no bundle, no rendered view) so the
//  bucket model, the locale number/percent formatting, the MWh/kWh scaling, the
//  duration wording, the energy-split fractions, and the per-type rows are all unit
//  tested in isolation.
//
//  Parity note: the web panel formats each bucket's raw `energy` value with a
//  `>= 1000 ? value/1000 'MWh' : value 'kWh'` rule and a 2-decimal locale format.
//  This core reproduces that arithmetic and labelling verbatim — it does not
//  reinterpret or rescale the upstream value, since the panel is a presentational
//  leaf and the breakdown is computed by its parent surface (out of scope here).
//

import Foundation

// MARK: - Bucket model (web `AcDcBucket` / `AcDcBreakdown` from helpers.ts)

/// One charge-type bucket — the native mirror of the web `AcDcBucket`. `energy`,
/// `cost`, and `freeEnergy` are carried as the upstream numbers (the parent computes
/// them); `totalDuration` is in minutes to match the web `durationMinutes` source.
public struct AcDcBucket: Equatable, Sendable {
    public var energy: Double
    public var energyUsed: Double
    public var cost: Double
    public var count: Int
    public var totalDuration: Double
    public var freeCount: Int
    public var freeEnergy: Double

    public init(
        energy: Double = 0,
        energyUsed: Double = 0,
        cost: Double = 0,
        count: Int = 0,
        totalDuration: Double = 0,
        freeCount: Int = 0,
        freeEnergy: Double = 0
    ) {
        self.energy = energy
        self.energyUsed = energyUsed
        self.cost = cost
        self.count = count
        self.totalDuration = totalDuration
        self.freeCount = freeCount
        self.freeEnergy = freeEnergy
    }
}

/// The fleet-wide totals the web `AcDcBreakdown.total` carries (energy / cost /
/// free-energy / free-count), used by the split bar and the free-charging footer.
public struct AcDcBreakdownTotal: Equatable, Sendable {
    public var energy: Double
    public var cost: Double
    public var freeEnergy: Double
    public var freeCount: Int

    public init(energy: Double = 0, cost: Double = 0, freeEnergy: Double = 0, freeCount: Int = 0) {
        self.energy = energy
        self.cost = cost
        self.freeEnergy = freeEnergy
        self.freeCount = freeCount
    }
}

/// The AC / DC / total breakdown — the native mirror of the web `AcDcBreakdown`
/// prop the panel is rendered from.
public struct AcDcBreakdown: Equatable, Sendable {
    public var ac: AcDcBucket
    public var dc: AcDcBucket
    public var total: AcDcBreakdownTotal

    public init(ac: AcDcBucket, dc: AcDcBucket, total: AcDcBreakdownTotal) {
        self.ac = ac
        self.dc = dc
        self.total = total
    }
}

// MARK: - Number / duration formatting (ports of numberFormat.ts + dateFormat.ts)

/// Pure number, percent, energy, and duration formatting ported from the web
/// helpers so the rounding, the grouping separators, and the unit scaling match the
/// source exactly. The web global precision is 2 and `safeNumber` coerces non-finite
/// input to 0; both are reproduced here.
public enum AcDcFormat {
    /// The em-dash sentinel the web renders for a missing/non-applicable value.
    public static let dash = "—"

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `fmtNumber(v, decimals)`: locale grouping, fixed fraction
    /// digits, half-away rounding (web `toLocaleString` default), `safeNumber` guard.
    public static func number(_ value: Double, decimals: Int = 2, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Native port of `fmtPercent(v)` — `fmtNumber(v)` with a trailing `%`.
    public static func percent(_ value: Double, locale: Locale = .current) -> String {
        number(value, locale: locale) + "%"
    }

    /// Native port of `fmtWithUnit(v, unit)` — `fmtNumber(v)` plus a spaced unit.
    public static func withUnit(_ value: Double, _ unit: String, locale: Locale = .current) -> String {
        number(value, locale: locale) + " " + unit
    }

    /// The web energy ladder: `value >= 1000 ? fmtWithUnit(value/1000, 'MWh')
    /// : fmtWithUnit(value, 'kWh')`. Reproduced verbatim (the threshold and the
    /// divisor both read the raw upstream value).
    public static func energyScaled(_ value: Double, locale: Locale = .current) -> String {
        value >= 1000
            ? withUnit(value / 1000, "MWh", locale: locale)
            : withUnit(value, "kWh", locale: locale)
    }

    /// Native port of `formatDurationMinutes(minutes)` (dateFormat.ts): the em-dash
    /// fallback for non-finite / negative input, integer hours via floor, and the
    /// rounded-int minute remainder.
    public static func duration(_ minutes: Double, locale: Locale = .current) -> String {
        guard minutes.isFinite, minutes >= 0 else { return dash }
        let hours = Int((minutes / 60).rounded(.down))
        let remainder = minutes.truncatingRemainder(dividingBy: 60)
        let mins = roundedInt(remainder, locale: locale)
        return hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"
    }

    /// Native port of `formatRoundedInt(value)` — zero-fraction-digit locale format.
    static func roundedInt(_ value: Double, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }
}

// MARK: - Energy split fractions (web grid `templateColumns` percentages)

/// The AC / DC share of the total energy, as clamped 0...1 fractions — the native
/// equivalent of the web `(bucket.energy / total.energy) * 100` grid columns. A
/// non-positive or non-finite total yields zero shares (the web's NaN branch, which
/// renders no coloured segment).
public enum AcDcSplit {
    public static func fractions(ac: Double, dc: Double, total: Double) -> (ac: Double, dc: Double) {
        guard total > 0, total.isFinite else { return (0, 0) }
        return (clamp(ac / total), clamp(dc / total))
    }

    static func clamp(_ value: Double) -> Double {
        guard value.isFinite else { return 0 }
        return min(max(value, 0), 1)
    }
}

// MARK: - Per-type table row (web `AcDcTableRow`)

/// One resolved table row — the native mirror of the web `AcDcTableRow`. The display
/// label is carried as an i18n key + English fallback (resolved in the view); the
/// numeric fields stay raw so the view formats them through `AcDcFormat`.
public struct AcDcTableRow: Identifiable, Equatable, Sendable {
    /// The charge type, used by the view to pick the AC (blue) / DC (amber) accent.
    public enum Kind: String, Sendable {
        case ac
        case dc
    }

    public let id: String
    public let kind: Kind
    public let labelKey: String
    public let labelFallback: String
    public let energy: Double
    public let cost: Double
    public let sessionCount: Int
    public let totalDuration: Double
    public let freeCount: Int
    public let freeEnergy: Double

    public init(
        id: String,
        kind: Kind,
        labelKey: String,
        labelFallback: String,
        energy: Double,
        cost: Double,
        sessionCount: Int,
        totalDuration: Double,
        freeCount: Int,
        freeEnergy: Double
    ) {
        self.id = id
        self.kind = kind
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.energy = energy
        self.cost = cost
        self.sessionCount = sessionCount
        self.totalDuration = totalDuration
        self.freeCount = freeCount
        self.freeEnergy = freeEnergy
    }

    /// Web `r.energy / r.count` — the per-session average energy (always kWh).
    public var averageEnergy: Double {
        sessionCount > 0 ? energy / Double(sessionCount) : 0
    }

    /// Web `r.totalDuration / r.count` — the per-session average duration (minutes).
    public var averageDuration: Double {
        sessionCount > 0 ? totalDuration / Double(sessionCount) : 0
    }

    /// Web `r.cost / r.energy` when energy is positive, else the em-dash branch.
    public var costPerEnergy: Double? {
        energy > 0 ? cost / energy : nil
    }

    /// Whether this row has any free (zero-cost) sessions (web `freeCount > 0`).
    public var hasFree: Bool {
        freeCount > 0
    }
}

/// Builds the AC + DC rows from a breakdown and keeps only the types that have at
/// least one session — the native port of the web
/// `[{…ac}, {…dc}].filter((r) => r.count > 0)`.
public enum AcDcRows {
    public static func rows(for breakdown: AcDcBreakdown) -> [AcDcTableRow] {
        [
            row(id: "ac", kind: .ac, key: "charging.table.acCharging", fallback: "AC Charging", bucket: breakdown.ac),
            row(id: "dc", kind: .dc, key: "charging.table.dcCharging", fallback: "DC Charging", bucket: breakdown.dc)
        ].filter { $0.sessionCount > 0 }
    }

    private static func row(
        id: String,
        kind: AcDcTableRow.Kind,
        key: String,
        fallback: String,
        bucket: AcDcBucket
    ) -> AcDcTableRow {
        AcDcTableRow(
            id: id,
            kind: kind,
            labelKey: key,
            labelFallback: fallback,
            energy: bucket.energy,
            cost: bucket.cost,
            sessionCount: bucket.count,
            totalDuration: bucket.totalDuration,
            freeCount: bucket.freeCount,
            freeEnergy: bucket.freeEnergy
        )
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the panel and its rows from already-localised
/// parts, so the spoken content is asserted without rendering the view.
public enum AcDcAccessibility {
    /// The per-row spoken label: "{type}, {sessions}, {energy}, {cost}".
    public static func rowLabel(type: String, sessions: String, energy: String, cost: String) -> String {
        "\(type), \(sessions), \(energy), \(cost)"
    }

    /// The split-bar spoken label: "{acLabel}, {dcLabel}".
    public static func splitLabel(ac: String, dc: String) -> String {
        "\(ac), \(dc)"
    }
}
