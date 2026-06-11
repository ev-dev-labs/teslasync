//
//  Distance.Adapter.swift
//  TeslaSync — P4 shared surface · 0085 · Distance (Apple)
//
//  The testable, dependency-light core for the distance renderer — the SwiftUI parity of
//  `components/data-display/format/Distance.tsx`. Everything here is pure (Foundation + the in-module
//  `UnitPreferences` value type): the input snapshot (the web props + the `useUnits` preference bag),
//  the surface metadata (the diagnostics slug + the canonical SI factors), the SI conversion + locale
//  number formatter (the native shape of the web `convertDistanceFromSI` + `fmtNumber` calls), and the
//  raw-value tooltip / VoiceOver builders. No store, no rendered view, so each piece is unit tested in
//  isolation. The conversion + formatting is reproduced locally (not routed through the KMP `Units`
//  facade) so the rounding, grouping separators, unit label, and the empty sentinel match the web
//  source exactly and the projection stays deterministic — the same disposition as the QuickStatsGrid
//  feature formatter.
//
//  Parity note — states. The web source is a synchronous formatter: it reads its props plus the
//  `useUnits()` preference bag (a settings read, not a fetch) and returns a `<span>`. It has no
//  loading / error / stale / offline axis, so synthesising network chrome here would invent state the
//  web source does not have (the same disposition as the 0075 AnimatedNumber surface). The genuine
//  render branches this core models are exactly the ones the web has: the formatted value (`{display}
//  {unit}` with the raw caller value as the tooltip) and the empty sentinel (`—`) when neither input
//  is a finite number.
//
//  Parity note — i18n. The web component renders no translatable copy. The unit label (`mi` / `km`)
//  is the user's `unitPrefs.distance` symbol (caller/settings data, not this component's copy) and the
//  number is locale-formatted, so the only locale-sensitive output is the figure itself — bound
//  through the injected `UnitPreferences.locale` (the native parity of `fmtNumber`'s global-locale
//  read). The lone catalog key is the native empty-state VoiceOver label (web reads a bare "—"); see
//  Distance.strings.
//

import Foundation

// MARK: - Input (web `DistanceProps` + the `useUnits` preference bag)

/// One coalesced snapshot of the surface's inputs. `miles` / `km` are the two mutually-exclusive
/// caller inputs (web checks `miles` first, then `km`); `precision` is the optional per-call
/// fraction-digit override (web `precision` prop); `units` is the resolved `useUnits().unitPrefs` bag
/// that drives the target distance unit, the global precision fallback, and the formatting locale.
/// Equatable + Sendable so the view can re-sync the model when the props or the active units change.
public struct DistanceInput: Sendable, Equatable {
    public var miles: Double?
    public var km: Double?
    public var precision: Int?
    public var units: UnitPreferences

    public init(
        miles: Double? = nil,
        km: Double? = nil,
        precision: Int? = nil,
        units: UnitPreferences
    ) {
        self.miles = miles
        self.km = km
        self.precision = precision
        self.units = units
    }
}

// MARK: - Surface metadata (diagnostics slug + canonical SI factors)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`, the
/// canonical SI conversion factors (mirroring `unitConversion.ts`), the web `fmtNumber` global
/// precision default + clamp, and the empty sentinel the web renders for a nullish / non-finite input.
public enum DistanceMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "Distance"

    /// Canonical SI factors (web `METERS_PER_MILE` / `METERS_PER_KM` / `METERS_PER_FOOT`).
    public static let metersPerMile = 1609.344
    public static let metersPerKm = 1000.0
    public static let metersPerFoot = 0.3048

    /// Web `numberFormat.ts` `_globalPrecision` initial value — the `fmtNumber` fallback when neither
    /// a `precision` prop nor a user precision preference is supplied.
    public static let defaultPrecision = 2

    /// Upper bound on fraction digits, matching the web `setGlobalPrecision` clamp of 0...20.
    public static let maxFractionDigits = 20

    /// Fixed fraction digits for the raw-value tooltip (web `value.toFixed(2)`).
    public static let titleFractionDigits = 2

    /// The em-dash sentinel the web renders when neither input is a finite number.
    public static let emptyDisplay = "—"

    /// The deterministic locale tag the web `fmtNumber` falls back to for a blank/invalid locale
    /// (`setGlobalLocale` → "en-US").
    public static let fallbackLocaleIdentifier = "en-US"
}

// MARK: - Normalized source (web `sourceMiles` + `title`, computed together)

/// The caller value normalized to SI metres plus the verbatim raw-value tooltip — the native carrier
/// for the web block that fills `sourceMiles` (metres, despite the legacy name) and `title` together.
/// `nil` is the empty branch (web `sourceMiles == null`).
public struct DistanceSource: Sendable, Equatable {
    /// The SI distance in metres (web `miles * 1609.344` or `km * 1000`).
    public let meters: Double
    /// The raw caller value tooltip (web `${value.toFixed(2)} mi|km`), with the input's own unit.
    public let title: String

