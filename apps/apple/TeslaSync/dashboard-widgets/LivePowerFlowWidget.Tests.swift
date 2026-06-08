//
//  LivePowerFlowWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0056 · LivePowerFlowWidget (Apple)
//
//  Unit coverage for the LivePowerFlowWidget surface:
//    • Adapter (cached → projection) — `PowerFlowBuilder` parity with the web
//      node/arrow derivation + the diagram stroke/visibility math.
//    • State holder — `LivePowerFlowModel` phase resolution across loading /
//      no-site / empty / error / content, plus the P1/S11 `view.opened`
//      telemetry + source wiring.
//    • Registry — canonical `live-power-flow` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryLivePowerFlowSource`.
//

import XCTest

// MARK: - Adapter: cached DTO → projection (parity with the web memos)

@MainActor
final class PowerFlowBuilderTests: XCTestCase {
    private func arrow(_ arrows: [PowerFlowArrow], _ from: PowerFlowNodeID, _ to: PowerFlowNodeID) -> PowerFlowArrow? {
        arrows.first { $0.from == from && $0.to == to }
    }

    func testNilLiveStatusYieldsEmptyProjection() {
        let projection = PowerFlowBuilder.buildProjection(nil)
        XCTAssertEqual(projection, .empty)
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.nodes.isEmpty)
        XCTAssertTrue(projection.arrows.isEmpty)
    }

    func testNodesUseAbsoluteMagnitudesAndWebPositions() {
        let live = PowerFlowLiveStatus(solarPowerW: 4000, batteryPowerW: 1500, loadPowerW: 2000, gridPowerW: -500)
        let projection = PowerFlowBuilder.buildProjection(live)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.nodes.map(\.id), [.solar, .grid, .home, .battery])
        XCTAssertEqual(projection.node(.solar)?.position, .top)
        XCTAssertEqual(projection.node(.grid)?.position, .left)
        XCTAssertEqual(projection.node(.home)?.position, .right)
        XCTAssertEqual(projection.node(.battery)?.position, .bottom)
        XCTAssertEqual(projection.node(.solar)?.valueKw ?? 0, 4.0, accuracy: 0.0001)
        XCTAssertEqual(projection.node(.grid)?.valueKw ?? 0, 0.5, accuracy: 0.0001) // abs(-0.5)
        XCTAssertEqual(projection.node(.battery)?.valueKw ?? 0, 1.5, accuracy: 0.0001)
    }

    func testProducingChargingExportingArrows() {
        let live = PowerFlowLiveStatus(solarPowerW: 4000, batteryPowerW: 1500, loadPowerW: 2000, gridPowerW: -500)
        let arrows = PowerFlowBuilder.buildProjection(live).arrows
        XCTAssertEqual(arrows.count, 3)
        XCTAssertEqual(arrow(arrows, .solar, .home)?.valueKw ?? 0, 4.0, accuracy: 0.0001)
        XCTAssertEqual(arrow(arrows, .solar, .home)?.colorNode, .solar)
        XCTAssertEqual(arrow(arrows, .solar, .battery)?.valueKw ?? 0, 1.5, accuracy: 0.0001) // min(4.0, 1.5)
        XCTAssertEqual(arrow(arrows, .home, .grid)?.valueKw ?? 0, 0.5, accuracy: 0.0001)
        XCTAssertEqual(arrow(arrows, .home, .grid)?.colorNode, .home)
        XCTAssertNil(arrow(arrows, .grid, .battery))
    }

    func testDischargingImportingArrows() {
        let live = PowerFlowLiveStatus(solarPowerW: 0, batteryPowerW: -2000, loadPowerW: 3000, gridPowerW: 1000)
        let arrows = PowerFlowBuilder.buildProjection(live).arrows
        XCTAssertEqual(arrows.count, 2)
        XCTAssertEqual(arrow(arrows, .battery, .home)?.valueKw ?? 0, 2.0, accuracy: 0.0001)
        XCTAssertEqual(arrow(arrows, .battery, .home)?.colorNode, .battery)
        XCTAssertEqual(arrow(arrows, .grid, .home)?.valueKw ?? 0, 1.0, accuracy: 0.0001)
        XCTAssertNil(arrow(arrows, .solar, .home))
    }

    func testGridChargesBatteryWhenNoSolar() {
        let live = PowerFlowLiveStatus(solarPowerW: 0, batteryPowerW: 1000, loadPowerW: 500, gridPowerW: 1500)
        let arrows = PowerFlowBuilder.buildProjection(live).arrows
        XCTAssertEqual(arrows.count, 2)
        XCTAssertEqual(arrow(arrows, .grid, .battery)?.valueKw ?? 0, 1.0, accuracy: 0.0001)
        XCTAssertEqual(arrow(arrows, .grid, .battery)?.colorNode, .grid)
        XCTAssertNil(arrow(arrows, .solar, .battery))
    }

    func testTrivialSolarArrowIsInactiveBelowThreshold() {
        let live = PowerFlowLiveStatus(solarPowerW: 5, batteryPowerW: 0, loadPowerW: 5, gridPowerW: 0)
        let arrows = PowerFlowBuilder.buildProjection(live).arrows
        let solarHome = arrow(arrows, .solar, .home)
        XCTAssertNotNil(solarHome)
        XCTAssertFalse(solarHome?.active ?? true) // 0.005 kW <= 0.01
    }

    func testVisibleArrowsKeepsThreeLargestWhenCompact() {
        let synthetic = [
            PowerFlowArrow(from: .solar, to: .home, valueKw: 1, active: true, colorNode: .solar),
            PowerFlowArrow(from: .grid, to: .home, valueKw: 5, active: true, colorNode: .grid),
            PowerFlowArrow(from: .battery, to: .home, valueKw: 3, active: true, colorNode: .battery),
            PowerFlowArrow(from: .home, to: .grid, valueKw: 4, active: true, colorNode: .home)
        ]
        let expanded = PowerFlowBuilder.visibleArrows(synthetic, compact: false)
        XCTAssertEqual(expanded.count, 4)
        let compact = PowerFlowBuilder.visibleArrows(synthetic, compact: true)
        XCTAssertEqual(compact.count, 3)
        XCTAssertEqual(compact.map(\.valueKw), [5, 4, 3]) // sorted by magnitude, top 3
    }

    func testMaxArrowValueFloorsAtOne() {
        XCTAssertEqual(PowerFlowBuilder.maxArrowValue([]), 1, accuracy: 0.0001)
        let arrows = [PowerFlowArrow(from: .grid, to: .home, valueKw: -7, active: true, colorNode: .grid)]
        XCTAssertEqual(PowerFlowBuilder.maxArrowValue(arrows), 7, accuracy: 0.0001)
    }

    func testStrokeScalesBetweenMinAndMax() {
        XCTAssertEqual(PowerFlowBuilder.stroke(for: 0, max: 5), 1, accuracy: 0.0001)
        XCTAssertEqual(PowerFlowBuilder.stroke(for: 5, max: 5), 4, accuracy: 0.0001)
        XCTAssertEqual(PowerFlowBuilder.stroke(for: 2.5, max: 5), 2.5, accuracy: 0.0001)
        XCTAssertEqual(PowerFlowBuilder.stroke(for: 3, max: 0), 1, accuracy: 0.0001) // guard
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class LivePowerFlowModelTests: XCTestCase {
    private func makeModel(
        _ update: LivePowerFlowUpdate,
        telemetry: LivePowerFlowTelemetry = OSLogLivePowerFlowTelemetry()
    ) -> (LivePowerFlowModel, InMemoryLivePowerFlowSource) {
        let source = InMemoryLivePowerFlowSource(initial: update)
        let model = LivePowerFlowModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private let live = PowerFlowLiveStatus(solarPowerW: 4000, batteryPowerW: 1500, loadPowerW: 2000, gridPowerW: -500)

    func testLoadingWithoutCachedLiveShowsLoading() {
        let (model, _) = makeModel(LivePowerFlowUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadingWithCachedLiveShowsContent() {
        let (model, _) = makeModel(LivePowerFlowUpdate(status: .loading, hasSites: true, liveStatus: live))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedWithoutSitesShowsNoSite() {
        let (model, _) = makeModel(LivePowerFlowUpdate(status: .loaded, hasSites: false))
        model.start()
        XCTAssertEqual(model.phase, .noSite)
    }

    func testLoadedWithSiteButNoLiveShowsEmpty() {
        let (model, _) = makeModel(
            LivePowerFlowUpdate(status: .loaded, hasSites: true, site: PowerFlowSite(energySiteID: 1), liveStatus: nil)
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedWithSiteAndLiveShowsContent() {
        let (model, _) = makeModel(LivePowerFlowUpdate(status: .loaded, hasSites: true, liveStatus: live))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
        XCTAssertEqual(model.projection.nodes.count, 4)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(LivePowerFlowUpdate(status: .failed("boom"), hasSites: true))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFailedWithCachedLiveKeepsContent() {
        let (model, _) = makeModel(LivePowerFlowUpdate(status: .failed("net"), hasSites: true, liveStatus: live))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyLivePowerFlowTelemetry()
        let (model, source) = makeModel(LivePowerFlowUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LivePowerFlowWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(LivePowerFlowUpdate(status: .loaded, hasSites: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(LivePowerFlowUpdate(status: .loading))
        model.start()
        source.push(
            LivePowerFlowUpdate(
                status: .loaded,
                connection: .offline,
                hasSites: true,
                site: PowerFlowSite(energySiteID: 7),
                liveStatus: live,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.arrows.count, 3)
    }

    func testCompactThreshold() {
        XCTAssertFalse(LivePowerFlowModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertTrue(LivePowerFlowModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 2)))
    }
}

// MARK: - Registry parity

@MainActor
final class LivePowerFlowRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = LivePowerFlowWidget.registration
        XCTAssertEqual(registration.id, "live-power-flow")
        XCTAssertEqual(registration.category, "energy")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = LivePowerFlowWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor
final class LivePowerFlowAccessibilityTests: XCTestCase {
    func testSummaryListsEveryNodeWithValueAndUnit() {
        let live = PowerFlowLiveStatus(solarPowerW: 4000, batteryPowerW: 1500, loadPowerW: 2000, gridPowerW: -500)
        let summary = LivePowerFlowAccessibility.summary(for: PowerFlowBuilder.buildProjection(live))
        XCTAssertTrue(summary.contains("Solar"))
        XCTAssertTrue(summary.contains("Grid"))
        XCTAssertTrue(summary.contains("Home"))
        XCTAssertTrue(summary.contains("Battery"))
        XCTAssertTrue(summary.contains("kW"))
    }

    func testSummaryFallsBackWhenNoData() {
        let summary = LivePowerFlowAccessibility.summary(for: .empty)
        XCTAssertTrue(summary.contains("No live power data"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLivePowerFlowTelemetry: LivePowerFlowTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@testable import TeslaSync
