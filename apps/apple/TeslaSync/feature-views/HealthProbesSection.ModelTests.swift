//
//  HealthProbesSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0244 · HealthProbesSection (Apple)
//
//  State-holder coverage for `HealthProbesModel`: phase across loading / content /
//  empty / error, the liveness + readiness card + header-badge projection, the P1/S11
//  `view.opened` telemetry (once), the silent error retry, the one-shot stale auto-
//  refresh (re-armed on live), and offline keeping the cached snapshot. Driven through
//  in-memory sources; no network, no bundle. Fixtures live in `.Tests`.
//

import XCTest
@testable import TeslaSync

@MainActor final class HealthProbesModelTests: XCTestCase {
    private func makeModel(
        initial: HealthProbesUpdate?,
        telemetry: HealthProbesTelemetry = SpyHealthProbesTelemetry()
    ) -> (HealthProbesModel, InMemoryHealthProbesSource) {
        let source = InMemoryHealthProbesSource(initial: initial)
        let model = HealthProbesModel(source: source, telemetry: telemetry, locale: Locale(identifier: "en_US"))
        return (model, source)
    }

    func testLoadedContentProjectsCardsBadgesAndPhase() {
        let (model, source) = makeModel(initial: HealthProbesFixture.loaded())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.cards.count, 2)
        XCTAssertEqual(model.cards.map(\.titleKey), ["Liveness — /healthz", "Readiness — /readyz"])
        XCTAssertEqual(model.headerBadges.map(\.labelKey), ["Live", "Ready"])
        XCTAssertTrue(model.hasHealth)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedWithNoHealthResolvesEmpty() {
        let (model, _) = makeModel(initial: HealthProbesUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.cards.isEmpty)
        XCTAssertTrue(model.headerBadges.isEmpty)
        XCTAssertFalse(model.hasHealth)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: HealthProbesUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.headerBadges.isEmpty)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: HealthProbesUpdate(status: .failed("timeout")))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyHealthProbesTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [HealthProbesSurface.slug])
    }

    func testRetryIsSilentRefresh() {
        let (model, source) = makeModel(initial: HealthProbesUpdate(status: .failed("x")))
        model.start()
        model.retry()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(HealthProbesFixture.loaded(connection: .stale))
        source.push(HealthProbesFixture.loaded(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(HealthProbesFixture.loaded(connection: .stale))
        source.push(HealthProbesFixture.loaded(connection: .live))
        source.push(HealthProbesFixture.loaded(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedSnapshotWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(HealthProbesFixture.loaded(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.cards.count, 2)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testAccessibilitySummaryReflectsStatuses() {
        let (model, _) = makeModel(initial: HealthProbesFixture.loaded())
        model.start()
        XCTAssertEqual(model.accessibilitySummary, "Health Probes: Live ok, Ready ready")
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Test doubles

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyHealthProbesTelemetry: HealthProbesTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
