//
//  InstallPrompt.Model.swift
//  TeslaSync — P4 shared surface · 0125 · InstallPrompt (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the install prompt. The view binds through `InstallPromptModel`; no detection,
//  persistence, or broadcast lives in the view. The web component probes installability on mount
//  (`beforeinstallprompt`), reads/writes a sticky 14-day localStorage dismissal, and broadcasts the
//  dismissal across tabs; the native model keeps the same contract: a source emits the probed install
//  availability + the persisted dismissal (plus the parent's loading / error / connectivity state),
//  the model derives the resolved prompt over it, runs the embedder's install handler (web
//  `handleInstall`), persists dismissal through the source (web `handleDismiss`), and auto-refreshes
//  once when the feed goes stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol InstallPromptTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogInstallPromptTelemetry: InstallPromptTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound availability snapshot — the orthogonal connectivity axis rendered as
/// the freshness chip. `live` hides the chip; `stale` shows it and triggers a one-shot auto-refresh
/// (re-probe); `offline` keeps the last cached probe result on screen.
public enum InstallPromptConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (probed availability + persisted dismissal + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the probed install signals (web
/// `beforeinstallprompt` captured → `canInstall`; web `isStandaloneMode()` → `isInstalled`), the
/// already-evaluated 14-day dismissal flag (web `wasDismissedRecently()`), and the parent's lifecycle
/// (`isLoading`, an error message, connectivity). The source evaluates the dismissal window via
/// `InstallPromptDismissal` so the projection stays a simple, pure branch.
public struct InstallPromptInput: Sendable, Equatable {
    public var canInstall: Bool
    public var isInstalled: Bool
    public var dismissed: Bool
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: InstallPromptConnection

    public init(
        canInstall: Bool = false,
        isInstalled: Bool = false,
        dismissed: Bool = false,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: InstallPromptConnection = .live
    ) {
        self.canInstall = canInstall
        self.isInstalled = isInstalled
        self.dismissed = dismissed
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Empty kind (web `if (isStandaloneMode() || wasDismissedRecently()) return` / no prompt)

/// Why the surface is in its empty (non-prompt) state — the native split of the web branches that all
/// render nothing. `installed` is "already running installed" (web `isStandaloneMode()`); `dismissed`
/// is "dismissed within the 14-day window" (web `wasDismissedRecently()`); `unavailable` is "no
/// install affordance was offered" (web: no `beforeinstallprompt` captured). The P4 leaf contract
/// renders a calm, honest card for each instead of collapsing to a blank box.
public enum InstallPromptEmptyKind: String, Sendable, Equatable, CaseIterable {
    case installed
    case dismissed
    case unavailable
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body; the `.empty` phase carries the empty
/// kind so the calm card stays honest. A pure value so the view is a function of it and projection
/// tests assert it directly.
public struct InstallPromptResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let emptyKind: InstallPromptEmptyKind?

    public init(phase: Phase, emptyKind: InstallPromptEmptyKind?) {
        self.phase = phase
        self.emptyKind = emptyKind
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// prompt's control flow plus the P4 leaf contract. The precedence mirrors the web source: a probe
/// failure surfaces as `error`; the initial probe is `loading`; the standalone check comes first (web
/// `isStandaloneMode()`), then the sticky dismissal (web `wasDismissedRecently()`), then the absence
/// of a captured install affordance (web no `beforeinstallprompt`) — all three are calm empty kinds;
/// otherwise the install prompt is shown (web `visible`). Unit tested across every branch.
public enum InstallPromptProjection {
    public static func resolve(input: InstallPromptInput) -> InstallPromptResolved {
        if let message = input.errorMessage, !message.isEmpty {
            return InstallPromptResolved(phase: .error(message), emptyKind: nil)
        }
        if input.isLoading {
            return InstallPromptResolved(phase: .loading, emptyKind: nil)
        }
        // Web `isStandaloneMode()` → already installed; nothing to offer.
        if input.isInstalled {
            return InstallPromptResolved(phase: .empty, emptyKind: .installed)
        }
        // Web `wasDismissedRecently()` → suppressed for the 14-day window.
        if input.dismissed {
            return InstallPromptResolved(phase: .empty, emptyKind: .dismissed)
        }
        // Web: no `beforeinstallprompt` captured → no install affordance to surface.
        if !input.canInstall {
            return InstallPromptResolved(phase: .empty, emptyKind: .unavailable)
        }
        // Installable, not installed, not dismissed → the visible install prompt.
        return InstallPromptResolved(phase: .data, emptyKind: nil)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to an `InstallPromptSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the `connection` axis,
/// emits the `view.opened` diagnostics event once, runs the embedder's install handler (web
/// `handleInstall`), persists dismissal through the source (web `handleDismiss`), and auto-refreshes a
/// single time when the feed transitions to stale.
@MainActor
@Observable
public final class InstallPromptModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the canonical source of truth, re-exposed by
    /// the `InstallPrompt` view so the pure core stays self-contained.
    public static let surfaceSlug = "InstallPrompt"

    public private(set) var resolved = InstallPromptResolved(phase: .loading, emptyKind: nil)
    public private(set) var connection: InstallPromptConnection = .live

    public var phase: InstallPromptResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any InstallPromptSource
    @ObservationIgnored private let telemetry: any InstallPromptTelemetry
    @ObservationIgnored private let onInstall: (@MainActor () -> Bool)?
    @ObservationIgnored private var started = false

    /// - Parameter onInstall: the embedder's real install action — the native parity of the web
    ///   `deferredPrompt.prompt()` + reading `userChoice.outcome`. Returns `true` when the user
    ///   accepted (web `outcome === 'accepted'`), so the model can mark the app installed and hide the
    ///   prompt. The composition root wires this to the platform flow (add the widget / pin the app);
    ///   when `nil` the install affordance is a no-op and the prompt stays, exactly as the web prompt
    ///   does nothing without a captured `deferredPrompt`.
    public init(
        source: any InstallPromptSource,
        telemetry: any InstallPromptTelemetry = OSLogInstallPromptTelemetry(),
        onInstall: (@MainActor () -> Bool)? = nil
    ) {
        self.source = source
        self.telemetry = telemetry
        self.onInstall = onInstall
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing (which runs the install-availability probe + the dismissal read + the
    /// cross-scene subscription) and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: Self.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed (and its cross-scene subscription).
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot — a re-probe (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Runs the embedder's install action and, when the user accepts, marks the app installed through
    /// the source so the prompt resolves to the `.installed` empty card — the native parity of the web
    /// `handleInstall` (`prompt()` → on `accepted`, `setVisible(false)`). A declined / unavailable
    /// action leaves the prompt in place.
    public func install() {
        guard let onInstall else { return }
        if onInstall() {
            source.markInstalled()
        }
    }

    /// Persists the dismissal (14-day window) and broadcasts it cross-scene through the source — the
    /// native parity of the web `handleDismiss` (`localStorage.setItem(DISMISS_KEY, now)` +
    /// `broadcast({ type: 'install.dismissed' })`).
    public func dismiss() {
        source.dismiss()
    }

    private func apply(_ input: InstallPromptInput) {
        resolved = InstallPromptProjection.resolve(input: input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (re-probe).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "InstallPrompt" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum InstallPromptStrings {
    public static let table = "InstallPrompt"

    public static let string: InstallPromptResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
