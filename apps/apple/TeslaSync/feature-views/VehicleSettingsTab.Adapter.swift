//
//  VehicleSettingsTab.Adapter.swift
//  TeslaSync — P4 feature view · 0308 · VehicleSettingsTab (Apple)
//
//  The pure, dependency-free core for the per-vehicle settings surface — the SwiftUI
//  parity of features/vehicles/components/VehicleSettingsTab.tsx. Everything here is
//  Foundation-only (no store, no bundle, no rendered view): the supported-key
//  whitelist + per-key UI metadata, the effective-source discriminator, the
//  datetime-local ⇄ RFC3339 conversion, and the draft parse/validation gate. All of
//  it is unit tested in isolation.
//
//  Parity note: the whitelist + render order mirror VEHICLE_SETTING_DESCRIPTORS in the
//  web source (which mirrors vehicleSettingDefs in the Go repo). The order drives row
//  rendering and is not reordered. The select option *symbols* (mi/km/°C/°F/kWh) are
//  unit glyphs carried verbatim exactly as the web hardcodes them — they are not
//  translated prose.
//

import Foundation

// MARK: - Setting kind (web `VehicleSettingKind = 'text' | 'timestamp' | 'select'`)

/// The render/parse strategy for a supported key — the native mirror of the web
/// `VehicleSettingKind`. Drives both the input control and the parse/validation path.
public enum VehicleSettingKind: String, Sendable, Equatable, CaseIterable {
    case text
    case timestamp
    case select
}

// MARK: - Select option (web `SelectOption`)

/// One option in a `select`-kind setting — the option `value` sent to the API and the
/// display `symbol` shown in the picker (a unit glyph, carried verbatim).
public struct VehicleSettingOption: Identifiable, Equatable, Sendable {
    public let value: String
    public let symbol: String

    public var id: String {
        value
    }

    public init(value: String, symbol: String) {
        self.value = value
        self.symbol = symbol
    }
}

// MARK: - Descriptor (web `VehicleSettingDescriptor`)

/// One supported per-vehicle key plus its UI metadata — the native mirror of a web
/// `VehicleSettingDescriptor`. The label/help are carried as i18n keys with their web
/// English fallback so the view resolves them through the P1/S10 facade (no literals
/// in Swift). `options` is populated only for the `select` kind; `maxLength` only for
/// `text`.
public struct VehicleSettingDescriptor: Identifiable, Equatable, Sendable {
    public let key: String
    public let kind: VehicleSettingKind
    public let options: [VehicleSettingOption]
    public let maxLength: Int?
    public let labelKey: String
    public let labelFallback: String
    public let helpKey: String
    public let helpFallback: String

    public var id: String {
        key
    }

    public init(
        key: String,
        kind: VehicleSettingKind,
        options: [VehicleSettingOption] = [],
        maxLength: Int? = nil,
        labelKey: String,
        labelFallback: String,
        helpKey: String,
        helpFallback: String
    ) {
        self.key = key
        self.kind = kind
        self.options = options
        self.maxLength = maxLength
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.helpKey = helpKey
        self.helpFallback = helpFallback
    }
}

