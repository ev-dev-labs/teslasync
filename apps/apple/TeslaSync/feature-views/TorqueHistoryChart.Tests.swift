//
//  TorqueHistoryChart.Tests.swift
//  TeslaSync — P4 feature view · 0164 · TorqueHistoryChart (Apple)
//
//  Unit coverage for the TorqueHistoryChart surface:
//    • Adapter (`TorqueHistoryProjection`) — order-preserving point projection, the
//      web `data.length <= 1 || !data.some(d => d.torque !== null)` empty guard,
//      content/empty phase resolution, and the plotted / min / max / latest stats
//      (parity with the web component body).
//    • Formatting (`TorqueHistoryFormat`) — locale-aware decimal + Nm strings.
//    • State holder (`TorqueHistoryChartModel`) — phase across loading / loaded /
//      empty / failed, the P1/S11 `view.opened` telemetry (once), the stale
//      auto-refresh (exactly once), and offline keeping the cached trace.
//    • Accessibility — the chart summary + per-sample VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection (web component-body parity)

@MainActor final class TorqueHistoryProjectionTests: XCTestCase {
    private let sweep: [TorqueHistorySample] = [
        TorqueHistorySample(time: "08:00", torque: 0),
        TorqueHistorySample(time: "08:05", torque: 140),
        TorqueHistorySample(time: "08:10", torque: 320),
        TorqueHistorySample(time: "08:15", torque: nil),
        TorqueHistorySample(time: "08:20", torque: 210),
        TorqueHistorySample(time: "08:25", torque: -45),
        TorqueHistorySample(time: "08:30", torque: 95),
        TorqueHistorySample(time: "08:35", torque: 180)
    ]

    func testPointsPreserveOrderAndIndex() {
        let points = TorqueHistoryProjection.points(from: sweep)
        XCTAssertEqual(points.count, 8)
        XCTAssertEqual(points.map(\.index), Array(0 ..< 8))
        XCTAssertEqual(points.first?.time, "08:00")
        XCTAssertEqual(points.first?.torque, 0)
        XCTAssertEqual(points[3].torque, nil)
        XCTAssertEqual(points.last?.time, "08:35")
        XCTAssertEqual(points.last?.torque, 180)
    }

    func testEmptyInputYieldsNoPoints() {
        XCTAssertTrue(TorqueHistoryProjection.points(from: []).isEmpty)
    }

    func testHasRenderableDataMatchesWebGuard() {
        // The web render guard: `data.length <= 1 || !data.some(d => d.torque !== null)`.
        // 0 rows → not renderable (length <= 1).
        XCTAssertFalse(TorqueHistoryProjection.hasRenderableData([]))
        // 1 row → not renderable (length <= 1), even with a value.
        XCTAssertFalse(TorqueHistoryProjection.hasRenderableData([
            TorqueHistorySample(time: "08:00", torque: 120)
        ]))
        // 2 rows but all null → not renderable (no `torque !== null`).
        XCTAssertFalse(TorqueHistoryProjection.hasRenderableData([
            TorqueHistorySample(time: "08:00", torque: nil),
            TorqueHistorySample(time: "08:05", torque: nil)
        ]))
        // 2 rows with one value → renderable.
        XCTAssertTrue(TorqueHistoryProjection.hasRenderableData([
            TorqueHistorySample(time: "08:00", torque: nil),
            TorqueHistorySample(time: "08:05", torque: 75)
        ]))
        // The full sweep → renderable.
        XCTAssertTrue(TorqueHistoryProjection.hasRenderableData(sweep))
    }

