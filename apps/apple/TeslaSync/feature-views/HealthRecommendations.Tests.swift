//
//  HealthRecommendations.Tests.swift
//  TeslaSync — P4 feature view · 0156 · HealthRecommendations (Apple)
//
//  Logic coverage for the Drivetrain Health recommendations surface (the per-state view-render smoke
//  tests live in HealthRecommendations.ViewTests.swift):
//    • Adapter (cached → projection) — the `HealthRecommendationsProjector` branch-by-branch (the
//      good / warning / critical tip sets, their exact order, priorities, keys, and web-fallback
//      text), and the priority → glyph mapping.
//    • State holder — `HealthRecommendationsModel` phase resolution, projection recompute, refresh
//      delegation, the stale one-shot auto-refresh, and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver row + panel summaries.
//
//  The pure-logic tests run with no network and no real store (the model is driven by
//  `InMemoryHealthRecommendationsSource`).
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projector (web parity)

final class HealthRecommendationsProjectorTests: XCTestCase {
    private func keys(for health: HealthRecommendationsHealthStatus) -> [String] {
        HealthRecommendationsProjector.recommendations(for: health).map(\.key)
    }

    private func priorities(for health: HealthRecommendationsHealthStatus) -> [HealthRecommendationPriority] {
        HealthRecommendationsProjector.recommendations(for: health).map(\.priority)
    }

    /// `good` → only the four baseline low-priority maintenance tips, in order.
    func testGoodHasOnlyLowPriorityTips() {
        XCTAssertEqual(keys(for: .good), ["regular-service", "gentle-accel", "precondition", "monitor-temps"])
        XCTAssertEqual(priorities(for: .good), [.low, .low, .low, .low])
    }

    /// `warning` → the three medium-priority tips ahead of the four low-priority tips.
    func testWarningAddsMediumTipsBeforeLow() {
        XCTAssertEqual(keys(for: .warning), [
            "reduce-load", "check-coolant", "avoid-supercharging",
            "regular-service", "gentle-accel", "precondition", "monitor-temps"
        ])
        XCTAssertEqual(priorities(for: .warning), [.medium, .medium, .medium, .low, .low, .low, .low])
    }

    /// `critical` → the two high-priority tips, then the three medium, then the four low — the full
    /// nine-tip list in the exact web push order.
    func testCriticalAddsHighThenMediumThenLow() {
        XCTAssertEqual(keys(for: .critical), [
            "critical-stop", "service-urgent",
            "reduce-load", "check-coolant", "avoid-supercharging",
            "regular-service", "gentle-accel", "precondition", "monitor-temps"
        ])
        XCTAssertEqual(priorities(for: .critical), [
            .high, .high, .medium, .medium, .medium, .low, .low, .low, .low
        ])
    }

    /// Every status ends with the same four baseline low-priority tips in the same order (web: the
    /// unconditional final `push`es).
    func testBaselineLowTipsAlwaysPresentInOrder() {
        let baseline = ["regular-service", "gentle-accel", "precondition", "monitor-temps"]
        for health in HealthRecommendationsHealthStatus.allCases {
            XCTAssertEqual(Array(keys(for: health).suffix(4)), baseline, "status \(health)")
        }
    }

    /// The projection passes the status through and is never empty (web list always has ≥ 4 tips).
    func testProjectionStatusPassthroughAndNonEmpty() {
        for health in HealthRecommendationsHealthStatus.allCases {
            let projection = HealthRecommendationsProjector.project(
                data: HealthRecommendationsInput(overallHealth: health)
            )
            XCTAssertEqual(projection.status, health)
            XCTAssertFalse(projection.isEmpty)
            XCTAssertEqual(projection.recommendations.count, health == .good ? 4 : (health == .warning ? 7 : 9))
        }
    }

    /// The tip text + panel title resolve to the exact web English fallbacks.
    func testTextResolvesWebFallbacks() {
        let critical = HealthRecommendationsProjector.recommendations(for: .critical)
        XCTAssertEqual(
            critical.first { $0.key == "critical-stop" }?.text,
            "Temperatures are critically high. Consider pulling over safely and letting the vehicle cool down."
        )
        XCTAssertEqual(
            critical.first { $0.key == "avoid-supercharging" }?.text,
            "Avoid Supercharging while temperatures are elevated. Use Level 2 charging instead."
        )
        XCTAssertEqual(
            critical.first { $0.key == "monitor-temps" }?.text,
            "Monitor drivetrain temperatures after spirited driving sessions or long highway stretches."
        )
        let projection = HealthRecommendationsProjector.project(data: HealthRecommendationsInput(overallHealth: .good))
        XCTAssertEqual(projection.title.text, "Health Recommendations")
    }

    /// `from(raw:)` mirrors the web union, defaulting unknown values to `.good`.
    func testStatusFromRawDefaultsToGood() {
        XCTAssertEqual(HealthRecommendationsHealthStatus.from(raw: "warning"), .warning)
        XCTAssertEqual(HealthRecommendationsHealthStatus.from(raw: "critical"), .critical)
        XCTAssertEqual(HealthRecommendationsHealthStatus.from(raw: "good"), .good)
        XCTAssertEqual(HealthRecommendationsHealthStatus.from(raw: "nonsense"), .good)
        XCTAssertFalse(HealthRecommendationsHealthStatus.warning.isHealthy)
        XCTAssertTrue(HealthRecommendationsHealthStatus.good.isHealthy)
    }

