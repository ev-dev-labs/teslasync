//
//  FleetStatsBar.Adapter.swift
//  TeslaSync — P4 feature view · 0123 · FleetStatsBar (Apple)
//
//  The testable projection core for the dashboard fleet stats bar — a faithful port
//  of features/dashboard/components/FleetStatsBar.tsx plus the unit + number helpers
//  its parent widget (FleetStatsWidget.tsx → useUnits / lib/unitConversion /
//  lib/numberFormat) feeds it. Everything here is pure and dependency-free
//  (Foundation only) so the unit conversion, the locale number formatting, the five
//  cards, the responsive column math, the load/freshness phases, and the VoiceOver
//  summaries are all unit tested without a bundle or a rendered view.
//
//  Parity notes:
//    • The five cards reproduce the web order exactly: Fleet Size · Distance (30d) ·
//      Energy (30d) · Efficiency · Alerts.
//    • `FleetUnits.distanceFromSI` ports `convertDistanceFromSI` (lib/unitConversion):
//      meters / 1000 (km), / 1609.344 (mi), / 0.3048 (ft). The web feeds it
//      `analytics.total_distance_km`, whose value is SI meters under Phase-42 (the
//      legacy `_km` key is the R2-style misname), so the native input carries SI.
//    • `FleetUnits.efficiencyFromWhKm` ports the widget's `toEfficiencyDisplay`
//      (Wh/km × 1.609344 when the user prefers miles, identity otherwise).
//    • `FleetStatsFormat.number` ports `fmtNumber` (lib/numberFormat): non-finite → 0
//      (web `safeNumber`), grouping separators, fixed fraction digits, round half up.
//    • Unit symbols ("km" / "kWh" / "Wh/km") are locale-invariant codes the web passes
//      as data, so they are appended here verbatim (the same disposition as the web's
//      hardcoded `suffix=" kWh"` and the SummaryStatsRow `"%"` port). Translatable
//      prose — the card labels and the "online" / "fleet average" / "unread" captions
//      — is carried as i18n keys and resolved at the view boundary.
//

import Foundation

// MARK: - Distance unit preference (web `unitPrefs.distance`)

/// The user's distance display unit — the native mirror of the web
/// `DistanceUnitPref`. Drives both the distance conversion and the efficiency
/// denominator (`Wh/km` vs `Wh/mi`).
public enum DistanceUnitPref: String, Sendable, Equatable, CaseIterable {
    case km
    case mi
    case ft

    /// The unit symbol the web passes as `distanceUnit` (a locale-invariant code).
    public var label: String {
        switch self {
        case .km: "km"
        case .mi: "mi"
        case .ft: "ft"
        }
    }
}

// MARK: - Unit conversion (port of lib/unitConversion + the widget's efficiency math)

/// Pure SI → display conversions, ported verbatim from `convertDistanceFromSI` and
/// the `FleetStatsWidget` efficiency closure so the factors match the source exactly.
public enum FleetUnits {
    static let metersPerMile = 1609.344
    static let metersPerKm = 1000.0
    static let metersPerFoot = 0.3048

    /// Native port of `convertDistanceFromSI(meters, to)`: SI meters → the display
    /// unit (km / mi / ft).
    public static func distanceFromSI(_ meters: Double, _ unit: DistanceUnitPref) -> Double {
        switch unit {
        case .km: meters / metersPerKm
        case .mi: meters / metersPerMile
        case .ft: meters / metersPerFoot
        }
    }

    /// Native port of the widget's `toEfficiencyDisplay`: Wh/km stays Wh/km, or scales
    /// to Wh/mi (× 1.609344) when the user prefers miles.
    public static func efficiencyFromWhKm(_ whPerKm: Double, _ unit: DistanceUnitPref) -> Double {
        unit == .mi ? whPerKm * (metersPerMile / metersPerKm) : whPerKm
    }

    /// The efficiency unit symbol (web `efficiencyUnit`).
    public static func efficiencyLabel(_ unit: DistanceUnitPref) -> String {
        unit == .mi ? "Wh/mi" : "Wh/km"
    }

    /// The energy unit symbol (web hardcoded `suffix=" kWh"`).
    public static let energyLabel = "kWh"
}

// MARK: - Number formatting (port of lib/numberFormat `fmtNumber`)

/// Locale number formatting, ported from `fmtNumber` so the grouping + rounding match
/// the web `AnimatedNumber` output exactly.
public enum FleetStatsFormat {
    /// `fmtNumber(v, decimals, locale)`: coerces non-finite to 0 (web `safeNumber`),
    /// groups thousands, pins the fraction digits, and rounds half away from zero.
    public static func number(_ value: Double, decimals: Int, locale: Locale = .current) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? "0"
    }

    /// `${fmtNumber(value, decimals)} ${unit}` — the web `AnimatedNumber value suffix`
    /// composition (the suffix carries a leading space in the source).
    public static func withUnit(
        _ value: Double,
        decimals: Int,
        unit: String,
        locale: Locale = .current
    ) -> String {
        "\(number(value, decimals: decimals, locale: locale)) \(unit)"
    }
}

