//
//  StateTimeline.Tests.swift
//  TeslaSync — P4 feature view · 0235 · StateTimeline (Apple)
//
//  Pure-core unit coverage for the StateTimeline surface:
//    • Adapter (`StateTimelineProjector`) — the verbatim web `useMemo` port: the
//      stable ascending sort, the `leftPct = ((ts − start)/span)·100` placement
//      (UNCLAMPED, matching the web), the window bounds, the destination-state hue via
//      the shared FSM registry, the content/empty threshold, phase resolution, and the
//      selected-tick lookup.
//    • Formatting (`StateTimelineFormat`) — the relative "last transition" hint, the
//      "widen window" preset label, the window label, and the whole-number count.
//    • Accessibility — the tick label, the tooltip, and the rail / empty summaries.
//
//  The state-holder (`StateTimelineModel`) coverage lives in
//  `StateTimeline.ModelTests.swift`. These run in the TeslaSync(/-macOS) XCTest
//  targets; they have no network and no bundle (the core is pure). `anchor` / `now` +
//  a UTC time zone are injected so every position + label is deterministic.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection (web StateTimeline useMemo parity)

@MainActor final class StateTimelineProjectorTests: XCTestCase {
    private let anchorMs: Int64 = 1_700_000_400_000
    private var anchor: Date {
        Date(timeIntervalSince1970: Double(anchorMs) / 1000)
    }

    private func date(msAgo: Int64) -> Date {
        Date(timeIntervalSince1970: Double(anchorMs - msAgo) / 1000)
    }

    private func project(
        _ transitions: [StateTransitionInput],
        windowMinutes: Int = 10,
        fsmType: String = "vehicle"
    ) -> StateTimelineProjection {
        StateTimelineProjector.project(
            transitions: transitions,
            fsmType: fsmType,
            windowMinutes: windowMinutes,
            anchor: anchor
        )
    }

    func testProjectSortsAscendingAndPlacesTicks() {
        let input = [
            StateTransitionInput(id: 3, timestamp: anchor, fromState: "driving", toState: "online"),
            StateTransitionInput(id: 1, timestamp: date(msAgo: 600_000), fromState: "asleep", toState: "asleep"),
            StateTransitionInput(id: 2, timestamp: date(msAgo: 300_000), fromState: "online", toState: "driving")
        ]
        let ticks = project(input).ticks
        XCTAssertEqual(ticks.map(\.id), [1, 2, 3])
        XCTAssertEqual(ticks.map(\.leftPercent), [0, 50, 100])
    }

    func testStableSortPreservesInputOrderForEqualTimestamps() {
        let tie = [
            StateTransitionInput(id: 10, timestamp: date(msAgo: 200_000), fromState: "a", toState: "b"),
            StateTransitionInput(id: 11, timestamp: date(msAgo: 200_000), fromState: "c", toState: "d")
        ]
        XCTAssertEqual(project(tie).ticks.map(\.id), [10, 11])
        XCTAssertEqual(project(tie.reversed()).ticks.map(\.id), [11, 10])
    }

    func testLeftPercentIsNotClampedForOutOfWindowTicks() {
        // 20 minutes back with a 10-minute window ⇒ −100% (web leaves leftPct unclamped;
        // the caller pre-windows). The projector must reproduce that faithfully.
        let input = [StateTransitionInput(id: 1, timestamp: date(msAgo: 1_200_000), fromState: "x", toState: "y")]
        XCTAssertEqual(project(input).ticks.first?.leftPercent, -100)
    }

    func testWindowBoundsMatchAnchorAndWindowMinutes() {
        let projection = project([], windowMinutes: 10)
        XCTAssertEqual(projection.windowEnd, anchor)
        XCTAssertEqual(projection.windowStart, date(msAgo: 600_000))
        XCTAssertEqual(projection.windowMinutes, 10)
    }