/// The ordered supported-key catalogue rendered by the section — the native mirror of
/// the web `VEHICLE_SETTING_DESCRIPTORS`. Keys, kinds, option sets, and the English
/// label/help fallbacks are extracted verbatim from the web source + its i18n catalog.
public enum VehicleSettingsCatalog {
    public static let descriptors: [VehicleSettingDescriptor] = [
        VehicleSettingDescriptor(
            key: "nickname",
            kind: .text,
            maxLength: 64,
            labelKey: "vehicleSettings.keys.nickname.label",
            labelFallback: "Nickname",
            helpKey: "vehicleSettings.keys.nickname.help",
            helpFallback: "Friendly name shown in the vehicle list and page title."
        ),
        VehicleSettingDescriptor(
            key: "mute_until",
            kind: .timestamp,
            labelKey: "vehicleSettings.keys.mute_until.label",
            labelFallback: "Mute alerts until",
            helpKey: "vehicleSettings.keys.mute_until.help",
            helpFallback: "Suppresses alerts for this vehicle until the chosen date and time. "
                + "Clear to receive alerts immediately."
        ),
        VehicleSettingDescriptor(
            key: "charge_cost_tariff_id",
            kind: .text,
            maxLength: 64,
            labelKey: "vehicleSettings.keys.charge_cost_tariff_id.label",
            labelFallback: "Charge cost tariff",
            helpKey: "vehicleSettings.keys.charge_cost_tariff_id.help",
            helpFallback: "Tariff identifier used when calculating per-session charge costs for this vehicle."
        ),
        VehicleSettingDescriptor(
            key: "units_distance",
            kind: .select,
            options: [
                VehicleSettingOption(value: "mi", symbol: "mi"),
                VehicleSettingOption(value: "km", symbol: "km")
            ],
            labelKey: "vehicleSettings.keys.units_distance.label",
            labelFallback: "Distance unit",
            helpKey: "vehicleSettings.keys.units_distance.help",
            helpFallback: "Override the distance unit (mi or km) for this vehicle's panels."
        ),
        VehicleSettingDescriptor(
            key: "units_temperature",
            kind: .select,
            options: [
                VehicleSettingOption(value: "C", symbol: "°C"),
                VehicleSettingOption(value: "F", symbol: "°F")
            ],
            labelKey: "vehicleSettings.keys.units_temperature.label",
            labelFallback: "Temperature unit",
            helpKey: "vehicleSettings.keys.units_temperature.help",
            helpFallback: "Override the temperature unit (°C or °F) for this vehicle's panels."
        ),
        VehicleSettingDescriptor(
            key: "units_energy",
            kind: .select,
            options: [
                VehicleSettingOption(value: "kWh", symbol: "kWh")
            ],
            labelKey: "vehicleSettings.keys.units_energy.label",
            labelFallback: "Energy unit",
            helpKey: "vehicleSettings.keys.units_energy.help",
            helpFallback: "Override the energy display unit (kWh) for this vehicle's panels."
        )
    ]

    /// The descriptor for a key, or `nil` when the key is outside the whitelist.
    public static func descriptor(for key: String) -> VehicleSettingDescriptor? {
        descriptors.first { $0.key == key }
    }
}

// MARK: - Effective source (web `EffectiveSettingSource`)

/// The layer that produced a key's effective value — the native mirror of the web
/// `EffectiveSettingSource`. Drives the "source" pill and gates the reset action
/// (only `override` rows can be reset).
public enum EffectiveSettingSource: String, Sendable, Equatable, CaseIterable {
    case override
    case user
    case vehicle
    case systemDefault = "default"

    /// Defensive parse for loosely-typed payloads (web discriminator); unknown values
    /// collapse to `systemDefault`, exactly the web `?? 'default'` fallback.
    public static func parse(_ raw: String?) -> EffectiveSettingSource {
        EffectiveSettingSource(rawValue: raw ?? "") ?? .systemDefault
    }
}

// MARK: - Typed value (web `VehicleSettingValue = string | number | boolean`)

/// The typed value forwarded to the upsert mutation — the native mirror of the web
/// `VehicleSettingValue` union. The supported keys are all string-valued (units,
/// nickname, tariff id, and the RFC3339 `mute_until` string), so the parser only ever
/// produces `.string`; the numeric/boolean cases preserve the union's shape without
/// resorting to `Any`.
public enum VehicleSettingValue: Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)

    /// A stable, non-localized description for logging + test assertions.
    public var debugDescription: String {
        switch self {
        case let .string(value): "string(\(value))"
        case let .number(value): "number(\(value))"
        case let .bool(value): "bool(\(value))"
        }
    }
}

// MARK: - Datetime-local ⇄ RFC3339 (port of the web helpers)

