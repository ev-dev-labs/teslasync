//
//  Temperature.Adapter.swift
//  TeslaSync — P4 shared surface · 0089 · Temperature (Apple)
//
//  The testable, dependency-light core for the temperature renderer — the SwiftUI parity of
//  `components/data-display/format/Temperature.tsx`. Everything here is pure (Foundation + the in-module
//  `UnitPreferences` value type): the input snapshot (the web props + the `useUnits` preference bag),
//  the surface metadata (the diagnostics slug + the canonical unit labels), the SI conversion + locale
//  number formatter (the native shape of the web `convertTempFromSI` + `fmtNumber` calls), and the
//  raw-value tooltip / VoiceOver builders. No store, no rendered view, so each piece is unit tested in
//  isolation. The conversion + formatting is reproduced locally (not routed through the KMP `Units`
//  facade) so the rounding, the grouping separators, the unit label, the precision precedence, and the
//  empty sentinel match the web source exactly and the projection stays deterministic — the same
//  disposition as the 0085 Distance peer.
//
//  Parity note — states. The web source is a synchronous formatter: it reads its props plus the
//  `useUnits()` preference bag (a settings read, not a fetch) and returns a `<span>`. It has no
//  loading / error / stale / offline axis, so synthesising network chrome here would invent state the
//  web source does not have (the same disposition as the 0085 Distance + 0075 AnimatedNumber peers).
//  The genuine render branches this core models are exactly the ones the web has: the formatted value
//  (`{display}{tempUnit}` — note: NO separating space — with the raw caller value as the tooltip) and
//  the empty sentinel (`—`) when neither input is a finite number.
//
//  Parity note — i18n. The web component renders no translatable copy. The unit label (`°C` / `°F`) is
//  the user's `unitPrefs.temperature` symbol (caller/settings data, not this component's copy) and the
//  number is locale-formatted, so the only locale-sensitive output is the figure itself — bound through
//  the injected `UnitPreferences.locale` (the native parity of `fmtNumber`'s global-locale read). The
//  lone catalog key is the native empty-state VoiceOver label (web reads a bare "—"); see
//  Temperature.strings.
//

import Foundation

// MARK: - Input (web `TemperatureProps` + the `useUnits` preference bag)

/// One coalesced snapshot of the surface's inputs. `celsius` / `fahrenheit` are the two mutually-
/// exclusive caller inputs (web `c` / `f`, checked in that order); `precision` is the optional per-call
/// fraction-digit override (web `precision` prop); `units` is the resolved `useUnits().unitPrefs` bag
/// that drives the target temperature unit, the global precision fallback, and the formatting locale.
/// Equatable + Sendable so the view can re-sync the model when the props or the active units change.
public struct TemperatureInput: Sendable, Equatable {
    public var celsius: Double?
    public var fahrenheit: Double?
    public var precision: Int?
    public var units: UnitPreferences

    public init(
        celsius: Double? = nil,
        fahrenheit: Double? = nil,
        precision: Int? = nil,
        units: UnitPreferences
    ) {
        self.celsius = celsius
        self.fahrenheit = fahrenheit
        self.precision = precision
        self.units = units
    }
}

// MARK: - Surface metadata (diagnostics slug + canonical unit labels)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`, the
/// canonical temperature unit labels (mirroring `unitConversion.ts`), the web `fmtNumber` global
/// precision default + clamp, the tooltip's fixed fraction digits, and the empty sentinel the web
/// renders for a nullish / non-finite input.
public enum TemperatureMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "Temperature"

    /// The SI-base temperature label (web `'°C'`) — the canonical input + the metric display unit.
    public static let celsiusLabel = "°C"

    /// The imperial temperature label (web `'°F'`).
    public static let fahrenheitLabel = "°F"

    /// Web `numberFormat.ts` `_globalPrecision` initial value — the `fmtNumber` fallback when neither
    /// a `precision` prop nor a user precision preference is supplied.
    public static let defaultPrecision = 2

    /// Upper bound on fraction digits, matching the web `setGlobalPrecision` clamp of 0...20.
    public static let maxFractionDigits = 20

    /// Fixed fraction digits for the raw-value tooltip (web `value.toFixed(1)`).
    public static let titleFractionDigits = 1

    /// The em-dash sentinel the web renders when neither input is a finite number.
    public static let emptyDisplay = "—"

    /// The deterministic locale tag the web `fmtNumber` falls back to for a blank/invalid locale
    /// (`setGlobalLocale` → "en-US").
    public static let fallbackLocaleIdentifier = "en-US"
}

// MARK: - Normalized source (web `sourceC` + `title`, computed together)

/// The caller value normalized to SI Celsius plus the verbatim raw-value tooltip — the native carrier
/// for the web block that fills `sourceC` (°C) and `title` together. `nil` is the empty branch (web
/// `sourceC == null`).
public struct TemperatureSource: Sendable, Equatable {
    /// The SI temperature in Celsius (web `c`, or `((f - 32) * 5) / 9` for a Fahrenheit input).
    public let celsius: Double
    /// The raw caller value tooltip (web `${value.toFixed(1)} °C|°F`), with the input's own unit.
    public let title: String

