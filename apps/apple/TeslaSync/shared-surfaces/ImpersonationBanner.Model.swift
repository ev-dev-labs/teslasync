//
//  ImpersonationBanner.Model.swift
//  TeslaSync — P4 shared surface · 0123 · ImpersonationBanner (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  pure projection for the admin impersonation banner. The view binds through
//  `ImpersonationBannerModel`; no transport or persistence lives in the view. The web component reads
//  `useImpersonationStatus()` (a 30s-polled query), keeps a once-a-second `now` ticker while the
//  session is active so the countdown updates, and fires `useEndImpersonation()` on the button. The
//  native model keeps the same contract: a source emits the coalesced status snapshot (plus the
//  parent's loading / error / ending / connectivity state), the model derives the resolved banner
//  over it, owns the countdown clock (armed only while a session is active with a parseable expiry,
//  exactly as the web ticks only when `data.mode === 'active' && expiresMs !== null`), and
//  `endImpersonation()` runs through the source.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ImpersonationBannerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogImpersonationBannerTelemetry: ImpersonationBannerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound status snapshot — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip (the poll result is current); `stale` shows it and triggers
/// a one-shot auto-refresh; `offline` keeps the last cached status on screen behind an offline chip.
public enum ImpersonationBannerConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Empty kind (web open-mode / inactive — both render nothing)

/// Why the surface is in its empty (non-active) state — the native split of the two web branches that
/// both render nothing. `inactive` is forward-auth with no active cookie (web `{ mode: 'inactive' }`);
/// `unavailable` is the open-mode install (web `{ mode: 'open' }`). The P4 leaf contract renders a
/// calm card for each instead of collapsing to a blank box, with honest copy per kind.
public enum ImpersonationBannerEmptyKind: String, Sendable, Equatable, CaseIterable {
    case inactive
    case unavailable
}

// MARK: - Input snapshot (status + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the resolved impersonation status (web
/// `useImpersonationStatus().data`), the first-load flag (web query `isLoading`), an error message
/// (web `isError`), the end-mutation pending flag (web `endMut.isPending`), and the connectivity
/// freshness. `isLoading` is first-load-only so a background poll never flashes the skeleton over a
/// live banner, mirroring TanStack keeping previous data across refetches.
public struct ImpersonationBannerInput: Sendable, Equatable {
    public var status: ImpersonationBannerStatus
    public var isLoading: Bool
    public var errorMessage: String?
    public var isEnding: Bool
    public var connection: ImpersonationBannerConnection

    public init(
        status: ImpersonationBannerStatus = .inactive,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        isEnding: Bool = false,
        connection: ImpersonationBannerConnection = .live
    ) {
        self.status = status
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.isEnding = isEnding
        self.connection = connection
    }
}

// MARK: - Active data (web active render payload)

/// The data payload for the `.data` phase — the active-warning render: the impersonated subject, the
/// admin behind the session, the expiry the countdown ticks against, and whether the end mutation is
/// in flight (web `endMut.isPending`, which swaps the button to "Ending…" + disables it). A pure
/// value so the view is a function of it.
public struct ImpersonationBannerActiveData: Sendable, Equatable {
    public let target: String
    public let originalAdmin: String
    public let expiresAt: Date?
    public let isEnding: Bool

