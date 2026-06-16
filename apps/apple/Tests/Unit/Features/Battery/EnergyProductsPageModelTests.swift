import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `EnergyProductsPageModel` — every data state the page
/// renders (loading / no-sites empty / sites error / ready), the per-site info load (each card's
/// own loading → detail / empty), the per-card refresh (a failed refresh keeps the last-known
/// detail), the summary tallies the web computes with `sites.filter(...)`, and the pure display
/// formatters + label resolution (web `fmtEnergy` / `fmtPower` / `resourceLabel` /
/// `operationModeLabel`).
@MainActor
final class EnergyProductsPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: EnergyProductsDataSource {
        var sites: [EnergyProductSite]
        var info: [Int64: EnergyProductSiteInfoResponse] = [:]
        var failSites = false
        var failLoadInfo = false
        var failRefreshInfo = false

        func loadSites() async throws -> [EnergyProductSite] {
            if failSites { throw StubError() }
            return sites
        }

        func refreshSites() async throws -> [EnergyProductSite] {
            if failSites { throw StubError() }
            return sites
        }

        func loadSiteInfo(siteID: Int64) async throws -> EnergyProductSiteInfoResponse? {
            if failLoadInfo { throw StubError() }
            return info[siteID]
        }

        func refreshSiteInfo(siteID: Int64) async throws -> EnergyProductSiteInfoResponse? {
            if failRefreshInfo { throw StubError() }
            return info[siteID]
        }
    }

    private func site(
        _ id: Int64,
        energyID: Int64,
        type: String = "battery",
        solar: Bool = true,
        battery: Bool = true,
        backup: Bool = true
    ) -> EnergyProductSite {
        EnergyProductSite(
            id: id,
            energySiteID: energyID,
            resourceType: type,
            siteName: "Site\(id)",
            batteryType: battery ? "ac_powerwall" : nil,
            totalPackEnergyWh: battery ? 40_500 : nil,
            percentageCharged: battery ? 75 : nil,
            backupCapable: backup,
            stormModeEnabled: false,
            hasSolar: solar,
            hasBattery: battery,
            hasGrid: true,
            touCapable: true,
            stormModeCapable: false,
            fetchedAt: "2026-06-15T18:00:00Z"
        )
    }

    private func infoResponse(
        reserve: Double? = 30,
        count: Int? = 3,
        tariff: String? = "PG&E EV2-A"
    ) -> EnergyProductSiteInfoResponse {
        EnergyProductSiteInfoResponse(
            data: EnergyProductSiteInfo(
                defaultRealMode: "autonomous",
                backupReservePercent: reserve,
                batteryCount: count,
                nameplatePowerW: 15_000,
                nameplateEnergyWh: 40_500,
                version: "23.44.0",
                installationTimeZone: "UTC",
                touCapable: true,
                tariffName: tariff,
                components: [EnergyProductComponentFlag(name: "solar", value: true)]
            ),
            fetchedAt: "2026-06-15T18:00:05Z"
        )
    }

    // MARK: - State machine

    func testLoadPopulatesAndReadies() async {
        let stub = StubSource(
            sites: [site(1, energyID: 100), site(2, energyID: 200, type: "solar", battery: false, backup: false)],
            info: [100: infoResponse(), 200: infoResponse(reserve: nil, count: nil, tariff: nil)]
        )
        let model = EnergyProductsPageModel(dataSource: stub)
        await model.load()

        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.sites.count, 2)
        XCTAssertFalse(model.hasNoSites)
        XCTAssertEqual(model.siteInfoState(for: site(1, energyID: 100)).status, .loaded)
        XCTAssertNotNil(model.siteInfoState(for: site(1, energyID: 100)).info)
    }

    func testSitesFailureSetsErrorPhase() async {
        var stub = StubSource(sites: [])
        stub.failSites = true
        let model = EnergyProductsPageModel(dataSource: stub)
        await model.load()

        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertTrue(model.sites.isEmpty)
    }

    func testEmptySitesReadiesWithNoSites() async {
        let model = EnergyProductsPageModel(dataSource: StubSource(sites: []))
        await model.load()

        XCTAssertEqual(model.phase, .ready)
        XCTAssertTrue(model.hasNoSites)
        XCTAssertEqual(model.totalSites, 0)
    }

    func testSiteInfoEmptyWhenNoDetail() async {
        // Sites present, but the info query yields no detail (web `info ? … : <EmptyState/>`).
        let stub = StubSource(sites: [site(1, energyID: 100)], info: [:])
        let model = EnergyProductsPageModel(dataSource: stub)
        await model.load()

        let state = model.siteInfoState(for: site(1, energyID: 100))
        XCTAssertEqual(state.status, .loaded)
        XCTAssertNil(state.info)
    }

    func testSiteInfoLoadErrorYieldsEmpty() async {
        var stub = StubSource(sites: [site(1, energyID: 100)], info: [100: infoResponse()])
        stub.failLoadInfo = true
        let model = EnergyProductsPageModel(dataSource: stub)
        await model.load()

        // Page still readies (info errors never block the page); the card shows its empty state.
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNil(model.siteInfoState(for: site(1, energyID: 100)).info)
    }

    // MARK: - Per-card refresh

    func testRefreshSiteInfoUpdatesDetail() async {
        let stub = StubSource(sites: [site(1, energyID: 100)], info: [100: infoResponse(tariff: "New Plan")])
        let model = EnergyProductsPageModel(dataSource: stub)
        await model.load()

        await model.refreshSiteInfo(siteID: 100)
        let state = model.siteInfoState(for: site(1, energyID: 100))
        XCTAssertEqual(state.info?.tariffName, "New Plan")
        XCTAssertFalse(state.isRefreshing)
    }

    func testRefreshSiteInfoFailureKeepsPreviousDetail() async {
        var stub = StubSource(sites: [site(1, energyID: 100)], info: [100: infoResponse(tariff: "Original")])
        stub.failRefreshInfo = true
        let model = EnergyProductsPageModel(dataSource: stub)
        await model.load()
        XCTAssertEqual(model.siteInfoState(for: site(1, energyID: 100)).info?.tariffName, "Original")

        await model.refreshSiteInfo(siteID: 100)
        let state = model.siteInfoState(for: site(1, energyID: 100))
        XCTAssertEqual(state.info?.tariffName, "Original", "a failed refresh keeps the last-known detail")
        XCTAssertFalse(state.isRefreshing)
    }

    // MARK: - Summary tallies (web summary StatCards)

    func testSummaryTallies() async {
        let stub = StubSource(
            sites: [
                site(1, energyID: 100, solar: true, battery: true, backup: true),
                site(2, energyID: 200, type: "solar", solar: true, battery: false, backup: false),
                site(3, energyID: 300, solar: false, battery: true, backup: true)
            ]
        )
        let model = EnergyProductsPageModel(dataSource: stub)
        await model.load()

        XCTAssertEqual(model.totalSites, 3)
        XCTAssertEqual(model.sitesWithSolar, 2)
        XCTAssertEqual(model.sitesWithBattery, 2)
        XCTAssertEqual(model.sitesBackupCapable, 2)
    }

    // MARK: - Formatters

    func testFormatters() {
        XCTAssertEqual(EnergyProductsFormat.energy(40_500), "40.5 kWh")
        XCTAssertEqual(EnergyProductsFormat.energy(500), "500 Wh")
        XCTAssertEqual(EnergyProductsFormat.energy(nil), "—")
        XCTAssertEqual(EnergyProductsFormat.power(15_000), "15.0 kW")
        XCTAssertEqual(EnergyProductsFormat.power(800), "800 W")
        XCTAssertEqual(EnergyProductsFormat.power(nil), "—")
        XCTAssertEqual(EnergyProductsFormat.percent(82.4), "82.4%")
        XCTAssertEqual(EnergyProductsFormat.percent(nil), "—")
        XCTAssertEqual(EnergyProductsFormat.count(3), "3")
        XCTAssertEqual(EnergyProductsFormat.count(nil), "—")
        XCTAssertEqual(EnergyProductsFormat.number(12_345.6, decimals: 0), "12,346")
        XCTAssertEqual(EnergyProductsFormat.humanizeComponent("load_meter"), "load meter")
        XCTAssertEqual(EnergyProductsFormat.dateTime(nil), "—")
    }

    // MARK: - Label resolution (web resourceLabel / operationModeLabel)

    func testLabels() {
        XCTAssertEqual(EnergyProductsStrings.resourceLabel("battery"), "Powerwall")
        XCTAssertEqual(EnergyProductsStrings.resourceLabel("solar"), "Solar")
        XCTAssertEqual(EnergyProductsStrings.resourceLabel("wall_connector"), "wall_connector")
        XCTAssertEqual(EnergyProductsStrings.operationMode("self_consumption"), "Self-Powered")
        XCTAssertEqual(EnergyProductsStrings.operationMode("autonomous"), "Time-Based Control")
        XCTAssertEqual(EnergyProductsStrings.operationMode("backup"), "Backup Only")
        XCTAssertEqual(EnergyProductsStrings.operationMode(nil), "—")
        XCTAssertEqual(EnergyProductsStrings.operationMode("custom"), "custom")
        XCTAssertEqual(EnergyProductsStrings.siteIdLabel(123), "ID 123")
        XCTAssertEqual(EnergyProductsStrings.siteSubtitle(type: "battery", id: 5), "Powerwall · ID 5")
    }
}
