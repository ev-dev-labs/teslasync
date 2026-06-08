//
//  GeneralSettings.Adapter.swift
//  TeslaSync — P4 feature view · 0207 · GeneralSettings (Apple)
//
//  The pure, Foundation-only adapter for the General Settings surface: the
//  Tesla-setting enum parser (port of lib/parseSettingEnum.ts), the
//  sync-units-from-car projection (port of the web `syncUnitsFromCar`), the
//  render-phase + freshness resolution (ADR-013), the decimal-precision preview,
//  the select option catalogs, the currency-glyph → ISO 4217 map, and the
//  VoiceOver copy. No SwiftUI, no networking — every function is a deterministic
//  projection the XCTest suite asserts without a rendering host.
//

import Foundation

// MARK: - Select option (Foundation projection of a web <Select> option)

/// One option for a settings dropdown: the stored value + a display-ready title
/// (already resolved through the i18n facade for translated labels, or verbatim
/// for language / currency / locale names that are not translated).
public struct SettingsOption: Sendable, Equatable, Identifiable {
    public let value: String
    public let title: String

    public init(value: String, title: String) {
        self.value = value
        self.title = title
    }

    public var id: String {
        value
    }
}

// MARK: - Sync outcome

/// The result of applying the car's reported units to the form (port of the web
/// `syncUnitsFromCar`): the updated form, the localized summary for the success
/// toast, and whether anything was applied.
public struct SyncUnitsOutcome: Sendable, Equatable {
    public let form: AppSettingsState
    public let summary: String
    public let didChange: Bool

    public init(form: AppSettingsState, summary: String, didChange: Bool) {
        self.form = form
        self.summary = summary
        self.didChange = didChange
    }
}

// MARK: - Adapter

/// Pure projections backing the General Settings surface. Mirrors the helper
/// logic the web component pulls from `lib/parseSettingEnum.ts` plus its inline
/// `syncUnitsFromCar`, kept host-free so the tests assert them directly.
public enum GeneralSettingsAdapter {
    // MARK: Tesla setting-enum parsing (port of lib/parseSettingEnum.ts)

    private static let distanceMap: [String: String] = [
        "distanceunitmiles": "Miles", "distanceunitkilometers": "Kilometers",
        "distanceunitkm": "Kilometers", "miles": "Miles", "mi": "Miles",
        "km": "Kilometers", "kilometers": "Kilometers"
    ]
    private static let temperatureMap: [String: String] = [
        "temperatureunitcelsius": "Celsius", "temperatureunitfahrenheit": "Fahrenheit",
        "celsius": "Celsius", "fahrenheit": "Fahrenheit", "c": "Celsius", "f": "Fahrenheit"
    ]
    private static let pressureMap: [String: String] = [
        "pressureunitpsi": "PSI", "pressureunitbar": "Bar", "pressureunitkpa": "kPa",
        "psi": "PSI", "bar": "Bar", "kpa": "kPa"
    ]

    /// The category of a Tesla setting enum, selecting the lookup table.
    public enum SettingCategory {
        case distance
        case temperature
        case pressure
    }

    /// Parses a Tesla setting enum (e.g. "DistanceUnitMiles") to a clean display
    /// value, falling back to the raw value, and `—` for empty (web `parseSettingEnum`).
    public static func parseSettingEnum(_ value: String?, category: SettingCategory) -> String {
        guard let value, !value.isEmpty else { return "—" }
        let key = value.lowercased().filter(\.isLetter)
        let table: [String: String] = switch category {
        case .distance: distanceMap
        case .temperature: temperatureMap
        case .pressure: pressureMap
        }
        return table[key] ?? value
    }

    /// Whether a setting reads as imperial / miles (web `isSettingMiles`).
    public static func isMiles(_ value: String?) -> Bool {
        (value?.lowercased().contains("mile")) ?? false
    }

