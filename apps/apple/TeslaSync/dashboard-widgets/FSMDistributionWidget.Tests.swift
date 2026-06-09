//
//  FSMDistributionWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0052 · FSMDistributionWidget (Apple)
//
//  Unit coverage for the FSMDistributionWidget surface:
//    • Adapter (cached → projection) — `FSMDistributionBuilder` parity with the
//      web component's stateColor / buildDonutData / transition memos.
//    • Formatting — `FSMDistributionFormat` parity with web `fmtDuration` /
//      `fmtNumber`.
//    • State holder — `FSMDistributionModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + wiring.
//    • Registry — canonical `fsm-distribution` metadata + size clamping.
//    • Accessibility — the donut + transition VoiceOver summaries + state labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryFSMDistributionSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: state classification (web `stateColor`)

@MainActor final class FSMClassifyTests: XCTestCase {
    func testKnownStateBuckets() {
        XCTAssertEqual(FSMDistributionBuilder.classify(state: "driving"), .driving)
        XCTAssertEqual(FSMDistributionBuilder.classify(state: "charging"), .charging)
        XCTAssertEqual(FSMDistributionBuilder.classify(state: "asleep"), .asleep)
        XCTAssertEqual(FSMDistributionBuilder.classify(state: "idle"), .idle)
        XCTAssertEqual(FSMDistributionBuilder.classify(state: "offline"), .offline)
    }

    func testClassificationIsCaseInsensitive() {
        XCTAssertEqual(FSMDistributionBuilder.classify(state: "DRIVING"), .driving)
        XCTAssertEqual(FSMDistributionBuilder.classify(state: "Charging"), .charging)
    }

    func testUnknownStateFallsBackToOther() {
        XCTAssertEqual(FSMDistributionBuilder.classify(state: "updating"), .other)
        XCTAssertEqual(FSMDistributionBuilder.classify(state: ""), .other)
    }
}

// MARK: - Adapter: duration + number formatting (web fmtDuration / fmtNumber)

@MainActor final class FSMFormatTests: XCTestCase {
    func testDurationMinutesOnly() {
        XCTAssertEqual(FSMDistributionFormat.duration(milliseconds: 45 * 60000, hourUnit: "h", minuteUnit: "m"), "45m")
    }

    func testDurationHoursAndMinutes() {
        let ms = (2 * 60 + 5) * 60000.0
        XCTAssertEqual(FSMDistributionFormat.duration(milliseconds: ms, hourUnit: "h", minuteUnit: "m"), "2h 5m")
    }

    func testDurationWholeHours() {
        XCTAssertEqual(
            FSMDistributionFormat.duration(milliseconds: 8 * 3_600_000, hourUnit: "h", minuteUnit: "m"),
            "8h 0m"
        )
    }

    func testDurationZeroAndNonFinite() {
        XCTAssertEqual(FSMDistributionFormat.duration(milliseconds: 0, hourUnit: "h", minuteUnit: "m"), "0m")
        XCTAssertEqual(FSMDistributionFormat.duration(milliseconds: .nan, hourUnit: "h", minuteUnit: "m"), "0m")
        XCTAssertEqual(FSMDistributionFormat.duration(milliseconds: .infinity, hourUnit: "h", minuteUnit: "m"), "0m")
    }

    func testNumberKeepsDigitsAndGroups() {
        XCTAssertEqual(FSMDistributionFormat.number(45.5, decimals: 1), "45.5")
        XCTAssertEqual(FSMDistributionFormat.number(1234.5, decimals: 1), "1,234.5")
        XCTAssertEqual(FSMDistributionFormat.number(66.666, decimals: 0), "67")
        XCTAssertEqual(FSMDistributionFormat.number(33.333, decimals: 0), "33")
    }

    func testNumberNonFiniteCollapsesToZero() {
        XCTAssertEqual(FSMDistributionFormat.number(.nan, decimals: 0), "0")
        XCTAssertEqual(FSMDistributionFormat.number(.infinity, decimals: 1), "0.0")
    }
}

// MARK: - Adapter: donut segments + transitions (web buildDonutData)

