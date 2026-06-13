//
//  ImpersonationBanner.Tests.swift
//  TeslaSync — P4 shared surface · 0123 · ImpersonationBanner (Apple)
//
//  Adapter + projection coverage for the ImpersonationBanner surface:
//    • Status — the discriminated value (web `useImpersonationStatus().data`) and the active-subject
//      accessor.
//    • Copy — the verbatim web keys (`impersonation.banner.title` / `.body` / `.endsIn` / `.expired` /
//      `.end` / `.ending`) and the title / countdown interpolation tokens.
//    • Title — the `{target}` interpolation (web `t('…title', { target })`), including a token-less
//      template.
//    • Countdown — the `formatRemaining` port (HHh MMm / MMm SSs / SSs, zero-padding, clamp), the
//      whole-millisecond remainder, and the `remaining > 1000 ? endsIn : expired` select.
//    • Projection — the render branches plus the P4 leaf contract across loading / empty-inactive /
//      empty-unavailable / error / data, including precedence and the end-pending flag.
//    • Accessibility — the composed VoiceOver banner label (web `role="alert"` region).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no gateway and no clock, so each
//  assertion reads the pure adapter / projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Status (web `useImpersonationStatus().data`)

final class ImpersonationBannerStatusTests: XCTestCase {
    func testActiveSubjectAccessorReturnsSubjectWhenActive() {
        let subject = ImpersonationBannerSubject(target: "bob", originalAdmin: "root", expiresAt: nil)
        XCTAssertEqual(ImpersonationBannerStatus.active(subject).activeSubject, subject)
    }

    func testActiveSubjectAccessorIsNilWhenNotActive() {
        XCTAssertNil(ImpersonationBannerStatus.inactive.activeSubject)
        XCTAssertNil(ImpersonationBannerStatus.unavailable.activeSubject)
    }
}

// MARK: - Copy (web `impersonation.banner.*`)

final class ImpersonationBannerCopyTests: XCTestCase {
    func testKeysMatchWebSourceVerbatim() {
        XCTAssertEqual(ImpersonationBannerCopy.titleKey, "impersonation.banner.title")
        XCTAssertEqual(ImpersonationBannerCopy.bodyKey, "impersonation.banner.body")
        XCTAssertEqual(ImpersonationBannerCopy.endsInKey, "impersonation.banner.endsIn")
        XCTAssertEqual(ImpersonationBannerCopy.expiredKey, "impersonation.banner.expired")
        XCTAssertEqual(ImpersonationBannerCopy.endKey, "impersonation.banner.end")
        XCTAssertEqual(ImpersonationBannerCopy.endingKey, "impersonation.banner.ending")
    }

    func testTitleCarriesTargetTokenAndEndsInCarriesTimeToken() {
        XCTAssertTrue(ImpersonationBannerCopy.titleFallback.contains(ImpersonationBannerTitle.targetToken))
        XCTAssertTrue(ImpersonationBannerCopy.endsInFallback.contains(ImpersonationBannerCountdown.timeToken))
    }

    func testFallbacksAreNonEmpty() {
        XCTAssertFalse(ImpersonationBannerCopy.bodyFallback.isEmpty)
        XCTAssertFalse(ImpersonationBannerCopy.expiredFallback.isEmpty)
        XCTAssertFalse(ImpersonationBannerCopy.endFallback.isEmpty)
        XCTAssertFalse(ImpersonationBannerCopy.endingFallback.isEmpty)
    }
}

// MARK: - Title interpolation (web i18next `{{target}}`)

final class ImpersonationBannerTitleTests: XCTestCase {
    func testSubstitutesTarget() {
        XCTAssertEqual(
            ImpersonationBannerTitle.text(target: "subject-aa10", template: "Impersonating {target}"),
            "Impersonating subject-aa10"
        )
    }

    func testToleratesTemplateWithoutToken() {
        XCTAssertEqual(
            ImpersonationBannerTitle.text(target: "bob", template: "Active impersonation"),
            "Active impersonation"
        )
    }
}

// MARK: - Countdown (web `formatRemaining` + the threshold select)

final class ImpersonationBannerCountdownTests: XCTestCase {
    func testFormatHoursZeroPadsMinutes() {
        XCTAssertEqual(ImpersonationBannerCountdown.format(millis: 3_900_000), "1h 05m")
        XCTAssertEqual(ImpersonationBannerCountdown.format(millis: (95 * 60 + 12) * 1000), "1h 35m")
    }

    func testFormatMinutesZeroPadsSeconds() {
        XCTAssertEqual(ImpersonationBannerCountdown.format(millis: (5 * 60 + 3) * 1000), "5m 03s")
    }

    func testFormatSecondsOnly() {
        XCTAssertEqual(ImpersonationBannerCountdown.format(millis: 42000), "42s")
    }

    func testFormatClampsNegativeToZero() {
        XCTAssertEqual(ImpersonationBannerCountdown.format(millis: -5000), "0s")
    }

    func testRemainingMillisIsWholeMillisecondDelta() {
        let now = Date(timeIntervalSince1970: 0)
        let expires = now.addingTimeInterval(5)
        XCTAssertEqual(ImpersonationBannerCountdown.remainingMillis(expiresAt: expires, now: now), 5000)
    }

