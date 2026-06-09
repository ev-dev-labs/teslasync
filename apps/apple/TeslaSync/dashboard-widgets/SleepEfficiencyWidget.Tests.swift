//
//  SleepEfficiencyWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0090 · SleepEfficiencyWidget (Apple)
//
//  Unit coverage for the SleepEfficiencyWidget surface:
//    • Adapter (cached payload → projection) — `SleepProjection.make` parity with the web data derivations
//      (efficiencyPct, gauge clamp + integer-readout rule, efficiencyColor zone, ×24 daily drain,
//      asleep/offline sleep-hours sum, wake-event count, null-coalescing).
//    • State holder — `SleepEfficiencyModel` phase resolution across loading / empty / error / content,
//      plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `sleep-efficiency` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the model is
//  driven by `InMemorySleepEfficiencySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached payload → projection (parity with the web derivations)

@MainActor final class SleepProjectionAdapterTests: XCTestCase {
    private let sample = SleepEfficiencyInput(
        sleepEfficiencyPct: 92.5,
        sentryOffDrainRate: 0.5,
        stateDistribution: [
            SleepStateSlice(state: "asleep", totalMinutes: 600),
            SleepStateSlice(state: "offline", totalMinutes: 120),
            SleepStateSlice(state: "online", totalMinutes: 240),
            SleepStateSlice(state: "driving", totalMinutes: 90)
        ],
        recentEventsCount: 3
    )

    func testNilPayloadYieldsEmpty() {
        let projection = SleepProjection.make(from: nil)
        XCTAssertEqual(projection, .empty)
        XCTAssertFalse(projection.hasData)
        XCTAssertEqual(projection.gaugeValueText, "0")
        XCTAssertEqual(projection.gaugeUnit, "%")
        XCTAssertEqual(projection.avgDrainText, "0.00")
        XCTAssertEqual(projection.totalSleepText, "0")
        XCTAssertEqual(projection.wakeEventsText, "0")
    }

