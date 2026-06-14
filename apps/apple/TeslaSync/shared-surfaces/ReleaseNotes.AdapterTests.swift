//
//  ReleaseNotes.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0135 · ReleaseNotes (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the badge / change-type
//  classifications (i18n keys + fallbacks), the slice-to-limit cap (the verbatim port of the web
//  `CHANGELOG.slice(0, limit)`), the default-first-open seed (web `releases[0]?.version ?? null`), the
//  single-open toggle (web `setExpanded(isExpanded ? null : version)`), the per-card projection, the empty
//  branch, and the value-type equality. Split from ReleaseNotes.Tests.swift (the SwiftUI / state-holder
//  half) to keep each file within the SwiftLint file-length budget. The derivation is pure: no network, no
//  clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func change(_ type: ReleaseNotesChangeType, _ text: String = "x") -> ReleaseNotesChange {
        ReleaseNotesChange(type: type, text: text)
    }

    static func entry(
        _ version: String,
        badge: ReleaseNotesBadge = .stable,
        changes: [ReleaseNotesChange] = [change(.added)]
    ) -> ReleaseNotesEntry {
        ReleaseNotesEntry(version: version, date: "2026-03-29", badge: badge, changes: changes)
    }

    static let three: [ReleaseNotesEntry] = [
        entry("0.7.0", badge: .latest),
        entry("0.6.0"),
        entry("0.5.0")
    ]
}

// MARK: - Surface identity

final class ReleaseNotesAdapterIdentityTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(ReleaseNotesSurface.slug, "ReleaseNotes")
    }
}

// MARK: - Badge + change-type classifications

final class ReleaseNotesClassificationTests: XCTestCase {
    func testBadgeKeysAndFallbacks() {
        XCTAssertEqual(ReleaseNotesBadge.latest.localizationKey, "changelog.badges.latest")
        XCTAssertEqual(ReleaseNotesBadge.stable.localizationKey, "changelog.badges.stable")
        XCTAssertEqual(ReleaseNotesBadge.beta.localizationKey, "changelog.badges.beta")
        XCTAssertEqual(ReleaseNotesBadge.latest.fallback, "Latest")
        XCTAssertEqual(ReleaseNotesBadge.stable.fallback, "Stable")
        XCTAssertEqual(ReleaseNotesBadge.beta.fallback, "Beta")
    }

    func testChangeTypeKeysAndFallbacks() {
        XCTAssertEqual(ReleaseNotesChangeType.added.accessibilityLabelKey, "changelog.changeType.added")
        XCTAssertEqual(ReleaseNotesChangeType.security.accessibilityLabelKey, "changelog.changeType.security")
        XCTAssertEqual(ReleaseNotesChangeType.added.accessibilityFallback, "Added")
        XCTAssertEqual(ReleaseNotesChangeType.changed.accessibilityFallback, "Changed")
        XCTAssertEqual(ReleaseNotesChangeType.fixed.accessibilityFallback, "Fixed")
        XCTAssertEqual(ReleaseNotesChangeType.removed.accessibilityFallback, "Removed")
        XCTAssertEqual(ReleaseNotesChangeType.deprecated.accessibilityFallback, "Deprecated")
        XCTAssertEqual(ReleaseNotesChangeType.security.accessibilityFallback, "Security")
    }

    func testAllCasesCovered() {
        XCTAssertEqual(ReleaseNotesBadge.allCases.count, 3)
        XCTAssertEqual(ReleaseNotesChangeType.allCases.count, 6)
    }
}

// MARK: - Slice-to-limit (web `CHANGELOG.slice(0, limit)`)

final class ReleaseNotesVisibleEntriesTests: XCTestCase {
    func testLimitCapsNewestFirst() {
        let visible = ReleaseNotesProjector.visibleEntries(Fixture.three, limit: 2)
        XCTAssertEqual(visible.map(\.version), ["0.7.0", "0.6.0"])
    }

    func testLimitLargerThanCountReturnsAll() {
        let visible = ReleaseNotesProjector.visibleEntries(Fixture.three, limit: 10)
        XCTAssertEqual(visible.count, 3)
    }

    func testNonPositiveLimitIsEmpty() {
        XCTAssertTrue(ReleaseNotesProjector.visibleEntries(Fixture.three, limit: 0).isEmpty)
        XCTAssertTrue(ReleaseNotesProjector.visibleEntries(Fixture.three, limit: -1).isEmpty)
    }

    func testEmptyEntriesIsEmpty() {
        XCTAssertTrue(ReleaseNotesProjector.visibleEntries([], limit: 3).isEmpty)
    }
}

// MARK: - Default-first-open seed (web `releases[0]?.version ?? null`)

final class ReleaseNotesDefaultExpandedTests: XCTestCase {
    func testSeedsFirstVisibleVersion() {
        XCTAssertEqual(ReleaseNotesProjector.defaultExpandedVersion(Fixture.three, limit: 3), "0.7.0")
    }

    func testSeedIsNilWhenNothingVisible() {
        XCTAssertNil(ReleaseNotesProjector.defaultExpandedVersion(Fixture.three, limit: 0))
        XCTAssertNil(ReleaseNotesProjector.defaultExpandedVersion([], limit: 3))
    }
}

// MARK: - Single-open toggle (web `setExpanded(isExpanded ? null : version)`)

