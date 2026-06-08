//
//  FSMSubFSMPanel.Tests.swift
//  TeslaSync — P4 feature view · 0230 · FSMSubFSMPanel (Apple)
//
//  Unit coverage for the FSMSubFSMPanel surface:
//    • Adapter — the ISO-8601 parsing + relative-time buckets (port of dateFormat.ts
//      `formatRelative` / `formatDate`), the per-state semantic variant table (port of the
//      drive/charge FSM registries + `getStateColor`), the terminal/active rule, and the
//      `isVehicleView` guard.
//    • State holder — `FSMSubFSMProjection` across notApplicable / loading / empty / error /
//      data, plus the `FSMSubFSMModel` wiring, the P1/S11 `view.opened` telemetry, and the
//      stale auto-refresh transition.
//    • Accessibility — the VoiceOver row-label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryFSMSubFSMSource`, and the locale / time zone /
//  clock are injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let utc = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0)!

// MARK: - Timestamp parsing (port of `new Date(iso)` acceptance)

@MainActor
final class FSMSubFSMTimestampParseTests: XCTestCase {
    func testParsesPlainInternetDateTime() {
        XCTAssertNotNil(FSMSubFSMTimestamp.parse("2026-06-07T19:30:00Z"))
    }

    func testParsesFractionalSeconds() {
        XCTAssertNotNil(FSMSubFSMTimestamp.parse("2026-06-07T19:30:00.123Z"))
    }

    func testRejectsUnparseable() {
        XCTAssertNil(FSMSubFSMTimestamp.parse("not-a-date"))
        XCTAssertNil(FSMSubFSMTimestamp.parse(""))
    }
}

// MARK: - Relative time (port of dateFormat.ts `formatRelative`)

@MainActor
final class FSMSubFSMRelativeTimeTests: XCTestCase {
    private let base = FSMSubFSMTimestamp.parse("2026-06-07T12:00:00Z")!

    private func relative(secondsAfter offset: TimeInterval) -> String {
        FSMSubFSMTimestamp.relative(
            fromISO: "2026-06-07T12:00:00Z",
            now: base.addingTimeInterval(offset),
            locale: enUS,
            timeZone: utc
        )
    }

    func testUnderOneMinuteIsJustNow() {
        XCTAssertEqual(relative(secondsAfter: 0), "just now")
        XCTAssertEqual(relative(secondsAfter: 59), "just now")
    }

    func testFutureInstantsAreJustNow() {
        XCTAssertEqual(relative(secondsAfter: -30), "just now")
    }

    func testMinutesBucket() {
        XCTAssertEqual(relative(secondsAfter: 60), "1m ago")
        XCTAssertEqual(relative(secondsAfter: 300), "5m ago")
        XCTAssertEqual(relative(secondsAfter: 59 * 60), "59m ago")
    }

    func testHoursBucket() {
        XCTAssertEqual(relative(secondsAfter: 60 * 60), "1h ago")
        XCTAssertEqual(relative(secondsAfter: 3 * 60 * 60), "3h ago")
        XCTAssertEqual(relative(secondsAfter: 23 * 60 * 60), "23h ago")
    }

    func testDaysBucket() {
        XCTAssertEqual(relative(secondsAfter: 24 * 60 * 60), "1d ago")
        XCTAssertEqual(relative(secondsAfter: 6 * 24 * 60 * 60), "6d ago")
    }

    func testBeyondAWeekFallsBackToAbsolute() {
        let value = relative(secondsAfter: 10 * 24 * 60 * 60)
        XCTAssertNotEqual(value, FSMSubFSMTimestamp.dash)
        XCTAssertFalse(value.contains("ago"))
        XCTAssertEqual(value, FSMSubFSMTimestamp.absoluteDate(base, locale: enUS, timeZone: utc))
    }

    func testUnparseableYieldsDash() {
        let value = FSMSubFSMTimestamp.relative(fromISO: "nope", now: base, locale: enUS, timeZone: utc)
        XCTAssertEqual(value, "—")
    }
}

// MARK: - Semantic variant table (port of the FSM registries + `getStateColor`)

