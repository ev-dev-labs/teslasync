//
//  Pressure.Adapter.swift
//  TeslaSync — P4 shared surface · 0086 · Pressure (Apple)
//
//  The testable, dependency-light core for the pressure renderer — the SwiftUI parity of
//  `components/data-display/format/Pressure.tsx`. Everything here is pure (Foundation + the in-module
//  `UnitPreferences` value type): the input snapshot (the web props + the `useUnits` preference bag),
//  the surface metadata (the diagnostics slug + the canonical SI factors), the SI conversion + locale
//  number formatter (the native shape of the web `convertPressureFromSI` + `fmtNumber` calls), and the
//  raw-value tooltip / VoiceOver builders. No store, no rendered view, so each piece is unit tested in
//  isolation. The conversion + formatting is reproduced locally (not routed through the KMP `Units`
//  facade) so the rounding, grouping separators, unit label, and the empty sentinel match the web
//  source exactly and the projection stays deterministic — the same disposition as the sibling 0085
//  Distance surface.
//
//  Parity note — SI carrier. The web fills a local `sourceBar` that, despite its legacy name, holds the
//  value in kilopascals (the SI canonical for pressure, per `unitConversion.ts`'s `SI.pressure = 'kPa'`):
//  it multiplies a `bar` input by 100 (kPa per bar) or a `psi` input by 6.894757 (kPa per psi) and then
//  converts that kPa figure to the user's unit. This core carries the same SI kPa value in
//  `PressureSource.kpa`, mirroring how the Distance core carries metres in `DistanceSource.meters`.
//
//  Parity note — states. The web source is a synchronous formatter: it reads its props plus the
//  `useUnits()` preference bag (a settings read, not a fetch) and returns a `<span>`. It has no
//  loading / error / stale / offline axis, so synthesising network chrome here would invent state the
//  web source does not have (the same disposition as the 0085 Distance + 0075 AnimatedNumber surfaces).
//  The genuine render branches this core models are exactly the ones the web has: the formatted value
//  (`{display} {unit}` with the raw caller value as the tooltip) and the empty sentinel (`—`) when
//  neither input is a finite number.
//
//  Parity note — i18n. The web component renders no translatable copy. The unit label (`bar` / `psi` /
//  `kPa`) is the user's `unitPrefs.pressure` symbol (caller/settings data, not this component's copy)
//  and the number is locale-formatted, so the only locale-sensitive output is the figure itself — bound
//  through the injected `UnitPreferences.locale` (the native parity of `fmtNumber`'s global-locale
//  read). The lone catalog key is the native empty-state VoiceOver label (web reads a bare "—"); see
//  Pressure.strings.
//

import Foundation

// MARK: - Input (web `PressureProps` + the `useUnits` preference bag)

/// One coalesced snapshot of the surface's inputs. `bar` / `psi` are the two mutually-exclusive caller
/// inputs (web checks `bar` first, then `psi`); `precision` is the optional per-call fraction-digit
/// override (web `precision` prop); `units` is the resolved `useUnits().unitPrefs` bag that drives the
/// target pressure unit, the global precision fallback, and the formatting locale. Equatable + Sendable
/// so the view can re-sync the model when the props or the active units change.
public struct PressureInput: Sendable, Equatable {
    public var bar: Double?
    public var psi: Double?
    public var precision: Int?
    public var units: UnitPreferences

    public init(
        bar: Double? = nil,
        psi: Double? = nil,
        precision: Int? = nil,
        units: UnitPreferences
    ) {
        self.bar = bar
        self.psi = psi
        self.precision = precision
        self.units = units
    }
}

// MARK: - Surface metadata (diagnostics slug + canonical SI factors)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`, the
/// canonical SI conversion factors (mirroring `unitConversion.ts`), the web `fmtNumber` global
/// precision default + clamp, and the empty sentinel the web renders for a nullish / non-finite input.
public enum PressureMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "Pressure"

    /// Canonical SI factors (web `KPA_PER_PSI` / `KPA_PER_BAR`) — kilopascals per psi / per bar. The web
    /// normalizes `bar * 100` and `psi * 6.894757` into kPa, then divides by these to display.
    public static let kpaPerPsi = 6.894757
    public static let kpaPerBar = 100.0

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

// MARK: - Normalized source (web `sourceBar` + `title`, computed together)

/// The caller value normalized to SI kilopascals plus the verbatim raw-value tooltip — the native
/// carrier for the web block that fills `sourceBar` (kPa, despite the legacy name) and `title`
/// together. `nil` is the empty branch (web `sourceBar == null`).
public struct PressureSource: Sendable, Equatable {
    /// The SI pressure in kilopascals (web `bar * 100` or `psi * 6.894757`).
    public let kpa: Double
    /// The raw caller value tooltip (web `${value.toFixed(2)} bar|psi`), with the input's own unit.
    public let title: String