    /// Whether a setting reads as Fahrenheit (web `isSettingFahrenheit`).
    public static func isFahrenheit(_ value: String?) -> Bool {
        (value?.lowercased().contains("fahr")) ?? false
    }

    /// Whether a setting reads as PSI (web `isSettingPSI`).
    public static func isPSI(_ value: String?) -> Bool {
        (value?.lowercased().contains("psi")) ?? false
    }

    /// Whether a setting reads as Bar (web `isSettingBar`).
    public static func isBar(_ value: String?) -> Bool {
        (value?.lowercased().contains("bar")) ?? false
    }

    // MARK: Sync units from car (port of the web `syncUnitsFromCar`)

    /// Applies the car's reported units to the form. Distance / temperature snap
    /// to the detected unit (or the metric default when present but unrecognized);
    /// pressure only snaps when it reads as PSI or Bar. `didChange` is true when
    /// the car reported at least one mappable unit, matching the web
    /// `Object.keys(updates).length > 0` gate.
    public static func syncUnitsFromCar(form: AppSettingsState, preferences: CarPreferences) -> SyncUnitsOutcome {
        var updated = form
        var changed = false

        if isMiles(preferences.distanceUnit) {
            updated.unitOfLength = "mi"
            changed = true
        } else if preferences.distanceUnit?.isEmpty == false {
            updated.unitOfLength = "km"
            changed = true
        }

        if isFahrenheit(preferences.temperatureUnit) {
            updated.unitOfTemp = "F"
            changed = true
        } else if preferences.temperatureUnit?.isEmpty == false {
            updated.unitOfTemp = "C"
            changed = true
        }

        if isPSI(preferences.tirePressureUnit) {
            updated.unitOfPressure = "psi"
            changed = true
        } else if isBar(preferences.tirePressureUnit) {
            updated.unitOfPressure = "bar"
            changed = true
        }

        return SyncUnitsOutcome(form: updated, summary: syncSummary(for: updated), didChange: changed)
    }

    /// The localized "Distance: Miles, Temperature: Celsius, Pressure: Bar"
    /// summary shown in the sync success toast.
    public static func syncSummary(for form: AppSettingsState) -> String {
        let distance = form.unitOfLength == "mi"
            ? GeneralSettingsStrings.string("miles", "Miles")
            : GeneralSettingsStrings.string("kilometers", "Kilometers")
        let temperature = form.unitOfTemp == "F"
            ? GeneralSettingsStrings.string("fahrenheit", "Fahrenheit")
            : GeneralSettingsStrings.string("celsius", "Celsius")
        let pressure = form.unitOfPressure == "psi" ? "PSI" : "Bar"
        let distanceLabel = GeneralSettingsStrings.string("distance", "Distance")
        let temperatureLabel = GeneralSettingsStrings.string("temperature", "Temperature")
        let pressureLabel = GeneralSettingsStrings.string("pressure", "Pressure")
        return "\(distanceLabel): \(distance), \(temperatureLabel): \(temperature), \(pressureLabel): \(pressure)"
    }

    // MARK: Render phase + freshness (ADR-013)

    /// Resolves the surface shell branch from the settings query, keeping a cached
    /// form visible behind a refresh / transient error so the editor never blanks.
    public static func resolvePhase(settings: SettingsQuery, hasCachedForm: Bool) -> SettingsRenderPhase {
        switch settings {
        case .loading:
            hasCachedForm ? .content : .loading
        case .empty:
            .empty
        case let .failed(message):
            hasCachedForm ? .content : .error(message)
        case .loaded:
            .content
        }
    }

    /// Resolves the freshness-chip status (offline ▸ error ▸ fetching ▸ stale ▸
    /// fresh), mirroring the web `DataFreshness` precedence with the offline add.
    public static func resolveFreshness(
        connection: SettingsConnection,
        isFetching: Bool,
        isError: Bool
    ) -> SettingsFreshness {
        if connection == .offline { return .offline }
        if isError { return .error }
        if isFetching { return .fetching }
        if connection == .stale { return .stale }
        return .fresh
    }