/// Pure, deterministic conversion between an RFC3339 timestamp string (the API/wire
/// shape for `mute_until`) and a `Date` the native `DatePicker` edits — the native
/// port of the web `rfc3339ToLocalInput` / `localInputToRFC3339` helpers. Parsing is
/// lenient (accepts a fractional-seconds variant too); emission is the internet
/// date-time form with seconds, matching the web contract ("RFC3339 with seconds").
public enum VehicleSettingsDateFormat {
    /// Builds a UTC ISO8601 formatter on demand. Built per call rather than cached in a
    /// shared static so the type stays concurrency-safe under Swift 6 strict checking
    /// (`ISO8601DateFormatter` is not `Sendable`); this path runs only on the
    /// `mute_until` hydrate/save, never in a hot loop.
    private static func formatter(fractionalSeconds: Bool) -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = fractionalSeconds
            ? [.withInternetDateTime, .withFractionalSeconds]
            : [.withInternetDateTime]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }

    /// Parses an RFC3339 timestamp into a `Date`, or `nil` when the input is empty or
    /// unparseable (web "returns the empty string when input cannot be parsed").
    public static func parse(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        return formatter(fractionalSeconds: false).date(from: value)
            ?? formatter(fractionalSeconds: true).date(from: value)
    }

    /// Emits a `Date` as an RFC3339 (UTC, seconds) string — the native peer of the web
    /// `Date.toISOString()` round-trip the upsert sends.
    public static func rfc3339(from date: Date) -> String {
        formatter(fractionalSeconds: false).string(from: date)
    }
}

// MARK: - Editable draft (uniform per-row edit state)

/// The editable draft for one row — a typed mirror of the web per-row `draft` string,
/// specialised per kind so the timestamp row can drive a native `DatePicker`. A `nil`
/// timestamp means "no value" (the web empty datetime-local).
public enum RowDraft: Equatable, Sendable {
    case text(String)
    case selection(String)
    case timestamp(Date?)
}

// MARK: - Draft → effective + parse/validate (port of the web row helpers)

/// The pure per-row draft helpers — the native port of the web `effectiveToDraft` /
/// `parseDraft`. Building the initial draft from the effective value and validating a
/// draft before upsert both live here so they are unit tested without a view.
public enum VehicleSettingsDraft {
    /// The result of validating a draft before upsert — the native mirror of the web
    /// `ParseResult` (`ok` / `empty` / `invalid`). Invalid carries the i18n key + web
    /// English fallback so the caller resolves the message through the P1/S10 facade.
    public enum ParseResult: Equatable, Sendable {
        case ok(VehicleSettingValue)
        case empty
        case invalid(messageKey: String, fallback: String)
    }

    /// Builds the initial draft from the effective value (web `effectiveToDraft`).
    public static func initialDraft(
        for descriptor: VehicleSettingDescriptor,
        value: String?
    ) -> RowDraft {
        switch descriptor.kind {
        case .timestamp:
            .timestamp(VehicleSettingsDateFormat.parse(value))
        case .select:
            .selection(value ?? "")
        case .text:
            .text(value ?? "")
        }
    }

    /// Validates + normalises a draft into a typed value (web `parseDraft`). Mirrors
    /// the web order: empty short-circuits first, then the per-kind rules.
    public static func parse(
        _ descriptor: VehicleSettingDescriptor,
        _ draft: RowDraft
    ) -> ParseResult {
        switch draft {
        case let .text(raw):
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { return .empty }
            return .ok(.string(trimmed))

        case let .selection(raw):
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { return .empty }
            let allowed = descriptor.options.contains { $0.value == trimmed }
            guard allowed else {
                return .invalid(
                    messageKey: "vehicleSettings.validation.invalid",
                    fallback: "Value is not valid for this setting."
                )
            }
            return .ok(.string(trimmed))

        case let .timestamp(date):
            guard let date else { return .empty }
            return .ok(.string(VehicleSettingsDateFormat.rfc3339(from: date)))
        }
    }
}
