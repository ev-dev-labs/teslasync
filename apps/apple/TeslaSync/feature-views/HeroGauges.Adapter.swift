//
//  HeroGauges.Adapter.swift
//  TeslaSync — P4 feature view · 0143 · HeroGauges (Apple)
//
//  The testable projection core: the drive-detail metrics (`DriveGaugeStats`) + `HeroUnitPrefs` →
//  the four-or-five view-ready `HeroGaugeTileModel`s, reproducing the web source's numeric pipeline
//  VERBATIM so the native surface shows the exact same values as
//  features/driving/components/drive-detail/HeroGauges.tsx.
//
//  Deliberately free of SwiftUI (Foundation only) so the conversion + formatting compile and run
//  on a plain host and are pinned by unit tests. `HeroAccent` carries only the web colour name
//  (cyan/purple/amber/red/green); the token mapping lives in HeroGauges.Views.swift.
//

import Foundation

// MARK: - SI converters + number formatting (ported from lib/unitConversion.ts + lib/numberFormat.ts)

/// The SI → display converters + locale-aware number formatting the web component composes
/// (`convertDistanceFromSI` / `convertSpeedFromSI` from `lib/unitConversion.ts`, the inline
/// Wh/km → Wh/mi efficiency factor, and `fmtNumber` from `lib/numberFormat.ts`). Every constant is
/// the exact NIST value the web uses so the two surfaces convert identically.
public enum HeroGaugesFormat {
    /// 1 mile = 1609.344 m exactly (international yard, NIST) — `METERS_PER_MILE`.
    public static let metersPerMile = 1609.344
    /// 1 km = 1000 m exactly — `METERS_PER_KM`.
    public static let metersPerKm = 1000.0
    /// 1 ft = 0.3048 m exactly (international foot, NIST) — `METERS_PER_FOOT`.
    public static let metersPerFoot = 0.3048
    /// Seconds per hour — `SECONDS_PER_HOUR`.
    public static let secondsPerHour = 3600.0
    /// Seconds per minute — `SECONDS_PER_MINUTE`.
    public static let secondsPerMinute = 60.0
    /// km per mile — the inline `whPerKm * 1.609344` factor the component uses for Wh/km → Wh/mi.
    public static let kmPerMile = 1.609344
    /// The web global decimal precision default (`numberFormat.ts` `_globalPrecision = 2`).
    public static let globalPrecision = 2

    /// `safeNumber` from numberFormat.ts (and the charts `safe`): non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// JavaScript `Math.round` — round half toward +∞ (`floor(x + 0.5)`), so the half-up behaviour
    /// of every `Math.round(...)` the component applies to a gauge value is reproduced exactly.
    public static func mathRound(_ value: Double) -> Double {
        (safeNumber(value) + 0.5).rounded(.down)
    }

    /// SI meters → the user's display distance (`convertDistanceFromSI`).
    public static func convertDistanceFromSI(_ meters: Double, to unit: DistanceUnit) -> Double {
        switch unit {
        case .km: meters / metersPerKm
        case .mi: meters / metersPerMile
        case .ft: meters / metersPerFoot
        }
    }