    /// A localized "just now / 5m ago / 2h ago / 3d ago" label for the chip.
    public static func relativeTime(since date: Date, now: Date = Date()) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 {
            return GeneralSettingsStrings.string("freshness.justNow", "just now")
        }
        if seconds < 3600 {
            return GeneralSettingsStrings.count("freshness.minutesAgo", "%lldm ago", seconds / 60)
        }
        if seconds < 86400 {
            return GeneralSettingsStrings.count("freshness.hoursAgo", "%lldh ago", seconds / 3600)
        }
        return GeneralSettingsStrings.count("freshness.daysAgo", "%lldd ago", seconds / 86400)
    }

    // MARK: Decimal preview (web `(14.248539).toFixed(precision)`)

    /// The web preview sample value rendered by the decimal-precision field.
    public static let decimalPreviewSample = 14.248539

    /// Formats the sample with the given fraction-digit count, clamped to 0…20 and
    /// rendered POSIX-style ("." separator, no grouping) exactly like JS `toFixed`.
    public static func decimalPreview(precision: Int, locale _: String) -> String {
        let clamped = max(0, min(20, precision))
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = clamped
        formatter.maximumFractionDigits = clamped
        return formatter.string(from: NSNumber(value: decimalPreviewSample))
            ?? String(format: "%.\(clamped)f", decimalPreviewSample)
    }

    // MARK: Currency glyph → ISO 4217 (web `CURRENCY_SYMBOL_TO_ISO`)

    private static let currencyIsoMap: [String: String] = [
        "$": "USD", "€": "EUR", "£": "GBP", "C$": "CAD", "A$": "AUD",
        "¥": "JPY", "元": "CNY", "CHF": "CHF", "kr": "SEK", "₹": "INR"
    ]

    /// Maps the stored currency glyph to an ISO 4217 code so the currency fields
    /// can format with the right symbol (web `symbolToIsoCode`).
    public static func currencyCode(for symbol: String?) -> String {
        let key = (symbol ?? "$").trimmingCharacters(in: .whitespaces)
        return currencyIsoMap[key] ?? "USD"
    }
}

// MARK: - Option catalogs (web <Select> options)

public extension GeneralSettingsAdapter {
    static func distanceOptions() -> [SettingsOption] {
        [
            SettingsOption(value: "km", title: GeneralSettingsStrings.string("app.kilometers", "Kilometers")),
            SettingsOption(value: "mi", title: GeneralSettingsStrings.string("app.miles", "Miles"))
        ]
    }

    static func temperatureOptions() -> [SettingsOption] {
        [
            SettingsOption(value: "C", title: GeneralSettingsStrings.string("app.celsius", "Celsius")),
            SettingsOption(value: "F", title: GeneralSettingsStrings.string("app.fahrenheit", "Fahrenheit"))
        ]
    }

    static func pressureOptions() -> [SettingsOption] {
        [
            SettingsOption(value: "bar", title: GeneralSettingsStrings.string("app.bar", "Bar")),
            SettingsOption(value: "psi", title: GeneralSettingsStrings.string("app.psi", "PSI"))
        ]
    }

    static func rangeOptions() -> [SettingsOption] {
        [
            SettingsOption(value: "rated", title: GeneralSettingsStrings.string("app.rated", "Rated")),
            SettingsOption(value: "ideal", title: GeneralSettingsStrings.string("app.ideal", "Ideal"))
        ]
    }

    static func languageOptions() -> [SettingsOption] {
        [
            SettingsOption(value: "en", title: "English"),
            SettingsOption(value: "de", title: "Deutsch"),
            SettingsOption(value: "fr", title: "Français"),
            SettingsOption(value: "es", title: "Español"),
            SettingsOption(value: "zh", title: "中文")
        ]
    }

