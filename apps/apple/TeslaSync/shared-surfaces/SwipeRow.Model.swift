//
//  SwipeRow.Model.swift
//  TeslaSync — P4 shared surface · 0189 · SwipeRow (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  pure projection for the SwipeRow shared surface. The view binds through `SwipeRowModel`; no
//  networking lives in the view. A source emits the coalesced inputs (whether swipe is enabled — the
//  web `useIsCoarsePointer` capability — plus whether the wrapped row has content, the live-connection
//  freshness, and the parent's loading / error state); the model derives the render `phase` over them,
//  exposes the `connection` axis + the coarse-pointer capability, emits the surface's `view.opened`,
//  and auto-refreshes once when the feed transitions to stale.
//
//  Parity note: the web SwipeRow owns no data — its only data sources are `useIsCoarsePointer` and
//  `useMotionPreference`. The motion preference binds at the view boundary
//  (`@Environment(\.accessibilityReduceMotion)`); the coarse-pointer capability is supplied through
//  this state-holder so the view never probes the platform directly.
//

import Foundation
import Observation
import OSLog

// MARK: - Diagnostics metadata (P1/S11)

/// Static, non-identifying metadata for the surface. The slug is the `view.opened` event name.
public enum SwipeRowMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SwipeRow"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol SwipeRowTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default recording the surface open as a redaction-safe `view.opened` event.
public struct OSLogSwipeRowTelemetry: SwipeRowTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's chrome strings by key with an English fallback, so the views, the
/// projection, and the accessibility helpers hold no hardcoded user-facing literals. Keys live in the
/// "SwipeRow" table, folded into the app `Localizable.xcstrings` catalog at integration time; kept
/// per-surface so each parallel prompt owns its own strings.
public enum SwipeRowStrings {
    public static let table = "SwipeRow"

    public static let string: SwipeRowResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound feed — the orthogonal connectivity axis rendered as the freshness chip.
/// `live` hides the chip; `stale` / `offline` show it while the last row stays visible + swipeable.
public enum SwipeRowConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web capability + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — whether swipe is enabled (the web
/// `enabled ?? useIsCoarsePointer()` capability; `false` makes the row a pass-through), whether the
/// wrapped row has content to show (`false` selects the friendly empty leaf), the live-connection
/// freshness, plus the parent's `isLoading` / `errorMessage`. The render is derived purely from this
/// value, so it is `Sendable` & `Equatable` and the projection is a pure function of it.
public struct SwipeRowInput: Sendable, Equatable {
    /// The resolved swipe-enabled capability — the web `enabled ?? useIsCoarsePointer()`. Defaults to
    /// the coarse-pointer probe in the live source; a host `enabled` override seeds it directly.
    public var isCoarsePointer: Bool
    public var hasContent: Bool
    public var connection: SwipeRowConnection
    public var isLoading: Bool
    public var errorMessage: String?

    public init(
        isCoarsePointer: Bool = true,
        hasContent: Bool = true,
        connection: SwipeRowConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) {
        self.isCoarsePointer = isCoarsePointer
        self.hasContent = hasContent
        self.connection = connection
        self.isLoading = isLoading
        self.errorMessage = errorMessage
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state. `phase` selects the body region; `isCoarsePointer` + `connection`
/// are carried so the view can decide whether to attach the swipe gesture (the web `active` guard
/// combines this capability with whether any action is wired) and whether to show the freshness chip.
public struct SwipeRowResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// The wrapped row is still loading → a skeleton row.
        case loading
        /// Nothing to show (no row) → a friendly empty state, never a blank box.
        case empty
        /// Feed failure → an error row with a retry affordance (web `QueryError` peer).
        case error(String)
        /// The web happy path — render the wrapped row, swipe-enabled when active.
        case content
    }

    public let phase: Phase
    /// The resolved swipe-enabled capability (web `useIsCoarsePointer`); the view ANDs it with whether
    /// any action is wired to decide whether the row is interactive vs a straight pass-through.
    public let isCoarsePointer: Bool
    public let connection: SwipeRowConnection

    public var isContent: Bool {
        phase == .content
    }

    public init(phase: Phase, isCoarsePointer: Bool, connection: SwipeRowConnection) {
        self.phase = phase
        self.isCoarsePointer = isCoarsePointer
        self.connection = connection
    }

    /// A neutral chrome state used before any host snapshot arrives (loading, coarse-capable, live).
    static func chrome(phase: Phase) -> SwipeRowResolved {
        SwipeRowResolved(phase: phase, isCoarsePointer: true, connection: .live)
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state. The leaf-contract precedence
/// mirrors the documented peers: error > loading > empty(no row) > content. Unit tested across every
/// branch and the carried capability / connection.
public enum SwipeRowProjection {
    public static func resolve(_ input: SwipeRowInput) -> SwipeRowResolved {
        SwipeRowResolved(
            phase: phase(for: input),
            isCoarsePointer: input.isCoarsePointer,
            connection: input.connection
        )
    }

    static func phase(for input: SwipeRowInput) -> SwipeRowResolved.Phase {
        if let message = input.errorMessage, !message.isEmpty {
            return .error(message)
        }
        if input.isLoading {
            return .loading
        }
        if !input.hasContent {
            return .empty
        }
        return .content
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's `@Observable` view-model. Subscribes to a `SwipeRowSource`, recomputes the resolved
/// projection, exposes the render `phase` + the coarse-pointer capability + the `connection` axis,
/// emits `view.opened` exactly once on first appear (P1/S11), and auto-refreshes once on the stale
/// transition. No networking lives here — the data is owned upstream, exactly like the web source.
@MainActor
@Observable
public final class SwipeRowModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SwipeRowMeta.surfaceSlug

    public private(set) var resolved: SwipeRowResolved = .chrome(phase: .loading)
    public private(set) var connection: SwipeRowConnection = .live

    public var phase: SwipeRowResolved.Phase {
        resolved.phase
    }

    /// The resolved swipe-enabled capability (web `useIsCoarsePointer`). The view ANDs this with
    /// whether any action is wired to decide whether to attach the swipe gesture.
    public var isCoarsePointer: Bool {
        resolved.isCoarsePointer
    }

    @ObservationIgnored private let source: any SwipeRowSource
    @ObservationIgnored private let telemetry: any SwipeRowTelemetry

    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SwipeRowSource,
        telemetry: any SwipeRowTelemetry = OSLogSwipeRowTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    // MARK: Lifecycle

    /// Begins observing and emits `view.opened` once (P1/S11). Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: Self.surfaceSlug)
        }
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

    private func apply(_ input: SwipeRowInput) {
        resolved = SwipeRowProjection.resolve(input)
        handleAutoRefresh(for: input.connection)
        connection = input.connection
    }

    /// Stale → one guarded refresh on the transition; reset once live so a later stale episode
    /// re-triggers exactly once. Offline never auto-refreshes (the cached row stays shown).
    private func handleAutoRefresh(for connection: SwipeRowConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