    func testResolvePhase() {
        XCTAssertEqual(TorqueHistoryProjection.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(TorqueHistoryProjection.resolvePhase(.loaded, hasData: true), .content)
        XCTAssertEqual(TorqueHistoryProjection.resolvePhase(.loaded, hasData: false), .empty)
        XCTAssertEqual(TorqueHistoryProjection.resolvePhase(.failed("boom"), hasData: true), .error("boom"))
    }

    func testPlottedDropsNulls() {
        let points = TorqueHistoryProjection.points(from: sweep)
        let plotted = TorqueHistoryProjection.plotted(points)
        XCTAssertEqual(plotted.count, 7)
        XCTAssertFalse(plotted.contains { $0.torque == nil })
    }

    func testMinMaxLatest() {
        let points = TorqueHistoryProjection.points(from: sweep)
        XCTAssertEqual(TorqueHistoryProjection.minTorque(points), -45)
        XCTAssertEqual(TorqueHistoryProjection.maxTorque(points), 320)
        XCTAssertEqual(TorqueHistoryProjection.latestPoint(points)?.time, "08:35")
        XCTAssertEqual(TorqueHistoryProjection.latestPoint(points)?.torque, 180)
    }

    func testLatestSkipsTrailingNull() {
        let trailingGap = [
            TorqueHistorySample(time: "09:00", torque: 50),
            TorqueHistorySample(time: "09:05", torque: 90),
            TorqueHistorySample(time: "09:10", torque: nil)
        ]
        let points = TorqueHistoryProjection.points(from: trailingGap)
        XCTAssertEqual(TorqueHistoryProjection.latestPoint(points)?.time, "09:05")
        XCTAssertEqual(TorqueHistoryProjection.latestPoint(points)?.torque, 90)
    }

    func testStatsEmptyWhenAllNull() {
        let allNull = [
            TorqueHistorySample(time: "09:00", torque: nil),
            TorqueHistorySample(time: "09:05", torque: nil)
        ]
        let points = TorqueHistoryProjection.points(from: allNull)
        XCTAssertNil(TorqueHistoryProjection.minTorque(points))
        XCTAssertNil(TorqueHistoryProjection.maxTorque(points))
        XCTAssertNil(TorqueHistoryProjection.latestPoint(points))
    }

    @MainActor
    func testSurfaceSlug() {
        XCTAssertEqual(TorqueHistorySurface.slug, "TorqueHistoryChart")
        XCTAssertEqual(TorqueHistoryChart.surfaceSlug, "TorqueHistoryChart")
    }
}

// MARK: - Formatting

@MainActor final class TorqueHistoryFormatTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    func testDecimalRendersUpToOneFractionDigit() {
        XCTAssertEqual(TorqueHistoryFormat.decimal(180, locale: posix), "180")
        XCTAssertEqual(TorqueHistoryFormat.decimal(12.5, locale: posix), "12.5")
        XCTAssertEqual(TorqueHistoryFormat.decimal(12.34, locale: posix), "12.3")
        XCTAssertEqual(TorqueHistoryFormat.decimal(0, locale: posix), "0")
    }

    func testDecimalHandlesNegativeTorque() {
        XCTAssertEqual(TorqueHistoryFormat.decimal(-45, locale: posix), "-45")
        XCTAssertEqual(TorqueHistoryFormat.decimal(-37.5, locale: posix), "-37.5")
    }

    func testDecimalNonFiniteIsEmDash() {
        XCTAssertEqual(TorqueHistoryFormat.decimal(.nan, locale: posix), "—")
        XCTAssertEqual(TorqueHistoryFormat.decimal(.infinity, locale: posix), "—")
    }

    func testNewtonMetresAppendsUnit() {
        XCTAssertEqual(TorqueHistoryFormat.newtonMetres(180, unit: "Nm", locale: posix), "180 Nm")
        XCTAssertEqual(TorqueHistoryFormat.newtonMetres(-45, unit: "Nm", locale: posix), "-45 Nm")
    }
}

// MARK: - State holder: TorqueHistoryChartModel

@MainActor final class TorqueHistoryChartModelTests: XCTestCase {
    private func makeModel(
        initial: TorqueHistoryUpdate?,
        telemetry: TorqueHistoryChartTelemetry = SpyTorqueHistoryTelemetry()
    ) -> (TorqueHistoryChartModel, InMemoryTorqueHistorySource) {
        let source = InMemoryTorqueHistorySource(initial: initial)
        let model = TorqueHistoryChartModel(
            source: source,
            telemetry: telemetry,
            locale: Locale(identifier: "en_US_POSIX")
        )
        return (model, source)
    }

