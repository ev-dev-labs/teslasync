//
//  StateTimeline.ModelTests.swift
//  TeslaSync — P4 feature view · 0235 · StateTimeline (Apple)
//
//  State-holder coverage for the StateTimeline surface (`StateTimelineModel`), split
//  across two focused test cases over a shared fixture base:
//    • Lifecycle — phase across loading / loaded / empty / failed, the P1/S11
//      `view.opened` telemetry (exactly once), the stale auto-refresh (exactly once,
//      re-armed on returning to live), offline keeping the cached timeline, and the
//      retry / stop plumbing.
//    • Actions — the selection intent (optimistic highlight + source notify), the
//      empty-state widen-window / jump-to-last intents (gated by capability + data,
//      web `showWiden` / `showJump`), the hint labels, and the window / preset
//      passthrough.
//  Driven through an in-memory source with an injected fixed clock + UTC time zone —
//  no network, no bundle.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixture

@MainActor class StateTimelineModelFixture: XCTestCase {
    let posix = Locale(identifier: "en_US_POSIX")
    let utc = TimeZone(identifier: "UTC")!
    let nowMs: Int64 = 1_700_000_400_000

    var now: Date {
        Date(timeIntervalSince1970: Double(nowMs) / 1000)
    }

    func date(msAgo: Int64) -> Date {
        Date(timeIntervalSince1970: Double(nowMs - msAgo) / 1000)
    }

    func makeModel(
        initial: StateTimelineUpdate?,
        telemetry: StateTimelineTelemetry = SpyStateTimelineTelemetry()
    ) -> (StateTimelineModel, InMemoryStateTimelineSource) {
        let source = InMemoryStateTimelineSource(initial: initial)
        let model = StateTimelineModel(
            source: source,
            telemetry: telemetry,
            locale: posix,
            timeZone: utc,
            now: { [now] in now }
        )
        return (model, source)
    }

    func populated(
        connection: StateTimelineConnection = .live,
        windowMinutes: Int = 10
    ) -> StateTimelineUpdate {
        StateTimelineUpdate(
            status: .loaded,
            transitions: [
                StateTransitionInput(id: 1, timestamp: date(msAgo: 500_000), fromState: "asleep", toState: "online"),
                StateTransitionInput(id: 2, timestamp: date(msAgo: 100_000), fromState: "online", toState: "driving")
            ],
            fsmType: "vehicle",
            windowMinutes: windowMinutes,
            connection: connection
        )
    }

    func lastTransition(msAgo: Int64 = 10_800_000) -> StateTransitionInput {
        StateTransitionInput(id: 9, timestamp: date(msAgo: msAgo), fromState: "online", toState: "asleep")
    }
}

// MARK: - Lifecycle

