//
//  ChangelogModal.Model.swift
//  TeslaSync — P4 modal / dialog · 0003 · ChangelogModal (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `ChangelogModal` reads `useChangelog`
//  (`entries` / `newEntries` / `seenVersion`), selects the visible list (the unseen subset, else the whole
//  history), decides the first-visit vs since-last-visit subtitle, renders each release as a collapsible
//  entry (the first two open by default), and on "Got it" / "View full changelog" marks the latest version
//  seen (clearing the unseen-dot); opening the modal stamps the auto-show throttle. The native surface
//  reproduces that whole lifecycle here: a `ChangelogSource` pushes the history + seen-version + freshness,
//  and the model owns the resolved phase, the visible entries, the grouped change sections, the
//  expand/collapse set, the subtitle copy, the seen / view-full / dismiss seams, and the stale
//  auto-refresh — emitting the P1/S11 `view.opened` event once on first appearance. No networking lives in
//  the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `ChangelogSource`, resolves the phase + the
/// visible release list, holds the per-release disclosure state, exposes the interpolated subtitle, and
/// drives the seen / view-full / dismiss seams.
@MainActor
@Observable
public final class ChangelogModel {
    // Load + freshness (from the source)
    public private(set) var loadStatus: ChangelogLoadStatus = .loading
    public private(set) var connection: ChangelogConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// History + seen-state (from the source)
    public private(set) var seenVersion: String?

    // Resolved render state
    public private(set) var phase: ChangelogPhase = .loading
    public private(set) var inlineErrorMessage: String?
    public private(set) var visibleEntries: [ChangelogReleaseEntry] = []
    public private(set) var isFirstVisit = false

    /// Whether the user acknowledged the modal (web `acknowledged`) — set by "Got it" / "View full".
    public private(set) var acknowledged = false

    @ObservationIgnored private let source: any ChangelogSource
    @ObservationIgnored private let telemetry: any ChangelogTelemetry
    @ObservationIgnored private let actions: any ChangelogActions
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var allEntries: [ChangelogReleaseEntry] = []
    @ObservationIgnored private var expandedVersions: Set<String> = []
    @ObservationIgnored private var didInitExpansion = false
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any ChangelogSource,
        telemetry: any ChangelogTelemetry = OSLogChangelogTelemetry(),
        actions: any ChangelogActions = OSLogChangelogActions(),
        localize: @escaping (String, String) -> String = ChangelogStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.actions = actions
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived copy (web interpolated `t(…)` strings)

    /// The header subtitle: the welcome copy on a first visit (web `subtitleFirstVisit`), else the
    /// "{{count}} new release(s)" copy (web `subtitleSinceLastVisit`) counting the visible entries.
    public var subtitleText: String {
        if isFirstVisit {
            return localize(
                "changelog.modal.subtitleFirstVisit",
                "Welcome! Here's a quick tour of what TeslaSync ships with right now."
            )
        }
        return ChangelogStrings.interpolate(
            localize("changelog.modal.subtitleSinceLastVisit", "{{count}} new release(s) since your last visit."),
            ["count": String(visibleEntries.count)]
        )
    }

    /// The dialog container's VoiceOver label.
    public var accessibilityLabel: String {
        ChangelogAccessibility.dialogLabel(localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing, stamps the auto-show throttle (web opening the modal calls `stampShown`), and
    /// emits the `view.opened` diagnostics event. Idempotent across re-appearances.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChangelogSurface.slug)
        actions.stampShown()
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the seen-version query (the error-state retry / the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    // MARK: Disclosure (web per-entry `useState(defaultOpen)`)

    /// Whether a release's notes are expanded (web entry `expanded`).
    public func isExpanded(_ version: String) -> Bool {
        expandedVersions.contains(version)
    }

    /// Toggles a release's disclosure (web entry header `onClick`).
    public func toggle(_ version: String) {
        if expandedVersions.contains(version) {
            expandedVersions.remove(version)
        } else {
            expandedVersions.insert(version)
        }
    }

    /// The grouped, non-empty change sections for a release (web `grouped`).
    public func groups(for entry: ChangelogReleaseEntry) -> [ChangelogGroup] {
        ChangelogProjection.group(entry.changes)
    }

    // MARK: Accessibility per row

    /// One release row's container VoiceOver label.
    public func entryAccessibilityLabel(_ entry: ChangelogReleaseEntry) -> String {
        ChangelogAccessibility.entryLabel(
            version: entry.version,
            badge: entry.badge,
            date: entry.date,
            localize: localize
        )
    }

    /// One release row's expand/collapse VoiceOver hint.
    public func entryAccessibilityHint(_ version: String) -> String {
        ChangelogAccessibility.entryHint(isExpanded: isExpanded(version), localize: localize)
    }

    /// A localized section heading (web `t(SECTION_KEY[type])`).
    public func sectionLabel(_ type: ChangelogChangeType) -> String {
        localize(type.labelKey, type.fallbackLabel)
    }

    /// A localized badge label (web `t(BADGE_KEY[badge])`).
    public func badgeLabel(_ badge: ChangelogBadgeKind) -> String {
        localize(badge.labelKey, badge.fallbackLabel)
    }

    // MARK: Actions (web `handleGotIt` / `handleViewFull` / `handleClose`)

    /// "Got it" (web `handleGotIt`): mark the latest version seen so the unseen-dot clears, and record the
    /// acknowledgement; the view dismisses the sheet.
    public func gotIt() {
        acknowledged = true
        actions.markSeen()
    }

    /// "View full changelog" (web `handleViewFull`): mark seen, then open the GitHub releases page; the
    /// view dismisses the sheet.
    public func viewFull() {
        acknowledged = true
        actions.markSeen()
        actions.openFullChangelog(url: ChangelogSurface.releasesURL)
    }

    /// Esc / backdrop dismiss (web `handleClose`): the auto-show throttle was already stamped on open, and
    /// the seen-version is only written when the user acknowledged (via Got it / View full), so a plain
    /// dismiss leaves the seen-state untouched. The view owns the actual dismissal.
    public func close() {}

    // MARK: Snapshot application

    private func apply(_ update: ChangelogUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        seenVersion = update.seenVersion
        allEntries = update.entries
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Recomputes the visible entries, the first-visit flag, the resolved phase, the inline-error
    /// envelope, and (once) the default expansion.
    private func recompute() {
        let newEntries = ChangelogProjection.newEntries(from: allEntries, seenVersion: seenVersion)
        visibleEntries = ChangelogProjection.visibleEntries(entries: allEntries, newEntries: newEntries)
        isFirstVisit = ChangelogProjection.isFirstVisit(entries: allEntries, newEntries: newEntries)
        phase = ChangelogProjection.phase(status: loadStatus, hasEntries: !visibleEntries.isEmpty)
        inlineErrorMessage = ChangelogProjection.inlineFailure(
            status: loadStatus,
            hasEntries: !visibleEntries.isEmpty
        )
        if !didInitExpansion, !visibleEntries.isEmpty {
            expandedVersions = ChangelogProjection.defaultExpandedVersions(visibleEntries)
            didInitExpansion = true
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached history on screen and does not
    /// refetch.
    private func handleAutoRefresh(for connection: ChangelogConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
