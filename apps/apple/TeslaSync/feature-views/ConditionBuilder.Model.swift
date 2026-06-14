//
//  ConditionBuilder.Model.swift
//  TeslaSync — P4 feature view · 0083 · ConditionBuilder (Apple)
//
//  The P1/S10 i18n facade (`CBStrings`), the P1/S11 diagnostics seam
//  (`view.opened` for the `ConditionBuilder` surface), and the P1/S8 state-holder
//  seam for the surface's only data hook (web `useGeofences`): a Shared-free
//  `GeofenceOptionsSource` the view binds through, a cache-then-network load state +
//  error taxonomy mirroring the facade `LoadableState`/`FacadeError` SHAPE, the
//  pure presentation resolver that renders every state (loading / empty / error /
//  stale / offline / content), and the `@Observable` model. No SwiftUI view code
//  and no direct networking live here.
//

import Foundation
import Observation
import OSLog

// MARK: - Diagnostics surface identity (P1/S11)

/// The surface slug emitted with the `view.opened` diagnostics event. Kept off the
/// SwiftUI view so the model + tests reference it without importing SwiftUI.
public enum ConditionBuilderDiagnostics {
    public static let surface = "ConditionBuilder"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared
/// core `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated + redacted.
public protocol ConditionBuilderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogConditionBuilderTelemetry: ConditionBuilderTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

/// Reports the surface-open `view.opened` event (P1/S11). Extracted from the SwiftUI
/// view's `.task` so the diagnostics wiring is unit-testable without hosting SwiftUI.
public enum ConditionBuilderOpenReporter {
    public static func report(using telemetry: any ConditionBuilderTelemetry) {
        telemetry.viewOpened(surface: ConditionBuilderDiagnostics.surface)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so no view
/// holds a hardcoded literal. Keys live in the per-surface "ConditionBuilder" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time (kept
/// separate so parallel surface prompts never collide on the shared catalog).
public enum CBStrings {
    public static let table = "ConditionBuilder"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `LocalizedText` descriptor (web `t(key, fallback)`).
    public static func string(_ text: LocalizedText) -> String {
        string(text.key, text.fallback)
    }
}

// MARK: - Geofence option input (web `useGeofences` → `{ value, label }`)

/// One geofence option pushed by a `GeofenceOptionsSource` — the native mirror of the
/// web `Geofence` fields the picker reads (`String(g.id)` + `g.name`). The web
/// `Geofence.id` is a string, so `id` is modeled as `String`.
public struct GeofenceOption: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

// MARK: - Error taxonomy (mirrors the shared `FacadeError` cases the source maps)

/// The failure modes the geofence source surfaces, mirroring the shared `FacadeError`
/// shape (offline keeps cached options; decode is non-retryable; network/api retry).
public enum GeofenceLoadError: Equatable, Sendable {
    case offline
    case network(message: String)
    case decode(message: String)
    case api(status: Int, code: String?, body: String?)

    /// Whether a retry affordance should be offered (web `QueryError` retry).
    public var isRetryable: Bool {
        switch self {
        case .offline, .network, .api: true
        case .decode: false
        }
    }
}

// MARK: - Load state (cache-then-network + stale flag, ADR-013)

/// Native projection of the shared core's `Resource<T>` lifecycle, carrying the last
/// cached value to keep on screen behind a refresh/error and the ADR-013 `stale` flag.
/// Mirrors the facade `LoadableState` without importing `Shared`, so the surface
/// host-compiles and every branch is unit-testable.
public enum GeofenceLoadState<Value> {
    case idle
    case loading(cached: Value?, stale: Bool)
    case loaded(Value, stale: Bool)
    case empty(stale: Bool)
    case failed(GeofenceLoadError, cached: Value?, stale: Bool)
}

extension GeofenceLoadState: Equatable where Value: Equatable {}

// MARK: - Freshness + presentation (every state renders — no hidden surfaces)

/// Whether the displayed options are live, older than the freshness window, or served
/// from cache while offline (web freshness indicator).
public enum GeofenceFreshness: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The resolved, view-ready presentation for the geofence picker — the native render
/// branches the P4 states contract requires.
public enum GeofencePresentation: Equatable {
    /// Initial fetch with nothing cached yet (web `data === undefined`).
    case loading
    /// Options available (fresh, stale, or offline-cached); `refreshing` flags an
    /// in-flight background refetch behind the cached list.
    case content([GeofenceOption], GeofenceFreshness, refreshing: Bool)
    /// Resolved with no saved places (web empty geofence list → placeholder only). // parity:allow ui
    case empty(GeofenceFreshness)
    /// Offline with no cached options to fall back to.
    case offlineNoData
    /// The fetch failed with no cache (web `QueryError`); `retryable` gates the retry.
    case error(retryable: Bool)

    /// Pure projection from the load state to the presentation — the native port of the
    /// web `geofences ?? []` ladder, widened with the prompt's stale/offline/error
    /// chrome. Unit-tested across every branch.
    public static func resolve(_ state: GeofenceLoadState<[GeofenceOption]>) -> GeofencePresentation {
        switch state {
        case .idle:
            return .loading
        case let .loading(cached, stale):
            if let cached, !cached.isEmpty {
                return .content(cached, stale ? .stale : .live, refreshing: true)
            }
            return .loading
        case let .loaded(options, stale):
            if options.isEmpty { return .empty(stale ? .stale : .live) }
            return .content(options, stale ? .stale : .live, refreshing: false)
        case let .empty(stale):
            return .empty(stale ? .stale : .live)
        case let .failed(error, cached, _):
            if let cached, !cached.isEmpty {
                let freshness: GeofenceFreshness = error == .offline ? .offline : .stale
                return .content(cached, freshness, refreshing: false)
            }
            if error == .offline { return .offlineNoData }
            return .error(retryable: error.isRetryable)
        }
    }
}

// MARK: - Source seam (P1/S8) — the view never touches HTTP

/// The seam the model binds through. The production app implements this over the
/// shared P1/S8 geofences state holder (web `useGeofences`, GET `/geofences`),
/// projected via `StateHolderModel<LoadableState<[GeofenceOption]>>`; previews and
/// tests use `InMemoryGeofenceOptionsSource`.
@MainActor
public protocol GeofenceOptionsSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (GeofenceLoadState<[GeofenceOption]>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryGeofenceOptionsSource: GeofenceOptionsSource {
    public var onUpdate: (@MainActor (GeofenceLoadState<[GeofenceOption]>) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: GeofenceLoadState<[GeofenceOption]>?

    public init(initial: GeofenceLoadState<[GeofenceOption]>? = nil) {
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
    public func push(_ state: GeofenceLoadState<[GeofenceOption]>) {
        onUpdate?(state)
    }
}

// MARK: - Geofence options view-model (P1/S8 binding)

/// The observable view-model for the geofence picker's data. Subscribes to a
/// `GeofenceOptionsSource` and republishes its load state for SwiftUI to switch over.
/// The view performs no networking; `start`/`stop`/`refresh` delegate to the source.
@MainActor
@Observable
public final class GeofenceOptionsModel {
    /// The current cache-then-network state for the geofences feed.
    public private(set) var state: GeofenceLoadState<[GeofenceOption]> = .idle

    @ObservationIgnored private let source: any GeofenceOptionsSource
    @ObservationIgnored private var started = false

    /// Live binding: observe the shared geofences feed.
    public init(source: any GeofenceOptionsSource) {
        self.source = source
        source.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Preview / test binding: render a fixed state without the shared core.
    public init(previewState: GeofenceLoadState<[GeofenceOption]>) {
        let inMemory = InMemoryGeofenceOptionsSource(initial: previewState)
        source = inMemory
        state = previewState
        inMemory.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Web-prop binding: the web reads `{ data: geofences } = useGeofences()`. Maps the
    /// loaded array (or the loading sentinel) onto the cache-then-network load state.
    public convenience init(geofences: [GeofenceOption], loading: Bool) {
        self.init(previewState: GeofenceOptionsModel.loadState(geofences: geofences, loading: loading))
    }

    /// Pure web-prop → load-state mapping (unit-tested). `nonisolated` because it
    /// touches no actor state — callable off the main actor.
    public nonisolated static func loadState(
        geofences: [GeofenceOption],
        loading: Bool
    ) -> GeofenceLoadState<[GeofenceOption]> {
        if loading { return .loading(cached: geofences.isEmpty ? nil : geofences, stale: false) }
        return geofences.isEmpty ? .empty(stale: false) : .loaded(geofences, stale: false)
    }

    /// The resolved presentation for the bound state (web render projection).
    public var presentation: GeofencePresentation {
        GeofencePresentation.resolve(state)
    }

    /// Begins observing the upstream feed (idempotent).
    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    /// Stops observing and closes the upstream subscription.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh; any cached options stay visible (web `refetch`).
    public func refresh() {
        source.refresh()
    }
}
