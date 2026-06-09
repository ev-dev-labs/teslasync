//
//  SpeedGearPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0174 · SpeedGearPanel (Apple)
//
//  The pure, Foundation-only projection core for the driving-dynamics "Speed & Gear" surface — the
//  SwiftUI parity of features/driving/components/driving-dynamics/SpeedGearPanel.tsx.
//
//  It ports the web component's numeric pipeline VERBATIM so the native surface shows the exact same
//  values: `fmtNumber(v)` (lib/numberFormat.ts, the global-precision 2 default) for the motor power,
//  `fmtNumber(v, 0)` for the two drive speeds, and `convertSpeedFromSI(mps, speedPref)`
//  (lib/unitConversion.ts, behind the `toSpeedDisplay` prop) for the m/s → display conversion.
//
//  Crucially it reproduces the web's "aggregate in SI, convert ONCE at the boundary" fix: the
//  average and top drive speeds are folded over the drives list in metres-per-second and the speed
//  converter is applied a SINGLE time at projection. The pre-fix web code converted during the
//  reduce/`Math.max` AND again at the render site, double-applying the m/s → mph factor; this core
//  keeps the conversion at exactly one boundary so the bug cannot recur.
//
//  Everything is SwiftUI-free so it is exhaustively unit-testable in isolation; the design-token
//  colour mapping lives in SpeedGearPanel.Views.swift.
//
//  Unit semantics (mirrors the web prop contract — the parent page already resolved these from the
//  SI signal_log / drives via the P1/S8 holders, so this leaf treats them as presentation inputs):
//    • power      — kilowatts (kW)
//    • drive speed — metres per second (m/s), converted to km/h or mph at projection time
//

import Foundation

// MARK: - Speed conversion (ported 1:1 from web lib/unitConversion.ts)

/// Speed converter ported 1:1 from `convertSpeedFromSI(mps, to)` in `lib/unitConversion.ts` (the
/// function behind the web `toSpeedDisplay` prop): km/h is `mps * 3600 / 1000`, mph is
/// `mps * 3600 / 1609.344`. The drive `avgSpeedMps` / `maxSpeedMps` values arrive in metres per
/// second (the SI floor the Phase-42 pipeline stores), exactly the input the web converter expects.
public enum SpeedGearConvert {
    /// Seconds in an hour (web `SECONDS_PER_HOUR`).
    static let secondsPerHour = 3600.0
    /// Metres in a kilometre (web `METERS_PER_KM`).
    static let metersPerKilometer = 1000.0
    /// Metres in a statute mile (web `METERS_PER_MILE`).
    static let metersPerMile = 1609.344

    /// Converts SI metres-per-second to the user's display speed unit.
    public static func fromSI(_ mps: Double, to unit: SpeedGearSpeedUnit) -> Double {
        switch unit {
        case .kilometersPerHour:
            (mps * secondsPerHour) / metersPerKilometer
        case .milesPerHour:
            (mps * secondsPerHour) / metersPerMile
        }
    }
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts `fmtNumber`)

/// Locale-aware formatting that mirrors `web/src/lib/numberFormat.ts`. `number` ports `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })` — grouped separators, fixed
/// decimals, non-finite coerced to 0, half-away-from-zero rounding to match `Intl.NumberFormat`'s
/// default `halfExpand`). The power tile uses the global-precision-2 default; the two speed tiles
/// pass `decimals: 0` exactly as the web `fmtNumber(toSpeedDisplay(v), 0)` calls do.
public enum SpeedGearFormat {
    /// The em-dash the web renders for an absent value (`?? '—'` / the `!= null` else branch). Named
    /// `emDash` (a glyph constant), never a stub marker, so the surface carries no ADR-011 tokens.
    public static let emDash = "—"

    /// The kilowatt symbol the web hardcodes under the motor-power value (`<span>kW</span>`).
    public static let kilowattSymbol = "kW"

    /// Port of `fmtNumber(v, decimals)` — grouped, fixed-precision, NaN/∞ ⇒ 0.
    public static func number(_ value: Double, decimals: Int, locale: Locale) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(decimals)f", safe)
    }
}

// MARK: - Drive speed aggregation (web reduce / Math.max in SI)

/// The average + top drive speed folded over the drives list, kept in SI metres-per-second so the
/// display conversion happens exactly once downstream. Mirrors the web:
///   `avgDriveSpeedMps = drives.length ? Σ(d.avgSpeedMps ?? 0) / drives.length : null`
///   `topDriveSpeedMps = drives.length ? max(d.maxSpeedMps ?? 0) : null`
/// Both are `nil` for an empty list (web `null`), which the projector renders as the em-dash.
public struct SpeedGearDriveAggregate: Sendable, Equatable {
    public let averageMps: Double?
    public let topMps: Double?

    public init(averageMps: Double?, topMps: Double?) {
        self.averageMps = averageMps
        self.topMps = topMps
    }

