//
//  CookieConsentBanner.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0115 · CookieConsentBanner (Apple)
//
//  Adapter coverage for the CookieConsentBanner surface — the pure, Foundation-only core:
//    • ConsentDecision — the web `getConsent` parse contract (incl. the missing-key → unknown rule)
//      and the `setConsent` storage round-trip.
//    • ConsentChoice — accept / decline → decision mapping.
//    • CookieConsentGuard — the verbatim port of the two-line `return null` visibility guard.
//    • ConsentCatalog — the two informed-consent cards (essential "Always on" + analytics) and order.
//    • ConsentDisclosure — the Manage / Hide ternary.
//    • CookieConsentAdapter — the offline → error → stale status-chip precedence and the VoiceOver
//      summaries.
//  No store, no bundle, no view — each assertion reads the pure adapter directly. Runs in the
//  TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

private let identity: CookieConsentResolve = { _, fallback in fallback }

// MARK: - Consent domain (web `lib/cookieConsent`)

final class ConsentDecisionTests: XCTestCase {
    func testParseMapsExplicitDecisions() {
        XCTAssertEqual(ConsentDecision.parse("accepted"), .accepted)
        XCTAssertEqual(ConsentDecision.parse("declined"), .declined)
    }

    func testParseTreatsMissingOrUnknownTokenAsUnknown() {
        XCTAssertEqual(ConsentDecision.parse(nil), .unknown)
        XCTAssertEqual(ConsentDecision.parse(""), .unknown)
        XCTAssertEqual(ConsentDecision.parse("garbage"), .unknown)
        XCTAssertEqual(ConsentDecision.parse("ACCEPTED"), .unknown) // case-sensitive, web parity
    }

    func testStorageValueRoundTrips() {
        XCTAssertNil(ConsentDecision.unknown.storageValue)
        XCTAssertEqual(ConsentDecision.accepted.storageValue, "accepted")
        XCTAssertEqual(ConsentDecision.declined.storageValue, "declined")
        for decision in [ConsentDecision.accepted, .declined] {
            XCTAssertEqual(ConsentDecision.parse(decision.storageValue), decision)
        }
    }
}

final class ConsentChoiceTests: XCTestCase {
    func testChoiceMapsToDecision() {
        XCTAssertEqual(ConsentChoice.accept.decision, .accepted)
        XCTAssertEqual(ConsentChoice.decline.decision, .declined)
    }
}

// MARK: - Visibility guard (web two-line `return null`)

final class CookieConsentGuardTests: XCTestCase {
    func testDormantWhenConsentNotRequired() {
        // Even with no decision, a deployment that does not require consent shows nothing.
        XCTAssertEqual(
            CookieConsentGuard.resolve(requireConsent: false, decision: .unknown),
            .dormant
        )
    }

    func testDormantWhenAlreadyDecided() {
        XCTAssertEqual(CookieConsentGuard.resolve(requireConsent: true, decision: .accepted), .dormant)
        XCTAssertEqual(CookieConsentGuard.resolve(requireConsent: true, decision: .declined), .dormant)
    }

    func testPresentedOnlyWhenRequiredAndUndecided() {
        XCTAssertEqual(CookieConsentGuard.resolve(requireConsent: true, decision: .unknown), .presented)
    }

    func testDecidedBeatsRequiredEvenWhenNotRequired() {
        // Not required AND decided → still dormant (both guards point dormant).
        XCTAssertEqual(CookieConsentGuard.resolve(requireConsent: false, decision: .accepted), .dormant)
    }
}

// MARK: - Informed-consent catalog (web details `<ul>`)

final class ConsentCatalogTests: XCTestCase {
    func testTwoCategoriesInOrder() {
        let categories = ConsentCatalog.categories
        XCTAssertEqual(categories.count, 2)
        XCTAssertEqual(categories.map(\.id), ["essential", "analytics"])
    }

    func testEssentialIsAlwaysOnAndAnalyticsIsNot() {
        XCTAssertTrue(ConsentCatalog.essential.alwaysOn)
        XCTAssertFalse(ConsentCatalog.analytics.alwaysOn)
    }