    public init(kpa: Double, title: String) {
        self.kpa = kpa
        self.title = title
    }
}

// MARK: - Conversion + formatting (web `convertPressureFromSI` + `fmtNumber`)

/// The pure SI conversion + locale number formatting ported from the web helpers so the rounding, the
/// grouping separators, the unit label, the precision precedence, and the empty sentinel match the
/// source exactly. Value-type and deterministic — unit tested without the Kotlin runtime or a view.
public enum PressureFormatting {
    /// Web `safeNumber`: a finite number, else `0` (the converted kilopascals are always finite, so this
    /// is a defensive guard mirroring the web formatter contract).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `Number.isFinite(value)` — the guard the source applies to each candidate input.
    public static func isFiniteValue(_ value: Double?) -> Bool {
        guard let value else { return false }
        return value.isFinite
    }

    /// Web `convertPressureFromSI(kpa, to)` — kPa → kPa / psi / bar, defaulting an unknown label to bar
    /// (the web `derivePressure` default for a non-psi preference) so a stray preference never crashes
    /// the renderer.
    public static func convertPressureFromSI(_ kpa: Double, to unit: String) -> Double {
        switch unit {
        case "kPa": kpa
        case "psi": kpa / PressureMeta.kpaPerPsi
        default: kpa / PressureMeta.kpaPerBar
        }
    }

    /// Web `fmtNumber`'s `decimals ?? _globalPrecision` resolution: the per-call `precision` prop wins,
    /// then the user's precision preference (the native parity of the `useSettings`-set global
    /// precision), then the hard default of 2 — clamped to the web `setGlobalPrecision` range 0...20.
    public static func resolveDigits(precision: Int?, units: UnitPreferences) -> Int {
        let resolved = precision ?? units.precision ?? PressureMeta.defaultPrecision
        return min(max(0, resolved), PressureMeta.maxFractionDigits)
    }

    /// The formatting locale — web `fmtNumber`'s global-locale read with the "en-US" fallback for a
    /// nil / blank preference (`setGlobalLocale`).
    public static func locale(for units: UnitPreferences) -> Locale {
        guard
            let tag = units.locale,
            !tag.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return Locale(identifier: PressureMeta.fallbackLocaleIdentifier)
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

    /// Normalize the caller inputs to SI kilopascals + the raw-value tooltip — the web block that checks
    /// `bar` first (when finite), then `psi`, filling `sourceBar` (kPa) and `title` together; `nil` is
    /// the empty branch. The tooltip uses the input's own unit symbol and `toFixed(2)`-style fixed
    /// digits (locale-independent, matching the web `.toFixed(2)`).
    public static func source(bar: Double?, psi: Double?) -> PressureSource? {
        if isFiniteValue(bar), let bar {
            return PressureSource(
                kpa: bar * PressureMeta.kpaPerBar,
                title: "\(fixed(bar)) bar"
            )
        }
        if isFiniteValue(psi), let psi {
            return PressureSource(
                kpa: psi * PressureMeta.kpaPerPsi,
                title: "\(fixed(psi)) psi"
            )
        }
        return nil
    }

    /// The displayed string for a normalized SI pressure — convert to the user's unit, format at the
    /// resolved precision/locale, and append the unit label (web `{display} {pressureUnit}`).
    public static func display(kpa: Double, units: UnitPreferences, precision: Int?) -> String {
        let value = convertPressureFromSI(kpa, to: units.pressure)
        let digits = resolveDigits(precision: precision, units: units)
        let number = formatNumber(value, digits: digits, locale: locale(for: units))
        return "\(number) \(units.pressure)"
    }

    /// The web `value.toFixed(2)` parity — fixed fraction digits, "." decimal mark, no grouping,
    /// locale-independent (the POSIX format), so the tooltip reads identically to the source.
    private static func fixed(_ value: Double) -> String {
        String(format: "%.\(PressureMeta.titleFractionDigits)f", value)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver strings without rendering the view. The value branch voices the
/// formatted figure (self-describing, e.g. "2.40 bar"); the empty branch voices a localized label
/// ("No pressure data") so VoiceOver never announces a bare "—" (a native refinement over the web,
/// which exposes no `aria-label`).
public enum PressureAccessibility {
    /// The spoken label for the value branch — the displayed figure verbatim.
    public static func valueLabel(_ displayText: String) -> String {
        displayText
    }

    /// The spoken label for the empty branch — the localized "no data" copy.
    public static func emptyLabel(strings: PressureResolve = PressureStrings.string) -> String {
        strings("pressure.empty.accessibilityLabel", "No pressure data")
    }
}