    func testZeroWindowGuardsAgainstDivideByZero() {
        // web `span = endTs - startTs || 1` — a zero-minute window must not NaN/crash.
        let input = [StateTransitionInput(id: 1, timestamp: anchor, fromState: "a", toState: "b")]
        let tick = project(input, windowMinutes: 0).ticks.first
        XCTAssertEqual(tick?.leftPercent, 0)
    }

    func testToneResolvesDestinationStateViaFSMRegistry() {
        let input = [
            StateTransitionInput(id: 1, timestamp: date(msAgo: 500_000), fromState: "asleep", toState: "online"),
            StateTransitionInput(id: 2, timestamp: date(msAgo: 100_000), fromState: "online", toState: "driving")
        ]
        for tick in project(input).ticks {
            XCTAssertEqual(tick.tone, FSMRegistry.color(for: "vehicle", state: tick.toState))
        }
    }

    func testUnknownStateFallsBackToNeutralTone() {
        let input = [StateTransitionInput(id: 1, timestamp: anchor, fromState: "x", toState: "definitely_not_a_state")]
        XCTAssertEqual(project(input).ticks.first?.tone, .neutral)
    }

    func testHasTicksMirrorsTickCount() {
        XCTAssertFalse(StateTimelineProjector.hasTicks([]))
        let input = [StateTransitionInput(id: 1, timestamp: anchor, fromState: "a", toState: "b")]
        XCTAssertTrue(StateTimelineProjector.hasTicks(project(input).ticks))
    }

    func testResolvePhase() {
        XCTAssertEqual(StateTimelineProjector.resolvePhase(.loading, hasTicks: false), .loading)
        XCTAssertEqual(StateTimelineProjector.resolvePhase(.loaded, hasTicks: true), .content)
        XCTAssertEqual(StateTimelineProjector.resolvePhase(.loaded, hasTicks: false), .empty)
        XCTAssertEqual(StateTimelineProjector.resolvePhase(.failed("boom"), hasTicks: true), .error("boom"))
    }

    func testTickLookupBySelectedID() {
        let ticks = project([
            StateTransitionInput(id: 7, timestamp: anchor, fromState: "a", toState: "b")
        ]).ticks
        XCTAssertEqual(StateTimelineProjector.tick(withID: 7, in: ticks)?.id, 7)
        XCTAssertNil(StateTimelineProjector.tick(withID: nil, in: ticks))
        XCTAssertNil(StateTimelineProjector.tick(withID: 99, in: ticks))
    }

    func testMillisTruncatesToWholeMilliseconds() {
        XCTAssertEqual(StateTimelineProjector.millis(from: Date(timeIntervalSince1970: 1.5)), 1500)
        XCTAssertEqual(StateTimelineProjector.millis(from: anchor), anchorMs)
    }

    @MainActor
    func testSurfaceSlug() {
        XCTAssertEqual(StateTimelineSurface.slug, "StateTimeline")
        XCTAssertEqual(StateTimeline.surfaceSlug, "StateTimeline")
    }
}

// MARK: - Formatting

