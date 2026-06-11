//
//  AlertBanner.Model.swift
//  TeslaSync — P4 shared surface · 0113 · AlertBanner (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  pure projection for the AlertBanner shared surface. The view binds through `AlertBannerModel`;
//  no networking lives in the view. A source emits the coalesced inputs (the controlled notice — a
//  raw banner or one bridged from the `useMutationToast` bus — the live-connection freshness, plus
//  the parent's loading / error state); the model derives the resolved banner over them, exposes a
//  render `phase` + the `connection` axis, forwards the host's dismiss handler (web `onClose`), and
//  auto-refreshes once when the feed transitions to stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol AlertBannerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event.
public struct OSLogAlertBannerTelemetry: AlertBannerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (controlled notice + connectivity + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the controlled `AlertBannerNotice` (the web
/// props, `nil` when nothing should show — bridge a `useMutationToast` event with
/// `AlertBannerNotice.from(mutation:)`), the live-connection freshness, plus the parent's lifecycle
/// (`isLoading`, an error message). The banner is derived purely from this value.
public struct AlertBannerInput: Sendable, Equatable {
    public var notice: AlertBannerNotice?
    public var connection: AlertBannerConnection
    public var isLoading: Bool
    public var errorMessage: String?

    public init(
        notice: AlertBannerNotice? = nil,
        connection: AlertBannerConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) {
        self.notice = notice
        self.connection = connection
        self.isLoading = isLoading
        self.errorMessage = errorMessage
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body; for the `.alert` phase the derived
/// `content` payload is pre-computed so the view is a pure function of this value.
public struct AlertBannerResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case alert
    }

    public let phase: Phase
    public let content: AlertBannerContent?

    public init(phase: Phase, content: AlertBannerContent?) {
        self.phase = phase
        self.content = content
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot (+ the host dismiss capability) to the resolved
/// view-state. The branch priority is: a surface feed failure (`error`) → the initial fetch
/// (`loading`) → the persistent connectivity banner (the documented `OfflineBanner` /
/// `LiveStaleDataBanner`, which override the page) → the controlled notice (a raw banner or a
/// mutation-toast banner) → the friendly empty state (never a blank box). Unit tested across every
/// branch + the dismiss gate.
public enum AlertBannerProjection {
    public static func resolve(input: AlertBannerInput, canDismiss: Bool) -> AlertBannerResolved {
        if let message = input.errorMessage, !message.isEmpty {
            return AlertBannerResolved(phase: .error(message), content: nil)
        }
        if input.isLoading {
            return AlertBannerResolved(phase: .loading, content: nil)
        }
        if let connectivity = AlertBannerNotice.connectivity(for: input.connection) {
            return AlertBannerResolved(phase: .alert, content: connectivity.content(canDismiss: canDismiss))
        }
        if let notice = input.notice {
            return AlertBannerResolved(phase: .alert, content: notice.content(canDismiss: canDismiss))
        }
        return AlertBannerResolved(phase: .empty, content: nil)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to an `AlertBannerSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the `connection`
/// axis, forwards the host dismiss handler (web `onClose`), and auto-refreshes once when the feed
/// transitions to stale. No networking lives here — the data is owned upstream.
@MainActor
@Observable
public final class AlertBannerModel {
    public private(set) var resolved: AlertBannerResolved = .init(phase: .loading, content: nil)
    public private(set) var connection: AlertBannerConnection = .live

    public var phase: AlertBannerResolved.Phase {
        resolved.phase
    }

    /// Whether the host supplied a dismiss handler (web optional `onClose`). Gates the trailing X.
    public let canDismiss: Bool

    @ObservationIgnored private let source: any AlertBannerSource
    @ObservationIgnored private let telemetry: any AlertBannerTelemetry
    @ObservationIgnored private let onDismiss: (@MainActor () -> Void)?
    @ObservationIgnored private var started = false

    public init(
        source: any AlertBannerSource,
        telemetry: any AlertBannerTelemetry = OSLogAlertBannerTelemetry(),
        onDismiss: (@MainActor () -> Void)? = nil
    ) {
        self.source = source
        self.telemetry = telemetry
        self.onDismiss = onDismiss
        canDismiss = onDismiss != nil
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AlertBanner.surfaceSlug)
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

    /// Invokes the host's dismiss handler (web `AlertBanner.onClose`) — a no-op when none supplied.
    public func dismiss() {
        onDismiss?()
    }

    private func apply(_ input: AlertBannerInput) {
        resolved = AlertBannerProjection.resolve(input: input, canDismiss: canDismiss)
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
/// hardcoded literals. Keys live in the "AlertBanner" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings. The connectivity copy reuses the web consumers' own keys
/// (`live.staleBanner.*`, `pwa.offline.*`) for catalog parity.
public enum AlertBannerStrings {
    public static let table = "AlertBanner"

    public static let string: AlertBannerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
