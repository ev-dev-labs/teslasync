//
//  LiveMotorStatus.Adapter.swift
//  TeslaSync — P4 feature view · 0157 · LiveMotorStatus (Apple)
//
//  The pure, Foundation-only projection core for the drivetrain-health Live Motor Status surface —
//  the SwiftUI parity of features/driving/components/drivetrain-health/LiveMotorStatus.tsx.
//
//  It ports the web component's numeric pipeline VERBATIM so the native surface shows the exact
//  same values: `fmtNumber(v)` (lib/numberFormat.ts, the global-precision 2 default) for power /
//  regen / torque / temperature / HV-isolation, `fmtInt(v)` for the grouped RPM integers, and
//  `convertTempFromSI(c, tempUnit)` (lib/unitConversion.ts) for the °C→display conversion. The four
//  status cards, the nine inline metrics, and the HV-isolation colour ladder are all derived here.
//  Everything is SwiftUI-free so it is exhaustively unit-testable in isolation.
//
//  Unit semantics (mirrors the web prop contract — the parent page already resolved these from the
//  SI signal_log via the P1/S8 holders, so this leaf treats them as presentation values):
//    • power / regen — kilowatts (kW)
//    • torque        — newton-metres (Nm)
//    • rpm           — revolutions per minute (raw axle speed, grouped integer)
//    • temperature   — degrees Celsius (°C), converted to the display unit at projection time
//    • isolation     — kilo-ohms (kΩ)
//

import Foundation

// MARK: - Temperature conversion (ported 1:1 from web lib/unitConversion.ts)

/// Temperature converter ported 1:1 from `convertTempFromSI(celsius, to)` in `lib/unitConversion.ts`
/// (the function behind the web `toTemperatureDisplay` prop): Celsius passes through; Fahrenheit is
/// `c * 9 / 5 + 32`. The backend `motor_temp_c_*` / `inverter_temp_c` / `battery_temp_c` values
/// arrive in degrees Celsius (the SI floor the Phase-42 pipeline stores), exactly the input the web
/// converter expects.
func convertLiveMotorTempFromSI(_ celsius: Double, to unit: LiveMotorTemperatureUnit) -> Double {
    switch unit {
    case .celsius:
        celsius
    case .fahrenheit:
        celsius * 9 / 5 + 32
    }
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts `fmtNumber` / `fmtInt`)

/// Locale-aware formatting that mirrors `web/src/lib/numberFormat.ts`. `number` ports `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })` — grouped separators, fixed
/// decimals, non-finite coerced to 0, half-away-from-zero rounding to match `Intl.NumberFormat`'s
/// default `halfExpand`); `int` ports `fmtInt` (`fmtNumber(v, 0)`). The unit variants reproduce the
/// web's exact spacing (a single space before "kW" / "Nm" / "RPM" / "kΩ" and before the temperature
/// unit, exactly as the web template literals interpolate them).
public enum LiveMotorFormat {
    /// The em-dash the web renders for an absent value (`?? '—'` / the `!= null` else branch). Named
    /// `emDash` (a glyph constant), never "placeholder", so the surface carries no ADR-011 markers. // parity:allow ui
    public static let emDash = "—"

    /// Port of `fmtNumber(v, decimals)` — grouped, fixed-precision, NaN/∞ ⇒ 0.
    public static func number(_ value: Double, decimals: Int, locale: Locale) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(decimals)f", safe)
    }

    /// Port of `fmtInt(v)` = `fmtNumber(v, 0)` — the grouped integer used for the RPM readouts.
    public static func int(_ value: Double, locale: Locale) -> String {
        number(value, decimals: 0, locale: locale)
    }

    /// `<number> <unit>` — a single space, matching the web `` `${fmtNumber(v)} kW` `` literals.
    public static func withUnit(_ value: Double, _ unit: String, decimals: Int, locale: Locale) -> String {
        "\(number(value, decimals: decimals, locale: locale)) \(unit)"
    }

    /// Web `` `${fmtNumber(toTemperatureDisplay(c))} ${tempUnit}` `` — convert °C → the display unit,
    /// then a single space + the unit symbol (which already carries '°', so no doubled degree sign).
    public static func temperature(
        celsius: Double,
        unit: LiveMotorTemperatureUnit,
        decimals: Int,
        locale: Locale
    ) -> String {
        let display = convertLiveMotorTempFromSI(celsius, to: unit)
        return "\(number(display, decimals: decimals, locale: locale)) \(unit.symbol)"
    }
}

