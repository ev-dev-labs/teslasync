//
//  ReleaseNotes.Adapter.swift
//  TeslaSync — P4 shared surface · 0135 · ReleaseNotes (Apple)
//
//  The Foundation-only core for the collapsible release-notes accordion — the SwiftUI parity of
//  `components/feedback/ReleaseNotes.tsx`. This file owns the surface identity (the diagnostics slug), the
//  i18n facade seam, the changelog value types (``ReleaseNotesEntry`` / ``ReleaseNotesChange`` and the
//  ``ReleaseNotesBadge`` / ``ReleaseNotesChangeType`` classifications), the props (``ReleaseNotesInput``),
//  the view-ready ``ReleaseNotesProjection``, and the pure ``ReleaseNotesProjector`` that reproduces the
//  web render rules: `CHANGELOG.slice(0, limit)`, the single-open accordion (`expanded === version`), the
//  default-first-open seed (`releases[0]?.version ?? null`), and the toggle (`setExpanded(isExpanded ?
//  null : version)`). No SwiftUI and no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<ReleaseNotes>` reads a COMPILE-TIME-STATIC generated module
//  (`@/generated/changelog`) and calls only `useTranslation`. There is no fetch, no React-Query cache, and
//  no Promise — so it has NO loading, error, stale, or offline branch (there is nothing to fetch, fail,
//  age, or lose connectivity to). Inventing such chrome would fabricate states the source does not have, so
//  this surface reproduces only the source's REAL branches — exactly as the sibling presentational surfaces
//  Accordion (0203), Delta (0081), MetricCard (0095), InlineCallout (0124), and ActiveFilterChips (0147)
//  did. The real branches: the populated list (one card open, the rest closed), per-release collapsed vs
//  expanded, an expanded release with no changes (the native "never a blank box" empty leaf), and the empty
//  list (no releases / `limit <= 0`).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum ReleaseNotesSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ReleaseNotes"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The production
/// app passes the P1/S10 facade; tests pass an identity resolver. Kept as a plain closure so the pure core
/// has no dependency on a bundle.
public typealias ReleaseNotesResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Badge classification (web `ChangelogBadge`)

/// The release badge classification — the verbatim port of the web `ChangelogBadge` union
/// (`'latest' | 'stable' | 'beta'`). Carries its own i18n key + English fallback (web `BADGE_KEY` /
/// `BADGE_FALLBACK`) so the badge label resolves through the P1/S10 facade.
public enum ReleaseNotesBadge: String, Sendable, Equatable, CaseIterable {
    case latest
    case stable
    case beta

    /// The i18n key for the badge label — the web `BADGE_KEY[badge]`.
    public var localizationKey: String {
        "changelog.badges.\(rawValue)"
    }

    /// The English fallback for the badge label — the web `BADGE_FALLBACK[badge]`.
    public var fallback: String {
        switch self {
        case .latest: "Latest"
        case .stable: "Stable"
        case .beta: "Beta"
        }
    }
}

// MARK: - Change classification (web `ChangelogChangeType`)

/// The Keep-a-Changelog category of a single change — the verbatim port of the web `ChangelogChangeType`
/// union (`'added' | 'changed' | 'fixed' | 'removed' | 'deprecated' | 'security'`). Drives the colored dot
/// in the web (`DOT_TINT[type]`) and, on native, a VoiceOver label so the dot's meaning is not color-only.
public enum ReleaseNotesChangeType: String, Sendable, Equatable, CaseIterable {
    case added
    case changed
    case fixed
    case removed
    case deprecated
    case security

    /// The i18n key for the spoken category label (native a11y addition — the web dot is color-only).
    public var accessibilityLabelKey: String {
        "changelog.changeType.\(rawValue)"
    }

