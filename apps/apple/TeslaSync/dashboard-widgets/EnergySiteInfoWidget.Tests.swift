//
//  EnergySiteInfoWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0047 · EnergySiteInfoWidget (Apple)
//
//  Unit coverage for the EnergySiteInfoWidget surface:
//    • Adapter (cached → projection) — `EnergySiteInfoProjector` value parity with the web widget's
//      pipeline (nameplate_power/1000 → kW, nameplate_energy/1000 → kWh, fmtInt(battery_count),
//      version + installation_time_zone passthrough, and the em-dash fallbacks).
//    • Formatters — `fmtNumber` half-up + grouping and `fmtInt`, ported from web numberFormat.ts.
//    • State holder — `EnergySiteInfoModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `energy-site-info` metadata + size clamping.
//    • Layout — the web `isCompact` (cols ≤ 1) size mapping.
//    • Accessibility — the VoiceOver summary content for both the loaded card and the empty states.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryEnergySiteInfoSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

@MainActor final class EnergySiteInfoAdapterTests: XCTestCase {
    private let fullInfo = EnergySiteInfoDataDTO(
        nameplatePowerW: 9800,
        nameplateEnergyWh: 27000,
        batteryCount: 2,
        version: "23.44.0",
        installationTimeZone: "America/Los_Angeles"
    )

    func testFullProjectionMatchesWebPipeline() {
        let projection = EnergySiteInfoProjector.project(info: fullInfo, hasSites: true)
        XCTAssertTrue(projection.hasSites)
        XCTAssertEqual(projection.entries.map(\.id), ["solar", "powerwall", "firmware", "timezone"])
        XCTAssertEqual(
            projection.entries.map(\.label),
            ["Solar System", "Powerwalls", "Gateway Firmware", "Installation Timezone"]
        )
        XCTAssertEqual(
            projection.entries.map(\.displayValue),
            ["9.8 kW", "2 × 27.0 kWh", "23.44.0", "America/Los_Angeles"]
        )
    }

    func testFirmwareRowIsMonospaced() {
        let projection = EnergySiteInfoProjector.project(info: fullInfo, hasSites: true)
        let firmware = projection.entries.first { $0.id == "firmware" }
        XCTAssertEqual(firmware?.mono, true)
        // Every other row stays in the default (non-mono) treatment.
        XCTAssertEqual(projection.entries.filter(\.mono).map(\.id), ["firmware"])
    }

    func testSolarFallsBackToEmDashWhenPowerAbsent() {
        let info = EnergySiteInfoDataDTO(nameplatePowerW: nil, nameplateEnergyWh: nil, batteryCount: 2)
        let projection = EnergySiteInfoProjector.project(info: info, hasSites: true)
        XCTAssertEqual(projection.entries.first { $0.id == "solar" }?.displayValue, "—")
    }

    func testPowerwallFallsBackToEmDashWhenCountZero() {
        let info = EnergySiteInfoDataDTO(nameplateEnergyWh: 27000, batteryCount: 0)
        let projection = EnergySiteInfoProjector.project(info: info, hasSites: true)
        XCTAssertEqual(projection.entries.first { $0.id == "powerwall" }?.displayValue, "—")
    }

    func testPowerwallEnergyFallsBackWhenNameplateEnergyAbsentButCountPresent() {
        let info = EnergySiteInfoDataDTO(nameplateEnergyWh: nil, batteryCount: 3)
        let projection = EnergySiteInfoProjector.project(info: info, hasSites: true)
        // Web: `${fmtInt(count)} × ${kWh ?? '—'} kWh` → "3 × — kWh".
        XCTAssertEqual(projection.entries.first { $0.id == "powerwall" }?.displayValue, "3 × — kWh")
    }

    func testFirmwareAndTimezoneEmDashWhenNil() {
        let info = EnergySiteInfoDataDTO(
            nameplatePowerW: 9800,
            nameplateEnergyWh: 27000,
            batteryCount: 2,
            version: nil,
            installationTimeZone: nil
        )
        let projection = EnergySiteInfoProjector.project(info: info, hasSites: true)
        XCTAssertNil(projection.entries.first { $0.id == "firmware" }?.value)
        XCTAssertEqual(projection.entries.first { $0.id == "firmware" }?.displayValue, "—")
        XCTAssertNil(projection.entries.first { $0.id == "timezone" }?.value)
        XCTAssertEqual(projection.entries.first { $0.id == "timezone" }?.displayValue, "—")
    }

