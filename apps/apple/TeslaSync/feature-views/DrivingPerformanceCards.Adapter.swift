//
//  DrivingPerformanceCards.Adapter.swift
//  TeslaSync — P4 feature view · 0055 · DrivingPerformanceCards (Apple)
//
//  The testable projection core: the cached `DrivingPerformanceInput` (the fleet
//  `drive_analytics` stat groups + the user's display-unit preferences) → the six
//  view-ready `DrivingMetricCardModel` tiles. Reproduces the web source
//  (features/analytics/components/analytics/DrivingPerformanceCards.tsx) exactly: the
//  `fromKmh` / `fromKm` SI conversions (km/h → m/s → display, km → m → display), the
//  `safe()` non-finite → 0 coercion, the `fmtNumber(_, decimals)` locale-aware grouping
//  (speed/power/regen at 0 dp, distance at 1 dp), and the `?? '—'` em-dash fallback when a
//  stat group is absent. All pure + dependency-free so the projection can be unit-tested
//  without a store, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Render phase (web shell loading / content / empty / error branches)

/// The mutually-exclusive render branches the surface switches over, mirroring the web
/// shell: the parent's `isLoading` skeleton, the resolved cards, the "no drive data"
/// empty rendering (the web still renders the six em-dash cards), and a fetch failure.
public enum DrivingPerformancePhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Accent palette (web `MetricCard` `color`)

/// The decorative accent a metric tile carries, mapped from the web `NeonColor` the source
/// passes to each `MetricCard` (`cyan` / `purple` / `amber` / `green`). Resolved to a
/// design-token color at render time so the tiles stay theme- and contrast-correct.
public enum DrivingAccent: Equatable, Sendable {
    case cyan
    case purple
    case amber
    case green

    /// The design-token color for the accent. `cyan`/`amber`/`green` map to the theme-
    /// adaptive semantic tokens; `purple` maps to the brand chart-series purple, which is
    /// the canonical equivalent of the web `neon-purple` (`rgb(168, 85, 247)`) — there is
    /// no theme-adaptive purple token, so the fixed brand purple is used.
    public var color: Color {
        switch self {
        case .cyan: Color.TS.accent
        case .purple: Color.TS.chartSeriesPower
        case .amber: Color.TS.statusWarning
        case .green: Color.TS.statusSuccess
        }
    }
}

// MARK: - Card projection (web `MetricCard`)

/// One projected metric tile (web `<MetricCard label value subtitle icon color />`). The
/// `value` + `subtitle` are pre-formatted strings rendered verbatim (the value is the
/// localized number or the em-dash sentinel; the subtitle is a unit symbol, not prose).
public struct DrivingMetricCardModel: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let subtitle: String
    public let systemImage: String
    public let accent: DrivingAccent

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        subtitle: String,
        systemImage: String,
        accent: DrivingAccent
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.accent = accent
    }
}

// MARK: - SI conversion + number formatting (web parity)

/// Pure SI → display converters + the `safe()` / `fmtNumber()` helpers, reproducing the
/// web `lib/unitConversion.ts` constants and `lib/numberFormat.ts` formatting so every
/// platform shows identical numbers. The backend `speed_stats` is km/h and `distance_stats`
/// is km (the web comments); both are lifted to the SI floor (m/s, m) before conversion.
public enum DrivingUnitMath {
    /// 1 mile = 1609.344 m exactly (international yard, NIST) — web `METERS_PER_MILE`.
    public static let metersPerMile = 1609.344
    /// 1 km = 1000 m exactly — web `METERS_PER_KM`.
    public static let metersPerKm = 1000.0
    /// 1 ft = 0.3048 m exactly (international foot, NIST) — web `METERS_PER_FOOT`.
    public static let metersPerFoot = 0.3048
    /// Seconds in an hour — web `SECONDS_PER_HOUR`.
    public static let secondsPerHour = 3600.0

    /// Web `safe(v)`: a finite number, else `0` (guards `NaN` / `±Infinity`).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `convertDistanceFromSI(meters, to)`: meters → the display distance unit.
    public static func distanceFromSI(_ meters: Double, _ unit: String) -> Double {
        switch unit {
        case "mi": meters / metersPerMile
        case "ft": meters / metersPerFoot
        default: meters / metersPerKm
        }
    }

