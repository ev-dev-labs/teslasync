//
//  SignalSparklinePreview.Model.swift
//  TeslaSync — P4 feature view · 0271 · SignalSparklinePreview (Apple)
//
//  The seams that keep the SwiftUI surface declarative:
//    • P1/S11 telemetry contract (`view.opened`),
//    • P1/S8 state-holder seam (`SignalSparklineSource` → `SignalSparklineModel`),
//    • the render-phase resolution from the bound snapshot.
//
//  No networking lives here. The production source is wired over the shared P1/S8
//  signal-history query (web `useSignalHistory`, gated by the parent's `enabled`
//  flag) at the composition root; previews and tests drive
//  `InMemorySignalSparklineSource`. The web component owns its own query but only
//  reads from it; the source reproduces that whole lifecycle so every prompt-required
//  state renders here.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared
/// `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted).
public protocol SignalSparklineTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSignalSparklineTelemetry: SignalSparklineTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot (web `SignalSparklinePreviewProps` + fetched data)

/// One coalesced snapshot pushed by a `SignalSparklineSource`: the parent's display
/// inputs (web props — `signal`, `valueKind`, `enabled`, `width` / `height` / color),
/// the history feed's load status + live-state, and the fetched envelopes. The model
/// turns this into the numeric projection + render phase. The field set mirrors the
/// web prop contract so parity is one-to-one.
public struct SignalSparklineUpdate: Sendable, Equatable {
    public var status: SignalSparklineLoadStatus
    public var connection: SignalSparklineConnection
    /// Web `enabled` gate (parent flips this on per leaf as a group expands).
    public var enabled: Bool
    /// Web `signal` prop (the canonical proto field name) — used for the a11y label.
    public var signal: String
    /// Web `valueKind` prop — selects the Sparkline vs the non-numeric kind chip.
    public var kind: SignalSparklineKind
    public var envelopes: [SignalSparklineEnvelope]
    public var width: Int
    public var height: Int
    public var colorIndex: Int
    public var updatedAt: Date?

    public init(
        status: SignalSparklineLoadStatus = .loading,
        connection: SignalSparklineConnection = .live,
        enabled: Bool = true,
        signal: String = "",
        kind: SignalSparklineKind = .float,
        envelopes: [SignalSparklineEnvelope] = [],
        width: Int = SignalSparklineConfig.defaultWidth,
        height: Int = SignalSparklineConfig.defaultHeight,
        colorIndex: Int = SignalSparklineConfig.defaultColorIndex,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.enabled = enabled
        self.signal = signal
        self.kind = kind
        self.envelopes = envelopes
        self.width = width
        self.height = height
        self.colorIndex = colorIndex
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 signal-history query (gated by the parent's `enabled` flag); the view never
/// performs transport. Previews and tests use `InMemorySignalSparklineSource`.
@MainActor
public protocol SignalSparklineSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SignalSparklineUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying feed (history refetch) — the error-state retry + the
    /// stale auto-refresh both route here.
    func refresh()
}

// MARK: - View-model (P1/S8)

/// The surface's observable view-model. Subscribes to a `SignalSparklineSource`,
/// projects each snapshot into the numeric series + a render `Phase` for SwiftUI to
/// switch over, and emits the `view.opened` diagnostics event once on first
/// appearance.
@MainActor
@Observable
public final class SignalSparklineModel {
    /// The mutually-exclusive render branches, in the web source's evaluation order.
    public enum Phase: Equatable {
        /// Web `if (!enabled) return null` — the parent-controlled fetch gate.
        case disabled
        /// Web non-numeric kinds — the `(kind)` chip instead of a trend line.
        case nonNumeric(token: String)
        /// Web `query.isLoading` — the pulsing skeleton box.
        case loading
        /// Web `numericSeries.length < 2` — the "—" no-samples fallback.
        case empty
        /// Native load envelope — the fetch failed with nothing cached.
        case error(String)
        /// Web Sparkline — a numeric series with >= 2 points.
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SignalSparklineConnection = .live
    public private(set) var kind: SignalSparklineKind = .float
    public private(set) var signal = ""
    public private(set) var values: [Double] = []
    public private(set) var width = SignalSparklineConfig.defaultWidth
    public private(set) var height = SignalSparklineConfig.defaultHeight
    public private(set) var colorIndex = SignalSparklineConfig.defaultColorIndex
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SignalSparklineSource
    @ObservationIgnored private let telemetry: any SignalSparklineTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SignalSparklineSource,
        telemetry: any SignalSparklineTelemetry = OSLogSignalSparklineTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The sample count backing the a11y summary (web `numericSeries.length`).
    public var sampleCount: Int {
        values.count
    }

    /// The combined VoiceOver summary for the current phase.
    public var accessibilitySummary: String {
        switch phase {
        case .disabled:
            ""
        case let .nonNumeric(token):
            SignalSparklineAccessibility.nonNumericSummary(
                signal: signal,
                token: token,
                localize: SignalSparklineStrings.string
            )
        case .loading:
            SignalSparklineStrings.loadingLabel
        case .empty, .error:
            SignalSparklineAccessibility.emptySummary(signal: signal, localize: SignalSparklineStrings.string)
        case .content:
            SignalSparklineAccessibility.trendSummary(
                signal: signal,
                sampleCount: sampleCount,
                connection: connection,
                localize: SignalSparklineStrings.string
            )
        }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SignalSparklineSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying feed (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: SignalSparklineUpdate) {
        connection = update.connection
        kind = update.kind
        signal = update.signal
        width = update.width
        height = update.height
        colorIndex = update.colorIndex
        updatedAt = update.updatedAt
        let projection = SignalSparklineBuilder.project(from: update.envelopes)
        values = projection.values
        phase = Self.resolvePhase(
            enabled: update.enabled,
            kind: update.kind,
            status: update.status,
            hasTrend: projection.hasTrend
        )
        handleAutoRefresh(for: update.connection)
    }

    /// Resolves the render phase, mirroring the web branch order exactly: the
    /// `!enabled` gate wins first, then non-numeric kinds short-circuit to the chip,
    /// then any resolved trend (>= 2 points) wins as content even while a background
    /// refetch is in flight or failed (the cached trend stays on screen). With no
    /// trend yet, an in-flight fetch is the skeleton, a failure with nothing cached is
    /// the native error envelope, and a settled-but-empty feed is the "—" fallback.
    static func resolvePhase(
        enabled: Bool,
        kind: SignalSparklineKind,
        status: SignalSparklineLoadStatus,
        hasTrend: Bool
    ) -> Phase {
        guard enabled else { return .disabled }
        guard kind.isNumeric else { return .nonNumeric(token: kind.token) }
        if hasTrend { return .content }
        switch status {
        case .loading:
            return .loading
        case let .failed(message):
            return .error(message)
        case .loaded:
            return .empty
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached trend on screen and does not refetch.
    private func handleAutoRefresh(for connection: SignalSparklineConnection) {
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

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot
/// on `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySignalSparklineSource: SignalSparklineSource {
    public var onUpdate: (@MainActor (SignalSparklineUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SignalSparklineUpdate?

    public init(initial: SignalSparklineUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: SignalSparklineUpdate) {
        onUpdate?(update)
    }
}
