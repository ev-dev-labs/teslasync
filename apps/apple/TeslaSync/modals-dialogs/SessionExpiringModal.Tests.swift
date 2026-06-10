//
//  SessionExpiringModal.Tests.swift
//  TeslaSync — P4 modal / dialog · 0009 · SessionExpiringModal (Apple)
//
//  Adapter + projection + accessibility coverage for the SessionExpiringModal surface:
//    • `SessionCountdownFormatter` — the faithful `formatCountdown` port across the zero / clamp /
//      minute-rollover arms.
//    • `SessionExpiringProjection.derive` — the verbatim `deriveSessionState` port: the no-data,
//      open-mode, unauthenticated, expires-at, expires-in fallback, and threshold-boundary arms.
//    • `SessionExpiringProjection` — the open/visibility machine (incl. pinned suppression), the
//      body phase, the inline-failure envelope, and the draft sort / cap / overflow.
//    • `SessionExpiringAccessibility` — the dialog summary, countdown, and drafts VoiceOver copy.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Countdown formatter (web formatCountdown)

final class SessionCountdownFormatterTests: XCTestCase {
    func testZeroAndNegativeClampToZero() {
        XCTAssertEqual(SessionCountdownFormatter.string(seconds: 0), "0:00")
        XCTAssertEqual(SessionCountdownFormatter.string(seconds: -5), "0:00")
    }

    func testSecondsAreZeroPadded() {
        XCTAssertEqual(SessionCountdownFormatter.string(seconds: 5), "0:05")
        XCTAssertEqual(SessionCountdownFormatter.string(seconds: 45), "0:45")
        XCTAssertEqual(SessionCountdownFormatter.string(seconds: 59), "0:59")
    }

    func testMinuteRollover() {
        XCTAssertEqual(SessionCountdownFormatter.string(seconds: 60), "1:00")
        XCTAssertEqual(SessionCountdownFormatter.string(seconds: 75), "1:15")
        XCTAssertEqual(SessionCountdownFormatter.string(seconds: 3661), "61:01")
    }
}

// MARK: - derive (web deriveSessionState)

final class SessionExpiringDeriveTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_717_000_000)

    func testNilSnapshotResolvesUnknown() {
        XCTAssertEqual(SessionExpiringProjection.derive(nil, now: now), .unknown)
    }

    func testOpenModeIsNeverExpiring() {
        let snapshot = SessionSnapshot(mode: .open, authenticated: true, expiresAt: now, renewable: true)
        let derived = SessionExpiringProjection.derive(snapshot, now: now)
        XCTAssertEqual(derived.mode, .open)
        XCTAssertNil(derived.expiresInSeconds)
        XCTAssertFalse(derived.isExpiringSoon)
        XCTAssertFalse(derived.hasExpired)
        XCTAssertFalse(derived.renewable)
    }

    func testUnauthenticatedResolvesExpired() {
        let snapshot = SessionSnapshot(mode: .session, authenticated: false)
        let derived = SessionExpiringProjection.derive(snapshot, now: now)
        XCTAssertEqual(derived.mode, .session)
        XCTAssertTrue(derived.hasExpired)
        XCTAssertFalse(derived.isExpiringSoon)
        XCTAssertNil(derived.expiresInSeconds)
    }

    func testExpiresAtDrivesCountdownAndNearExpiry() {
        let snapshot = SessionSnapshot(
            mode: .session, authenticated: true,
            expiresAt: now.addingTimeInterval(45), renewable: true
        )
        let derived = SessionExpiringProjection.derive(snapshot, now: now)
        XCTAssertEqual(derived.expiresInSeconds, 45)
        XCTAssertTrue(derived.isExpiringSoon)
        XCTAssertFalse(derived.hasExpired)
        XCTAssertTrue(derived.renewable)
    }

    func testExpiresAtBeyondThresholdIsNotExpiringSoon() {
        let snapshot = SessionSnapshot(
            mode: .session, authenticated: true, expiresAt: now.addingTimeInterval(120)
        )
        let derived = SessionExpiringProjection.derive(snapshot, now: now)
        XCTAssertEqual(derived.expiresInSeconds, 120)
        XCTAssertFalse(derived.isExpiringSoon)
        XCTAssertFalse(derived.hasExpired)
    }

    func testExpiredInThePastSetsHasExpired() {
        let snapshot = SessionSnapshot(
            mode: .session, authenticated: true, expiresAt: now.addingTimeInterval(-10)
        )
        let derived = SessionExpiringProjection.derive(snapshot, now: now)
        XCTAssertEqual(derived.expiresInSeconds, -10)
        XCTAssertTrue(derived.hasExpired)
        XCTAssertFalse(derived.isExpiringSoon)
    }

    func testFallsBackToExpiresInWhenNoExpiresAt() {
        let snapshot = SessionSnapshot(mode: .session, authenticated: true, expiresIn: 30, renewable: true)
        let derived = SessionExpiringProjection.derive(snapshot, now: now)
        XCTAssertEqual(derived.expiresInSeconds, 30)
        XCTAssertTrue(derived.isExpiringSoon)
    }

    func testNoExpiryInfoYieldsNilCountdownButKeepsRenewable() {
        let snapshot = SessionSnapshot(mode: .session, authenticated: true, renewable: true)
        let derived = SessionExpiringProjection.derive(snapshot, now: now)
        XCTAssertNil(derived.expiresInSeconds)
        XCTAssertFalse(derived.isExpiringSoon)
        XCTAssertFalse(derived.hasExpired)
        XCTAssertTrue(derived.renewable)
    }

    func testThresholdBoundaries() {
        func soon(_ seconds: Int) -> Bool {
            SessionExpiringProjection.derive(
                SessionSnapshot(mode: .session, authenticated: true, expiresIn: seconds),
                now: now
            ).isExpiringSoon
        }
        XCTAssertTrue(soon(59))
        XCTAssertFalse(soon(60)) // strict < threshold
        XCTAssertFalse(soon(0)) // 0 is expired, not "soon"
        XCTAssertTrue(soon(1))
    }
}