    /// The English fallback for the spoken category label.
    public var accessibilityFallback: String {
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

// MARK: - Changelog value types (web `ChangelogChange` / `ChangelogEntry`)

/// A single change line — the native peer of the web `ChangelogChange` (`{ type, text }`).
public struct ReleaseNotesChange: Sendable, Equatable {
    /// The Keep-a-Changelog category (web `type`).
    public let type: ReleaseNotesChangeType
    /// The human-readable change text (web `text`), already localized by the changelog source.
    public let text: String

    public init(type: ReleaseNotesChangeType, text: String) {
        self.type = type
        self.text = text
    }
}

/// A single release entry — the native peer of the web `ChangelogEntry` (`{ version, date, badge,
/// changes }`). `Identifiable` by `version`, the web `key={release.version}`.
public struct ReleaseNotesEntry: Sendable, Equatable, Identifiable {
    /// Stable identity — the web `key={release.version}`.
    public var id: String {
        version
    }

    /// Semver string, e.g. "0.7.0" (web `version`).
    public let version: String
    /// ISO date (YYYY-MM-DD) the version was released (web `date`).
    public let date: String
    /// The badge classification (web `badge`).
    public let badge: ReleaseNotesBadge
    /// The flat list of changes (web `changes`).
    public let changes: [ReleaseNotesChange]

    public init(
        version: String,
        date: String,
        badge: ReleaseNotesBadge,
        changes: [ReleaseNotesChange]
    ) {
        self.version = version
        self.date = date
        self.badge = badge
        self.changes = changes
    }
}

// MARK: - ReleaseNotesInput (web props)

/// The component's props — the native peer of the web `Props` (`{ limit }`) plus the changelog data the web
/// reads from the static `@/generated/changelog` module. A value type so the view, the state-holder, and
/// the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop change when the
/// host rebinds (e.g. a new `limit` or a refreshed snapshot).
public struct ReleaseNotesInput: Sendable, Equatable {
    /// The full changelog, newest-first (web `CHANGELOG`).
    public let entries: [ReleaseNotesEntry]
    /// The cap on the number of releases rendered, newest-first (web `limit`, default 3).
    public let limit: Int

    public init(entries: [ReleaseNotesEntry], limit: Int = ReleaseNotesProjector.defaultLimit) {
        self.entries = entries
        self.limit = limit
    }
}

// MARK: - Projection (view-ready)

/// One change row, view-ready — the native peer of the web `release.changes.map((item, i) => ...)`. Carries
/// a stable index id (the web `key={i}`) for SwiftUI `ForEach` identity.
public struct ReleaseNotesChangeRow: Sendable, Equatable, Identifiable {
    /// Stable identity within a release — the web `key={i}`.
    public let id: Int
    /// The change category (drives the dot tint + the spoken label).
    public let type: ReleaseNotesChangeType
    /// The change text.
    public let text: String

    public init(id: Int, type: ReleaseNotesChangeType, text: String) {
        self.id = id
        self.type = type
        self.text = text
    }
}

/// One release card, view-ready — everything the SwiftUI card needs as a pure function of the entry + the
/// current single-open `expanded` selection (no derivation in the view). `isExpanded` is the web `expanded
/// === release.version`; `showsBody` is the web `{isExpanded && <div>}`; `accessibilityExpanded` is the web
/// `aria-expanded={isExpanded}`.
public struct ReleaseNotesCardProjection: Sendable, Equatable, Identifiable {
    /// Stable identity — the web `key={release.version}`.
    public var id: String {
        version
    }

    /// The raw semver (web `release.version`), used as the toggle key.
    public let version: String
    /// The display label — the web `v{release.version}`.
    public let displayVersion: String
    /// The release date (web `release.date`).
    public let date: String
    /// The badge classification (web `release.badge`).
    public let badge: ReleaseNotesBadge
    /// Whether this card is the open one (web `expanded === release.version`).
    public let isExpanded: Bool
    /// Whether the body region renders (web `{isExpanded && ...}`).
    public let showsBody: Bool
    /// Whether the open card has any changes to reveal (drives the native empty-body leaf).
    public let hasChanges: Bool
    /// The accessibility expanded state (web `aria-expanded`).
    public let accessibilityExpanded: Bool
    /// The view-ready change rows (web `release.changes`).
    public let changeRows: [ReleaseNotesChangeRow]

    public init(
        version: String,
        displayVersion: String,
        date: String,
        badge: ReleaseNotesBadge,
        isExpanded: Bool,
        showsBody: Bool,
        hasChanges: Bool,
        accessibilityExpanded: Bool,
        changeRows: [ReleaseNotesChangeRow]
    ) {
        self.version = version
        self.displayVersion = displayVersion
        self.date = date
        self.badge = badge
        self.isExpanded = isExpanded
        self.showsBody = showsBody
        self.hasChanges = hasChanges
        self.accessibilityExpanded = accessibilityExpanded
        self.changeRows = changeRows
    }
}

/// The resolved, view-ready list — the native peer of the web component's render output. `isEmpty` is the
/// "no releases to show" branch (`limit <= 0` or an empty changelog); `cards` is the visible, capped list
/// (web `CHANGELOG.slice(0, limit)`).
public struct ReleaseNotesProjection: Sendable, Equatable {
    /// The visible release cards, newest-first (web `releases.map(...)`).
    public let cards: [ReleaseNotesCardProjection]
    /// Whether there is nothing to render (web `releases.length === 0`).
    public let isEmpty: Bool
    /// The currently open version, if any (web `expanded`).
    public let expandedVersion: String?

    public init(cards: [ReleaseNotesCardProjection], isEmpty: Bool, expandedVersion: String?) {
        self.cards = cards
        self.isEmpty = isEmpty
        self.expandedVersion = expandedVersion
    }
}

// MARK: - ReleaseNotesProjector (web render body)

/// The pure projection from the props + the single-open selection to the view-ready model — the surface's
/// data adapter in the "state → projection" sense the acceptance calls for: it takes the changelog a host
/// already holds plus the open-version selection (no fetch, no clock) and derives the rendered list. Unit
/// tested across the slice-to-limit cap, the default-first-open seed, the single-open toggle, the per-card
/// expansion, and the empty branch.
public enum ReleaseNotesProjector {
    /// The default cap on rendered releases — the web `limit = 3`.
    public static let defaultLimit = 3

    /// The visible, capped releases — the verbatim port of the web `CHANGELOG.slice(0, limit)`. A
    /// non-positive limit yields an empty list (slice with a non-positive end is empty).
    public static func visibleEntries(_ entries: [ReleaseNotesEntry], limit: Int) -> [ReleaseNotesEntry] {
        guard limit > 0 else { return [] }
        return Array(entries.prefix(limit))
    }

    /// The initial open version — the verbatim port of the web `useState(releases[0]?.version ?? null)`:
    /// the first visible release, or `nil` when there is nothing to show.
    public static func defaultExpandedVersion(_ entries: [ReleaseNotesEntry], limit: Int) -> String? {
        visibleEntries(entries, limit: limit).first?.version
    }

    /// The next open version for a header tap — the verbatim port of the web `setExpanded(isExpanded ?
    /// null : release.version)`: tapping the open card closes it (`nil`); tapping any other card opens it
    /// (and implicitly closes the previous one, since a single version is held).
    public static func nextExpanded(current: String?, tapped: String) -> String? {
        current == tapped ? nil : tapped
    }

    /// Builds one card projection from an entry + whether it is the open one.
    public static func card(_ entry: ReleaseNotesEntry, isExpanded: Bool) -> ReleaseNotesCardProjection {
        let rows = entry.changes.enumerated().map { offset, change in
            ReleaseNotesChangeRow(id: offset, type: change.type, text: change.text)
        }
        return ReleaseNotesCardProjection(
            version: entry.version,
            displayVersion: "v\(entry.version)",
            date: entry.date,
            badge: entry.badge,
            isExpanded: isExpanded,
            showsBody: isExpanded,
            hasChanges: !rows.isEmpty,
            accessibilityExpanded: isExpanded,
            changeRows: rows
        )
    }

    /// Resolves the whole list from the props + the open-version selection — the native peer of the web
    /// component's render decision.
    public static func resolve(input: ReleaseNotesInput, expandedVersion: String?) -> ReleaseNotesProjection {
        let visible = visibleEntries(input.entries, limit: input.limit)
        let cards = visible.map { card($0, isExpanded: $0.version == expandedVersion) }
        return ReleaseNotesProjection(
            cards: cards,
            isEmpty: visible.isEmpty,
            expandedVersion: expandedVersion
        )
    }
}
