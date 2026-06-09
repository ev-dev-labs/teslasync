//
//  RegenEfficiencyWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0081 · RegenEfficiencyWidget (Apple)
//
//  Unit coverage for the RegenEfficiencyWidget surface:
//    • Adapter (cached SI → projection) — `RegenProjection.make` parity with the web data derivations
//      (regenPct, gauge clamp, regenColor zone, formatEnergy/formatPower/fmtInt, null-coalescing).
//    • State holder — `RegenEfficiencyModel` phase resolution across loading / empty / error / content,
//      plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `regen-efficiency` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the model is
//  driven by `InMemoryRegenEfficiencySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached SI payload → projection (parity with the web derivations)

@MainActor final class RegenProjectionAdapterTests: XCTestCase {
    private let sample = RegenEfficiencyInput(
        totalRegenWh: 184_500,
        totalDriveWh: 642_000,
        regenRatio: 0.287,
        monthlyAvgRegen: 2500,
        freeCharges: 3
    )

    func testNilPayloadYieldsEmpty() {
        let projection = RegenProjection.make(from: nil)
        XCTAssertEqual(projection, .empty)
        XCTAssertFalse(projection.hasData)
        XCTAssertEqual(projection.gaugePercentText, "0%")
        XCTAssertEqual(projection.totalRecoveredText, "—")
        XCTAssertEqual(projection.monthlyAvgText, "—")
        XCTAssertEqual(projection.freeChargesText, "0")
    }