// MARK: - open / visibility / phase / inline failure

final class SessionExpiringVisibilityTests: XCTestCase {
    private func soonDerived(_ seconds: Int) -> SessionDerivedState {
        SessionDerivedState(
            mode: .session, expiresInSeconds: seconds,
            isExpiringSoon: seconds > 0 && seconds < 60, hasExpired: seconds <= 0, renewable: true
        )
    }

    func testIsOpenOnlyWhenSessionNearExpiryAndNotExpired() {
        XCTAssertTrue(SessionExpiringProjection.isOpen(soonDerived(45)))
        XCTAssertFalse(SessionExpiringProjection.isOpen(soonDerived(120)))
        XCTAssertFalse(SessionExpiringProjection.isOpen(soonDerived(0)))
        XCTAssertFalse(SessionExpiringProjection.isOpen(.unknown))
    }

    func testVisibilityHidesWhenNotOpenAndPresentsWhenOpen() {
        XCTAssertEqual(
            SessionExpiringProjection.resolveVisibility(derived: soonDerived(45), pinned: false),
            .presented
        )
        XCTAssertEqual(
            SessionExpiringProjection.resolveVisibility(derived: soonDerived(120), pinned: false),
            .hidden
        )
    }

    func testPinnedSuppressesAmbientHide() {
        XCTAssertEqual(
            SessionExpiringProjection.resolveVisibility(derived: .unknown, pinned: true),
            .presented
        )
        XCTAssertEqual(
            SessionExpiringProjection.resolveVisibility(derived: .unknown, pinned: false),
            .hidden
        )
    }

    func testBodyPhase() {
        XCTAssertEqual(SessionExpiringProjection.resolvePhase(status: .loading, hasCountdown: false), .loading)
        XCTAssertEqual(SessionExpiringProjection.resolvePhase(status: .loading, hasCountdown: true), .content)
        XCTAssertEqual(SessionExpiringProjection.resolvePhase(status: .loaded, hasCountdown: false), .empty)
        XCTAssertEqual(SessionExpiringProjection.resolvePhase(status: .loaded, hasCountdown: true), .content)
        XCTAssertEqual(
            SessionExpiringProjection.resolvePhase(status: .failed("x"), hasCountdown: false),
            .error("x")
        )
        XCTAssertEqual(
            SessionExpiringProjection.resolvePhase(status: .failed("x"), hasCountdown: true),
            .content
        )
    }

    func testInlineFailureEnvelope() {
        XCTAssertEqual(
            SessionExpiringProjection.inlineFailure(status: .failed("boom"), hasCountdown: true), "boom"
        )
        XCTAssertNil(SessionExpiringProjection.inlineFailure(status: .failed("boom"), hasCountdown: false))
        XCTAssertNil(SessionExpiringProjection.inlineFailure(status: .loaded, hasCountdown: true))
    }
}

// MARK: - Drafts (sort / cap / overflow)

final class SessionExpiringDraftsTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_717_000_000)

    private func drafts() -> [SessionDraft] {
        [
            SessionDraft(label: "old", savedAt: now.addingTimeInterval(-3600)),
            SessionDraft(label: "newest", savedAt: now.addingTimeInterval(-10)),
            SessionDraft(label: "unparseable", savedAt: nil),
            SessionDraft(label: "middle", savedAt: now.addingTimeInterval(-600))
        ]
    }

    func testSortedMostRecentFirstWithNilLast() {
        let sorted = SessionExpiringProjection.sortedDrafts(drafts()).map(\.label)
        XCTAssertEqual(sorted, ["newest", "middle", "old", "unparseable"])
    }

    func testVisibleCapAndOverflow() {
        let many = (0 ..< 8).map { SessionDraft(label: "d\($0)", savedAt: now.addingTimeInterval(Double(-$0))) }
        XCTAssertEqual(SessionExpiringProjection.visibleDrafts(many, cap: 5).count, 5)
        XCTAssertEqual(SessionExpiringProjection.overflowCount(many, cap: 5), 3)
    }

    func testNoOverflowWithinCap() {
        let few = [SessionDraft(label: "a"), SessionDraft(label: "b")]
        XCTAssertEqual(SessionExpiringProjection.visibleDrafts(few, cap: 5).count, 2)
        XCTAssertEqual(SessionExpiringProjection.overflowCount(few, cap: 5), 0)
    }
}

// MARK: - Accessibility

final class SessionExpiringAccessibilityTests: XCTestCase {
    func testSummaryIsDialogTitle() {
        XCTAssertEqual(
            SessionExpiringAccessibility.summary(localize: passthroughLocalize),
            "Your session is about to expire"
        )
    }

    func testCountdownLabelSubstitutesCountdown() {
        XCTAssertEqual(
            SessionExpiringAccessibility.countdownLabel(countdown: "0:45", localize: passthroughLocalize),
            "You will be signed out in 0:45."
        )
    }

    func testDraftsLabelAppendsCount() {
        XCTAssertEqual(
            SessionExpiringAccessibility.draftsLabel(count: 3, localize: passthroughLocalize),
            "Unsaved drafts, 3"
        )
    }
}
