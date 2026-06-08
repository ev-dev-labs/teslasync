//
//  WeatherAtCarWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0115 · WeatherAtCarWidget (Apple)
//
//  Pure (Foundation-only) projection: a cached `WeatherStateDTO` + `WeatherUnitPrefs`
//  → display strings + the SF Symbol for the conditions glyph, reproducing the web
//  source's pipeline VERBATIM so the native surface shows the exact same values as
//  features/dashboard/widgets/WeatherAtCarWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting + glyph
//  selection can be compiled and executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Temperature conversion (ported 1:1 from web lib/unitConversion.ts)

/// Temperature converter ported 1:1 from `convertTempFromSI(celsius, to)` in
/// `lib/unitConversion.ts`: Celsius passes through; Fahrenheit is `c * 9 / 5 + 32`.
/// The web widget feeds it `state.outside_temp`, which arrives in degrees Celsius
/// (the SI-floor stored by the Phase-42 pipeline). Non-finite inputs collapse to 0
/// to match the web `safeNumber` guard the formatter applies downstream.
func convertWeatherTempFromSI(_ celsius: Double, to unit: WeatherTemperatureUnit) -> Double {
    let safe = celsius.isFinite ? celsius : 0
    switch unit {
    case .celsius:
        return safe
    case .fahrenheit:
        return safe * 9 / 5 + 32
    }
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts `fmtInt`/`fmtNumber`)

/// Locale-aware decimal formatting that mirrors the web `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`), rounding half
/// away from zero to match `Intl.NumberFormat`'s default `halfExpand`. The widget's
/// temperature read uses `fmtInt`, i.e. `number(_, decimals: 0)`.
public enum WeatherAtCarFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, half-away-from-zero.
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

    /// `fmtInt(v)` — integer with locale grouping (web `fmtNumber(v, 0)`).
    public static func int(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }
}

// MARK: - Conditions glyph (ported from web `WeatherIcon`)

/// The conditions glyph chosen for an outside temperature, the native parity of the web
/// `WeatherIcon({ tempC })`. The thresholds run on the RAW Celsius value (not the display
/// value), exactly like the source: `tempC <= 0` → snow, `tempC >= 25` → sun, else
/// partly-cloudy. The `symbol` is the SF Symbol the SwiftUI view renders.
public enum WeatherCondition: String, Equatable, CaseIterable {
    case freezing
    case warm
    case mild

    /// Maps a raw Celsius reading to a condition band (web `WeatherIcon` thresholds).
    public static func forCelsius(_ celsius: Double) -> WeatherCondition {
        let safe = celsius.isFinite ? celsius : 0
        if safe <= 0 { return .freezing }
        if safe >= 25 { return .warm }
        return .mild
    }

    /// The SF Symbol parity of the web lucide glyph
    /// (`CloudSnow` → snow, `Sun` → sun, `CloudSun` → partly cloudy).
    public var symbolName: String {
        switch self {
        case .freezing: "cloud.snow.fill"
        case .warm: "sun.max.fill"
        case .mild: "cloud.sun.fill"
        }
    }

    /// i18n key for the VoiceOver description of the glyph (decorative in the source, but
    /// the native surface still names it so the icon isn't an unlabeled image).
    public var accessibilityKey: String {
        switch self {
        case .freezing: "widget.weatherAtCar.condition.freezing"
        case .warm: "widget.weatherAtCar.condition.warm"
        case .mild: "widget.weatherAtCar.condition.mild"
        }
    }

    /// English fallback for the VoiceOver description.
    public var accessibilityFallback: String {
        switch self {
        case .freezing: "Freezing"
        case .warm: "Warm"
        case .mild: "Mild"
        }
    }
}

// MARK: - Coordinate formatting (ported from web `toFixed(2)` lat/long line)

