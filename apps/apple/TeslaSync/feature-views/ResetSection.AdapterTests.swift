//
//  ResetSection.AdapterTests.swift
//  TeslaSync — P4 feature view · 0212 · ResetSection (Apple)
//
//  Unit coverage for the pure projection core (`ResetAdapter` + `ResetCatalog` + the
//  domain types):
//    • the canonical section catalog + deny-list (web `useSectionRows` / `useDeniedRows`),
//    • the render-phase resolver,
//    • the status-banner projection + precedence (the P4 states contract),
//    • the success-toast detail counter (web `successDetail`),
//    • the confirm title/message templating,
//    • the typed-"RESET" confirmation predicate,
//    • the disabled predicates,
//    • the VoiceOver summaries.
//  Everything here is host-free (no store, no bundle, no rendered view).
//

import XCTest
@testable import TeslaSync

// MARK: - Catalog

@MainActor final class ResetCatalogTests: XCTestCase {
    func testSectionCatalogMatchesWebAllowlistInOrder() {
        let ids = ResetCatalog.defaultSections.map(\.id)
        XCTAssertEqual(ids, [
            "general",
            "appearance",
            "alert_rules",
            "geofences",
            "notification_channels",
            "dashboard_layout",
            "automations",
            "quiet_hours"
        ])
    }

    func testEverySectionRowCarriesIconTitleAndDescription() {
        for row in ResetCatalog.defaultSections {
            XCTAssertFalse(row.systemImage.isEmpty)
            XCTAssertFalse(row.titleFallback.isEmpty)
            XCTAssertFalse(row.descriptionFallback.isEmpty)
        }
    }

    func testDenyListMatchesWebDeniedRows() {
        XCTAssertEqual(ResetCatalog.deniedSections.map(\.id), ["tariffs", "sound_prefs"])
        XCTAssertEqual(ResetCatalog.deniedSections[0].titleFallback, "Charge cost tariffs")
        XCTAssertEqual(ResetCatalog.deniedSections[1].titleFallback, "Notification sound preferences")
    }

    func testRowResolversUseTheLocalizer() {
        let echo: ResetLocalize = { _, fallback in fallback }
        let general = ResetCatalog.defaultSections[0]
        XCTAssertEqual(general.title(echo), "General preferences")
        XCTAssertEqual(
            general.description(echo),
            "Units, language, currency, timezone, and energy/gas pricing defaults."
        )
    }
}

// MARK: - Phase resolver

@MainActor final class ResetPhaseResolverTests: XCTestCase {
    func testLoadingStatusHoldsSkeleton() {
        XCTAssertEqual(ResetPhaseResolver.resolve(status: .loading), .loading)
    }

    func testLoadedAndFailedRevealTheSurface() {
        XCTAssertEqual(ResetPhaseResolver.resolve(status: .loaded), .ready)
        XCTAssertEqual(ResetPhaseResolver.resolve(status: .failed("x")), .ready)
    }
}

// MARK: - Status banner + precedence

@MainActor final class ResetStatusBannerTests: XCTestCase {
    func testFreshLoadedListHasNoBanner() {
        XCTAssertNil(ResetAdapter.statusBanner(status: .loaded, freshness: .fresh))
    }

    func testFailedListProjectsRetryableErrorBanner() {
        let banner = ResetAdapter.statusBanner(status: .failed("boom"), freshness: .fresh)
        XCTAssertEqual(banner?.tone, .error)
        XCTAssertEqual(banner?.showsRetry, true)
    }

    func testStaleListProjectsRetryableStaleBanner() {
        let banner = ResetAdapter.statusBanner(status: .loaded, freshness: .stale)
        XCTAssertEqual(banner?.tone, .stale)
        XCTAssertEqual(banner?.showsRetry, true)
    }

    func testOfflineProjectsNonRetryableOfflineBanner() {
        let banner = ResetAdapter.statusBanner(status: .loaded, freshness: .offline)
        XCTAssertEqual(banner?.tone, .offline)
        XCTAssertEqual(banner?.showsRetry, false)
    }