    private let sweep: [TorqueHistorySample] = [
        TorqueHistorySample(time: "08:00", torque: 0),
        TorqueHistorySample(time: "08:05", torque: 140),
        TorqueHistorySample(time: "08:10", torque: nil),
        TorqueHistorySample(time: "08:15", torque: 210)
    ]

    func testLoadedContentProjectsPoints() {
        let (model, source) = makeModel(initial: TorqueHistoryUpdate(status: .loaded, samples: sweep))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 4)
        XCTAssertEqual(TorqueHistoryProjection.plotted(model.points).count, 3)
        XCTAssertEqual(model.points.first?.torque, 0)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: TorqueHistoryUpdate(status: .loaded, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.points.isEmpty)
    }

    func testSingleSampleResolvesEmptyPhase() {
        // Web guard: `data.length <= 1` → `return null`, even with a value.
        let (model, _) = makeModel(initial: TorqueHistoryUpdate(
            status: .loaded,
            samples: [TorqueHistorySample(time: "08:00", torque: 120)]
        ))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testAllNullResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: TorqueHistoryUpdate(
            status: .loaded,
            samples: [
                TorqueHistorySample(time: "08:00", torque: nil),
                TorqueHistorySample(time: "08:05", torque: nil)
            ]
        ))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: TorqueHistoryUpdate(status: .loading, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: TorqueHistoryUpdate(status: .failed("timeout"), samples: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyTorqueHistoryTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TorqueHistorySurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(TorqueHistoryUpdate(status: .loaded, samples: sweep, connection: .stale))
        source.push(TorqueHistoryUpdate(status: .loaded, samples: sweep, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(TorqueHistoryUpdate(status: .loaded, samples: sweep, connection: .stale))
        source.push(TorqueHistoryUpdate(status: .loaded, samples: sweep, connection: .live))
        source.push(TorqueHistoryUpdate(status: .loaded, samples: sweep, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedTraceWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(TorqueHistoryUpdate(status: .loaded, samples: sweep, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 4)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: TorqueHistoryUpdate(status: .failed("x"), samples: []))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class TorqueHistoryAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let posix = Locale(identifier: "en_US_POSIX")

    private let points = TorqueHistoryProjection.points(from: [
        TorqueHistorySample(time: "08:00", torque: 0),
        TorqueHistorySample(time: "08:05", torque: 320),
        TorqueHistorySample(time: "08:10", torque: nil),
        TorqueHistorySample(time: "08:15", torque: -45),
        TorqueHistorySample(time: "08:20", torque: 180)
    ])

    func testChartSummaryIncludesLatestAndRange() {
        let summary = TorqueHistoryAccessibility.chartSummary(points: points, localize: echo, locale: posix)
        XCTAssertTrue(summary.contains("Motor Torque"))
        XCTAssertTrue(summary.contains("4 samples"))
        XCTAssertTrue(summary.contains("Latest 08:20: Torque 180 Nm"))
        XCTAssertTrue(summary.contains("Range -45 Nm – 320 Nm"))
    }

    func testChartSummaryEmpty() {
        let summary = TorqueHistoryAccessibility.chartSummary(points: [], localize: echo, locale: posix)
        XCTAssertTrue(summary.contains("Motor Torque"))
        XCTAssertTrue(summary.contains("No data available"))
    }

    func testPointLabel() {
        let label = TorqueHistoryAccessibility.pointLabel(points[1], localize: echo, locale: posix)
        XCTAssertEqual(label, "08:05: Torque 320 Nm")
    }

    func testPointLabelGapIsEmDash() {
        let label = TorqueHistoryAccessibility.pointLabel(points[2], localize: echo, locale: posix)
        XCTAssertEqual(label, "08:10: Torque —")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyTorqueHistoryTelemetry: TorqueHistoryChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
