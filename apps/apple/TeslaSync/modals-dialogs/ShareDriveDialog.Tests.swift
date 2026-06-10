//
//  ShareDriveDialog.Tests.swift
//  TeslaSync — P4 modal / dialog · 0028 · ShareDriveDialog (Apple)
//
//  Adapter + projection + seam + accessibility coverage for the ShareDriveDialog surface:
//    • `ShareExpiry` — the web `<Select>` option values + the `expires_in_days` mapping (Never → nil).
//    • `ShareDriveProjection` — the links phase matrix, the per-row expiry status (web `isExpired`
//      ternary), the create-request builder (`title || undefined`), and the presentation-row projection.
//    • `DefaultShareDriveURLBuilder` — the `${origin}/s/${token}` composition (trailing-slash safe).
//    • `DefaultShareDriveDateFormatting` — the medium expiry date (web `formatDate`).
//    • `ShareDriveAccessibility` — the dialog + row VoiceOver content.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy without a
/// bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// A fixed reference instant (2026-01-01 12:00:00 UTC) for deterministic expiry comparisons.
private let referenceNow = Date(timeIntervalSince1970: 1_767_268_800)

// MARK: - Expiry options (web `<Select>` values)

final class ShareExpiryTests: XCTestCase {
    func testOptionValuesMatchWeb() {
        XCTAssertEqual(ShareExpiry.days7.optionValue, "7")
        XCTAssertEqual(ShareExpiry.days30.optionValue, "30")
        XCTAssertEqual(ShareExpiry.days90.optionValue, "90")
        XCTAssertEqual(ShareExpiry.never.optionValue, "0")
    }

    func testExpiresInDaysMapsNeverToNil() {
        XCTAssertEqual(ShareExpiry.days7.expiresInDays, 7)
        XCTAssertEqual(ShareExpiry.days30.expiresInDays, 30)
        XCTAssertEqual(ShareExpiry.days90.expiresInDays, 90)
        XCTAssertNil(ShareExpiry.never.expiresInDays)
    }

    func testAllCasesOrder() {
        XCTAssertEqual(ShareExpiry.allCases, [.days7, .days30, .days90, .never])
    }

    func testLabelFallbacks() {
        XCTAssertEqual(ShareExpiry.days7.labelFallback, "7 days")
        XCTAssertEqual(ShareExpiry.days30.labelFallback, "30 days")
        XCTAssertEqual(ShareExpiry.days90.labelFallback, "90 days")
        XCTAssertEqual(ShareExpiry.never.labelFallback, "Never")
    }
}

// MARK: - Expiry status (web `isExpired` ternary)

final class ShareDriveExpiryStateTests: XCTestCase {
    func testNilExpiryIsNone() {
        XCTAssertEqual(ShareDriveProjection.expiryState(nil, now: referenceNow), .none)
    }

    func testPastExpiryIsExpired() {
        let past = referenceNow.addingTimeInterval(-3600)
        XCTAssertEqual(ShareDriveProjection.expiryState(past, now: referenceNow), .expired)
    }

    func testFutureExpiryIsActiveCarryingTheInstant() {
        let future = referenceNow.addingTimeInterval(3600)
        XCTAssertEqual(ShareDriveProjection.expiryState(future, now: referenceNow), .active(future))
    }

    func testEqualInstantIsActiveNotExpired() {
        // web `expires_at < new Date()` — an exactly-now expiry is not yet expired.
        XCTAssertEqual(ShareDriveProjection.expiryState(referenceNow, now: referenceNow), .active(referenceNow))
    }
}

// MARK: - Links phase matrix (web `sharesLoading` + `shares.length`)

final class ShareDriveLinksPhaseTests: XCTestCase {
    private func link(_ id: Int) -> ShareLink {
        ShareLink(id: id, token: "t\(id)", title: nil, views: 0, expiresAt: nil)
    }

    func testLoadingResolvesByPresence() {
        XCTAssertEqual(ShareDriveProjection.resolveLinksPhase(status: .loading, links: []), .loading)
        XCTAssertEqual(ShareDriveProjection.resolveLinksPhase(status: .loading, links: [link(1)]), .content)
    }

    func testLoadedResolvesEmptyOrContent() {
        XCTAssertEqual(ShareDriveProjection.resolveLinksPhase(status: .loaded, links: []), .empty)
        XCTAssertEqual(ShareDriveProjection.resolveLinksPhase(status: .loaded, links: [link(1)]), .content)
    }

    func testFailedResolvesErrorOnlyWithoutCachedRows() {
        XCTAssertEqual(
            ShareDriveProjection.resolveLinksPhase(status: .failed("boom"), links: []),
            .error("boom")
        )
        XCTAssertEqual(
            ShareDriveProjection.resolveLinksPhase(status: .failed("boom"), links: [link(1)]),
            .content
        )
    }
}