    /// Web `convertSpeedFromSI(mps, to)`: m/s → the display speed unit.
    public static func speedFromSI(_ mps: Double, _ unit: String) -> Double {
        switch unit {
        case "mph": (mps * secondsPerHour) / metersPerMile
        default: (mps * secondsPerHour) / metersPerKm
        }
    }

    /// Web `fromKmh(kmh)`: backend km/h → SI m/s → the display speed unit.
    public static func fromKmh(_ kmh: Double, _ unit: String) -> Double {
        speedFromSI((kmh * metersPerKm) / secondsPerHour, unit)
    }

    /// Web `fromKm(km)`: backend km → SI meters → the display distance unit.
    public static func fromKm(_ km: Double, _ unit: String) -> Double {
        distanceFromSI(km * metersPerKm, unit)
    }

    /// Web `fmtNumber(v, decimals)`: locale-aware grouped formatting at a fixed number of
    /// fraction digits, with the JS `toLocaleString` half-away-from-zero rounding and the
    /// `safeNumber` non-finite → 0 guard. `locale` defaults to en-US (the web default).
    public static func fmtNumber(
        _ value: Double,
        decimals: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        let number = NSNumber(value: safe(value))
        return formatter.string(from: number) ?? String(format: "%.\(decimals)f", safe(value))
    }
}

// MARK: - Projection (pure, web-parity)

/// Pure projection rules shared by the model and the views. No store, no bundle, no
/// rendered view — only value-typed inputs/outputs. Builds the six metric tiles in the
/// exact order, with the exact stats, units, icons, and accents the web source renders.
public enum DrivingPerformanceProjection {
    /// The em-dash the web renders for an absent stat group (`ss ? … : '—'`).
    public static let emDash = "—"

    /// The kilowatt unit symbol the web hardcodes for the power/regen tiles (`subtitle="kW"`).
    public static let kilowattSymbol = "kW"

    /// Projects the cached stats + unit preferences into the six view-ready tiles. A `nil`
    /// `input` (or a `nil` stat group within it) yields the em-dash sentinel for that tile,
    /// matching the web `ss ? fmtNumber(…) : '—'` guard — so the grid never renders blank.
    public static func cards(
        from input: DrivingPerformanceInput?,
        prefs: DrivingUnitPrefs
    ) -> [DrivingMetricCardModel] {
        let locale = prefs.locale.map(Locale.init(identifier:)) ?? Locale(identifier: "en-US")
        return specs.map { spec in
            DrivingMetricCardModel(
                id: spec.id,
                labelKey: spec.labelKey,
                labelFallback: spec.labelFallback,
                value: spec.value(input, prefs, locale),
                subtitle: spec.subtitle(prefs),
                systemImage: spec.systemImage,
                accent: spec.accent
            )
        }
    }

    /// Resolves the surface render phase. The skeleton shows only on the initial fetch (no
    /// value yet); a resolved payload renders content; a resolved-but-empty payload renders
    /// the em-dash cards; a failure with cached data stays content (the chip/banner flag
    /// staleness), and a failure with no cached data shows the retryable error — mirroring
    /// the web shell.
    public static func resolvePhase(_ status: DrivingPerformanceLoadStatus, hasValue: Bool) -> DrivingPerformancePhase {
        switch status {
        case .loading:
            hasValue ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasValue ? .content : .empty
        case let .failed(message):
            hasValue ? .content : .error(message)
        }
    }

    // MARK: Tile specs (web `MetricCard` call order)

    /// The static description of one tile: its identity + presentation metadata, plus the
    /// closures that derive its localized value + unit subtitle from the bound input/prefs.
    private struct CardSpec {
        let id: String
        let labelKey: String
        let labelFallback: String
        let systemImage: String
        let accent: DrivingAccent
        let subtitle: @Sendable (DrivingUnitPrefs) -> String
        let value: @Sendable (DrivingPerformanceInput?, DrivingUnitPrefs, Locale) -> String
    }

