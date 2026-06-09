//
//  HealthOverview.Tests.swift
//  TeslaSync — P4 feature view · 0155 · HealthOverview (Apple)
//
//  Logic coverage for the Drivetrain Health overview surface (the per-state view-render smoke
//  tests live in HealthOverview.ViewTests.swift):
//    • Adapter (cached → projection) — `HealthOverviewFormat.number` parity with the web
//      `fmtNumber`, and the `HealthOverviewProjector` (the optional status banner, the headline,
//      the "Motor State: …" line, the uppercased status badge, and the formatted score percent,
//      across the good / warning / critical branches).
//    • State holder — `HealthOverviewModel` phase resolution, projection recompute, refresh
//      delegation, the stale one-shot auto-refresh, and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver banner + card + surface summaries.
//
//  The pure-logic tests run with no network and no real store (the model is driven by
//  `InMemoryHealthOverviewSource`).
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: formatting (web parity)

@MainActor final class HealthOverviewFormatTests: XCTestCase {
    func testNumberGroupsAndFixesFractionDigits() {
        XCTAssertEqual(HealthOverviewFormat.number(1234, decimals: 0), "1,234")
        XCTAssertEqual(HealthOverviewFormat.number(95, decimals: 0), "95")
        XCTAssertEqual(HealthOverviewFormat.number(0, decimals: 0), "0")
    }

    func testNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(HealthOverviewFormat.number(94.5, decimals: 0), "95")
        XCTAssertEqual(HealthOverviewFormat.number(59.4, decimals: 0), "59")
    }

    func testSafeNumberCollapsesNonFinite() {
        XCTAssertEqual(HealthOverviewFormat.safeNumber(.nan), 0)
        XCTAssertEqual(HealthOverviewFormat.safeNumber(.infinity), 0)
        XCTAssertEqual(HealthOverviewFormat.safeNumber(42), 42)
        XCTAssertEqual(HealthOverviewFormat.number(.nan, decimals: 0), "0")
    }
}

// MARK: - Adapter: projector (web parity)

@MainActor final class HealthOverviewProjectorTests: XCTestCase {
    private func sample(
        health: HealthOverviewHealthStatus = .good,
        score: Double = 95,
        motorStatus: String = "Optimal"
    ) -> HealthOverviewInput {
        HealthOverviewInput(overallHealth: health, healthScore: score, motorStatus: motorStatus)
    }

    func testGoodHasNoBannerAndHealthyHeadline() {
        let projection = HealthOverviewProjector.project(data: sample())
        XCTAssertNil(projection.alert)
        XCTAssertFalse(projection.hasAlert)
        XCTAssertEqual(projection.status, .good)
        XCTAssertEqual(projection.headline.text, "Drivetrain Healthy")
        XCTAssertEqual(projection.badge.label.text, "GOOD")
        XCTAssertEqual(projection.scoreText, "95")
        XCTAssertEqual(projection.scoreReadout, "95%")
        XCTAssertEqual(projection.motorStateLine, "Motor State: Optimal")
    }

    func testWarningBannerTitleMessageAndHeadline() {
        let projection = HealthOverviewProjector.project(data: sample(
            health: .warning,
            score: 60,
            motorStatus: "Degraded"
        ))
        XCTAssertEqual(projection.alert?.status, .warning)
        XCTAssertEqual(projection.alert?.title.text, "Elevated Temperatures Detected")
        XCTAssertEqual(
            projection.alert?.message.text,
            "Drivetrain temperatures are above normal operating range. Monitor closely and consider reducing load."
        )
        XCTAssertEqual(projection.headline.text, "Drivetrain Running Warm")
        XCTAssertEqual(projection.badge.label.text, "WARNING")
        XCTAssertEqual(projection.scoreReadout, "60%")
        XCTAssertEqual(projection.motorStateLine, "Motor State: Degraded")
    }

    func testCriticalBannerTitleMessageAndHeadline() {
        let projection = HealthOverviewProjector.project(data: sample(
            health: .critical,
            score: 25,
            motorStatus: "Throttled"
        ))
        XCTAssertEqual(projection.alert?.status, .critical)
        XCTAssertEqual(projection.alert?.title.text, "Critical Temperature Warning")
        XCTAssertEqual(
            projection.alert?.message.text,
            "One or more drivetrain components are operating at critically high temperatures. "
                + "Immediate attention is recommended."
        )
        XCTAssertEqual(projection.headline.text, "Drivetrain Overheating")
        XCTAssertEqual(projection.badge.label.text, "CRITICAL")
        XCTAssertEqual(projection.scoreReadout, "25%")
    }

    func testScoreUsesZeroDecimalsAndRounds() {
        XCTAssertEqual(HealthOverviewProjector.project(data: sample(score: 87.5)).scoreReadout, "88%")
        XCTAssertEqual(HealthOverviewProjector.project(data: sample(score: 0)).scoreReadout, "0%")
        XCTAssertEqual(HealthOverviewProjector.project(data: sample(score: 100)).scoreReadout, "100%")
    }

