//
//  ChangelogModal.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0003 · ChangelogModal (Apple)
//
//  The dependency-free domain layer for the changelog dialog — the faithful port of
//  components/feedback/ChangelogModal.tsx. The web source is a `Modal` titled "What's new in TeslaSync"
//  that lists the releases shipped since the user's last visit (or the whole history on a first visit),
//  each a collapsible entry (version + Latest/Stable/Beta badge + date) whose body groups its changes by
//  the Keep-a-Changelog category (added / changed / fixed / removed / deprecated / security); a "View full
//  changelog" link opens the GitHub releases page and "Got it" marks the latest version seen. Everything
//  here is pure Foundation so the value model, the six change categories (order + i18n key + fallback),
//  the three badge kinds, the release entry, and the load / freshness / phase enums are all unit-testable
//  without a bundle or a rendered view. The six-release data lives in ChangelogModal.Catalog.swift; the
//  semver compare / grouping / visible-entry projection lives in ChangelogModal.Projection.swift.
//
//  Web parity notes:
//    • generated `ChangelogChange { type, text }`            → `ChangelogChange`.
//    • generated `ChangelogChangeType` (6 union members)     → `ChangelogChangeType`; `SECTION_ORDER`
//      → `.order`; `SECTION_KEY` → `.labelKey`; `SECTION_FALLBACK` → `.fallbackLabel`.
//    • generated `ChangelogBadge` (3 union members)          → `ChangelogBadgeKind`; `BADGE_KEY` →
//      `.labelKey`; `BADGE_FALLBACK` → `.fallbackLabel` (the success/info/warning tone maps in the views).
//    • generated `ChangelogEntry { version, date, badge, changes }` → `ChangelogReleaseEntry`.
//    • `useChangelog`'s `entries` / `newEntries` / `seenVersion` → delivered through the bound source so
//      the view stays source-driven, and widened with loading / empty / error / freshness envelopes so no
//      state is ever a blank box (engineering guideline #6), matching the modals-dialogs tier.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so the
/// projection's unit tests can reach it.
public enum ChangelogSurface {
    public static let slug = "ChangelogModal"

    /// The GitHub releases page the web `handleViewFull` opens in a new tab.
    public static let releasesURL = "https://github.com/ev-dev-labs/teslasync/releases"
}

// MARK: - Change category (web `ChangelogChangeType` + the section maps)

/// One Keep-a-Changelog category — the native parity of the web `ChangelogChangeType` union. Carries the
/// canonical render order (web `SECTION_ORDER`), the i18n key (web `SECTION_KEY`), and the English
/// fallback (web `SECTION_FALLBACK`). The per-category dot tint lives in the views (web `SECTION_DOT`).
public enum ChangelogChangeType: String, Sendable, Equatable, CaseIterable, Identifiable {
    case added
    case changed
    case fixed
    case removed
    case deprecated
    case security

    public var id: String {
        rawValue
    }

    /// The canonical section order (web `SECTION_ORDER`). `allCases` already follows this declaration
    /// order, so it is the single source of truth for both.
    public static let order: [ChangelogChangeType] = allCases

    /// The i18n key for the section heading (web `SECTION_KEY`).
    public var labelKey: String {
        "changelog.sections.\(rawValue)"
    }

    /// The English fallback heading (web `SECTION_FALLBACK`).
    public var fallbackLabel: String {
        switch self {
        case .added: "Added"
        case .changed: "Changed"
        case .fixed: "Fixed"
        case .removed: "Removed"
        case .deprecated: "Deprecated"
        case .security: "Security"
        }
    }
}

// MARK: - Badge kind (web `ChangelogBadge` + the badge maps)

/// A release's UI classification — the native parity of the web `ChangelogBadge` union: `latest` for the
/// topmost entry, `beta` for pre-releases, `stable` otherwise. Carries the i18n key (web `BADGE_KEY`) and
/// the English fallback (web `BADGE_FALLBACK`); the success/info/warning tone map lives in the views (web
/// `BADGE_VARIANT`).
public enum ChangelogBadgeKind: String, Sendable, Equatable, CaseIterable, Identifiable {
    case latest
    case stable
    case beta

    public var id: String {
        rawValue
    }

    /// The i18n key for the badge label (web `BADGE_KEY`).
    public var labelKey: String {
        "changelog.badges.\(rawValue)"
    }

    /// The English fallback label (web `BADGE_FALLBACK`).
    public var fallbackLabel: String {
        switch self {
        case .latest: "Latest"
        case .stable: "Stable"
        case .beta: "Beta"
        }
    }
}

// MARK: - Change + release entry (web generated `ChangelogChange` / `ChangelogEntry`)

/// One change line — the native parity of the generated `ChangelogChange`: a Keep-a-Changelog category and
/// the human-readable text (product copy, rendered verbatim — the web renders `item.text` directly).
public struct ChangelogChange: Sendable, Equatable {
    public let type: ChangelogChangeType
    public let text: String

    public init(type: ChangelogChangeType, text: String) {
        self.type = type
        self.text = text
    }
}

/// One release — the native parity of the generated `ChangelogEntry`: the semver string (web `version`,
/// rendered as `v{version}`), the ISO release date (web `date`), the badge classification, and the flat
/// list of changes. `id` is the version (web `key={entry.version}`).
public struct ChangelogReleaseEntry: Sendable, Equatable, Identifiable {
    public let version: String
    public let date: String
    public let badge: ChangelogBadgeKind
    public let changes: [ChangelogChange]

    public var id: String {
        version
    }

    public init(version: String, date: String, badge: ChangelogBadgeKind, changes: [ChangelogChange]) {
        self.version = version
        self.date = date
        self.badge = badge
        self.changes = changes
    }
}

/// A change category paired with its (non-empty) changes — the native parity of the web `grouped` tuple
/// the entry body maps over. `id` is the category so SwiftUI can diff sections.
public struct ChangelogGroup: Sendable, Equatable, Identifiable {
    public let type: ChangelogChangeType
    public let items: [ChangelogChange]

    public var id: String {
        type.rawValue
    }

    public init(type: ChangelogChangeType, items: [ChangelogChange]) {
        self.type = type
        self.items = items
    }
}

// MARK: - Load status / freshness / phase

/// The bound source's load status for the release history. The web modal reads a static generated
/// changelog; the native surface models the load lifecycle so every state renders (loading / loaded /
/// failed).
public enum ChangelogLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013) for the seen-version state that decides the "since your last visit"
/// subtitle: drives the freshness chip + the cached-data banner so the surface labels when the seen-state
/// came from a cached read rather than a live one.
public enum ChangelogConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the dialog body renders at the top level. The web only ever shows the populated list; the
/// loading / empty / error envelopes are added so a first load (no resolved changelog) is never a blank
/// box (engineering guideline #6).
public enum ChangelogPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case populated
}
