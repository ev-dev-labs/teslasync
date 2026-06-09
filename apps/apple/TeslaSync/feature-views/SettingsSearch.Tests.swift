//
//  SettingsSearch.Tests.swift
//  TeslaSync — P4 feature view · 0215 · SettingsSearch (Apple)
//
//  Unit coverage for the SettingsSearch surface (adapter + destination half; the state-holder +
//  accessibility coverage lives in SettingsSearch.ModelTests.swift):
//    • Adapter (cached → projection) — `SettingsSearchProjector` value parity with the web
//      `searchSettings` / `fuzzyMatch` (the 1000/800/600/400/300/200/100 score ladder, the stable
//      descending-score order, the `MAX_RESULTS` cap, the trimmed-lowercased needle, the empty-box
//      guard) plus the result-phase precedence and the stale-age label, and the `getSettingsIndex`
//      catalog port.
//    • Destination — the `href` → path/`#fragment` split (web `navigate(entry.href)` + `split('#')`).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store. The
//  `SettingsSearchFixture` defined here is shared with SettingsSearch.ModelTests.swift.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// Shared across the SettingsSearch XCTest files (kept non-private so SettingsSearch.ModelTests can
/// reuse it).
enum SettingsSearchFixture {
    /// A small, controlled index so each score tier + the stable order is asserted unambiguously.
    static let entries: [SettingsEntry] = [
        SettingsEntry(
            id: "language", href: "/settings#general", section: "general",
            title: "Language", description: "Application interface language.",
            keywords: ["locale", "i18n"]
        ),
        SettingsEntry(
            id: "language-region", href: "/settings#general", section: "general",
            title: "Language region", description: "Regional language variant.", keywords: []
        ),
        SettingsEntry(
            id: "distance", href: "/settings#general", section: "general",
            title: "Distance unit", description: "Show distances in kilometers or miles.",
            keywords: ["km", "mi"]
        ),
        SettingsEntry(
            id: "temperature", href: "/settings#general", section: "general",
            title: "Temperature unit", description: "Show temperatures in Celsius or Fahrenheit.",
            keywords: ["celsius"]
        ),
        SettingsEntry(
            id: "currency", href: "/settings#general", section: "general",
            title: "Currency", description: "Currency symbol used in displays.",
            keywords: ["usd", "eur"]
        ),
        SettingsEntry(
            id: "theme", href: "/settings#appearance", section: "appearance",
            title: "Theme", description: "Dark light accent color mode.", keywords: ["mode"]
        ),
        SettingsEntry(
            id: "backup", href: "/backup", section: "backup",
            title: "Backup", description: "Export bundle JSON.", keywords: ["snapshot"]
        )
    ]

    static func entry(_ id: String) -> SettingsEntry {
        entries.first { $0.id == id }!
    }

    static func rank(_ query: String) -> [String] {
        SettingsSearchProjector.rank(entries: entries, query: query).map(\.id)
    }

    static func project(_ query: String) -> SettingsSearchProjection {
        SettingsSearchProjector.project(entries: entries, query: query, copy: .fallback)
    }
}

// MARK: - Adapter: score ladder (verbatim port of the web tiers)

@MainActor final class SettingsSearchScoreTests: XCTestCase {
    private func score(_ id: String, _ needle: String) -> Int {
        SettingsSearchProjector.score(SettingsSearchFixture.entry(id), needle: needle)
    }

    func testExactTitleScores1000() {
        XCTAssertEqual(score("language", "language"), 1000)
    }

    func testTitlePrefixScores800() {
        XCTAssertEqual(score("language", "lang"), 800)
    }

    func testTitleSubstringScores600() {
        // "unit" is inside "Distance unit" but is not a prefix.
        XCTAssertEqual(score("distance", "unit"), 600)
    }

    func testKeywordScores400() {
        // "usd" matches only the keyword (not the title / description).
        XCTAssertEqual(score("currency", "usd"), 400)
    }

    func testDescriptionScores300() {
        // "accent" matches only the description.
        XCTAssertEqual(score("theme", "accent"), 300)
    }

    func testFuzzyTitleScores200() {
        // "lng" is a subsequence of "Language" but not a substring / keyword / description hit.
        XCTAssertEqual(score("language", "lng"), 200)
    }

    func testFuzzyDescriptionScores100() {
        // "xpj" is a subsequence of "Export bundle JSON" only (not the title).
        XCTAssertEqual(score("backup", "xpj"), 100)
    }

    func testNoMatchScoresZero() {
        XCTAssertEqual(score("language", "zzzzz"), 0)
    }