    func testOfflineTakesPrecedenceOverFailure() {
        let banner = ResetAdapter.statusBanner(status: .failed("boom"), freshness: .offline)
        XCTAssertEqual(banner?.tone, .offline)
    }
}

// MARK: - Success-toast detail

@MainActor final class ResetSuccessDetailTests: XCTestCase {
    private let echo: ResetLocalize = { _, fallback in fallback }

    func testSuccessDetailSubstitutesCountAndSections() {
        XCTAssertEqual(
            ResetAdapter.successDetail(reset: 12, sectionsCount: 3, localize: echo),
            "12 item(s) reset across 3 section(s)."
        )
    }

    func testSuccessDetailClampsNegativesToZero() {
        XCTAssertEqual(
            ResetAdapter.successDetail(reset: -4, sectionsCount: -1, localize: echo),
            "0 item(s) reset across 0 section(s)."
        )
    }
}

// MARK: - Confirm templating

@MainActor final class ResetConfirmTemplateTests: XCTestCase {
    private let echo: ResetLocalize = { _, fallback in fallback }

    func testConfirmSectionTitleSubstitutesName() {
        XCTAssertEqual(
            ResetAdapter.confirmSectionTitle(name: "Geofences", localize: echo),
            "Reset Geofences?"
        )
    }

    func testConfirmSectionMessageAppendsPermanence() {
        XCTAssertEqual(
            ResetAdapter.confirmSectionMessage(description: "Delete every geofence.", localize: echo),
            "Delete every geofence. This action is permanent."
        )
    }
}

// MARK: - Typed confirmation

@MainActor final class ResetTypedConfirmTests: XCTestCase {
    func testExactPhraseArmsConfirmation() {
        XCTAssertTrue(ResetAdapter.canConfirmResetAll(input: "RESET"))
    }

    func testSurroundingWhitespaceIsTrimmed() {
        XCTAssertTrue(ResetAdapter.canConfirmResetAll(input: "  RESET \n"))
    }

    func testWrongCaseOrPartialDoesNotArm() {
        XCTAssertFalse(ResetAdapter.canConfirmResetAll(input: "reset"))
        XCTAssertFalse(ResetAdapter.canConfirmResetAll(input: "Reset"))
        XCTAssertFalse(ResetAdapter.canConfirmResetAll(input: "RESETT"))
        XCTAssertFalse(ResetAdapter.canConfirmResetAll(input: "RES"))
        XCTAssertFalse(ResetAdapter.canConfirmResetAll(input: ""))
    }
}

// MARK: - Disabled predicates

@MainActor final class ResetDisabledTests: XCTestCase {
    func testSectionResetDisabledOnlyForTheInFlightRow() {
        XCTAssertTrue(ResetAdapter.isSectionResetDisabled(rowID: "general", resettingSectionID: "general"))
        XCTAssertFalse(ResetAdapter.isSectionResetDisabled(rowID: "general", resettingSectionID: "appearance"))
        XCTAssertFalse(ResetAdapter.isSectionResetDisabled(rowID: "general", resettingSectionID: nil))
    }

    func testResetAllDisabledOnlyWhileInFlight() {
        XCTAssertTrue(ResetAdapter.isResetAllDisabled(isResettingAll: true))
        XCTAssertFalse(ResetAdapter.isResetAllDisabled(isResettingAll: false))
    }
}

// MARK: - Accessibility summaries

@MainActor final class ResetAccessibilityTests: XCTestCase {
    private let echo: ResetLocalize = { _, fallback in fallback }

    func testSectionAccessibilityCombinesTitleAndDescription() {
        let row = ResetCatalog.defaultSections[0]
        let summary = ResetAdapter.sectionAccessibility(row: row, localize: echo)
        XCTAssertTrue(summary.contains("General preferences"))
        XCTAssertTrue(summary.contains("energy/gas pricing defaults"))
    }

    func testDeniedAccessibilityCombinesTitleAndReason() {
        let row = ResetCatalog.deniedSections[0]
        let summary = ResetAdapter.deniedAccessibility(row: row, localize: echo)
        XCTAssertTrue(summary.contains("Charge cost tariffs"))
        XCTAssertTrue(summary.contains("stored per-vehicle"))
    }
}
