//
//  BatteryRangePanel.Adapter.swift
//  TeslaSync — P4 feature view · 0289 · BatteryRangePanel (Apple)
//
//  The pure cached → panel projection types (no SwiftUI, no networking) for the BatteryRangePanel
//  surface — the native port of
//  features/vehicles/components/vehicle-detail/BatteryRangePanel.tsx. The web component is
//  presentational: it reads a `VehicleState` and renders a radial battery gauge (web `RadialGauge`)
//  beside three metric cards (web `MetricCard`) — Rated Range, Ideal Range, and Charging (with a
//  "Full in {h}h" subtitle while charging). This file models the snapshot the panel reads, the
//  user's distance display preference (web `useUnits()`), and the SI distance / number math that
//  reproduces `lib/unitConversion.ts` `formatDistance` + `lib/numberFormat.ts` `fmtNumber` so every
//  platform renders identical strings. SwiftUI-free so each value can be unit tested without a
//  store, a bundle, or a rendered view.
//

import Foundation

// MARK: - Snapshot (the `VehicleState` subset the panel reads)

/// The cached vehicle-state subset the panel renders (web prop `state: VehicleState`). Distance
/// fields are SI meters (the Phase-42 pipeline floor) and convert to the user's unit at the render
/// boundary; `batteryLevel` is the state-of-charge percent; `timeToFullChargeHours` is the Tesla
/// hours-to-full estimate the web feeds to `fmtNumber(..., 1)`. Optional everywhere for null safety
/// even though the strict web `VehicleState` types these as non-null numbers.
public struct BatteryRangePanelSnapshot: Sendable, Equatable {
    public var batteryLevel: Double?
    public var ratedRangeMeters: Double?
    public var idealRangeMeters: Double?
    public var isCharging: Bool?
    public var chargeRateMeters: Double?
    public var timeToFullChargeHours: Double?

    public init(
        batteryLevel: Double? = nil,
        ratedRangeMeters: Double? = nil,
        idealRangeMeters: Double? = nil,
        isCharging: Bool? = nil,
        chargeRateMeters: Double? = nil,
        timeToFullChargeHours: Double? = nil
    ) {
        self.batteryLevel = batteryLevel
        self.ratedRangeMeters = ratedRangeMeters
        self.idealRangeMeters = idealRangeMeters
        self.isCharging = isCharging
        self.chargeRateMeters = chargeRateMeters
        self.timeToFullChargeHours = timeToFullChargeHours
    }
}

// MARK: - Distance display unit (web `useUnits().unitPrefs.distance`)

/// The user's distance display preference, mirroring the web `DistanceUnitPref` resolved by
/// `useUnits()` (`unitPrefs.distance`, derived from `settings.unit_of_length`). Stored as the unit
/// symbol the web `formatDistance` appends after a space.
public enum BatteryRangePanelDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// The symbol appended after the number (web `pref.distance`).
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol, defaulting to kilometers (the SI display
    /// floor) for any unrecognized value — matching `useUnits` `deriveDistance`.
    public static func from(symbol: String) -> BatteryRangePanelDistanceUnit {
        BatteryRangePanelDistanceUnit(rawValue: symbol) ?? .kilometers
    }
}

// MARK: - Unit preferences (web `useUnits()`)

/// The user's display preferences for the panel, mirroring `useUnits()`. The view never reads
/// settings directly; the source resolves these and pushes them with each snapshot so the same
/// preference the web `useUnits` hook applies is honored at the native render boundary.
public struct BatteryRangePanelUnitPrefs: Sendable, Equatable {
    public var distance: BatteryRangePanelDistanceUnit
    public var localeIdentifier: String
    /// Default fraction digits flowing from a user `settings.decimal_precision` override (web
    /// `useUnits` precision). `nil` falls back to the per-quantity web default at format time.
    public var precision: Int?

    public init(
        distance: BatteryRangePanelDistanceUnit = .kilometers,
        localeIdentifier: String = "en_US",
        precision: Int? = nil
    ) {
        self.distance = distance
        self.localeIdentifier = localeIdentifier
        self.precision = precision
    }
}

