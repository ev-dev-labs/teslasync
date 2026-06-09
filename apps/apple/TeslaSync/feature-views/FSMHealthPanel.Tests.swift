//
//  FSMHealthPanel.Tests.swift
//  TeslaSync — P4 feature view · 0228 · FSMHealthPanel (Apple)
//
//  Pure-core unit coverage for the FSMHealthPanel surface:
//    • Adapter (`FSMHealthProjector`) — the verbatim web `useMemo` port: flap detection
//      (the >5-same-FSM-per-minute window, the strict threshold, per-FSM isolation, the
//      exported `flapIds` set), stuck detection (session-type filter, latest-per-instance,
//      the strict >4h boundary), recovery count, the composed alerts (order + severities +
//      the push-once running flap count quirk), and phase resolution.
//    • Formatting (`FSMHealthFormat`) — locale-aware whole-number strings (web `fmtInt`).
//    • Messages + Accessibility — the `{{count}}` interpolation, the titles, and the
//      VoiceOver panel summary, through an injected bundle-free localizer.
//
//  These run in the TeslaSync(/-macOS) XCTest targets; they have no network and no bundle
//  (the adapter is pure). `now` is injected and timestamps are built from integer
//  milliseconds so every window boundary is deterministic.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection (web FSMHealthPanel useMemo parity)

@MainActor final class FSMHealthProjectorTests: XCTestCase {
    private let nowMs: Int64 = 1_700_000_400_000
    private var now: Date {
        date(ms: nowMs)
    }

    private func date(ms: Int64) -> Date {
        Date(timeIntervalSince1970: Double(ms) / 1000)
    }

    /// Builds a single same-FSM burst of `count` transitions spaced `stepSeconds` apart
    /// starting `startSecondsAgo` before `now`, with sequential ids beginning at `firstID`.
    private func burst(
        fsmName: String,
        count: Int,
        stepSeconds: Int,
        startSecondsAgo: Int,
        firstID: Int,
        vehicleId: Int = 1
    ) -> [FSMHealthTransitionInput] {
        (0 ..< count).map { offset in
            FSMHealthTransitionInput(
                id: firstID + offset,
                vehicleId: vehicleId,
                timestamp: now.addingTimeInterval(TimeInterval(-startSecondsAgo + offset * stepSeconds)),
                fsmName: fsmName,
                toState: "online"
            )
        }
    }

    func testMillisTruncatesToWholeMilliseconds() {
        XCTAssertEqual(FSMHealthProjector.millis(from: date(ms: 1500)), 1500)
        XCTAssertEqual(FSMHealthProjector.millis(from: now), nowMs)
    }

    func testFlapFlagsBurstOfMoreThanFiveWithinOneMinute() {
        // Six `vehicle` transitions across 50s (< 60s window) → all six flagged.
        let rows = burst(fsmName: "vehicle", count: 6, stepSeconds: 10, startSecondsAgo: 600, firstID: 1)
        XCTAssertEqual(FSMHealthProjector.flapIds(rows), [1, 2, 3, 4, 5, 6])
    }

    func testFlapIgnoresTransitionOutsideTheWindow() {
        var rows = burst(fsmName: "vehicle", count: 6, stepSeconds: 10, startSecondsAgo: 600, firstID: 1)
        // A seventh `vehicle` transition two minutes later is its own (count-1) window.
        rows.append(FSMHealthTransitionInput(
            id: 7, vehicleId: 1, timestamp: now.addingTimeInterval(-480), fsmName: "vehicle", toState: "online"
        ))
        XCTAssertEqual(FSMHealthProjector.flapIds(rows), [1, 2, 3, 4, 5, 6])
    }

    func testFlapThresholdIsStrictlyMoreThanFive() {
        // Exactly five within the window → not a flap (web `count > 5`).
        let rows = burst(fsmName: "vehicle", count: 5, stepSeconds: 10, startSecondsAgo: 600, firstID: 1)
        XCTAssertTrue(FSMHealthProjector.flapIds(rows).isEmpty)
    }

    func testFlapIsIsolatedPerFSMName() {
        // Three `vehicle` + three `drive` in the same minute: neither FSM alone exceeds five.
        var rows = burst(fsmName: "vehicle", count: 3, stepSeconds: 5, startSecondsAgo: 600, firstID: 1)
        rows += burst(fsmName: "drive", count: 3, stepSeconds: 5, startSecondsAgo: 598, firstID: 4)
        XCTAssertTrue(FSMHealthProjector.flapIds(rows).isEmpty)
    }