/// Formats the vehicle location the way the web source does
/// (`{lat.toFixed(2)}°, {long.toFixed(2)}°`), returning `nil` when either coordinate is
/// missing so the line is omitted — mirroring `latitude != null && longitude != null`.
func weatherCoordinatePair(latitude: Double?, longitude: Double?) -> String? {
    guard let latitude, let longitude, latitude.isFinite, longitude.isFinite else { return nil }
    let lat = String(format: "%.2f", latitude)
    let lon = String(format: "%.2f", longitude)
    return "\(lat)°, \(lon)°"
}

// MARK: - Projection

/// The fully-projected widget content: the formatted temperature value + unit symbol, the
/// conditions glyph, the raw Celsius reading (kept for the glyph + a11y) and the optional
/// coordinate line. Computed once per snapshot by the model so the view stays declarative.
public struct WeatherAtCarProjection: Equatable {
    /// Localized integer temperature in the display unit (web `fmtInt(convertTempFromSI(…))`).
    public let temperatureValue: String
    /// The display-unit symbol appended with no space (web `{tempUnit}` → "°C" / "°F").
    public let temperatureUnit: String
    /// The conditions band derived from the raw Celsius reading.
    public let condition: WeatherCondition
    /// The raw outside temperature in Celsius (SI), preserved for the glyph + a11y.
    public let outsideTempCelsius: Double
    /// The "lat°, long°" line, or `nil` when either coordinate is missing.
    public let coordinateText: String?

    public init(
        temperatureValue: String,
        temperatureUnit: String,
        condition: WeatherCondition,
        outsideTempCelsius: Double,
        coordinateText: String?
    ) {
        self.temperatureValue = temperatureValue
        self.temperatureUnit = temperatureUnit
        self.condition = condition
        self.outsideTempCelsius = outsideTempCelsius
        self.coordinateText = coordinateText
    }

    /// The temperature value with its unit suffix and no separating space, exactly as the
    /// web renders it (`{fmtInt(value)}{tempUnit}` → "22°C").
    public var temperatureText: String {
        "\(temperatureValue)\(temperatureUnit)"
    }

    /// The SF Symbol for the conditions glyph.
    public var conditionSymbol: String {
        condition.symbolName
    }
}

/// Pure projector: `WeatherStateDTO` + `WeatherUnitPrefs` → `WeatherAtCarProjection?`. Returns
/// `nil` when the cached state has no outside temperature, mirroring the web `hasData =
/// outsideTemp != null` gate that switches the body to the empty state. Every value is computed
/// with the exact same arithmetic + formatting as the web widget.
public enum WeatherAtCarProjector {
    public static func project(state: WeatherStateDTO, units: WeatherUnitPrefs) -> WeatherAtCarProjection? {
        guard let celsius = state.outsideTempCelsius else { return nil }
        let display = convertWeatherTempFromSI(celsius, to: units.temperature)
        return WeatherAtCarProjection(
            temperatureValue: WeatherAtCarFormat.int(display, localeIdentifier: units.localeIdentifier),
            temperatureUnit: units.temperature.symbol,
            condition: WeatherCondition.forCelsius(celsius),
            outsideTempCelsius: celsius,
            coordinateText: weatherCoordinatePair(latitude: state.latitude, longitude: state.longitude)
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the readout. Pure + public so the a11y label
/// content can be unit-tested without rendering the view.
public enum WeatherAtCarAccessibility {
    /// e.g. "Weather at Car. Outside Temperature 22°C. 37.42°, -122.08°" (coordinates appended
    /// only when present), composed from the same localized strings the view renders.
    public static func summary(for projection: WeatherAtCarProjection) -> String {
        let title = WeatherAtCarStrings.string("widget.weatherAtCar", "Weather at Car")
        let label = WeatherAtCarStrings.string("widget.outsideTemp", "Outside Temperature")
        var parts = [title, "\(label) \(projection.temperatureText)"]
        if let coordinateText = projection.coordinateText {
            parts.append(coordinateText)
        }
        return parts.joined(separator: ". ")
    }
}