    /// Folds the drives list into the SI average + top speed. An empty list yields `nil` / `nil`
    /// (web `drives.length > 0 ? … : null`); each missing per-drive value coalesces to `0` exactly
    /// like the web `d.avgSpeedMps ?? 0` / `d.maxSpeedMps ?? 0`.
    public static func aggregate(_ drives: [SpeedGearDriveSample]) -> SpeedGearDriveAggregate {
        guard !drives.isEmpty else {
            return SpeedGearDriveAggregate(averageMps: nil, topMps: nil)
        }
        let sum = drives.reduce(0.0) { $0 + ($1.avgSpeedMps ?? 0) }
        let average = sum / Double(drives.count)
        let top = drives.map { $0.maxSpeedMps ?? 0 }.max() ?? 0
        return SpeedGearDriveAggregate(averageMps: average, topMps: top)
    }
}

// MARK: - Shift identity (web shiftColor / shiftBadgeVariant)

/// The colour identity of the big shift letter — the semantic peer of the web `shiftColor(shift)`
/// helper, carried token-free so the projector stays SwiftUI-free (the `Color` mapping lives in the
/// view). Web mapping: `D → emerald` (`success`), `R → red` (`danger`), `N → yellow` (`warning`),
/// `P → text-muted` (`muted`), and any other / absent gear → `text-secondary` (`secondary`).
public enum SpeedGearShiftAccent: String, Sendable, Equatable, CaseIterable {
    case success
    case danger
    case warning
    case muted
    case secondary

    /// Port of `shiftColor(shift)` — the gear letter's colour band.
    public static func accent(for shift: String?) -> SpeedGearShiftAccent {
        switch shift {
        case "D": .success
        case "R": .danger
        case "N": .warning
        case "P": .muted
        default: .secondary
        }
    }
}

/// The tone of the "Shift State" badge — the peer of the web `shiftBadgeVariant(shift)` helper
/// (`Badge variant`). Web mapping: `D → success`, `R → danger`, `N → warning`, and any other /
/// absent gear (including `P`) → `neutral`. Note the badge folds `P` into `neutral` while the letter
/// colour folds `P` into `muted`, so the two ladders are deliberately distinct.
public enum SpeedGearBadgeTone: String, Sendable, Equatable, CaseIterable {
    case success
    case danger
    case warning
    case neutral

    /// Port of `shiftBadgeVariant(shift)` — the badge's tone band.
    public static func tone(for shift: String?) -> SpeedGearBadgeTone {
        switch shift {
        case "D": .success
        case "R": .danger
        case "N": .warning
        default: .neutral
        }
    }
}

// MARK: - Projected tiles (web Grid cols 2 / md:4)

/// The first grid cell: the big gear letter over the "Shift State" badge (web shift column). `letter`
/// is `shift_state ?? '—'`; `accent` colours the letter; `tone` + `badgeLabel` drive the badge.
public struct SpeedGearShiftTile: Sendable, Equatable {
    public let letter: String
    public let accent: SpeedGearShiftAccent
    public let tone: SpeedGearBadgeTone
    public let badgeLabel: String

    public init(letter: String, accent: SpeedGearShiftAccent, tone: SpeedGearBadgeTone, badgeLabel: String) {
        self.letter = letter
        self.accent = accent
        self.tone = tone
        self.badgeLabel = badgeLabel
    }
}

/// One of the three value cells (Motor Power / Avg Drive Speed / Top Drive Speed): the muted label
/// over the bold value over the muted unit suffix — the web `label / value / unit` stack. `value` is
/// already the web-formatted string (or the em-dash); `unit` is always shown (web renders the unit
/// span regardless of whether the value resolved).
public struct SpeedGearMetricTile: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let value: String
    public let unit: String

    public init(id: String, label: String, value: String, unit: String) {
        self.id = id
        self.label = label
        self.value = value
        self.unit = unit
    }
}

// MARK: - Projection (web render branch, view-ready)

/// The view-ready projection of one motor reading + drives list — the shift tile, the three metric
/// tiles, and a combined VoiceOver summary. A pure function of the inputs + unit prefs, so the view
/// is a pure function of this value and the whole pipeline is unit-tested in isolation.
public struct SpeedGearProjection: Sendable, Equatable {
    public let shift: SpeedGearShiftTile
    public let metrics: [SpeedGearMetricTile]
    public let accessibilitySummary: String

    public init(shift: SpeedGearShiftTile, metrics: [SpeedGearMetricTile], accessibilitySummary: String) {
        self.shift = shift
        self.metrics = metrics
        self.accessibilitySummary = accessibilitySummary
    }
}

