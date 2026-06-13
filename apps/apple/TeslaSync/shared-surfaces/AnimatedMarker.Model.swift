//
//  AnimatedMarker.Model.swift
//  TeslaSync — P4 shared surface · 0184 · AnimatedMarker (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the live-position marker surface. The view binds through
//  `AnimatedMarkerModel`; no networking lives in the view. It keeps the web data contract (the
//  consumers' position query feeding `<AnimatedMarker position heading color />` over `useMap`): a
//  source pushes the coalesced position row + load phase + connectivity, the model adapts it through
//  `AnimatedMarkerAdapter`, retains the last-known fix across an offline snapshot (web cache-then-
//  network), emits `view.opened` once, and auto-refreshes once on the stale edge.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; production injects an adapter that forwards to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol AnimatedMarkerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogAnimatedMarkerTelemetry: AnimatedMarkerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Marker snapshot (web consumer query slice + the P4 connectivity axis)

/// One coalesced snapshot of the surface's data inputs — the native mirror of the web consumers'
/// position-query result (the row + its status) plus the P4 connectivity axis. The model adapts it on
/// apply. A nil `row` carries no fresh position (the model keeps the last-known fix — web cache-then-
/// network behaviour on an offline / pending refetch).
public struct AnimatedMarkerInput: Sendable, Equatable {
    public var connection: AnimatedMarkerConnection
    public var phase: AnimatedMarkerLoadPhase
    public var row: AnimatedMarkerFixRow?

    public init(
        connection: AnimatedMarkerConnection = .live,
        phase: AnimatedMarkerLoadPhase = .loaded,
        row: AnimatedMarkerFixRow? = nil
    ) {
        self.connection = connection
        self.phase = phase
        self.row = row
    }
}

// MARK: - Source seam (P1/S8 layer)

/// The seam the model binds through for the position data + its refetch + the P4 connectivity axis
/// (web consumers' `useQuery` / `refetch`). Production implements this over the API hook
/// (`LiveAnimatedMarkerSource`); previews + tests use `InMemoryAnimatedMarkerSource`. The surface owns
/// no networking — it forwards to the source.
@MainActor
public protocol AnimatedMarkerSource: AnyObject {
    var onUpdate: (@MainActor (AnimatedMarkerInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production source. Holds the host-provided snapshot + a refetch closure (web `refetch`),
/// re-emitting the snapshot on `start` / `refresh`. The host re-creates the source (or pushes through
/// its own hook) as the query result changes.
@MainActor
public final class LiveAnimatedMarkerSource: AnimatedMarkerSource {
    public var onUpdate: (@MainActor (AnimatedMarkerInput) -> Void)?

    private let input: AnimatedMarkerInput
    private let onRefresh: @MainActor () -> Void

    public init(input: AnimatedMarkerInput, onRefresh: @escaping @MainActor () -> Void = {}) {
        self.input = input
        self.onRefresh = onRefresh
    }

    public func start() {
        onUpdate?(input)
    }

    public func stop() {}

    public func refresh() {
        onRefresh()
        onUpdate?(input)
    }
}

/// In-memory source for previews + unit/UI tests. Seeds an optional snapshot on `start()`, lets a
/// test push further snapshots, and records every start/stop/refresh so the contract is asserted.
@MainActor
public final class InMemoryAnimatedMarkerSource: AnimatedMarkerSource {
    public var onUpdate: (@MainActor (AnimatedMarkerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AnimatedMarkerInput?

    public init(initial: AnimatedMarkerInput? = nil) {
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
    public func push(_ input: AnimatedMarkerInput) {
        onUpdate?(input)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds an `AnimatedMarkerSource`, adapts the position snapshot
/// through `AnimatedMarkerAdapter`, retains the last-known fix across an offline snapshot, exposes the
/// connectivity axis, emits `view.opened` once on first appear, and auto-refreshes once on the stale
/// edge. The resolved view-state is projected by `AnimatedMarkerProjection`.
@MainActor
@Observable
public final class AnimatedMarkerModel {
    public private(set) var connection: AnimatedMarkerConnection = .live
    public private(set) var phase: AnimatedMarkerLoadPhase = .loading
    public private(set) var fix: AnimatedMarkerFix?

    public let content: AnimatedMarkerContent

    @ObservationIgnored private let source: any AnimatedMarkerSource
    @ObservationIgnored private let telemetry: any AnimatedMarkerTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var lastConnection: AnimatedMarkerConnection = .live

    public init(
        content: AnimatedMarkerContent,
        source: any AnimatedMarkerSource,
        telemetry: any AnimatedMarkerTelemetry = OSLogAnimatedMarkerTelemetry()
    ) {
        self.content = content
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// The resolved, view-ready state (the view renders this).
    public var resolved: AnimatedMarkerResolved {
        AnimatedMarkerProjection.resolve(
            content: content,
            fix: fix,
            phase: phase,
            connection: connection
        )
    }

    // MARK: Lifecycle

    /// Begins observing the source and emits `view.opened` once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        source.start()
        emitOpenOnce()
    }

    /// Stops observing the source.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the position (freshness chip + stale/offline recovery → web `refetch`).
    public func refresh() {
        source.refresh()
    }

    // MARK: Private

    private func apply(_ input: AnimatedMarkerInput) {
        let previous = lastConnection
        connection = input.connection
        lastConnection = input.connection
        phase = input.phase
        // A snapshot carrying a row adapts to a fix (possibly nil → empty for a null-island row); a
        // snapshot with no row retains the last-known fix (offline → keep the cached marker).
        if let row = input.row {
            fix = AnimatedMarkerAdapter.fix(from: row, defaultColorHex: content.defaultColorHex)
        }
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch); offline never
        // auto-refreshes (there is no connection to re-fetch over).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func emitOpenOnce() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: AnimatedMarkerMeta.surfaceSlug)
    }
}

// MARK: - Localisation facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the views hold no hardcoded
/// literals. Keys live in the per-surface "AnimatedMarker" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum AnimatedMarkerStrings {
    public static let table = "AnimatedMarker"

    public static let string: AnimatedMarkerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
