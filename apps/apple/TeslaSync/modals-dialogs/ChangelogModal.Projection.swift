//
//  ChangelogModal.Projection.swift
//  TeslaSync — P4 modal / dialog · 0003 · ChangelogModal (Apple)
//
//  The dependency-free projection core for the changelog dialog — the faithful port of the web
//  hook + component logic: `useChangelog`'s `compareVersions` semver comparator and `newEntries`
//  derivation, the component's `visibleEntries` / `isFirstVisit` selection, the per-entry `grouped`
//  change-by-category `useMemo`, the `defaultOpen={idx < 2}` initial-expansion rule, and the body render
//  branches. Pure Foundation so the comparator, the unseen-release filter, the grouping, the counts, the
//  phase, and the default expansion are all unit-tested without a bundle or a rendered view. The release
//  data lives in ChangelogModal.Catalog.swift; the state holder that drives these lives in
//  ChangelogModal.Model.swift.
//

import Foundation

/// The dependency-free resolution from the release history + the seen-version + the load status to the
/// visible entries, the grouped change sections, the default-expanded set, and the phase.
public enum ChangelogProjection {
    // MARK: Semver compare (web `compareVersions`)

    private struct ParsedVersion {
        let core: [Int]
        let pre: String?
    }

    /// Parses a semver string the way the web regex `^(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$` does: exactly
    /// three numeric core components with an optional pre-release/build tag after the first `-` or `+`.
    /// Returns `nil` when the shape does not match (the comparator then falls back to a lexical compare).
    private static func parse(_ version: String) -> ParsedVersion? {
        var core = Substring(version)
        var pre: String?
        if let separator = version.firstIndex(where: { $0 == "-" || $0 == "+" }) {
            core = version[version.startIndex ..< separator]
            let rest = version[version.index(after: separator)...]
            if rest.isEmpty { return nil } // web `(.+)` requires at least one char
            pre = String(rest)
        }
        let parts = core.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var numbers: [Int] = []
        for part in parts {
            guard !part.isEmpty, part.allSatisfy(\.isNumber), let value = Int(part) else { return nil }
            numbers.append(value)
        }
        return ParsedVersion(core: numbers, pre: pre)
    }

    /// Compares two semver strings (web `compareVersions`). Returns `-1` if `a < b`, `0` if equal, `1` if
    /// `a > b`. Pre-release tags sort BEFORE the release (`1.0.0-beta.1` < `1.0.0`); unparseable inputs
    /// fall back to a lexical compare so the system never crashes on a malformed entry.
    public static func compareVersions(_ lhs: String, _ rhs: String) -> Int {
        if lhs == rhs { return 0 }
        guard let left = parse(lhs), let right = parse(rhs) else {
            return lhs < rhs ? -1 : (lhs > rhs ? 1 : 0)
        }
        for index in 0 ..< 3 where left.core[index] != right.core[index] {
            return left.core[index] < right.core[index] ? -1 : 1
        }
        // Cores equal — a pre-release sorts before the stable release.
        switch (left.pre, right.pre) {
        case (nil, nil): return 0
        case (nil, _): return 1
        case (_, nil): return -1
        case let (lpre?, rpre?): return lpre < rpre ? -1 : (lpre > rpre ? 1 : 0)
        }
    }

    // MARK: Unseen / visible selection (web `newEntries` / `visibleEntries` / `isFirstVisit`)

    /// The releases that shipped after `seenVersion` (web `newEntries`): the entire history when the user
    /// has never acknowledged the modal (`seenVersion == nil`), else every entry strictly newer than the
    /// seen version. Input order (newest-first) is preserved.
    public static func newEntries(
        from entries: [ChangelogReleaseEntry],
        seenVersion: String?
    ) -> [ChangelogReleaseEntry] {
        guard let seenVersion, !seenVersion.isEmpty else { return entries }
        return entries.filter { compareVersions($0.version, seenVersion) > 0 }
    }

    /// The list shown inside the modal (web `visibleEntries`): the unseen subset when there is one, else
    /// the whole history (first-time visitors see everything, which is also the right onboarding view).
    public static func visibleEntries(
        entries: [ChangelogReleaseEntry],
        newEntries: [ChangelogReleaseEntry]
    ) -> [ChangelogReleaseEntry] {
        newEntries.isEmpty ? entries : newEntries
    }

    /// Whether this is a first visit (web `isFirstVisit = newEntries.length === entries.length`) — drives
    /// the welcome subtitle versus the "{{count}} new release(s)" subtitle.
    public static func isFirstVisit(
        entries: [ChangelogReleaseEntry],
        newEntries: [ChangelogReleaseEntry]
    ) -> Bool {
        newEntries.count == entries.count
    }

    // MARK: Grouping (web `grouped`)

    /// Groups one release's changes by canonical category in `SECTION_ORDER` (web `grouped`). The
    /// generator already emits changes in section order; this re-groups so empty sections never render a
    /// heading. Item order within a category is preserved.
    public static func group(_ changes: [ChangelogChange]) -> [ChangelogGroup] {
        ChangelogChangeType.order.compactMap { type in
            let items = changes.filter { $0.type == type }
            return items.isEmpty ? nil : ChangelogGroup(type: type, items: items)
        }
    }

    /// The versions expanded by default (web `defaultOpen={idx < 2}`): the first two visible releases.
    public static func defaultExpandedVersions(_ visible: [ChangelogReleaseEntry]) -> Set<String> {
        Set(visible.prefix(2).map(\.version))
    }

    // MARK: Phase + inline failure

    /// The dialog body phase. Loading shows only before any changelog resolves; once entries are on hand
    /// the populated list stays (a failed reload keeps the cached list rather than flashing the error
    /// envelope), and a first-load failure with no cached list shows the error state. A resolved-but-empty
    /// changelog is the friendly empty state.
    public static func phase(status: ChangelogLoadStatus, hasEntries: Bool) -> ChangelogPhase {
        switch status {
        case .loading:
            hasEntries ? .populated : .loading
        case .loaded:
            hasEntries ? .populated : .empty
        case let .failed(message):
            hasEntries ? .populated : .error(message)
        }
    }

    /// The failure message kept on screen while a cached changelog survives a failed reload (the inline
    /// banner above the list), else `nil`.
    public static func inlineFailure(status: ChangelogLoadStatus, hasEntries: Bool) -> String? {
        guard hasEntries, case let .failed(message) = status else { return nil }
        return message
    }
}