// MARK: - Tone (semantic only — mapped to a `Color.TS` token at the view layer)

/// The semantic color role for the gauge ring or a metric card accent. Kept free of SwiftUI so the
/// projection stays pure and testable; `BatteryRangePanel.Views` maps each case to a `Color.TS`
/// design token. `.accent` is the web `cyan` MetricCard accent; `.success` is the web `green`.
public enum BatteryRangePanelTone: Sendable, Equatable {
    case accent
    case success
    case warning
    case danger
    case muted
    case primary
}

// MARK: - Battery band (web `batteryColor(level)` thresholds)

/// The state-of-charge band that drives the gauge ring color, reproducing the web `batteryColor`
/// thresholds: `> 60` green, `> 25` amber, else red; an absent level reads as `.unknown`.
public enum BatteryRangePanelBatteryBand: Sendable, Equatable {
    case high
    case medium
    case low
    case unknown

    /// The semantic tone for the band (web green / amber / red → success / warning / danger).
    public var tone: BatteryRangePanelTone {
        switch self {
        case .high: .success
        case .medium: .warning
        case .low: .danger
        case .unknown: .muted
        }
    }
}

// MARK: - Gauge model (web `RadialGauge`)

/// The radial battery gauge (web `<RadialGauge value={battery_level} max={100} unit="%" />`).
/// `fraction` is the clamped 0...1 ring fill; `valueText` is the localized numeric percent (web
/// `fmtNumber`) or the em-dash for an absent reading; `band` selects the ring color.
public struct BatteryRangePanelGaugeModel: Sendable, Equatable {
    public let label: String
    public let valueText: String
    public let unit: String
    public let fraction: Double
    public let hasValue: Bool
    public let band: BatteryRangePanelBatteryBand
    public let accessibilityLabel: String

