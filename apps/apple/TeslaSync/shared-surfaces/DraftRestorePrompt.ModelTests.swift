//
//  DraftRestorePrompt.ModelTests.swift
//  TeslaSync — P4 shared surface · 0117 · DraftRestorePrompt (Apple)
//
//  State-holder coverage for `DraftRestorePromptModel`:
//    • start — emits the `view.opened` telemetry once (idempotent) and starts the source.
//    • apply — drives the render phase + the connectivity axis from a pushed snapshot.
//    • review / dismiss — open the modal; dismiss writes the per-session guard, closes the modal, hides
//      the card (web `handleReview` / `handleDismiss`).
//    • resume — dismisses then hands the host the entry + the normalised route (web `handleResume` →
//      `navigate(entry.route)`).
//    • discard — drops the row + notifies the source; collapses the prompt when the list empties (web
//      `handleDiscard`).
//    • isPromptVisible — the web `showPrompt && !reviewOpen` gate.
//    • stale auto-refresh — fires once on the stale transition; guarded by connection + isFetching.
//    • stop — stops the source.
//
//  Driven through the in-memory source; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Spies

private final class SpyDraftRestoreTelemetry: DraftRestoreTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var opened: [String] = []

    var openedSurfaces: [String] {
        lock.withLock { opened }
    }

    func viewOpened(surface: String) {
        lock.withLock { opened.append(surface) }
    }
}

@MainActor
private final class ResumeRecorder {
    private(set) var resumed: [String] = []
    func record(_ entry: DraftEntry) {
        resumed.append(entry.storageKey)
    }
}

private func draft(
    _ key: String,
    label: String = "Draft",
    route: String = "/x"
) -> DraftEntry {
    DraftEntry(storageKey: key, label: label, route: route, savedAt: Date(timeIntervalSince1970: 1_000_000))
}

// MARK: - Lifecycle + telemetry

@MainActor
final class DraftRestorePromptModelLifecycleTests: XCTestCase {
    func testStartEmitsViewOpenedAndStartsSource() {
        let source = InMemoryDraftRestoreSource(initial: DraftRestoreUpdate(status: .empty))
        let telemetry = SpyDraftRestoreTelemetry()
        let model = DraftRestorePromptModel(source: source, telemetry: telemetry)

        model.start()
        model.start() // idempotent

        XCTAssertEqual(telemetry.openedSurfaces, ["DraftRestorePrompt"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.phase, .empty)
    }

    func testApplyDrivesPhaseAndConnection() {
        let source = InMemoryDraftRestoreSource()
        let model = DraftRestorePromptModel(source: source)
        model.start()

        source.push(DraftRestoreUpdate(status: .loaded, drafts: [draft("a")]))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.drafts.map(\.storageKey), ["a"])
        XCTAssertEqual(model.connection, .live)
    }

    func testStopStopsSource() {
        let source = InMemoryDraftRestoreSource()
        let model = DraftRestorePromptModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let source = InMemoryDraftRestoreSource()
        let model = DraftRestorePromptModel(source: source)
        model.start()

        source.push(DraftRestoreUpdate(status: .loaded, connection: .stale, drafts: [draft("a")]))
        XCTAssertEqual(source.refreshCount, 1)

        // A second stale snapshot does not re-trigger the one-shot auto-refresh.
        source.push(DraftRestoreUpdate(status: .loaded, connection: .stale, drafts: [draft("a")]))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testAutoRefreshIfStaleGuardsOnConnectionAndFetching() {
        let source = InMemoryDraftRestoreSource()
        let model = DraftRestorePromptModel(source: source)
        model.start()

        // Live → no refresh.
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 0)

        // Offline + already fetching → still no refresh from the guard.
        source.push(DraftRestoreUpdate(
            status: .loaded, connection: .offline, isFetching: true, drafts: [draft("a")]
        ))
        let baseline = source.refreshCount
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, baseline)
    }
}

// MARK: - Actions (review / dismiss / resume / discard)

@MainActor
final class DraftRestorePromptModelActionTests: XCTestCase {
    private func loadedModel(
        _ drafts: [DraftEntry],
        onResume: (@MainActor (DraftEntry) -> Void)? = nil
    ) -> (DraftRestorePromptModel, InMemoryDraftRestoreSource) {
        let source = InMemoryDraftRestoreSource(initial: DraftRestoreUpdate(status: .loaded, drafts: drafts))
        let model = DraftRestorePromptModel(source: source, onResume: onResume)
        model.start()
        return (model, source)
    }

    func testReviewOpensModal() {
        let (model, _) = loadedModel([draft("a")])
        XCTAssertFalse(model.isReviewing)
        model.review()
        XCTAssertTrue(model.isReviewing)
    }

    func testDismissHidesAndMarksDismissed() {
        let (model, source) = loadedModel([draft("a")])
        model.review()
        XCTAssertTrue(model.isPromptVisible)

        model.dismiss()
        XCTAssertTrue(model.dismissed)
        XCTAssertFalse(model.isReviewing)
        XCTAssertFalse(model.isPromptVisible)
        XCTAssertEqual(source.dismissCount, 1)
    }

    func testResumeDismissesAndInvokesHandler() {
        let recorder = ResumeRecorder()
        let (model, source) = loadedModel([draft("a")], onResume: { recorder.record($0) })

        model.resume(draft("a"))
        XCTAssertEqual(recorder.resumed, ["a"])
        XCTAssertTrue(model.dismissed)
        XCTAssertFalse(model.isReviewing)
        XCTAssertEqual(source.dismissCount, 1)
    }

    func testResumeRouteNormalizes() {
        let (model, _) = loadedModel([draft("a")])
        XCTAssertEqual(model.resumeRoute(for: draft("a", route: "/settings")), "/settings")
        XCTAssertEqual(model.resumeRoute(for: draft("a", route: "")), "/")
    }

    func testDiscardRemovesRowAndNotifiesSource() {
        let (model, source) = loadedModel([draft("a"), draft("b")])

        model.discard(draft("a"))
        XCTAssertEqual(model.drafts.map(\.storageKey), ["b"])
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.discardedKeys, ["a"])
        XCTAssertFalse(model.dismissed)
    }

    func testDiscardLastDraftCollapsesPrompt() {
        let (model, source) = loadedModel([draft("a")])
        model.review()

        model.discard(draft("a"))
        XCTAssertTrue(model.drafts.isEmpty)
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.isReviewing)
        XCTAssertTrue(model.dismissed)
        XCTAssertEqual(source.discardedKeys, ["a"])
        XCTAssertEqual(source.dismissCount, 1)
    }

    func testIsPromptVisibleGating() {
        let source = InMemoryDraftRestoreSource()
        let model = DraftRestorePromptModel(source: source)
        model.start()

        source.push(DraftRestoreUpdate(status: .loading))
        XCTAssertFalse(model.isPromptVisible) // loading → not visible

        source.push(DraftRestoreUpdate(status: .loaded, drafts: [draft("a")]))
        XCTAssertTrue(model.isPromptVisible) // data + not dismissed → visible

        model.dismiss()
        XCTAssertFalse(model.isPromptVisible) // dismissed → not visible
    }
}
