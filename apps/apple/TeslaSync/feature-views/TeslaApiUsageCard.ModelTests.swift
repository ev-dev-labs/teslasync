//
//  TeslaApiUsageCard.ModelTests.swift
//  TeslaSync — P4 feature view · 0257 · TeslaApiUsageCard (Apple)
//
//  State-holder coverage for `TeslaApiUsageModel`: the source wiring + projection refresh, the
//  P1/S11 `view.opened` telemetry (emitted once on first presentation), the stale one-shot
//  auto-refresh + re-arm, the offline no-refresh rule, and the footer navigation seam. Driven by
//  `InMemoryTeslaApiUsageSource`; no network, no real store. Locale + calendar injected for
//  determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func utcCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? calendar.timeZone
    return calendar
}

private let modelUsage = TeslaApiUsage(
    totalRequests: 84210,
    skippedPolls: 12040,
    estimatedCost: 3.20,
    costPerRequest: 0.00005,
    monthlyCredit: 5.00
)

@MainActor final class TeslaApiUsageModelTests: XCTestCase {
    private func makeModel(
        _ input: TeslaApiUsageInput,
        telemetry: TeslaApiUsageTelemetry = OSLogTeslaApiUsageTelemetry(),
        navigator: TeslaApiUsageNavigator = OSLogTeslaApiUsageNavigator()
    ) -> (TeslaApiUsageModel, InMemoryTeslaApiUsageSource) {
        let source = InMemoryTeslaApiUsageSource(initial: input)
        let model = TeslaApiUsageModel(
            source: source,
            telemetry: telemetry,
            navigator: navigator,
            locale: enUS,
            calendar: utcCalendar()
        )
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyTeslaApiUsageTelemetry()
        let (model, source) = makeModel(TeslaApiUsageInput(usage: modelUsage), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.bands.count, 3)
        XCTAssertEqual(spy.surfaces, [TeslaApiUsageCard.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testTelemetryEmitsOnceAcrossPushes() {
        let spy = SpyTeslaApiUsageTelemetry()
        let (model, source) = makeModel(TeslaApiUsageInput(isLoading: true), telemetry: spy)
        model.start()
        XCTAssertEqual(spy.surfaces, [TeslaApiUsageCard.surfaceSlug])
        source.push(TeslaApiUsageInput(usage: modelUsage))
        source.push(TeslaApiUsageInput(usage: modelUsage, connection: .live))
        XCTAssertEqual(spy.surfaces, [TeslaApiUsageCard.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(TeslaApiUsageInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(TeslaApiUsageInput(usage: modelUsage))
        XCTAssertEqual(model.phase, .data)
        XCTAssertNotNil(model.budget)
        XCTAssertEqual(model.footer.count, 2)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(TeslaApiUsageInput(usage: modelUsage))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(TeslaApiUsageInput(usage: modelUsage, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(TeslaApiUsageInput(usage: modelUsage, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(TeslaApiUsageInput(usage: modelUsage))
        model.start()
        source.push(TeslaApiUsageInput(usage: modelUsage, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(TeslaApiUsageInput(usage: modelUsage))
        model.start()
        source.push(TeslaApiUsageInput(usage: modelUsage, connection: .stale)) // refresh 1
        source.push(TeslaApiUsageInput(usage: modelUsage, connection: .live)) // re-arm
        source.push(TeslaApiUsageInput(usage: modelUsage, connection: .stale)) // refresh 2
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(TeslaApiUsageInput(usage: modelUsage))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(TeslaApiUsageInput(usage: modelUsage))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testOpenRouteDelegatesToNavigator() {
        let spy = SpyTeslaApiUsageNavigator()
        let (model, _) = makeModel(TeslaApiUsageInput(usage: modelUsage), navigator: spy)
        model.start()
        model.open(route: "/api-logs")
        model.open(route: "/tesla-account")
        XCTAssertEqual(spy.routes, ["/api-logs", "/tesla-account"])
    }

    func testSurfaceSlug() {
        XCTAssertEqual(TeslaApiUsageCard.surfaceSlug, "TeslaApiUsageCard")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyTeslaApiUsageTelemetry: TeslaApiUsageTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records navigated routes so the footer navigation contract can be asserted.
private final class SpyTeslaApiUsageNavigator: TeslaApiUsageNavigator, @unchecked Sendable {
    private(set) var routes: [String] = []
    func open(route: String) {
        routes.append(route)
    }
}
