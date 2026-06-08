//
//  TimeToChargeSection.StateTests.swift
//  TeslaSync — P4 feature view · 0094 · TimeToChargeSection (Apple)
//
//  Lifecycle coverage for the TimeToChargeSection surface: the presentation
//  resolver across every state (loading / empty / offline / error / stale /
//  content, keeping cached sessions visible), the web-prop → load-state mapping,
//  the responsive column math, the per-card VoiceOver content, the P1/S11
//  `view.opened` telemetry, and the model start/refresh/stop delegation. The
//  adapter/data tests live in `TimeToChargeSection.Tests.swift` (which also owns
//  the shared `TimeToChargeFixture`).
//

import XCTest
@testable import TeslaSync

// MARK: - Presentation resolver (every state)

@MainActor final class TimeToChargePresentationTests: XCTestCase {
    func testIdleIsLoading() {
        XCTAssertEqual(TimeToChargePresentation.resolve(state: .idle), .loading)
    }

    func testLoadingWithoutCacheIsLoading() {
        XCTAssertEqual(
            TimeToChargePresentation.resolve(state: .loading(cached: nil, stale: false)),
            .loading
        )
    }

    func testLoadingWithCacheIsRefreshingContent() {
        let state: TimeToChargeLoadState<[TimeToChargeSectionChargingSessionSummary]> =
            .loading(cached: TimeToChargeFixture.all, stale: false)
        guard case let .content(content) =
            TimeToChargePresentation.resolve(state: state, locale: timeToChargeEnUS)
        else {
            return XCTFail("expected content")
        }
        XCTAssertTrue(content.refreshing)
        XCTAssertEqual(content.freshness, .live)
        XCTAssertEqual(content.cards.count, 4)
    }

    func testLoadedEmptyIsEmpty() {
        XCTAssertEqual(
            TimeToChargePresentation.resolve(state: .loaded([], stale: false)),
            .empty
        )
    }

    func testLoadedStaleIsStaleContent() {
        let state: TimeToChargeLoadState<[TimeToChargeSectionChargingSessionSummary]> =
            .loaded(TimeToChargeFixture.all, stale: true)
        guard case let .content(content) =
            TimeToChargePresentation.resolve(state: state, locale: timeToChargeEnUS)
        else {
            return XCTFail("expected content")
        }
        XCTAssertEqual(content.freshness, .stale)
        XCTAssertFalse(content.refreshing)
    }

    func testEmptyStateIsEmpty() {
        XCTAssertEqual(
            TimeToChargePresentation.resolve(state: .empty(stale: false)),
            .empty
        )
    }

    func testOfflineWithCacheKeepsContentOffline() {
        let state: TimeToChargeLoadState<[TimeToChargeSectionChargingSessionSummary]> =
            .failed(.offline, cached: TimeToChargeFixture.all, stale: true)
        guard case let .content(content) =
            TimeToChargePresentation.resolve(state: state, locale: timeToChargeEnUS)
        else {
            return XCTFail("expected content")
        }
        XCTAssertEqual(content.freshness, .offline)
    }

    func testOfflineWithoutCacheIsOfflineNoData() {
        XCTAssertEqual(
            TimeToChargePresentation.resolve(state: .failed(.offline, cached: nil, stale: false)),
            .offlineNoData
        )
    }

    func testRetryableErrorWithoutCacheIsError() {
        XCTAssertEqual(
            TimeToChargePresentation.resolve(
                state: .failed(.network(message: "x"), cached: nil, stale: false)
            ),
            .error(retryable: true)
        )
    }

    func testNonRetryableDecodeErrorIsError() {
        XCTAssertEqual(
            TimeToChargePresentation.resolve(
                state: .failed(.decode(message: "x"), cached: nil, stale: false)
            ),
            .error(retryable: false)
        )
    }

    func testErrorWithCacheKeepsContent() {
        let state: TimeToChargeLoadState<[TimeToChargeSectionChargingSessionSummary]> =
            .failed(.network(message: "x"), cached: TimeToChargeFixture.all, stale: false)
        guard case let .content(content) =
            TimeToChargePresentation.resolve(state: state, locale: timeToChargeEnUS)
        else {
            return XCTFail("expected content")
        }
        XCTAssertEqual(content.freshness, .live)
    }
}

// MARK: - Web-prop → load-state mapping

@MainActor final class TimeToChargeLoadStateMappingTests: XCTestCase {
    func testLoadingWithSessionsKeepsCache() {
        let state = TimeToChargeModel.loadState(sessions: TimeToChargeFixture.all, loading: true)
        guard case let .loading(cached, stale) = state else { return XCTFail("expected loading") }
        XCTAssertEqual(cached?.count, 4)
        XCTAssertFalse(stale)
    }