    func testStuckCountsLatestStuckSessionInstances() {
        let rows: [FSMHealthTransitionInput] = [
            // drive_session active 5h old → stuck.
            FSMHealthTransitionInput(
                id: 1, vehicleId: 1, timestamp: now.addingTimeInterval(-5 * 3600),
                fsmName: "drive_session", toState: "active"
            ),
            // charge_session pending 6h old → stuck.
            FSMHealthTransitionInput(
                id: 2, vehicleId: 2, timestamp: now.addingTimeInterval(-6 * 3600),
                fsmName: "charge_session", toState: "pending"
            ),
            // charge_session active only 3h old → not stuck.
            FSMHealthTransitionInput(
                id: 3, vehicleId: 5, timestamp: now.addingTimeInterval(-3 * 3600),
                fsmName: "charge_session", toState: "active"
            ),
            // vehicle (non-session) pending 8h old → ignored (not a session type).
            FSMHealthTransitionInput(
                id: 4, vehicleId: 4, timestamp: now.addingTimeInterval(-8 * 3600),
                fsmName: "vehicle", toState: "pending"
            )
        ]
        XCTAssertEqual(FSMHealthProjector.stuckCount(rows, now: now), 2)
    }

    func testStuckUsesLatestPerInstanceKey() {
        let rows: [FSMHealthTransitionInput] = [
            // Old pending (would be stuck) …
            FSMHealthTransitionInput(
                id: 1, vehicleId: 3, timestamp: now.addingTimeInterval(-7 * 3600),
                fsmName: "drive_session", toState: "pending"
            ),
            // … superseded by a newer completed for the SAME instance → not stuck.
            FSMHealthTransitionInput(
                id: 2, vehicleId: 3, timestamp: now.addingTimeInterval(-1 * 3600),
                fsmName: "drive_session", toState: "completed"
            )
        ]
        XCTAssertEqual(FSMHealthProjector.stuckCount(rows, now: now), 0)
    }

    func testStuckBoundaryIsStrictlyGreaterThanFourHours() {
        func stuck(secondsAgo: Int) -> Int {
            FSMHealthProjector.stuckCount(
                [FSMHealthTransitionInput(
                    id: 1, vehicleId: 1, timestamp: now.addingTimeInterval(TimeInterval(-secondsAgo)),
                    fsmName: "drive_session", toState: "active"
                )],
                now: now
            )
        }
        XCTAssertEqual(stuck(secondsAgo: 4 * 3600 - 1), 0, "just under four hours is not stuck")
        XCTAssertEqual(stuck(secondsAgo: 4 * 3600), 0, "exactly four hours is not stuck (web `> 4h`)")
        XCTAssertEqual(stuck(secondsAgo: 4 * 3600 + 1), 1, "just over four hours is stuck")
    }

    func testRecoveryCountsRecoveredTargets() {
        let rows: [FSMHealthTransitionInput] = [
            FSMHealthTransitionInput(id: 1, vehicleId: 1, timestamp: now, fsmName: "vehicle", toState: "recovered"),
            FSMHealthTransitionInput(id: 2, vehicleId: 2, timestamp: now, fsmName: "drive", toState: "recovered"),
            FSMHealthTransitionInput(id: 3, vehicleId: 1, timestamp: now, fsmName: "vehicle", toState: "online")
        ]
        XCTAssertEqual(FSMHealthProjector.recoveryCount(rows), 2)
    }

    func testAlertsComposeInWebOrderWithSeveritiesAndCounts() {
        var rows = burst(fsmName: "vehicle", count: 6, stepSeconds: 10, startSecondsAgo: 600, firstID: 1)
        rows.append(FSMHealthTransitionInput(
            id: 100, vehicleId: 1, timestamp: now.addingTimeInterval(-5 * 3600),
            fsmName: "drive_session", toState: "active"
        ))
        rows.append(FSMHealthTransitionInput(
            id: 101, vehicleId: 1, timestamp: now.addingTimeInterval(-90), fsmName: "vehicle", toState: "recovered"
        ))
        let alerts = FSMHealthProjector.alerts(rows, now: now)
        XCTAssertEqual(alerts.map(\.kind), [.flap, .stuck, .recovery])
        XCTAssertEqual(alerts.map(\.severity), [.warning, .warning, .info])
        XCTAssertEqual(alerts.map(\.count), [6, 1, 1])
        XCTAssertEqual(alerts.map(\.id), ["flap", "stuck", "recovery"])
    }

    func testFlapAlertCountUsesRunningCountAtFirstPush() {
        // Two flapping FSMs; `vehicle` is seen first. The alert count is the running
        // `flapped` size at the first push (6), while `flapIds` is the full set (12) —
        // the web push-once quirk, reproduced verbatim.
        var rows = burst(fsmName: "vehicle", count: 6, stepSeconds: 8, startSecondsAgo: 600, firstID: 1)
        rows += burst(fsmName: "drive", count: 6, stepSeconds: 8, startSecondsAgo: 600, firstID: 7)
        let alerts = FSMHealthProjector.alerts(rows, now: now)
        XCTAssertEqual(alerts.filter { $0.kind == .flap }.map(\.count), [6])
        XCTAssertEqual(FSMHealthProjector.flapIds(rows).count, 12)
    }

