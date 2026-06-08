//
//  PrivacySection.AdapterTests.swift
//  TeslaSync — P4 feature view · 0209 · PrivacySection (Apple)
//
//  Unit coverage for the pure projection core (`PrivacyAdapter` + its domain types):
//    • the consent domain (parse / storage round-trip),
//    • the consent state label + on/off body (web `consentLabel` / `requireConsent ? …`),
//    • the stored-count counter + empty predicate,
//    • the disabled predicates (web `disabled`),
//    • the status-banner projection + precedence,
//    • the phase resolver,
//    • the VoiceOver summaries.
//  Everything here is host-free (no store, no bundle, no rendered view).
//

import XCTest
@testable import TeslaSync

// MARK: - Consent domain

@MainActor final class PrivacyConsentStateTests: XCTestCase {
    func testParseMapsExplicitDecisionsAndFoldsEverythingElseToUnknown() {
        XCTAssertEqual(PrivacyConsentState.parse("accepted"), .accepted)
        XCTAssertEqual(PrivacyConsentState.parse("declined"), .declined)
        XCTAssertEqual(PrivacyConsentState.parse(nil), .unknown)
        XCTAssertEqual(PrivacyConsentState.parse(""), .unknown)
        XCTAssertEqual(PrivacyConsentState.parse("garbage"), .unknown)
    }

    func testStorageValueRoundTrips() {
        XCTAssertNil(PrivacyConsentState.unknown.storageValue)
        XCTAssertEqual(PrivacyConsentState.accepted.storageValue, "accepted")
        XCTAssertEqual(PrivacyConsentState.declined.storageValue, "declined")
        for state in PrivacyConsentState.allCases {
            XCTAssertEqual(PrivacyConsentState.parse(state.storageValue), state)
        }
    }
}

// MARK: - Consent copy

@MainActor final class PrivacyConsentCopyTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testConsentStateLabelMatchesWebBranches() {
        XCTAssertEqual(
            PrivacyAdapter.consentStateLabel(.accepted, localize: echo),
            "Accepted — performance & error reporting on"
        )
        XCTAssertEqual(
            PrivacyAdapter.consentStateLabel(.declined, localize: echo),
            "Declined — only essential storage in use"
        )
        XCTAssertEqual(
            PrivacyAdapter.consentStateLabel(.unknown, localize: echo),
            "Not decided — banner will appear on next visit"
        )
    }

    func testConsentBodySwitchesOnRequireConsent() {
        let on = PrivacyAdapter.consentBody(requireConsent: true, localize: echo)
        let off = PrivacyAdapter.consentBody(requireConsent: false, localize: echo)
        XCTAssertTrue(on.contains("collects anonymous performance"))
        XCTAssertTrue(off.contains("does not require consent collection"))
        XCTAssertNotEqual(on, off)
    }
}

// MARK: - Recent-pages counter + empty

@MainActor final class PrivacyRecentCounterTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testRecentIsEmptyAtZeroOrBelow() {
        XCTAssertTrue(PrivacyAdapter.recentIsEmpty(count: 0))
        XCTAssertTrue(PrivacyAdapter.recentIsEmpty(count: -3))
        XCTAssertFalse(PrivacyAdapter.recentIsEmpty(count: 1))
    }

    func testRecentCountTextSubstitutesTheCount() {
        XCTAssertEqual(PrivacyAdapter.recentCountText(count: 12, localize: echo), "12 entries stored")
        XCTAssertEqual(PrivacyAdapter.recentCountText(count: 0, localize: echo), "0 entries stored")
        // Negative counts are clamped to zero before formatting.
        XCTAssertEqual(PrivacyAdapter.recentCountText(count: -5, localize: echo), "0 entries stored")
    }
}

// MARK: - Disabled predicates (web `disabled`)

@MainActor final class PrivacyDisabledTests: XCTestCase {
    func testClearDisabledOnlyWhenEmpty() {
        XCTAssertTrue(PrivacyAdapter.isClearDisabled(count: 0))
        XCTAssertFalse(PrivacyAdapter.isClearDisabled(count: 4))
    }

