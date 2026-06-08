//
//  LiveSignalSparklinesWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0057 · LiveSignalSparklinesWidget (Apple)
//
//  Unit coverage for the LiveSignalSparklinesWidget surface:
//    • Adapter (cached → projection) — signal selection, name spacing, numeric
//      coercion, history filtering, trend, value formatting, layout split, phase /
//      freshness / relative-time resolution (port parity with the web source).
//    • State holder — LiveSignalSparklinesModel phase/freshness/connection tracking
//      plus the P1/S11 view.opened telemetry + source wiring.
//    • Registry — canonical "live-signal-sparklines" metadata + size clamping.
//    • Accessibility — the VoiceOver row / freshness / trend copy.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by InMemoryLiveSignalSparklinesSource. The pure
//  adapter subset is additionally proven by an executed headless harness.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection

final class LiveSignalSparklinesAdapterTests: XCTestCase {
    func testSelectSignalsDefaultsWhenUnset() {
        let result = LiveSignalSparklinesBuilder.selectSignals(
            configured: nil,
            available: LiveSignalSparklinesBuilder.defaultSignals
        )
        XCTAssertEqual(result, LiveSignalSparklinesBuilder.defaultSignals)
    }

    func testSelectSignalsIntersectsConfiguredWithAvailable() {
        let result = LiveSignalSparklinesBuilder.selectSignals(
            configured: ["Alpha", "Bravo", "Charlie"],
            available: ["Bravo", "Charlie", "Delta"]
        )
        XCTAssertEqual(result, ["Bravo", "Charlie"])
    }

    func testSelectSignalsKeepsRawWhenNoAvailabilityKnown() {
        let result = LiveSignalSparklinesBuilder.selectSignals(
            configured: ["Alpha", "Bravo"],
            available: []
        )
        XCTAssertEqual(result, ["Alpha", "Bravo"])
    }

    func testSelectSignalsFallsBackToFirstAvailableWhenNoneConfiguredMatch() {
        let result = LiveSignalSparklinesBuilder.selectSignals(
            configured: ["Zulu"],
            available: ["Alpha", "Bravo"]
        )
        XCTAssertEqual(result, ["Alpha", "Bravo"])
    }

    func testSelectSignalsCapsAtMax() {
        let many = (0 ..< 10).map { "Sig\($0)" }
        let result = LiveSignalSparklinesBuilder.selectSignals(configured: many, available: many)
        XCTAssertEqual(result.count, LiveSignalSparklinesBuilder.maxSignals)
        XCTAssertEqual(result, Array(many.prefix(6)))
    }

    func testSelectSignalsEmptyConfiguredUsesFirstAvailable() {
        let result = LiveSignalSparklinesBuilder.selectSignals(
            configured: [],
            available: ["Alpha", "Bravo"]
        )
        XCTAssertEqual(result, ["Alpha", "Bravo"])
    }

    func testFormatSignalNameSpacesPascalCase() {
        XCTAssertEqual(LiveSignalSparklinesBuilder.formatSignalName("BatteryLevel"), "Battery Level")
        XCTAssertEqual(LiveSignalSparklinesBuilder.formatSignalName("OutsideTemp"), "Outside Temp")
        XCTAssertEqual(LiveSignalSparklinesBuilder.formatSignalName("Odometer"), "Odometer")
        XCTAssertEqual(LiveSignalSparklinesBuilder.formatSignalName("PackCurrent"), "Pack Current")
    }

    func testExtractNumericValueCoercesLikeWeb() {
        XCTAssertEqual(LiveSignalSparklinesBuilder.extractNumericValue(.number(42.5)), 42.5)
        XCTAssertNil(LiveSignalSparklinesBuilder.extractNumericValue(.number(.infinity)))
        XCTAssertEqual(LiveSignalSparklinesBuilder.extractNumericValue(.text("12.5")), 12.5)
        XCTAssertEqual(LiveSignalSparklinesBuilder.extractNumericValue(.text("12.5 kWh")), 12.5)
        XCTAssertNil(LiveSignalSparklinesBuilder.extractNumericValue(.text("abc")))
        XCTAssertNil(LiveSignalSparklinesBuilder.extractNumericValue(.bool(true)))
        XCTAssertNil(LiveSignalSparklinesBuilder.extractNumericValue(nil))
    }

