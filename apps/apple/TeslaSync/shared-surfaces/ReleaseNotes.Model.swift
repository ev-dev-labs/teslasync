//
//  ReleaseNotes.Model.swift
//  TeslaSync — P4 shared surface · 0135 · ReleaseNotes (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  release-notes accordion. The web `<ReleaseNotes>` reads its data from a compile-time-static generated
//  module and calls only `useTranslation` — there is no fetcher — so the native peer needs no data
//  state-holder. What the holder DOES own is the surface's interaction state (the single-open `expanded`
//  selection, the native peer of the web `useState(releases[0]?.version ?? null)`), the props (the derived
//  ``ReleaseNotesProjection`` is an observed read), and the single `view.opened` diagnostics event. No
//  networking lives here.
//
//  The localized strings mirror the web `t()` keys (the badge labels `changelog.badges.*` and the
//  "What's New" heading `changelog.releaseNotes.heading`) and add the native a11y additions the web gets
//  for free from semantic HTML (the expand/collapse hint, the expanded/collapsed value — the spoken peer of
//  `aria-expanded` — the per-change category label, and the empty-state leaves).
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "ReleaseNotes" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum ReleaseNotesStrings {
    public static let table = "ReleaseNotes"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // --- Web `t()` keys (mirrored 1:1 from the source) ---

    /// The "What's New" body heading — the web `t('changelog.releaseNotes.heading', "What's New")`.
    public static var heading: String {
        string("changelog.releaseNotes.heading", "What's New")
    }

    /// The localized label for a badge — the web `t(BADGE_KEY[badge], BADGE_FALLBACK[badge])`.
    public static func badgeLabel(_ badge: ReleaseNotesBadge) -> String {
        string(badge.localizationKey, badge.fallback)
    }

    // --- Native a11y additions (no web `t()` key; the web gets these from semantic HTML) ---

    /// VoiceOver hint when a release is collapsed — the action a tap performs.
    public static var expandHint: String {
        string("changelog.releaseNotes.expandHint", "Show release notes")
    }

    /// VoiceOver hint when a release is expanded — the action a tap performs.
    public static var collapseHint: String {
        string("changelog.releaseNotes.collapseHint", "Hide release notes")
    }

    /// VoiceOver value announced when a release is expanded (spoken peer of `aria-expanded={true}`).
    public static var expandedValue: String {
        string("changelog.releaseNotes.expanded", "Expanded")
    }

    /// VoiceOver value announced when a release is collapsed (spoken peer of `aria-expanded={false}`).
    public static var collapsedValue: String {
        string("changelog.releaseNotes.collapsed", "Collapsed")
    }

    /// The spoken category label for a change dot (native — the web dot conveys the type by color only).
    public static func changeTypeLabel(_ type: ReleaseNotesChangeType) -> String {
        string(type.accessibilityLabelKey, type.accessibilityFallback)
    }

    /// Title of the empty-state leaf shown when there are no releases to list.
    public static var emptyTitle: String {
        string("changelog.releaseNotes.empty", "No release notes yet")
    }

    /// Supporting line of the empty-state leaf.
    public static var emptyMessage: String {
        string(
            "changelog.releaseNotes.emptyMessage",
            "Release notes appear here after the first published version."
        )
    }

    /// Title of the per-release empty body, shown when an open release lists no changes.
    public static var emptyChangesTitle: String {
        string("changelog.releaseNotes.emptyChanges", "No changes recorded")
    }

    /// The hint for the current state — collapse when open, expand when closed.
    public static func toggleHint(isExpanded: Bool) -> String {
        isExpanded ? collapseHint : expandHint
    }

    /// The value for the current state — expanded when open, collapsed when closed.
    public static func stateValue(isExpanded: Bool) -> String {
        isExpanded ? expandedValue : collapsedValue
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ReleaseNotesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogReleaseNotesTelemetry: ReleaseNotesTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - ReleaseNotesModel (P1/S8) — interaction state + derivation

/// The surface's observable state-holder. It owns the current ``ReleaseNotesInput`` (the web props + the
/// changelog) and the single-open `expandedVersion` selection (web `useState(releases[0]?.version ??
/// null)`), derives the pure ``ReleaseNotesProjection`` as an observed read (SwiftUI observation replaces
/// the React re-render), routes header taps through the web `setExpanded(isExpanded ? null : version)`
/// rule, and emits `view.opened` exactly once per instance. The web component has no fetcher, so neither
/// does this holder.
@MainActor
@Observable
public final class ReleaseNotesModel {
    /// The current props + changelog (web `props` + `CHANGELOG`). Reading it (or the derived projection)
    /// registers an observation dependency, so the surface re-renders when the data changes.
    public private(set) var input: ReleaseNotesInput

    /// The single open version (web `expanded`), seeded to the first visible release. `nil` means every
    /// card is collapsed.
    public private(set) var expandedVersion: String?

    @ObservationIgnored private let telemetry: any ReleaseNotesTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: ReleaseNotesInput,
        telemetry: any ReleaseNotesTelemetry = OSLogReleaseNotesTelemetry()
    ) {
        self.input = input
        expandedVersion = ReleaseNotesProjector.defaultExpandedVersion(input.entries, limit: input.limit)
        self.telemetry = telemetry
    }

    /// The resolved, view-ready list (web render output) — a pure function of the props + the open
    /// selection.
    public var projection: ReleaseNotesProjection {
        ReleaseNotesProjector.resolve(input: input, expandedVersion: expandedVersion)
    }

    /// Toggles a release open / closed — the verbatim port of the web `setExpanded(isExpanded ? null :
    /// release.version)`: tapping the open card closes it, tapping any other card opens it (and closes the
    /// previously open one, single-open).
    public func toggle(version: String) {
        expandedVersion = ReleaseNotesProjector.nextExpanded(current: expandedVersion, tapped: version)
    }

    /// Replaces the props + changelog — the native peer of React re-rendering with new props. If the
    /// currently open version is no longer visible (e.g. `limit` shrank or the snapshot changed), the
    /// selection falls back to the new first release so the surface never points at a missing card; an
    /// unchanged input is a no-op so unrelated re-renders do not invalidate observers spuriously.
    public func update(_ input: ReleaseNotesInput) {
        guard input != self.input else { return }
        self.input = input
        let visible = ReleaseNotesProjector.visibleEntries(input.entries, limit: input.limit)
        if let current = expandedVersion, visible.contains(where: { $0.version == current }) {
            return
        }
        expandedVersion = visible.first?.version
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: ReleaseNotesSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