    func testGroupingSeparatorOnLargeCapacity() {
        let info = EnergySiteInfoDataDTO(nameplateEnergyWh: 1_234_500, batteryCount: 3)
        let projection = EnergySiteInfoProjector.project(info: info, hasSites: true)
        XCTAssertEqual(projection.entries.first { $0.id == "powerwall" }?.displayValue, "3 × 1,234.5 kWh")
    }

    func testNoInfoProducesNoEntries() {
        let withSites = EnergySiteInfoProjector.project(info: nil, hasSites: true)
        XCTAssertTrue(withSites.entries.isEmpty)
        XCTAssertTrue(withSites.hasSites)

        let withoutSites = EnergySiteInfoProjector.project(info: nil, hasSites: false)
        XCTAssertTrue(withoutSites.entries.isEmpty)
        XCTAssertFalse(withoutSites.hasSites)
    }
}

// MARK: - Formatters (ported from the web numeric helpers)

@MainActor final class EnergySiteInfoFormatTests: XCTestCase {
    func testNumberRoundsHalfUpWithGrouping() {
        XCTAssertEqual(EnergySiteInfoFormat.number(9.8, decimals: 1), "9.8")
        XCTAssertEqual(EnergySiteInfoFormat.number(27, decimals: 1), "27.0")
        XCTAssertEqual(EnergySiteInfoFormat.number(1234.55, decimals: 1), "1,234.6")
        XCTAssertEqual(EnergySiteInfoFormat.number(.infinity, decimals: 1), "0.0")
        XCTAssertEqual(EnergySiteInfoFormat.number(.nan, decimals: 1), "0.0")
    }

    func testIntGroupsWithoutFraction() {
        XCTAssertEqual(EnergySiteInfoFormat.int(2), "2")
        XCTAssertEqual(EnergySiteInfoFormat.int(12345), "12,345")
        XCTAssertEqual(EnergySiteInfoFormat.int(.infinity), "0")
    }

    func testEmptyDashIsEmDash() {
        XCTAssertEqual(EnergySiteInfoFormat.emptyDash, "—")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class EnergySiteInfoPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(EnergySiteInfoModel.resolvePhase(status: .loading, hasInfo: false), .loading)
        XCTAssertEqual(EnergySiteInfoModel.resolvePhase(status: .loading, hasInfo: true), .content)
        XCTAssertEqual(EnergySiteInfoModel.resolvePhase(status: .empty, hasInfo: false), .empty)
        XCTAssertEqual(EnergySiteInfoModel.resolvePhase(status: .empty, hasInfo: true), .empty)
        XCTAssertEqual(EnergySiteInfoModel.resolvePhase(status: .loaded, hasInfo: false), .empty)
        XCTAssertEqual(EnergySiteInfoModel.resolvePhase(status: .loaded, hasInfo: true), .content)
        XCTAssertEqual(EnergySiteInfoModel.resolvePhase(status: .failed("x"), hasInfo: false), .error("x"))
        XCTAssertEqual(EnergySiteInfoModel.resolvePhase(status: .failed("x"), hasInfo: true), .content)
    }
}

@MainActor final class EnergySiteInfoModelTests: XCTestCase {
    private let sites = [EnergySiteInfoSiteDTO(energySiteID: 1, siteName: "Home")]
    private let info = EnergySiteInfoDataDTO(
        nameplatePowerW: 9800,
        nameplateEnergyWh: 27000,
        batteryCount: 2,
        version: "23.44.0",
        installationTimeZone: "America/Los_Angeles"
    )

