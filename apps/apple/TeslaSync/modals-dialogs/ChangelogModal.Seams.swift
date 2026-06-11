//
//  ChangelogModal.Seams.swift
//  TeslaSync — P4 modal / dialog · 0003 · ChangelogModal (Apple)
//
//  The dependency seams the ChangelogModal view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S11 telemetry contract (`view.opened`), the action seam (web `markSeen` /
//  `stampShown` / the "View full changelog" `window.open`), the coalesced source snapshot (the release
//  history + the seen-version + freshness), the P1/S8 source protocol, the in-memory source for
//  previews/tests, the P1/S10 i18n facade (web routes copy through `t('changelog…')`; native routes
//  every string through a key with `{{token}}` interpolation), and the VoiceOver string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-gated
/// + redacted there).
public protocol ChangelogTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a static,
/// non-identifying constant.
public struct OSLogChangelogTelemetry: ChangelogTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Action seam (web `markSeen` / `stampShown` / `handleViewFull`)

/// The commands the changelog drives — marking the latest version seen so the unseen-dot clears (web
/// `markSeen`), stamping the auto-show throttle without marking seen (web `stampShown`, fired when the
/// modal is opened), and opening the full GitHub releases page (web `handleViewFull` `window.open`). The
/// default logs the intent without persisting or navigating so previews render safely; the production app
/// injects an adapter over the real `useChangelog` writes + the system `openURL`.
public protocol ChangelogActions: Sendable {
    func markSeen()
    func stampShown()
    func openFullChangelog(url: String)
}

/// `os.Logger`-backed default that records the intents without mutating persistence or navigating.
public struct OSLogChangelogActions: ChangelogActions {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "telemetry")
    }

    public func markSeen() {
        logger.info("changelog.markSeen surface=\(ChangelogSurface.slug, privacy: .public)")
    }

    public func stampShown() {
        logger.info("changelog.stampShown surface=\(ChangelogSurface.slug, privacy: .public)")
    }

    public func openFullChangelog(url: String) {
        logger
            .info("changelog.viewFull surface=\(ChangelogSurface.slug, privacy: .public) url=\(url, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `ChangelogSource`: the load status, the release history (web
/// generated `CHANGELOG`; delivered through the source so the view stays source-driven), the highest
/// version the user has acknowledged (web `seenVersion`; `nil` on a first visit), the live-state
/// freshness, the in-flight refresh flag, and the last-updated timestamp.
public struct ChangelogUpdate: Sendable, Equatable {
    public var status: ChangelogLoadStatus
    public var entries: [ChangelogReleaseEntry]
    public var seenVersion: String?
    public var connection: ChangelogConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: ChangelogLoadStatus = .loading,
        entries: [ChangelogReleaseEntry] = [],
        seenVersion: String? = nil,
        connection: ChangelogConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.entries = entries
        self.seenVersion = seenVersion
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }

    /// The production snapshot: the full native catalogue as the history, with the supplied seen-version
    /// + freshness. Mirrors the web reading the static `CHANGELOG` while `useChangelog` supplies the
    /// localStorage-backed `seenVersion`.
    public static func live(
        seenVersion: String?,
        connection: ChangelogConnection = .live,
        updatedAt: Date? = nil
    ) -> ChangelogUpdate {
        ChangelogUpdate(
            status: .loaded,
            entries: ChangelogCatalog.all,
            seenVersion: seenVersion,
            connection: connection,
            updatedAt: updatedAt
        )
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders — the
/// generated changelog plus the user's acknowledged-version preference — and reports live-state freshness.
/// Previews/tests use `InMemoryChangelogSource`. The view never talks to the network.
@MainActor
public protocol ChangelogSource: AnyObject {
    var onUpdate: (@MainActor (ChangelogUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the seen-version query (the error-state retry / the stale refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and lets a
/// test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryChangelogSource: ChangelogSource {
    public var onUpdate: (@MainActor (ChangelogUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChangelogUpdate?

    public init(initial: ChangelogUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: ChangelogUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t('changelog…')` → keyed strings

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "ChangelogModal" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time; kept per-surface so each parallel prompt owns its own strings. Supports the web
/// `{{token}}` interpolation used by the "{{count}} new release(s)" subtitle.
public enum ChangelogStrings {
    public static let table = "ChangelogModal"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a key then interpolates the `{{token}}` markers (web `t(key, fallback, { token: value })`).
    public static func string(
        _ key: String,
        _ fallback: String,
        _ tokens: [String: String]
    ) -> String {
        interpolate(string(key, fallback), tokens)
    }

    /// Substitutes `{{name}}` style markers from the token map. Pure + bundle-free for testability.
    public static func interpolate(_ template: String, _ tokens: [String: String]) -> String {
        var result = template
        for (token, value) in tokens {
            result = result.replacingOccurrences(of: "{{\(token)}}", with: value)
        }
        return result
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the summaries
/// are testable without a bundle.
public enum ChangelogAccessibility {
    /// The dialog's container label (web Modal `title`).
    public static func dialogLabel(localize: (String, String) -> String) -> String {
        localize("changelog.modal.title", "What's new in TeslaSync")
    }

    /// One release row's container label: the version, the badge state, and the release date — so a single
    /// swipe summarises the row.
    public static func entryLabel(
        version: String,
        badge: ChangelogBadgeKind,
        date: String,
        localize: (String, String) -> String
    ) -> String {
        let badgeLabel = localize(badge.labelKey, badge.fallbackLabel)
        let template = localize("changelog.a11y.entry", "Version {{version}}, {{badge}}, released {{date}}")
        return ChangelogStrings.interpolate(
            template,
            ["version": version, "badge": badgeLabel, "date": date]
        )
    }

    /// One release row's expand/collapse hint, reflecting the current disclosure state.
    public static func entryHint(isExpanded: Bool, localize: (String, String) -> String) -> String {
        isExpanded
            ? localize("changelog.a11y.collapse", "Collapse release notes")
            : localize("changelog.a11y.expand", "Expand release notes")
    }
}