    func testLoadingWithoutSessionsHasNoCache() {
        let state = TimeToChargeModel.loadState(sessions: [], loading: true)
        guard case let .loading(cached, _) = state else { return XCTFail("expected loading") }
        XCTAssertNil(cached)
    }

    func testResolvedEmptyBecomesEmpty() {
        let state = TimeToChargeModel.loadState(sessions: [], loading: false)
        guard case .empty = state else { return XCTFail("expected empty") }
    }

    func testResolvedSessionsBecomeLoaded() {
        let state = TimeToChargeModel.loadState(sessions: TimeToChargeFixture.all, loading: false)
        guard case let .loaded(sessions, _) = state else { return XCTFail("expected loaded") }
        XCTAssertEqual(sessions.count, 4)
    }
}

// MARK: - Layout

@MainActor final class TimeToChargeLayoutTests: XCTestCase {
    func testColumnsAtBreakpoints() {
        XCTAssertEqual(TimeToChargeLayout.columnCount(forWidth: 375), 2)
        XCTAssertEqual(TimeToChargeLayout.columnCount(forWidth: 1023), 2)
        XCTAssertEqual(TimeToChargeLayout.columnCount(forWidth: 1024), 4)
        XCTAssertEqual(TimeToChargeLayout.columnCount(forWidth: 1440), 4)
    }
}

// MARK: - Accessibility

@MainActor final class TimeToChargeAccessibilityTests: XCTestCase {
    func testCardLabelWithValueUnitAndSubtitle() {
        XCTAssertEqual(
            TimeToChargeAccessibility.cardLabel(
                label: "Fastest Session", value: "120.00", unit: "kWh/h", subtitle: "Session #303"
            ),
            "Fastest Session, 120.00 kWh/h, Session #303"
        )
    }

    func testCardLabelWithoutValueUsesDash() {
        XCTAssertEqual(
            TimeToChargeAccessibility.cardLabel(
                label: "10% → 80%", value: nil, unit: "min", subtitle: "Avg duration"
            ),
            "10% → 80%, —, Avg duration"
        )
    }
}

// MARK: - Telemetry

@MainActor final class TimeToChargeTelemetryTests: XCTestCase {
    func testViewOpenedEventCarriesSlug() {
        XCTAssertEqual(TimeToChargeSection.surfaceSlug, "TimeToChargeSection")
        XCTAssertEqual(
            TimeToChargeSection.viewOpenedEvent,
            .viewOpened(surface: "TimeToChargeSection")
        )
    }

    @MainActor
    func testBufferedSinkRecordsViewOpened() {
        let sink = BufferedDashboardWidgetTelemetry()
        sink.record(TimeToChargeSection.viewOpenedEvent)
        XCTAssertEqual(sink.events.count, 1)
        XCTAssertEqual(sink.events.first?.name, "view.opened")
        XCTAssertEqual(sink.events.first?.surface, "TimeToChargeSection")
    }
}

// MARK: - Model wiring

@MainActor final class TimeToChargeModelTests: XCTestCase {
    func testStartDelegatesToSourceOnce() {
        let source = InMemoryTimeToChargeSource(initial: .loaded(TimeToChargeFixture.all, stale: false))
        let model = TimeToChargeModel(source: source, locale: timeToChargeEnUS)
        model.start()
        model.start()
        XCTAssertEqual(source.startCount, 1)
        guard case .content = model.presentation else { return XCTFail("expected content") }
    }

    func testPushUpdatesPresentation() {
        let source = InMemoryTimeToChargeSource(initial: .idle)
        let model = TimeToChargeModel(source: source, locale: timeToChargeEnUS)
        model.start()
        XCTAssertEqual(model.presentation, .loading)
        source.push(.loaded([], stale: false))
        XCTAssertEqual(model.presentation, .empty)
    }

    func testRefreshAndStopDelegate() {
        let source = InMemoryTimeToChargeSource(initial: .loaded(TimeToChargeFixture.all, stale: false))
        let model = TimeToChargeModel(source: source, locale: timeToChargeEnUS)
        model.start()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
        // After stop, start re-arms the source subscription.
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testWebPropInitMapsSessions() {
        let model = TimeToChargeModel(sessions: TimeToChargeFixture.all, loading: false, locale: timeToChargeEnUS)
        guard case let .content(content) = model.presentation else { return XCTFail("expected content") }
        XCTAssertEqual(content.cards.count, 4)
    }
}
