//
//  Speed.Adapter.swift
//  TeslaSync — P4 shared surface · 0088 · Speed (Apple)
//
//  The testable, dependency-light core for the speed renderer — the SwiftUI parity of
//  `components/data-display/format/Speed.tsx`. Everything here is pure (Foundation only): the surface
//  metadata (the diagnostics slug + the web defaults + the NIST conversion constants), the display
//  unit (`useUnits().unitPrefs.speed`, derived from the user's `unit_of_length` setting), the input/
//  output speed converters (the verbatim port of the web's `mph * 0.44704` / `(kmh * 1000) / 3600`
//  source-to-SI step and the `convertSpeedFromSI` SI-to-display step), the locale-aware number
//  formatter (the native shape of the web `fmtNumber(value, precision)` call), the locale-neutral
//  canonical string (the web `title` attribute's ``${value.toFixed(1)} <unit>``), the input snapshot
//  (the web props + the resolved settings), and the VoiceOver label builder. No store, no rendered
//  view, so each piece is unit tested in isolation.
//
//  Parity note — the misnamed SI variable. The web source assigns the SI metres-per-second value into a
//  local it calls `sourceMph` (`mph * 0.44704` and `(kmh * 1000) / 3600` both yield m/s, not mph). The
//  identifier is a known web-side misnomer; the semantic truth is metres-per-second. The native port
//  names it `sourceMps` and preserves the arithmetic exactly, so the rendered figures are byte-for-byte
//  the web's while the code reads honestly.
//
//  Parity note — states. The web source is purely presentational: it reads the user's display unit from
//  `useUnits()` (a synchronous selector over already-loaded settings — it issues no fetch) and renders a
//  caller-supplied `mph` / `kmh`. It has no asynchronous data source and therefore no loading / error /
//  stale / offline branch to mirror; synthesising such chrome would invent state the web source does not
//  have (the same disposition as the 0083 Currency, 0075 AnimatedNumber, and 0053 AIThinkingIndicator
//  surfaces). The genuine render branches this core models are exactly the web's: the value branch
//  (`{fmtNumber(convertSpeedFromSI(mps), precision)} {speedUnit}` with the raw source value + source
//  unit as the `title`) and the fallback branch (no finite `mph` / `kmh` → the em dash, no title).
//
//  Parity note — i18n. The web component renders no translatable copy (no `t()` call). Its only
//  locale-sensitive output is the number's grouping separators and decimal mark; the unit labels
//  (`"mph"` / `"km/h"`) are universal symbols carried verbatim from the preference, exactly as the
//  currency symbol is in the 0083 surface. The P1/S10 binding for this surface is therefore the injected
//  `Locale` that drives the number formatting, not a string catalog. See Speed.strings.
//

import Foundation

// MARK: - Surface metadata (diagnostics slug + web defaults + conversion constants)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`, the web
/// prop / formatter defaults (the em-dash fallback, the global precision default + its 0...20 clamp, the
/// `toFixed(1)` title precision), and the NIST-grade conversion constants the web `unitConversion` lib
/// uses.
public enum SpeedMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "Speed"

    /// The render for no finite `mph` / `kmh` input — the web `<span>—</span>` fallback.
    public static let defaultFallback = "—"

    /// The fraction-digit default when the `precision` prop is omitted — the web `fmtNumber` global
    /// precision (`_globalPrecision`, seeded from `settings.decimal_precision`, default 2).
    public static let defaultPrecision = 2

    /// Upper bound on fraction digits, matching the web `setGlobalPrecision` clamp of 0...20 so a
    /// negative or runaway `precision` can never throw inside the formatter.
    public static let maxFractionDigits = 20

    /// The title (tooltip) fraction-digit count — the web `value.toFixed(1)` for the raw source value.
    public static let titleFractionDigits = 1

    /// 1 mile = 1609.344 m exactly (international yard, NIST) — the web `METERS_PER_MILE`.
    public static let metersPerMile = 1609.344

    /// 1 km = 1000 m exactly — the web `METERS_PER_KM`.
    public static let metersPerKilometer = 1000.0

    /// Seconds in an hour — the web `SECONDS_PER_HOUR`.
    public static let secondsPerHour = 3600.0

    /// 1 mph = 0.44704 m/s exactly (= 1609.344 / 3600) — the web `mph * 0.44704` source-to-SI factor.
    public static let mpsPerMph = 0.44704
}

// MARK: - Display unit (web `useUnits().unitPrefs.speed`)

/// The speed display unit — the parity of the web `SpeedUnitPref` (`'mph' | 'km/h'`). Carries the
/// verbatim preference label rendered next to the figure and drives the SI-to-display conversion.
public enum SpeedUnitPref: String, Sendable, CaseIterable {
    case mph
    case kilometersPerHour

