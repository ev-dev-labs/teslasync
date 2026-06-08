//
//  AnomalyInlineRow.ModelTests.swift
//  TeslaSync — P4 feature view · 0238 · AnomalyInlineRow (Apple)
//
//  State-holder coverage for `AnomalyInlineRowModel`: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the phase transitions across loading / loaded-renderable /
//  loaded-dormant / failed (incl. the cached-row survival), the deterministic relative
//  time via the injected clock, the click-through activation seam (web `to`), the stale
//  auto-refresh (once, re-armed on return to live), offline keeping the cached row, and
//  the per-phase VoiceOver summary. Driven through the in-memory source — no network.
//
//  Gated on `canImport(XCTest)` for the same app-target / test-bundle membership reason
//  as the adapter tests.
//

#if canImport(XCTest)
    import Foundation
    import XCTest
    @testable import TeslaSync

    /// Identity localizer so assertions read the real copy / templates without a bundle.
    private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

    private enum SampleAnomaly {
        static let now = Date(timeIntervalSince1970: 1_717_000_000)

        static func entry(
            signal: String = "battery_temp",
            severity: AnomalySeverity = .critical,
            secondsAgo: TimeInterval = 300
        ) -> AnomalyEntryItem {
            AnomalyEntryItem(
                signal: signal,
                type: .zScore,
                severity: severity,
                detectedAt: now.addingTimeInterval(-secondsAgo),
                message: "deviation"
            )
        }

        static func data(count: Int = 3) -> AnomalyData {
            AnomalyData(anomalies: [entry()], anomaliesLast24h: count)
        }
    }

    /// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable`
    /// telemetry seam under Swift 6 strict concurrency.
    private final class SpyAnomalyInlineRowTelemetry: AnomalyInlineRowTelemetry, @unchecked Sendable {
        private let lock = NSLock()
        private var storage: [String] = []

        func viewOpened(surface: String) {
            lock.lock()
            storage.append(surface)
            lock.unlock()
        }

        var surfaces: [String] {
            lock.lock()
            defer { lock.unlock() }
            return storage
        }
    }

    /// Records the destinations passed to the activation seam (web `to`).
    @MainActor
    private final class ActivationRecorder {
        private(set) var paths: [String] = []

        func record(_ destination: AnomalyInlineRowDestination) {
            paths.append(destination.path)
        }
    }

    @MainActor
    final class AnomalyInlineRowModelTests: XCTestCase {
        private func makeModel(
            source: InMemoryAnomalyInlineRowSource,
            telemetry: SpyAnomalyInlineRowTelemetry = SpyAnomalyInlineRowTelemetry(),
            onActivate: @escaping @MainActor (AnomalyInlineRowDestination) -> Void = { _ in }
        ) -> AnomalyInlineRowModel {
            AnomalyInlineRowModel(
                source: source,
                telemetry: telemetry,
                localize: passthroughLocalize,
                now: { SampleAnomaly.now },
                onActivate: onActivate
            )
        }

        func testStartEmitsViewOpenedOnceAndIsIdempotent() {
            let spy = SpyAnomalyInlineRowTelemetry()
            let source = InMemoryAnomalyInlineRowSource()
            let model = makeModel(source: source, telemetry: spy)
            model.start()
            model.start()
            XCTAssertEqual(spy.surfaces, ["AnomalyInlineRow"])
            XCTAssertEqual(source.startCount, 1)
        }

        func testLoadingThenContent() {
            let source = InMemoryAnomalyInlineRowSource(initial: AnomalyInlineRowUpdate(status: .loading))
            let model = makeModel(source: source)
            model.start()
            XCTAssertEqual(model.phase, .loading)
            source.push(AnomalyInlineRowUpdate(status: .loaded, data: SampleAnomaly.data()))
            XCTAssertEqual(model.content?.status, .unhealthy)
            XCTAssertEqual(model.content?.summary, "3 in 24h · battery_temp 5m ago")
        }

        func testLoadedDormantResolvesEmpty() {
            let source = InMemoryAnomalyInlineRowSource(
                initial: AnomalyInlineRowUpdate(status: .loaded, data: SampleAnomaly.data(count: 0))
            )
            let model = makeModel(source: source)
            model.start()
            XCTAssertEqual(model.phase, .empty)
            XCTAssertNil(model.content)
        }

        func testFailedNoDataResolvesError() {
            let source = InMemoryAnomalyInlineRowSource(initial: AnomalyInlineRowUpdate(status: .failed("timeout")))
            let model = makeModel(source: source)
            model.start()
            XCTAssertEqual(model.phase, .error("timeout"))
        }

        func testFailedWithCachedDataKeepsContent() {
            let source = InMemoryAnomalyInlineRowSource(
                initial: AnomalyInlineRowUpdate(status: .loaded, data: SampleAnomaly.data())
            )
            let model = makeModel(source: source)
            model.start()
            source.push(AnomalyInlineRowUpdate(status: .failed("stale read"), data: SampleAnomaly.data()))
            XCTAssertNotNil(model.content)
        }

        func testActivateRoutesThroughSeam() {
            let recorder = ActivationRecorder()
            let source = InMemoryAnomalyInlineRowSource(
                initial: AnomalyInlineRowUpdate(status: .loaded, data: SampleAnomaly.data())
            )
            let model = makeModel(source: source, onActivate: { recorder.record($0) })
            model.start()
            model.activate(.anomalyDetection)
            XCTAssertEqual(recorder.paths, ["/anomaly-detection"])
        }

        func testRefreshCallsSeam() {
            let source = InMemoryAnomalyInlineRowSource(initial: AnomalyInlineRowUpdate(status: .failed("boom")))
            let model = makeModel(source: source)
            model.start()
            model.refresh()
            XCTAssertEqual(source.refreshCount, 1)
        }

        func testStaleAutoRefreshesOnceThenReArms() {
            let source = InMemoryAnomalyInlineRowSource(
                initial: AnomalyInlineRowUpdate(status: .loaded, data: SampleAnomaly.data())
            )
            let model = makeModel(source: source)
            model.start()
            XCTAssertEqual(source.refreshCount, 0)
            source.push(AnomalyInlineRowUpdate(status: .loaded, data: SampleAnomaly.data(), connection: .stale))
            source.push(AnomalyInlineRowUpdate(status: .loaded, data: SampleAnomaly.data(), connection: .stale))
            XCTAssertEqual(source.refreshCount, 1)
            source.push(AnomalyInlineRowUpdate(status: .loaded, data: SampleAnomaly.data(), connection: .live))
            source.push(AnomalyInlineRowUpdate(status: .loaded, data: SampleAnomaly.data(), connection: .stale))
            XCTAssertEqual(source.refreshCount, 2)
        }

        func testOfflineKeepsContentAndDoesNotRefresh() {
            let source = InMemoryAnomalyInlineRowSource(
                initial: AnomalyInlineRowUpdate(status: .loaded, data: SampleAnomaly.data())
            )
            let model = makeModel(source: source)
            model.start()
            source.push(AnomalyInlineRowUpdate(status: .loaded, data: SampleAnomaly.data(), connection: .offline))
            XCTAssertEqual(model.connection, .offline)
            XCTAssertNotNil(model.content)
            XCTAssertEqual(source.refreshCount, 0)
        }

        func testAccessibilitySummaryPerPhase() {
            let source = InMemoryAnomalyInlineRowSource(initial: AnomalyInlineRowUpdate(status: .loading))
            let model = makeModel(source: source)
            model.start()
            XCTAssertEqual(model.accessibilitySummary, "Checking for anomalies…")

            source.push(AnomalyInlineRowUpdate(status: .loaded, data: SampleAnomaly.data()))
            XCTAssertEqual(model.accessibilitySummary, "Anomalies — 3 in 24h · battery_temp 5m ago")

            source.push(AnomalyInlineRowUpdate(status: .loaded, data: SampleAnomaly.data(count: 0)))
            XCTAssertEqual(model.accessibilitySummary, "Anomalies — No anomalies in the last 24h")

            source.push(AnomalyInlineRowUpdate(status: .failed("boom")))
            XCTAssertEqual(model.accessibilitySummary, "Couldn't load anomalies: boom")
        }
    }
#endif