    func testScoreLadderIsOrdered() {
        // Exact ▸ prefix ▸ substring ▸ keyword ▸ description ▸ fuzzy-title ▸ fuzzy-description.
        XCTAssertGreaterThan(score("language", "language"), score("language", "lang"))
        XCTAssertGreaterThan(score("language", "lang"), score("distance", "unit"))
        XCTAssertGreaterThan(score("distance", "unit"), score("currency", "usd"))
        XCTAssertGreaterThan(score("currency", "usd"), score("theme", "accent"))
        XCTAssertGreaterThan(score("theme", "accent"), score("language", "lng"))
        XCTAssertGreaterThan(score("language", "lng"), score("backup", "xpj"))
    }
}

// MARK: - Adapter: fuzzyMatch (verbatim port of the web subsequence matcher)

@MainActor final class SettingsSearchFuzzyTests: XCTestCase {
    func testSubsequenceMatches() {
        XCTAssertTrue(SettingsSearchProjector.fuzzyMatch("lng", "Language"))
        XCTAssertTrue(SettingsSearchProjector.fuzzyMatch("dst", "Distance unit"))
    }

    func testOrderMatters() {
        // "gnl" is not in order within "language" (the l comes before the n/g it would need after).
        XCTAssertFalse(SettingsSearchProjector.fuzzyMatch("gnl", "Language"))
    }

    func testMissingCharacterFails() {
        XCTAssertFalse(SettingsSearchProjector.fuzzyMatch("xyz", "Language"))
    }

    func testEmptyNeedleNeverMatches() {
        XCTAssertFalse(SettingsSearchProjector.fuzzyMatch("", "Language"))
    }

    func testEmptyHaystackOnlyMatchesEmptyNeedle() {
        XCTAssertFalse(SettingsSearchProjector.fuzzyMatch("a", ""))
    }

    func testIsCaseInsensitive() {
        XCTAssertTrue(SettingsSearchProjector.fuzzyMatch("LNG", "language"))
    }
}

// MARK: - Adapter: rank ordering, stability, cap, empty guard

@MainActor final class SettingsSearchRankTests: XCTestCase {
    func testRankSortsByDescendingScore() {
        // "language" → exact (1000) on "Language" beats prefix (800) on "Language region".
        XCTAssertEqual(SettingsSearchFixture.rank("language"), ["language", "language-region"])
    }

    func testRankStableForTiedScores() {
        // Both "Distance unit" + "Temperature unit" are substring (600) hits → catalog order preserved.
        XCTAssertEqual(SettingsSearchFixture.rank("unit"), ["distance", "temperature"])
    }

    func testRankPrefixTieKeepsCatalogOrder() {
        // Both language entries are prefix (800) hits on "lang" → catalog order preserved.
        XCTAssertEqual(SettingsSearchFixture.rank("lang"), ["language", "language-region"])
    }

    func testEmptyQueryRanksNothing() {
        XCTAssertTrue(SettingsSearchFixture.rank("").isEmpty)
    }

    func testWhitespaceQueryRanksNothing() {
        XCTAssertTrue(SettingsSearchFixture.rank("   ").isEmpty)
    }

    func testNeedleIsTrimmedAndLowercased() {
        XCTAssertEqual(SettingsSearchProjector.normalizedQuery("  LANGUAGE  "), "language")
    }

    func testRankCapsAtMaxResults() {
        // 10 entries that all match "setting" → ranked + capped at MAX_RESULTS (8) by `project`.
        let many = (0 ..< 10).map { index in
            SettingsEntry(
                id: "s\(index)", href: "/settings#general", section: "general",
                title: "Setting \(index)", description: "A setting."
            )
        }
        let projection = SettingsSearchProjector.project(entries: many, query: "setting", copy: .fallback)
        XCTAssertEqual(projection.matches.count, SettingsSearchProjector.maxResults)
        XCTAssertEqual(projection.matches.map(\.id), (0 ..< 8).map { "s\($0)" })
    }
}

// MARK: - Adapter: projection shape + phase + age

@MainActor final class SettingsSearchProjectionTests: XCTestCase {
    func testBlankQueryYieldsEmptyProjection() {
        XCTAssertEqual(SettingsSearchFixture.project(""), .empty)
        XCTAssertFalse(SettingsSearchFixture.project("").hasMatches)
    }

    func testProjectBuildsAccessibilityLabelWithRoleAndDescription() {
        let match = SettingsSearchFixture.project("currency").matches[0]
        XCTAssertEqual(match.accessibilityLabel, "Setting: Currency, Currency symbol used in displays.")
    }