    /// The label rendered after the figure and used in the source-unit tooltip — the web literal
    /// preference strings (`"mph"` / `"km/h"`). Not localized: a universal unit symbol.
    public var label: String {
        switch self {
        case .mph: "mph"
        case .kilometersPerHour: "km/h"
        }
    }
}

// MARK: - Display settings (web `useUnits` + global precision selectors)

/// The slice of the user's settings this surface binds — the native parity of `useUnits()`'s speed
/// derivation plus the `fmtNumber` global precision. The surface reads these synchronously (the P1/S8
/// settings state-holder feeds them in production); there is no network access, exactly as the web
/// hooks perform none.
public struct SpeedDisplaySettings: Sendable, Equatable {
    /// The raw `settings.unit_of_length` value (`"mi"` selects imperial; anything else — including `nil`
    /// — selects metric), mirroring the web `deriveSpeed`.
    public let rawUnitOfLength: String?

    /// The global decimal precision — the web `_globalPrecision` (`settings.decimal_precision`,
    /// default 2). Used when the `precision` prop is omitted.
    public let decimalPrecision: Int

    public init(rawUnitOfLength: String? = nil, decimalPrecision: Int = SpeedMeta.defaultPrecision) {
        self.rawUnitOfLength = rawUnitOfLength
        self.decimalPrecision = decimalPrecision
    }

    /// The resolved display unit — the verbatim port of the web `deriveSpeed`:
    /// `unitOfLength === 'mi' ? 'mph' : 'km/h'`. A `nil`, `"km"`, or any non-`"mi"` value resolves to
    /// km/h.
    public var speedUnit: SpeedUnitPref {
        rawUnitOfLength == "mi" ? .mph : .kilometersPerHour
    }
}

// MARK: - Conversion (web source-to-SI + `convertSpeedFromSI`)

/// The pure speed converters — the native port of the web's two-step transform: the caller's `mph` /
/// `kmh` to SI metres-per-second, then `convertSpeedFromSI(mps, unit)` from SI to the display unit. Each
/// function is deterministic and matches the web factors exactly so the figures are byte-for-byte the
/// web's.
public enum SpeedConversion {
    /// Web `mph * 0.44704` — miles-per-hour to SI metres-per-second.
    public static func mphToMps(_ mph: Double) -> Double {
        mph * SpeedMeta.mpsPerMph
    }

    /// Web `(kmh * 1000) / 3600` — kilometres-per-hour to SI metres-per-second.
    public static func kilometersPerHourToMps(_ kmh: Double) -> Double {
        (kmh * SpeedMeta.metersPerKilometer) / SpeedMeta.secondsPerHour
    }

    /// Web `convertSpeedFromSI(mps, to)` — SI metres-per-second to the display unit:
    /// km/h via `mps * 3600 / 1000`, mph via `mps * 3600 / 1609.344`.
    public static func fromSI(_ mps: Double, to unit: SpeedUnitPref) -> Double {
        switch unit {
        case .kilometersPerHour:
            (mps * SpeedMeta.secondsPerHour) / SpeedMeta.metersPerKilometer
        case .mph:
            (mps * SpeedMeta.secondsPerHour) / SpeedMeta.metersPerMile
        }
    }
}

// MARK: - Number formatting (web `fmtNumber` + the `value.toFixed(1)` title)

/// The pure formatting core — the native port of the web `fmtNumber(value, precision)` (the visible,
/// locale-aware number) and the `value.toFixed(1)` used for the `title` attribute's raw source value.
/// Every function is deterministic and value-type (no shared mutable formatter escapes), so the rendered
/// output is asserted without a view.
public enum SpeedFormatting {
    /// Web `safeNumber`: a non-finite value (NaN / ±Infinity) formats as zero rather than reaching the
    /// formatter and producing "NaN". The input precedence already screens these out before display, so
    /// this only hardens the formatter itself.
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Clamp the fraction-digit count to the web `setGlobalPrecision` range (0...20) so a negative or
    /// runaway precision can never make the formatter throw.
    public static func clampPrecision(_ precision: Int) -> Int {
        min(max(0, precision), SpeedMeta.maxFractionDigits)
    }

    /// Locale-aware number formatting — the native parity of `fmtNumber`: a fixed number of fraction
    /// digits (clamped 0...20) with locale grouping separators, rounding half away from zero to match
    /// `Intl.NumberFormat`'s default `halfExpand`, and the `safeNumber` fallback to `0`.
    public static func number(_ value: Double, precision: Int, locale: Locale) -> String {
        let digits = clampPrecision(precision)
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        let safeValue = safe(value)
        return formatter.string(from: NSNumber(value: safeValue)) ?? String(format: "%.\(digits)f", safeValue)
    }