    /// SI m/s → the user's display speed (`convertSpeedFromSI`).
    public static func convertSpeedFromSI(_ mps: Double, to unit: HeroGaugesSpeedUnit) -> Double {
        switch unit {
        case .kmh: (mps * secondsPerHour) / metersPerKm
        case .mph: (mps * secondsPerHour) / metersPerMile
        }
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away from
    /// zero to match `Number.toLocaleString`'s default `halfExpand`.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// `Number(fmtNumber(v))` — the value the component derives for the efficiency gauge before it
    /// hands it to `RadialGauge`. `fmtNumber` groups with the global locale, then JS `Number(...)`
    /// parses it back; a grouped string (≥ 1000) yields `NaN`, exactly as `Double("1,234.50")`
    /// returns `nil` here → collapsed to NaN so the downstream `safeNumber` floors it to 0.
    public static func numberFromFormatted(_ value: Double) -> Double {
        let formatted = number(value, decimals: globalPrecision, localeIdentifier: "en_US")
        let parsable = formatted.contains(",") ? "" : formatted
        return Double(parsable) ?? .nan
    }
}

// MARK: - Accent (web `RadialGauge color`) — token mapping lives in the view layer

/// The colour name the web `RadialGauge` carries for a gauge's progress arc (`#00f0ff` cyan /
/// `#a855f7` purple / `#f59e0b` amber / `#ef4444` red / `#10b981` green). Kept as a pure value here
/// so the projection stays SwiftUI-free; the SwiftUI token mapping is in `HeroGauges.Views.swift`.
public enum HeroAccent: String, Sendable, Equatable {
    case cyan
    case purple
    case amber
    case red
    case green
}

// MARK: - Projected gauge tile (web `RadialGauge`)

/// One projected radial gauge: a localized label, a formatted centre value, an optional unit
/// suffix, the 0...1 ring fill fraction (`clamped / max`), and the accent for its progress arc.
/// Mirrors the web `RadialGauge` props (`value` / `max` / `label` / `unit` / `color`).
public struct HeroGaugeTileModel: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let unit: String?
    public let fraction: Double
    public let accent: HeroAccent

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        unit: String?,
        fraction: Double,
        accent: HeroAccent
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.unit = unit
        self.fraction = fraction
        self.accent = accent
    }

    /// The resolved (localized) label for display + accessibility (P1/S10 facade).
    public var label: String {
        HeroGaugesStrings.string(labelKey, labelFallback)
    }

    /// The centre readout for VoiceOver — value plus unit suffix when present.
    public var spokenValue: String {
        guard let unit, !unit.isEmpty else { return value }
        return "\(value) \(unit)"
    }
}

// MARK: - Projection

/// The fully-projected surface content: the four headline gauges plus the optional fifth Efficiency
/// gauge (present only when the web `stats.efficiencyPctPer100` is non-nil), in the web render order.
public struct HeroGaugesProjection: Equatable, Sendable {
    public let gauges: [HeroGaugeTileModel]

    public init(gauges: [HeroGaugeTileModel]) {
        self.gauges = gauges
    }
}

/// The inputs for one web `<RadialGauge value max unit color>` before clamping/formatting.
private struct GaugeSpec {
    let id: String
    let labelKey: String
    let labelFallback: String
    let rawValue: Double
    let maxValue: Double
    let unit: String?
    let accent: HeroAccent
}

/// Pure projector: `DriveGaugeStats` + `HeroUnitPrefs` → `HeroGaugesProjection`. Every value is
/// computed with the exact same arithmetic + formatting as the web component so the web and native
/// surfaces show identical numbers side by side.
public enum HeroGaugesProjector {
    public static func project(stats: DriveGaugeStats, units: HeroUnitPrefs) -> HeroGaugesProjection {
        let context = Context(stats: stats, units: units)
        return HeroGaugesProjection(gauges: context.gauges())
    }

    /// Pure per-projection context bundling the inputs so the gauge math stays short while keeping
    /// every value byte-for-byte identical to the web source.
    private struct Context {
        let stats: DriveGaugeStats
        let units: HeroUnitPrefs

        private var locale: String {
            units.localeIdentifier
        }

        /// `convertDistanceFromSI(drive.distanceM, unitPrefs.distance)` — the component's
        /// `toDistanceDisplay`.
        private var distanceDisplay: Double {
            HeroGaugesFormat.convertDistanceFromSI(stats.distanceM, to: units.distance)
        }

        /// `(drive.durationS ?? 0) / 60` — drive minutes.
        private var durationMinutes: Double {
            (stats.durationS ?? 0) / HeroGaugesFormat.secondsPerMinute
        }

        /// `unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm` — the component's inline
        /// `toEfficiencyDisplay`.
        private var consumptionDisplay: Double {
            units.distance == .mi
                ? stats.consumptionWhKm * HeroGaugesFormat.kmPerMile
                : stats.consumptionWhKm
        }

        /// `unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'` — the consumption gauge unit.
        private var efficiencyUnit: String {
            units.distance == .mi ? "Wh/mi" : "Wh/km"
        }

