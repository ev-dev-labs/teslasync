//
//  RateLimitBanner.Model.swift
//  TeslaSync — P4 shared surface · 0134 · RateLimitBanner (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  pure projection for the rate-limit / upstream-breaker banner. The view binds through
//  `RateLimitBannerModel`; no networking lives in the view. The web `RateLimitBanner` owns its own
//  visibility (`useState`) and a per-second countdown, fed by two document CustomEvents and clearing
//  itself on retry/dismiss. The native model keeps the same contract: a source emits the coalesced
//  inputs (the fired event + the parent lifecycle / connectivity), the model derives the resolved
//  banner over it, drives the countdown through the injectable `RateLimitBannerTicker` clock (the
//  native parity of the web `setInterval`), and on "Retry now" invalidates the shared query cache
//  through the `RateLimitBannerQueryInvalidating` seam (the native parity of `useQueryClient`).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol RateLimitBannerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogRateLimitBannerTelemetry: RateLimitBannerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound event feed — the orthogonal connectivity axis rendered as the freshness
/// chip. `live` hides the chip; `stale` / `offline` show it.
public enum RateLimitBannerConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Event (web `State` — the fired rate-limit / upstream detail)

/// One fired rate-limit / upstream-breaker event — the native mirror of the web `State` set by the
/// document CustomEvent handlers. `scope` carries the path scope of a 429 (web `detail.scope`),
/// `upstream` the upstream name of a 503 (web `detail.upstream`); both are retained for fidelity even
/// though the banner copy (web parity) interpolates only the countdown. `retryAfterS` is the
/// Retry-After window (web `detail.retryAfterSec`).
public struct RateLimitBannerEvent: Sendable, Equatable {
    public let kind: RateLimitBannerKind
    public let scope: String?
    public let upstream: String?
    public let retryAfterS: Int

    public init(kind: RateLimitBannerKind, scope: String? = nil, upstream: String? = nil, retryAfterS: Int) {
        self.kind = kind
        self.scope = scope
        self.upstream = upstream
        self.retryAfterS = retryAfterS
    }

    /// A 429 rate-limit event for a path scope (web `teslasync:rate-limited`).
    public static func rateLimited(scope: String?, retryAfterS: Int) -> RateLimitBannerEvent {
        RateLimitBannerEvent(kind: .rateLimited, scope: scope, retryAfterS: retryAfterS)
    }

    /// A 503 breaker-open event for an upstream (web `teslasync:upstream-down`).
    public static func upstreamDown(upstream: String?, retryAfterS: Int) -> RateLimitBannerEvent {
        RateLimitBannerEvent(kind: .upstreamDown, upstream: upstream, retryAfterS: retryAfterS)
    }
}

// MARK: - Input snapshot (fired event + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the currently-visible event (the web `state`;
/// `nil` when no banner is showing), a monotonic `sequence` that bumps on every fresh emission (so an
/// identical re-fire still restarts the countdown, matching the web `setState` re-render), plus the
/// parent's lifecycle (`isLoading`, an error message, and connectivity) for the P4 leaf contract.
public struct RateLimitBannerInput: Sendable, Equatable {
    public var event: RateLimitBannerEvent?
    public var sequence: Int
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: RateLimitBannerConnection