    func testNumericPointsDropsNilAndNonFinite() {
        let history = [
            SignalHistorySample(valueNum: 1),
            SignalHistorySample(valueNum: nil),
            SignalHistorySample(valueNum: .nan),
            SignalHistorySample(valueNum: 3)
        ]
        XCTAssertEqual(LiveSignalSparklinesBuilder.numericPoints(history), [1, 3])
    }

    func testTrendUpDownFlat() {
        XCTAssertEqual(LiveSignalSparklinesBuilder.trend(for: [1, 1, 1, 1, 2, 2, 2, 10]), .up)
        XCTAssertEqual(LiveSignalSparklinesBuilder.trend(for: [10, 2, 2, 2, 1, 1, 1, 1]), .down)
        XCTAssertEqual(LiveSignalSparklinesBuilder.trend(for: [5, 5, 5, 5, 5, 5, 5, 5]), .flat)
        XCTAssertEqual(LiveSignalSparklinesBuilder.trend(for: [1, 9]), .flat)
    }

    func testFormatValueRendersDashForNil() {
        XCTAssertEqual(LiveSignalSparklinesBuilder.formatValue(nil), "—")
        XCTAssertEqual(LiveSignalSparklinesBuilder.formatValue(.nan), "—")
        XCTAssertTrue(LiveSignalSparklinesBuilder.formatValue(42).contains("42"))
    }

    func testProjectRowDerivesSparklineAndTrend() {
        let row = LiveSignalSparklinesBuilder.projectRow(
            signal: "BatteryLevel",
            colorIndex: 3,
            liveValue: .number(76.4),
            history: [SignalHistorySample(valueNum: 70), SignalHistorySample(valueNum: 76)]
        )
        XCTAssertEqual(row.displayName, "Battery Level")
        XCTAssertEqual(row.currentValue, 76.4)
        XCTAssertTrue(row.hasSparkline)
        XCTAssertEqual(row.colorIndex, 3)
        XCTAssertEqual(row.points, [70, 76])
    }

    func testProjectRowSingleSampleHasNoSparkline() {
        let row = LiveSignalSparklinesBuilder.projectRow(
            signal: "VehicleSpeed",
            colorIndex: 0,
            liveValue: nil,
            history: [SignalHistorySample(valueNum: 5)]
        )
        XCTAssertFalse(row.hasSparkline)
        XCTAssertNil(row.currentValue)
    }

    func testProjectRowsAssignsSequentialColorIndices() {
        let update = LiveSignalSparklinesUpdate(
            status: .loaded,
            availableSignals: ["Alpha", "Bravo", "Charlie"],
            configuredSignals: ["Alpha", "Bravo", "Charlie"]
        )
        let rows = LiveSignalSparklinesBuilder.projectRows(update)
        XCTAssertEqual(rows.map(\.colorIndex), [0, 1, 2])
        XCTAssertEqual(rows.map(\.signal), ["Alpha", "Bravo", "Charlie"])
    }

    func testLayoutSplit() {
        XCTAssertFalse(LiveSignalSparklinesBuilder.isWide(cols: 2))
        XCTAssertTrue(LiveSignalSparklinesBuilder.isWide(cols: 3))
        XCTAssertTrue(LiveSignalSparklinesBuilder.useTwoColumns(cols: 3, rowCount: 4))
        XCTAssertFalse(LiveSignalSparklinesBuilder.useTwoColumns(cols: 3, rowCount: 3))
        XCTAssertFalse(LiveSignalSparklinesBuilder.useTwoColumns(cols: 2, rowCount: 6))
    }

