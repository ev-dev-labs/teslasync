//
//  VehicleDetailModels.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/VehicleDetail (Apple) — Value types
//
//  Native, wire-faithful value types for the VehicleDetail parity unit (web
//  `web/src/features/vehicles/pages/VehicleDetailPage.tsx`). The page binds the
//  per-vehicle settings resolver (`useVehicleSettings → GET /vehicles/{id}/settings`)
//  and the `findEffectiveSetting` selector — both names are kept verbatim at the
//  Swift call sites so the model reads like the React page. The web page wraps every
//  region in a `<SectionErrorBoundary fallbackTitle=…>`; `VehicleDetailSectionKind`
//  reproduces that contract so each `vehicles.detail.section.*Failed` string resolves
//  from `Localizable.xcstrings`. No non-SI values are stored here — settings are
//  text / timestamp / select primitives, formatted only at the render boundary.
//

import SwiftUI

// MARK: - Settings wire types (web `EffectiveSetting` / `VehicleSettingsResponse`)

/// Web `EffectiveSettingSource` — the resolver layer that produced a value. Drives
/// the per-row "source" pill (Override | User default | Vehicle name | System default).
enum VehicleDetailSettingSource: String, Sendable, CaseIterable {
    case override
    case user
    case vehicle
    case `default`

    /// Localized pill label (reuses the web `vehicleSettings.source.*` catalog keys).
    var labelKey: LocalizedStringKey {
        switch self {
        case .override: "translation.vehicleSettings.source.override"
        case .user: "translation.vehicleSettings.source.user"
        case .vehicle: "translation.vehicleSettings.source.vehicle"
        case .default: "translation.vehicleSettings.source.default"
        }
    }

    /// Semantic tone for the pill — an override is an explicit user choice (accent);
    /// the fallback layers de-emphasize toward neutral.
    var tone: TSTone {
        switch self {
        case .override: .accent
        case .user: .info
        case .vehicle: .success
        case .default: .neutral
        }
    }
}

/// Typed projection of the web `EffectiveSetting.value` (`unknown` on the wire). The
/// resolver dispatches on each key's kind (text | number | boolean | timestamp); the
/// display string is produced at the render boundary with the device locale.
enum VehicleDetailSettingValue: Sendable, Equatable {
    case text(String)
    case number(Double)
    case boolean(Bool)
    case timestamp(Date)
    case unset

    /// Locale-formatted, language-neutral display string (web typed-input value).
    var display: String {
        switch self {
        case let .text(value):
            return value.isEmpty ? "—" : value
        case let .number(value):
            return value.formatted(.number.precision(.fractionLength(0 ... 2)))
        case let .boolean(value):
            return value ? "✓" : "—"
        case let .timestamp(date):
            return date.formatted(date: .abbreviated, time: .shortened)
        case .unset:
            return "—"
        }
    }

    /// Whether the resolver returned a concrete value for this key.
    var hasValue: Bool {
        if case .unset = self { return false }
        return true
    }
}

/// Web `EffectiveSetting` — one resolved per-vehicle setting row `{key, value, source}`.
struct VehicleDetailSetting: Identifiable, Sendable, Equatable {
    let key: String
    let value: VehicleDetailSettingValue
    let source: VehicleDetailSettingSource

    var id: String { key }
}

/// Web `VehicleSettingsResponse` envelope for `GET /vehicles/{id}/settings`.
struct VehicleDetailSettingsResponse: Sendable, Equatable {
    let settings: [VehicleDetailSetting]
}

/// Web `findEffectiveSetting(payload, key)` — the convenience selector that pulls a
/// single key's resolved row from the payload. The name is preserved verbatim so the
/// Swift call site reads identically to the React page (ADR-004 hook-name parity).
func findEffectiveSetting(
    _ payload: VehicleDetailSettingsResponse?,
    _ key: String
) -> VehicleDetailSetting? {
    payload?.settings.first { $0.key == key }
}

/// The supported per-vehicle setting keys, in render order. Mirrors
/// `VEHICLE_SETTING_DESCRIPTORS` in the web `VehicleSettingsTab` and
/// `vehicleSettingDefs` in `internal/database/vehicle_settings_repo.go`.
enum VehicleDetailSettingKey {
    static let ordered = [
        "nickname",
        "mute_until",
        "charge_cost_tariff_id",
        "units_distance",
        "units_temperature",
        "units_energy"
    ]

    /// Human label key (web `vehicleSettings.keys.{key}.label`).
    static func labelKey(_ key: String) -> LocalizedStringKey {
        LocalizedStringKey("translation.vehicleSettings.keys.\(key).label")
    }

    /// Help-text key (web `vehicleSettings.keys.{key}.help`).
    static func helpKey(_ key: String) -> LocalizedStringKey {
        LocalizedStringKey("translation.vehicleSettings.keys.\(key).help")
    }
}

