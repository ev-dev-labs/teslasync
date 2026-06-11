//
//  BatteryComparison.Adapter.swift
//  TeslaSync — P4 feature view · 0275 · BatteryComparison (Apple)
//
//  The testable projection core for the fleet "Battery Level" comparison panel — the
//  faithful port of features/vehicles/components/BatteryComparison.tsx plus the web
//  helpers it leans on: `batteryColor` (lib/colors.ts) and `useUnits().formatDistance`
//  (which delegates to `formatDistance` / `convertDistanceFromSI` in lib/unitConversion.ts).
//  Everything here is pure + dependency-free (Foundation only) — no store, no bundle, no
//  rendered view, no KMP `Shared` runtime — so the null-state filtering, the semantic tint
//  thresholds, the SI distance conversion, and the per-row projection are all unit tested in
//  isolation; parity-pin tests assert the exact canonical SI factors so any drift from the
//  shared converters is caught mechanically.
//
//  Parity note: the web component reads SI straight off each vehicle's state
//  (`battery_level` is a percent, `rated_range` is metres) and converts the range at the
//  display boundary through `useUnits`. A vehicle whose per-vehicle state query rejects is
//  dropped from the list (web `q.state !== null`); `battery_level` is shown verbatim and is
//  not routed through the unit facade, exactly as the source does.
//

import Foundation

// MARK: - Vehicle (web `Vehicle` — the identity fields the panel reads)

/// The slice of the web `Vehicle` each bar identifies itself by — the stable `id` (chart key),
/// the `displayName`, and the `vin` fallback (web `vehicle.display_name || vehicle.vin`).
public struct BatteryComparisonVehicle: Sendable, Equatable, Identifiable {
    public let id: Int
    public let displayName: String
    public let vin: String

    public init(id: Int, displayName: String, vin: String) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web `vehicle.display_name || vehicle.vin`: the trimmed display name, falling back to the
    /// VIN when it is blank, so a bar is never label-less.
    public var label: String {
        let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? vin : trimmed
    }
}

// MARK: - Vehicle state (web `VehicleState` — only the two fields the bar reads)

/// The slice of the web `VehicleState` one bar consumes: `batteryLevel` (a 0–100 percent) and
/// `ratedRange` (SI metres). Carried as a tiny value type so the projection stays transport-free.
public struct BatteryComparisonVehicleState: Sendable, Equatable {
    /// The current charge percent (web `battery_level ?? 0`).
    public var batteryLevel: Double
    /// The rated range in SI metres (web `rated_range ?? 0`), converted at the display boundary.
    public var ratedRange: Double

    public init(batteryLevel: Double = 0, ratedRange: Double = 0) {
        self.batteryLevel = batteryLevel
        self.ratedRange = ratedRange
    }
}

// MARK: - Entry (web `{ vehicle, state }` query result)

/// One vehicle + its resolved state — the native mirror of the web query datum
/// `{ vehicle, state: VehicleState | null }`. A `nil` state marks a per-vehicle fetch that
/// rejected; those entries are dropped by `project` (web `q.state !== null`).
public struct BatteryComparisonEntry: Sendable, Equatable, Identifiable {
    public let vehicle: BatteryComparisonVehicle
    public let state: BatteryComparisonVehicleState?

    public var id: Int {
        vehicle.id
    }

    public init(vehicle: BatteryComparisonVehicle, state: BatteryComparisonVehicleState?) {
        self.vehicle = vehicle
        self.state = state
    }
}

// MARK: - Distance unit (web `useUnits().unitPrefs.distance`)

/// The user's distance display preference — the native mirror of the web `unitPrefs.distance`
/// symbol (`'km'` / `'mi'`), used as the rated-range unit label + conversion base.
public enum BatteryComparisonDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"

    /// Resolves the unit from the web preference symbol, defaulting to km (the metric default).
    public static func from(symbol: String) -> BatteryComparisonDistanceUnit {
        BatteryComparisonDistanceUnit(rawValue: symbol) ?? .kilometers
    }
}

// MARK: - Units (web `useUnits()` + global number-format settings)

/// The display preferences this surface reads — the native mirror of `useUnits()` distance
/// preference plus the global number-format locale/precision the `formatDistance` sublabel honours.
public struct BatteryComparisonUnits: Sendable, Equatable {
    public var distance: BatteryComparisonDistanceUnit
    public var precision: Int?
    public var localeIdentifier: String

