//
//  SettingsSearch.Adapter.swift
//  TeslaSync — P4 feature view · 0215 · SettingsSearch (Apple)
//
//  The testable projection core for the settings find-as-you-type box — the faithful port of
//  features/settings/searchIndex.ts (`fuzzyMatch` + `searchSettings`) that the web `SettingsSearch`
//  drives, plus the indexed-setting catalog (`getSettingsIndex`). The ranker reproduces the scoring
//  tiers VERBATIM:
//
//      if (title === q) score = 1000;
//      else if (title.startsWith(q)) score = 800;
//      else if (title.includes(q)) score = 600;
//      else if (keywordHit) score = 400;
//      else if (desc.includes(q)) score = 300;
//      else if (fuzzyMatch(q, entry.title)) score = 200;
//      else if (fuzzyMatch(q, entry.description)) score = 100;
//
//  …sorted by descending score with the catalog order preserved among ties (JS `Array.sort` is
//  stable), then capped at `MAX_RESULTS` (the web component's `.slice(0, 8)`). Foundation-only so it is
//  unit-tested without a bundle or a rendered view.
//

import Foundation

/// The dependency-free ranker from the cached settings index to the matched rows, plus the result-phase
/// resolver. Every value uses the same predicate, scoring, order, and cap as the web component so the
/// web and native result lists resolve identically for identical input.
public enum SettingsSearchProjector {
    /// The result cap applied by the web component (`searchSettings(...).slice(0, MAX_RESULTS)`).
    public static let maxResults = 8

    /// A scored entry retaining its catalog index so equal scores keep catalog order (stable sort).
    private struct ScoredEntry {
        let entry: SettingsEntry
        let score: Int
        let order: Int
    }