    /// The six tiles in the exact order + with the exact stat, unit, icon, and accent the
    /// web source passes to each `<MetricCard>`.
    private static let specs: [CardSpec] = [
        CardSpec(
            id: "topSpeed",
            labelKey: "analytics.driving.topSpeed",
            labelFallback: "Top Speed",
            systemImage: "speedometer",
            accent: .cyan,
            subtitle: { $0.speed },
            value: { input, prefs, locale in speedValue(input?.speed?.max, prefs.speed, locale) }
        ),
        CardSpec(
            id: "avgSpeed",
            labelKey: "analytics.driving.avgSpeed",
            labelFallback: "Avg Speed",
            systemImage: "chart.line.uptrend.xyaxis",
            accent: .purple,
            subtitle: { $0.speed },
            value: { input, prefs, locale in speedValue(input?.speed?.avg, prefs.speed, locale) }
        ),
        CardSpec(
            id: "peakPower",
            labelKey: "analytics.driving.peakPower",
            labelFallback: "Peak Power",
            systemImage: "bolt.fill",
            accent: .amber,
            subtitle: { _ in kilowattSymbol },
            value: { input, _, locale in powerValue(input?.power?.max, locale) }
        ),
        CardSpec(
            id: "peakRegen",
            labelKey: "analytics.driving.peakRegen",
            labelFallback: "Peak Regen",
            systemImage: "battery.100.bolt",
            accent: .green,
            subtitle: { _ in kilowattSymbol },
            value: { input, _, locale in powerValue(input?.regen?.max, locale) }
        ),
        CardSpec(
            id: "avgDriveDist",
            labelKey: "analytics.driving.avgDriveDist",
            labelFallback: "Avg Drive Distance",
            systemImage: "mappin.and.ellipse",
            accent: .cyan,
            subtitle: { $0.distance },
            value: { input, prefs, locale in distanceValue(input?.distance?.avg, prefs.distance, locale) }
        ),
        CardSpec(
            id: "longestDrive",
            labelKey: "analytics.driving.longestDrive",
            labelFallback: "Longest Drive",
            systemImage: "car.fill",
            accent: .purple,
            subtitle: { $0.distance },
            value: { input, prefs, locale in distanceValue(input?.distance?.max, prefs.distance, locale) }
        )
    ]

    /// Web `ss ? fmtNumber(fromKmh(safe(value)), 0) : '—'` — the speed tiles (0 dp).
    private static func speedValue(_ value: Double?, _ unit: String, _ locale: Locale) -> String {
        guard let value else { return emDash }
        let display = DrivingUnitMath.fromKmh(DrivingUnitMath.safe(value), unit)
        return DrivingUnitMath.fmtNumber(display, decimals: 0, locale: locale)
    }

    /// Web `ps ? fmtNumber(safe(value), 0) : '—'` — the power / regen tiles in kW (0 dp).
    private static func powerValue(_ value: Double?, _ locale: Locale) -> String {
        guard let value else { return emDash }
        return DrivingUnitMath.fmtNumber(DrivingUnitMath.safe(value), decimals: 0, locale: locale)
    }

    /// Web `ds ? fmtNumber(fromKm(safe(value)), 1) : '—'` — the distance tiles (1 dp).
    private static func distanceValue(_ value: Double?, _ unit: String, _ locale: Locale) -> String {
        guard let value else { return emDash }
        let display = DrivingUnitMath.fromKm(DrivingUnitMath.safe(value), unit)
        return DrivingUnitMath.fmtNumber(display, decimals: 1, locale: locale)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver string for a metric tile. Pure + public so the spoken content can
/// be unit-tested without rendering. The label resolves through the injected localizer
/// (bundle-free in tests); the value + unit are read after it (web reads label, value,
/// then subtitle).
public enum DrivingPerformanceAccessibility {
    public static func cardSummary(_ card: DrivingMetricCardModel, localize: (String, String) -> String) -> String {
        let label = localize(card.labelKey, card.labelFallback)
        return "\(label), \(card.value) \(card.subtitle)"
    }
}
