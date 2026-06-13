//
//  TeslaReauthBanner.Model.swift
//  TeslaSync — P4 shared surface · 0142 · TeslaReauthBanner (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the Tesla re-authentication banner. The view binds through `TeslaReauthBannerModel`;
//  no networking lives in the view. The web `TeslaReauthBanner` is self-driven: it listens to the
//  document-level `teslasync:tesla-auth-expired` / `teslasync:tesla-auth-recovered` events, toggles a
//  `visible` flag, hides on dismiss, deep-links to `/tesla-account` on "Reconnect", and on recovery
//  replays the queued Tesla mutations via `drainQueuedTeslaMutations()`. The native model keeps the
//  same contract: a source emits the coalesced grant status (+ the store's load / connectivity state),
//  the model derives the resolved banner, tracks the internal `dismissed` flag, forwards the
//  reconnect deep-link, drains the queued mutations on the recovery edge, and auto-refreshes once when
//  the feed transitions to stale.
//
//  States (every one renders — no hidden surface):
//    • loading — the auth signal is being read → skeleton banner chrome.
//    • empty   — the grant is healthy / acknowledged (web `if (!visible) return null`) → a friendly
//                "connected" state (the native improvement over the web component rendering nothing).
//    • error   — the auth signal read failed → a retryable error tile (web `QueryError` peer).
//    • data    — the disconnection notice: the title + body copy plus the "Reconnect" / "Dismiss"
//                affordances (web `visible`).
//    • stale / offline — the orthogonal `connection` axis → a freshness chip beneath the banner with a
//                one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity

/// The diagnostics surface slug, kept on a pure type so the model (and its isolated unit tests) need
/// not reference the SwiftUI surface view to emit `view.opened`.
public enum TeslaReauthBannerSurface {
    public static let slug = "TeslaReauthBanner"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol TeslaReauthBannerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogTeslaReauthBannerTelemetry: TeslaReauthBannerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound auth signal — the orthogonal connectivity axis rendered as the freshness
/// chip. `live` hides the chip; `stale` / `offline` show it.
public enum TeslaReauthConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (grant status + signal lifecycle)

/// One coalesced snapshot of the surface's inputs — the Tesla OAuth grant status (the native parity of
/// the web `visible` flag derived from the `tesla-auth-expired` / `tesla-auth-recovered` events) plus
/// the signal's lifecycle (`isLoading`, an error message, and connectivity).
public struct TeslaReauthInput: Sendable, Equatable {
    public var status: TeslaReauthStatus
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: TeslaReauthConnection

    public init(
        status: TeslaReauthStatus = .unknown,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: TeslaReauthConnection = .live
    ) {
        self.status = status
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body; for the data phase the resolved `copy`
/// is pre-computed so the view is a pure function of this value and snapshot tests assert it directly.
public struct TeslaReauthResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let copy: TeslaReauthCopy?

    public init(phase: Phase, copy: TeslaReauthCopy?) {
        self.phase = phase
        self.copy = copy
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot (+ the internal `dismissed` flag) to the resolved
/// view-state — the native port of the web banner's control flow plus the P4 leaf contract:
///   • a signal read failure surfaces as `error` (web `QueryError` peer).
///   • an unknown status that is still loading is `loading`; an unknown status at rest is the friendly
///     `empty` (web returns `null`).
///   • a healthy `connected` grant is the friendly `empty` (web `if (!visible) return null`).
///   • an `expired` grant renders the `data` notice — unless it has been dismissed (web
///     `setVisible(false)`), which collapses to the friendly `empty`.
/// Unit tested across every branch.
public enum TeslaReauthProjection {
    public static func resolve(
        input: TeslaReauthInput,
        dismissed: Bool = false,
        strings: TeslaReauthResolve = TeslaReauthStrings.string
    ) -> TeslaReauthResolved {
        if let message = input.errorMessage, !message.isEmpty {
            return TeslaReauthResolved(phase: .error(message), copy: nil)
        }
        switch input.status {
        case .unknown:
            return TeslaReauthResolved(phase: input.isLoading ? .loading : .empty, copy: nil)
        case .connected:
            return TeslaReauthResolved(phase: .empty, copy: nil)
        case .expired:
            if dismissed {
                return TeslaReauthResolved(phase: .empty, copy: nil)
            }
            return TeslaReauthResolved(phase: .data, copy: TeslaReauthCopy.render(strings: strings))
        }
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `TeslaReauthSource`, recomputes the resolved
/// projection, exposes a render `phase` + the resolved copy and the `connection` axis, tracks the
/// `dismissed` flag, forwards the reconnect deep-link (web `navigate('/tesla-account')`), drains the
/// queued Tesla mutations on the recovery edge (web `drainQueuedTeslaMutations()`), and auto-refreshes
/// once when the signal transitions to stale.
@MainActor
@Observable
public final class TeslaReauthBannerModel {
    public private(set) var resolved = TeslaReauthResolved(phase: .loading, copy: nil)
    public private(set) var connection: TeslaReauthConnection = .live

    public var phase: TeslaReauthResolved.Phase {
        resolved.phase
    }

    public var copy: TeslaReauthCopy? {
        resolved.copy
    }

    @ObservationIgnored private let source: any TeslaReauthSource
    @ObservationIgnored private let telemetry: any TeslaReauthBannerTelemetry
    @ObservationIgnored private let onReconnect: (@MainActor () -> Void)?
    @ObservationIgnored private let onRecovered: (@MainActor () -> Void)?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var dismissed = false
    @ObservationIgnored private var wasExpired = false
    @ObservationIgnored private var lastInput = TeslaReauthInput()

    public init(
        source: any TeslaReauthSource,
        telemetry: any TeslaReauthBannerTelemetry = OSLogTeslaReauthBannerTelemetry(),
        onReconnect: (@MainActor () -> Void)? = nil,
        onRecovered: (@MainActor () -> Void)? = nil
    ) {
        self.source = source
        self.telemetry = telemetry
        self.onReconnect = onReconnect
        self.onRecovered = onRecovered
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TeslaReauthBannerSurface.slug)
        source.start()
    }

    /// Stops observing the upstream signal.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Web `handleReconnect`: deep-link to `/tesla-account` to complete the OAuth flow again. The banner
    /// stays visible — it hides only when the recovery event arrives (or the user dismisses).
    public func reconnect() {
        onReconnect?()
    }

    /// Web `handleDismiss`: set the `dismissed` flag (web `setVisible(false)`) and recompute to the
    /// hidden/empty leaf. Dismiss does NOT drain the queued mutations — only recovery does.
    public func dismiss() {
        dismissed = true
        recompute(lastInput)
    }

    private func apply(_ input: TeslaReauthInput) {
        // A fresh expiry (web `tesla-auth-expired`) clears a prior dismissal so the new disconnection
        // episode re-shows; a re-emit of the same expired snapshot (refresh / connectivity change) does
        // not, so the dismiss affordance survives a freshness refresh.
        if input.status == .expired, !wasExpired {
            dismissed = false
        }
        // The recovery edge (web `tesla-auth-recovered`) replays the queued Tesla mutations once.
        if wasExpired, input.status == .connected {
            onRecovered?()
        }
        wasExpired = input.status == .expired
        lastInput = input
        recompute(input)
        let previous = connection
        connection = input.connection
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func recompute(_ input: TeslaReauthInput) {
        resolved = TeslaReauthProjection.resolve(input: input, dismissed: dismissed)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "TeslaReauthBanner" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum TeslaReauthStrings {
    public static let table = "TeslaReauthBanner"

    public static let string: TeslaReauthResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
