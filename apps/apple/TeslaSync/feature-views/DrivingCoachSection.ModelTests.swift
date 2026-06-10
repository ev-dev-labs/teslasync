//
//  DrivingCoachSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0167 · DrivingCoachSection (Apple)
//
//  State-holder + accessibility coverage for the DrivingCoachSection surface — split out of
//  DrivingCoachSection.Tests.swift to keep each test file within the 400-line budget. Exercises the
//  `DrivingCoachSectionModel` wiring, the P1/S11 `view.opened` telemetry, the stale auto-refresh transition,
//  and the VoiceOver gauge + section summaries. Shares the `coachSampleData` / `coachEnUS` / `coachUTC`
//  fixtures defined in DrivingCoachSection.Tests.swift (same XCTest module). Driven by
//  `InMemoryDrivingCoachSectionSource`; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: wiring, telemetry, freshness

@MainActor final class DrivingCoachSectionModelTests: XCTestCase {
    private func makeModel(
        _ update: DrivingCoachSectionUpdate,
        telemetry: DrivingCoachSectionTelemetry = OSLogDrivingCoachSectionTelemetry()
    ) -> (DrivingCoachSectionModel, InMemoryDrivingCoachSectionSource) {
        let source = InMemoryDrivingCoachSectionSource(initial: update)
        let model = DrivingCoachSectionModel(
            source: source,
            telemetry: telemetry,
            copy: .fallback,
            locale: Locale(identifier: coachEnUS),
            timeZone: coachUTC
        )
        return (model, source)
    }

    private var dataUpdate: DrivingCoachSectionUpdate {
        DrivingCoachSectionUpdate(status: .loaded, data: coachSampleData())
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = DrivingCoachSectionSpyDrivingCoachTelemetry()
        let (model, source) = makeModel(dataUpdate, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.perDriveRows.count, 2)
        XCTAssertEqual(spy.surfaces, [DrivingCoachSectionSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(DrivingCoachSectionUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testEmptyWhenLoadedWithoutContent() {
        let (model, _) = makeModel(DrivingCoachSectionUpdate(status: .loaded, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(DrivingCoachSectionUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataUpdate)
        XCTAssertEqual(model.phase, .content)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(DrivingCoachSectionUpdate(status: .loaded, data: coachSampleData(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(DrivingCoachSectionUpdate(status: .loaded, data: coachSampleData(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        source.push(DrivingCoachSectionUpdate(status: .loaded, data: coachSampleData(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(DrivingCoachSection.surfaceSlug, "DrivingCoachSection")
        XCTAssertEqual(DrivingCoachSectionSurface.slug, "DrivingCoachSection")
    }
}

// MARK: - Accessibility summary content

@MainActor final class DrivingCoachSectionDrivingCoachAccessibilityTests: XCTestCase {
    private func localize(_ key: String, _ fallback: String) -> String {
        // Deterministic identity localizer (the projector/view inject the real P1/S10 facade at runtime).
        switch key {
        case "dynamics.coach.overallScore": "Driving Score"
        case "dynamics.coach.title": "Driving Coach"
        case "dynamics.coach.drivesAnalyzed": "%lld drives analyzed"
        default: fallback
        }
    }

    func testGaugeLabelJoinsScore() {
        let gauge = DrivingCoachGauge(score: 82, scoreText: "82", fraction: 0.82, band: .good)
        XCTAssertEqual(
            DrivingCoachSectionAccessibility.gaugeLabel(for: gauge, localize: localize),
            "Driving Score, 82"
        )
    }

    func testSectionSummaryIncludesTitleScoreAndDrives() {
        let projection = DrivingCoachProjector.project(
            data: coachSampleData(), copy: .fallback, localeIdentifier: coachEnUS, timeZone: coachUTC
        )
        let summary = DrivingCoachSectionAccessibility.sectionSummary(for: projection, localize: localize)
        XCTAssertTrue(summary.contains("Driving Coach"))
        XCTAssertTrue(summary.contains("Driving Score, 82"))
        XCTAssertTrue(summary.contains("48 drives analyzed"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class DrivingCoachSectionSpyDrivingCoachTelemetry: DrivingCoachSectionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
