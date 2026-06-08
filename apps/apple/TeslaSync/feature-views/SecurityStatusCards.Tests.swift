//
//  SecurityStatusCards.Tests.swift
//  TeslaSync — P4 feature view · 0046 · SecurityStatusCards (Apple)
//
//  Unit coverage for the SecurityStatusCards surface:
//    • Logic — `doorClosed` / `parseWindowState` / `allWindowsClosed` /
//      `asNonEmptyString` parity across every wire variant (port of ./helpers.ts).
//    • Projection — the six cards' value / tone / icon / VoiceOver summary across the
//      secure, open, and absent (empty fallback) events, including the web sentry
//      raw-truthiness quirk.
//    • State holder — `SecurityCardsModel.resolvePhase` across loading / empty /
//      loaded / failed, plus the model wiring, the P1/S11 `view.opened` telemetry,
//      and the stale one-shot auto-refresh.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySecurityCardsSource`.
//

import XCTest
@testable import TeslaSync

/// Echo localizer: returns the web English fallback so projected strings can be
/// asserted without the catalog (the P1/S10 facade is exercised separately).
private let echo: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Logic: doorClosed (port of ./helpers.ts doorClosed)

@MainActor
final class SecurityCardsDoorLogicTests: XCTestCase {
    func testAbsentIsClosed() {
        XCTAssertTrue(SecurityCardsLogic.doorClosed(.absent))
    }

    func testBooleanFollowsNegation() {
        XCTAssertTrue(SecurityCardsLogic.doorClosed(.boolean(false)))
        XCTAssertFalse(SecurityCardsLogic.doorClosed(.boolean(true)))
    }

    func testClosedLikeStringsAreClosed() {
        for raw in ["Closed", "closedAll", "0", "false", "", "  "] {
            XCTAssertTrue(SecurityCardsLogic.doorClosed(.text(raw)), "expected \(raw) closed")
        }
    }

    func testOpenStringIsNotClosed() {
        XCTAssertFalse(SecurityCardsLogic.doorClosed(.text("Driver Front Open")))
    }

    func testAllFalsyJSONObjectIsClosed() {
        XCTAssertTrue(SecurityCardsLogic.doorClosed(.text("{\"df\":false,\"pf\":null}")))
    }

    func testJSONObjectWithTrueOrNumberIsNotClosed() {
        XCTAssertFalse(SecurityCardsLogic.doorClosed(.text("{\"df\":true}")))
        XCTAssertFalse(SecurityCardsLogic.doorClosed(.text("{\"df\":1}")))
    }

    func testMalformedJSONObjectIsNotClosed() {
        XCTAssertFalse(SecurityCardsLogic.doorClosed(.text("{not json")))
    }
}

// MARK: - Logic: windows (port of parseWindowState / allWindowsClosed)

@MainActor
final class SecurityCardsWindowLogicTests: XCTestCase {
    func testParseWindowState() {
        XCTAssertEqual(SecurityCardsLogic.parseWindowState(.text("Closed")), .closed)
        XCTAssertEqual(SecurityCardsLogic.parseWindowState(.text("0")), .closed)
        XCTAssertEqual(SecurityCardsLogic.parseWindowState(.text("Vent")), .venting)
        XCTAssertEqual(SecurityCardsLogic.parseWindowState(.text("Open")), .open)
        XCTAssertEqual(SecurityCardsLogic.parseWindowState(.text("partial")), .open)
        XCTAssertEqual(SecurityCardsLogic.parseWindowState(.absent), .unknown)
        XCTAssertEqual(SecurityCardsLogic.parseWindowState(.boolean(true)), .unknown)
    }

    func testAllWindowsClosed() {
        let closed: [SecurityCardsSignalValue] = [.text("Closed"), .text("0"), .text("Closed"), .text("Closed")]
        XCTAssertTrue(SecurityCardsLogic.allWindowsClosed(closed))
        let mixed: [SecurityCardsSignalValue] = [.text("Open"), .text("Closed"), .text("Closed"), .text("Closed")]
        XCTAssertFalse(SecurityCardsLogic.allWindowsClosed(mixed))
    }

    func testOpenWindowCount() {
        let windows: [SecurityCardsSignalValue] = [.text("Open"), .text("Vent"), .text("Closed"), .text("Closed")]
        XCTAssertEqual(SecurityCardsLogic.openWindowCount(windows), 2)
    }

    func testAsNonEmptyString() {
        XCTAssertEqual(SecurityCardsLogic.asNonEmptyString(.text("Open")), "Open")
        XCTAssertNil(SecurityCardsLogic.asNonEmptyString(.text("")))
        XCTAssertNil(SecurityCardsLogic.asNonEmptyString(.boolean(true)))
        XCTAssertNil(SecurityCardsLogic.asNonEmptyString(.absent))
    }
}

// MARK: - Signal truthiness (web `value ?`)

