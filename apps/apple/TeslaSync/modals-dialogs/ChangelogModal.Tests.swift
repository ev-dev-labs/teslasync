//
//  ChangelogModal.Tests.swift
//  TeslaSync — P4 modal / dialog · 0003 · ChangelogModal (Apple)
//
//  Adapter + projection + catalog + accessibility coverage for the ChangelogModal surface:
//    • `ChangelogProjection.compareVersions` — the verbatim port of the web semver comparator
//      (core ordering, pre-release-before-release, lexical fallback).
//    • the `newEntries` / `visibleEntries` / `isFirstVisit` selection and the `group` re-grouping.
//    • `ChangelogChangeType` / `ChangelogBadgeKind` — order + i18n keys + fallbacks.
//    • `ChangelogCatalog` — the ported six-release history (count, latest, lookup, integrity).
//    • `ChangelogAccessibility` — the dialog summary + entry + hint VoiceOver content.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy without a
/// bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum Sample {
    static func entry(_ ver: String, _ badge: ChangelogBadgeKind, _ chg: [ChangelogChange]) -> ChangelogReleaseEntry {
        ChangelogReleaseEntry(version: ver, date: "2026-01-01", badge: badge, changes: chg)
    }

    static func change(_ type: ChangelogChangeType, _ text: String) -> ChangelogChange {
        ChangelogChange(type: type, text: text)
    }

    static let history: [ChangelogReleaseEntry] = [
        entry("0.7.0", .latest, [change(.added, "A")]),
        entry("0.6.0", .stable, [change(.changed, "B")]),
        entry("0.5.0", .stable, [change(.fixed, "C")])
    ]
}

// MARK: - Semver comparator (web compareVersions)

final class ChangelogCompareVersionsTests: XCTestCase {
    func testEqualVersions() {
        XCTAssertEqual(ChangelogProjection.compareVersions("1.2.3", "1.2.3"), 0)
    }

    func testCoreOrdering() {
        XCTAssertEqual(ChangelogProjection.compareVersions("0.7.0", "0.6.0"), 1)
        XCTAssertEqual(ChangelogProjection.compareVersions("0.6.0", "0.7.0"), -1)
        XCTAssertEqual(ChangelogProjection.compareVersions("1.0.0", "0.9.9"), 1)
        XCTAssertEqual(ChangelogProjection.compareVersions("1.2.3", "1.2.10"), -1)
    }

    func testPreReleaseSortsBeforeRelease() {
        XCTAssertEqual(ChangelogProjection.compareVersions("1.0.0-beta.1", "1.0.0"), -1)
        XCTAssertEqual(ChangelogProjection.compareVersions("1.0.0", "1.0.0-beta.1"), 1)
    }

    func testPreReleaseLexicalCompare() {
        XCTAssertEqual(ChangelogProjection.compareVersions("1.0.0-beta.1", "1.0.0-beta.2"), -1)
        XCTAssertEqual(ChangelogProjection.compareVersions("1.0.0-rc.1", "1.0.0-beta.9"), 1)
    }

    func testMalformedFallsBackToLexical() {
        XCTAssertEqual(ChangelogProjection.compareVersions("abc", "abd"), -1)
        XCTAssertEqual(ChangelogProjection.compareVersions("1.2", "1.2.3"), -1) // "1.2" unparseable
    }
}

// MARK: - Selection + grouping

final class ChangelogProjectionTests: XCTestCase {
    func testNewEntriesAllWhenNeverSeen() {
        let result = ChangelogProjection.newEntries(from: Sample.history, seenVersion: nil)
        XCTAssertEqual(result.map(\.version), ["0.7.0", "0.6.0", "0.5.0"])
    }

    func testNewEntriesFilteredBySeenVersion() {
        let result = ChangelogProjection.newEntries(from: Sample.history, seenVersion: "0.5.0")
        XCTAssertEqual(result.map(\.version), ["0.7.0", "0.6.0"])
    }

    func testVisibleEntriesPrefersUnseenSubset() {
        let unseen = [Sample.history[0]]
        XCTAssertEqual(
            ChangelogProjection.visibleEntries(entries: Sample.history, newEntries: unseen).map(\.version),
            ["0.7.0"]
        )
    }

    func testVisibleEntriesFallsBackToWholeHistory() {
        let visible = ChangelogProjection.visibleEntries(entries: Sample.history, newEntries: [])
        XCTAssertEqual(visible.count, 3)
    }

    func testIsFirstVisit() {
        XCTAssertTrue(ChangelogProjection.isFirstVisit(entries: Sample.history, newEntries: Sample.history))
        XCTAssertFalse(ChangelogProjection.isFirstVisit(entries: Sample.history, newEntries: [Sample.history[0]]))
    }