// MARK: - Section-error-boundary contract (web `<SectionErrorBoundary fallbackTitle>`)

/// Every region the web `VehicleDetailPage` wraps in a `<SectionErrorBoundary>`. Each
/// case carries the localized fallback title the boundary renders on failure
/// (`vehicles.detail.section.*Failed`) plus a navigator name + SF Symbol, so the native
/// page reproduces the same sectioned structure adaptively across macOS and iOS.
enum VehicleDetailSectionKind: String, CaseIterable, Identifiable, Sendable {
    case header
    case batteryRange
    case liveState
    case quickStats
    case motor
    case climate
    case security
    case tire
    case chargingTelemetry
    case batteryCharts
    case recentDrives
    case recentCharges
    case vehicleConfig
    case aiPaintPreview
    case quickLinks
    case settings

    var id: String { rawValue }

    /// The web `SectionErrorBoundary` `fallbackTitle` for this region.
    var failedTitleKey: LocalizedStringKey {
        switch self {
        case .header: "translation.vehicles.detail.section.headerFailed"
        case .batteryRange: "translation.vehicles.detail.section.batteryRangeFailed"
        case .liveState: "translation.vehicles.detail.section.liveStateFailed"
        case .quickStats: "translation.vehicles.detail.section.quickStatsFailed"
        case .motor: "translation.vehicles.detail.section.motorFailed"
        case .climate: "translation.vehicles.detail.section.climateFailed"
        case .security: "translation.vehicles.detail.section.securityFailed"
        case .tire: "translation.vehicles.detail.section.tireFailed"
        case .chargingTelemetry: "translation.vehicles.detail.section.chargingTelemetryFailed"
        case .batteryCharts: "translation.vehicles.detail.section.batteryChartsFailed"
        case .recentDrives: "translation.vehicles.detail.section.recentDrivesFailed"
        case .recentCharges: "translation.vehicles.detail.section.recentChargesFailed"
        case .vehicleConfig: "translation.vehicles.detail.section.vehicleConfigFailed"
        case .aiPaintPreview: "translation.vehicles.detail.section.aiPaintPreviewFailed"
        case .quickLinks: "translation.vehicles.detail.section.quickLinksFailed"
        case .settings: "translation.vehicles.detail.section.settingsFailed"
        }
    }

    /// Localized section name for the navigator row (reuses existing catalog keys
    /// where present; a handful of `*Name` keys are added for regions without one).
    var nameKey: LocalizedStringKey {
        switch self {
        case .header: "translation.vehicles.detail.title"
        case .batteryRange: "translation.vehicles.detail.batteryOverview"
        case .liveState: "translation.vehicles.detail.section.liveStateName"
        case .quickStats: "translation.vehicles.detail.section.quickStatsName"
        case .motor: "translation.vehicles.detail.motor"
        case .climate: "translation.vehicles.detail.climate"
        case .security: "translation.vehicles.detail.security"
        case .tire: "translation.vehicles.detail.tirePressure"
        case .chargingTelemetry: "translation.vehicles.detail.chargingTelemetry"
        case .batteryCharts: "translation.vehicles.detail.section.batteryChartsName"
        case .recentDrives: "translation.vehicles.detail.section.recentDrivesName"
        case .recentCharges: "translation.vehicles.detail.section.recentChargesName"
        case .vehicleConfig: "translation.vehicles.detail.vehicleConfig"
        case .aiPaintPreview: "translation.vehicles.detail.section.aiPaintPreviewName"
        case .quickLinks: "translation.vehicles.detail.quickLinks"
        case .settings: "translation.vehicleSettings.title"
        }
    }

    /// SF Symbol representing the section in the navigator and accessibility label.
    var symbol: String {
        switch self {
        case .header: "car.fill"
        case .batteryRange: "battery.100"
        case .liveState: "dot.radiowaves.left.and.right"
        case .quickStats: "square.grid.2x2"
        case .motor: "engine.combustion"
        case .climate: "thermometer.medium"
        case .security: "lock.shield"
        case .tire: "circle.dashed"
        case .chargingTelemetry: "bolt.fill"
        case .batteryCharts: "chart.xyaxis.line"
        case .recentDrives: "road.lanes"
        case .recentCharges: "bolt.batteryblock"
        case .vehicleConfig: "gearshape.2"
        case .aiPaintPreview: "paintpalette"
        case .quickLinks: "link"
        case .settings: "slider.horizontal.3"
        }
    }

    /// The regions surfaced as navigator rows — every section except the two this unit
    /// renders inline (the header and the settings panel / GlassPanel1).
    static var navigatorSections: [VehicleDetailSectionKind] {
        allCases.filter { $0 != .header && $0 != .settings }
    }
}