    public init(
        distance: BatteryComparisonDistanceUnit = .kilometers,
        precision: Int? = nil,
        localeIdentifier: String = "en_US"
    ) {
        self.distance = distance
        self.precision = precision
        self.localeIdentifier = localeIdentifier
    }

    /// Metric defaults (km).
    public static let metric = BatteryComparisonUnits()

    /// Imperial defaults (mi).
    public static let imperial = BatteryComparisonUnits(distance: .miles)

    /// The resolved `Locale` for number formatting (web `Intl.NumberFormat` locale).
    public var locale: Locale {
        localeIdentifier.isEmpty ? .current : Locale(identifier: localeIdentifier)
    }
}

// MARK: - Semantic tint (web `batteryColor` hex constants → design-token role)

/// The semantic colour role a bar fills in — the native mirror of the web `batteryColor`
/// hex constants (`GOOD #10b981` / `WARN #f59e0b` / `BAD #ef4444`). The view maps each case to a
/// design token so no hex lives in the core (ADR-006 semantic colour parity).
public enum BatteryComparisonTint: String, Sendable, Equatable, CaseIterable {
    case success
    case warning
    case danger
}

/// The pure tint mapping the web derives from a charge level. Unit tested across the thresholds
/// so the bars pick the same colour `batteryColor` does.
public enum BatteryComparisonTintRules {
    /// Web `batteryColor(level)`: > 60 → green, > 25 → amber, else red.
    public static func battery(level: Double) -> BatteryComparisonTint {
        if level > 60 { return .success }
        if level > 25 { return .warning }
        return .danger
    }
}

// MARK: - SI conversion + number formatting (port of unitConversion.ts)

/// Pure SI → display-unit conversion and locale number formatting ported from the web helpers so
/// the rounding, grouping separators, unit label, and empty sentinel match the source exactly.
/// Kept local (not routed through the KMP `Units` facade) so the projection is deterministic and
/// unit-testable without the Kotlin runtime; parity-pin tests assert the exact canonical factors.
public enum BatteryComparisonFormat {
    public static let metersPerKilometer = 1000.0
    public static let metersPerMile = 1609.344

    /// The em-dash sentinel the web `resolveEmpty` returns for nullish / non-finite input.
    public static let dash = "—"

    /// Web `DEFAULT_PRECISION.distance` (unitConversion.ts) — the `formatDistance` fallback.
    public static let distancePrecision = 1

    /// Web `safeNumber`: a finite number, else 0.
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `convertDistanceFromSI(meters, to)` — metres → km / mi.
    public static func convertDistance(_ meters: Double, to unit: BatteryComparisonDistanceUnit) -> Double {
        unit == .miles ? meters / metersPerMile : meters / metersPerKilometer
    }

    /// Web `formatNumber(value, locale, digits)` — `Intl.NumberFormat` with fixed fraction digits,
    /// locale grouping, half-away rounding.
    public static func formatNumber(_ value: Double, digits: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "\(safe(value))"
    }

    /// Web `formatDistance(meters, pref, { precision })` — metres → display unit with the unit label
    /// spaced after the value; non-finite input yields the em-dash sentinel.
    public static func formatDistance(
        _ meters: Double,
        unit: BatteryComparisonDistanceUnit,
        precision: Int? = nil,
        locale: Locale = .current
    ) -> String {
        guard meters.isFinite else { return dash }
        let digits = precision ?? distancePrecision
        let value = convertDistance(meters, to: unit)
        return "\(formatNumber(value, digits: digits, locale: locale)) \(unit.rawValue)"
    }

    /// The integer charge percent shown verbatim (web `{level}%` for an integral `battery_level`).
    public static func percent(_ level: Double) -> Int {
        Int(safe(level).rounded())
    }

    /// The bar fill ratio, clamped to `0...1` (web CSS `width: ${level}%` under `overflow-hidden`).
    public static func fraction(_ level: Double) -> Double {
        Swift.min(Swift.max(safe(level) / 100, 0), 1)
    }
}

// MARK: - Bar (the projected row the view renders)

/// One resolved battery bar — the native mirror of a web row: the vehicle `label`, the pre-formatted
/// `percentText` (`"{level}%"`) + `rangeText` (`formatDistance(rated_range)`), the pre-clamped fill
/// `fraction`, and the semantic `tint`. The view is a pure function of this value.
public struct BatteryComparisonBar: Sendable, Equatable, Identifiable {
    public let id: Int
    public let label: String
    public let level: Int
    public let percentText: String
    public let rangeText: String
    public let fraction: Double
    public let tint: BatteryComparisonTint