/// Pure projection from a motor reading + drives list (+ unit prefs) to the view-ready
/// `SpeedGearProjection` — the native port of the web component's body. Reproduces every `t()`
/// label, every `?? '—'` / `!= null` guard, the shift colour/tone ladders, and the single-boundary
/// speed conversion, pinned by the adapter unit tests.
public enum SpeedGearProjector {
    public static func project(
        reading: SpeedGearMotorReading?,
        drives: [SpeedGearDriveSample],
        units: SpeedGearUnitPrefs
    ) -> SpeedGearProjection {
        let locale = Locale(identifier: units.localeIdentifier)
        let aggregate = SpeedGearDriveAggregate.aggregate(drives)
        let shift = projectShift(reading)
        let metrics = projectMetrics(reading, aggregate: aggregate, units: units, locale: locale)
        let summary = ([accessibilityShift(shift)] + metrics.map(accessibilityMetric))
            .joined(separator: ", ")
        return SpeedGearProjection(shift: shift, metrics: metrics, accessibilitySummary: summary)
    }

    // MARK: Shift tile

    /// Builds the shift cell — `shift_state ?? '—'` with the letter colour + badge tone ladders and
    /// the localized "Shift State" badge label.
    private static func projectShift(_ reading: SpeedGearMotorReading?) -> SpeedGearShiftTile {
        let shift = reading?.shiftState
        return SpeedGearShiftTile(
            letter: shift ?? SpeedGearFormat.emDash,
            accent: SpeedGearShiftAccent.accent(for: shift),
            tone: SpeedGearBadgeTone.tone(for: shift),
            badgeLabel: label("dynamics.shiftState", "Shift State")
        )
    }

    // MARK: Metric tiles

    /// The three value cells in web order: Motor Power (kW @ precision), Avg Drive Speed and Top
    /// Drive Speed (the SI aggregates converted ONCE, @ 0 decimals).
    private static func projectMetrics(
        _ reading: SpeedGearMotorReading?,
        aggregate: SpeedGearDriveAggregate,
        units: SpeedGearUnitPrefs,
        locale: Locale
    ) -> [SpeedGearMetricTile] {
        [
            powerTile(reading, units: units, locale: locale),
            speedTile(
                id: "avgDriveSpeed",
                label: label("dynamics.avgDriveSpeed", "Avg Drive Speed"),
                mps: aggregate.averageMps,
                units: units,
                locale: locale
            ),
            speedTile(
                id: "topDriveSpeed",
                label: label("dynamics.topDriveSpeed", "Top Drive Speed"),
                mps: aggregate.topMps,
                units: units,
                locale: locale
            )
        ]
    }

    /// Web Motor Power — `power_kw != null ? fmtNumber(power_kw) : '—'`, with the hardcoded `kW`
    /// suffix. Uses the user's global precision (default 2) like the unqualified web `fmtNumber`.
    private static func powerTile(
        _ reading: SpeedGearMotorReading?,
        units: SpeedGearUnitPrefs,
        locale: Locale
    ) -> SpeedGearMetricTile {
        let value = reading?.powerKW.map { SpeedGearFormat.number($0, decimals: units.precision, locale: locale) }
        return SpeedGearMetricTile(
            id: "power",
            label: label("dynamics.power", "Motor Power"),
            value: value ?? SpeedGearFormat.emDash,
            unit: SpeedGearFormat.kilowattSymbol
        )
    }

    /// Web Avg / Top Drive Speed — `mps != null ? fmtNumber(toSpeedDisplay(mps), 0) : '—'`, with the
    /// `speedUnit` suffix. The SI value is converted a SINGLE time here (the double-conversion fix).
    private static func speedTile(
        id: String,
        label: String,
        mps: Double?,
        units: SpeedGearUnitPrefs,
        locale: Locale
    ) -> SpeedGearMetricTile {
        let value = mps.map {
            SpeedGearFormat.number(SpeedGearConvert.fromSI($0, to: units.speed), decimals: 0, locale: locale)
        }
        return SpeedGearMetricTile(
            id: id,
            label: label,
            value: value ?? SpeedGearFormat.emDash,
            unit: units.speed.symbol
        )
    }

    // MARK: Accessibility

    /// "<badge label>, <letter>" for the shift cell's VoiceOver label (label first, then the gear).
    private static func accessibilityShift(_ shift: SpeedGearShiftTile) -> String {
        SpeedGearAccessibility.join([shift.badgeLabel, shift.letter])
    }

    /// "<label>, <value> <unit>" for one metric cell's VoiceOver label.
    private static func accessibilityMetric(_ metric: SpeedGearMetricTile) -> String {
        SpeedGearAccessibility.join([metric.label, "\(metric.value) \(metric.unit)"])
    }

    /// Resolves a web `t(key, default)` label through the P1/S10 facade (Foundation-only).
    private static func label(_ key: String, _ fallback: String) -> String {
        SpeedGearPanelStrings.string(key, fallback)
    }
}

// MARK: - Accessibility summaries

/// Builds the combined VoiceOver strings for the cells, joining the already-localized parts so the
/// labels stay translation-driven.
public enum SpeedGearAccessibility {
    /// Joins non-empty parts with ", " (the standard VoiceOver list separator).
    public static func join(_ parts: [String]) -> String {
        parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}