@MainActor final class StateTimelineModelLifecycleTests: StateTimelineModelFixture {
    func testLoadedContentProjectsTicks() {
        let (model, source) = makeModel(initial: populated())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.ticks.map(\.id), [1, 2])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(
            initial: StateTimelineUpdate(status: .loaded, transitions: [], fsmType: "vehicle", windowMinutes: 10)
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.emptyMessage, "No transitions in window")
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: StateTimelineUpdate(
            status: .loading,
            fsmType: "vehicle",
            windowMinutes: 10
        ))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: StateTimelineUpdate(status: .failed("timeout"), fsmType: "vehicle"))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyStateTimelineTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [StateTimelineSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(populated(connection: .stale))
        source.push(populated(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(populated(connection: .stale))
        source.push(populated(connection: .live))
        source.push(populated(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedTimelineWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(populated(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: StateTimelineUpdate(status: .failed("x"), fsmType: "vehicle"))
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

// MARK: - Actions (selection · widen · jump · hints · passthrough)

@MainActor final class StateTimelineModelActionTests: StateTimelineModelFixture {
    private func emptyUpdate(
        lastTransition: StateTransitionInput? = nil,
        widerPreset: Int? = nil,
        capabilities: StateTimelineCapabilities = StateTimelineCapabilities()
    ) -> StateTimelineUpdate {
        StateTimelineUpdate(
            status: .loaded,
            transitions: [],
            fsmType: "vehicle",
            windowMinutes: 10,
            lastTransition: lastTransition,
            widerPreset: widerPreset,
            capabilities: capabilities
        )
    }

    func testSelectUpdatesSelectionAndNotifiesSource() throws {
        let (model, source) = makeModel(initial: populated())
        model.start()
        let tick = try XCTUnwrap(model.ticks.first)
        model.select(tick)
        XCTAssertEqual(model.selectedID, tick.id)
        XCTAssertEqual(source.lastSelectedID, tick.id)
    }

    func testWidenWindowFiresWhenPresetAndCapabilityPresent() {
        let (model, source) = makeModel(initial: emptyUpdate(lastTransition: lastTransition(), widerPreset: 360))
        model.start()
        XCTAssertTrue(model.showWiden)
        model.widenWindow()
        XCTAssertEqual(source.widenCount, 1)
    }

    func testWidenWindowNoOpsWithoutPreset() {
        let (model, source) = makeModel(initial: emptyUpdate())
        model.start()
        XCTAssertFalse(model.showWiden)
        model.widenWindow()
        XCTAssertEqual(source.widenCount, 0)
    }

    func testWidenWindowNoOpsWhenCapabilityDisabled() {
        let (model, source) = makeModel(
            initial: emptyUpdate(
                widerPreset: 360,
                capabilities: StateTimelineCapabilities(widenWindow: false, jumpToLast: true)
            )
        )
        model.start()
        XCTAssertFalse(model.showWiden)
        model.widenWindow()
        XCTAssertEqual(source.widenCount, 0)
    }

    func testJumpToLastFiresWhenLastTransitionAndCapabilityPresent() {
        let (model, source) = makeModel(initial: emptyUpdate(lastTransition: lastTransition()))
        model.start()
        XCTAssertTrue(model.showJump)
        model.jumpToLast()
        XCTAssertEqual(source.jumpCount, 1)
    }

    func testJumpToLastNoOpsWithoutLastTransition() {
        let (model, source) = makeModel(initial: emptyUpdate())
        model.start()
        XCTAssertFalse(model.showJump)
        model.jumpToLast()
        XCTAssertEqual(source.jumpCount, 0)
    }

    func testJumpToLastNoOpsWhenCapabilityDisabled() {
        let (model, source) = makeModel(
            initial: emptyUpdate(
                lastTransition: lastTransition(),
                capabilities: StateTimelineCapabilities(widenWindow: true, jumpToLast: false)
            )
        )
        model.start()
        XCTAssertFalse(model.showJump)
        model.jumpToLast()
        XCTAssertEqual(source.jumpCount, 0)
    }

    func testHintLabelsRenderRelativePresetAndJump() {
        let (model, _) = makeModel(
            initial: emptyUpdate(lastTransition: lastTransition(msAgo: 3 * 3_600_000), widerPreset: 360)
        )
        model.start()
        XCTAssertTrue(model.hasHint)
        XCTAssertEqual(model.lastSeenLabel, "Last transition 3h ago")
        XCTAssertEqual(model.widenLabel, "Widen window to 6 h")
        XCTAssertEqual(model.jumpLabel, "Jump to last transition")
    }

    func testWindowAndPresetPassthrough() {
        let (model, _) = makeModel(
            initial: StateTimelineUpdate(
                status: .loaded,
                transitions: [],
                fsmType: "vehicle",
                windowMinutes: 30,
                lastTransition: StateTransitionInput(
                    id: 5,
                    timestamp: date(msAgo: 60000),
                    fromState: "a",
                    toState: "b"
                ),
                widerPreset: 120
            )
        )
        model.start()
        XCTAssertEqual(model.projection.windowMinutes, 30)
        XCTAssertEqual(model.widerPreset, 120)
        XCTAssertEqual(model.lastTransition?.id, 5)
        XCTAssertTrue(model.windowLabelText.contains("30"))
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyStateTimelineTelemetry: StateTimelineTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