    public init(
        event: RateLimitBannerEvent? = nil,
        sequence: Int = 0,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: RateLimitBannerConnection = .live
    ) {
        self.event = event
        self.sequence = sequence
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The data payload for the `.data` phase — the fully-derived banner: the kind (web `state.kind`),
/// the retained scope / upstream detail, the live countdown, and whether "Retry now" is enabled (web
/// `!disabled` ⇔ `remaining == 0`). A pure value so the view is a function of it and snapshot tests
/// assert it directly.
public struct RateLimitBannerData: Sendable, Equatable {
    public let kind: RateLimitBannerKind
    public let scope: String?
    public let upstream: String?
    public let secondsLeft: Int
    public let retryEnabled: Bool

    public init(
        kind: RateLimitBannerKind,
        scope: String?,
        upstream: String?,
        secondsLeft: Int,
        retryEnabled: Bool
    ) {
        self.kind = kind
        self.scope = scope
        self.upstream = upstream
        self.secondsLeft = secondsLeft
        self.retryEnabled = retryEnabled
    }
}

/// The resolved, view-ready state — `phase` selects the body; for the data phase the derived `data`
/// payload is pre-computed so the view is a pure function of this value.
public struct RateLimitBannerResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let data: RateLimitBannerData?

    public init(phase: Phase, data: RateLimitBannerData?) {
        self.phase = phase
        self.data = data
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot (+ the live countdown) to the resolved view-state — the
/// native port of the web banner's render logic in order: a feed failure surfaces at the leaf as
/// `error`; an in-flight fetch as `loading`; no fired event (web `if (!state) return null`) as the
/// friendly `empty` state (never a blank box); otherwise the active banner with the derived countdown
/// + retry-enabled gate. Unit tested across every branch.
public enum RateLimitBannerProjection {
    public static func resolve(input: RateLimitBannerInput, secondsLeft: Int) -> RateLimitBannerResolved {
        // P4 contract: a source query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return RateLimitBannerResolved(phase: .error(message), data: nil)
        }
        // Initial fetch (web parent `isLoading`).
        if input.isLoading {
            return RateLimitBannerResolved(phase: .loading, data: nil)
        }
        // No fired event (web `if (!state) return null`) → friendly empty state, never a blank box.
        guard let event = input.event else {
            return RateLimitBannerResolved(phase: .empty, data: nil)
        }
        let clamped = max(0, secondsLeft)
        let data = RateLimitBannerData(
            kind: event.kind,
            scope: event.scope,
            upstream: event.upstream,
            secondsLeft: clamped,
            retryEnabled: RateLimitBannerCountdown.isRetryEnabled(secondsLeft: clamped)
        )
        return RateLimitBannerResolved(phase: .data, data: data)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `RateLimitBannerSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the `connection` axis,
/// drives the per-second countdown through the injected `RateLimitBannerTicker` (web `setInterval`
/// parity — reset whenever a fresh event is emitted, preserved on a connection-only update), clears
/// itself on dismiss (web `setState(null)`), invalidates the shared query cache on an enabled retry
/// (web `qc.invalidateQueries()`), and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class RateLimitBannerModel {
    public private(set) var resolved: RateLimitBannerResolved = .init(phase: .empty, data: nil)
    public private(set) var connection: RateLimitBannerConnection = .live

    public var phase: RateLimitBannerResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any RateLimitBannerSource
    @ObservationIgnored private let ticker: any RateLimitBannerTicker
    @ObservationIgnored private let telemetry: any RateLimitBannerTelemetry
    @ObservationIgnored private let queryInvalidator: any RateLimitBannerQueryInvalidating
    @ObservationIgnored private var started = false
    @ObservationIgnored private var secondsLeft = 0
    @ObservationIgnored private var lastSequence: Int?
    @ObservationIgnored private var lastInput = RateLimitBannerInput()

    public init(
        source: any RateLimitBannerSource,
        ticker: any RateLimitBannerTicker = TimerRateLimitBannerTicker(),
        telemetry: any RateLimitBannerTelemetry = OSLogRateLimitBannerTelemetry(),
        queryInvalidator: any RateLimitBannerQueryInvalidating = OSLogRateLimitBannerQueryInvalidating()
    ) {
        self.source = source
        self.ticker = ticker
        self.telemetry = telemetry
        self.queryInvalidator = queryInvalidator
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RateLimitBanner.surfaceSlug)
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

    /// "Retry now" — only once the countdown has elapsed (web gate: the button is disabled while
    /// `remaining > 0`). Invalidates every shared query (web `qc.invalidateQueries()`) and clears the
    /// banner (web `setState(null)`).
    public func retry() {
        guard resolved.data?.retryEnabled == true else { return }
        queryInvalidator.invalidateAll()
        source.dismiss()
    }

    /// Dismisses the banner (web `handleDismiss` → `setState(null)`) without invalidating queries.
    public func dismiss() {
        source.dismiss()
    }

    private func apply(_ input: RateLimitBannerInput) {
        let sequenceChanged = input.sequence != lastSequence
        lastSequence = input.sequence
        // A fresh emission (web `setState` re-render) restarts the countdown; a connection-only update
        // (same sequence) must not restart a running timer.
        if sequenceChanged {
            secondsLeft = RateLimitBannerCountdown.initial(retryAfterS: input.event?.retryAfterS ?? 0)
        }
        recompute(input)
        let previous = connection
        connection = input.connection
        if sequenceChanged {
            restartTicker(for: input.event)
        }
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func recompute(_ input: RateLimitBannerInput) {
        lastInput = input
        resolved = RateLimitBannerProjection.resolve(input: input, secondsLeft: secondsLeft)
    }

    private func restartTicker(for event: RateLimitBannerEvent?) {
        ticker.stop()
        guard let event, event.retryAfterS > 0, secondsLeft > 0 else { return }
        ticker.start(interval: 1) { [weak self] in self?.tick() }
    }

    private func tick() {
        secondsLeft = RateLimitBannerCountdown.tick(secondsLeft)
        if secondsLeft <= 0 {
            ticker.stop()
        }
        recompute(lastInput)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "RateLimitBanner" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum RateLimitBannerStrings {
    public static let table = "RateLimitBanner"

    public static let string: RateLimitBannerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