    func testGroupOrdersBySectionOrderAndDropsEmpty() {
        let changes = [
            Sample.change(.fixed, "f1"),
            Sample.change(.added, "a1"),
            Sample.change(.added, "a2"),
            Sample.change(.security, "s1")
        ]
        let groups = ChangelogProjection.group(changes)
        XCTAssertEqual(groups.map(\.type), [.added, .fixed, .security])
        XCTAssertEqual(groups.first?.items.map(\.text), ["a1", "a2"]) // item order preserved
    }

    func testDefaultExpandedVersionsAreFirstTwo() {
        let expanded = ChangelogProjection.defaultExpandedVersions(Sample.history)
        XCTAssertEqual(expanded, ["0.7.0", "0.6.0"])
    }

    func testPhaseResolution() {
        XCTAssertEqual(ChangelogProjection.phase(status: .loading, hasEntries: false), .loading)
        XCTAssertEqual(ChangelogProjection.phase(status: .loading, hasEntries: true), .populated)
        XCTAssertEqual(ChangelogProjection.phase(status: .loaded, hasEntries: false), .empty)
        XCTAssertEqual(ChangelogProjection.phase(status: .loaded, hasEntries: true), .populated)
        XCTAssertEqual(ChangelogProjection.phase(status: .failed("x"), hasEntries: false), .error("x"))
        XCTAssertEqual(ChangelogProjection.phase(status: .failed("x"), hasEntries: true), .populated)
    }

    func testInlineFailureOnlyWhenCachedHistorySurvives() {
        XCTAssertEqual(ChangelogProjection.inlineFailure(status: .failed("x"), hasEntries: true), "x")
        XCTAssertNil(ChangelogProjection.inlineFailure(status: .failed("x"), hasEntries: false))
        XCTAssertNil(ChangelogProjection.inlineFailure(status: .loaded, hasEntries: true))
    }
}

// MARK: - Enums

final class ChangelogEnumTests: XCTestCase {
    func testChangeTypeOrderAndKeys() {
        XCTAssertEqual(
            ChangelogChangeType.order,
            [.added, .changed, .fixed, .removed, .deprecated, .security]
        )
        XCTAssertEqual(ChangelogChangeType.added.labelKey, "changelog.sections.added")
        XCTAssertEqual(ChangelogChangeType.security.fallbackLabel, "Security")
    }

    func testBadgeKeysAndFallbacks() {
        XCTAssertEqual(ChangelogBadgeKind.latest.labelKey, "changelog.badges.latest")
        XCTAssertEqual(ChangelogBadgeKind.stable.fallbackLabel, "Stable")
        XCTAssertEqual(ChangelogBadgeKind.beta.fallbackLabel, "Beta")
    }
}

// MARK: - Catalog (ported six-release history)

final class ChangelogCatalogTests: XCTestCase {
    func testCatalogHasSixReleasesNewestFirst() {
        XCTAssertEqual(ChangelogCatalog.total, 6)
        XCTAssertEqual(ChangelogCatalog.latestVersion, "0.7.0")
        XCTAssertEqual(ChangelogCatalog.all.first?.badge, .latest)
    }

    func testCatalogVersionsAreExpectedAndUnique() {
        let versions = ChangelogCatalog.all.map(\.version)
        XCTAssertEqual(versions, ["0.7.0", "0.6.0", "0.5.0", "0.4.0", "0.3.0", "0.1.0"])
        XCTAssertEqual(Set(versions).count, versions.count)
    }

    func testEveryReleaseHasChanges() {
        for entry in ChangelogCatalog.all {
            XCTAssertFalse(entry.changes.isEmpty, "release \(entry.version) has no changes")
        }
    }

    func testLookupByVersion() {
        XCTAssertEqual(ChangelogCatalog.entry(for: "0.6.0")?.badge, .stable)
        XCTAssertNil(ChangelogCatalog.entry(for: "9.9.9"))
    }
}

// MARK: - Accessibility

final class ChangelogAccessibilityTests: XCTestCase {
    func testDialogLabel() {
        XCTAssertEqual(
            ChangelogAccessibility.dialogLabel(localize: passthroughLocalize),
            "What's new in TeslaSync"
        )
    }

    func testEntryLabelInterpolatesVersionBadgeAndDate() {
        let label = ChangelogAccessibility.entryLabel(
            version: "0.7.0",
            badge: .latest,
            date: "2026-03-29",
            localize: passthroughLocalize
        )
        XCTAssertTrue(label.contains("0.7.0"))
        XCTAssertTrue(label.contains("Latest"))
        XCTAssertTrue(label.contains("2026-03-29"))
    }

    func testEntryHintReflectsDisclosureState() {
        XCTAssertEqual(
            ChangelogAccessibility.entryHint(isExpanded: false, localize: passthroughLocalize),
            "Expand release notes"
        )
        XCTAssertEqual(
            ChangelogAccessibility.entryHint(isExpanded: true, localize: passthroughLocalize),
            "Collapse release notes"
        )
    }
}
