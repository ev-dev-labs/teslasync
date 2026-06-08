//
//  RateLimitStatusPanel.Model.swift
//  TeslaSync — P4 feature view · 0038 · RateLimitStatusPanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the Rate-limit budgets panel. The view binds through
//  `RateLimitModel`; no networking lives in the view. The web source owns its data
//  hook (`useRateLimitStatus`, a 30s pause-on-hidden poll), so the native source
//  carries the coalesced query snapshot (loading / fetching / error / response +
//  the freshness + connectivity flags the P4 states contract requires) rather than
//  the parent-prop snapshot a presentational leaf would.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there.
public protocol RateLimitTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogRateLimitTelemetry: RateLimitTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web `useRateLimitStatus` query state)

/// One coalesced snapshot of the query — the native mirror of the fields the web
/// component reads off the hook (`isLoading`, `isFetching`, `error`, `data`) plus
/// the `isStale` / `isOffline` freshness + connectivity flags the production
/// state-holder derives from the TanStack query meta + network reachability (the P4
/// stale / offline states). The view never touches HTTP — it reacts to this struct.
public struct RateLimitInput: Sendable, Equatable {
    public var isLoading: Bool
    public var isFetching: Bool
    public var errorMessage: String?
    public var response: RateLimitStatusResponse?
    public var isStale: Bool
    public var isOffline: Bool

    public init(
        isLoading: Bool = false,
        isFetching: Bool = false,
        errorMessage: String? = nil,
        response: RateLimitStatusResponse? = nil,
        isStale: Bool = false,
        isOffline: Bool = false
    ) {
        self.isLoading = isLoading
        self.isFetching = isFetching
        self.errorMessage = errorMessage
        self.response = response
        self.isStale = isStale
        self.isOffline = isOffline
    }
}

// MARK: - Resolved state (web render branches + P4 overlays)

/// The resolved, view-ready state — the native mirror of the web component's four
/// render branches plus the freshness / connectivity overlays the data + empty
/// branches carry (the stale chip + the offline chip).
public struct RateLimitResolved: Sendable, Equatable {
    /// The mutually-exclusive primary branches (web `isLoading` / `error` /
    /// `scopes.length === 0` / rows).
    public enum Phase: Sendable, Equatable {
        case loading
        case error(String)
        case empty
        case data
    }

    public let phase: Phase
    public let rows: [RateLimitRowProjection]
    public let generatedAt: Date?
    public let isFetching: Bool
    public let isStale: Bool
    public let isOffline: Bool

    public init(
        phase: Phase,
        rows: [RateLimitRowProjection],
        generatedAt: Date?,
        isFetching: Bool,
        isStale: Bool,
        isOffline: Bool
    ) {
        self.phase = phase
        self.rows = rows
        self.generatedAt = generatedAt
        self.isFetching = isFetching
        self.isStale = isStale
        self.isOffline = isOffline
    }
}

/// Pure projection from the query snapshot to the resolved view-state — the native
/// port of the web `isLoading ? … : error ? … : scopes.length === 0 ? … : rows`
/// ladder. `error` deliberately takes precedence over cached data (web shows the
/// error box, not the stale rows, on a refetch failure). The stale / offline flags
/// only annotate the data + empty branches — they are overlays, not phases. Unit
/// tested across every branch.
public enum RateLimitProjection {
    public static func resolve(_ input: RateLimitInput, now: Date) -> RateLimitResolved {
        let scopes = input.response?.scopes ?? []
        let rows = scopes.map { RateLimitRowProjection.make($0, now: now) }
        let generatedAt = input.response?.generatedAt
        // Stale / offline only make sense once there is content to annotate.
        let hasContent = input.response != nil
        let isStale = hasContent && input.isStale
        let isOffline = hasContent && input.isOffline

        let phase: RateLimitResolved.Phase = if input.isLoading {
            .loading
        } else if let message = input.errorMessage, !message.isEmpty {
            .error(message)
        } else if scopes.isEmpty {
            .empty
        } else {
            .data
        }

        return RateLimitResolved(
            phase: phase,
            rows: rows,
            generatedAt: generatedAt,
            isFetching: input.isFetching,
            isStale: isStale,
            isOffline: isOffline
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared state-holder / TanStack-parity query layer (the 30s pause-on-hidden poll);
/// previews and tests use `InMemoryRateLimitSource`. `refresh()` maps to the hook's
/// `refetch`. The view never talks to the network directly.
@MainActor
public protocol RateLimitSource: AnyObject {
    var onUpdate: (@MainActor (RateLimitInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to a `RateLimitSource`, recomputes
/// the resolved projection, and exposes a render `Phase` (plus the rows + freshness
/// flags) for SwiftUI to switch over.
@MainActor
@Observable
public final class RateLimitModel {
    public private(set) var phase: RateLimitResolved.Phase = .loading
    public private(set) var rows: [RateLimitRowProjection] = []
    public private(set) var generatedAt: Date?
    public private(set) var isFetching = false
    public private(set) var isStale = false
    public private(set) var isOffline = false

    @ObservationIgnored private let source: any RateLimitSource
    @ObservationIgnored private let telemetry: any RateLimitTelemetry
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private var started = false

    public init(
        source: any RateLimitSource,
        telemetry: any RateLimitTelemetry = OSLogRateLimitTelemetry(),
        clock: @escaping @Sendable () -> Date = Date.init
    ) {
        self.source = source
        self.telemetry = telemetry
        self.clock = clock
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RateLimitStatusPanel.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-fetches the budgets (wired to the Refresh button + the error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: RateLimitInput) {
        let resolved = RateLimitProjection.resolve(input, now: clock())
        phase = resolved.phase
        rows = resolved.rows
        generatedAt = resolved.generatedAt
        isFetching = resolved.isFetching
        isStale = resolved.isStale
        isOffline = resolved.isOffline
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryRateLimitSource: RateLimitSource {
    public var onUpdate: (@MainActor (RateLimitInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RateLimitInput?

    public init(initial: RateLimitInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: RateLimitInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "RateLimitStatusPanel" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum RLStrings {
    public static let table = "RateLimitStatusPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a key then fills `{{name}}` tokens, mirroring the web
    /// `t(key, default, { name: value })` i18next interpolation. An unmatched
    /// token is left verbatim, exactly like the web test's `t` shim.
    public static func format(_ key: String, _ fallback: String, _ args: [String: String]) -> String {
        var out = string(key, fallback)
        for (name, value) in args {
            out = out.replacingOccurrences(of: "{{\(name)}}", with: value)
        }
        return out
    }
}
