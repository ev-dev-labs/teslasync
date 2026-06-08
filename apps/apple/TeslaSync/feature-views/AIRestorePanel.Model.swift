//
//  AIRestorePanel.Model.swift
//  TeslaSync — P4 feature view · 0201 · AIRestorePanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the "Restore previous Helix selection?" panel. The view binds through
//  `AIRestoreModel`; no networking lives in the view. The web source
//  (AIRestorePanel.tsx) is a presentational leaf fed an `archived` map plus
//  `onConfirm` / `onDecline` callbacks by its parent (AISettings), so the input
//  snapshot here carries that archived selection (plus the parent's loading / error /
//  connectivity state) and the model forwards the two actions to the seam rather than
//  issuing HTTP itself.
//
//  States: the web leaf renders its preview list when there is at least one restorable
//  entry. On top of that, this surface honours the P4 leaf contract: a `phase`
//  (loading / empty / error / data) fed by the parent's query state, and an orthogonal
//  `connection` axis (live / stale / offline) surfaced as a freshness chip + banner
//  with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol AIRestoreTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogAIRestoreTelemetry: AIRestoreTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum AIRestoreConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from AISettings)

/// One coalesced snapshot of the panel's inputs — the native mirror of the web
/// `archived` prop plus the parent surface's lifecycle (`isLoading`, an error message,
/// and connectivity). The archived entries are carried in order so the preview list
/// matches the web `Object.entries(archived)` walk.
public struct AIRestoreInput: Sendable, Equatable {
    public var archived: [AIArchivedEntry]?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: AIRestoreConnection

    public init(
        archived: [AIArchivedEntry]? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: AIRestoreConnection = .live
    ) {
        self.archived = archived
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the panel's render branches.
/// `phase` selects the body; `labels` is the pre-computed preview list so the view is
/// a pure function of this value.
public struct AIRestoreResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let labels: [AIRestoreLabel]

    public init(phase: Phase, labels: [AIRestoreLabel]) {
        self.phase = phase
        self.labels = labels
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's render branches plus the P4 leaf contract. Unit tested
/// across loading / empty / error / data.
public enum AIRestoreProjection {
    public static func resolve(_ input: AIRestoreInput) -> AIRestoreResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return AIRestoreResolved(phase: .error(message), labels: [])
        }
        // Initial fetch (web parent `isLoading`) or no snapshot yet.
        guard !input.isLoading, let archived = input.archived else {
            return AIRestoreResolved(phase: .loading, labels: [])
        }
        let labels = AIRestorePreview.labels(for: archived)
        // Web `archiveHasRestorableEntries`: nothing enabled ⇒ nothing to restore.
        guard !labels.isEmpty else {
            return AIRestoreResolved(phase: .empty, labels: [])
        }
        return AIRestoreResolved(phase: .data, labels: labels)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// AISettings archived-selection query (and routes `confirm` / `decline` to the save
/// mutation + session dismissal); previews and tests use `InMemoryAIRestoreSource`.
/// The view never talks to the network directly.
@MainActor
public protocol AIRestoreSource: AnyObject {
    var onUpdate: (@MainActor (AIRestoreInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Web `onConfirm` — apply the archived selection AND persist it.
    func confirm()
    /// Web `onDecline` — dismiss the prompt for the session.
    func decline()
}

/// The panel's observable view-model. Subscribes to an `AIRestoreSource`, recomputes
/// the resolved projection, exposes a render `phase` + the resolved view-state and the
/// `connection` axis, forwards the confirm / decline actions, and auto-refreshes once
/// when the feed transitions to stale.
@MainActor
@Observable
public final class AIRestoreModel {
    public private(set) var resolved: AIRestoreResolved = AIRestoreProjection.resolve(AIRestoreInput(isLoading: true))
    public private(set) var connection: AIRestoreConnection = .live

    public var phase: AIRestoreResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any AIRestoreSource
    @ObservationIgnored private let telemetry: any AIRestoreTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any AIRestoreSource,
        telemetry: any AIRestoreTelemetry = OSLogAIRestoreTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AIRestorePanel.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Applies the archived selection and persists it (web `onConfirm`).
    public func confirm() {
        source.confirm()
    }

    /// Dismisses the prompt for the session (web `onDecline`).
    public func decline() {
        source.decline()
    }

    private func apply(_ input: AIRestoreInput) {
        resolved = AIRestoreProjection.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)` and assert
/// the forwarded action counts.
@MainActor
public final class InMemoryAIRestoreSource: AIRestoreSource {
    public var onUpdate: (@MainActor (AIRestoreInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var confirmCount = 0
    public private(set) var declineCount = 0

    private let initial: AIRestoreInput?

    public init(initial: AIRestoreInput? = nil) {
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

    public func confirm() {
        confirmCount += 1
    }

    public func decline() {
        declineCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: AIRestoreInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "AIRestorePanel" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum AIRestoreStrings {
    public static let table = "AIRestorePanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a preview label's display text — the per-feature i18n key with its
    /// catalog fallback for a known feature, or the raw id verbatim for an unknown one
    /// (web `previewLabels`: `t(key, name)` vs the raw `id`).
    public static func label(_ label: AIRestoreLabel) -> String {
        guard let key = label.labelKey else { return label.fallback }
        return string(key, label.fallback)
    }
}