@MainActor
final class FSMSubFSMStateVariantTests: XCTestCase {
    func testDriveStateVariants() {
        XCTAssertEqual(FSMSubFSMStateModel.variant(for: .drive, state: "pending"), .warning)
        XCTAssertEqual(FSMSubFSMStateModel.variant(for: .drive, state: "active"), .success)
        XCTAssertEqual(FSMSubFSMStateModel.variant(for: .drive, state: "ending"), .warning)
        XCTAssertEqual(FSMSubFSMStateModel.variant(for: .drive, state: "completed"), .info)
        XCTAssertEqual(FSMSubFSMStateModel.variant(for: .drive, state: "recovered"), .neutral)
    }

    func testChargeStateVariants() {
        XCTAssertEqual(FSMSubFSMStateModel.variant(for: .charge, state: "pending"), .warning)
        XCTAssertEqual(FSMSubFSMStateModel.variant(for: .charge, state: "active"), .success)
        XCTAssertEqual(FSMSubFSMStateModel.variant(for: .charge, state: "completing"), .info)
        XCTAssertEqual(FSMSubFSMStateModel.variant(for: .charge, state: "done"), .success)
        XCTAssertEqual(FSMSubFSMStateModel.variant(for: .charge, state: "recovered"), .neutral)
    }

    func testVariantLookupIsCaseInsensitive() {
        XCTAssertEqual(FSMSubFSMStateModel.variant(for: .drive, state: "ACTIVE"), .success)
        XCTAssertEqual(FSMSubFSMStateModel.variant(for: .charge, state: "Completing"), .info)
    }

    func testUnknownStateFallsBackToNeutral() {
        XCTAssertEqual(FSMSubFSMStateModel.variant(for: .drive, state: "bogus"), .neutral)
        XCTAssertEqual(FSMSubFSMStateModel.variant(for: .charge, state: ""), .neutral)
    }
}

// MARK: - Terminal / active rule (port of `!terminalStates.includes(sub.state)`)

@MainActor
final class FSMSubFSMActiveStateTests: XCTestCase {
    func testDriveActiveStates() {
        XCTAssertTrue(FSMSubFSMStateModel.isActive(kind: .drive, state: "pending"))
        XCTAssertTrue(FSMSubFSMStateModel.isActive(kind: .drive, state: "active"))
        XCTAssertTrue(FSMSubFSMStateModel.isActive(kind: .drive, state: "ending"))
    }

    func testDriveTerminalStates() {
        XCTAssertFalse(FSMSubFSMStateModel.isActive(kind: .drive, state: "completed"))
        XCTAssertFalse(FSMSubFSMStateModel.isActive(kind: .drive, state: "recovered"))
    }

    func testChargeActiveStates() {
        XCTAssertTrue(FSMSubFSMStateModel.isActive(kind: .charge, state: "pending"))
        XCTAssertTrue(FSMSubFSMStateModel.isActive(kind: .charge, state: "active"))
        XCTAssertTrue(FSMSubFSMStateModel.isActive(kind: .charge, state: "completing"))
    }

    func testChargeTerminalStates() {
        XCTAssertFalse(FSMSubFSMStateModel.isActive(kind: .charge, state: "done"))
        XCTAssertFalse(FSMSubFSMStateModel.isActive(kind: .charge, state: "recovered"))
    }
}

// MARK: - Applicability guard (web `isVehicleView`)

@MainActor
final class FSMSubFSMApplicabilityTests: XCTestCase {
    func testVehicleAndAllAreApplicable() {
        XCTAssertTrue(FSMSubFSMApplicability.isVehicleView("vehicle"))
        XCTAssertTrue(FSMSubFSMApplicability.isVehicleView("all"))
    }