    func testProjectCarriesHrefAndSection() {
        let match = SettingsSearchFixture.project("theme").matches[0]
        XCTAssertEqual(match.href, "/settings#appearance")
        XCTAssertEqual(match.section, "appearance")
    }

    func testProjectDescriptionNilWhenEntryHasNoDescription() {
        let entries = [
            SettingsEntry(id: "bare", href: "/settings#general", section: "general", title: "Bare", description: "")
        ]
        let match = SettingsSearchProjector.project(entries: entries, query: "bare", copy: .fallback).matches[0]
        XCTAssertNil(match.description)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(
            SettingsSearchProjector.resolvePhase(.failed("x"), isSearching: true, hasMatches: true),
            .error("x")
        )
        XCTAssertEqual(
            SettingsSearchProjector.resolvePhase(.idle, isSearching: false, hasMatches: false),
            .loading
        )
        XCTAssertEqual(
            SettingsSearchProjector.resolvePhase(.loading, isSearching: true, hasMatches: true),
            .loading
        )
        XCTAssertEqual(
            SettingsSearchProjector.resolvePhase(.loaded, isSearching: false, hasMatches: false),
            .idle
        )
        XCTAssertEqual(
            SettingsSearchProjector.resolvePhase(.loaded, isSearching: true, hasMatches: true),
            .content
        )
        XCTAssertEqual(
            SettingsSearchProjector.resolvePhase(.loaded, isSearching: true, hasMatches: false),
            .empty
        )
    }

    func testCompactAgeBuckets() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        func label(_ secondsAgo: TimeInterval?) -> String {
            SettingsSearchAge.compactLabel(since: secondsAgo.map { now.addingTimeInterval(-$0) }, relativeTo: now)
        }
        XCTAssertEqual(label(nil), "unknown")
        XCTAssertEqual(label(0), "just now")
        XCTAssertEqual(label(59), "just now")
        XCTAssertEqual(label(300), "5 min")
        XCTAssertEqual(label(7200), "2 hr")
        XCTAssertEqual(label(172_800), "2 days")
        XCTAssertEqual(SettingsSearchAge.compactLabel(since: now.addingTimeInterval(120), relativeTo: now), "just now")
    }
}

// MARK: - Adapter: real catalog port (getSettingsIndex parity)

@MainActor final class SettingsCatalogTests: XCTestCase {
    private let catalog = SettingsCatalog.entries { _, fallback in fallback }

    func testCatalogIsNonEmptyAndIdsUnique() {
        XCTAssertGreaterThan(catalog.count, 40)
        XCTAssertEqual(Set(catalog.map(\.id)).count, catalog.count)
    }

    func testCatalogPreservesWebOrderHead() {
        XCTAssertEqual(catalog.first?.id, "tesla.connect")
    }

    func testFuzzyLngFindsLanguage() {
        // The web example: "lng" → "Language" via fuzzy subsequence.
        let ids = SettingsSearchProjector.rank(entries: catalog, query: "lng").map(\.id)
        XCTAssertTrue(ids.contains("general.language"))
    }

    func testKeywordPsiFindsTirePressure() {
        let top = SettingsSearchProjector.rank(entries: catalog, query: "psi").first
        XCTAssertEqual(top?.id, "general.units.pressure")
    }

    func testExactTitleOutranksOthers() {
        let top = SettingsSearchProjector.rank(entries: catalog, query: "theme").first
        XCTAssertEqual(top?.id, "appearance.theme")
    }
}

// MARK: - Destination parsing (web `navigate(entry.href)` + `split('#')`)

@MainActor final class SettingsDestinationTests: XCTestCase {
    func testHashAnchorSplitsPathAndFragment() {
        let destination = SettingsDestination.from(href: "/settings#general")
        XCTAssertEqual(destination.path, "/settings")
        XCTAssertEqual(destination.fragment, "general")
        XCTAssertEqual(destination.raw, "/settings#general")
    }

    func testNoHashYieldsNilFragment() {
        let destination = SettingsDestination.from(href: "/tesla-account")
        XCTAssertEqual(destination.path, "/tesla-account")
        XCTAssertNil(destination.fragment)
    }

    func testTrailingHashYieldsNilFragment() {
        let destination = SettingsDestination.from(href: "/settings#")
        XCTAssertEqual(destination.path, "/settings")
        XCTAssertNil(destination.fragment)
    }

    func testCrossPageHrefPreserved() {
        let destination = SettingsDestination.from(href: "/integrations/helix")
        XCTAssertEqual(destination.path, "/integrations/helix")
        XCTAssertNil(destination.fragment)
    }
}
