//
//  SessionExpiredModal.Tests.swift
//  TeslaSync — P4 modal/dialog · 0008 · SessionExpiredModal (Apple)
//
//  Adapter + projection + accessibility coverage for the SessionExpiredModal surface:
//    • `SessionExpiredProjection.shouldBlock` — the web `open = hasExpired || eventTriggered`
//      predicate, including open-mode suppression (the event is ignored there).
//    • `SessionExpiredProjection.resolvePhase` — phase resolution across loading / loaded / failed,
//      including the cached-verdict survival of a failed reload.
//    • `SessionContext.latchingEvent` — the sticky `eventTriggered` fold-in (web local state).
//    • `SessionExpiredAccessibility` — the per-phase VoiceOver summaries.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy without
/// a bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Surface identity

final class SessionExpiredSurfaceTests: XCTestCase {
    func testSlugMatchesPromptSurface() {
        XCTAssertEqual(SessionExpiredSurface.slug, "SessionExpiredModal")
    }
}

// MARK: - Activation predicate (web `open = hasExpired || eventTriggered`)

final class SessionExpiredShouldBlockTests: XCTestCase {
    func testSessionExpiredBlocks() {
        let context = SessionContext(mode: .session, hasExpired: true)
        XCTAssertTrue(SessionExpiredProjection.shouldBlock(context))
    }

    func testSessionEventTriggeredBlocks() {
        let context = SessionContext(mode: .session, hasExpired: false, eventTriggered: true)
        XCTAssertTrue(SessionExpiredProjection.shouldBlock(context))
    }

    func testSessionHealthyDoesNotBlock() {
        let context = SessionContext(mode: .session, hasExpired: false)
        XCTAssertFalse(SessionExpiredProjection.shouldBlock(context))
    }

    func testOpenModeNeverBlocksEvenWhenExpiredOrEventFired() {
        // Web parity: open mode renders null AND filters out the session-expired event.
        XCTAssertFalse(SessionExpiredProjection.shouldBlock(SessionContext(mode: .open, hasExpired: true)))
        XCTAssertFalse(
            SessionExpiredProjection.shouldBlock(
                SessionContext(mode: .open, hasExpired: false, eventTriggered: true)
            )
        )
    }

    func testUnknownModeNeverBlocks() {
        XCTAssertFalse(SessionExpiredProjection.shouldBlock(SessionContext(mode: .unknown, hasExpired: true)))
    }
}

// MARK: - Phase resolution

final class SessionExpiredPhaseTests: XCTestCase {
    private let expiredSession = SessionContext(mode: .session, hasExpired: true)
    private let healthySession = SessionContext(mode: .session, hasExpired: false)

    func testLoadingResolvesByContextPresence() {
        XCTAssertEqual(SessionExpiredProjection.resolvePhase(status: .loading, context: nil), .loading)
        // A cached verdict during a reload resolves rather than flashing the skeleton.
        XCTAssertEqual(SessionExpiredProjection.resolvePhase(status: .loading, context: expiredSession), .expired)
    }

    func testLoadedNoContextResolvesDormant() {
        XCTAssertEqual(SessionExpiredProjection.resolvePhase(status: .loaded, context: nil), .dormant)
    }

    func testLoadedOpenModeResolvesEmpty() {
        let context = SessionContext(mode: .open, hasExpired: false)
        XCTAssertEqual(SessionExpiredProjection.resolvePhase(status: .loaded, context: context), .empty)
    }

    func testLoadedUnknownModeResolvesDormant() {
        let context = SessionContext(mode: .unknown, hasExpired: false)
        XCTAssertEqual(SessionExpiredProjection.resolvePhase(status: .loaded, context: context), .dormant)
    }

    func testLoadedSessionResolvesExpiredOrDormant() {
        XCTAssertEqual(SessionExpiredProjection.resolvePhase(status: .loaded, context: expiredSession), .expired)
        XCTAssertEqual(SessionExpiredProjection.resolvePhase(status: .loaded, context: healthySession), .dormant)
    }

    func testFailedResolvesErrorOrKeepsCachedVerdict() {
        XCTAssertEqual(
            SessionExpiredProjection.resolvePhase(status: .failed("boom"), context: nil),
            .error("boom")
        )
        // A failed reload over a cached expired verdict keeps the block rather than dropping to error.
        XCTAssertEqual(
            SessionExpiredProjection.resolvePhase(status: .failed("boom"), context: expiredSession),
            .expired
        )
    }
}

// MARK: - Event latching (web sticky `eventTriggered`)

final class SessionContextLatchTests: XCTestCase {
    func testLatchingEventFoldsInTrue() {
        let context = SessionContext(mode: .session, hasExpired: false)
        XCTAssertFalse(context.eventTriggered)
        XCTAssertTrue(context.latchingEvent(true).eventTriggered)
    }

    func testLatchingFalseKeepsOriginal() {
        let fired = SessionContext(mode: .session, hasExpired: false, eventTriggered: true)
        XCTAssertTrue(fired.latchingEvent(false).eventTriggered)
        let quiet = SessionContext(mode: .session, hasExpired: false, eventTriggered: false)
        XCTAssertFalse(quiet.latchingEvent(false).eventTriggered)
    }

    func testLatchingPreservesModeAndExpiry() {
        let context = SessionContext(mode: .session, hasExpired: true)
        let latched = context.latchingEvent(true)
        XCTAssertEqual(latched.mode, .session)
        XCTAssertTrue(latched.hasExpired)
    }
}

// MARK: - Accessibility

final class SessionExpiredAccessibilityTests: XCTestCase {
    func testActiveSummaryIsBlockTitle() {
        XCTAssertEqual(
            SessionExpiredAccessibility.summary(localize: passthroughLocalize),
            "Session expired"
        )
    }

    func testPerPhaseSummaries() {
        let cases: [(SessionExpiredPhase, String)] = [
            (.loading, "Checking your session…"),
            (.empty, "No sign-in required"),
            (.dormant, "Session active"),
            (.error("x"), "Couldn't check your session"),
            (.expired, "Session expired")
        ]
        for (phase, expected) in cases {
            XCTAssertEqual(
                SessionExpiredAccessibility.summary(for: phase, localize: passthroughLocalize),
                expected
            )
        }
    }
}
