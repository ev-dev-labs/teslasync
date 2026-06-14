//
//  VehicleHeroCard.Adapter.swift
//  TeslaSync — P4 shared surface · 0233 · VehicleHeroCard (Apple)
//
//  The testable, dependency-light core for the vehicle hero card — the SwiftUI parity of
//  `web/src/components/vehicles/VehicleHeroCard.tsx`. Everything here is pure (Foundation only): the surface
//  identity (the P1/S11 diagnostics slug + the canonical SI factors mirrored from `lib/unitConversion.ts`),
//  the i18n facade seam (the native shape of the web `t(key, default)`), the SI → display converters
//  (`convertDistanceFromSI` / `convertTempFromSI`), the JS-faithful rounders + number formatters
//  (`Math.round` half-toward-+∞ for the gauge/stat ints, `fmtInt` / `fmtNumber` grouped-half-up for the
//  odometer/power, both 1:1 with `lib/numberFormat.ts`), and the vehicle-status catalog (the web
//  `toStatus()` validity gate against `FSM_REGISTRY.vehicle.states`, falling back to `offline`). No SwiftUI
//  and no `@Observable`, so every rule is unit-testable in isolation. The SI conversion is reproduced locally
//  (not routed through the KMP `Units` facade) so the rounding + unit labels match the web source exactly and
//  the projection stays deterministic — the same disposition as the sibling 0176 ActiveVehicleSegment.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug) + SI factors

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11) and the
/// canonical SI distance factors (mirroring `lib/unitConversion.ts`). Kept SwiftUI-free so the state-holder
/// can emit telemetry and the projector can convert without depending on the view layer.
public enum VehicleHeroCardSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "VehicleHeroCard"

    /// Canonical SI factors (web `METERS_PER_MILE` / `METERS_PER_KM` / `METERS_PER_FOOT`).
    public static let metersPerMile = 1609.344
    public static let metersPerKm = 1000.0
    public static let metersPerFoot = 0.3048

    /// Range-gauge max per display unit (web `rangeMax = distance === 'km' ? 644 : 400`).
    public static func rangeMax(distanceUnit: String) -> Double {
        distanceUnit == "km" ? 644 : 400
    }

    /// Temperature-gauge max per display unit (web `tempMax = temperature === '°C' ? 50 : 122`).
    public static func tempMax(temperatureUnit: String) -> Double {
        temperatureUnit == "°C" ? 50 : 122
    }
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// `@Sendable` closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias VehicleHeroCardResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - SI → display converters (web `lib/unitConversion.ts`)

/// The pure SI → display converters the gauges + stat cards read — verbatim ports of the web
/// `convertDistanceFromSI` / `convertTempFromSI`, defaulting an unknown unit to its SI-adjacent base rather
/// than crashing the renderer.
public enum VehicleHeroCardConvert {
    /// Web `convertDistanceFromSI(meters, to)` — metres → km / mi / ft (unknown → km, the metric base).
    public static func distanceFromSI(_ meters: Double, to unit: String) -> Double {
        switch unit {
        case "mi": meters / VehicleHeroCardSurface.metersPerMile
        case "ft": meters / VehicleHeroCardSurface.metersPerFoot
        default: meters / VehicleHeroCardSurface.metersPerKm
        }
    }

    /// Web `convertTempFromSI(celsius, to)` — °C → °F (`(c·9/5)+32`); any non-`°F` unit stays Celsius.
    public static func tempFromSI(_ celsius: Double, to unit: String) -> Double {
        unit == "°F" ? (celsius * 9 / 5) + 32 : celsius
    }
}

// MARK: - Numeric formatting (web `lib/numberFormat.ts`) + JS rounding

/// The number presenters the hero card uses — the native peers of the web `fmtInt` / `fmtNumber` (grouped,
/// locale-aware, NaN/±∞ → 0) plus the gauge's `fmtNumber(clamped, isInteger ? 0 : precision)` rule, and the
/// JS `Math.round` (half toward +∞) used for the rounded gauge/stat integers. The global decimal precision
/// defaults to `2` (web `getGlobalPrecision()`); en-US grouping keeps the output deterministic in tests.
public enum VehicleHeroCardFormat {
    /// Web `getGlobalPrecision()` default — the fraction digits `fmtNumber` and the gauge use when a value
    /// is non-integer and no per-call override is supplied.
    public static let globalPrecision = 2

    /// JS `Math.round(x)` — round half toward +∞ (`Math.round(2.5) == 3`, `Math.round(-2.5) == -2`), which
    /// differs from Swift's away-from-zero default for negative halves (cabin temps can go below zero).
    public static func jsRound(_ value: Double) -> Int {
        guard value.isFinite else { return 0 }
        return Int((value + 0.5).rounded(.down))
    }

    /// Web `safeNumber(v)` — a finite number or `0` for NaN / ±∞.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `fmtNumber(v, decimals)` — grouped, locale-aware, half-up, NaN/±∞ → 0. `decimals` defaults to the
    /// global precision.
    public static func fmtNumber(_ value: Double, decimals: Int? = nil) -> String {
        format(safeNumber(value), fraction: decimals ?? globalPrecision)
    }

    /// Web `fmtInt(v)` — `fmtNumber(v, 0)`: grouped integer, half-up, NaN/±∞ → 0.
    public static func fmtInt(_ value: Double) -> String {
        format(safeNumber(value), fraction: 0)
    }

    /// Web `RadialGauge` display value: `fmtNumber(clamped, decimals ?? (Number.isInteger(clamped) ? 0 :
    /// getGlobalPrecision()))`. An integer reads with no fraction; a fractional value reads at the global
    /// precision.
    public static func gaugeValue(_ value: Double) -> String {
        let safe = safeNumber(value)
        let isInteger = safe.rounded() == safe
        return format(safe, fraction: isInteger ? 0 : globalPrecision)
    }

    /// Shared en-US grouped formatter (web `toLocaleString('en-US', { min/maxFractionDigits })`). A fresh
    /// formatter per call keeps the core free of shared mutable state under Swift 6 strict concurrency.
    private static func format(_ value: Double, fraction: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_US")
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = fraction
        formatter.maximumFractionDigits = fraction
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}

// MARK: - VehicleHeroCardStatus (web `toStatus` + `FSM_REGISTRY.vehicle.states`)

/// The validated vehicle status — the native peer of the web `toStatus(state)` (a raw string is kept only
/// when it is a real `FSM_REGISTRY.vehicle.states` member, else it falls back to `offline`). The seven cases
/// are `internal/enums/constants.go` + the frontend-only `updating`. The displayed label is the capitalized
/// raw value (web `StatusBadge`'s `capitalize` on the raw status — not localized in the web source).
public enum VehicleHeroCardStatus: String, Sendable, Equatable, CaseIterable {
    case online
    case driving
    case charging
    case parked
    case updating
    case asleep
    case offline

    /// Web `toStatus(state)` — `state in FSM_REGISTRY.vehicle.states ? state : 'offline'`. Case-folded so an
    /// upper/mixed-case API value still resolves to its canonical state.
    public static func from(_ raw: String?) -> VehicleHeroCardStatus {
        guard let raw, let status = VehicleHeroCardStatus(rawValue: raw.lowercased()) else { return .offline }
        return status
    }

    /// The capitalized label the badge renders (web CSS `capitalize` on the raw status string).
    public var label: String {
        rawValue.capitalized
    }
}