    func testBasicProjectionFields() {
        let projection = RegenProjection.make(from: sample)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.regenPercent, 28.7, accuracy: 0.001)
        XCTAssertEqual(projection.gaugeFraction, 0.287, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugePercentText, "29%")
        XCTAssertEqual(projection.zone, .medium)
        XCTAssertEqual(projection.totalRecoveredText, "184.5 kWh")
        XCTAssertEqual(projection.monthlyAvgText, "2.5 kW")
        XCTAssertEqual(projection.freeChargesText, "3")
    }

    func testStatsOrderAndValues() {
        let stats = RegenProjection.make(from: sample).stats
        XCTAssertEqual(stats.map(\.id), ["total", "monthly", "free"])
        XCTAssertEqual(stats[0].labelKey, "widget.regenEfficiency.totalKwh")
        XCTAssertEqual(stats[0].value, "184.5 kWh")
        XCTAssertEqual(stats[1].value, "2.5 kW")
        XCTAssertEqual(stats[2].value, "3")
    }

    func testMissingOptionalFieldsFallBack() {
        let projection = RegenProjection.make(from: RegenEfficiencyInput(regenRatio: 0.5))
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.regenPercent, 50, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugeFraction, 0.5, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugePercentText, "50%")
        XCTAssertEqual(projection.zone, .high)
        XCTAssertEqual(projection.totalRecoveredText, "—")
        XCTAssertEqual(projection.monthlyAvgText, "—")
        XCTAssertEqual(projection.freeChargesText, "0")
    }

    func testMissingRatioDefaultsToZeroPercent() {
        let projection = RegenProjection.make(from: RegenEfficiencyInput(freeCharges: 1))
        XCTAssertEqual(projection.regenPercent, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugeFraction, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugePercentText, "0%")
        XCTAssertEqual(projection.zone, .low)
        XCTAssertEqual(projection.freeChargesText, "1")
    }

    func testRatioAboveOneClampsGaugeButKeepsPercentLabel() {
        let projection = RegenProjection.make(from: RegenEfficiencyInput(regenRatio: 1.5))
        XCTAssertEqual(projection.regenPercent, 150, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugeFraction, 1.0, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugePercentText, "150%")
        XCTAssertEqual(projection.zone, .high)
    }

    func testNonFiniteRatioIsCoercedToZero() {
        let projection = RegenProjection.make(from: RegenEfficiencyInput(regenRatio: .nan))
        XCTAssertEqual(projection.regenPercent, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugePercentText, "0%")
        XCTAssertEqual(projection.zone, .low)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class RegenEfficiencyModelTests: XCTestCase {
    private func makeModel(
        _ update: RegenUpdate,
        telemetry: RegenEfficiencyTelemetry = OSLogRegenEfficiencyTelemetry()
    ) -> (RegenEfficiencyModel, InMemoryRegenEfficiencySource) {
        let source = InMemoryRegenEfficiencySource(initial: update)
        let model = RegenEfficiencyModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(RegenUpdate(status: .loading, payload: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutPayloadShowsEmpty() {
        let (model, _) = makeModel(RegenUpdate(status: .loaded, payload: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedWithPayloadShowsContent() {
        let (model, _) = makeModel(RegenUpdate(
            status: .loaded,
            payload: RegenEfficiencyInput(regenRatio: 0.25)
        ))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }

    func testFailedShowsErrorEvenWithCachedPayload() {
        let (noCache, _) = makeModel(RegenUpdate(status: .failed("boom"), payload: nil))
        noCache.start()
        XCTAssertEqual(noCache.phase, .error("boom"))

        let (cached, _) = makeModel(
            RegenUpdate(status: .failed("net"), payload: RegenEfficiencyInput(regenRatio: 0.3))
        )
        cached.start()
        XCTAssertEqual(cached.phase, .error("net"))
    }

    func testCachedPayloadStaysVisibleWhileLoading() {
        let (model, _) = makeModel(
            RegenUpdate(status: .loading, payload: RegenEfficiencyInput(regenRatio: 0.2))
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testConnectionAndFetchingTrackUpdates() {
        let (model, source) = makeModel(RegenUpdate(status: .loading, payload: nil))
        model.start()
        source.push(
            RegenUpdate(
                status: .loaded,
                connection: .offline,
                payload: RegenEfficiencyInput(regenRatio: 0.45, monthlyAvgRegen: 2500, freeCharges: 2),
                updatedAt: Date(),
                isFetching: true
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.isFetching)
        XCTAssertEqual(model.projection.zone, .high)
        XCTAssertEqual(model.projection.monthlyAvgText, "2.5 kW")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyRegenEfficiencyTelemetry()
        let (model, source) = makeModel(RegenUpdate(status: .loading, payload: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RegenEfficiencyWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(RegenUpdate(status: .loaded, payload: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStopDelegatesToSource() {
        let (model, source) = makeModel(RegenUpdate(status: .loaded, payload: nil))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Registry parity

@MainActor final class RegenEfficiencyRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = RegenEfficiencyWidget.registration
        XCTAssertEqual(registration.id, "regen-efficiency")
        XCTAssertEqual(registration.category, "driving")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 3, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = RegenEfficiencyWidget.registration
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
        XCTAssertEqual(RegenEfficiencyWidget.surfaceSlug, "RegenEfficiencyWidget")
    }
}

// MARK: - Accessibility summary content

@MainActor final class RegenEfficiencyAccessibilityTests: XCTestCase {
    func testSummaryIncludesAllPresentMetrics() {
        let projection = RegenProjection.make(
            from: RegenEfficiencyInput(
                totalRegenWh: 184_500,
                regenRatio: 0.287,
                monthlyAvgRegen: 2500,
                freeCharges: 3
            )
        )
        let summary = RegenEfficiencyAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("29%"))
        XCTAssertTrue(summary.contains("recovery"))
        XCTAssertTrue(summary.contains("Total Recovered"))
        XCTAssertTrue(summary.contains("184.5 kWh"))
        XCTAssertTrue(summary.contains("Monthly Avg"))
        XCTAssertTrue(summary.contains("2.5 kW"))
        XCTAssertTrue(summary.contains("Free Charges"))
        XCTAssertTrue(summary.contains("3"))
    }

    func testSummaryForEmptyProjection() {
        let summary = RegenEfficiencyAccessibility.summary(for: .empty)
        XCTAssertEqual(summary, "No regen data")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyRegenEfficiencyTelemetry: RegenEfficiencyTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