    public init(target: String, originalAdmin: String, expiresAt: Date?, isEnding: Bool) {
        self.target = target
        self.originalAdmin = originalAdmin
        self.expiresAt = expiresAt
        self.isEnding = isEnding
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body; `.data` carries the active payload and
/// `.empty` carries the empty kind, so the view is a pure function of this value.
public struct ImpersonationBannerResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let data: ImpersonationBannerActiveData?
    public let emptyKind: ImpersonationBannerEmptyKind?

    public init(phase: Phase, data: ImpersonationBannerActiveData?, emptyKind: ImpersonationBannerEmptyKind?) {
        self.phase = phase
        self.data = data
        self.emptyKind = emptyKind
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// banner's render logic: an error surfaces first (P4 leaf), then the first-load skeleton, then the
/// `isImpersonationActive(data)` guard (active → the warning) with the two non-active modes split
/// into the calm empty kinds the web rendered as `null`. Unit tested across every branch.
public enum ImpersonationBannerProjection {
    public static func resolve(input: ImpersonationBannerInput) -> ImpersonationBannerResolved {
        if let message = input.errorMessage, !message.isEmpty {
            return ImpersonationBannerResolved(phase: .error(message), data: nil, emptyKind: nil)
        }
        if input.isLoading {
            return ImpersonationBannerResolved(phase: .loading, data: nil, emptyKind: nil)
        }
        switch input.status {
        case let .active(subject):
            return ImpersonationBannerResolved(
                phase: .data,
                data: ImpersonationBannerActiveData(
                    target: subject.target,
                    originalAdmin: subject.originalAdmin,
                    expiresAt: subject.expiresAt,
                    isEnding: input.isEnding
                ),
                emptyKind: nil
            )
        case .inactive:
            return ImpersonationBannerResolved(phase: .empty, data: nil, emptyKind: .inactive)
        case .unavailable:
            return ImpersonationBannerResolved(phase: .empty, data: nil, emptyKind: .unavailable)
        }
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to an `ImpersonationBannerSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state + the `connection` axis,
/// emits the `view.opened` diagnostics event once, owns the once-a-second countdown clock (armed only
/// while a session is active with a parseable expiry), auto-refreshes a single time when the feed
/// transitions to stale, and runs the end mutation through the source.
@MainActor
@Observable
public final class ImpersonationBannerModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the canonical source of truth, re-exposed by
    /// the `ImpersonationBanner` view so the pure core stays self-contained.
    public static let surfaceSlug = "ImpersonationBanner"

    public private(set) var resolved: ImpersonationBannerResolved = .init(
        phase: .loading,
        data: nil,
        emptyKind: nil
    )
    public private(set) var connection: ImpersonationBannerConnection = .live
    /// The clock the countdown reads — advanced once a second by the ticker (web `now` state).
    public private(set) var currentTime: Date

    public var phase: ImpersonationBannerResolved.Phase {
        resolved.phase
    }

    /// Whether the countdown ticker should run — an active session with a parseable expiry (web
    /// `data.mode === 'active' && expiresMs !== null`).
    public var countdownActive: Bool {
        guard case .data = resolved.phase else { return false }
        return resolved.data?.expiresAt != nil
    }

    @ObservationIgnored private let source: any ImpersonationBannerSource
    @ObservationIgnored private let telemetry: any ImpersonationBannerTelemetry
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var ticker: Task<Void, Never>?

    public init(
        source: any ImpersonationBannerSource,
        telemetry: any ImpersonationBannerTelemetry = OSLogImpersonationBannerTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.now = now
        currentTime = now()
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing (the initial status load) and emits the `view.opened` event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: Self.surfaceSlug)
        source.start()
        syncTicker()
    }

    /// Stops observing the upstream feed and disarms the countdown clock.
    public func stop() {
        started = false
        source.stop()
        disarmTicker()
    }

    /// Re-requests the upstream status — a re-poll (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Runs the end mutation through the source (web `endMut.mutate()`); the source re-emits the
    /// pending state and the resulting inactive status.
    public func endImpersonation() {
        source.endImpersonation()
    }

    /// The localized countdown line for the active session, read against the ticking clock — the
    /// native parity of the web countdown text. `nil` when not active or the expiry is unparseable.
    public func countdownText(using resolve: ImpersonationBannerResolve) -> String? {
        guard let data = resolved.data else { return nil }
        return ImpersonationBannerCountdown.text(
            expiresAt: data.expiresAt,
            now: currentTime,
            endsInTemplate: resolve(ImpersonationBannerCopy.endsInKey, ImpersonationBannerCopy.endsInFallback),
            expiredText: resolve(ImpersonationBannerCopy.expiredKey, ImpersonationBannerCopy.expiredFallback)
        )
    }

    /// Advances the countdown clock to the current instant. Invoked by the ticker once a second, and
    /// by tests after moving the injected clock.
    public func tickClock() {
        currentTime = now()
    }

    private func apply(_ input: ImpersonationBannerInput) {
        resolved = ImpersonationBannerProjection.resolve(input: input)
        let previous = connection
        connection = input.connection
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
        syncTicker()
    }

    private func syncTicker() {
        guard started, countdownActive else {
            disarmTicker()
            return
        }
        guard ticker == nil else { return }
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard let self, !Task.isCancelled else { break }
                tickClock()
            }
        }
    }

    private func disarmTicker() {
        ticker?.cancel()
        ticker = nil
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "ImpersonationBanner" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum ImpersonationBannerStrings {
    public static let table = "ImpersonationBanner"

    public static let string: ImpersonationBannerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