    /// Whether the box is non-blank enough to search — the web `q.length === 0` guard after `trim()`
    /// (any non-blank query searches; there is no minimum length).
    public static func isSearching(_ query: String) -> Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The normalized needle used by the ranker (web `query.trim().toLowerCase()`): trimmed, lowercased.
    public static func normalizedQuery(_ query: String) -> String {
        query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Case-insensitive subsequence match — the verbatim port of the web `fuzzyMatch`. Returns true when
    /// every character of `needle` appears in `haystack` in order (e.g. "lng" → "Language"). An empty
    /// needle never matches; an empty haystack only matches the empty needle.
    public static func fuzzyMatch(_ needle: String, _ haystack: String) -> Bool {
        let needleChars = Array(needle.lowercased())
        guard !needleChars.isEmpty else { return false }
        let hayChars = Array(haystack.lowercased())
        var searchFrom = 0
        for character in needleChars {
            guard let found = indexOf(character, in: hayChars, from: searchFrom) else { return false }
            searchFrom = found + 1
        }
        return true
    }

    /// The first index of `character` in `chars` at or after `from` (web `String.indexOf(ch, i)`),
    /// or `nil` when absent.
    private static func indexOf(_ character: Character, in chars: [Character], from: Int) -> Int? {
        guard from < chars.count else { return nil }
        for index in from ..< chars.count where chars[index] == character {
            return index
        }
        return nil
    }

    /// The score for one entry against the normalized needle, reproducing the web tier ladder exactly:
    /// exact title (1000) ▸ title prefix (800) ▸ title substring (600) ▸ keyword substring (400) ▸
    /// description substring (300) ▸ fuzzy title (200) ▸ fuzzy description (100); 0 when nothing matches.
    public static func score(_ entry: SettingsEntry, needle: String) -> Int {
        let title = entry.title.lowercased()
        let description = entry.description.lowercased()
        let keywordHit = entry.keywords.contains { $0.lowercased().contains(needle) }

        if title == needle { return 1000 }
        if title.hasPrefix(needle) { return 800 }
        if title.contains(needle) { return 600 }
        if keywordHit { return 400 }
        if description.contains(needle) { return 300 }
        if fuzzyMatch(needle, entry.title) { return 200 }
        if fuzzyMatch(needle, entry.description) { return 100 }
        return 0
    }

    /// Scores + filters + ranks the index against a query (web `searchSettings`). Entries with a
    /// positive score are returned in descending score order, ties broken by ascending catalog index so
    /// the order is stable (matching JS `Array.sort`). Uncapped — the cap is applied by `project`.
    public static func rank(entries: [SettingsEntry], query: String) -> [SettingsEntry] {
        let needle = normalizedQuery(query)
        guard !needle.isEmpty else { return [] }
        return entries.enumerated()
            .compactMap { offset, entry -> ScoredEntry? in
                let value = score(entry, needle: needle)
                return value > 0 ? ScoredEntry(entry: entry, score: value, order: offset) : nil
            }
            .sorted { lhs, rhs in
                lhs.score != rhs.score ? lhs.score > rhs.score : lhs.order < rhs.order
            }
            .map(\.entry)
    }

    /// Builds the capped match projection from the index: a blank box yields no rows (the view renders
    /// the idle hint); otherwise the ranked entries capped at `maxResults` (web `.slice(0, 8)`), each
    /// mapped to its row + `view`-ready VoiceOver label.
    public static func project(
        entries: [SettingsEntry],
        query: String,
        copy: SettingsSearchCopy = .fallback
    ) -> SettingsSearchProjection {
        guard isSearching(query) else { return .empty }
        let rows = rank(entries: entries, query: query)
            .prefix(maxResults)
            .map { entry in
                SettingsMatch(
                    id: entry.id,
                    title: entry.title,
                    description: entry.description.isEmpty ? nil : entry.description,
                    section: entry.section,
                    href: entry.href,
                    systemImage: entry.systemImage,
                    accessibilityLabel: accessibilityLabel(for: entry, copy: copy)
                )
            }
        return SettingsSearchProjection(matches: Array(rows))
    }

    /// Resolves the result phase, mirroring the web precedence: a failed index short-circuits to error;
    /// an unresolved index is loading; a resolved index is idle when the box is blank, content when
    /// matches exist, and empty when the search matched nothing (web `settings.search.noResults`).
    public static func resolvePhase(
        _ status: SettingsSearchLoadStatus,
        isSearching searching: Bool,
        hasMatches: Bool
    ) -> SettingsSearchPhase {
        switch status {
        case let .failed(message):
            return .error(message)
        case .idle, .loading:
            return .loading
        case .loaded:
            guard searching else { return .idle }
            return hasMatches ? .content : .empty
        }
    }

    /// The combined VoiceOver label for a matched setting: the injected role word, the title, and the
    /// description when present (native a11y enrichment over the web row's visual-only label).
    static func accessibilityLabel(for entry: SettingsEntry, copy: SettingsSearchCopy) -> String {
        var label = "\(copy.settingRole): \(entry.title)"
        if !entry.description.isEmpty {
            label += ", \(entry.description)"
        }
        return label
    }
}

// MARK: - Stale-age label (native freshness banner)

/// Formats the cached-index age for the stale banner. Dependency-free + deterministic (`now` injected)
/// so it is host-testable; rounds down to the largest whole unit (seconds → minutes → hours → days).
public enum SettingsSearchAge {
    /// A compact age string ("just now", "5 min", "2 hr", "3 days") for the time elapsed since
    /// `updatedAt`. Returns a neutral "unknown" when no timestamp is available, and clamps negatives
    /// (a future timestamp) to "just now".
    public static func compactLabel(since updatedAt: Date?, relativeTo now: Date = Date()) -> String {
        guard let updatedAt else { return "unknown" }
        let seconds = max(0, now.timeIntervalSince(updatedAt))
        switch seconds {
        case ..<60:
            return "just now"
        case ..<3600:
            return "\(Int(seconds / 60)) min"
        case ..<86400:
            return "\(Int(seconds / 3600)) hr"
        default:
            return "\(Int(seconds / 86400)) days"
        }
    }
}
