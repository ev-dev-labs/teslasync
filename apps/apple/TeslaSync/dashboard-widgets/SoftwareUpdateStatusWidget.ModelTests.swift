//
//  SoftwareUpdateStatusWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0092 · SoftwareUpdateStatusWidget (Apple)
//
//  State-holder, registry, and layout coverage for the SoftwareUpdateStatusWidget
//  surface:
//    • State holder — `SoftwareStatusModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + source
//      wiring.
//    • Registry — canonical `software-update-status` metadata + size clamping.
//    • Layout — the compact (cols ≤ 1 && rows ≤ 1) + tall (rows ≥ 2) decisions.
//
//  Adapter + accessibility coverage live in SoftwareUpdateStatusWidget.Tests.swift.
//  These run in the TeslaSync(/-macOS) XCTest targets — no network, no real store:
//  the model is driven by `InMemorySoftwareStatusSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class SoftwareStatusModelTests: XCTestCase {
    private func dataSnapshot(
        status: SoftwareStatusLoadStatus,
        connection: SoftwareStatusConnection = .live
    ) -> SoftwareStatusSnapshot {
        SoftwareStatusSnapshot(
            status: status,
            connection: connection,
            input: SoftwareStatusInput(softwareVersion: "2024.8.10", updateVersion: "2024.20.1", downloadPct: 30),
            updatedAt: Date()
        )
    }

    private func makeModel(
        _ snapshot: SoftwareStatusSnapshot,
        telemetry: SoftwareStatusTelemetry = OSLogSoftwareStatusTelemetry()
    ) -> (SoftwareStatusModel, InMemorySoftwareStatusSource) {
        let source = InMemorySoftwareStatusSource(initial: snapshot)
        let model = SoftwareStatusModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(SoftwareStatusSnapshot(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(SoftwareStatusSnapshot(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(SoftwareStatusSnapshot(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(dataSnapshot(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
        XCTAssertTrue(loading.projection.hasData)

        let (failed, _) = makeModel(dataSnapshot(status: .failed("net")))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySoftwareStatusTelemetry()
        let (model, source) = makeModel(SoftwareStatusSnapshot(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SoftwareUpdateStatusWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SoftwareStatusSnapshot(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(SoftwareStatusSnapshot(status: .loading))
        model.start()
        source.push(dataSnapshot(status: .loaded, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.stage, .downloading)
    }
}

// MARK: - Registry parity

@MainActor final class SoftwareStatusRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SoftwareUpdateStatusWidget.registration
        XCTAssertEqual(registration.id, "software-update-status")
        XCTAssertEqual(registration.category, "vehicle")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = SoftwareUpdateStatusWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 2, rows: 8)), DashboardWidgetSize(cols: 2, rows: 8))
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(SoftwareUpdateStatusWidget.surfaceSlug, "SoftwareUpdateStatusWidget")
    }
}

// MARK: - Layout decisions (web isCompact / isTall)

@MainActor final class SoftwareStatusLayoutTests: XCTestCase {
    private func widget(_ size: DashboardWidgetSize) -> SoftwareUpdateStatusWidget {
        let source = InMemorySoftwareStatusSource(
            initial: SoftwareStatusSnapshot(status: .loaded, input: SoftwareStatusInput(softwareVersion: "1"))
        )
        return SoftwareUpdateStatusWidget(model: SoftwareStatusModel(source: source), size: size)
    }

    func testIsCompactOnlyForSingleCellTile() {
        XCTAssertTrue(widget(DashboardWidgetSize(cols: 1, rows: 1)).isCompact)
        XCTAssertFalse(widget(DashboardWidgetSize(cols: 1, rows: 2)).isCompact) // canonical min
        XCTAssertFalse(widget(DashboardWidgetSize(cols: 2, rows: 1)).isCompact)
        XCTAssertFalse(widget(DashboardWidgetSize(cols: 2, rows: 2)).isCompact)
    }

    func testIsTallForTwoOrMoreRows() {
        XCTAssertFalse(widget(DashboardWidgetSize(cols: 1, rows: 1)).isTall)
        XCTAssertTrue(widget(DashboardWidgetSize(cols: 1, rows: 2)).isTall)
        XCTAssertTrue(widget(DashboardWidgetSize(cols: 2, rows: 6)).isTall)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySoftwareStatusTelemetry: SoftwareStatusTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