    func testAlertsEmptyWhenHealthy() {
        let rows: [FSMHealthTransitionInput] = [
            FSMHealthTransitionInput(
                id: 1, vehicleId: 1, timestamp: now.addingTimeInterval(-3600), fsmName: "vehicle", toState: "online"
            ),
            FSMHealthTransitionInput(
                id: 2, vehicleId: 1, timestamp: now.addingTimeInterval(-1800),
                fsmName: "drive_session", toState: "completed"
            )
        ]
        XCTAssertTrue(FSMHealthProjector.alerts(rows, now: now).isEmpty)
    }

    func testResolvePhase() {
        let alert = FSMHealthAlert(kind: .stuck, severity: .warning, count: 1)
        XCTAssertEqual(FSMHealthProjector.resolvePhase(.loading, alerts: []), .loading)
        XCTAssertEqual(FSMHealthProjector.resolvePhase(.failed("boom"), alerts: []), .error("boom"))
        XCTAssertEqual(FSMHealthProjector.resolvePhase(.loaded, alerts: []), .healthy)
        XCTAssertEqual(FSMHealthProjector.resolvePhase(.loaded, alerts: [alert]), .alerts([alert]))
    }

    @MainActor
    func testSurfaceSlug() {
        XCTAssertEqual(FSMHealthPanelSurface.slug, "FSMHealthPanel")
        XCTAssertEqual(FSMHealthPanel.surfaceSlug, "FSMHealthPanel")
    }
}

// MARK: - Formatting

@MainActor final class FSMHealthFormatTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    func testCountRendersGroupedWholeNumber() {
        XCTAssertEqual(FSMHealthFormat.count(0, locale: posix), "0")
        XCTAssertEqual(FSMHealthFormat.count(7, locale: posix), "7")
        XCTAssertEqual(FSMHealthFormat.count(1234, locale: Locale(identifier: "en_US")), "1,234")
        XCTAssertEqual(FSMHealthFormat.count(1234, locale: posix), "1234")
    }
}

// MARK: - Messages + Accessibility (web `t(key, default, { count })` + VoiceOver)

@MainActor final class FSMHealthMessagesTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let posix = Locale(identifier: "en_US_POSIX")

    func testMessageInterpolatesRawCount() {
        let flap = FSMHealthAlert(kind: .flap, severity: .warning, count: 8)
        let stuck = FSMHealthAlert(kind: .stuck, severity: .warning, count: 3)
        let recovery = FSMHealthAlert(kind: .recovery, severity: .info, count: 2)
        XCTAssertEqual(
            FSMHealthMessages.message(for: flap, localize: echo),
            "8 transitions flagged as state flapping (>5 same-FSM transitions/min)"
        )
        XCTAssertEqual(
            FSMHealthMessages.message(for: stuck, localize: echo),
            "3 session(s) stuck in pending/active for >4 hours"
        )
        XCTAssertEqual(
            FSMHealthMessages.message(for: recovery, localize: echo),
            "2 session(s) recovered after pod restart"
        )
    }

    func testTitlesResolve() {
        XCTAssertEqual(FSMHealthMessages.title(for: .flap, localize: echo), "State Flapping")
        XCTAssertEqual(FSMHealthMessages.title(for: .stuck, localize: echo), "Stuck Sessions")
        XCTAssertEqual(FSMHealthMessages.title(for: .recovery, localize: echo), "Pod Recoveries")
    }

    func testAllClearAndPanelTitle() {
        XCTAssertEqual(FSMHealthMessages.panelTitle(localize: echo), "FSM Health")
        XCTAssertEqual(
            FSMHealthMessages.allClear(localize: echo),
            "All FSMs healthy — no flapping, stuck sessions, or recoveries detected"
        )
    }

    func testSummaryHealthyUsesAllClear() {
        let summary = FSMHealthAccessibility.summary(for: .healthy, localize: echo, locale: posix)
        XCTAssertEqual(summary, "All FSMs healthy — no flapping, stuck sessions, or recoveries detected")
    }

    func testSummaryAlertsListsTitleAndEachAlert() {
        let alerts = [
            FSMHealthAlert(kind: .flap, severity: .warning, count: 6),
            FSMHealthAlert(kind: .stuck, severity: .warning, count: 2)
        ]
        let summary = FSMHealthAccessibility.summary(for: .alerts(alerts), localize: echo, locale: posix)
        XCTAssertTrue(summary.hasPrefix("FSM Health. "))
        XCTAssertTrue(summary.contains("State Flapping, 6: 6 transitions flagged"))
        XCTAssertTrue(summary.contains("Stuck Sessions, 2: 2 session(s) stuck"))
    }

    func testSummaryErrorIncludesMessage() {
        let summary = FSMHealthAccessibility.summary(for: .error("timeout"), localize: echo, locale: posix)
        XCTAssertEqual(summary, "Couldn't load FSM health: timeout")
    }

    func testSummaryLoadingResolves() {
        let summary = FSMHealthAccessibility.summary(for: .loading, localize: echo, locale: posix)
        XCTAssertEqual(summary, "Loading FSM health")
    }
}