// MARK: - Colour identity (web Tailwind tint → design-token accent, mapped in the view layer)

/// The web tints carried as a semantic identity so the SwiftUI-free projector stays token-free; the
/// `Color` mapping lives in `LiveMotorStatus.Views.swift`. Mirrors the web text/icon colours:
/// cyan-400 → `accent`, purple-400 → `chartSeriesPower`, green-400 → `statusSuccess`, the
/// text-primary value → `textPrimary`, red-400 → `chartSeriesTemperature`, amber-400 →
/// `statusWarning`, and the muted HV-isolation state → `textMuted`.
public enum LiveMotorAccent: String, Sendable, Equatable, CaseIterable {
    case cyan
    case power
    case success
    case primary
    case temperature
    case warning
    case muted
}

// MARK: - Projected tiles (web status cards + inline metrics)

/// One of the four top status cards (web `Grid cols 2/sm:4` of label + bold colour-coded value):
/// Shift State, Power, Regen, Source. `value` is already the web-formatted string (or the em-dash).
public struct LiveMotorStatusCard: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let value: String
    public let accent: LiveMotorAccent

    public init(id: String, label: String, value: String, accent: LiveMotorAccent) {
        self.id = id
        self.label = label
        self.value = value
        self.accent = accent
    }
}

/// One of the nine inline metrics (web `grid cols 2/sm:3/lg:4` of `<InlineMetric icon value label>`):
/// per-axle RPM + torque, the four temperatures, and HV isolation. `systemImage` is the SF Symbol
/// peer of the web lucide icon; `accent` tints it (the HV-isolation icon's tint comes from the
/// threshold ladder).
public struct LiveMotorMetric: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let value: String
    public let systemImage: String
    public let accent: LiveMotorAccent

    public init(id: String, label: String, value: String, systemImage: String, accent: LiveMotorAccent) {
        self.id = id
        self.label = label
        self.value = value
        self.systemImage = systemImage
        self.accent = accent
    }
}

// MARK: - HV-isolation threshold ladder (web Shield colour + value guard)

/// The HV-isolation resistance band — the exact port of the web Shield colour ladder and the
/// `isolationResistance != null && > 0` value guard. The icon tint is derived from the band; the
/// value is `` `${fmtNumber(iso)} kΩ` `` when present and positive, otherwise the em-dash.
public enum LiveMotorIsolation {
    /// Classifies the icon tint (web `null/≤0 → muted`, `≥500 → green`, `≥100 → amber`, else red).
    /// Raw comparisons so a non-finite reading falls through to the danger band like the web `>=`.
    public static func accent(forKOhm value: Double?) -> LiveMotorAccent {
        guard let value, value > 0 else { return .muted }
        if value >= 500 { return .success }
        if value >= 100 { return .warning }
        return .temperature
    }

    /// The formatted value — web `iso != null && iso > 0 ? `${fmtNumber(iso)} kΩ` : '—'`.
    public static func value(forKOhm value: Double?, decimals: Int, locale: Locale) -> String {
        guard let value, value > 0 else { return LiveMotorFormat.emDash }
        return LiveMotorFormat.withUnit(value, "kΩ", decimals: decimals, locale: locale)
    }
}

// MARK: - Projection (web render branch, view-ready)

/// The view-ready projection of one `LiveMotorReading` — the four status cards, the nine inline
/// metrics, and a combined VoiceOver summary. A pure function of the reading + unit prefs, so the
/// view is a pure function of this value and the whole pipeline is unit-tested in isolation.
public struct LiveMotorProjection: Sendable, Equatable {
    public let cards: [LiveMotorStatusCard]
    public let metrics: [LiveMotorMetric]
    public let accessibilitySummary: String