@MainActor final class FSMBuilderTests: XCTestCase {
    func testBuildSegmentsFiltersAndSortsLargestFirst() {
        let durations = [
            FSMStateDuration(state: "charging", milliseconds: 30 * 60000),
            FSMStateDuration(state: "driving", milliseconds: 60 * 60000),
            FSMStateDuration(state: "idle", milliseconds: 0)
        ]
        let segments = FSMDistributionBuilder.buildSegments(durations: durations)
        XCTAssertEqual(segments.count, 2) // zero-duration idle dropped
        XCTAssertEqual(segments.first?.state, "driving") // sorted largest-first
        XCTAssertEqual(segments.first?.kind, .driving)
        XCTAssertEqual(segments.last?.state, "charging")
        XCTAssertEqual(segments.first?.percent ?? 0, 66.666, accuracy: 0.01)
        XCTAssertEqual(segments.last?.percent ?? 0, 33.333, accuracy: 0.01)
    }

    func testBuildSegmentsDropsNegativeDurations() {
        let durations = [
            FSMStateDuration(state: "driving", milliseconds: -5),
            FSMStateDuration(state: "charging", milliseconds: 1000)
        ]
        let segments = FSMDistributionBuilder.buildSegments(durations: durations)
        XCTAssertEqual(segments.map(\.state), ["charging"])
        XCTAssertEqual(segments.first?.percent ?? 0, 100, accuracy: 0.0001)
    }

    func testBuildSegmentsZeroTotalIsEmpty() {
        let durations = [
            FSMStateDuration(state: "idle", milliseconds: 0),
            FSMStateDuration(state: "offline", milliseconds: 0)
        ]
        XCTAssertTrue(FSMDistributionBuilder.buildSegments(durations: durations).isEmpty)
    }

    func testEqualDurationsKeepStableServerOrder() {
        let durations = [
            FSMStateDuration(state: "alpha", milliseconds: 1000),
            FSMStateDuration(state: "beta", milliseconds: 1000)
        ]
        let segments = FSMDistributionBuilder.buildSegments(durations: durations)
        XCTAssertEqual(segments.map(\.state), ["alpha", "beta"])
    }

    func testBuildTransitionsCoalescesBlankStates() {
        let rows = [
            FSMStateTransitionDTO(id: 1, fromState: "driving", toState: "idle", timestamp: nil),
            FSMStateTransitionDTO(id: 2, fromState: "", toState: "  ", timestamp: nil)
        ]
        let items = FSMDistributionBuilder.buildTransitions(rows: rows)
        XCTAssertEqual(items.first?.fromState, "driving")
        XCTAssertEqual(items.last?.fromState, "—")
        XCTAssertEqual(items.last?.toState, "—")
    }

