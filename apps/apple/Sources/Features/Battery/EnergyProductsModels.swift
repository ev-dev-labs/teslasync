import Foundation

// Value types for the Energy Products surface (web
// `web/src/features/battery/pages/EnergyProductsPage.tsx`, route `/energy-products`).
// Every physical quantity stays SI exactly as the Tesla Fleet API serves it — pack energy and
// nameplate energy are watt-hours, nameplate power is watts — and the display unit is applied
// only at the SwiftUI render boundary (ADR-005). Field names mirror the snake_case wire
// (`total_pack_energy`, `nameplate_power`, `backup_reserve_percent`) so the production
// KMP-backed data source maps straight across. The pure display formatters live in
// `EnergyProductsFormat.swift`; the localized label resolution lives in
// `EnergyProductsStrings.swift`.

// MARK: - Energy product site (web `TeslaEnergySite` → GET /tesla/energy-sites)

/// One Tesla Energy product discovered from `/products` (web `TeslaEnergySite`). Drives the
/// summary counts and a per-site card. `totalPackEnergyWh` is SI watt-hours; `percentageCharged`
/// is a raw percent; the capability flags drive the badges + summary tallies. Nullable wire
/// fields stay optional so the card renders an em dash rather than a fabricated zero.
public struct EnergyProductSite: Identifiable, Equatable, Sendable {
    /// The local DB row id (web React `key`).
    public let id: Int64
    /// The Tesla energy-site id that drives the `useTeslaEnergySiteInfo` query.
    public let energySiteID: Int64
    public let resourceType: String
    public let siteName: String?
    public let batteryType: String?
    public let totalPackEnergyWh: Double?
    public let percentageCharged: Double?
    public let backupCapable: Bool
    public let stormModeEnabled: Bool
    public let hasSolar: Bool
    public let hasBattery: Bool
    public let hasGrid: Bool
    public let touCapable: Bool
    public let stormModeCapable: Bool
    public let fetchedAt: String?

    public init(
        id: Int64,
        energySiteID: Int64,
        resourceType: String,
        siteName: String?,
        batteryType: String?,
        totalPackEnergyWh: Double?,
        percentageCharged: Double?,
        backupCapable: Bool,
        stormModeEnabled: Bool,
        hasSolar: Bool,
        hasBattery: Bool,
        hasGrid: Bool,
        touCapable: Bool,
        stormModeCapable: Bool,
        fetchedAt: String?
    ) {
        self.id = id
        self.energySiteID = energySiteID
        self.resourceType = resourceType
        self.siteName = siteName
        self.batteryType = batteryType
        self.totalPackEnergyWh = totalPackEnergyWh
        self.percentageCharged = percentageCharged
        self.backupCapable = backupCapable
        self.stormModeEnabled = stormModeEnabled
        self.hasSolar = hasSolar
        self.hasBattery = hasBattery
        self.hasGrid = hasGrid
        self.touCapable = touCapable
        self.stormModeCapable = stormModeCapable
        self.fetchedAt = fetchedAt
    }
}

// MARK: - Site component flag (web `info.components` boolean entries)

/// One component capability entry from `site_info.components` (web `Object.entries(components)`
/// boolean rows). The raw wire key (`solar`, `battery`, `load_meter`, …) is data, humanized for
/// display; `value` decides the badge tone.
public struct EnergyProductComponentFlag: Identifiable, Equatable, Sendable {
    public let name: String
    public let value: Bool

    public var id: String { name }

    public init(name: String, value: Bool) {
        self.name = name
        self.value = value
    }
}

// MARK: - Site info (web `TeslaEnergySiteInfo` → GET /tesla/energy-sites/{id}/site-info)

/// The detailed site configuration (web `infoResponse.data`). `nameplatePowerW` is SI watts,
/// `nameplateEnergyWh` is SI watt-hours, `backupReservePercent` is a raw percent; display
/// scaling happens at the render boundary. A non-nil value marks "info present" (the web
/// `info ? … : <EmptyState/>` branch).
public struct EnergyProductSiteInfo: Equatable, Sendable {
    public let defaultRealMode: String?
    public let backupReservePercent: Double?
    public let batteryCount: Int?
    public let nameplatePowerW: Double?
    public let nameplateEnergyWh: Double?
    public let version: String?
    public let installationTimeZone: String?
    /// `components.tou_capable` (web TOU-section gate, ORed with the product's `tou_capable`).
    public let touCapable: Bool
    /// Resolved current tariff/rate-plan name (web `tariff_content_v2.name`), nil ⇒ no plan.
    public let tariffName: String?
    public let components: [EnergyProductComponentFlag]

    public init(
        defaultRealMode: String?,
        backupReservePercent: Double?,
        batteryCount: Int?,
        nameplatePowerW: Double?,
        nameplateEnergyWh: Double?,
        version: String?,
        installationTimeZone: String?,
        touCapable: Bool,
        tariffName: String?,
        components: [EnergyProductComponentFlag]
    ) {
        self.defaultRealMode = defaultRealMode
        self.backupReservePercent = backupReservePercent
        self.batteryCount = batteryCount
        self.nameplatePowerW = nameplatePowerW
        self.nameplateEnergyWh = nameplateEnergyWh
        self.version = version
        self.installationTimeZone = installationTimeZone
        self.touCapable = touCapable
        self.tariffName = tariffName
        self.components = components
    }
}

/// The site-info query envelope (web `TeslaEnergySiteInfoResponse`): the optional detail plus
/// the `fetched_at` timestamp the card surfaces.
public struct EnergyProductSiteInfoResponse: Equatable, Sendable {
    public let data: EnergyProductSiteInfo?
    public let fetchedAt: String?

    public init(data: EnergyProductSiteInfo?, fetchedAt: String?) {
        self.data = data
        self.fetchedAt = fetchedAt
    }
}

// MARK: - Per-site info render state (web SiteInfoSection isLoading / info / empty)

/// The render state for one card's site-info subsection, mirroring the web `useTeslaEnergySiteInfo`
/// query: `loading` shows the skeleton, `loaded` with non-nil `info` shows the detail, `loaded`
/// with nil `info` shows the empty state. `isRefreshing` tracks the per-card refresh mutation.
public struct EnergyProductSiteInfoState: Equatable, Sendable {
    public enum Status: Equatable, Sendable {
        case loading
        case loaded
    }

    public var status: Status
    public var info: EnergyProductSiteInfo?
    public var fetchedAt: String?
    public var isRefreshing: Bool

    public init(
        status: Status = .loading,
        info: EnergyProductSiteInfo? = nil,
        fetchedAt: String? = nil,
        isRefreshing: Bool = false
    ) {
        self.status = status
        self.info = info
        self.fetchedAt = fetchedAt
        self.isRefreshing = isRefreshing
    }
}
