//
//  AIFeatureToggleList.Model.swift
//  TeslaSync — P4 feature view · 0199 · AIFeatureToggleList (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the AI
//  feature-toggle settings surface. SwiftUI parity of
//  features/settings/components/AIFeatureToggleList.tsx — the per-feature opt-in list the Helix
//  settings page renders below the mode picker.
//
//  The web source is a CONTROLLED presentational leaf fed `values: Record<AiFeatureId, boolean>` plus
//  an `onToggle(id, value)` callback by its parent (the settings form). The native surface owns the
//  full settings lifecycle through this seam, so the same data the web parent resolves (loading /
//  loaded / empty / failure) plus live-sync freshness (ADR-013 stale / offline) all surface here, and
//  a flip persists through `setEnabled` exactly as the web `onToggle` bubbles to the parent mutation.
//
//  Vendor-agnostic and SwiftUI-free (Foundation + Observation + OSLog only) so the model + the
//  projection it drives are pinned by host unit tests; the SwiftUI chrome layers on top in
//  AIFeatureToggleList.swift / AIFeatureToggleList.Views.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol AIFeatureToggleTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogAIFeatureToggleTelemetry: AIFeatureToggleTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's feature-settings query, mirroring the shared `LoadableState`
/// cases the web parent projects from its settings hook (web `isLoading` skeleton / resolved values /
/// no-settings-record empty / failure).
public enum AIFeatureLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-sync freshness (ADR-013). Drives the header freshness chip + the cached-data banner so cached
/// settings are clearly labeled while reconnecting / offline.
public enum AIFeatureConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `AIFeatureToggleSource`: the per-feature opt-in values (web
/// `values: Record<AiFeatureId, boolean>`) plus their load/connection status. A `nil` `values` means
/// "no settings payload yet" (loading / failure with nothing cached); an empty map means a resolved
/// record with every feature off. The model turns this into the projection + phase.
public struct AIFeatureToggleUpdate: Sendable, Equatable {
    public var status: AIFeatureLoadStatus
    public var connection: AIFeatureConnection
    public var isFetching: Bool
    public var values: [String: Bool]?
    public var updatedAt: Date?

    public init(
        status: AIFeatureLoadStatus = .loading,
        connection: AIFeatureConnection = .live,
        isFetching: Bool = false,
        values: [String: Bool]? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.values = values
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 settings
/// state holder (the AI feature-flags slice) and its persist mutation; previews and tests use
/// `InMemoryAIFeatureToggleSource`. The view never talks to the network directly.
@MainActor
public protocol AIFeatureToggleSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (AIFeatureToggleUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Persists a single feature's opt-in flip (web `onToggle(id, value)` → parent mutation).
    func setEnabled(id: String, _ enabled: Bool)
}

/// The surface's observable view-model. Subscribes to an `AIFeatureToggleSource`, recomputes the
/// `AIFeatureToggleProjection` via `AIFeatureToggleProjector`, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over. A flip is applied optimistically and persisted through the
/// seam.
@MainActor
@Observable
public final class AIFeatureToggleListModel {
    /// The mutually-exclusive render branches: the loading skeleton, the no-settings-record empty
    /// branch, a failure (native retry affordance), and the populated toggle list.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: AIFeatureConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: AIFeatureToggleProjection?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any AIFeatureToggleSource
    @ObservationIgnored private let telemetry: any AIFeatureToggleTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    /// The current opt-in values, the source of truth the projection is rebuilt from. Kept so an
    /// optimistic flip survives until the next confirming push, and so a `nil` (no-payload) update
    /// never clobbers cached settings.
    @ObservationIgnored private var values: [String: Bool] = [:]
    @ObservationIgnored private var hasSettings = false

    public init(
        source: any AIFeatureToggleSource,
        telemetry: any AIFeatureToggleTelemetry = OSLogAIFeatureToggleTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AIFeatureToggleListSurface.slug)
        source.start()
    }

    /// Stops observing the upstream settings feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached settings stay visible). Wired to the retry affordance and to the stale
    /// auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Flips one feature's opt-in (web `onToggle(id, value)`): optimistically updates the local values
    /// + projection so the switch responds instantly, then persists through the seam. The next
    /// confirming push reconciles. No-op when the value is unchanged.
    public func toggle(id: String, _ enabled: Bool) {
        guard values[id] != enabled else { return }
        values[id] = enabled
        hasSettings = true
        projection = AIFeatureToggleProjector.project(values: values)
        // A flip is only reachable from the populated list, and we now hold a settings snapshot, so
        // the surface is unambiguously in its data phase.
        phase = .data
        source.setEnabled(id: id, enabled)
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native parity
    /// of the web stale-query self-refresh (prompt "stale chip + auto-refresh").
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: AIFeatureToggleUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        if let incoming = update.values {
            values = incoming
            hasSettings = true
        }
        projection = hasSettings ? AIFeatureToggleProjector.project(values: values) : nil
        phase = Self.resolvePhase(status: update.status, hasData: hasSettings)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached settings without
    /// hammering an unreachable backend.
    private func handleAutoRefresh(for connection: AIFeatureConnection) {
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

    /// Resolves the render phase. Mirrors the web shell + body: the skeleton shows only on the initial
    /// fetch; the empty state shows when there is no settings record yet; whenever a settings snapshot
    /// is known the toggle list renders (cached values stay visible behind a refresh / transient
    /// failure so an offline or stale pod still shows the last-saved opt-ins).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase logic
    /// be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: AIFeatureLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .data : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .data : .empty
        case let .failed(message):
            hasData ? .data : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`; records the persisted
/// flips so the seam contract can be asserted.
@MainActor
public final class InMemoryAIFeatureToggleSource: AIFeatureToggleSource {
    public var onUpdate: (@MainActor (AIFeatureToggleUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var persisted: [(id: String, enabled: Bool)] = []

    private let initial: AIFeatureToggleUpdate?

    public init(initial: AIFeatureToggleUpdate? = nil) {
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

    public func setEnabled(id: String, _ enabled: Bool) {
        persisted.append((id: id, enabled: enabled))
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: AIFeatureToggleUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity (kept SwiftUI-free for host-testable model)

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile and
/// test without SwiftUI. `AIFeatureToggleList` re-exposes it as `surfaceSlug` for API parity with the
/// other surfaces.
public enum AIFeatureToggleListSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AIFeatureToggleList"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AIFeatureToggleList" table, folded into the app
/// `Localizable.xcstrings` master catalog at integration time; the per-surface table keeps each
/// parallel surface prompt owning its own strings without editing the shared catalog. `string` is
/// Foundation-only so the adapter's accessibility summary can use it; the SwiftUI `text(_:_:)` helper
/// lives in the view file.
public enum AIFeatureToggleStrings {
    public static let table = "AIFeatureToggleList"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