    func testBasicProjectionFields() {
        let projection = SleepProjection.make(from: sample)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.efficiencyPercent, 92.5, accuracy: 0.001)
        XCTAssertEqual(projection.gaugeFraction, 0.925, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugeValueText, "92.50")
        XCTAssertEqual(projection.gaugeUnit, "%")
        XCTAssertEqual(projection.zone, .medium)
        XCTAssertEqual(projection.avgDrainText, "12.00")
        XCTAssertEqual(projection.totalSleepText, "12")
        XCTAssertEqual(projection.wakeEventsText, "3")
    }

    func testSleepHoursSumOnlyCountsAsleepAndOffline() {
        // online (240) + driving (90) must be excluded; only asleep (600) + offline (120) → 12h.
        let projection = SleepProjection.make(from: sample)
        XCTAssertEqual(projection.totalSleepText, "12")

        // Flip the magnitudes so the awake states dominate — they still must not count.
        let awakeHeavy = SleepEfficiencyInput(
            sleepEfficiencyPct: 50,
            stateDistribution: [
                SleepStateSlice(state: "asleep", totalMinutes: 60),
                SleepStateSlice(state: "online", totalMinutes: 6000),
                SleepStateSlice(state: "driving", totalMinutes: 3000)
            ]
        )
        XCTAssertEqual(SleepProjection.make(from: awakeHeavy).totalSleepText, "1")
    }

    func testStatsOrderAndValues() {
        let stats = SleepProjection.make(from: sample).stats
        XCTAssertEqual(stats.map(\.id), ["drain", "sleep", "wake"])
        XCTAssertEqual(stats[0].labelKey, "widget.sleepEfficiency.avgDrain")
        XCTAssertEqual(stats[0].value, "12.00")
        XCTAssertEqual(stats[0].unit, "%")
        XCTAssertEqual(stats[1].labelKey, "widget.sleepEfficiency.totalSleep")
        XCTAssertEqual(stats[1].value, "12")
        XCTAssertEqual(stats[1].unit, "h")
        XCTAssertEqual(stats[2].labelKey, "widget.sleepEfficiency.wakeEvents")
        XCTAssertEqual(stats[2].value, "3")
        XCTAssertNil(stats[2].unit)
    }

    func testMissingOptionalFieldsFallBack() {
        let projection = SleepProjection.make(from: SleepEfficiencyInput(sleepEfficiencyPct: 88))
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.efficiencyPercent, 88, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugeValueText, "88")
        XCTAssertEqual(projection.zone, .medium)
        XCTAssertEqual(projection.avgDrainText, "0.00")
        XCTAssertEqual(projection.totalSleepText, "0")
        XCTAssertEqual(projection.wakeEventsText, "0")
    }

    func testIntegerEfficiencyDropsFraction() {
        let projection = SleepProjection.make(from: SleepEfficiencyInput(sleepEfficiencyPct: 90))
        XCTAssertEqual(projection.gaugeValueText, "90")
        XCTAssertEqual(projection.gaugeFraction, 0.9, accuracy: 0.0001)
        XCTAssertEqual(projection.zone, .medium)
    }

    func testEfficiencyAboveMaxClampsGaugeButKeepsRawPercent() {
        let projection = SleepProjection.make(from: SleepEfficiencyInput(sleepEfficiencyPct: 120))
        XCTAssertEqual(projection.efficiencyPercent, 120, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugeFraction, 1.0, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugeValueText, "100")
        XCTAssertEqual(projection.zone, .high)
    }

    func testNonFiniteEfficiencyIsCoercedToZero() {
        let projection = SleepProjection.make(from: SleepEfficiencyInput(sleepEfficiencyPct: .nan))
        XCTAssertEqual(projection.efficiencyPercent, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugeValueText, "0")
        XCTAssertEqual(projection.gaugeFraction, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.zone, .low)
    }

    func testNilStateMinutesTreatedAsZero() {
        let projection = SleepProjection.make(
            from: SleepEfficiencyInput(
                sleepEfficiencyPct: 96,
                stateDistribution: [
                    SleepStateSlice(state: "asleep", totalMinutes: nil),
                    SleepStateSlice(state: "offline", totalMinutes: 180)
                ]
            )
        )
        XCTAssertEqual(projection.totalSleepText, "3")
        XCTAssertEqual(projection.zone, .high)
    }

    func testDrainScalesByTwentyFour() {
        let projection = SleepProjection.make(from: SleepEfficiencyInput(sentryOffDrainRate: 0.25))
        XCTAssertEqual(projection.avgDrainText, "6.00")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class SleepEfficiencyModelTests: XCTestCase {
    private func makeModel(
        _ update: SleepEfficiencyUpdate,
        telemetry: SleepEfficiencyTelemetry = OSLogSleepEfficiencyTelemetry()
    ) -> (SleepEfficiencyModel, InMemorySleepEfficiencySource) {
        let source = InMemorySleepEfficiencySource(initial: update)
        let model = SleepEfficiencyModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(SleepEfficiencyUpdate(status: .loading, payload: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutPayloadShowsEmpty() {
        let (model, _) = makeModel(SleepEfficiencyUpdate(status: .loaded, payload: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedWithPayloadShowsContent() {
        let (model, _) = makeModel(SleepEfficiencyUpdate(
            status: .loaded,
            payload: SleepEfficiencyInput(sleepEfficiencyPct: 90)
        ))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }

    func testFailedShowsErrorEvenWithCachedPayload() {
        let (noCache, _) = makeModel(SleepEfficiencyUpdate(status: .failed("boom"), payload: nil))
        noCache.start()
        XCTAssertEqual(noCache.phase, .error("boom"))

        let (cached, _) = makeModel(
            SleepEfficiencyUpdate(status: .failed("net"), payload: SleepEfficiencyInput(sleepEfficiencyPct: 91))
        )
        cached.start()
        XCTAssertEqual(cached.phase, .error("net"))
    }

    func testCachedPayloadStaysVisibleWhileLoading() {
        let (model, _) = makeModel(
            SleepEfficiencyUpdate(status: .loading, payload: SleepEfficiencyInput(sleepEfficiencyPct: 88))
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testConnectionAndFetchingTrackUpdates() {
        let (model, source) = makeModel(SleepEfficiencyUpdate(status: .loading, payload: nil))
        model.start()
        source.push(
            SleepEfficiencyUpdate(
                status: .loaded,
                connection: .offline,
                payload: SleepEfficiencyInput(
                    sleepEfficiencyPct: 97,
                    sentryOffDrainRate: 0.5,
                    recentEventsCount: 2
                ),
                updatedAt: Date(),
                isFetching: true
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.isFetching)
        XCTAssertEqual(model.projection.zone, .high)
        XCTAssertEqual(model.projection.avgDrainText, "12.00")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySleepEfficiencyTelemetry()
        let (model, source) = makeModel(SleepEfficiencyUpdate(status: .loading, payload: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SleepEfficiencyWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SleepEfficiencyUpdate(status: .loaded, payload: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStopDelegatesToSource() {
        let (model, source) = makeModel(SleepEfficiencyUpdate(status: .loaded, payload: nil))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Registry parity

@MainActor final class SleepEfficiencyRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SleepEfficiencyWidget.registration
        XCTAssertEqual(registration.id, "sleep-efficiency")
        XCTAssertEqual(registration.category, "energy")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 3, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = SleepEfficiencyWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 3, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 12)),
            DashboardWidgetSize(cols: 2, rows: 12)
        )
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(SleepEfficiencyWidget.surfaceSlug, "SleepEfficiencyWidget")
    }
}

// MARK: - Accessibility summary content

@MainActor final class SleepEfficiencyAccessibilityTests: XCTestCase {
    func testSummaryIncludesAllPresentMetrics() {
        let projection = SleepProjection.make(
            from: SleepEfficiencyInput(
                sleepEfficiencyPct: 92.5,
                sentryOffDrainRate: 0.5,
                stateDistribution: [
                    SleepStateSlice(state: "asleep", totalMinutes: 600),
                    SleepStateSlice(state: "offline", totalMinutes: 120)
                ],
                recentEventsCount: 3
            )
        )
        let summary = SleepEfficiencyAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Efficiency"))
        XCTAssertTrue(summary.contains("92.50%"))
        XCTAssertTrue(summary.contains("Avg Drain/Day"))
        XCTAssertTrue(summary.contains("12.00"))
        XCTAssertTrue(summary.contains("Total Sleep"))
        XCTAssertTrue(summary.contains("Wake Events"))
        XCTAssertTrue(summary.contains("3"))
    }

    func testSummaryForEmptyProjection() {
        let summary = SleepEfficiencyAccessibility.summary(for: .empty)
        XCTAssertEqual(summary, "No sleep efficiency data")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySleepEfficiencyTelemetry: SleepEfficiencyTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
