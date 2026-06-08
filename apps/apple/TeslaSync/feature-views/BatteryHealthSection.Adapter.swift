//
//  BatteryHealthSection.Adapter.swift
//  TeslaSync — P4 feature view · 0072 · BatteryHealthSection (Apple)
//
//  The testable projection core for the weekly-digest Battery Health section — the
//  SwiftUI parity of features/analytics/components/weekly-digest/BatteryHealthSection.tsx
//  plus the leaf maths its children (`BatteryPill`, `MiniStat`) do inline and the
//  formatters it leans on (`fmtNumber`, `fmtInt`). Everything here is pure +
//  dependency-free (no store, no bundle, no rendered view) so the number formatting,
//  the battery colour-band + bar fraction, the three mini-stat values, and the
//  VoiceOver summaries are all unit tested in isolation.
//
//  Units note: the "Est. Range Added" tile reproduces the web source verbatim —
//  `chargeEnergyAdded * 5.5` rendered with the "km" unit. The factor + unit are the
//  canonical web spec for this surface; the estimate stays a display-only string at
//  the render boundary and introduces no SI-suffixed model field (frontend SI cutover).
//

import Foundation

// MARK: - Section metrics (the DigestMetrics slice this surface reads)

/// The slice of the parent `useWeeklyDigest` `DigestMetrics` the Battery Health
/// section consumes (web reads `batteryStart`, `batteryEnd`, `chargingSessionCount`,
/// `chargeEnergyAdded`). The digest metrics are computed client-side from the drives /
/// charging / alerts queries, so this is a plain cached value type — there is no
/// dedicated endpoint and therefore no wire decode here.
public struct BatteryHealthMetrics: Equatable, Sendable {
    /// Mean state-of-charge at charge start across the week's sessions (percent).
    public let batteryStart: Double
    /// Mean state-of-charge at charge end across the week's sessions (percent).
    public let batteryEnd: Double
    /// Number of charging sessions in the selected week.
    public let chargingSessionCount: Int
    /// Total energy added across the week's sessions (the web `chargeEnergyAdded`).
    public let chargeEnergyAdded: Double

    public init(
        batteryStart: Double,
        batteryEnd: Double,
        chargingSessionCount: Int,
        chargeEnergyAdded: Double
    ) {
        self.batteryStart = batteryStart
        self.batteryEnd = batteryEnd
        self.chargingSessionCount = chargingSessionCount
        self.chargeEnergyAdded = chargeEnergyAdded
    }
}

// MARK: - Number formatting (web `fmtNumber` / `fmtInt`)

/// Locale-aware number formatter mirroring the web `fmtNumber(v, decimals, locale)`:
/// grouped decimal with a fixed fraction width, with nullish / non-finite input
/// coerced to zero (web `safeNumber`). The web global defaults (precision 2,
/// `en-US`) are reproduced; both are overridable to track `useSettings` at the
/// display boundary. `int` is the `fmtInt` shortcut (zero fraction digits).
public enum BatteryHealthNumberFormat {
    public static func format(
        _ value: Double,
        decimals: Int = 2,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: safe)) ?? String(safe)
    }

    /// Web `fmtInt(v)` — grouped integer (zero fraction digits).
    public static func int(_ value: Double, locale: Locale = Locale(identifier: "en-US")) -> String {
        format(value, decimals: 0, locale: locale)
    }

    /// Web `Math.round` for a non-negative percent: nearest integer. Battery
    /// percentages are non-negative, so `.toNearestOrAwayFromZero` matches JS
    /// `Math.round` (which rounds half toward +∞) for every value this surface sees.
    public static func roundedLevel(_ value: Double) -> Int {
        guard value.isFinite else { return 0 }
        return Int(value.rounded())
    }

    /// The web "Est. Range Added" factor: `chargeEnergyAdded * 5.5` km. Verbatim
    /// port of the source constant (kept named so the estimate is self-documenting).
    public static let rangeKilometersPerEnergyUnit = 5.5
}

// MARK: - Battery colour band (web BatteryPill STATUS_COLORS ladder)

/// The colour band a battery level falls into — the native mirror of the web
/// `level >= 60 ? good : level >= 30 ? warning : critical` ladder (`STATUS_COLORS`).
/// The view maps a band to the shared status tone so the hex map lives once, in tokens.
public enum BatteryBand: String, Sendable, Equatable, CaseIterable {
    case good
    case warning
    case critical

    /// Web ternary: `>= 60` good, `>= 30` warning, else critical. Uses the rounded
    /// level the web passes into `BatteryPill`.
    public static func forLevel(_ level: Int) -> BatteryBand {
        if level >= 60 { return .good }
        if level >= 30 { return .warning }
        return .critical
    }
}

