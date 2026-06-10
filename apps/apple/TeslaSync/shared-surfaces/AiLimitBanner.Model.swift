//
//  AiLimitBanner.Model.swift
//  TeslaSync — P4 shared surface · 0025 · AiLimitBanner (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  pure projection for the AI rate-limit / cost-cap banner. The view binds through
//  `AiLimitBannerModel`; no networking lives in the view. The web `AiLimitBanner` is a controlled
//  component — the parent supplies the `AiLimitInfo` (from `useAiStream`) and the handlers, and
//  the only internal state is the per-second `secondsLeft` countdown. The native model keeps the
//  same contract: a source emits the controlled `AiLimitInfo` snapshot plus the parent's
//  loading / error / connectivity state, the model derives the resolved banner over it, and drives
//  the countdown through the injectable `AiLimitTicker` clock (the native parity of the web
//  `setInterval`).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol AiLimitBannerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event.
public struct OSLogAiLimitBannerTelemetry: AiLimitBannerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound limit feed — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum AiLimitConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Capabilities (web optional `onRetry` / `onUseBaseline` / `onDismiss` props)

/// Which parent-supplied handlers exist — the native mirror of the web banner's optional
/// callbacks. A missing handler hides the matching affordance (web `onRetry && …`,
/// `onUseBaseline && …`, `onClose`), exactly as the controlled component does.
public struct AiLimitBannerCapabilities: Sendable, Equatable {
    public var canRetry: Bool
    public var canUseBaseline: Bool
    public var canDismiss: Bool

    public init(canRetry: Bool = false, canUseBaseline: Bool = false, canDismiss: Bool = false) {
        self.canRetry = canRetry
        self.canUseBaseline = canUseBaseline
        self.canDismiss = canDismiss
    }
}

// MARK: - Input snapshot (controlled `AiLimitInfo` + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the controlled `AiLimitInfo` (the web `info`
/// prop; `nil` when no limit is active) plus the parent's lifecycle (`isLoading`, an error
/// message, and connectivity). The `AiLimitInfo` value is reused module-wide (it is the native
/// parity of the web `useAiStream` `limit`), so the banner binds to the same shape every AI
/// surface produces.
public struct AiLimitBannerInput: Sendable, Equatable {
    public var info: AiLimitInfo?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: AiLimitConnection