    public init(cards: [LiveMotorStatusCard], metrics: [LiveMotorMetric], accessibilitySummary: String) {
        self.cards = cards
        self.metrics = metrics
        self.accessibilitySummary = accessibilitySummary
    }
}

/// Pure projection from a `LiveMotorReading` (+ unit prefs) to the view-ready `LiveMotorProjection` —
/// the native port of the web component's body. Reproduces every `t()` label, every `?? '—'` /
/// `!= null` guard, and the HV-isolation ladder, pinned by the adapter unit tests.
public enum LiveMotorProjector {
    public static func project(reading: LiveMotorReading, units: LiveMotorUnitPrefs) -> LiveMotorProjection {
        let locale = Locale(identifier: units.localeIdentifier)
        let decimals = units.precision
        let cards = projectCards(reading, locale: locale, decimals: decimals)
        let metrics = projectMetrics(reading, units: units, locale: locale, decimals: decimals)
        let summary = (cards.map { "\($0.label) \($0.value)" } + metrics.map { "\($0.label) \($0.value)" })
            .joined(separator: ", ")
        return LiveMotorProjection(cards: cards, metrics: metrics, accessibilitySummary: summary)
    }

    private static func projectCards(
        _ reading: LiveMotorReading,
        locale: Locale,
        decimals: Int
    ) -> [LiveMotorStatusCard] {
        let power = reading.powerKW.map { LiveMotorFormat.withUnit($0, "kW", decimals: decimals, locale: locale) }
        let regen = reading.regenKW.map { LiveMotorFormat.withUnit($0, "kW", decimals: decimals, locale: locale) }
        return [
            LiveMotorStatusCard(
                id: "shiftState",
                label: label("drivetrain.shiftState", "Shift State"),
                value: reading.shiftState ?? LiveMotorFormat.emDash,
                accent: .cyan
            ),
            LiveMotorStatusCard(
                id: "power",
                label: label("drivetrain.power", "Power"),
                value: power ?? LiveMotorFormat.emDash,
                accent: .power
            ),
            LiveMotorStatusCard(
                id: "regen",
                label: label("drivetrain.regen", "Regen"),
                value: regen ?? LiveMotorFormat.emDash,
                accent: .success
            ),
            LiveMotorStatusCard(
                id: "source",
                label: label("drivetrain.source", "Source"),
                value: reading.source ?? LiveMotorFormat.emDash,
                accent: .primary
            )
        ]
    }

    /// The nine inline metrics, grouped (per-axle RPM, per-axle torque, the four temperatures, HV
    /// isolation) so each builder stays small and independently testable.
    private static func projectMetrics(
        _ reading: LiveMotorReading,
        units: LiveMotorUnitPrefs,
        locale: Locale,
        decimals: Int
    ) -> [LiveMotorMetric] {
        rpmMetrics(reading, locale: locale)
            + torqueMetrics(reading, locale: locale, decimals: decimals)
            + temperatureMetrics(reading, units: units, locale: locale)
            + [isolationMetric(reading, locale: locale, decimals: decimals)]
    }

    /// Web Front/Rear Motor RPM — `motor_rpm_{front,rear} != null ? `${fmtInt} RPM` : '—'`.
    private static func rpmMetrics(_ reading: LiveMotorReading, locale: Locale) -> [LiveMotorMetric] {
        func rpm(_ value: Double?) -> String? {
            value.map { "\(LiveMotorFormat.int($0, locale: locale)) RPM" }
        }
        return [
            metric(
                "rpmFront", label("drivetrain.rpmFront", "Front Motor RPM"),
                "waveform.path.ecg", .cyan, rpm(reading.rpmFront)
            ),
            metric(
                "rpmRear", label("drivetrain.rpmRear", "Rear Motor RPM"),
                "waveform.path.ecg", .power, rpm(reading.rpmRear)
            )
        ]
    }