@MainActor
final class SecurityCardsSignalValueTests: XCTestCase {
    func testTruthiness() {
        XCTAssertTrue(SecurityCardsSignalValue.boolean(true).isTruthy)
        XCTAssertFalse(SecurityCardsSignalValue.boolean(false).isTruthy)
        XCTAssertTrue(SecurityCardsSignalValue.text("On").isTruthy)
        // Web quirk: any non-empty string is truthy, including "Off".
        XCTAssertTrue(SecurityCardsSignalValue.text("Off").isTruthy)
        XCTAssertFalse(SecurityCardsSignalValue.text("").isTruthy)
        XCTAssertFalse(SecurityCardsSignalValue.absent.isTruthy)
    }
}

// MARK: - Projection: the six cards across events

@MainActor
final class SecurityCardsProjectionTests: XCTestCase {
    private func card(_ cards: [SecurityCardViewModel], _ id: String) -> SecurityCardViewModel {
        guard let match = cards.first(where: { $0.id == id }) else {
            return SecurityCardViewModel(
                id: id, title: "", value: "", detail: "", systemImage: "", tone: .neutral, accessibilityLabel: ""
            )
        }
        return match
    }

    func testCardOrderAndCount() {
        let cards = SecurityCardsProjection.cards(latest: nil, localize: echo)
        XCTAssertEqual(cards.map(\.id), ["lock", "sentry", "doors", "windows", "homelink", "guest"])
    }

    func testAbsentEventRendersWebFallbacks() {
        let cards = SecurityCardsProjection.cards(latest: nil, localize: echo)
        XCTAssertEqual(card(cards, "lock").value, "Unlocked")
        XCTAssertEqual(card(cards, "lock").tone, .danger)
        XCTAssertEqual(card(cards, "sentry").value, "Inactive")
        XCTAssertEqual(card(cards, "sentry").tone, .neutral)
        XCTAssertEqual(card(cards, "doors").value, "Closed")
        XCTAssertEqual(card(cards, "doors").tone, .success)
        // Web windowSummary(undefined) === '—' while allWindowsClosed(undefined) is true.
        XCTAssertEqual(card(cards, "windows").value, "—")
        XCTAssertEqual(card(cards, "windows").tone, .success)
        XCTAssertEqual(card(cards, "homelink").value, "Away")
        XCTAssertEqual(card(cards, "guest").value, "Disabled")
    }

    func testSecureEventRendersSafeStates() {
        let event = SecurityCardsLatest(
            locked: true,
            sentryMode: .text("On"),
            doorState: .text("Closed"),
            frontDriverWindow: .text("Closed"),
            frontPassengerWindow: .text("Closed"),
            rearDriverWindow: .text("Closed"),
            rearPassengerWindow: .text("Closed"),
            homelinkNearby: true,
            guestMode: false
        )
        let cards = SecurityCardsProjection.cards(latest: event, localize: echo)
        XCTAssertEqual(card(cards, "lock").value, "Locked")
        XCTAssertEqual(card(cards, "lock").tone, .success)
        XCTAssertEqual(card(cards, "lock").systemImage, "lock.fill")
        XCTAssertEqual(card(cards, "sentry").value, "Active")
        XCTAssertEqual(card(cards, "sentry").tone, .info)
        XCTAssertEqual(card(cards, "doors").value, "Closed")
        XCTAssertEqual(card(cards, "windows").value, "All Closed")
        XCTAssertEqual(card(cards, "windows").tone, .success)
        XCTAssertEqual(card(cards, "homelink").value, "Nearby")
        XCTAssertEqual(card(cards, "homelink").tone, .homelink)
        XCTAssertEqual(card(cards, "guest").value, "Disabled")
    }

    func testOpenEventRendersRawDoorAndWindowCount() {
        let event = SecurityCardsLatest(
            locked: false,
            sentryMode: .boolean(false),
            doorState: .text("Driver Front Open"),
            frontDriverWindow: .text("Open"),
            frontPassengerWindow: .text("Vent"),
            rearDriverWindow: .text("Closed"),
            rearPassengerWindow: .text("Closed"),
            homelinkNearby: false,
            guestMode: true
        )
        let cards = SecurityCardsProjection.cards(latest: event, localize: echo)
        XCTAssertEqual(card(cards, "lock").value, "Unlocked")
        XCTAssertEqual(card(cards, "sentry").value, "Inactive")
        // Open door surfaces the raw doorState string verbatim (web asNonEmptyString).
        XCTAssertEqual(card(cards, "doors").value, "Driver Front Open")
        XCTAssertEqual(card(cards, "doors").tone, .warning)
        XCTAssertEqual(card(cards, "doors").systemImage, "door.left.hand.open")
        XCTAssertEqual(card(cards, "windows").value, "2 Open/Venting")
        XCTAssertEqual(card(cards, "windows").tone, .warning)
        XCTAssertEqual(card(cards, "guest").value, "Enabled")
        XCTAssertEqual(card(cards, "guest").tone, .warning)
    }