    public init(
        id: Int,
        label: String,
        level: Int,
        percentText: String,
        rangeText: String,
        fraction: Double,
        tint: BatteryComparisonTint
    ) {
        self.id = id
        self.label = label
        self.level = level
        self.percentText = percentText
        self.rangeText = rangeText
        self.fraction = fraction
        self.tint = tint
    }
}

// MARK: - Projection (the adapter output the view renders)

/// The fully-computed projection the view renders: the resolved bars (in input order) plus the
/// `hasData` content/empty split (web `bars.length === 0 ? null : …`).
public struct BatteryComparisonProjection: Sendable, Equatable {
    public var bars: [BatteryComparisonBar]
    public var hasData: Bool

    public init(bars: [BatteryComparisonBar], hasData: Bool) {
        self.bars = bars
        self.hasData = hasData
    }
}

// MARK: - Builder (port of the web render mapping)

/// Pure functions that turn the fetched per-vehicle entries into the resolved bars the panel
/// plots — a 1:1 port of the web `bars.filter(state != null).map(...)` so both platforms show the
/// same rows.
public enum BatteryComparisonBuilder {
    /// Builds one bar from an entry's vehicle + resolved state (web row render).
    public static func bar(
        vehicle: BatteryComparisonVehicle,
        state: BatteryComparisonVehicleState,
        units: BatteryComparisonUnits
    ) -> BatteryComparisonBar {
        let level = state.batteryLevel
        return BatteryComparisonBar(
            id: vehicle.id,
            label: vehicle.label,
            level: BatteryComparisonFormat.percent(level),
            percentText: "\(BatteryComparisonFormat.percent(level))%",
            rangeText: BatteryComparisonFormat.formatDistance(
                state.ratedRange,
                unit: units.distance,
                precision: units.precision,
                locale: units.locale
            ),
            fraction: BatteryComparisonFormat.fraction(level),
            tint: BatteryComparisonTintRules.battery(level: level)
        )
    }

    /// Projects fetched entries into the render model: drop entries whose state is `nil` (web
    /// `q.state !== null`), map the rest to bars in order, and set the content/empty split.
    public static func project(
        _ entries: [BatteryComparisonEntry],
        units: BatteryComparisonUnits
    ) -> BatteryComparisonProjection {
        let bars = entries.compactMap { entry -> BatteryComparisonBar? in
            guard let state = entry.state else { return nil }
            return bar(vehicle: entry.vehicle, state: state, units: units)
        }
        return BatteryComparisonProjection(bars: bars, hasData: !bars.isEmpty)
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes content-vs-null (it returns
/// `null` when no bars resolve); the loading / error envelope around it (prompt P4 states) is
/// supplied by the bound source, mirroring the `useQuery` `isLoading` / failure lifecycle.
public enum BatteryComparisonPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the fleet-battery query (web `useQuery` pending / resolved /
/// failure), projected into a phase by `resolvePhase`.
public enum BatteryComparisonLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so cached
/// bars are clearly labelled while reconnecting / offline.
public enum BatteryComparisonConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

public extension BatteryComparisonBuilder {
    /// Resolves the render phase from the bound load status + whether any bar resolved (web
    /// `bars.length === 0 ? empty : content`).
    static func resolvePhase(_ status: BatteryComparisonLoadStatus, hasData: Bool) -> BatteryComparisonPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasData ? .content : .empty
        }
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free
/// core so it is reachable from the projection's unit tests.
public enum BatteryComparisonSurface {
    public static let slug = "BatteryComparison"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle, exactly like the
/// view's P1/S10 facade.
public enum BatteryComparisonAccessibility {
    /// The panel-level summary: title + the number of vehicles being compared.
    public static func panelSummary(
        barCount: Int,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("fleet.batteryStatus", "Fleet Battery Status")
        guard barCount > 0 else {
            return "\(title): \(localize("common.noData", "No data available"))"
        }
        let vehicles = localize("fleet.battery.vehiclesNoun", "vehicles")
        return "\(title): \(barCount) \(vehicles)"
    }

    /// One bar's VoiceOver value: "{label}: {level}%, {range}".
    public static func rowValue(_ bar: BatteryComparisonBar) -> String {
        "\(bar.label): \(bar.percentText), \(bar.rangeText)"
    }
}
