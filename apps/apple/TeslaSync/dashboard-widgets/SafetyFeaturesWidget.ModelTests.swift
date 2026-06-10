//
//  SafetyFeaturesWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0083 · SafetyFeaturesWidget (Apple)
//
//  State-holder + registry + accessibility coverage for the SafetyFeaturesWidget
//  surface (split out of SafetyFeaturesWidget.Tests.swift to keep each test file
//  focused):
//    • `SafetyModel` phase resolution across loading / empty / error / content,
//      plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Canonical `safety-features` registry metadata + size clamping.
//    • The VoiceOver summary content for the cells, grid, and active-feature hero.
//
//  These run in the TeslaSync(/-macOS) XCTest targets, driven by
//  `InMemorySafetySource` — no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class SafetyFeaturesWidgetSafetyModelTests: XCTestCase {
    private func makeModel(
        _ update: SafetyUpdate,
        telemetry: SafetyTelemetry = OSLogSafetyTelemetry()
    ) -> (SafetyModel, InMemorySafetySource) {
        let source = InMemorySafetySource(initial: update)
        let model = SafetyModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(SafetyUpdate(status: .loading, latest: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.cells.isEmpty)
        XCTAssertEqual(model.activeCount, 0)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(SafetyUpdate(status: .loaded, latest: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(SafetyUpdate(status: .failed("boom"), latest: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let latest = SafetyLatestInput(emergencyLaneDepartureAvoidance: true)
        let (loading, _) = makeModel(SafetyUpdate(status: .loading, latest: latest))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
        XCTAssertEqual(loading.cells.count, 8)

        let (failed, _) = makeModel(SafetyUpdate(status: .failed("net"), latest: latest))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SafetyFeaturesWidgetSpySafetyTelemetry()
        let (model, source) = makeModel(SafetyUpdate(status: .loading, latest: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SafetyFeaturesWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SafetyUpdate(status: .loaded, latest: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionCellsAndActiveCountTrackUpdates() {
        let (model, source) = makeModel(SafetyUpdate(status: .loading, latest: nil))
        model.start()
        source.push(
            SafetyUpdate(
                status: .loaded,
                connection: .offline,
                latest: SafetyLatestInput(
                    forwardCollisionWarning: .text("ForwardCollisionSensitivityMedium"),
                    automaticEmergencyBrakingOff: true,
                    emergencyLaneDepartureAvoidance: true
                ),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.cells.count, 8)
        XCTAssertEqual(model.cells.first(where: { $0.id == "fcw" })?.status, .ok)
        XCTAssertEqual(model.cells.first(where: { $0.id == "aeb" })?.status, .inactive)
        // fcw (ok) + elda (ok) = 2 active.
        XCTAssertEqual(model.activeCount, 2)
    }
}

// MARK: - Registry parity

@MainActor final class SafetyFeaturesWidgetSafetyRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SafetyFeaturesWidget.registration
        XCTAssertEqual(registration.id, "safety-features")
        XCTAssertEqual(registration.category, "security")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = SafetyFeaturesWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
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

@MainActor final class SafetyFeaturesWidgetSafetyAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testCellSummaryCombinesLabelValueAndStatusWord() {
        let cell = SafetyStatusCell(id: "fcw", label: "Forward Collision Warning", value: "On", status: .ok)
        XCTAssertEqual(
            SafetyAccessibility.cellSummary(for: cell, localize: echo),
            "Forward Collision Warning, On, Active"
        )
    }

    func testGridSummaryJoinsEveryCell() {
        let cells = SafetyCellsBuilder.build(
            latest: SafetyLatestInput(
                forwardCollisionWarning: .text("ForwardCollisionSensitivityMedium"),
                automaticEmergencyBrakingOff: false
            ),
            localize: echo
        )
        let summary = SafetyAccessibility.gridSummary(for: cells, localize: echo)
        XCTAssertTrue(summary.hasPrefix("Safety Features."))
        XCTAssertTrue(summary.contains("Forward Collision Warning: Medium"))
        XCTAssertTrue(summary.contains("Auto Emergency Braking: Enabled"))
    }

    func testGridSummaryFallsBackToEmptyMessage() {
        let summary = SafetyAccessibility.gridSummary(for: [], localize: echo)
        XCTAssertEqual(summary, "Safety Features. No safety data")
    }

    func testActiveCountSummary() {
        XCTAssertEqual(SafetyAccessibility.activeCountSummary(3, localize: echo), "3 Active Features")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SafetyFeaturesWidgetSpySafetyTelemetry: SafetyTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
