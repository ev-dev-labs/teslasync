//
//  DraftRestorePrompt.Model.swift
//  TeslaSync — P4 shared surface · 0117 · DraftRestorePrompt (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), the
//  connectivity axis, the input snapshot, the pure projection, and the surface metadata for the
//  draft-restore prompt. The view binds through `DraftRestorePromptModel`; no networking lives in the
//  view. The web component owns its state with `useState` over the `draftIndex` module: it surfaces the
//  index once on mount (after the cross-tab grace window), opens a review modal, removes rows on
//  discard, re-syncs against `subscribeDraftIndex`, and writes a per-session one-shot guard on dismiss.
//  The native model keeps the same contract: a source emits coalesced snapshots of the index (the
//  drafts + the actively-edited key set + the feed's load / connectivity state), the model recomputes
//  the resolved projection and the render phase, owns the review-sheet + per-session dismissal, forwards
//  `discard(storageKey)` + `markDismissed()`, hands the host a resume route, and auto-refreshes once
//  when the feed goes stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface metadata (so the model is testable without the SwiftUI View)

/// Surface identity shared by the model (telemetry) and the SwiftUI `DraftRestorePrompt` view, so the
/// model can emit `view.opened` with a stable slug without depending on the view type.
public enum DraftRestorePromptMeta {
    public static let surfaceSlug = "DraftRestorePrompt"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol DraftRestoreTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDraftRestoreTelemetry: DraftRestoreTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound draft index — the orthogonal connectivity axis rendered as the freshness
/// chip. `live` hides the chip; `stale` / `offline` show it.
public enum DraftRestoreConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Load status (web mount-eval lifecycle)

/// The load lifecycle for the draft index, mirroring the shared `LoadableState` cases the production
/// source projects: `loading` during the cross-tab grace window, `loaded` / `empty` once the index is
/// read, `failed` when the storage read throws.
public enum DraftRestoreLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

// MARK: - Input snapshot (coalesced source push)

/// One coalesced snapshot of the surface's inputs — the draft index (`getDrafts()`), the set of keys a
/// sibling tab announced it is actively editing (the web `formDraft.acquired` grace-window collection),
/// plus the feed's load / connectivity lifecycle. The model applies the surfacing filter + derives the
/// resolved projection, and tracks the `connection` axis for the freshness chip.
public struct DraftRestoreUpdate: Sendable, Equatable {
    public var status: DraftRestoreLoadStatus
    public var connection: DraftRestoreConnection
    public var isFetching: Bool
    public var drafts: [DraftEntry]
    public var activeKeys: Set<String>
    public var updatedAt: Date?