        /// The headline gauges in the web render order. The fifth Efficiency gauge is appended only
        /// when `stats.efficiencyPctPer100` is non-nil (`{stats.efficiencyPctPer100 != null && …}`).
        func gauges() -> [HeroGaugeTileModel] {
            var specs = [distanceSpec(), maxSpeedSpec(), durationSpec(), consumptionSpec()]
            if let efficiency = efficiencySpec() {
                specs.append(efficiency)
            }
            return specs.map(gauge)
        }

        private func distanceSpec() -> GaugeSpec {
            let display = distanceDisplay
            return GaugeSpec(
                id: "distance",
                labelKey: "driveDetail.distance",
                labelFallback: "Distance",
                rawValue: HeroGaugesFormat.mathRound(display),
                maxValue: max(display * 1.5, 100),
                unit: units.distance.label,
                accent: .cyan
            )
        }

        private func maxSpeedSpec() -> GaugeSpec {
            GaugeSpec(
                id: "max-speed",
                labelKey: "driveDetail.maxSpeed",
                labelFallback: "Max Speed",
                rawValue: HeroGaugesFormat.mathRound(stats.maxSpeed),
                maxValue: HeroGaugesFormat.convertSpeedFromSI(250, to: units.speed),
                unit: units.speed.label,
                accent: .purple
            )
        }

        private func durationSpec() -> GaugeSpec {
            let minutes = durationMinutes
            return GaugeSpec(
                id: "duration",
                labelKey: "driveDetail.duration",
                labelFallback: "Duration",
                rawValue: HeroGaugesFormat.mathRound(minutes),
                maxValue: max(minutes * 1.5, 60),
                unit: "min",
                accent: .amber
            )
        }

        private func consumptionSpec() -> GaugeSpec {
            let display = consumptionDisplay
            return GaugeSpec(
                id: "consumption",
                labelKey: "driveDetail.consumption",
                labelFallback: "Consumption",
                rawValue: HeroGaugesFormat.mathRound(display),
                maxValue: max(display * 1.5, 300),
                unit: efficiencyUnit,
                accent: .red
            )
        }

        private func efficiencySpec() -> GaugeSpec? {
            guard let pct = stats.efficiencyPctPer100 else { return nil }
            return GaugeSpec(
                id: "efficiency",
                labelKey: "driveDetail.efficiency",
                labelFallback: "Efficiency",
                rawValue: HeroGaugesFormat.numberFromFormatted(pct),
                maxValue: 30,
                unit: units.isMiles ? "%/100mi" : "%/100km",
                accent: .green
            )
        }

        /// Builds one gauge tile the way the web `RadialGauge` renders: `clamped = max(0, min(value,
        /// max))`, the centre reads `fmtNumber(clamped, decimals)` (0 decimals for the whole values
        /// the web passes, else the global precision), and the arc fills `clamped / max`.
        private func gauge(_ spec: GaugeSpec) -> HeroGaugeTileModel {
            let safeValue = HeroGaugesFormat.safeNumber(spec.rawValue)
            let safeMax = HeroGaugesFormat.safeNumber(spec.maxValue)
            let clamped = min(max(safeValue, 0), safeMax)
            let decimals = clamped == clamped.rounded() ? 0 : HeroGaugesFormat.globalPrecision
            return HeroGaugeTileModel(
                id: spec.id,
                labelKey: spec.labelKey,
                labelFallback: spec.labelFallback,
                value: HeroGaugesFormat.number(clamped, decimals: decimals, localeIdentifier: locale),
                unit: spec.unit,
                fraction: safeMax <= 0 ? 0 : clamped / safeMax,
                accent: spec.accent
            )
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the gauge grid. Pure + public so the a11y label content
/// can be unit-tested without rendering the view.
public enum HeroGaugesAccessibility {
    /// One spoken phrase per gauge, e.g.
    /// "Distance 42 km. Max Speed 118 km/h. Duration 37 min. Consumption 168 Wh/km. Efficiency 14.2 %/100km".
    public static func summary(for projection: HeroGaugesProjection) -> String {
        projection.gauges
            .map { "\($0.label) \($0.spokenValue)" }
            .joined(separator: ". ")
    }
}