    /// The priority → glyph + tint mapping (web `AlertTriangle` for high/medium, `TrendingUp` for
    /// low; only low takes the neutral card).
    func testPriorityGlyphAndCardMapping() {
        XCTAssertEqual(HealthRecommendationPriority.high.iconSystemName, "exclamationmark.triangle.fill")
        XCTAssertEqual(HealthRecommendationPriority.medium.iconSystemName, "exclamationmark.triangle.fill")
        XCTAssertEqual(HealthRecommendationPriority.low.iconSystemName, "chart.line.uptrend.xyaxis")
        XCTAssertFalse(HealthRecommendationPriority.high.usesNeutralCard)
        XCTAssertFalse(HealthRecommendationPriority.medium.usesNeutralCard)
        XCTAssertTrue(HealthRecommendationPriority.low.usesNeutralCard)
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor final class HealthRecommendationsModelTests: XCTestCase {
    private func makeModel(
        _ update: HealthRecommendationsUpdate,
        telemetry: HealthRecommendationsTelemetry = OSLogHealthRecommendationsTelemetry()
    ) -> (HealthRecommendationsModel, InMemoryHealthRecommendationsSource) {
        let source = InMemoryHealthRecommendationsSource(initial: update)
        let model = HealthRecommendationsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sample(_ health: HealthRecommendationsHealthStatus = .warning) -> HealthRecommendationsInput {
        HealthRecommendationsInput(overallHealth: health)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(HealthRecommendationsModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(HealthRecommendationsModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(HealthRecommendationsModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(HealthRecommendationsModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(HealthRecommendationsModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(HealthRecommendationsModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(HealthRecommendationsModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testInitialContentProjectsRecommendations() {
        let (model, _) = makeModel(HealthRecommendationsUpdate(status: .loaded, data: sample(.critical)))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.status, .critical)
        XCTAssertEqual(model.projection?.recommendations.count, 9)
        XCTAssertEqual(model.projection?.recommendations.first?.priority, .high)
    }

    func testEmptyLoadingErrorPhases() {
        let (empty, _) = makeModel(HealthRecommendationsUpdate(status: .empty, data: nil))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (loading, _) = makeModel(HealthRecommendationsUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(HealthRecommendationsUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedListStaysContentWhileFailing() {
        let (model, source) = makeModel(HealthRecommendationsUpdate(status: .loaded, data: sample()))
        model.start()
        source.push(HealthRecommendationsUpdate(status: .failed("net"), connection: .offline, data: sample()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
    }

    func testFreshnessTracksUpdates() {
        let (model, source) = makeModel(HealthRecommendationsUpdate(status: .loading))
        model.start()
        source.push(
            HealthRecommendationsUpdate(
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
        let (model, source) = makeModel(HealthRecommendationsUpdate(status: .loaded, data: sample()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLiveAgain() {
        let (model, source) = makeModel(HealthRecommendationsUpdate(status: .loaded, data: sample()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(HealthRecommendationsUpdate(status: .loaded, connection: .stale, data: sample()))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(HealthRecommendationsUpdate(status: .loaded, connection: .stale, data: sample()))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(HealthRecommendationsUpdate(status: .loaded, connection: .live, data: sample()))
        source.push(HealthRecommendationsUpdate(status: .loaded, connection: .stale, data: sample()))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(HealthRecommendationsUpdate(status: .loaded, data: sample()))
        model.start()
        source.push(HealthRecommendationsUpdate(status: .loaded, connection: .offline, data: sample()))
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyHealthRecommendationsTelemetry()
        let (model, source) = makeModel(HealthRecommendationsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [HealthRecommendationsSurface.slug])
        XCTAssertEqual(spy.surfaces, ["HealthRecommendations"])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Accessibility summary

final class HealthRecommendationsAccessibilityTests: XCTestCase {
    func testPriorityLabels() {
        XCTAssertEqual(HealthRecommendationsAccessibility.priorityLabel(.high), "High priority")
        XCTAssertEqual(HealthRecommendationsAccessibility.priorityLabel(.medium), "Medium priority")
        XCTAssertEqual(HealthRecommendationsAccessibility.priorityLabel(.low), "Tip")
    }

    func testRowSummaryPrefixesPriority() {
        let recommendation = HealthRecommendationsProjector.recommendations(for: .critical)[0]
        let summary = HealthRecommendationsAccessibility.rowSummary(for: recommendation)
        XCTAssertEqual(
            summary,
            "High priority: Temperatures are critically high. Consider pulling over safely and "
                + "letting the vehicle cool down."
        )
    }

    func testSummaryIncludesTitleAndEveryRow() {
        let projection = HealthRecommendationsProjector.project(
            data: HealthRecommendationsInput(overallHealth: .critical)
        )
        let summary = HealthRecommendationsAccessibility.summary(for: projection)
        XCTAssertTrue(summary.hasPrefix("Health Recommendations."))
        XCTAssertTrue(summary.contains("High priority: Temperatures are critically high"))
        XCTAssertTrue(summary.contains("Medium priority: Reduce driving intensity"))
        XCTAssertTrue(summary.contains("Tip: Keep up with regular service intervals"))
        XCTAssertTrue(summary.contains("Tip: Monitor drivetrain temperatures"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
final class SpyHealthRecommendationsTelemetry: HealthRecommendationsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