    func testStatusFromRawDefaultsToGood() {
        XCTAssertEqual(HealthOverviewHealthStatus.from(raw: "warning"), .warning)
        XCTAssertEqual(HealthOverviewHealthStatus.from(raw: "critical"), .critical)
        XCTAssertEqual(HealthOverviewHealthStatus.from(raw: "nonsense"), .good)
    }

    func testIconSelectionTracksHealth() {
        XCTAssertEqual(HealthOverviewHealthStatus.good.iconSystemName, "checkmark.circle.fill")
        XCTAssertEqual(HealthOverviewHealthStatus.warning.iconSystemName, "exclamationmark.triangle.fill")
        XCTAssertEqual(HealthOverviewHealthStatus.critical.iconSystemName, "exclamationmark.triangle.fill")
        XCTAssertTrue(HealthOverviewHealthStatus.good.isHealthy)
        XCTAssertFalse(HealthOverviewHealthStatus.warning.isHealthy)
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor final class HealthOverviewModelTests: XCTestCase {
    private func makeModel(
        _ update: HealthOverviewUpdate,
        telemetry: HealthOverviewTelemetry = OSLogHealthOverviewTelemetry()
    ) -> (HealthOverviewModel, InMemoryHealthOverviewSource) {
        let source = InMemoryHealthOverviewSource(initial: update)
        let model = HealthOverviewModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sample() -> HealthOverviewInput {
        HealthOverviewInput(overallHealth: .good, healthScore: 95, motorStatus: "Optimal")
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(HealthOverviewModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(HealthOverviewModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(HealthOverviewModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(HealthOverviewModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(HealthOverviewModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(HealthOverviewModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(HealthOverviewModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testInitialContentProjectsSummary() {
        let (model, _) = makeModel(HealthOverviewUpdate(status: .loaded, data: sample()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.headline.text, "Drivetrain Healthy")
        XCTAssertEqual(model.projection?.scoreReadout, "95%")
        XCTAssertNil(model.projection?.alert)
    }

    func testEmptyLoadingErrorPhases() {
        let (empty, _) = makeModel(HealthOverviewUpdate(status: .empty, data: nil))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (loading, _) = makeModel(HealthOverviewUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(HealthOverviewUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedSummaryStaysContentWhileFailing() {
        let (model, source) = makeModel(HealthOverviewUpdate(status: .loaded, data: sample()))
        model.start()
        source.push(HealthOverviewUpdate(status: .failed("net"), connection: .offline, data: sample()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
    }

    func testFreshnessTracksUpdates() {
        let (model, source) = makeModel(HealthOverviewUpdate(status: .loading))
        model.start()
        source.push(
            HealthOverviewUpdate(
                status: .loaded,
                connection: .offline,
                isFetching: true,
                data: sample(),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.isFetching)
        XCTAssertNotNil(model.updatedAt)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(HealthOverviewUpdate(status: .loaded, data: sample()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLiveAgain() {
        let (model, source) = makeModel(HealthOverviewUpdate(status: .loaded, data: sample()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(HealthOverviewUpdate(status: .loaded, connection: .stale, data: sample()))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(HealthOverviewUpdate(status: .loaded, connection: .stale, data: sample()))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(HealthOverviewUpdate(status: .loaded, connection: .live, data: sample()))
        source.push(HealthOverviewUpdate(status: .loaded, connection: .stale, data: sample()))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(HealthOverviewUpdate(status: .loaded, data: sample()))
        model.start()
        source.push(HealthOverviewUpdate(status: .loaded, connection: .offline, data: sample()))
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyHealthOverviewTelemetry()
        let (model, source) = makeModel(HealthOverviewUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [HealthOverviewSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Accessibility summary

@MainActor final class HealthOverviewAccessibilityTests: XCTestCase {
    private func projection(
        _ health: HealthOverviewHealthStatus,
        score: Double,
        motor: String
    ) -> HealthOverviewProjection {
        HealthOverviewProjector.project(
            data: HealthOverviewInput(overallHealth: health, healthScore: score, motorStatus: motor)
        )
    }

    func testGoodSummaryOmitsBanner() {
        let summary = HealthOverviewAccessibility.summary(for: projection(.good, score: 95, motor: "Optimal"))
        XCTAssertEqual(summary, "Drivetrain Healthy. Motor State: Optimal. GOOD 95%")
    }

    func testCriticalSummaryIncludesBanner() {
        let summary = HealthOverviewAccessibility.summary(for: projection(.critical, score: 25, motor: "Throttled"))
        XCTAssertTrue(summary.hasPrefix("Critical Temperature Warning."))
        XCTAssertTrue(summary.contains("Drivetrain Overheating"))
        XCTAssertTrue(summary.contains("Motor State: Throttled"))
        XCTAssertTrue(summary.contains("CRITICAL 25%"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
final class SpyHealthOverviewTelemetry: HealthOverviewTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