    static func currencyOptions() -> [SettingsOption] {
        [
            SettingsOption(value: "$", title: "USD ($)"),
            SettingsOption(value: "€", title: "EUR (€)"),
            SettingsOption(value: "£", title: "GBP (£)"),
            SettingsOption(value: "C$", title: "CAD (C$)"),
            SettingsOption(value: "A$", title: "AUD (A$)"),
            SettingsOption(value: "¥", title: "JPY (¥)"),
            SettingsOption(value: "元", title: "CNY (元)"),
            SettingsOption(value: "CHF", title: "CHF (CHF)"),
            SettingsOption(value: "kr", title: "SEK / NOK / DKK (kr)"),
            SettingsOption(value: "₹", title: "INR (₹)")
        ]
    }

    static func localeOptions() -> [SettingsOption] {
        [
            SettingsOption(value: "en-US", title: "English (US) — 1,234.56"),
            SettingsOption(value: "en-GB", title: "English (UK) — 1,234.56"),
            SettingsOption(value: "de-DE", title: "Deutsch (DE) — 1.234,56"),
            SettingsOption(value: "fr-FR", title: "Français (FR) — 1 234,56"),
            SettingsOption(value: "es-ES", title: "Español (ES) — 1.234,56"),
            SettingsOption(value: "ja-JP", title: "日本語 (JP) — 1,234.56"),
            SettingsOption(value: "zh-CN", title: "简体中文 (CN) — 1,234.56")
        ]
    }

    static func timezoneDisplayOptions() -> [SettingsOption] {
        [
            SettingsOption(
                value: "vehicle",
                title: GeneralSettingsStrings.string("app.tzVehicle", "Vehicle's local time (recommended)")
            ),
            SettingsOption(value: "user", title: GeneralSettingsStrings.string("app.tzUser", "My local time")),
            SettingsOption(value: "utc", title: GeneralSettingsStrings.string("app.tzUtc", "UTC"))
        ]
    }

    static func gasUnitOptions() -> [SettingsOption] {
        [
            SettingsOption(value: "gallon", title: GeneralSettingsStrings.string("app.perGallon", "/ gallon")),
            SettingsOption(value: "liter", title: GeneralSettingsStrings.string("app.perLiter", "/ liter"))
        ]
    }
}

// MARK: - Accessibility copy (testable seam)

/// VoiceOver copy for the surface chrome. Pure + public so the spoken content can
/// be unit-tested without rendering the view.
public enum GeneralSettingsAccessibility {
    /// The localized freshness label spoken by the chip / used as its value.
    public static func freshnessLabel(_ freshness: SettingsFreshness) -> String {
        switch freshness {
        case .fresh: GeneralSettingsStrings.string("freshness.live", "Live")
        case .fetching: GeneralSettingsStrings.string("freshness.updating", "Updating…")
        case .stale: GeneralSettingsStrings.string("freshness.stale", "Stale")
        case .error: GeneralSettingsStrings.string("freshness.error", "Error")
        case .offline: GeneralSettingsStrings.string("freshness.offline", "Offline")
        }
    }

    /// "Miles / Celsius / Bar" — the car's reported units, parsed for display.
    public static func carUnitsSummary(_ preferences: CarPreferences) -> String {
        let distance = GeneralSettingsAdapter.parseSettingEnum(preferences.distanceUnit, category: .distance)
        let temperature = GeneralSettingsAdapter.parseSettingEnum(preferences.temperatureUnit, category: .temperature)
        let pressure = GeneralSettingsAdapter.parseSettingEnum(preferences.tirePressureUnit, category: .pressure)
        return "\(distance) / \(temperature) / \(pressure)"
    }

    /// "24-hour" / "12-hour" — the car's clock-format preference, read-only.
    public static func carClockLabel(_ is24Hour: Bool) -> String {
        is24Hour
            ? GeneralSettingsStrings.string("app.clock24h", "24-hour")
            : GeneralSettingsStrings.string("app.clock12h", "12-hour")
    }
}