    func testAcceptDisabledOnlyWhenAlreadyAccepted() {
        XCTAssertTrue(PrivacyAdapter.isConsentActionDisabled(.accept, consent: .accepted))
        XCTAssertFalse(PrivacyAdapter.isConsentActionDisabled(.accept, consent: .declined))
        XCTAssertFalse(PrivacyAdapter.isConsentActionDisabled(.accept, consent: .unknown))
    }

    func testDeclineDisabledOnlyWhenAlreadyDeclined() {
        XCTAssertTrue(PrivacyAdapter.isConsentActionDisabled(.decline, consent: .declined))
        XCTAssertFalse(PrivacyAdapter.isConsentActionDisabled(.decline, consent: .accepted))
        XCTAssertFalse(PrivacyAdapter.isConsentActionDisabled(.decline, consent: .unknown))
    }

    func testResetDisabledOnlyWhenUnknown() {
        XCTAssertTrue(PrivacyAdapter.isConsentActionDisabled(.reset, consent: .unknown))
        XCTAssertFalse(PrivacyAdapter.isConsentActionDisabled(.reset, consent: .accepted))
        XCTAssertFalse(PrivacyAdapter.isConsentActionDisabled(.reset, consent: .declined))
    }
}

// MARK: - Status banner + precedence

@MainActor final class PrivacyStatusBannerTests: XCTestCase {
    func testFreshLoadedPolicyHasNoBanner() {
        XCTAssertNil(PrivacyAdapter.statusBanner(status: .loaded, freshness: .fresh))
    }

    func testFailedPolicyProjectsRetryableErrorBanner() {
        let banner = PrivacyAdapter.statusBanner(status: .failed("boom"), freshness: .fresh)
        XCTAssertEqual(banner?.tone, .error)
        XCTAssertEqual(banner?.showsRetry, true)
    }

    func testStalePolicyProjectsRetryableStaleBanner() {
        let banner = PrivacyAdapter.statusBanner(status: .loaded, freshness: .stale)
        XCTAssertEqual(banner?.tone, .stale)
        XCTAssertEqual(banner?.showsRetry, true)
    }

    func testOfflineProjectsNonRetryableOfflineBanner() {
        let banner = PrivacyAdapter.statusBanner(status: .loaded, freshness: .offline)
        XCTAssertEqual(banner?.tone, .offline)
        XCTAssertEqual(banner?.showsRetry, false)
    }

    func testOfflineTakesPrecedenceOverFailure() {
        let banner = PrivacyAdapter.statusBanner(status: .failed("boom"), freshness: .offline)
        XCTAssertEqual(banner?.tone, .offline)
    }
}

// MARK: - Phase resolver

@MainActor final class PrivacyPhaseResolverTests: XCTestCase {
    func testLoadingStatusHoldsSkeleton() {
        XCTAssertEqual(PrivacyPhaseResolver.resolve(status: .loading), .loading)
    }

    func testLoadedAndFailedRevealTheSection() {
        XCTAssertEqual(PrivacyPhaseResolver.resolve(status: .loaded), .ready)
        XCTAssertEqual(PrivacyPhaseResolver.resolve(status: .failed("x")), .ready)
    }
}

// MARK: - Accessibility summaries

@MainActor final class PrivacyAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testRecentAccessibilityUsesCounterWhenPopulated() {
        let summary = PrivacyAdapter.recentAccessibility(count: 7, localize: echo)
        XCTAssertTrue(summary.contains("Recently viewed pages"))
        XCTAssertTrue(summary.contains("7 entries stored"))
    }

    func testRecentAccessibilityUsesEmptyHintWhenEmpty() {
        let summary = PrivacyAdapter.recentAccessibility(count: 0, localize: echo)
        XCTAssertTrue(summary.contains("No recently viewed pages yet"))
    }

    func testConsentAccessibilityIncludesTitleAndStateLabel() {
        let summary = PrivacyAdapter.consentAccessibility(consent: .accepted, localize: echo)
        XCTAssertTrue(summary.contains("Cookies & analytics consent"))
        XCTAssertTrue(summary.contains("Accepted — performance & error reporting on"))
    }
}
