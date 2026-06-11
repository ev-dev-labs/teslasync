//
//  EmptyStateThreshold.Model.swift
//  TeslaSync — P4 shared surface · 0119 · EmptyStateThreshold (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  pure projection for the EmptyStateThreshold shared surface. The view binds through
//  `EmptyStateThresholdModel`; no networking lives in the view. A source emits the coalesced inputs
//  (the controlled gate — the web props + counts — the feed freshness, plus the parent's loading /
//  error state); the model derives the resolved view-state over them, exposes a render `phase` + the
//  `connection` axis, forwards the host's CTA handler (web `action`), and auto-refreshes once when
//  the feed transitions to stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol EmptyStateThresholdTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogEmptyStateThresholdTelemetry: EmptyStateThresholdTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (controlled gate + connectivity + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the controlled `EmptyStateThresholdGate` (the
/// web props + counts, `nil` when the section is no longer gated), the feed freshness, plus the
/// parent's lifecycle (`isLoading`, an error message). The view-state is derived purely from this.
public struct EmptyStateThresholdInput: Sendable, Equatable {
    public var gate: EmptyStateThresholdGate?
    public var connection: EmptyStateThresholdConnection
    public var isLoading: Bool
    public var errorMessage: String?

    public init(
        gate: EmptyStateThresholdGate? = nil,
        connection: EmptyStateThresholdConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) {
        self.gate = gate
        self.connection = connection
        self.isLoading = isLoading
        self.errorMessage = errorMessage
    }
}

// MARK: - Resolved view-state (web render branch + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body; for the `.threshold` phase the derived
/// `content` payload is pre-computed so the view is a pure function of this value.
public struct EmptyStateThresholdResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case threshold
    }

    public let phase: Phase
    public let content: EmptyStateThresholdContent?

    public init(phase: Phase, content: EmptyStateThresholdContent?) {
        self.phase = phase
        self.content = content
    }
}

// MARK: - Projection (web render branch + P4 leaf contract)

/// Pure projection from the input snapshot (+ the host CTA capability) to the resolved view-state.
/// The branch priority is: a count-feed failure (`error`) → the initial fetch (`loading`) → the
/// controlled gate (`threshold`, the web card) → the friendly empty state (never a blank box, the
/// native improvement over the web host simply unmounting). The connectivity axis does not gate the
/// card — it surfaces as the freshness chip beside it. Unit tested across every branch.
public enum EmptyStateThresholdProjection {
    public static func resolve(input: EmptyStateThresholdInput, canAct: Bool) -> EmptyStateThresholdResolved {
        if let message = input.errorMessage, !message.isEmpty {
            return EmptyStateThresholdResolved(phase: .error(message), content: nil)
        }
        if input.isLoading {
            return EmptyStateThresholdResolved(phase: .loading, content: nil)
        }
        if let gate = input.gate {
            return EmptyStateThresholdResolved(phase: .threshold, content: gate.content(canAct: canAct))
        }
        return EmptyStateThresholdResolved(phase: .empty, content: nil)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to an `EmptyStateThresholdSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the `connection` axis,
/// forwards the host CTA handler (web `action`), and auto-refreshes once when the feed transitions to
/// stale. No networking lives here — the data is owned upstream.
@MainActor
@Observable
public final class EmptyStateThresholdModel {
    public private(set) var resolved: EmptyStateThresholdResolved = .init(phase: .loading, content: nil)
    public private(set) var connection: EmptyStateThresholdConnection = .live

    public var phase: EmptyStateThresholdResolved.Phase {
        resolved.phase
    }

    /// Whether the host wired a CTA handler (web optional `action`). Gates the trailing CTA button.
    public let canAct: Bool

    @ObservationIgnored private let source: any EmptyStateThresholdSource
    @ObservationIgnored private let telemetry: any EmptyStateThresholdTelemetry
    @ObservationIgnored private let onAction: (@MainActor () -> Void)?
    @ObservationIgnored private var started = false

    public init(
        source: any EmptyStateThresholdSource,
        telemetry: any EmptyStateThresholdTelemetry = OSLogEmptyStateThresholdTelemetry(),
        onAction: (@MainActor () -> Void)? = nil
    ) {
        self.source = source
        self.telemetry = telemetry
        self.onAction = onAction
        canAct = onAction != nil
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EmptyStateThreshold.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed. Re-arms the one-shot `view.opened` for the next `start`.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Invokes the host's CTA handler (web `action`) — a no-op when none supplied.
    public func performAction() {
        onAction?()
    }

    private func apply(_ input: EmptyStateThresholdInput) {
        resolved = EmptyStateThresholdProjection.resolve(input: input, canAct: canAct)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's chrome strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "EmptyStateThreshold" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings. The count copy reuses the web source's own keys (`emptyState.threshold.*`).
public enum EmptyStateThresholdStrings {
    public static let table = "EmptyStateThreshold"

    public static let string: EmptyStateThresholdResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
