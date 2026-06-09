//
//  DoorWindowStatusWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0037 · DoorWindowStatusWidget (Apple)
//
//  State-holder + registry + accessibility coverage for the surface:
//    • `DoorWindowModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `door-window-status` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for cells / sections /
//      compact badges.
//
//  The adapter (parsing → projection) is covered by
//  DoorWindowStatusWidget.AdapterTests.swift. These run in the TeslaSync(/-macOS)
//  XCTest targets and are driven by `InMemoryDoorWindowSource` — no network.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class DoorWindowModelTests: XCTestCase {
    private func makeModel(
        _ update: DoorWindowUpdate,
        telemetry: DoorWindowTelemetry = OSLogDoorWindowTelemetry()
    ) -> (DoorWindowModel, InMemoryDoorWindowSource) {
        let source = InMemoryDoorWindowSource(initial: update)
        let model = DoorWindowModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(DoorWindowUpdate(status: .loading, latest: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertEqual(model.projection, .empty)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(DoorWindowUpdate(status: .loaded, latest: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(DoorWindowUpdate(status: .failed("boom"), latest: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let latest = DoorWindowLatestInput(doorState: .text("AllClosed"))
        let (loading, _) = makeModel(DoorWindowUpdate(status: .loading, latest: latest))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
        XCTAssertEqual(loading.projection.doorCells.count, 4)
        XCTAssertEqual(loading.projection.windowCells.count, 4)

        let (failed, _) = makeModel(DoorWindowUpdate(status: .failed("net"), latest: latest))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyDoorWindowTelemetry()
        let (model, source) = makeModel(DoorWindowUpdate(status: .loading, latest: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DoorWindowStatusWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(DoorWindowUpdate(status: .loaded, latest: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(DoorWindowUpdate(status: .loading, latest: nil))
        model.start()
        source.push(
            DoorWindowUpdate(
                status: .loaded,
                connection: .offline,
                latest: DoorWindowLatestInput(
                    doorState: .text("DriverFrontOpen,PassengerRearOpen"),
                    frontDriverWindow: .text("vented"),
                    rearDriverWindow: .boolean(true)
                ),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.openDoorCount, 2)
        XCTAssertEqual(model.projection.openWindowCount, 2)
        let doors = Dictionary(uniqueKeysWithValues: model.projection.doorCells.map { ($0.id, $0) })
        XCTAssertEqual(doors["door-fl"]?.status, .warning)
        XCTAssertEqual(doors["door-fr"]?.status, .ok)
    }
}

// MARK: - Registry parity

@MainActor final class DoorWindowRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = DoorWindowStatusWidget.registration
        XCTAssertEqual(registration.id, "door-window-status")
        XCTAssertEqual(registration.category, "security")
        XCTAssertEqual(registration.nameKey, "widget.doorWindow.title")
        XCTAssertEqual(registration.descriptionKey, "widget.doorWindow.description")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = DoorWindowStatusWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 10)),
            DashboardWidgetSize(cols: 3, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class DoorWindowAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testCellSummaryCombinesLabelAndAccessibilityValue() {
        let cell = DoorWindowStatusCell(
            id: "door-fl", label: "Front Left", value: "—",
            accessibilityValue: "Unknown", status: .unknown
        )
        XCTAssertEqual(DoorWindowAccessibility.cellSummary(for: cell), "Front Left, Unknown")
    }

    func testSectionSummaryJoinsEveryCell() {
        let projection = DoorWindowCellsBuilder.build(
            latest: DoorWindowLatestInput(doorState: .text("DriverFrontOpen")),
            localize: echo
        )
        let summary = DoorWindowAccessibility.sectionSummary(
            titleKey: "widget.doorWindow.doors",
            titleFallback: "Doors",
            cells: projection.doorCells,
            localize: echo
        )
        XCTAssertTrue(summary.hasPrefix("Doors."))
        XCTAssertTrue(summary.contains("Front Left: Open"))
        XCTAssertTrue(summary.contains("Front Right: Closed"))
    }

    func testCompactSummaryContainsBothBadgePhrases() {
        let summary = DoorWindowAccessibility.compactSummary(
            openDoorCount: 0,
            openWindowCount: 1,
            localize: echo
        )
        XCTAssertEqual(summary, "Doors ✓. 1 window(s) open")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDoorWindowTelemetry: DoorWindowTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
