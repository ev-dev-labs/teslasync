//
//  GeneralSettings.Models.swift
//  TeslaSync — P4 feature view · 0207 · GeneralSettings (Apple)
//
//  The host-free value types for the General Settings surface — SwiftUI parity of
//  features/settings/components/GeneralSettings.tsx. The diagnostics identity
//  (P1/S11), the editable settings projection (the web form fields), the car
//  preferences read-back, the cache-then-network query / connection / freshness /
//  phase states (ADR-013), the coalesced source snapshot, and the Foundation half
//  of the P1/S10 i18n facade. No SwiftUI and no networking — every type is a
//  plain value the XCTest suite asserts without a rendering host.
//

import Foundation

// MARK: - Surface identity (P1/S11 view.opened)

/// Stable, non-identifying identity for the `GeneralSettings` feature view. The
/// slug is the value emitted with the P1/S11 `view.opened` diagnostics contract
/// and is shared by the view-model and the tests so the two never drift.
public enum GeneralSettingsSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "GeneralSettings"
}

// MARK: - Editable settings projection (the web form fields)

/// The editable subset of the web `AppSettings` the General tab owns — the exact
/// fields the web form mutates. These are user display preferences, not
/// measurements, so the values are stored verbatim and applied at the display
/// boundary by `useUnits()` elsewhere. Fields outside this tab (theme, quiet
/// hours, polling, …) are preserved by the production source when it merges this
/// projection back onto the full settings document on save.
public struct AppSettingsState: Sendable, Equatable {
    public var unitOfLength: String
    public var unitOfTemp: String
    public var unitOfPressure: String
    public var preferredRange: String
    public var decimalPrecision: Int
    public var language: String
    public var currencySymbol: String
    public var locale: String
    public var tzDisplayDefault: String
    public var timezoneUser: String
    public var baseCostPerKwh: Double
    public var gasPricePerUnit: Double
    public var gasUnit: String
    public var gasEfficiencyMpg: Double

    public init(
        unitOfLength: String = "km",
        unitOfTemp: String = "C",
        unitOfPressure: String = "bar",
        preferredRange: String = "rated",
        decimalPrecision: Int = 2,
        language: String = "en",
        currencySymbol: String = "$",
        locale: String = "en-US",
        tzDisplayDefault: String = "vehicle",
        timezoneUser: String = "",
        baseCostPerKwh: Double = 0.12,
        gasPricePerUnit: Double = 3.50,
        gasUnit: String = "gallon",
        gasEfficiencyMpg: Double = 25
    ) {
        self.unitOfLength = unitOfLength
        self.unitOfTemp = unitOfTemp
        self.unitOfPressure = unitOfPressure
        self.preferredRange = preferredRange
        self.decimalPrecision = decimalPrecision
        self.language = language
        self.currencySymbol = currencySymbol
        self.locale = locale
        self.tzDisplayDefault = tzDisplayDefault
        self.timezoneUser = timezoneUser
        self.baseCostPerKwh = baseCostPerKwh
        self.gasPricePerUnit = gasPricePerUnit
        self.gasUnit = gasUnit
        self.gasEfficiencyMpg = gasEfficiencyMpg
    }

    /// The web `DEFAULT_FORM` seed used before the server snapshot resolves.
    public static let `default` = AppSettingsState()
}

// MARK: - Car preferences (web `UserPreferenceLatest`)

/// The vehicle's own display preferences read back from the car
/// (`/user-preferences/latest`). All optional — the car may not have reported a
/// given unit yet. Mirrors the web `UserPreferenceLatest`.
public struct CarPreferences: Sendable, Equatable {
    public var distanceUnit: String?
    public var temperatureUnit: String?
    public var tirePressureUnit: String?
    public var clock24Hour: Bool?

    public init(
        distanceUnit: String? = nil,
        temperatureUnit: String? = nil,
        tirePressureUnit: String? = nil,
        clock24Hour: Bool? = nil
    ) {
        self.distanceUnit = distanceUnit
        self.temperatureUnit = temperatureUnit
        self.tirePressureUnit = tirePressureUnit
        self.clock24Hour = clock24Hour
    }

    /// Whether the car reported at least one unit (web gates the sync banner on
    /// `distance || temperature`).
    public var hasUnitInfo: Bool {
        (distanceUnit?.isEmpty == false) || (temperatureUnit?.isEmpty == false)
    }
}

/// A vehicle option (web `Vehicle`); only the id + a label are needed here — the
/// first vehicle drives the car-preferences read.
public struct GeneralSettingsVehicleOption: Sendable, Equatable, Identifiable {
    public let id: Int
    public let displayName: String

    public init(id: Int, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Query / connection / phase states

/// The cache-then-network state of the settings document (web `useSettings`).
public enum SettingsQuery: Sendable, Equatable {
    case loading
    case loaded(AppSettingsState)
    case empty
    case failed(String)
}

/// Live-stream connection band (ADR-013). The web surface has no offline state;
/// `offline` is the native addition reflected in the freshness chip + cached
/// banner so a saved snapshot stays usable without connectivity.
public enum SettingsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The freshness-chip status (ADR-013), extending the web fresh/fetching/stale/
/// error model with the native `offline` band.
public enum SettingsFreshness: Sendable, Equatable {
    case fresh
    case fetching
    case stale
    case error
    case offline
}

/// The surface shell render branch resolved from the settings query.
public enum SettingsRenderPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

/// The save-action lifecycle (web `settingsMut` + the `saved` confirmation flag).
public enum SettingsSaveStatus: Sendable, Equatable {
    case idle
    case saving
    case saved
    case failed
}

/// A settings-save failure carrying the (already-localized or server-supplied)
/// message shown in the error toast. A dedicated `Error` type so the save result
/// is a well-typed `Result<AppSettingsState, SettingsSaveError>`.
public struct SettingsSaveError: Error, Sendable, Equatable {
    public let message: String

    public init(_ message: String = "") {
        self.message = message
    }
}

// MARK: - Coalesced source snapshot

/// One snapshot pushed by a `GeneralSettingsSource`: the settings document query,
/// the vehicle options, the first vehicle's car preferences, and the live
/// connection band. The view-model resolves the render phase + freshness from it.
public struct GeneralSettingsSnapshot: Sendable, Equatable {
    public var settings: SettingsQuery
    public var vehicles: [GeneralSettingsVehicleOption]
    public var carPreferences: CarPreferences?
    public var connection: SettingsConnection
    public var isFetching: Bool
    public var isError: Bool
    public var updatedAt: Date?

    public init(
        settings: SettingsQuery = .loading,
        vehicles: [GeneralSettingsVehicleOption] = [],
        carPreferences: CarPreferences? = nil,
        connection: SettingsConnection = .live,
        isFetching: Bool = false,
        isError: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.settings = settings
        self.vehicles = vehicles
        self.carPreferences = carPreferences
        self.connection = connection
        self.isFetching = isFetching
        self.isError = isError
        self.updatedAt = updatedAt
    }
}

// MARK: - Localization facade (P1/S10) — Foundation half

/// Resolves the surface's strings by key with the web `t(key, default)` English
/// fallback so neither the adapter nor the view holds hardcoded literals. Keys
/// live in the "GeneralSettings" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. The SwiftUI `text(_:_:)`
/// convenience lives in the view file so this half stays Foundation-only and the
/// adapter/view-model can resolve a11y + label copy headless.
public enum GeneralSettingsStrings {
    public static let table = "GeneralSettings"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func format(_ key: String, _ fallbackFormat: String, _ arg: String) -> String {
        String(format: string(key, fallbackFormat), arg)
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}