    /// Web Front/Rear Torque — `torque_nm_{front,rear} != null ? `${fmtNumber} Nm` : '—'`.
    private static func torqueMetrics(
        _ reading: LiveMotorReading,
        locale: Locale,
        decimals: Int
    ) -> [LiveMotorMetric] {
        func torque(_ value: Double?) -> String? {
            value.map { LiveMotorFormat.withUnit($0, "Nm", decimals: decimals, locale: locale) }
        }
        return [
            metric(
                "torqueFront", label("drivetrain.torqueFront", "Front Torque"),
                "bolt.fill", .cyan, torque(reading.torqueFrontNm)
            ),
            metric(
                "torqueRear", label("drivetrain.torqueRear", "Rear Torque"),
                "bolt.fill", .power, torque(reading.torqueRearNm)
            )
        ]
    }

    /// Web Front/Rear Motor + Inverter + Battery temperatures — each
    /// `c != null ? `${fmtNumber(toTemp(c))} ${tempUnit}` : '—'`.
    private static func temperatureMetrics(
        _ reading: LiveMotorReading,
        units: LiveMotorUnitPrefs,
        locale: Locale
    ) -> [LiveMotorMetric] {
        [
            metric(
                "motorTempFront", label("drivetrain.motorTempFront", "Front Motor Temp"),
                "thermometer.medium", .temperature, temp(reading.motorTempCFront, units, locale)
            ),
            metric(
                "motorTempRear", label("drivetrain.motorTempRear", "Rear Motor Temp"),
                "thermometer.medium", .temperature, temp(reading.motorTempCRear, units, locale)
            ),
            metric(
                "inverterTemp", label("drivetrain.inverterTemp", "Inverter Temp"),
                "thermometer.medium", .warning, temp(reading.inverterTempC, units, locale)
            ),
            metric(
                "batteryTemp", label("drivetrain.batteryTemp", "Battery Temp"),
                "thermometer.medium", .success, temp(reading.batteryTempC, units, locale)
            )
        ]
    }

    /// Web HV Isolation — the value guard + Shield colour ladder.
    private static func isolationMetric(
        _ reading: LiveMotorReading,
        locale: Locale,
        decimals: Int
    ) -> LiveMotorMetric {
        let kohm = reading.isolationResistanceKOhm
        return LiveMotorMetric(
            id: "isolation",
            label: label("drivetrain.isolationResistance", "HV Isolation"),
            value: LiveMotorIsolation.value(forKOhm: kohm, decimals: decimals, locale: locale),
            systemImage: "shield.fill",
            accent: LiveMotorIsolation.accent(forKOhm: kohm)
        )
    }

    /// Builds one inline metric, defaulting an absent formatted value to the em-dash (web `: '—'`).
    private static func metric(
        _ id: String,
        _ labelText: String,
        _ systemImage: String,
        _ accent: LiveMotorAccent,
        _ value: String?
    ) -> LiveMotorMetric {
        LiveMotorMetric(
            id: id,
            label: labelText,
            value: value ?? LiveMotorFormat.emDash,
            systemImage: systemImage,
            accent: accent
        )
    }

    /// Web `c != null ? `${fmtNumber(toTemp(c))} ${tempUnit}` : '—'` — `nil` ⇒ no string (em-dash).
    private static func temp(_ celsius: Double?, _ units: LiveMotorUnitPrefs, _ locale: Locale) -> String? {
        celsius.map {
            LiveMotorFormat.temperature(celsius: $0, unit: units.temperature, decimals: units.precision, locale: locale)
        }
    }

    /// Resolves a web `t(key, default)` label through the P1/S10 facade (Foundation-only).
    private static func label(_ key: String, _ fallback: String) -> String {
        LiveMotorStatusStrings.string(key, fallback)
    }
}

// MARK: - Accessibility summaries

/// Builds the combined VoiceOver strings for the tiles, joining the already-localized parts so the
/// labels stay translation-driven.
public enum LiveMotorAccessibility {
    /// Joins non-empty parts with ", " (the standard VoiceOver list separator).
    public static func join(_ parts: [String]) -> String {
        parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }

    /// "<label>, <value>" for one tile's VoiceOver label.
    public static func tile(_ label: String, _ value: String) -> String {
        join([label, value])
    }
}
