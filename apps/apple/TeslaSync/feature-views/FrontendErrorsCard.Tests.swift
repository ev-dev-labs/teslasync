//
//  FrontendErrorsCard.Tests.swift
//  TeslaSync — P4 feature view · 0243 · FrontendErrorsCard (Apple)
//
//  Unit coverage for the FrontendErrorsCard surface:
//    • State holder — `FrontendErrorsProjection` across loading / error / empty / data (the headline
//      total + the offender name/route/count mapping + stable ids), plus the `FrontendErrorsModel`
//      wiring, the P1/S11 `view.opened` telemetry, and the stale auto-refresh.
//    • Accessibility — the VoiceOver headline + offender label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryFrontendErrorsSource`, and the locale is injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private let sampleSummary = FrontendErrorsSummary(
    total: 1234,
    top: [
        FrontendErrorEntry(name: "DriveChart", route: "/drives/4821", count: 312),
        FrontendErrorEntry(name: "BatteryPanel", route: "/battery", count: 87)
    ]
)

// MARK: - Projection phases

@MainActor final class FrontendErrorsProjectionPhaseTests: XCTestCase {
    func testLoadingOnlyWhenNoSummary() {
        let loading = FrontendErrorsProjection.resolve(FrontendErrorsInput(isLoading: true), locale: enUS)
        XCTAssertEqual(loading.phase, .loading)
        // A background refetch with cached data present is NOT the loading branch — it renders data.
        let withData = FrontendErrorsProjection.resolve(
            FrontendErrorsInput(summary: sampleSummary, isLoading: true),
            locale: enUS
        )
        XCTAssertEqual(withData.phase, .data)
    }

    func testExplicitErrorMessageTakesPrecedence() {
        let resolved = FrontendErrorsProjection.resolve(
            FrontendErrorsInput(summary: sampleSummary, errorMessage: "boom"),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testMissingSummaryResolvesToUnableToLoadError() {
        let resolved = FrontendErrorsProjection.resolve(FrontendErrorsInput(summary: nil), locale: enUS)
        guard case let .error(message) = resolved.phase else {
            return XCTFail("expected error phase")
        }
        XCTAssertTrue(message.contains("Unable to load"))
    }

    func testEmptyWhenSummaryHasNoOffenders() {
        let resolved = FrontendErrorsProjection.resolve(
            FrontendErrorsInput(summary: FrontendErrorsSummary(total: 0, top: [])),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.totalText, "0")
        XCTAssertTrue(resolved.offenders.isEmpty)
    }

    func testDataWhenOffendersPresent() {
        let resolved = FrontendErrorsProjection.resolve(FrontendErrorsInput(summary: sampleSummary), locale: enUS)
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.totalText, "1,234")
        XCTAssertEqual(resolved.offenders.count, 2)
    }
}

// MARK: - Projection offender mapping (web `top.map`)

@MainActor final class FrontendErrorsProjectionOffenderTests: XCTestCase {
    func testOffenderValuesAndFormatting() {
        let resolved = FrontendErrorsProjection.resolve(FrontendErrorsInput(summary: sampleSummary), locale: enUS)
        XCTAssertEqual(resolved.offenders.map(\.name), ["DriveChart", "BatteryPanel"])
        XCTAssertEqual(resolved.offenders.map(\.route), ["/drives/4821", "/battery"])
        XCTAssertEqual(resolved.offenders.map(\.count), ["312", "87"])
    }

    func testOffenderNameAndRouteFallBackToDash() {
        let summary = FrontendErrorsSummary(total: 5, top: [FrontendErrorEntry(name: "", route: "", count: 5)])
        let resolved = FrontendErrorsProjection.resolve(FrontendErrorsInput(summary: summary), locale: enUS)
        let offender = try? XCTUnwrap(resolved.offenders.first)
        XCTAssertEqual(offender?.name, "—")
        XCTAssertEqual(offender?.route, "—")
        XCTAssertEqual(offender?.count, "5")
    }

    func testOffenderIdsAreStableAcrossDuplicates() {
        let summary = FrontendErrorsSummary(
            total: 4,
            top: [
                FrontendErrorEntry(name: "Same", route: "/x", count: 2),
                FrontendErrorEntry(name: "Same", route: "/x", count: 2)
            ]
        )
        let resolved = FrontendErrorsProjection.resolve(FrontendErrorsInput(summary: summary), locale: enUS)
        XCTAssertEqual(resolved.offenders.map(\.id), ["Same|/x|0", "Same|/x|1"])
    }

    func testLargeCountGroupsWithSeparator() {
        let summary = FrontendErrorsSummary(
            total: 12345,
            top: [FrontendErrorEntry(name: "A", route: "/a", count: 9876)]
        )
        let resolved = FrontendErrorsProjection.resolve(FrontendErrorsInput(summary: summary), locale: enUS)
        XCTAssertEqual(resolved.totalText, "12,345")
        XCTAssertEqual(resolved.offenders.first?.count, "9,876")
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor final class FrontendErrorsModelTests: XCTestCase {
    private func makeModel(
        _ input: FrontendErrorsInput,
        telemetry: FrontendErrorsTelemetry = OSLogFrontendErrorsTelemetry()
    ) -> (FrontendErrorsModel, InMemoryFrontendErrorsSource) {
        let source = InMemoryFrontendErrorsSource(initial: input)
        let model = FrontendErrorsModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyFrontendErrorsTelemetry()
        let (model, source) = makeModel(FrontendErrorsInput(summary: sampleSummary), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.offenders.count, 2)
        XCTAssertEqual(spy.surfaces, [FrontendErrorsCard.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(FrontendErrorsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(FrontendErrorsInput(summary: sampleSummary))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.totalText, "1,234")
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(FrontendErrorsInput(summary: sampleSummary))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(FrontendErrorsInput(summary: sampleSummary, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(FrontendErrorsInput(summary: sampleSummary, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(FrontendErrorsInput(summary: sampleSummary))
        model.start()
        source.push(FrontendErrorsInput(summary: sampleSummary, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testLiveResetsStaleAutoRefreshArming() {
        let (model, source) = makeModel(FrontendErrorsInput(summary: sampleSummary))
        model.start()
        source.push(FrontendErrorsInput(summary: sampleSummary, connection: .stale)) // refresh 1
        source.push(FrontendErrorsInput(summary: sampleSummary, connection: .live)) // re-arm
        source.push(FrontendErrorsInput(summary: sampleSummary, connection: .stale)) // refresh 2
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(FrontendErrorsInput(summary: sampleSummary))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(FrontendErrorsInput(summary: sampleSummary))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(FrontendErrorsCard.surfaceSlug, "FrontendErrorsCard")
    }
}

// MARK: - Accessibility summary

@MainActor final class FrontendErrorsModelAccessibilityTests: XCTestCase {
    func testHeadlineLabelComposition() {
        XCTAssertEqual(
            FrontendErrorsAccessibility.headline("0", "reported by browser sessions"),
            "0 reported by browser sessions"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyFrontendErrorsTelemetry: FrontendErrorsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
