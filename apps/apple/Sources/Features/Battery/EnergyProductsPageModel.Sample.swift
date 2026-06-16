import Foundation

/// A representative local seed used as the `EnergyProductsPage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (two discovered products: a Powerwall battery site with a full
/// site-info detail + rate plan, and a solar site) so the surface renders its populated success
/// state out of the box. Energy is watt-hours and power is watts; the view formats at the render
/// boundary.
public struct SampleEnergyProductsDataSource: EnergyProductsDataSource {
    public init() {}

    public func loadSites() async throws -> [EnergyProductSite] {
        SampleEnergyProductsDataSource.sampleSites()
    }

    public func refreshSites() async throws -> [EnergyProductSite] {
        SampleEnergyProductsDataSource.sampleSites()
    }

    public func loadSiteInfo(siteID: Int64) async throws -> EnergyProductSiteInfoResponse? {
        SampleEnergyProductsDataSource.sampleInfo(for: siteID)
    }

    public func refreshSiteInfo(siteID: Int64) async throws -> EnergyProductSiteInfoResponse? {
        SampleEnergyProductsDataSource.sampleInfo(for: siteID)
    }

    static func sampleSites() -> [EnergyProductSite] {
        [
            EnergyProductSite(
                id: 1,
                energySiteID: 4_100_001,
                resourceType: "battery",
                siteName: "Rocinante Ranch",
                batteryType: "ac_powerwall",
                totalPackEnergyWh: 40_500,
                percentageCharged: 82.4,
                backupCapable: true,
                stormModeEnabled: true,
                hasSolar: true,
                hasBattery: true,
                hasGrid: true,
                touCapable: true,
                stormModeCapable: true,
                fetchedAt: "2026-06-15T18:30:00Z"
            ),
            EnergyProductSite(
                id: 2,
                energySiteID: 4_100_002,
                resourceType: "solar",
                siteName: "Tachi Rooftop",
                batteryType: nil,
                totalPackEnergyWh: nil,
                percentageCharged: nil,
                backupCapable: false,
                stormModeEnabled: false,
                hasSolar: true,
                hasBattery: false,
                hasGrid: true,
                touCapable: false,
                stormModeCapable: false,
                fetchedAt: "2026-06-15T18:31:00Z"
            )
        ]
    }

    static func sampleInfo(for siteID: Int64) -> EnergyProductSiteInfoResponse {
        switch siteID {
        case 4_100_001:
            return EnergyProductSiteInfoResponse(
                data: EnergyProductSiteInfo(
                    defaultRealMode: "autonomous",
                    backupReservePercent: 30,
                    batteryCount: 3,
                    nameplatePowerW: 15_000,
                    nameplateEnergyWh: 40_500,
                    version: "23.44.0",
                    installationTimeZone: "America/Los_Angeles",
                    touCapable: true,
                    tariffName: "PG&E EV2-A",
                    components: [
                        EnergyProductComponentFlag(name: "solar", value: true),
                        EnergyProductComponentFlag(name: "battery", value: true),
                        EnergyProductComponentFlag(name: "grid", value: true),
                        EnergyProductComponentFlag(name: "load_meter", value: true),
                        EnergyProductComponentFlag(name: "storm_mode_capable", value: true)
                    ]
                ),
                fetchedAt: "2026-06-15T18:30:05Z"
            )
        default:
            return EnergyProductSiteInfoResponse(
                data: EnergyProductSiteInfo(
                    defaultRealMode: "self_consumption",
                    backupReservePercent: nil,
                    batteryCount: nil,
                    nameplatePowerW: 7_600,
                    nameplateEnergyWh: nil,
                    version: "23.44.0",
                    installationTimeZone: "America/Los_Angeles",
                    touCapable: false,
                    tariffName: nil,
                    components: [
                        EnergyProductComponentFlag(name: "solar", value: true),
                        EnergyProductComponentFlag(name: "battery", value: false),
                        EnergyProductComponentFlag(name: "grid", value: true)
                    ]
                ),
                fetchedAt: "2026-06-15T18:31:04Z"
            )
        }
    }
}

#if DEBUG
    /// Preview/test seam yielding no products — drives the page's honest empty state (web
    /// `sites.length === 0` GlassPanel `EmptyState`).
    public struct EmptyEnergyProductsDataSource: EnergyProductsDataSource {
        public init() {}

        public func loadSites() async throws -> [EnergyProductSite] { [] }
        public func refreshSites() async throws -> [EnergyProductSite] { [] }
        public func loadSiteInfo(siteID _: Int64) async throws -> EnergyProductSiteInfoResponse? { nil }
        public func refreshSiteInfo(siteID _: Int64) async throws -> EnergyProductSiteInfoResponse? { nil }
    }

    /// Preview/test seam with products present but no site-info detail — drives each card's own
    /// site-info empty state (web `info ? … : <EmptyState/>`) while the summary + cards render.
    public struct EmptySiteInfoEnergyProductsDataSource: EnergyProductsDataSource {
        public init() {}

        public func loadSites() async throws -> [EnergyProductSite] {
            SampleEnergyProductsDataSource.sampleSites()
        }

        public func refreshSites() async throws -> [EnergyProductSite] {
            SampleEnergyProductsDataSource.sampleSites()
        }

        public func loadSiteInfo(siteID _: Int64) async throws -> EnergyProductSiteInfoResponse? {
            EnergyProductSiteInfoResponse(data: nil, fetchedAt: nil)
        }

        public func refreshSiteInfo(siteID _: Int64) async throws -> EnergyProductSiteInfoResponse? {
            EnergyProductSiteInfoResponse(data: nil, fetchedAt: nil)
        }
    }

    /// Preview/test seam whose sites query fails — drives the page error state + retry (web
    /// PageContainer `error`).
    public struct FailingEnergyProductsDataSource: EnergyProductsDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadSites() async throws -> [EnergyProductSite] { throw Failure() }
        public func refreshSites() async throws -> [EnergyProductSite] { throw Failure() }
        public func loadSiteInfo(siteID _: Int64) async throws -> EnergyProductSiteInfoResponse? { nil }
        public func refreshSiteInfo(siteID _: Int64) async throws -> EnergyProductSiteInfoResponse? { nil }
    }
#endif