    /// Locale-neutral fixed-point string — the native parity of `value.toFixed(precision)`: no grouping,
    /// a `.` decimal mark, and a fixed fraction-digit count. Used for the title's raw source value so the
    /// figure is unambiguous regardless of the display locale.
    public static func fixed(_ value: Double, precision: Int) -> String {
        let digits = clampPrecision(precision)
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        let safeValue = safe(value)
        return formatter.string(from: NSNumber(value: safeValue)) ?? String(format: "%.\(digits)f", safeValue)
    }
}

// MARK: - Resolved source (which input branch the web took)

/// The chosen input source — the web's branch selection between the `mph` and `kmh` props. Carries the
/// raw caller value (for the `title`), its source unit, and the derived SI metres-per-second (the web's
/// misnamed `sourceMph`).
public struct SpeedSource: Sendable, Equatable {
    /// The raw caller value in its source unit (web `mph` or `kmh`), used for the `title` tooltip.
    public let rawValue: Double

    /// The unit the raw value was supplied in (web `"mph"` / `"km/h"` title suffix).
    public let sourceUnit: SpeedUnitPref

    /// The SI metres-per-second derived from the raw value — the web's (misnamed) `sourceMph`.
    public let mps: Double

    public init(rawValue: Double, sourceUnit: SpeedUnitPref, mps: Double) {
        self.rawValue = rawValue
        self.sourceUnit = sourceUnit
        self.mps = mps
    }
}

// MARK: - Input (web `SpeedProps` + the resolved settings)

/// One coalesced snapshot of the surface's inputs — the web props plus the `useUnits` / global-precision
/// settings. `mph` is the canonical input (preferred when finite); `kmh` is the alternative (converted
/// when `mph` is absent / non-finite); `precision` overrides the global fraction-digit default;
/// `fallback` is the no-value render (web em dash); `settings` carries the display unit + global
/// precision; `locale` carries the grouping / decimal conventions the web reads from the global
/// formatter. Equatable so the view can adopt a changed snapshot.
public struct SpeedInput: Sendable, Equatable {
    public var mph: Double?
    public var kmh: Double?
    public var precision: Int?
    public var fallback: String
    public var settings: SpeedDisplaySettings
    public var locale: Locale

    public init(
        mph: Double? = nil,
        kmh: Double? = nil,
        precision: Int? = nil,
        fallback: String = SpeedMeta.defaultFallback,
        settings: SpeedDisplaySettings = SpeedDisplaySettings(),
        locale: Locale = .autoupdatingCurrent
    ) {
        self.mph = mph
        self.kmh = kmh
        self.precision = precision
        self.fallback = fallback
        self.settings = settings
        self.locale = locale
    }

    /// The display unit the figure is rendered in — the web `useUnits().unitPrefs.speed`.
    public var speedUnit: SpeedUnitPref {
        settings.speedUnit
    }

    /// The effective fraction-digit count — the `precision` prop when present, else the settings global
    /// precision (the web `fmtNumber(value, precision)` where `precision ?? _globalPrecision`).
    public var effectivePrecision: Int {
        precision ?? settings.decimalPrecision
    }

    /// The chosen input source, or `nil` for the fallback branch — the verbatim port of the web
    /// precedence: a finite `mph` wins (to SI via `* 0.44704`); else a finite `kmh` (to SI via
    /// `* 1000 / 3600`); else neither (the `—` branch). A present-but-non-finite `mph` falls through to
    /// `kmh`, exactly as `mph != null && Number.isFinite(mph)` does.
    public var resolvedSource: SpeedSource? {
        if let mph, mph.isFinite {
            return SpeedSource(rawValue: mph, sourceUnit: .mph, mps: SpeedConversion.mphToMps(mph))
        }
        if let kmh, kmh.isFinite {
            return SpeedSource(
                rawValue: kmh,
                sourceUnit: .kilometersPerHour,
                mps: SpeedConversion.kilometersPerHourToMps(kmh)
            )
        }
        return nil
    }

    /// Whether a finite `mph` / `kmh` is present — the inverse of the web `sourceMph == null` guard.
    public var hasRenderableValue: Bool {
        resolvedSource != nil
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver string from the input, so the spoken content is asserted without
/// rendering the view. The web is a bare `<span>` with a `title`; the native refinement voices the
/// visible figure (`{localized number} {unit}`) on the value branch and the `fallback` glyph on the
/// fallback branch, so VoiceOver announces what is on screen rather than a bare number.
public enum SpeedAccessibility {
    /// The spoken label for the surface — the visible display string, or the fallback glyph.
    public static func label(_ input: SpeedInput) -> String {
        guard let source = input.resolvedSource else { return input.fallback }
        let displayValue = SpeedConversion.fromSI(source.mps, to: input.speedUnit)
        let number = SpeedFormatting.number(
            displayValue,
            precision: input.effectivePrecision,
            locale: input.locale
        )
        return "\(number) \(input.speedUnit.label)"
    }
}