    func testCategoryKeysAndFallbacksMatchWebCopy() {
        XCTAssertEqual(ConsentCatalog.essential.titleKey, "consent.category.essential.title")
        XCTAssertEqual(ConsentCatalog.essential.titleFallback, "Strictly necessary")
        XCTAssertEqual(ConsentCatalog.analytics.titleKey, "consent.category.analytics.title")
        XCTAssertEqual(ConsentCatalog.analytics.titleFallback, "Performance & error reporting")
        XCTAssertTrue(ConsentCatalog.essential.bodyFallback.contains("ePrivacy directive"))
        XCTAssertTrue(ConsentCatalog.analytics.bodyFallback.contains("Core Web Vitals"))
    }
}

// MARK: - Disclosure (web Manage / Hide ternary)

final class ConsentDisclosureTests: XCTestCase {
    func testManageWhenCollapsed() {
        XCTAssertEqual(ConsentDisclosure.titleKey(expanded: false), "consent.banner.manage")
        XCTAssertEqual(ConsentDisclosure.titleFallback(expanded: false), "Manage preferences")
        XCTAssertEqual(ConsentDisclosure.title(expanded: false, localize: identity), "Manage preferences")
    }

    func testHideWhenExpanded() {
        XCTAssertEqual(ConsentDisclosure.titleKey(expanded: true), "consent.banner.hideDetails")
        XCTAssertEqual(ConsentDisclosure.titleFallback(expanded: true), "Hide details")
        XCTAssertEqual(ConsentDisclosure.title(expanded: true, localize: identity), "Hide details")
    }
}

// MARK: - Status chip (P4 freshness precedence)

final class CookieConsentStatusChipTests: XCTestCase {
    func testFreshLoadedYieldsNoChip() {
        XCTAssertNil(CookieConsentAdapter.statusChip(status: .loaded, freshness: .fresh))
    }

    func testOfflineTakesPrecedenceOverFailure() {
        // Offline is the root cause — it wins even when the status is also failed.
        let chip = CookieConsentAdapter.statusChip(status: .failed("x"), freshness: .offline)
        XCTAssertEqual(chip?.tone, .offline)
        XCTAssertEqual(chip?.showsRetry, false)
    }

    func testFailureBeatsStale() {
        let chip = CookieConsentAdapter.statusChip(status: .failed("boom"), freshness: .stale)
        XCTAssertEqual(chip?.tone, .error)
        XCTAssertEqual(chip?.showsRetry, true)
        XCTAssertEqual(chip?.messageKey, "consent.status.error")
    }

    func testStaleWhenLoadedButStale() {
        let chip = CookieConsentAdapter.statusChip(status: .loaded, freshness: .stale)
        XCTAssertEqual(chip?.tone, .stale)
        XCTAssertEqual(chip?.showsRetry, true)
    }

    func testChipMessageResolvesThroughFacade() {
        let chip = CookieConsentAdapter.statusChip(status: .loaded, freshness: .offline)
        XCTAssertEqual(chip?.message(identity), "Offline — showing the last known consent policy")
    }
}

// MARK: - Accessibility summaries

final class CookieConsentAccessibilityTests: XCTestCase {
    func testDialogLabelReadsTitleThenBody() {
        let label = CookieConsentAdapter.dialogLabel(localize: identity)
        XCTAssertTrue(label.hasPrefix("Cookies & analytics. "))
        XCTAssertTrue(label.contains("Settings → Privacy"))
    }

    func testCategoryAccessibilityIncludesAlwaysOnForEssential() {
        let label = CookieConsentAdapter.categoryAccessibility(ConsentCatalog.essential, localize: identity)
        XCTAssertEqual(
            label,
            "Strictly necessary. Always on. Authentication, session, theme, and saved drafts. "
                + "Required for the app to work and exempt from consent under the ePrivacy directive."
        )
    }

    func testCategoryAccessibilityOmitsAlwaysOnForAnalytics() {
        let label = CookieConsentAdapter.categoryAccessibility(ConsentCatalog.analytics, localize: identity)
        XCTAssertTrue(label.hasPrefix("Performance & error reporting. "))
        XCTAssertFalse(label.contains("Always on"))
    }
}