final class ReleaseNotesToggleTests: XCTestCase {
    func testTappingOpenCardCloses() {
        XCTAssertNil(ReleaseNotesProjector.nextExpanded(current: "0.7.0", tapped: "0.7.0"))
    }

    func testTappingOtherCardOpensIt() {
        XCTAssertEqual(ReleaseNotesProjector.nextExpanded(current: "0.7.0", tapped: "0.6.0"), "0.6.0")
    }

    func testTappingFromNoneOpens() {
        XCTAssertEqual(ReleaseNotesProjector.nextExpanded(current: nil, tapped: "0.5.0"), "0.5.0")
    }
}

// MARK: - Card projection

final class ReleaseNotesCardProjectionTests: XCTestCase {
    func testCardDerivesDisplayVersionAndRows() {
        let entry = Fixture.entry(
            "0.7.0",
            badge: .latest,
            changes: [Fixture.change(.added, "a"), Fixture.change(.fixed, "b")]
        )
        let card = ReleaseNotesProjector.card(entry, isExpanded: true)
        XCTAssertEqual(card.displayVersion, "v0.7.0")
        XCTAssertTrue(card.isExpanded)
        XCTAssertTrue(card.showsBody)
        XCTAssertTrue(card.accessibilityExpanded)
        XCTAssertTrue(card.hasChanges)
        XCTAssertEqual(card.changeRows.map(\.id), [0, 1])
        XCTAssertEqual(card.changeRows.map(\.text), ["a", "b"])
        XCTAssertEqual(card.changeRows.map(\.type), [.added, .fixed])
    }

    func testCollapsedCardHidesBody() {
        let card = ReleaseNotesProjector.card(Fixture.entry("0.6.0"), isExpanded: false)
        XCTAssertFalse(card.isExpanded)
        XCTAssertFalse(card.showsBody)
        XCTAssertFalse(card.accessibilityExpanded)
    }

    func testCardWithNoChangesReportsEmpty() {
        let card = ReleaseNotesProjector.card(Fixture.entry("0.6.0", changes: []), isExpanded: true)
        XCTAssertFalse(card.hasChanges)
        XCTAssertTrue(card.changeRows.isEmpty)
    }
}

// MARK: - Resolve (single-open list)

final class ReleaseNotesResolveTests: XCTestCase {
    func testResolveExpandsOnlyTheSelectedVersion() {
        let projection = ReleaseNotesProjector.resolve(
            input: ReleaseNotesInput(entries: Fixture.three, limit: 3),
            expandedVersion: "0.6.0"
        )
        XCTAssertEqual(projection.cards.count, 3)
        XCTAssertFalse(projection.isEmpty)
        XCTAssertEqual(projection.expandedVersion, "0.6.0")
        XCTAssertEqual(projection.cards.filter(\.isExpanded).map(\.version), ["0.6.0"])
    }

    func testResolveWithNoSelectionExpandsNothing() {
        let projection = ReleaseNotesProjector.resolve(
            input: ReleaseNotesInput(entries: Fixture.three, limit: 3),
            expandedVersion: nil
        )
        XCTAssertTrue(projection.cards.allSatisfy { !$0.isExpanded })
    }

    func testResolveEmptyWhenLimitZero() {
        let projection = ReleaseNotesProjector.resolve(
            input: ReleaseNotesInput(entries: Fixture.three, limit: 0),
            expandedVersion: "0.7.0"
        )
        XCTAssertTrue(projection.isEmpty)
        XCTAssertTrue(projection.cards.isEmpty)
    }

    func testResolveCapsToLimit() {
        let projection = ReleaseNotesProjector.resolve(
            input: ReleaseNotesInput(entries: Fixture.three, limit: 1),
            expandedVersion: "0.7.0"
        )
        XCTAssertEqual(projection.cards.map(\.version), ["0.7.0"])
    }
}

// MARK: - Value-type equality

final class ReleaseNotesValueTypeTests: XCTestCase {
    func testEntryEquality() {
        XCTAssertEqual(Fixture.entry("0.7.0"), Fixture.entry("0.7.0"))
        XCTAssertNotEqual(Fixture.entry("0.7.0"), Fixture.entry("0.6.0"))
        XCTAssertNotEqual(Fixture.entry("0.7.0", badge: .latest), Fixture.entry("0.7.0", badge: .stable))
    }

    func testInputEquality() {
        let lhs = ReleaseNotesInput(entries: Fixture.three, limit: 3)
        let rhs = ReleaseNotesInput(entries: Fixture.three, limit: 3)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, ReleaseNotesInput(entries: Fixture.three, limit: 2))
    }

    func testProjectionEquality() {
        let input = ReleaseNotesInput(entries: Fixture.three, limit: 3)
        let lhs = ReleaseNotesProjector.resolve(input: input, expandedVersion: "0.7.0")
        let rhs = ReleaseNotesProjector.resolve(input: input, expandedVersion: "0.7.0")
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, ReleaseNotesProjector.resolve(input: input, expandedVersion: "0.6.0"))
    }

    func testCanonicalDataIsNewestFirstAndNonEmpty() {
        XCTAssertFalse(ReleaseNotesData.canonical.isEmpty)
        XCTAssertEqual(ReleaseNotesData.canonical.first?.badge, .latest)
        XCTAssertTrue(ReleaseNotesData.canonical.allSatisfy { !$0.changes.isEmpty })
    }
}