    private func makeModel(
        _ update: EnergySiteInfoUpdate,
        telemetry: EnergySiteInfoTelemetry = OSLogEnergySiteInfoTelemetry()
    ) -> (EnergySiteInfoModel, InMemoryEnergySiteInfoSource) {
        let source = InMemoryEnergySiteInfoSource(initial: update)
        let model = EnergySiteInfoModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutInfoShowsLoading() {
        let (model, _) = makeModel(EnergySiteInfoUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithSitesButNoInfoShowsEmptyWithSites() {
        let (model, _) = makeModel(EnergySiteInfoUpdate(status: .loaded, sites: sites, info: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.projection?.hasSites, true)
    }

    func testLoadedWithoutSitesShowsEmptyWithoutSites() {
        let (model, _) = makeModel(EnergySiteInfoUpdate(status: .loaded, sites: [], info: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.projection?.hasSites, false)
    }

    func testFailedWithoutInfoShowsError() {
        let (model, _) = makeModel(EnergySiteInfoUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testInfoPresentShowsContentEvenWhileFailed() {
        let (model, _) = makeModel(EnergySiteInfoUpdate(status: .failed("net"), sites: sites, info: info))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.entries.first { $0.id == "solar" }?.displayValue, "9.8 kW")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyEnergySiteInfoTelemetry()
        let (model, source) = makeModel(EnergySiteInfoUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [EnergySiteInfoWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(EnergySiteInfoUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let (model, source) = makeModel(EnergySiteInfoUpdate(status: .loaded, sites: sites, info: info))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(EnergySiteInfoUpdate(
            status: .loaded,
            connection: .stale,
            isFetching: true,
            sites: sites,
            info: info
        ))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(EnergySiteInfoUpdate(
            status: .loaded,
            connection: .stale,
            isFetching: false,
            sites: sites,
            info: info
        ))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(EnergySiteInfoUpdate(status: .loading))
        model.start()
        source.push(
            EnergySiteInfoUpdate(
                status: .loaded,
                connection: .offline,
                sites: sites,
                info: info,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.entries.count, 4)
        XCTAssertNotNil(model.updatedAt)
    }
}

// MARK: - Registry parity

@MainActor final class EnergySiteInfoRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = EnergySiteInfoWidget.registration
        XCTAssertEqual(registration.id, "energy-site-info")
        XCTAssertEqual(registration.category, "energy")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(EnergySiteInfoWidget.surfaceSlug, "EnergySiteInfoWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = EnergySiteInfoWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 4)),
            DashboardWidgetSize(cols: 2, rows: 4)
        )
    }
}

// MARK: - Layout (web isCompact)

@MainActor final class EnergySiteInfoLayoutTests: XCTestCase {
    func testIsCompactWhenAtMostOneColumn() {
        XCTAssertTrue(EnergySiteInfoLayout.isCompact(DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertTrue(EnergySiteInfoLayout.isCompact(DashboardWidgetSize(cols: 1, rows: 4)))
        XCTAssertFalse(EnergySiteInfoLayout.isCompact(DashboardWidgetSize(cols: 2, rows: 2)))
        XCTAssertFalse(EnergySiteInfoLayout.isCompact(DashboardWidgetSize(cols: 4, rows: 4)))
    }
}

// MARK: - Accessibility summary content

@MainActor final class EnergySiteInfoAccessibilityTests: XCTestCase {
    func testContentSummaryIncludesEveryRow() {
        let info = EnergySiteInfoDataDTO(
            nameplatePowerW: 9800,
            nameplateEnergyWh: 27000,
            batteryCount: 2,
            version: "23.44.0",
            installationTimeZone: "America/Los_Angeles"
        )
        let projection = EnergySiteInfoProjector.project(info: info, hasSites: true)
        XCTAssertEqual(
            EnergySiteInfoAccessibility.summary(for: projection),
            "Energy Site. Solar System 9.8 kW. Powerwalls 2 × 27.0 kWh. "
                + "Gateway Firmware 23.44.0. Installation Timezone America/Los_Angeles"
        )
    }

    func testEmptySummaryDistinguishesNoSiteFromNoInfo() {
        XCTAssertEqual(
            EnergySiteInfoAccessibility.emptySummary(hasSites: false),
            "Energy Site. No Tesla Energy site linked"
        )
        XCTAssertEqual(
            EnergySiteInfoAccessibility.emptySummary(hasSites: true),
            "Energy Site. No site info available"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyEnergySiteInfoTelemetry: EnergySiteInfoTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