    func testBuildProjectionHasDataFlag() {
        let withData = FSMDistributionBuilder.buildProjection(
            durations: [FSMStateDuration(state: "driving", milliseconds: 1000)],
            rows: []
        )
        XCTAssertTrue(withData.hasData)
        XCTAssertEqual(withData.dominant?.state, "driving")

        let empty = FSMDistributionBuilder.buildProjection(durations: [], rows: [])
        XCTAssertFalse(empty.hasData)
        XCTAssertNil(empty.dominant)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class FSMModelTests: XCTestCase {
    private func durations(_ count: Int) -> [FSMStateDuration] {
        (0 ..< count).map { index in
            FSMStateDuration(state: "state\(index)", milliseconds: Double((index + 1) * 60000))
        }
    }

    private func makeModel(
        _ update: FSMDistributionUpdate,
        telemetry: FSMDistributionTelemetry = OSLogFSMDistributionTelemetry()
    ) -> (FSMDistributionModel, InMemoryFSMDistributionSource) {
        let source = InMemoryFSMDistributionSource(initial: update)
        let model = FSMDistributionModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(FSMDistributionUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithDataShowsContent() {
        let (model, _) = makeModel(FSMDistributionUpdate(status: .loaded, durations: durations(3)))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(FSMDistributionUpdate(status: .loaded, durations: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(FSMDistributionUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCachedDataStaysVisibleWhileFailingOrLoading() {
        let (failed, _) = makeModel(
            FSMDistributionUpdate(status: .failed("net"), connection: .offline, durations: durations(2))
        )
        failed.start()
        XCTAssertEqual(failed.phase, .content)
        XCTAssertEqual(failed.connection, .offline)

        let (loading, _) = makeModel(FSMDistributionUpdate(status: .loading, durations: durations(2)))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyFSMDistributionTelemetry()
        let (model, source) = makeModel(FSMDistributionUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [FSMDistributionWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(FSMDistributionUpdate(status: .loaded, durations: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(FSMDistributionUpdate(status: .loading))
        model.start()
        source.push(
            FSMDistributionUpdate(
                status: .loaded,
                connection: .stale,
                durations: [
                    FSMStateDuration(state: "driving", milliseconds: 60 * 60000),
                    FSMStateDuration(state: "charging", milliseconds: 30 * 60000)
                ],
                updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
            )
        )
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.segments.count, 2)
        XCTAssertEqual(model.projection.dominant?.state, "driving")
    }

    func testCompactThresholdMatchesWeb() {
        XCTAssertTrue(FSMDistributionModel.isCompact(DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertTrue(FSMDistributionModel.isCompact(DashboardWidgetSize(cols: 1, rows: 40)))
        XCTAssertFalse(FSMDistributionModel.isCompact(DashboardWidgetSize(cols: 2, rows: 1)))
        XCTAssertFalse(FSMDistributionModel.isCompact(DashboardWidgetSize(cols: 2, rows: 4)))
    }
}

// MARK: - Registry parity

@MainActor final class FSMRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = FSMDistributionWidget.registration
        XCTAssertEqual(registration.id, "fsm-distribution")
        XCTAssertEqual(registration.category, "analytics")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = FSMDistributionWidget.registration
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

@MainActor final class FSMAccessibilityTests: XCTestCase {
    func testSummaryIncludesStatesPercentAndDuration() {
        let projection = FSMDistributionBuilder.buildProjection(
            durations: [
                FSMStateDuration(state: "driving", milliseconds: 60 * 60000),
                FSMStateDuration(state: "charging", milliseconds: 30 * 60000)
            ],
            rows: []
        )
        let summary = FSMDistributionAccessibility.summary(for: projection, hourUnit: "h", minuteUnit: "m")
        XCTAssertTrue(summary.contains("Driving"))
        XCTAssertTrue(summary.contains("67%"))
        XCTAssertTrue(summary.contains("Charging"))
        XCTAssertTrue(summary.contains("33%"))
        XCTAssertTrue(summary.contains("1h 0m"))
    }

    func testSummaryEmptyWhenNoData() {
        let summary = FSMDistributionAccessibility.summary(for: .empty, hourUnit: "h", minuteUnit: "m")
        XCTAssertEqual(summary, "No state data available")
    }

    func testTransitionLabelWithTimestamp() {
        let item = FSMTransitionItem(
            id: 1,
            fromState: "driving",
            toState: "idle",
            timestamp: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let label = FSMDistributionAccessibility.transitionLabel(
            item,
            now: Date(timeIntervalSince1970: 1_700_000_300)
        )
        XCTAssertTrue(label.contains("Driving"))
        XCTAssertTrue(label.contains("Idle"))
        XCTAssertTrue(label.contains("to"))
    }

    func testTransitionLabelWithoutTimestamp() {
        let item = FSMTransitionItem(id: 1, fromState: "charging", toState: "asleep", timestamp: nil)
        let label = FSMDistributionAccessibility.transitionLabel(item, now: Date())
        XCTAssertEqual(label, "Charging to Asleep")
    }

    func testStateLabelCapitalizesAndBlankFallback() {
        XCTAssertEqual(FSMDistributionStrings.stateLabel("driving"), "Driving")
        XCTAssertEqual(FSMDistributionStrings.stateLabel("updating"), "Updating")
        XCTAssertEqual(FSMDistributionStrings.stateLabel(""), "—")
        XCTAssertEqual(FSMDistributionStrings.stateLabel("   "), "—")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyFSMDistributionTelemetry: FSMDistributionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