// MARK: - Battery pill projection (web `BatteryPill`)

/// Which charge-phase a pill represents (drives its i18n label in the view).
public enum BatteryPillKind: String, Sendable, Equatable, CaseIterable {
    case chargeStart
    case chargeEnd
}

/// The view-ready projection of one `BatteryPill`: the rounded level, its grouped
/// text (`fmtInt(level)`), the colour band, and the clamped bar fraction
/// (web bar width `min(level, 100)%`). The label + the trailing "%" stay in the view
/// so they resolve through the i18n facade.
public struct BatteryPillProjection: Identifiable, Equatable, Sendable {
    public var id: BatteryPillKind {
        kind
    }

    public let kind: BatteryPillKind
    public let level: Int
    public let levelText: String
    public let band: BatteryBand
    public let fraction: Double

    public init(kind: BatteryPillKind, level: Int, levelText: String, band: BatteryBand, fraction: Double) {
        self.kind = kind
        self.level = level
        self.levelText = levelText
        self.band = band
        self.fraction = fraction
    }

    /// Projects a raw average percent into a pill VM. `level = round(value)`
    /// (web `Math.round`), the band is taken from that level, and the bar fraction
    /// is `min(max(level, 0), 100) / 100` (web `min(level, 100)%` plus the bar's own
    /// lower clamp).
    public static func make(kind: BatteryPillKind, value: Double) -> BatteryPillProjection {
        let level = BatteryHealthNumberFormat.roundedLevel(value)
        let clamped = Swift.min(Swift.max(level, 0), 100)
        return BatteryPillProjection(
            kind: kind,
            level: level,
            levelText: BatteryHealthNumberFormat.int(Double(level)),
            band: BatteryBand.forLevel(level),
            fraction: Double(clamped) / 100
        )
    }
}

// MARK: - Mini-stat projection (web `MiniStat`)

/// Which range-stat a tile represents (drives its i18n label, icon, and unit wrapper
/// in the view).
public enum MiniStatKind: String, Sendable, Equatable, CaseIterable {
    case chargeGain
    case sessions
    case rangeAdded
}

/// The view-ready projection of one `MiniStat`: the kind and the already-formatted
/// numeric string. The unit / percent wrapper (`"{{value}}%"`, `"{{value}} km"`)
/// stays in the view so it resolves through the i18n facade.
public struct MiniStatProjection: Identifiable, Equatable, Sendable {
    public var id: MiniStatKind {
        kind
    }

    public let kind: MiniStatKind
    public let valueText: String

    public init(kind: MiniStatKind, valueText: String) {
        self.kind = kind
        self.valueText = valueText
    }
}

// MARK: - Tile builders (web BatteryHealthSection composition)

/// Pure builders that turn the cached section metrics into the two pill VMs and the
/// three mini-stat VMs, reproducing the exact web expressions. Unit tested directly.
public enum BatteryHealthTiles {
    /// The two `BatteryPill`s: avg battery at charge start / end (web `Math.round`).
    public static func pills(from metrics: BatteryHealthMetrics) -> [BatteryPillProjection] {
        [
            BatteryPillProjection.make(kind: .chargeStart, value: metrics.batteryStart),
            BatteryPillProjection.make(kind: .chargeEnd, value: metrics.batteryEnd)
        ]
    }

    /// The three `MiniStat`s. `chargeGain = fmtNumber(end - start, 1)` (raw, not the
    /// rounded pill levels), `sessions = fmtInt(count)`, and
    /// `rangeAdded = fmtNumber(chargeEnergyAdded * 5.5, 0)`.
    public static func stats(from metrics: BatteryHealthMetrics) -> [MiniStatProjection] {
        let gain = metrics.batteryEnd - metrics.batteryStart
        let rangeAdded = metrics.chargeEnergyAdded * BatteryHealthNumberFormat.rangeKilometersPerEnergyUnit
        return [
            MiniStatProjection(kind: .chargeGain, valueText: BatteryHealthNumberFormat.format(gain, decimals: 1)),
            MiniStatProjection(
                kind: .sessions,
                valueText: BatteryHealthNumberFormat.int(Double(metrics.chargingSessionCount))
            ),
            MiniStatProjection(kind: .rangeAdded, valueText: BatteryHealthNumberFormat.format(rangeAdded, decimals: 0))
        ]
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the combined VoiceOver phrase for a labelled tile from its already-resolved
/// display strings. Pure + public so the spoken content is asserted without rendering
/// the view; empty fragments are dropped so the phrase never reads a stray comma.
public enum BatteryHealthAccessibility {
    public static func tileSummary(label: String, value: String) -> String {
        [label, value]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}