    public init(
        info: AiLimitInfo? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: AiLimitConnection = .live
    ) {
        self.info = info
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The data payload for the `.data` phase — the fully-derived banner: the severity (web variant),
/// the reason taxonomy copy, the live countdown, and the three affordance-visibility flags. A pure
/// value so the view is a function of it and snapshot tests assert it directly.
public struct AiLimitBannerData: Sendable, Equatable {
    public let reason: String
    public let severity: AiLimitSeverity
    public let copy: AiLimitCopy
    public let secondsLeft: Int
    public let retryReady: Bool
    public let showBaseline: Bool
    public let showRetry: Bool
    public let showDismiss: Bool

    public init(
        reason: String,
        severity: AiLimitSeverity,
        copy: AiLimitCopy,
        secondsLeft: Int,
        retryReady: Bool,
        showBaseline: Bool,
        showRetry: Bool,
        showDismiss: Bool
    ) {
        self.reason = reason
        self.severity = severity
        self.copy = copy
        self.secondsLeft = secondsLeft
        self.retryReady = retryReady
        self.showBaseline = showBaseline
        self.showRetry = showRetry
        self.showDismiss = showDismiss
    }
}

/// The resolved, view-ready state — `phase` selects the body; for the data phase the derived
/// `data` payload is pre-computed so the view is a pure function of this value.
public struct AiLimitBannerResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let data: AiLimitBannerData?

    public init(phase: Phase, data: AiLimitBannerData?) {
        self.phase = phase
        self.data = data
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot (+ the live countdown + the parent capabilities) to the
/// resolved view-state — the native port of the web banner's render logic: the `info == null`
/// guard, the variant selection, the reason taxonomy, and the affordance gating
/// (`onUseBaseline && info.baselineAvailable`, `onRetry && retryReady`). Unit tested across
/// loading / empty / error / data and every gating combination.
public enum AiLimitBannerProjection {
    public static func resolve(
        input: AiLimitBannerInput,
        secondsLeft: Int,
        capabilities: AiLimitBannerCapabilities
    ) -> AiLimitBannerResolved {
        // P4 contract: a source query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return AiLimitBannerResolved(phase: .error(message), data: nil)
        }
        // Initial fetch (web parent `isLoading`).
        if input.isLoading {
            return AiLimitBannerResolved(phase: .loading, data: nil)
        }
        // No active limit (web `if (!info) return null`) → friendly empty state, never a blank box.
        guard let info = input.info else {
            return AiLimitBannerResolved(phase: .empty, data: nil)
        }
        let clamped = max(0, secondsLeft)
        let retryReady = AiLimitCountdown.isRetryReady(secondsLeft: clamped)
        let data = AiLimitBannerData(
            reason: info.reason,
            severity: AiLimitSeverity.forBannerLevel(info.bannerLevel),
            copy: AiLimitReasonCopy.copy(for: info.reason),
            secondsLeft: clamped,
            retryReady: retryReady,
            showBaseline: capabilities.canUseBaseline && info.baselineAvailable,
            showRetry: capabilities.canRetry && retryReady,
            showDismiss: capabilities.canDismiss
        )
        return AiLimitBannerResolved(phase: .data, data: data)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to an `AiLimitBannerSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the `connection`
/// axis, drives the per-second countdown through the injected `AiLimitTicker` (web `setInterval`
/// parity — reset whenever the controlled `AiLimitInfo` changes), forwards the parent handlers,
/// and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class AiLimitBannerModel {
    public private(set) var resolved: AiLimitBannerResolved = .init(phase: .loading, data: nil)
    public private(set) var connection: AiLimitConnection = .live

    public var phase: AiLimitBannerResolved.Phase {
        resolved.phase
    }

    /// The parent capabilities derived from which handlers were supplied (web optional props).
    public let capabilities: AiLimitBannerCapabilities

    @ObservationIgnored private let source: any AiLimitBannerSource
    @ObservationIgnored private let ticker: any AiLimitTicker
    @ObservationIgnored private let telemetry: any AiLimitBannerTelemetry
    @ObservationIgnored private let onRetry: (@MainActor () -> Void)?
    @ObservationIgnored private let onUseBaseline: (@MainActor () -> Void)?
    @ObservationIgnored private let onDismiss: (@MainActor () -> Void)?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var secondsLeft = 0
    @ObservationIgnored private var lastInfo: AiLimitInfo?
    @ObservationIgnored private var lastInput = AiLimitBannerInput()

    public init(
        source: any AiLimitBannerSource,
        ticker: any AiLimitTicker = TimerAiLimitTicker(),
        telemetry: any AiLimitBannerTelemetry = OSLogAiLimitBannerTelemetry(),
        onRetry: (@MainActor () -> Void)? = nil,
        onUseBaseline: (@MainActor () -> Void)? = nil,
        onDismiss: (@MainActor () -> Void)? = nil
    ) {
        self.source = source
        self.ticker = ticker
        self.telemetry = telemetry
        self.onRetry = onRetry
        self.onUseBaseline = onUseBaseline
        self.onDismiss = onDismiss
        capabilities = AiLimitBannerCapabilities(
            canRetry: onRetry != nil,
            canUseBaseline: onUseBaseline != nil,
            canDismiss: onDismiss != nil
        )
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AiLimitBanner.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed and halts the countdown.
    public func stop() {
        started = false
        ticker.stop()
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Invokes the parent's "Retry" handler — only when the countdown has elapsed (web gate:
    /// the Retry button is mounted only when `retryReady`).
    public func retry() {
        guard resolved.data?.retryReady == true else { return }
        onRetry?()
    }

    /// Invokes the parent's "Use baseline" handler (web `onUseBaseline`).
    public func useBaseline() {
        onUseBaseline?()
    }

    /// Invokes the parent's dismiss handler (web `AlertBanner.onClose`).
    public func dismiss() {
        onDismiss?()
    }

    private func apply(_ input: AiLimitBannerInput) {
        let infoChanged = input.info != lastInfo
        lastInfo = input.info
        // Web effect deps are `[info]`: the countdown resets only when the controlled limit value
        // changes — a connection-only update must not restart a running timer.
        if infoChanged {
            secondsLeft = AiLimitCountdown.initial(retryAfterS: input.info?.retryAfterS ?? 0)
        }
        recompute(input)
        let previous = connection
        connection = input.connection
        if infoChanged {
            restartTicker(for: input.info)
        }
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func recompute(_ input: AiLimitBannerInput) {
        lastInput = input
        resolved = AiLimitBannerProjection.resolve(
            input: input,
            secondsLeft: secondsLeft,
            capabilities: capabilities
        )
    }

    private func restartTicker(for info: AiLimitInfo?) {
        ticker.stop()
        guard let info, info.retryAfterS > 0, secondsLeft > 0 else { return }
        ticker.start(interval: 1) { [weak self] in self?.tick() }
    }

    private func tick() {
        secondsLeft = AiLimitCountdown.tick(secondsLeft)
        if secondsLeft <= 0 {
            ticker.stop()
        }
        recompute(lastInput)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "AiLimitBanner" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum AiLimitBannerStrings {
    public static let table = "AiLimitBanner"

    public static let string: AiLimitBannerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