    public init(meters: Double, title: String) {
        self.meters = meters
        self.title = title
    }
}

// MARK: - Conversion + formatting (web `convertDistanceFromSI` + `fmtNumber`)

/// The pure SI conversion + locale number formatting ported from the web helpers so the rounding, the
/// grouping separators, the unit label, the precision precedence, and the empty sentinel match the
/// source exactly. Value-type and deterministic — unit tested without the Kotlin runtime or a view.
public enum DistanceFormatting {
    /// Web `safeNumber`: a finite number, else `0` (the converted metres are always finite, so this is
    /// a defensive guard mirroring the web formatter contract).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `Number.isFinite(value)` — the guard the source applies to each candidate input.
    public static func isFiniteValue(_ value: Double?) -> Bool {
        guard let value else { return false }
        return value.isFinite
    }

    /// Web `convertDistanceFromSI(meters, to)` — metres → km / mi / ft, defaulting an unknown label to
    /// km (the SI-adjacent metric base) so a stray preference never crashes the renderer.
    public static func convertDistanceFromSI(_ meters: Double, to unit: String) -> Double {
        switch unit {
        case "mi": meters / DistanceMeta.metersPerMile
        case "ft": meters / DistanceMeta.metersPerFoot
        default: meters / DistanceMeta.metersPerKm
        }
    }

    /// Web `fmtNumber`'s `decimals ?? _globalPrecision` resolution: the per-call `precision` prop wins,
    /// then the user's precision preference (the native parity of the `useSettings`-set global
    /// precision), then the hard default of 2 — clamped to the web `setGlobalPrecision` range 0...20.
    public static func resolveDigits(precision: Int?, units: UnitPreferences) -> Int {
        let resolved = precision ?? units.precision ?? DistanceMeta.defaultPrecision
        return min(max(0, resolved), DistanceMeta.maxFractionDigits)
    }

    /// The formatting locale — web `fmtNumber`'s global-locale read with the "en-US" fallback for a
    /// nil / blank preference (`setGlobalLocale`).
    public static func locale(for units: UnitPreferences) -> Locale {
        guard
            let tag = units.locale,
            !tag.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return Locale(identifier: DistanceMeta.fallbackLocaleIdentifier)
        }
        return Locale(identifier: tag)
    }

    /// Web `fmtNumber(value, decimals)` → `toLocaleString(locale, { min == max fraction digits })`:
    /// locale grouping, fixed fraction digits, half-away-from-zero rounding (the `Intl.NumberFormat`
    /// default, matched by `NumberFormatter.RoundingMode.halfUp`). The formatter is created locally so
    /// the surface holds no shared mutable formatter state.
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

    /// Normalize the caller inputs to SI metres + the raw-value tooltip — the web block that checks
    /// `miles` first (when finite), then `km`, filling `sourceMiles` (metres) and `title` together;
    /// `nil` is the empty branch. The tooltip uses the input's own unit symbol and `toFixed(2)`-style
    /// fixed digits (locale-independent, matching the web `.toFixed(2)`).
    public static func source(miles: Double?, km: Double?) -> DistanceSource? {
        if isFiniteValue(miles), let miles {
            return DistanceSource(
                meters: miles * DistanceMeta.metersPerMile,
                title: "\(fixed(miles)) mi"
            )
        }
        if isFiniteValue(km), let km {
            return DistanceSource(
                meters: km * DistanceMeta.metersPerKm,
                title: "\(fixed(km)) km"
            )
        }
        return nil
    }

    /// The displayed string for a normalized SI distance — convert to the user's unit, format at the
    /// resolved precision/locale, and append the unit label (web `{display} {distanceUnit}`).
    public static func display(meters: Double, units: UnitPreferences, precision: Int?) -> String {
        let value = convertDistanceFromSI(meters, to: units.distance)
        let digits = resolveDigits(precision: precision, units: units)
        let number = formatNumber(value, digits: digits, locale: locale(for: units))
        return "\(number) \(units.distance)"
    }

    /// The web `value.toFixed(2)` parity — fixed fraction digits, "." decimal mark, no grouping,
    /// locale-independent (the POSIX format), so the tooltip reads identically to the source.
    private static func fixed(_ value: Double) -> String {
        String(format: "%.\(DistanceMeta.titleFractionDigits)f", value)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver strings without rendering the view. The value branch voices the
/// formatted figure (self-describing, e.g. "12.4 km"); the empty branch voices a localized label
/// ("No distance data") so VoiceOver never announces a bare "—" (a native refinement over the web,
/// which exposes no `aria-label`).
public enum DistanceAccessibility {
    /// The spoken label for the value branch — the displayed figure verbatim.
    public static func valueLabel(_ displayText: String) -> String {
        displayText
    }

    /// The spoken label for the empty branch — the localized "no data" copy.
    public static func emptyLabel(strings: DistanceResolve = DistanceStrings.string) -> String {
        strings("distance.empty.accessibilityLabel", "No distance data")
    }
}
