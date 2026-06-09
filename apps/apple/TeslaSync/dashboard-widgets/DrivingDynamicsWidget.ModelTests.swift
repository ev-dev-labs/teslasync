//
//  DrivingDynamicsWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0044 · DrivingDynamicsWidget (Apple)
//
//  State-holder + registry + accessibility coverage for the DrivingDynamicsWidget
//  surface (split from DrivingDynamicsWidget.Tests.swift to keep each file under
//  the house file-length limit):
//    • State holder — `DrivingDynamicsModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + wiring.
//    • Registry — canonical `driving-dynamics` metadata + size clamping.
//    • Accessibility — the VoiceOver summary + per-gauge + per-bar value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryDrivingDynamicsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class DrivingDynamicsModelTests: XCTestCase {
    private let dynamics = DrivingDynamicsDTO(
        maxAccelerationG: 0.46,
        maxBrakingG: 0.52,
        maxCorneringG: 0.41,
        avgAccelerationG: 0.22,
        avgBrakingG: 0.27
    )

    private func makeModel(
        _ update: DrivingDynamicsUpdate,
        telemetry: DrivingDynamicsTelemetry = OSLogDrivingDynamicsTelemetry()
    ) -> (DrivingDynamicsModel, InMemoryDrivingDynamicsSource) {
        let source = InMemoryDrivingDynamicsSource(initial: update)
        let model = DrivingDynamicsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDynamicsShowsLoading() {
        let (model, _) = makeModel(DrivingDynamicsUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadingWithCachedDynamicsShowsContent() {
        let (model, _) = makeModel(DrivingDynamicsUpdate(status: .loading, dynamics: dynamics))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedWithDynamicsShowsContent() {
        let (model, _) = makeModel(DrivingDynamicsUpdate(status: .loaded, dynamics: dynamics))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasDynamics)
    }

    func testLoadedWithoutDynamicsShowsEmpty() {
        let (model, _) = makeModel(DrivingDynamicsUpdate(status: .loaded, dynamics: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(DrivingDynamicsUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCachedDynamicsStayVisibleWhileFailingOrLoading() {
        let (failed, _) = makeModel(
            DrivingDynamicsUpdate(status: .failed("net"), connection: .offline, dynamics: dynamics)
        )
        failed.start()
        XCTAssertEqual(failed.phase, .content)
        XCTAssertEqual(failed.connection, .offline)

        let (loading, _) = makeModel(DrivingDynamicsUpdate(status: .loading, dynamics: dynamics))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyDrivingDynamicsTelemetry()
        let (model, source) = makeModel(DrivingDynamicsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DrivingDynamicsWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(DrivingDynamicsUpdate(status: .loaded, dynamics: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(DrivingDynamicsUpdate(status: .loading))
        model.start()
        source.push(
            DrivingDynamicsUpdate(
                status: .loaded,
                connection: .stale,
                dynamics: dynamics,
                distribution: DrivingDynamicsAccelerationDistribution(values: [1, 2, 3]),
                updatedAt: Date(timeIntervalSince1970: 1000)
            )
        )
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.maxG, 0.52, accuracy: 0.0001)
        XCTAssertEqual(model.projection.bars.count, 3)
        XCTAssertEqual(model.updatedAt, Date(timeIntervalSince1970: 1000))
    }

    func testCompactAndWideThresholds() {
        XCTAssertTrue(DrivingDynamicsModel.isCompact(DashboardWidgetSize(cols: 1, rows: 1)))
        XCTAssertTrue(DrivingDynamicsModel.isCompact(DashboardWidgetSize(cols: 1, rows: 4)))
        XCTAssertFalse(DrivingDynamicsModel.isCompact(DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertFalse(DrivingDynamicsModel.isWide(DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertTrue(DrivingDynamicsModel.isWide(DashboardWidgetSize(cols: 3, rows: 4)))
        XCTAssertTrue(DrivingDynamicsModel.isWide(DashboardWidgetSize(cols: 4, rows: 4)))
    }
}

// MARK: - Registry parity

@MainActor final class DrivingDynamicsRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = DrivingDynamicsWidget.registration
        XCTAssertEqual(registration.id, "driving-dynamics")
        XCTAssertEqual(registration.category, "driving")
        XCTAssertEqual(registration.nameKey, "widget.drivingDynamics.title")
        XCTAssertEqual(registration.descriptionKey, "widget.drivingDynamics.description")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = DrivingDynamicsWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
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

// MARK: - Accessibility content

final class DrivingDynamicsAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryDatum() {
        let projection = DrivingDynamicsBuilder.buildProjection(
            dynamics: DrivingDynamicsDTO(
                maxAccelerationG: 0.46,
                maxBrakingG: 0.52,
                maxCorneringG: 0.41,
                avgAccelerationG: 0.22,
                avgBrakingG: 0.27
            )
        )
        let summary = DrivingDynamicsAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Driving Dynamics"))
        XCTAssertTrue(summary.contains("Max g"))
        XCTAssertTrue(summary.contains("0.52"))
        XCTAssertTrue(summary.contains("Aggressive")) // not smooth (0.52)
        XCTAssertTrue(summary.contains("Accel"))
        XCTAssertTrue(summary.contains("Brake"))
        XCTAssertTrue(summary.contains("Lateral"))
        XCTAssertTrue(summary.contains("Normal")) // (0.22 + 0.27)/2 = 0.245 → normal
    }

    func testSummaryEmptyWhenNoDynamics() {
        let summary = DrivingDynamicsAccessibility.summary(for: .empty)
        XCTAssertEqual(summary, "No dynamics data")
    }

    func testGaugeLabelIncludesRoleValueAndUnit() {
        let gauge = DrivingDynamicsGauge(
            role: .accel,
            value: 0.18,
            max: 1.2,
            fraction: 0.15,
            valueText: "0.18",
            tone: .success
        )
        let label = DrivingDynamicsAccessibility.gaugeLabel(gauge)
        XCTAssertTrue(label.contains("Accel"))
        XCTAssertTrue(label.contains("0.18"))
        XCTAssertTrue(label.contains("g"))
    }

    func testBarLabelIncludesRangeAndCount() {
        let bar = DrivingGForceBar(plotKey: "0001", rangeLabel: "0.40", count: 18)
        let label = DrivingDynamicsAccessibility.barLabel(bar)
        XCTAssertTrue(label.contains("0.40"))
        XCTAssertTrue(label.contains("18"))
        XCTAssertTrue(label.contains("g"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDrivingDynamicsTelemetry: DrivingDynamicsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