    func testSentryStringTruthinessQuirk() {
        // Web card uses `latest?.sentryMode ?` raw truthiness, so any non-empty
        // string (including "Off") renders Active.
        let event = SecurityCardsLatest(sentryMode: .text("Off"))
        let cards = SecurityCardsProjection.cards(latest: event, localize: echo)
        XCTAssertEqual(card(cards, "sentry").value, "Active")
    }
}

// MARK: - Accessibility summary content

@MainActor
final class SecurityCardsAccessibilityTests: XCTestCase {
    func testAccessibilityLabelCombinesTitleValueDetail() {
        let cards = SecurityCardsProjection.cards(
            latest: SecurityCardsLatest(locked: true),
            localize: echo
        )
        let lock = cards.first { $0.id == "lock" }
        XCTAssertEqual(lock?.accessibilityLabel, "Lock Status: Locked. Vehicle lock state")
    }
}

// MARK: - Phase resolution

@MainActor
final class SecurityCardsPhaseTests: XCTestCase {
    private let event = SecurityCardsLatest(locked: true)

    func testLoadingWithoutDataIsLoading() {
        XCTAssertEqual(SecurityCardsModel.resolvePhase(SecurityCardsUpdate(status: .loading)), .loading)
    }

    func testLoadingWithCachedDataStaysContent() {
        let update = SecurityCardsUpdate(status: .loading, latest: event)
        XCTAssertEqual(SecurityCardsModel.resolvePhase(update), .content)
    }

    func testEmptyStatusIsEmpty() {
        XCTAssertEqual(SecurityCardsModel.resolvePhase(SecurityCardsUpdate(status: .empty)), .empty)
    }

    func testLoadedWithoutDataIsEmpty() {
        XCTAssertEqual(SecurityCardsModel.resolvePhase(SecurityCardsUpdate(status: .loaded)), .empty)
    }

    func testLoadedWithDataIsContent() {
        XCTAssertEqual(SecurityCardsModel.resolvePhase(SecurityCardsUpdate(status: .loaded, latest: event)), .content)
    }

    func testFailedWithoutDataIsError() {
        XCTAssertEqual(
            SecurityCardsModel.resolvePhase(SecurityCardsUpdate(status: .failed("boom"))),
            .error("boom")
        )
    }

    func testFailedWithCachedDataStaysContent() {
        let update = SecurityCardsUpdate(status: .failed("boom"), latest: event)
        XCTAssertEqual(SecurityCardsModel.resolvePhase(update), .content)
    }
}

// MARK: - State holder: wiring + telemetry + stale auto-refresh

@MainActor
final class SecurityCardsModelTests: XCTestCase {
    private func makeModel(
        _ update: SecurityCardsUpdate,
        telemetry: SecurityCardsTelemetry = OSLogSecurityCardsTelemetry()
    ) -> (SecurityCardsModel, InMemorySecurityCardsSource) {
        let source = InMemorySecurityCardsSource(initial: update)
        let model = SecurityCardsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpySecurityCardsTelemetry()
        let (model, source) = makeModel(
            SecurityCardsUpdate(status: .loaded, connection: .live, latest: SecurityCardsLatest(locked: true)),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.cards.count, 6)
        XCTAssertEqual(spy.surfaces, [SecurityStatusCards.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SecurityCardsUpdate(status: .loading))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testEmptyResolvesToEmptyPhaseWithFallbackCards() {
        let (model, _) = makeModel(SecurityCardsUpdate(status: .empty, latest: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.cards.count, 6)
        XCTAssertEqual(model.cards.first { $0.id == "lock" }?.value, "Unlocked")
    }

    func testStaleTriggersExactlyOneAutoRefreshUntilLive() {
        let (model, source) = makeModel(
            SecurityCardsUpdate(status: .loaded, connection: .live, latest: SecurityCardsLatest(locked: true))
        )
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(SecurityCardsUpdate(status: .loaded, connection: .stale, latest: SecurityCardsLatest(locked: true)))
        source.push(SecurityCardsUpdate(status: .loaded, connection: .stale, latest: SecurityCardsLatest(locked: true)))
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(model.connection, .stale)
        source.push(SecurityCardsUpdate(status: .loaded, connection: .live, latest: SecurityCardsLatest(locked: true)))
        source.push(SecurityCardsUpdate(status: .loaded, connection: .stale, latest: SecurityCardsLatest(locked: true)))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(
            SecurityCardsUpdate(status: .loaded, connection: .live, latest: SecurityCardsLatest(locked: true))
        )
        model.start()
        source.push(
            SecurityCardsUpdate(status: .loaded, connection: .offline, latest: SecurityCardsLatest(locked: true))
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySecurityCardsTelemetry: SecurityCardsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