    public init(celsius: Double, title: String) {
        self.celsius = celsius
        self.title = title
    }
}

// MARK: - Conversion + formatting (web `convertTempFromSI` + `fmtNumber`)

/// The pure SI conversion + locale number formatting ported from the web helpers so the rounding, the
/// grouping separators, the unit label, the precision precedence, and the empty sentinel match the
/// source exactly. Value-type and deterministic — unit tested without the Kotlin runtime or a view.
public enum TemperatureFormatting {
    /// Web `safeNumber`: a finite number, else `0` (the converted value is always finite, so this is a
    /// defensive guard mirroring the web formatter contract).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `Number.isFinite(value)` — the guard the source applies to each candidate input.
    public static func isFiniteValue(_ value: Double?) -> Bool {
        guard let value else { return false }
        return value.isFinite
    }

    /// Web `convertTempFromSI(celsius, to)` — Celsius → °C / °F, defaulting an unknown label to Celsius
    /// (the SI base) so a stray preference never crashes the renderer. The °F branch is the affine
    /// `celsius * 9 / 5 + 32` (web identical).
    public static func convertTempFromSI(_ celsius: Double, to unit: String) -> Double {
        switch unit {
        case TemperatureMeta.fahrenheitLabel: celsius * 9 / 5 + 32
        default: celsius
        }
    }

    /// Web `((f - 32) * 5) / 9` — the Fahrenheit-input normalization back to the SI Celsius base.
    public static func fahrenheitToCelsius(_ fahrenheit: Double) -> Double {
        (fahrenheit - 32) * 5 / 9
    }

    /// Web `fmtNumber`'s `decimals ?? _globalPrecision` resolution: the per-call `precision` prop wins,
    /// then the user's precision preference (the native parity of the `useSettings`-set global
    /// precision), then the hard default of 2 — clamped to the web `setGlobalPrecision` range 0...20.
    public static func resolveDigits(precision: Int?, units: UnitPreferences) -> Int {
        let resolved = precision ?? units.precision ?? TemperatureMeta.defaultPrecision
        return min(max(0, resolved), TemperatureMeta.maxFractionDigits)
    }

    /// The formatting locale — web `fmtNumber`'s global-locale read with the "en-US" fallback for a
    /// nil / blank preference (`setGlobalLocale`).
    public static func locale(for units: UnitPreferences) -> Locale {
        guard
            let tag = units.locale,
            !tag.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return Locale(identifier: TemperatureMeta.fallbackLocaleIdentifier)
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

    /// Normalize the caller inputs to SI Celsius + the raw-value tooltip — the web block that checks
    /// `c` first (when finite), then `f`, filling `sourceC` and `title` together; `nil` is the empty
    /// branch. The tooltip uses the input's own unit symbol and `toFixed(1)`-style fixed digits
    /// (locale-independent, matching the web `.toFixed(1)`).
    public static func source(celsius: Double?, fahrenheit: Double?) -> TemperatureSource? {
        if isFiniteValue(celsius), let celsius {
            return TemperatureSource(
                celsius: celsius,
                title: "\(fixed(celsius)) \(TemperatureMeta.celsiusLabel)"
            )
        }
        if isFiniteValue(fahrenheit), let fahrenheit {
            return TemperatureSource(
                celsius: fahrenheitToCelsius(fahrenheit),
                title: "\(fixed(fahrenheit)) \(TemperatureMeta.fahrenheitLabel)"
            )
        }
        return nil
    }

    /// The displayed string for a normalized SI temperature — convert to the user's unit, format at the
    /// resolved precision/locale, and append the unit label with NO separating space (web
    /// `{display}{tempUnit}`, e.g. "20°C").
    public static func display(celsius: Double, units: UnitPreferences, precision: Int?) -> String {
        let value = convertTempFromSI(celsius, to: units.temperature)
        let digits = resolveDigits(precision: precision, units: units)
        let number = formatNumber(value, digits: digits, locale: locale(for: units))
        return "\(number)\(units.temperature)"
    }

    /// The web `value.toFixed(1)` parity — fixed fraction digits, "." decimal mark, no grouping,
    /// locale-independent (the POSIX format), so the tooltip reads identically to the source.
    private static func fixed(_ value: Double) -> String {
        String(format: "%.\(TemperatureMeta.titleFractionDigits)f", value)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver strings without rendering the view. The value branch voices the
/// formatted figure (self-describing, e.g. "20°C"); the empty branch voices a localized label ("No
/// temperature data") so VoiceOver never announces a bare "—" (a native refinement over the web, which
/// exposes no `aria-label`).
public enum TemperatureAccessibility {
    /// The spoken label for the value branch — the displayed figure verbatim.
    public static func valueLabel(_ displayText: String) -> String {
        displayText
    }

    /// The spoken label for the empty branch — the localized "no data" copy.
    public static func emptyLabel(strings: TemperatureResolve = TemperatureStrings.string) -> String {
        strings("temperature.empty.accessibilityLabel", "No temperature data")
    }
}
