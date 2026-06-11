//
//  QueryError.Model.swift
//  TeslaSync — P4 shared surface · 0133 · QueryError (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), the
//  connectivity axis (the native parity of the web `useOnlineStatus`), and the pure projection for the
//  QueryError shared surface. The view binds through `QueryErrorModel`; no networking lives in the
//  view. A source emits the coalesced inputs (the controlled failure + the resource/list context the
//  caller passes — the web `error` / `resourceName` / `listHref` props — plus the live online state and
//  the P4 freshness axis); the model derives the resolved failure over them, exposes a render `phase`
//  + the `connection` axis, forwards the host's retry handler (web `onRetry`) and navigations (web
//  `useNavigate`), auto-retries once when the browser reconnects on a pure-network failure (the web
//  `window 'online'` effect), and auto-refreshes once when the feed transitions to stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol QueryErrorTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogQueryErrorTelemetry: QueryErrorTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity axis (web `useOnlineStatus` + P4 freshness)

/// The freshness of the data the surface renders over. `offline` is the web `useOnlineStatus` false
/// state (which also selects the offline failure copy); `stale` is the P4 leaf-contract freshness
/// window (the surface's last failure snapshot is older than the freshness budget); `live` shows
/// neither the freshness chip nor the offline copy.
public enum QueryErrorConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (controlled failure + context + connectivity + lifecycle)

/// One coalesced snapshot of the surface's inputs — the controlled `QueryFailure` (the web `error`,
/// `nil` when the query succeeded), the resource/list context (web `resourceName` / `listHref`), the
/// live online state (web `useOnlineStatus`), the P4 freshness flag, plus the parent's loading
/// lifecycle. The surface is derived purely from this value.
public struct QueryErrorInput: Sendable, Equatable {
    public var failure: QueryFailure?
    public var resourceName: String?
    public var listHref: String?
    public var online: Bool
    public var isStale: Bool
    public var isLoading: Bool

    public init(
        failure: QueryFailure? = nil,
        resourceName: String? = nil,
        listHref: String? = nil,
        online: Bool = true,
        isStale: Bool = false,
        isLoading: Bool = false
    ) {
        self.failure = failure
        self.resourceName = resourceName
        self.listHref = listHref
        self.online = online
        self.isStale = isStale
        self.isLoading = isLoading
    }

    /// The derived connectivity axis: offline wins (web `!online`), then the P4 stale window, else
    /// live. Kept derived so the single `online` flag stays the source of truth for the offline copy.
    public var connection: QueryErrorConnection {
        if !online {
            return .offline
        }
        return isStale ? .stale : .live
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body; for the `.failure` phase the derived
/// `content` payload is pre-computed so the view is a pure function of this value.
public struct QueryErrorResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case failure
    }

    public let phase: Phase
    public let content: QueryErrorContent?

    public init(phase: Phase, content: QueryErrorContent?) {
        self.phase = phase
        self.content = content
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot (+ whether retry is wired) to the resolved view-state. The
/// branch priority is: a present failure (classified into the web branch ladder via
/// `QueryErrorMode.classify` + rendered via `QueryErrorContent.make`) → the initial fetch (`loading`,
/// the parent is still resolving the query) → the friendly empty state (web `QueryError` returns
/// `null` on success; the P4 leaf contract renders a calm "all clear" instead of a blank box). Unit
/// tested across every branch.
public enum QueryErrorProjection {
    public static func resolve(input: QueryErrorInput, canRetry: Bool) -> QueryErrorResolved {
        if let failure = input.failure {
            let mode = QueryErrorMode.classify(failure: failure, online: input.online)
            let content = QueryErrorContent.make(
                mode: mode,
                resourceName: input.resourceName,
                listHref: input.listHref,
                canRetry: canRetry
            )
            return QueryErrorResolved(phase: .failure, content: content)
        }
        if input.isLoading {
            return QueryErrorResolved(phase: .loading, content: nil)
        }
        return QueryErrorResolved(phase: .empty, content: nil)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `QueryErrorSource`, recomputes the resolved
/// projection, exposes a render `phase` + the resolved view-state and the `connection` axis, forwards
/// the host retry handler (web `onRetry`) and the navigations (web `useNavigate`), fires the web
/// one-shot auto-retry when the browser reconnects on a pure-network failure, and auto-refreshes once
/// when the feed transitions to stale. No networking lives here — the data is owned upstream.
@MainActor
@Observable
public final class QueryErrorModel {
    public private(set) var resolved: QueryErrorResolved = .init(phase: .empty, content: nil)
    public private(set) var connection: QueryErrorConnection = .live

    public var phase: QueryErrorResolved.Phase {
        resolved.phase
    }

    /// Whether the host supplied a retry handler (web optional `onRetry`). Gates the Retry CTAs.
    public let canRetry: Bool

    @ObservationIgnored private let source: any QueryErrorSource
    @ObservationIgnored private let navigator: any QueryErrorNavigator
    @ObservationIgnored private let telemetry: any QueryErrorTelemetry
    @ObservationIgnored private let onRetry: (@MainActor () -> Void)?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var armedForReconnect = false
    @ObservationIgnored private var lastConnection: QueryErrorConnection = .live

    public init(
        source: any QueryErrorSource,
        navigator: any QueryErrorNavigator,
        telemetry: any QueryErrorTelemetry = OSLogQueryErrorTelemetry(),
        onRetry: (@MainActor () -> Void)? = nil
    ) {
        self.source = source
        self.navigator = navigator
        self.telemetry = telemetry
        self.onRetry = onRetry
        canRetry = onRetry != nil
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: QueryError.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed. Re-arms the one-shot `view.opened` for the next `start`.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot and re-runs the host query (web `onRetry`). Shared by the
    /// Retry CTAs, the freshness chip, and the stale auto-refresh.
    public func refresh() {
        onRetry?()
        source.refresh()
    }

    /// Performs a resolved CTA — the navigating verbs go through the navigator (web `useNavigate`);
    /// the retry verbs re-run the query (web `onRetry`). A disabled CTA is a no-op.
    public func perform(_ action: QueryErrorAction) {
        guard action.isEnabled else { return }
        switch action.kind {
        case .backToList, .signIn:
            if let destination = action.destination {
                navigator.navigate(to: destination)
            }
        case .retry, .retryWhenOnline:
            refresh()
        }
    }

    private func apply(_ input: QueryErrorInput) {
        resolved = QueryErrorProjection.resolve(input: input, canRetry: canRetry)
        connection = input.connection

        // Web auto-retry effect: arm only on a pure-network failure (status `undefined`) while
        // offline with a wired `onRetry`; fire once when the browser reconnects.
        let previouslyArmed = armedForReconnect
        armedForReconnect = input.failure != nil
            && input.failure?.status == nil
            && !input.online
            && onRetry != nil
        if previouslyArmed, input.online {
            onRetry?()
        }

        // P4 freshness: one-shot auto-refresh on the transition into stale (web parent re-fetch).
        if input.connection == .stale, lastConnection != .stale {
            source.refresh()
        }
        lastConnection = input.connection
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's chrome strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "QueryError" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings. The failure-mode copy reuses the web `error.*` keys verbatim for catalog parity.
public enum QueryErrorStrings {
    public static let table = "QueryError"

    public static let string: QueryErrorResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
