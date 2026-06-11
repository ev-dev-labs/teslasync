//
//  StateTimelineWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0096 · StateTimelineWidget (Apple)
//
//  Unit coverage for the StateTimelineWidget surface:
//    • Adapter (cached → projection) — `StateTimelineBuilder` parity with the
//      web StateTimelineWidget.tsx derive block (buildSegments + TimelineStripe)
//      and the `fmtNumber` / `fmtInt` / `fmtDuration` formatters.
//    • State holder — `STWModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry +
//      source wiring and the compact/wide thresholds.
//    • Registry — canonical `state-timeline` metadata + size clamping.
//    • Accessibility — the VoiceOver distribution summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `STWInMemoryStateTimelineSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: segments + stripe (parity with the web derive block)

@MainActor final class StateTimelineBuilderTests: XCTestCase {
    func testBuildSegmentsEmptyWhenTotalIsZero() {
        let input = [
            StateSummaryEntry(state: "driving", totalMin: 0),
            StateSummaryEntry(state: "idle", totalMin: 0)
        ]
        XCTAssertTrue(StateTimelineBuilder.buildSegments(input).isEmpty)
    }

    func testBuildSegmentsPercentagesAndOrder() {
        let input = [
            StateSummaryEntry(state: "driving", totalMin: 60, count: 3),
            StateSummaryEntry(state: "charging", totalMin: 40, count: 2)
        ]
        let segments = StateTimelineBuilder.buildSegments(input)
        XCTAssertEqual(segments.count, 2)
        XCTAssertEqual(segments[0].rawState, "driving")
        XCTAssertEqual(segments[0].kind, .driving)
        XCTAssertEqual(segments[0].pct, 60, accuracy: 1e-9)
        XCTAssertEqual(segments[0].count, 3)
        XCTAssertEqual(segments[1].pct, 40, accuracy: 1e-9)
        XCTAssertEqual(segments.reduce(0) { $0 + $1.pct }, 100, accuracy: 1e-9)
    }

    func testBuildSegmentsBlankStateUsesEmDash() {
        let segments = StateTimelineBuilder.buildSegments([StateSummaryEntry(state: "   ", totalMin: 50)])
        XCTAssertEqual(segments.count, 1)
        XCTAssertEqual(segments[0].rawState, "—")
        XCTAssertEqual(segments[0].kind, .unknown)
        XCTAssertEqual(segments[0].pct, 100, accuracy: 1e-9)
    }

    func testBuildStripeEmptyWhenTotalIsZero() {
        XCTAssertTrue(StateTimelineBuilder.buildStripe([StateTransitionEntry(state: "idle", durationMin: 0)]).isEmpty)
    }

    func testBuildStripeDropsSubHalfPercentAndKeepsOriginalIndex() {
        let input = [
            StateTransitionEntry(state: "asleep", durationMin: 50),
            StateTransitionEntry(state: "idle", durationMin: 0.2),
            StateTransitionEntry(state: "driving", durationMin: 49.8)
        ]
        let stripe = StateTimelineBuilder.buildStripe(input)
        XCTAssertEqual(stripe.count, 2)
        XCTAssertEqual(stripe[0].index, 0)
        XCTAssertEqual(stripe[0].kind, .asleep)
        XCTAssertEqual(stripe[1].index, 2)
        XCTAssertEqual(stripe[1].kind, .driving)
        XCTAssertEqual(stripe[1].pct, 49.8, accuracy: 1e-9)
    }

    func testProjectCombinesBothSources() {
        let projection = StateTimelineBuilder.project(
            summary: [StateSummaryEntry(state: "driving", totalMin: 100)],
            transitions: [StateTransitionEntry(state: "driving", durationMin: 100)]
        )
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.segments.count, 1)
        XCTAssertEqual(projection.stripe.count, 1)
    }
}

// MARK: - Adapter: formatting + kind parsing

@MainActor final class STWFormatTests: XCTestCase {
    func testDecimalAndIntegerGroupAndRound() {
        XCTAssertEqual(STWFormat.decimal(25.806, fractionDigits: 1), "25.8")
        XCTAssertEqual(STWFormat.decimal(25.85, fractionDigits: 1), "25.9")
        XCTAssertEqual(STWFormat.integer(25.806), "26")
        XCTAssertEqual(STWFormat.integer(1234), "1,234")
    }