// MARK: - Card accent (web per-card text color → brand token role)

/// The semantic accent for a card's value (and its sparkline) — the native mapping of
/// the web Tailwind text color onto a brand token role (resolved to a `Color` at the
/// view). ADR-006 parity is semantic, not a literal hex port.
public enum FleetStatAccent: String, Sendable, Equatable, CaseIterable {
    case neutral // web text-[var(--text-primary)]
    case distance // web text-cyan-300 / #00f0ff
    case energy // web text-emerald-300 / #10b981
    case efficiency // web text-amber-300
    case alert // web text-red-500 (unread > 0)
    case calm // web text-emerald-500 (unread == 0)
}

// MARK: - Card caption (web supporting line)

/// A card's supporting caption — either the "{n} online" count line (web
/// `{onlineCount} {t('fleet.online')}`) or a plain localized caption (web
/// `t('fleet.average')` / `t('fleet.unread')`). Carried semantically so the wording
/// localizes at the view while the count stays a value.
public enum FleetStatCaption: Sendable, Equatable {
    case online(Int)
    case localized(key: String, fallback: String)
}

// MARK: - Card model (web `<GlassPanel>` tile)

/// One resolved stat card — the native mirror of a single web `<GlassPanel>` tile with
/// its label, animated value, accent, and either a caption or an inline sparkline.
public struct FleetStatCard: Identifiable, Sendable, Equatable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    /// The fully composed display value (locale number + optional unit symbol).
    public let valueText: String
    public let accent: FleetStatAccent
    /// The supporting caption (cards 1 / 4 / 5), or `nil` for the sparkline cards.
    public let caption: FleetStatCaption?
    /// The inline trend values (cards 2 / 3), or `nil` for the caption cards. The view
    /// renders the line only when there are ≥ 2 points (web `MiniChart` `< 2 → null`).
    public let sparkline: [Double]?

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        valueText: String,
        accent: FleetStatAccent,
        caption: FleetStatCaption?,
        sparkline: [Double]?
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.valueText = valueText
        self.accent = accent
        self.caption = caption
        self.sparkline = sparkline
    }
}

// MARK: - Fleet analytics snapshot (web `analytics` prop subset)

/// The subset of `FleetAnalytics` the bar reads — optional, mirroring the web
/// `analytics?` so the `?? 0` defaults are exercised. `totalDistanceSI` is the SI
/// value the web feeds to `convertDistanceFromSI` (the `total_distance_km` key holds
/// meters under Phase-42).
public struct FleetAnalyticsSnapshot: Sendable, Equatable {
    public var totalDistanceSI: Double
    public var totalEnergyKwh: Double
    public var avgEfficiencyWhKm: Double

    public init(totalDistanceSI: Double, totalEnergyKwh: Double, avgEfficiencyWhKm: Double) {
        self.totalDistanceSI = totalDistanceSI
        self.totalEnergyKwh = totalEnergyKwh
        self.avgEfficiencyWhKm = avgEfficiencyWhKm
    }
}

// MARK: - Input snapshot (web props from FleetStatsWidget)

/// One coalesced snapshot of the bar's inputs — the native mirror of the web props
/// (`analytics`, `vehicleCount`, `onlineCount`, `unreadAlerts`, `recentDrives`,
/// `recentCharges`, the unit preference). Recent drive distances / charge energies are
/// the SI series the web maps for the sparklines (`distance_m`, `total_energy_added_wh`).
public struct FleetStatsInput: Sendable, Equatable {
    public var vehicleCount: Int
    public var onlineCount: Int
    public var unreadAlerts: Int
    public var analytics: FleetAnalyticsSnapshot?
    public var recentDriveDistancesM: [Double]
    public var recentChargeEnergiesWh: [Double]
    public var unit: DistanceUnitPref

    public init(
        vehicleCount: Int = 0,
        onlineCount: Int = 0,
        unreadAlerts: Int = 0,
        analytics: FleetAnalyticsSnapshot? = nil,
        recentDriveDistancesM: [Double] = [],
        recentChargeEnergiesWh: [Double] = [],
        unit: DistanceUnitPref = .km
    ) {
        self.vehicleCount = vehicleCount
        self.onlineCount = onlineCount
        self.unreadAlerts = unreadAlerts
        self.analytics = analytics
        self.recentDriveDistancesM = recentDriveDistancesM
        self.recentChargeEnergiesWh = recentChargeEnergiesWh
        self.unit = unit
    }
}

// MARK: - Load status + freshness + render phase

/// The bound source's load status for the dashboard queries (web parent
/// `WidgetShell` `isFetching` / resolved / `isError`), projected into a phase.
public enum FleetStatsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner
/// so the bar is clearly labeled while reconnecting / offline.
public enum FleetStatsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface should render. The web leaf always paints the five cards (with
/// `?? 0` fallbacks); the loading / empty / error envelope (prompt P4 states) is
/// supplied by the bound source, mirroring the web parent widget's lifecycle.
public enum FleetStatsPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}