    func testTextIsNilWithoutExpiry() {
        XCTAssertNil(ImpersonationBannerCountdown.text(
            expiresAt: nil, now: Date(), endsInTemplate: "Expires in {time}", expiredText: "Session expired"
        ))
    }

    func testTextInterpolatesAboveThreshold() {
        let now = Date(timeIntervalSince1970: 0)
        let expires = now.addingTimeInterval(125)
        XCTAssertEqual(
            ImpersonationBannerCountdown.text(
                expiresAt: expires, now: now, endsInTemplate: "Expires in {time}", expiredText: "Session expired"
            ),
            "Expires in 2m 05s"
        )
    }

    func testTextReadsExpiredAtOrBelowThreshold() {
        let now = Date(timeIntervalSince1970: 0)
        let expires = now.addingTimeInterval(1)
        XCTAssertEqual(
            ImpersonationBannerCountdown.text(
                expiresAt: expires, now: now, endsInTemplate: "Expires in {time}", expiredText: "Session expired"
            ),
            "Session expired"
        )
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class ImpersonationBannerProjectionTests: XCTestCase {
    private let expires = Date(timeIntervalSince1970: 1_700_000_000)

    private func subject(isEnding _: Bool = false) -> ImpersonationBannerSubject {
        ImpersonationBannerSubject(target: "subject-aa10", originalAdmin: "admin-root", expiresAt: expires)
    }

    func testActiveProjectsDataWithSubjectFields() throws {
        let resolved = ImpersonationBannerProjection.resolve(
            input: ImpersonationBannerInput(status: .active(subject()))
        )
        XCTAssertEqual(resolved.phase, .data)
        let data = try XCTUnwrap(resolved.data)
        XCTAssertEqual(data.target, "subject-aa10")
        XCTAssertEqual(data.originalAdmin, "admin-root")
        XCTAssertEqual(data.expiresAt, expires)
        XCTAssertFalse(data.isEnding)
        XCTAssertNil(resolved.emptyKind)
    }

    func testActiveCarriesEndingFlag() throws {
        let resolved = ImpersonationBannerProjection.resolve(
            input: ImpersonationBannerInput(status: .active(subject()), isEnding: true)
        )
        let data = try XCTUnwrap(resolved.data)
        XCTAssertTrue(data.isEnding)
    }

    func testInactiveProjectsEmptyInactive() {
        let resolved = ImpersonationBannerProjection.resolve(input: ImpersonationBannerInput(status: .inactive))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.emptyKind, .inactive)
        XCTAssertNil(resolved.data)
    }

    func testUnavailableProjectsEmptyUnavailable() {
        let resolved = ImpersonationBannerProjection.resolve(input: ImpersonationBannerInput(status: .unavailable))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.emptyKind, .unavailable)
    }

    func testLoadingProjectsLoading() {
        let resolved = ImpersonationBannerProjection.resolve(
            input: ImpersonationBannerInput(status: .inactive, isLoading: true)
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testErrorProjectsError() {
        let resolved = ImpersonationBannerProjection.resolve(
            input: ImpersonationBannerInput(status: .active(subject()), errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.data)
    }

    func testErrorBeatsLoading() {
        let resolved = ImpersonationBannerProjection.resolve(
            input: ImpersonationBannerInput(status: .inactive, isLoading: true, errorMessage: "timeout")
        )
        XCTAssertEqual(resolved.phase, .error("timeout"))
    }

    func testEmptyErrorMessageDoesNotForceError() {
        let resolved = ImpersonationBannerProjection.resolve(
            input: ImpersonationBannerInput(status: .active(subject()), errorMessage: "")
        )
        XCTAssertEqual(resolved.phase, .data)
    }

    func testLoadingBeatsActive() {
        let resolved = ImpersonationBannerProjection.resolve(
            input: ImpersonationBannerInput(status: .active(subject()), isLoading: true)
        )
        XCTAssertEqual(resolved.phase, .loading)
    }
}

// MARK: - Accessibility

final class ImpersonationBannerAccessibilityTests: XCTestCase {
    func testSentenceJoinsWithTerminalPeriod() {
        XCTAssertEqual(
            ImpersonationBannerAccessibility.sentence(["Impersonating bob", "End to restore"]),
            "Impersonating bob. End to restore"
        )
    }

    func testSentenceDoesNotDoubleTerminalPunctuation() {
        XCTAssertEqual(
            ImpersonationBannerAccessibility.sentence(["Impersonating bob.", "Expires in 2m 05s"]),
            "Impersonating bob. Expires in 2m 05s"
        )
    }

    func testSentenceSkipsEmptyParts() {
        XCTAssertEqual(ImpersonationBannerAccessibility.sentence(["", "Only body"]), "Only body")
    }

    func testBannerLabelIncludesCountdownWhenPresent() {
        XCTAssertEqual(
            ImpersonationBannerAccessibility.bannerLabel(
                title: "Impersonating bob",
                body: "End impersonation to restore your session.",
                countdown: "Expires in 2m 05s"
            ),
            "Impersonating bob. End impersonation to restore your session. Expires in 2m 05s"
        )
    }

    func testBannerLabelOmitsCountdownWhenNil() {
        XCTAssertEqual(
            ImpersonationBannerAccessibility.bannerLabel(
                title: "Impersonating bob",
                body: "Restore your session.",
                countdown: nil
            ),
            "Impersonating bob. Restore your session."
        )
    }
}
