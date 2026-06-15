//
//  RouteAnnouncer.SeamsTests.swift
//  TeslaSync — P4 shared surface · 0002 · RouteAnnouncer (Apple)
//
//  Seam coverage for the RouteAnnouncer dependency layer, split from the model tests for the
//  SwiftLint file-length budget:
//    • RouteAnnouncementCenter — the router `useLocation` port: navigate fans to subscribers +
//      records the current route, unsubscribe detaches, reset clears.
//    • LiveRouteAnnouncerSource — the production bridge: start replays the current route, each
//      navigation ingests, refresh re-emits, stop unsubscribes.
//    • ManualRouteAnnouncerScheduler — the deterministic virtual clock (web
//      `vi.advanceTimersByTime`): advance fires in schedule order, cancel removes pending.
//    • TaskRouteAnnouncerScheduler — the production deferred read fires after the delay and a
//      cancelled read never fires.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. Reference boxes hold the recorded values so
//  the main-actor closures never capture a mutable local under Swift 6 strict concurrency.
//

import XCTest
@testable import TeslaSync

@MainActor
private final class FiredFlag {
    var value = false
}

@MainActor
private final class IntRecorder {
    var values: [Int] = []
}

@MainActor
private final class SnapshotRecorder {
    var values: [RouteSnapshot] = []
}

@MainActor
private final class InputRecorder {
    var values: [RouteAnnouncerInput] = []
}

// MARK: - RouteAnnouncementCenter (router `useLocation` port)

@MainActor
final class RouteAnnouncementCenterTests: XCTestCase {
    func testNavigateFansToSubscribersAndRecordsCurrent() {
        let center = RouteAnnouncementCenter()
        let recorder = SnapshotRecorder()
        let subscription = center.subscribe { recorder.values.append($0) }
        center.navigate(toPath: "/drives", title: "Drives — TeslaSync")
        XCTAssertEqual(center.listenerCount, 1)
        XCTAssertEqual(center.current?.path, "/drives")
        XCTAssertEqual(recorder.values.map(\.title), ["Drives — TeslaSync"])

        subscription.cancel()
        center.navigate(toPath: "/analytics", title: "Analytics — TeslaSync")
        XCTAssertEqual(recorder.values.count, 1) // detached — no further deliveries
        XCTAssertEqual(center.listenerCount, 0)
        XCTAssertEqual(center.current?.path, "/analytics") // current still advances
    }

    func testResetClearsListenersAndCurrent() {
        let center = RouteAnnouncementCenter()
        _ = center.subscribe { _ in }
        center.navigate(toPath: "/a", title: "A")
        center.reset()
        XCTAssertEqual(center.listenerCount, 0)
        XCTAssertNil(center.current)
    }
}

// MARK: - LiveRouteAnnouncerSource (production bridge)

@MainActor
final class LiveRouteAnnouncerSourceTests: XCTestCase {
    func testStartReplaysCurrentRouteAndIngestsNavigations() {
        let center = RouteAnnouncementCenter()
        center.navigate(toPath: "/", title: "Dashboard — TeslaSync")
        let source = LiveRouteAnnouncerSource(center: center)
        let recorder = InputRecorder()
        source.onUpdate = { recorder.values.append($0) }
        source.start()
        XCTAssertEqual(recorder.values.last?.snapshot?.path, "/")

        center.navigate(toPath: "/drives", title: "Drives — TeslaSync")
        XCTAssertEqual(recorder.values.last?.snapshot?.title, "Drives — TeslaSync")
        XCTAssertEqual(recorder.values.last?.connection, .live)
    }

    func testRefreshReEmitsLatest() {
        let center = RouteAnnouncementCenter()
        center.navigate(toPath: "/drives", title: "Drives — TeslaSync")
        let source = LiveRouteAnnouncerSource(center: center)
        let recorder = InputRecorder()
        source.onUpdate = { recorder.values.append($0) }
        source.start()
        let before = recorder.values.count
        source.refresh()
        XCTAssertEqual(recorder.values.count, before + 1)
        XCTAssertEqual(recorder.values.last?.snapshot?.title, "Drives — TeslaSync")
    }

    func testStopUnsubscribesFromCentre() {
        let center = RouteAnnouncementCenter()
        let source = LiveRouteAnnouncerSource(center: center)
        let recorder = InputRecorder()
        source.onUpdate = { recorder.values.append($0) }
        source.start()
        source.stop()
        let countAfterStop = recorder.values.count
        center.navigate(toPath: "/ignored", title: "Ignored")
        XCTAssertEqual(recorder.values.count, countAfterStop)
    }
}

// MARK: - ManualRouteAnnouncerScheduler (deterministic virtual clock)

@MainActor
final class ManualRouteAnnouncerSchedulerTests: XCTestCase {
    func testFiresWhenDeadlineElapses() {
        let scheduler = ManualRouteAnnouncerScheduler()
        let flag = FiredFlag()
        _ = scheduler.schedule(after: 0.1) { flag.value = true }
        XCTAssertEqual(scheduler.pendingCount, 1)

        scheduler.advance(by: 0.05)
        XCTAssertFalse(flag.value)
        XCTAssertEqual(scheduler.pendingCount, 1)

        scheduler.advance(by: 0.1)
        XCTAssertTrue(flag.value)
        XCTAssertEqual(scheduler.pendingCount, 0)
    }

    func testCancelRemovesPending() {
        let scheduler = ManualRouteAnnouncerScheduler()
        let flag = FiredFlag()
        let handle = scheduler.schedule(after: 0.1) { flag.value = true }
        handle.cancel()
        XCTAssertEqual(scheduler.cancelCount, 1)
        XCTAssertEqual(scheduler.pendingCount, 0)
        scheduler.advance(by: 1.0)
        XCTAssertFalse(flag.value)
    }

    func testFiresInScheduleOrder() {
        let scheduler = ManualRouteAnnouncerScheduler()
        let recorder = IntRecorder()
        _ = scheduler.schedule(after: 0.1) { recorder.values.append(1) }
        _ = scheduler.schedule(after: 0.1) { recorder.values.append(2) }
        scheduler.advance(by: 0.2)
        XCTAssertEqual(recorder.values, [1, 2])
    }
}

// MARK: - TaskRouteAnnouncerScheduler (production deferred read)

@MainActor
final class TaskRouteAnnouncerSchedulerTests: XCTestCase {
    func testFiresAfterDelay() async {
        let scheduler = TaskRouteAnnouncerScheduler()
        let flag = FiredFlag()
        _ = scheduler.schedule(after: 0.02) { flag.value = true }
        try? await Task.sleep(nanoseconds: 120_000_000)
        XCTAssertTrue(flag.value)
    }

    func testCancelPreventsFiring() async {
        let scheduler = TaskRouteAnnouncerScheduler()
        let flag = FiredFlag()
        let handle = scheduler.schedule(after: 0.05) { flag.value = true }
        handle.cancel()
        try? await Task.sleep(nanoseconds: 120_000_000)
        XCTAssertFalse(flag.value)
    }
}