    public init(
        status: DraftRestoreLoadStatus = .loading,
        connection: DraftRestoreConnection = .live,
        isFetching: Bool = false,
        drafts: [DraftEntry] = [],
        activeKeys: Set<String> = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.drafts = drafts
        self.activeKeys = activeKeys
        self.updatedAt = updatedAt
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body; `drafts` is the surfaced (active-keys
/// filtered, de-duped) list the review modal renders one row per. A pure value so the view is a
/// function of it and snapshot tests assert it directly.
public struct DraftRestoreResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let drafts: [DraftEntry]

    public init(phase: Phase, drafts: [DraftEntry]) {
        self.phase = phase
        self.drafts = drafts
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the coalesced snapshot to the resolved view-state — the native port of the web
/// surface's control flow plus the P4 leaf contract. It applies the web mount filter
/// (`DraftIndex.surfaced`), then: a read failure surfaces as `error` (unless cached drafts are still
/// present, which stay visible behind a transient failure — the leaf contract); the initial read with
/// no surfaced drafts is `loading`; an idle read with no surfaced drafts is the friendly `empty` (the
/// native improvement over the web rendering nothing); any surfaced draft renders the `data` prompt.
/// Unit tested across every branch.
public enum DraftRestoreProjection {
    public static func resolve(
        status: DraftRestoreLoadStatus,
        drafts: [DraftEntry],
        activeKeys: Set<String>,
        connection _: DraftRestoreConnection = .live
    ) -> DraftRestoreResolved {
        let surfaced = DraftIndex.surfaced(all: drafts, activeKeys: activeKeys)
        let hasDrafts = !surfaced.isEmpty

        switch status {
        case .loading:
            return DraftRestoreResolved(phase: hasDrafts ? .data : .loading, drafts: surfaced)
        case .empty, .loaded:
            return DraftRestoreResolved(phase: hasDrafts ? .data : .empty, drafts: surfaced)
        case let .failed(message):
            return DraftRestoreResolved(phase: hasDrafts ? .data : .error(message), drafts: surfaced)
        }
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `DraftRestoreSource`, recomputes the resolved
/// projection + render `phase`, exposes the `connection` axis, owns the review-sheet + the per-session
/// one-shot dismissal, forwards `discard(storageKey)` (web `discardDraftEnvelope`) + `markDismissed()`
/// (web `writeDismissed`), hands the host a resume route (web `navigate(entry.route)`), and
/// auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class DraftRestorePromptModel {
    public private(set) var resolved = DraftRestoreResolved(phase: .loading, drafts: [])
    public private(set) var connection: DraftRestoreConnection = .live
    public private(set) var isFetching = false
    public private(set) var updatedAt: Date?

    /// Whether the review modal is presented (web `reviewOpen`). Settable so the SwiftUI sheet binds to
    /// it; closing the sheet routes through `dismiss()` (web `Modal onClose={handleDismiss}`).
    public var isReviewing = false

    /// The per-session one-shot guard (web `writeDismissed` / `readDismissed`). Once the user dismisses,
    /// resumes, or clears the list, the transient prompt collapses for the rest of the session.
    public private(set) var dismissed = false

    public var phase: DraftRestoreResolved.Phase {
        resolved.phase
    }

    /// The surfaced, de-duped draft list the review modal renders one row per.
    public var drafts: [DraftEntry] {
        resolved.drafts
    }

    /// Whether the bottom-left toast card should show — the web `showPrompt && !reviewOpen` gate, here
    /// "data phase and not yet dismissed" (the sheet covers the card while reviewing).
    public var isPromptVisible: Bool {
        phase == .data && !dismissed
    }

    @ObservationIgnored private let source: any DraftRestoreSource
    @ObservationIgnored private let telemetry: any DraftRestoreTelemetry
    @ObservationIgnored private let onResume: (@MainActor (DraftEntry) -> Void)?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var lastConnection: DraftRestoreConnection = .live

    public init(
        source: any DraftRestoreSource,
        telemetry: any DraftRestoreTelemetry = OSLogDraftRestoreTelemetry(),
        onResume: (@MainActor (DraftEntry) -> Void)? = nil
    ) {
        self.source = source
        self.telemetry = telemetry
        self.onResume = onResume
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DraftRestorePromptMeta.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream index.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Opens the review modal (web `handleReview` → `setReviewOpen(true)`).
    public func review() {
        isReviewing = true
    }

    /// Dismisses the prompt for the rest of the session — the web `handleDismiss`: write the one-shot
    /// guard, close the modal, and hide the card. The single "hide" path; the Close / X / swipe-to-close
    /// affordances and `resume` all route through here.
    public func dismiss() {
        dismissed = true
        isReviewing = false
        source.markDismissed()
    }

    /// Resumes editing a draft — the web `handleResume`: write the guard, close the prompt, then hand
    /// the host the entry to navigate to (`navigate(entry.route)`). The route is normalised so the host
    /// always receives a valid in-app pathname.
    public func resume(_ entry: DraftEntry) {
        dismiss()
        onResume?(entry)
    }

    /// The normalised resume target for an entry — the web `entry.route` with its "/" fallback. Exposed
    /// so a host that prefers a string over the entry can read it directly.
    public func resumeRoute(for entry: DraftEntry) -> String {
        DraftRestoreResumeRoute.normalize(for: entry)
    }

    /// Discards a draft — the web `handleDiscard`: clear its stored envelope and drop its row. Removes
    /// it from the resolved list immediately so a re-render does not resurrect it, notifies the source
    /// so the upstream index drops it too, and collapses the prompt when the list empties (web
    /// `if next.length === 0 { setReviewOpen(false); setShowPrompt(false) }`).
    public func discard(_ entry: DraftEntry) {
        let next = DraftIndex.removing(storageKey: entry.storageKey, from: resolved.drafts)
        resolved = DraftRestoreResolved(phase: next.isEmpty ? .empty : .data, drafts: next)
        source.discard(storageKey: entry.storageKey)
        if next.isEmpty {
            dismiss()
        }
    }

    /// Auto-refreshes when the feed has gone stale but is not already fetching — the native parity of
    /// the web freshness self-refresh on stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: DraftRestoreUpdate) {
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        resolved = DraftRestoreProjection.resolve(
            status: update.status,
            drafts: update.drafts,
            activeKeys: update.activeKeys,
            connection: update.connection
        )
        let previous = lastConnection
        connection = update.connection
        lastConnection = update.connection
        if update.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "DraftRestorePrompt" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum DraftRestoreStrings {
    public static let table = "DraftRestorePrompt"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The facade as a `DraftRestoreResolve` closure, for the pure adapter helpers.
    public static let resolve: DraftRestoreResolve = { key, fallback in
        DraftRestoreStrings.string(key, fallback)
    }
}