// MARK: - Create-request builder (web `handleCreate`)

final class ShareDriveCreateInputTests: XCTestCase {
    func testEmptyTitleBecomesNilNonEmptyPassesThrough() {
        let empty = ShareDriveProjection.createInput(
            title: "",
            includeSpeed: true,
            includeTelemetry: false,
            expiry: .days30
        )
        XCTAssertNil(empty.title)

        let named = ShareDriveProjection.createInput(
            title: "Road trip",
            includeSpeed: true,
            includeTelemetry: false,
            expiry: .days30
        )
        XCTAssertEqual(named.title, "Road trip")
    }

    func testTogglesAndExpiryPassThroughWithNeverAsNil() {
        let input = ShareDriveProjection.createInput(
            title: "x",
            includeSpeed: false,
            includeTelemetry: true,
            expiry: .never
        )
        XCTAssertFalse(input.includeSpeed)
        XCTAssertTrue(input.includeTelemetry)
        XCTAssertNil(input.expiresInDays)

        let bounded = ShareDriveProjection.createInput(
            title: "x",
            includeSpeed: true,
            includeTelemetry: false,
            expiry: .days90
        )
        XCTAssertEqual(bounded.expiresInDays, 90)
    }
}

// MARK: - Row projection (web `shares.map`)

final class ShareDriveRowsTests: XCTestCase {
    private let links: [ShareLink] = [
        ShareLink(id: 1, token: "abc", title: "Trip", views: 5, expiresAt: referenceNow.addingTimeInterval(3600)),
        ShareLink(id: 2, token: "def", title: nil, views: 0, expiresAt: referenceNow.addingTimeInterval(-3600)),
        ShareLink(id: 3, token: "ghi", title: "  ", views: 2, expiresAt: nil)
    ]

    func testProjectsIdentityExpiryAndURL() {
        let rows = ShareDriveProjection.rows(from: links, now: referenceNow) { "https://x.test/s/\($0)" }
        XCTAssertEqual(rows.map(\.id), [1, 2, 3])
        XCTAssertEqual(rows[0].shareURL, "https://x.test/s/abc")
        XCTAssertEqual(rows[0].expiry, .active(referenceNow.addingTimeInterval(3600)))
        XCTAssertEqual(rows[1].expiry, .expired)
        XCTAssertEqual(rows[2].expiry, .none)
    }

    func testIsUntitledForNilAndWhitespaceTitles() {
        let rows = ShareDriveProjection.rows(from: links, now: referenceNow) { $0 }
        XCTAssertFalse(rows[0].isUntitled) // "Trip"
        XCTAssertTrue(rows[1].isUntitled) // nil
        XCTAssertTrue(rows[2].isUntitled) // whitespace
    }
}

// MARK: - URL builder (web `${origin}/s/${token}`)

final class ShareDriveURLBuilderTests: XCTestCase {
    func testComposesOriginSlashSToken() {
        let builder = DefaultShareDriveURLBuilder(origin: "https://app.teslasync.io")
        XCTAssertEqual(builder.url(forToken: "tok123"), "https://app.teslasync.io/s/tok123")
    }

    func testNormalizesTrailingSlashOrigin() {
        let builder = DefaultShareDriveURLBuilder(origin: "https://app.teslasync.io/")
        XCTAssertEqual(builder.url(forToken: "tok123"), "https://app.teslasync.io/s/tok123")
    }
}

// MARK: - Date formatter (web `formatDate`)

final class ShareDriveDateFormattingTests: XCTestCase {
    func testMediumDateInUTCEnglish() {
        let formatter = DefaultShareDriveDateFormatting(
            timeZone: TimeZone(identifier: "UTC") ?? .current,
            locale: Locale(identifier: "en_US")
        )
        // 2026-01-01 00:00:00 UTC
        let date = Date(timeIntervalSince1970: 1_767_225_600)
        XCTAssertEqual(formatter.medium(date), "Jan 1, 2026")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

final class ShareDriveAccessibilityTests: XCTestCase {
    func testDialogLabelIsTitle() {
        XCTAssertEqual(ShareDriveAccessibility.dialogLabel(localize: passthroughLocalize), "Share Drive")
    }

    func testRowLabelJoinsTitleViewsExpiry() {
        let label = ShareDriveAccessibility.rowLabel(
            title: "Road trip",
            views: "5 views",
            expiry: "Expires Jan 1, 2026"
        )
        XCTAssertEqual(label, "Road trip, 5 views, Expires Jan 1, 2026")
    }
}