@MainActor final class StateTimelineFormatTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")
    private let utc = TimeZone(identifier: "UTC")!
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private var now: Date {
        Date(timeIntervalSince1970: 1_700_000_400)
    }

    func testRelativeJustNowUnderAMinute() {
        let value = StateTimelineFormat.relative(
            now.addingTimeInterval(-10),
            now: now,
            localize: echo,
            locale: posix,
            timeZone: utc
        )
        XCTAssertEqual(value, "just now")
    }

    func testRelativeMinutesHoursDays() {
        func rel(_ secondsAgo: TimeInterval) -> String {
            StateTimelineFormat.relative(
                now.addingTimeInterval(-secondsAgo),
                now: now,
                localize: echo,
                locale: posix,
                timeZone: utc
            )
        }
        XCTAssertEqual(rel(120), "2m ago")
        XCTAssertEqual(rel(3600), "1h ago")
        XCTAssertEqual(rel(90000), "1d ago")
    }

    func testRelativeFallsBackToAbsoluteBeyondAWeek() {
        let value = StateTimelineFormat.relative(
            now.addingTimeInterval(-700_000),
            now: now,
            localize: echo,
            locale: posix,
            timeZone: utc
        )
        XCTAssertFalse(value.isEmpty)
        XCTAssertFalse(value.hasSuffix("ago"))
        XCTAssertEqual(
            value,
            StateTimelineFormat.mediumDate(now.addingTimeInterval(-700_000), locale: posix, timeZone: utc)
        )
    }

    func testPresetLabelMinutesHoursDay() {
        XCTAssertEqual(StateTimelineFormat.presetLabel(minutes: 45, localize: echo, locale: posix), "45 min")
        XCTAssertEqual(StateTimelineFormat.presetLabel(minutes: 120, localize: echo, locale: posix), "2 h")
        XCTAssertEqual(StateTimelineFormat.presetLabel(minutes: 90, localize: echo, locale: posix), "2 h")
        XCTAssertEqual(StateTimelineFormat.presetLabel(minutes: 1440, localize: echo, locale: posix), "24 h")
    }

    func testWindowLabel() {
        XCTAssertEqual(StateTimelineFormat.windowLabel(minutes: 10, localize: echo, locale: posix), "Window: 10 min")
    }

    func testCountFormatsWholeNumber() {
        XCTAssertEqual(StateTimelineFormat.count(3, locale: posix), "3")
        XCTAssertEqual(StateTimelineFormat.count(1234, locale: Locale(identifier: "en_US")), "1,234")
        XCTAssertEqual(StateTimelineFormat.count(1234, locale: posix), "1234")
    }

    func testClockIsDeterministicAndNonEmpty() {
        let date = Date(timeIntervalSince1970: 1_700_000_400)
        let first = StateTimelineFormat.clock(date, locale: posix, timeZone: utc)
        let second = StateTimelineFormat.clock(date, locale: posix, timeZone: utc)
        XCTAssertFalse(first.isEmpty)
        XCTAssertEqual(first, second)
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class StateTimelineAccessibilityTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testTickLabelMatchesWebAriaPlusTime() {
        let value = StateTimelineAccessibility.tickLabel(
            from: "asleep",
            to: "online",
            timeLabel: "09:00",
            localize: echo
        )
        XCTAssertEqual(value, "asleep to online · 09:00")
    }

    func testTooltipMatchesWebTemplate() {
        let value = StateTimelineAccessibility.tooltip(from: "asleep", to: "online", timeLabel: "09:00")
        XCTAssertEqual(value, "asleep → online · 09:00")
    }

    func testRailSummaryIncludesCountWindowAndSpan() {
        let summary = StateTimelineAccessibility.railSummary(
            ticksCount: 3,
            windowMinutes: 10,
            startLabel: "09:00",
            endLabel: "09:10",
            localize: echo,
            locale: posix
        )
        XCTAssertTrue(summary.contains("State transition timeline"))
        XCTAssertTrue(summary.contains("3 transitions"))
        XCTAssertTrue(summary.contains("Window: 10 min"))
        XCTAssertTrue(summary.contains("from 09:00 to 09:10"))
    }

    func testEmptySummaryWithoutHint() {
        let summary = StateTimelineAccessibility.emptySummary(
            message: "No transitions in window",
            lastSeen: nil,
            localize: echo
        )
        XCTAssertEqual(summary, "State transition timeline: No transitions in window")
    }

    func testEmptySummaryWithHint() {
        let summary = StateTimelineAccessibility.emptySummary(
            message: "No transitions in window",
            lastSeen: "Last transition 3h ago",
            localize: echo
        )
        XCTAssertEqual(summary, "State transition timeline: No transitions in window, Last transition 3h ago")
    }
}
