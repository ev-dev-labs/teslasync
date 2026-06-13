//
//  BackgroundWorkSegment.ModelTests.swift
//  TeslaSync — P4 shared surface · 0177 · BackgroundWorkSegment (Apple)
//
//  State-holder coverage for ``BackgroundWorkSegmentModel``: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across every state (loading / empty / error / active), the popover
//  open state (web `useState(open)`) with the open-only-when-active guard and the close-on-drain rule (web
//  `useEffect(() => { if (!hasJobs) setOpen(false) })`), the connection axis with the one-shot stale
//  auto-refresh (re-armed on return to live) and offline keeping the cached jobs, plus the view + popover
//  composition and the strings facade. The seams + polling source live in
//  BackgroundWorkSegment.PollingTests.swift. Driven through the in-memory seams — no network, no real time.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class BackgroundWorkSegmentModelTests: XCTestCase {
    private func job(_ id: String = "1", startedAt: String = "2026-01-01T00:00:00Z") -> BackgroundJob {
        BackgroundJob(id: id, kind: .export, label: "drives.csv", description: "Processing", startedAt: startedAt)
    }

    private func makeModel(
        _ snapshot: BackgroundWorkSnapshot,
        telemetry: BackgroundWorkTelemetry = OSLogBackgroundWorkTelemetry()
    ) -> (BackgroundWorkSegmentModel, InMemoryBackgroundWorkSource) {
        let source = InMemoryBackgroundWorkSource(initial: snapshot)
        let model = BackgroundWorkSegmentModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func active(_ connection: BackgroundWorkConnection = .live) -> BackgroundWorkSnapshot {
        BackgroundWorkSnapshot(jobs: [job()], connection: connection)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyBackgroundWorkTelemetry()
        let (model, source) = makeModel(active(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .active)
        XCTAssertTrue(model.hasJobs)
        XCTAssertEqual(model.data?.count, 1)
        XCTAssertEqual(spy.surfaces, [BackgroundWorkSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyBackgroundWorkTelemetry()
        let (model, _) = makeModel(active(), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [BackgroundWorkSurface.slug])
    }

    func testEmptyLoadingErrorPhases() {
        let (empty, _) = makeModel(BackgroundWorkSnapshot())
        empty.start()
        XCTAssertEqual(empty.phase, .empty)
        XCTAssertFalse(empty.hasJobs)

        let (loading, _) = makeModel(BackgroundWorkSnapshot(isLoading: true))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (errored, _) = makeModel(BackgroundWorkSnapshot(errorMessage: "boom"))
        errored.start()
        XCTAssertEqual(errored.phase, .error("boom"))
    }

    func testPushFromLoadingToActive() {
        let (model, source) = makeModel(BackgroundWorkSnapshot(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(active())
        XCTAssertEqual(model.phase, .active)
    }

    func testTogglePopoverOpensThenCloses() {
        let (model, _) = makeModel(active())
        model.start()
        XCTAssertFalse(model.isPopoverPresented)
        model.togglePopover()
        XCTAssertTrue(model.isPopoverPresented)
        model.togglePopover()
        XCTAssertFalse(model.isPopoverPresented)
    }

    func testOpenPopoverNoOpWhenNoJobs() {
        let (model, _) = makeModel(BackgroundWorkSnapshot())
        model.start()
        model.openPopover()
        XCTAssertFalse(model.isPopoverPresented)
    }

    func testPopoverClosesWhenWorkDrains() {
        let (model, source) = makeModel(active())
        model.start()
        model.openPopover()
        XCTAssertTrue(model.isPopoverPresented)
        source.push(BackgroundWorkSnapshot())
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.isPopoverPresented)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(active())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(active(.stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(active(.stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(active())
        model.start()
        source.push(active(.stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(active())
        XCTAssertEqual(model.connection, .live)
        source.push(active(.stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedJobsAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(active())
        model.start()
        source.push(active(.offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .active)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(active())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopHaltsAndReArms() {
        let (model, source) = makeModel(active())
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }
}

// MARK: - Views + popover (every branch composes)

@MainActor
final class BackgroundWorkSegmentViewTests: XCTestCase {
    private func model(_ snapshot: BackgroundWorkSnapshot) -> BackgroundWorkSegmentModel {
        BackgroundWorkSegmentModel(source: InMemoryBackgroundWorkSource(initial: snapshot))
    }

    func testSurfaceComposesForEveryPhase() {
        let active = BackgroundWorkSnapshot(jobs: [
            BackgroundJob(id: "1", kind: .export, label: "x.csv", startedAt: "t")
        ])
        _ = BackgroundWorkSegment(model: model(BackgroundWorkSnapshot(isLoading: true)))
        _ = BackgroundWorkSegment(model: model(BackgroundWorkSnapshot()))
        _ = BackgroundWorkSegment(model: model(BackgroundWorkSnapshot(errorMessage: "x")))
        _ = BackgroundWorkSegment(model: model(active))
        _ = BackgroundWorkSegment(model: model(active), iconOnly: true)
    }

    func testProductionInitComposes() {
        _ = BackgroundWorkSegment(
            exportProbe: ScriptedExportJobsProbe([.jobs([])]),
            mutationObserver: InMemoryMutationActivityObserver(),
            customObserver: BackgroundCustomJobRegistry()
        )
    }

    func testLeafAndActiveViewsCompose() {
        _ = BackgroundWorkLoadingView()
        _ = BackgroundWorkEmptyView()
        _ = BackgroundWorkErrorView(message: "x") {}
        let data = BackgroundWorkData(jobs: [
            BackgroundJob(id: "1", kind: .mutation, label: "Saving…", startedAt: "t")
        ], count: 1)
        _ = BackgroundWorkActiveView(
            data: data, iconOnly: false, connection: .live,
            isPopoverPresented: .constant(false), onToggle: {}, onRefresh: {}
        )
        for connection in BackgroundWorkConnection.allCases {
            _ = BackgroundWorkPopoverContent(data: data, connection: connection, onRefresh: {})
            _ = BackgroundWorkFreshnessChip(connection: connection, onRefresh: {})
        }
        _ = BackgroundWorkJobRow(job: data.jobs[0])
    }
}

// MARK: - Strings facade (P1/S10) — web keys

final class BackgroundWorkStringsTests: XCTestCase {
    private func assertKey(_ key: String, _ value: String) {
        XCTAssertEqual(BackgroundWorkStrings.string(key, value), value)
    }

    func testWebKeyFallbacks() {
        assertKey("statusBar.background.one", "1 task")
        assertKey("statusBar.background.many", "{{count}} tasks")
        assertKey("statusBar.background.tooltip", "Background work in progress")
        assertKey("statusBar.background.aria", "Background tasks")
        assertKey("statusBar.background.heading", "Running")
        assertKey("statusBar.background.saving", "Saving…")
        assertKey("statusBar.background.empty", "No background work")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyBackgroundWorkTelemetry: BackgroundWorkTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