    func testOtherTypesAreNotApplicable() {
        XCTAssertFalse(FSMSubFSMApplicability.isVehicleView("telemetry_connection"))
        XCTAssertFalse(FSMSubFSMApplicability.isVehicleView(""))
        XCTAssertFalse(FSMSubFSMApplicability.isVehicleView("Vehicle"))
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

@MainActor
final class FSMSubFSMProjectionTests: XCTestCase {
    private var subs: [FSMSubFSMEntry] {
        [
            FSMSubFSMEntry(kind: .drive, state: "active", startTime: "2026-06-07T12:00:00Z", driveID: 1),
            FSMSubFSMEntry(kind: .charge, state: "completing", startTime: "2026-06-07T11:00:00Z", sessionID: 2)
        ]
    }

    func testNonVehicleTypeIsNotApplicable() {
        let resolved = FSMSubFSMProjection.resolve(
            FSMSubFSMInput(fsmType: "telemetry_connection", activeSubs: subs)
        )
        XCTAssertEqual(resolved.phase, .notApplicable)
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testNotApplicableTakesPrecedenceOverErrorAndLoading() {
        let resolved = FSMSubFSMProjection.resolve(FSMSubFSMInput(
            fsmType: "telemetry_connection",
            activeSubs: subs,
            isLoading: true,
            errorMessage: "boom"
        ))
        XCTAssertEqual(resolved.phase, .notApplicable)
    }

    func testErrorTakesPrecedenceOverData() {
        let resolved = FSMSubFSMProjection.resolve(
            FSMSubFSMInput(fsmType: "vehicle", activeSubs: subs, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        let resolved = FSMSubFSMProjection.resolve(FSMSubFSMInput(fsmType: "vehicle", isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenNilOrNoSubs() {
        XCTAssertEqual(
            FSMSubFSMProjection.resolve(FSMSubFSMInput(fsmType: "vehicle", activeSubs: nil)).phase,
            .empty
        )
        XCTAssertEqual(
            FSMSubFSMProjection.resolve(FSMSubFSMInput(fsmType: "all", activeSubs: [])).phase,
            .empty
        )
    }

    func testDataResolvesRowsInOrderWithVariantAndActivity() {
        let resolved = FSMSubFSMProjection.resolve(FSMSubFSMInput(fsmType: "vehicle", activeSubs: subs))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.rows.map(\.id), ["drive", "charge"])
        XCTAssertEqual(resolved.rows[0].kind, .drive)
        XCTAssertEqual(resolved.rows[0].variant, .success)
        XCTAssertTrue(resolved.rows[0].isActive)
        XCTAssertEqual(resolved.rows[1].kind, .charge)
        XCTAssertEqual(resolved.rows[1].variant, .info)
        XCTAssertTrue(resolved.rows[1].isActive)
    }

    func testTerminalSessionRowIsInactive() {
        let resolved = FSMSubFSMProjection.resolve(FSMSubFSMInput(
            fsmType: "vehicle",
            activeSubs: [FSMSubFSMEntry(kind: .drive, state: "completed", startTime: "2026-06-07T12:00:00Z")]
        ))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertFalse(resolved.rows[0].isActive)
        XCTAssertEqual(resolved.rows[0].variant, .info)
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor
final class FSMSubFSMModelTests: XCTestCase {
    private var dataInput: FSMSubFSMInput {
        FSMSubFSMInput(fsmType: "vehicle", activeSubs: [
            FSMSubFSMEntry(kind: .drive, state: "active", startTime: "2026-06-07T12:00:00Z"),
            FSMSubFSMEntry(kind: .charge, state: "active", startTime: "2026-06-07T11:00:00Z")
        ])
    }

    private func makeModel(
        _ input: FSMSubFSMInput,
        telemetry: FSMSubFSMTelemetry = OSLogFSMSubFSMTelemetry()
    ) -> (FSMSubFSMModel, InMemoryFSMSubFSMSource) {
        let source = InMemoryFSMSubFSMSource(initial: input)
        let model = FSMSubFSMModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyFSMSubFSMTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.rows.count, 2)
        XCTAssertEqual(spy.surfaces, [FSMSubFSMPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(FSMSubFSMInput(fsmType: "vehicle", isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.resolved.rows.isEmpty)
    }

    func testNonVehicleProjectsNotApplicable() {
        let (model, _) = makeModel(FSMSubFSMInput(fsmType: "telemetry_connection", activeSubs: []))
        model.start()
        XCTAssertEqual(model.phase, .notApplicable)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(FSMSubFSMInput(fsmType: "vehicle", isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(FSMSubFSMInput(fsmType: "vehicle", activeSubs: dataInput.activeSubs, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(FSMSubFSMInput(fsmType: "vehicle", activeSubs: dataInput.activeSubs, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(FSMSubFSMInput(fsmType: "vehicle", activeSubs: dataInput.activeSubs, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(FSMSubFSMPanel.surfaceSlug, "FSMSubFSMPanel")
    }
}

// MARK: - Accessibility summary content

@MainActor
final class FSMSubFSMAccessibilityTests: XCTestCase {
    func testRowLabelJoinsParts() {
        XCTAssertEqual(
            FSMSubFSMAccessibility.rowLabel(
                session: "Drive Session",
                status: "Active",
                state: "active",
                started: "5m ago"
            ),
            "Drive Session, Active, active, 5m ago"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyFSMSubFSMTelemetry: FSMSubFSMTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