    public init(
        label: String,
        valueText: String,
        unit: String,
        fraction: Double,
        hasValue: Bool,
        band: BatteryRangePanelBatteryBand,
        accessibilityLabel: String
    ) {
        self.label = label
        self.valueText = valueText
        self.unit = unit
        self.fraction = fraction
        self.hasValue = hasValue
        self.band = band
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Metric card (web `MetricCard`)

/// One metric card (web `<MetricCard label value icon color subtitle />`). `value` is the localized
/// distance / charge text; `subtitle` is the optional "Full in {h}h" line; `tone` is the card
/// accent (mapped to a `Color.TS` token at the view layer); `systemImage` is the leading glyph.
public struct BatteryRangePanelMetricModel: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let value: String
    public let subtitle: String?
    public let tone: BatteryRangePanelTone
    public let systemImage: String
    public let accessibilityLabel: String

    public init(
        id: String,
        label: String,
        value: String,
        subtitle: String?,
        tone: BatteryRangePanelTone,
        systemImage: String,
        accessibilityLabel: String
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.subtitle = subtitle
        self.tone = tone
        self.systemImage = systemImage
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Content model (web JSX projection)

/// The projected panel content: the radial gauge plus the three metric cards (Rated Range, Ideal
/// Range, Charging), in the web grid order. Always built from the snapshot (absent fields fall back
/// to the em-dash like the web); the view only renders it in the `.content` phase.
public struct BatteryRangePanelContentModel: Sendable, Equatable {
    public let gauge: BatteryRangePanelGaugeModel
    public let metrics: [BatteryRangePanelMetricModel]

    public init(gauge: BatteryRangePanelGaugeModel, metrics: [BatteryRangePanelMetricModel]) {
        self.gauge = gauge
        self.metrics = metrics
    }
}

// MARK: - Formatting sentinels

/// Non-localized formatting sentinels shared by the projection.
public enum BatteryRangePanelFormat {
    /// The em-dash shown for an absent value (web `DEFAULT_EMPTY_DISPLAY`).
    public static let dash = "—"
    /// The battery-gauge unit suffix (web `unit="%"`).
    public static let percent = "%"
    /// The charge-rate per-hour suffix (web `${formatDistance(charge_rate)}/h`).
    public static let perHourSuffix = "/h"
    /// The time-to-full suffix (web `${fmtNumber(time_to_full_charge, 1)}h`).
    public static let hourSuffix = "h"
}

// MARK: - Distance conversion + number formatting (web parity)

/// Pure SI-meters → display converter + the `fmtNumber()` helper, reproducing the web
/// `lib/unitConversion.ts` `convertDistanceFromSI` / `formatDistance` and `lib/numberFormat.ts`
/// `fmtNumber` so every platform shows identical numbers. SwiftUI-free so the math can be
/// unit-tested on a plain host.
public enum BatteryRangePanelMath {
    /// The em-dash the web renders for an absent / non-finite reading.
    public static let emDash = BatteryRangePanelFormat.dash

    /// The web distance precision default (`DEFAULT_PRECISION.distance`).
    public static let defaultDistancePrecision = 1
    /// The web `getGlobalPrecision()` default the `RadialGauge` falls back to for a fractional level.
    public static let defaultGaugePrecision = 2

    /// 1 mile = 1609.344 m exactly (international yard, NIST) — web `METERS_PER_MILE`.
    static let metersPerMile = 1609.344
    /// 1 km = 1000 m exactly — web `METERS_PER_KM`.
    static let metersPerKm = 1000.0
    /// 1 ft = 0.3048 m exactly (international foot, NIST) — web `METERS_PER_FOOT`.
    static let metersPerFoot = 0.3048

    /// Web `convertDistanceFromSI(meters, to)`: SI meters → the display unit's numeric value.
    public static func convertDistanceFromSI(
        _ meters: Double,
        to unit: BatteryRangePanelDistanceUnit
    ) -> Double {
        switch unit {
        case .kilometers: meters / metersPerKm
        case .miles: meters / metersPerMile
        case .feet: meters / metersPerFoot
        }
    }

    /// Web `fmtNumber(v, decimals, locale)`: locale-grouped formatting at a fixed number of fraction
    /// digits with the non-finite → 0 guard. Half-away-from-zero rounding mirrors
    /// `Intl.NumberFormat`'s default for the non-negative values this surface formats.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String) -> String {
        let digits = max(0, decimals)
        let safeValue = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safeValue)) ?? String(format: "%.\(digits)f", safeValue)
    }

    /// Web `resolvePrecision(pref, override, fallback)`: a finite, non-negative per-call override
    /// wins, else the user's preference precision, else the per-quantity fallback.
    public static func resolvePrecision(override: Int?, preference: Int?, fallback: Int) -> Int {
        if let override, override >= 0 { return override }
        if let preference, preference >= 0 { return preference }
        return fallback
    }

    /// Web `formatDistance(meters, pref, options)`: `fmtNumber(convertDistanceFromSI(m), digits)` with
    /// the unit symbol appended after a space. Returns the em-dash for an absent / non-finite value.
    public static func distance(
        _ meters: Double?,
        unit: BatteryRangePanelDistanceUnit,
        precisionOverride: Int?,
        preferencePrecision: Int?,
        localeIdentifier: String
    ) -> String {
        guard let meters, meters.isFinite else { return emDash }
        let digits = resolvePrecision(
            override: precisionOverride,
            preference: preferencePrecision,
            fallback: defaultDistancePrecision
        )
        let value = convertDistanceFromSI(meters, to: unit)
        return "\(number(value, decimals: digits, localeIdentifier: localeIdentifier)) \(unit.symbol)"
    }

    /// Web `batteryColor(level)` thresholds → the gauge band (`> 60` high, `> 25` medium, else low;
    /// an absent / non-finite level is unknown).
    public static func band(for level: Double?) -> BatteryRangePanelBatteryBand {
        guard let level, level.isFinite else { return .unknown }
        if level > 60 { return .high }
        if level > 25 { return .medium }
        return .low
    }
}