    func testResolvePhase() {
        XCTAssertEqual(LiveSignalSparklinesBuilder.resolvePhase(status: .loading, rowCount: 0), .loading)
        XCTAssertEqual(LiveSignalSparklinesBuilder.resolvePhase(status: .loaded, rowCount: 0), .empty)
        XCTAssertEqual(LiveSignalSparklinesBuilder.resolvePhase(status: .empty, rowCount: 0), .empty)
        XCTAssertEqual(LiveSignalSparklinesBuilder.resolvePhase(status: .failed("x"), rowCount: 0), .error("x"))
        XCTAssertEqual(LiveSignalSparklinesBuilder.resolvePhase(status: .loaded, rowCount: 3), .content)
        XCTAssertEqual(LiveSignalSparklinesBuilder.resolvePhase(status: .loading, rowCount: 2), .content)
    }

    func testResolveFreshnessPrecedence() {
        func freshness(
            connection: SignalConnection,
            isFetching: Bool,
            isError: Bool
        ) -> SignalFreshness {
            LiveSignalSparklinesBuilder.resolveFreshness(
                LiveSignalSparklinesUpdate(connection: connection, isFetching: isFetching, isError: isError)
            )
        }
        XCTAssertEqual(freshness(connection: .offline, isFetching: true, isError: true), .offline)
        XCTAssertEqual(freshness(connection: .live, isFetching: true, isError: true), .error)
        XCTAssertEqual(freshness(connection: .live, isFetching: true, isError: false), .fetching)
        XCTAssertEqual(freshness(connection: .stale, isFetching: false, isError: false), .stale)
        XCTAssertEqual(freshness(connection: .live, isFetching: false, isError: false), .fresh)
    }

    func testRelativeTimeBuckets() {
        let now = Date()
        XCTAssertTrue(LiveSignalSparklinesBuilder.relativeTime(since: now, now: now).contains("just"))
        XCTAssertTrue(
            LiveSignalSparklinesBuilder.relativeTime(since: now.addingTimeInterval(-120), now: now).contains("2m")
        )
        XCTAssertTrue(
            LiveSignalSparklinesBuilder.relativeTime(since: now.addingTimeInterval(-7200), now: now).contains("2h")
        )
        XCTAssertTrue(
            LiveSignalSparklinesBuilder.relativeTime(since: now.addingTimeInterval(-172_800), now: now).contains("2d")
        )
        XCTAssertTrue(
            LiveSignalSparklinesBuilder.relativeTime(since: now.addingTimeInterval(-691_200), now: now).contains("1w")
        )
    }
}

// MARK: - State holder: phase / freshness / telemetry / wiring