    func testDurationPartsMatchWebFloorAndRound() {
        XCTAssertEqual(STWFormat.durationParts(125).hours, 2)
        XCTAssertEqual(STWFormat.durationParts(125).minutes, 5)
        XCTAssertEqual(STWFormat.durationParts(45).hours, 0)
        XCTAssertEqual(STWFormat.durationParts(45).minutes, 45)
        XCTAssertEqual(STWFormat.durationParts(600).hours, 10)
        XCTAssertEqual(STWFormat.durationParts(600).minutes, 0)
    }

    func testDurationComposesLikeWeb() {
        XCTAssertEqual(
            STWFormat.duration(125, hourSuffix: "h", minuteSuffix: "m"),
            "2h 5m"
        )
        XCTAssertEqual(STWFormat.duration(45, hourSuffix: "h", minuteSuffix: "m"), "45m")
        XCTAssertEqual(
            STWFormat.duration(600, hourSuffix: "h", minuteSuffix: "m"),
            "10h 0m"
        )
    }

    func testStateKindParsingLowercasesAndTrims() {
        XCTAssertEqual(VehicleStateKind.from(raw: "Driving"), .driving)
        XCTAssertEqual(VehicleStateKind.from(raw: "CHARGING"), .charging)
        XCTAssertEqual(VehicleStateKind.from(raw: "  asleep "), .asleep)
        XCTAssertEqual(VehicleStateKind.from(raw: "idle"), .idle)
        XCTAssertEqual(VehicleStateKind.from(raw: "offline"), .offline)
        XCTAssertEqual(VehicleStateKind.from(raw: "sentry"), .unknown)
    }

    func testSegmentLocalizationKeyAndFallback() {
        let segment = StateSegment(rawState: "driving", kind: .driving, pct: 50, totalMin: 30, count: 1)
        XCTAssertEqual(segment.localizationKey, "widget.stateTimeline.state.driving")
        XCTAssertEqual(segment.fallbackLabel, "Driving")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class StateTimelineModelTests: XCTestCase {
    private func makeModel(
        _ update: STWUpdate,
        telemetry: STWTelemetry = STWOSLogStateTimelineTelemetry()
    ) -> (STWModel, STWInMemoryStateTimelineSource) {
        let source = STWInMemoryStateTimelineSource(initial: update)
        let model = STWModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var sampleSummary: [StateSummaryEntry] {
        [StateSummaryEntry(state: "driving", totalMin: 60), StateSummaryEntry(state: "idle", totalMin: 40)]
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(STWUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(STWUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(STWUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFetchingOrFailed() {
        let (loading, _) = makeModel(STWUpdate(status: .loading, summary: sampleSummary))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(STWUpdate(
            status: .failed("net"),
            summary: sampleSummary
        ))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyStateTimelineTelemetry()
        let (model, source) = makeModel(STWUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [StateTimelineWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(STWUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(STWUpdate(status: .loading))
        model.start()
        source.push(
            STWUpdate(
                status: .loaded,
                connection: .offline,
                vehicle: StateTimelineVehicleRef(id: 3, displayName: "Cybertruck"),
                summary: sampleSummary,
                transitions: [StateTransitionEntry(state: "driving", durationMin: 100)],
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.segments.count, 2)
        XCTAssertEqual(model.projection.stripe.count, 1)
    }

    func testCompactAndWideThresholds() {
        XCTAssertTrue(STWModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(STWModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertFalse(STWModel.isWide(for: DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertTrue(STWModel.isWide(for: DashboardWidgetSize(cols: 3, rows: 4)))
    }
}

// MARK: - Registry parity

@MainActor final class StateTimelineRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = StateTimelineWidget.registration
        XCTAssertEqual(registration.id, "state-timeline")
        XCTAssertEqual(registration.category, "analytics")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = StateTimelineWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
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

// MARK: - Accessibility summary content

@MainActor final class STWAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryStateLabelAndPercent() {
        let projection = StateTimelineBuilder.project(
            summary: [
                StateSummaryEntry(state: "driving", totalMin: 60),
                StateSummaryEntry(state: "charging", totalMin: 40)
            ],
            transitions: []
        )
        let summary = STWAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Driving"))
        XCTAssertTrue(summary.contains("Charging"))
        XCTAssertTrue(summary.contains("60.0%"))
        XCTAssertTrue(summary.contains("40.0%"))
    }

    func testSummaryIsEmptyWithoutSegments() {
        let projection = StateTimelineBuilder.project(summary: [], transitions: [])
        XCTAssertTrue(STWAccessibility.summary(for: projection).isEmpty)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyStateTimelineTelemetry: STWTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