@MainActor
final class LiveSignalSparklinesModelTests: XCTestCase {
    private func makeModel(
        _ update: LiveSignalSparklinesUpdate,
        telemetry: LiveSignalSparklinesTelemetry = OSLogLiveSignalSparklinesTelemetry()
    ) -> (LiveSignalSparklinesModel, InMemoryLiveSignalSparklinesSource) {
        let source = InMemoryLiveSignalSparklinesSource(initial: update)
        let model = LiveSignalSparklinesModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutSignalsShowsLoading() {
        let (model, _) = makeModel(LiveSignalSparklinesUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutSignalsShowsEmpty() {
        let (model, _) = makeModel(
            LiveSignalSparklinesUpdate(status: .loaded, availableSignals: [], configuredSignals: [])
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutSignalsShowsError() {
        let (model, _) = makeModel(
            LiveSignalSparklinesUpdate(status: .failed("boom"), availableSignals: [], configuredSignals: [])
        )
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testSignalsPresentShowContent() {
        let (model, _) = makeModel(
            LiveSignalSparklinesUpdate(
                status: .loaded,
                availableSignals: ["BatteryLevel"],
                configuredSignals: ["BatteryLevel"]
            )
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertEqual(model.rows.first?.displayName, "Battery Level")
    }

    func testFreshnessTracksUpdate() {
        let (model, source) = makeModel(LiveSignalSparklinesUpdate(status: .loading))
        model.start()
        source.push(LiveSignalSparklinesUpdate(status: .loaded, connection: .offline, updatedAt: Date()))
        XCTAssertEqual(model.freshness, .offline)
        XCTAssertEqual(model.connection, .offline)

        source.push(LiveSignalSparklinesUpdate(status: .loaded, isError: true))
        XCTAssertEqual(model.freshness, .error)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyLiveSignalSparklinesTelemetry()
        let (model, source) = makeModel(LiveSignalSparklinesUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LiveSignalSparklinesWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(LiveSignalSparklinesUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testProjectionTracksUpdates() {
        let (model, source) = makeModel(LiveSignalSparklinesUpdate(status: .loading))
        model.start()
        let stamp = Date()
        source.push(
            LiveSignalSparklinesUpdate(
                status: .loaded,
                connection: .live,
                availableSignals: ["VehicleSpeed", "OutsideTemp"],
                configuredSignals: ["VehicleSpeed", "OutsideTemp"],
                liveValues: ["VehicleSpeed": .number(31)],
                histories: ["OutsideTemp": [SignalHistorySample(valueNum: 18), SignalHistorySample(valueNum: 19)]],
                updatedAt: stamp
            )
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.rows.count, 2)
        XCTAssertEqual(model.rows.first?.currentValue, 31)
        XCTAssertTrue(model.rows.last?.hasSparkline ?? false)
        XCTAssertEqual(model.updatedAt, stamp)
    }
}

// MARK: - Registry parity

final class LiveSignalSparklinesRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = LiveSignalSparklinesWidget.registration
        XCTAssertEqual(registration.id, "live-signal-sparklines")
        XCTAssertEqual(registration.category, "telemetry")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = LiveSignalSparklinesWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)),
            DashboardWidgetSize(cols: 2, rows: 4)
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

    func testSurfaceSlugMatchesDiagnosticsContract() {
        XCTAssertEqual(LiveSignalSparklinesWidget.surfaceSlug, "LiveSignalSparklinesWidget")
    }
}

// MARK: - Accessibility copy

final class LiveSignalSparklinesAccessibilityTests: XCTestCase {
    func testRowLabelIncludesNameValueAndTrend() {
        let row = SignalRowProjection(
            signal: "BatteryLevel",
            displayName: "Battery Level",
            currentValue: 76,
            points: [70, 76],
            hasSparkline: true,
            trend: .up,
            colorIndex: 0
        )
        let label = LiveSignalSparklinesAccessibility.rowLabel(for: row)
        XCTAssertTrue(label.contains("Battery Level"))
        XCTAssertTrue(label.contains("76"))
        XCTAssertTrue(label.contains("trending up"))
    }

    func testRowLabelHandlesMissingValue() {
        let row = SignalRowProjection(
            signal: "PackCurrent",
            displayName: "Pack Current",
            currentValue: nil,
            points: [],
            hasSparkline: false,
            trend: .flat,
            colorIndex: 1
        )
        let label = LiveSignalSparklinesAccessibility.rowLabel(for: row)
        XCTAssertTrue(label.contains("—"))
        XCTAssertTrue(label.contains("holding steady"))
    }

    func testFreshnessAndTrendCopy() {
        XCTAssertEqual(LiveSignalSparklinesAccessibility.freshnessLabel(.offline), "Offline")
        XCTAssertEqual(LiveSignalSparklinesAccessibility.freshnessLabel(.fresh), "Live")
        XCTAssertEqual(LiveSignalSparklinesAccessibility.trendPhrase(.down), "trending down")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLiveSignalSparklinesTelemetry: LiveSignalSparklinesTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
