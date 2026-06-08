//
//  ComputedMetricEditor.Model.swift
//  TeslaSync — P4 feature view · 0182 · ComputedMetricEditor (Apple)
//
//  The P1/S11 diagnostics seam (`view.opened` for the `ComputedMetricEditor`
//  surface), the P1/S10 i18n facade (`CMEStrings`), and the P1/S8 state-holder seam
//  for the metric registry (web `useAlertMetrics`, GET `/alerts/metrics`): a
//  Shared-free `ComputedMetricRegistrySource` the view binds through, a
//  cache-then-network load state + error taxonomy mirroring the facade
//  `LoadableState`/`FacadeError` SHAPE, the pure presentation resolver that renders
//  every state (loading / empty / error / stale / offline / content), and the
//  `@Observable` model. No SwiftUI view code and no direct networking live here.
//

import Foundation
import Observation
import OSLog

// MARK: - Diagnostics surface identity (P1/S11)

/// The surface slug emitted with the `view.opened` diagnostics event. Kept off the
/// SwiftUI view so the model + tests reference it without importing SwiftUI.
public enum ComputedMetricEditorDiagnostics {
    public static let surface = "ComputedMetricEditor"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared
/// core `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated + redacted.
public protocol ComputedMetricEditorTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogComputedMetricEditorTelemetry: ComputedMetricEditorTelemetry {
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
public enum ComputedMetricEditorOpenReporter {
    public static func report(using telemetry: any ComputedMetricEditorTelemetry) {
        telemetry.viewOpened(surface: ComputedMetricEditorDiagnostics.surface)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so no view
/// holds a hardcoded literal. Keys live in the per-surface "ComputedMetricEditor"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time
/// (kept separate so parallel surface prompts never collide on the shared catalog).
public enum CMEStrings {
    public static let table = "ComputedMetricEditor"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `LocalizedText` descriptor (web `t(key, fallback)`).
    public static func string(_ text: LocalizedText) -> String {
        string(text.key, text.fallback)
    }
}

// MARK: - Error taxonomy (mirrors the shared `FacadeError` cases the source maps)

/// The failure modes the registry source surfaces, mirroring the shared `FacadeError`
/// shape (offline keeps cached metrics; decode is non-retryable; network/api retry).
public enum ComputedMetricLoadError: Equatable, Sendable {
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
public enum ComputedMetricLoadState<Value> {
    case idle
    case loading(cached: Value?, stale: Bool)
    case loaded(Value, stale: Bool)
    case empty(stale: Bool)
    case failed(ComputedMetricLoadError, cached: Value?, stale: Bool)
}

extension ComputedMetricLoadState: Equatable where Value: Equatable {}

// MARK: - Freshness + presentation (every state renders — no hidden surfaces)

/// Whether the displayed metrics are live, older than the freshness window, or served
/// from cache while offline (web freshness indicator).
public enum ComputedMetricFreshness: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The resolved, view-ready presentation for the metric registry — the native render
/// branches the P4 states contract requires around the metric dropdown.
public enum ComputedMetricRegistryPresentation: Equatable {
    /// Initial fetch with nothing cached yet (web `metrics === undefined` / `loading`).
    case loading
    /// Metrics available (fresh, stale, or offline-cached); `refreshing` flags an
    /// in-flight background refetch behind the cached list.
    case content([ComputedMetricSummary], ComputedMetricFreshness, refreshing: Bool)
    /// Resolved with no registered metrics (web empty list → empty option only).
    case empty(ComputedMetricFreshness)
    /// Offline with no cached metrics to fall back to.
    case offlineNoData
    /// The fetch failed with no cache (web `QueryError`); `retryable` gates the retry.
    case error(retryable: Bool)

    /// Pure projection from the load state to the presentation — the native port of the
    /// web `metrics ?? []` ladder, widened with the prompt's stale/offline/error chrome.
    /// Unit-tested across every branch.
    public static func resolve(
        _ state: ComputedMetricLoadState<[ComputedMetricSummary]>
    ) -> ComputedMetricRegistryPresentation {
        switch state {
        case .idle:
            return .loading
        case let .loading(cached, stale):
            if let cached, !cached.isEmpty {
                return .content(cached, stale ? .stale : .live, refreshing: true)
            }
            return .loading
        case let .loaded(metrics, stale):
            if metrics.isEmpty { return .empty(stale ? .stale : .live) }
            return .content(metrics, stale ? .stale : .live, refreshing: false)
        case let .empty(stale):
            return .empty(stale ? .stale : .live)
        case let .failed(error, cached, _):
            if let cached, !cached.isEmpty {
                let freshness: ComputedMetricFreshness = error == .offline ? .offline : .stale
                return .content(cached, freshness, refreshing: false)
            }
            if error == .offline { return .offlineNoData }
            return .error(retryable: error.isRetryable)
        }
    }
}

// MARK: - Source seam (P1/S8) — the view never touches HTTP

/// The seam the model binds through. The production app implements this over the
/// shared P1/S8 alert-metrics state holder (web `useAlertMetrics`, GET
/// `/alerts/metrics`), projected via `StateHolderModel<LoadableState<[…]>>`; previews
/// and tests use `InMemoryComputedMetricRegistrySource`.
@MainActor
public protocol ComputedMetricRegistrySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ComputedMetricLoadState<[ComputedMetricSummary]>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryComputedMetricRegistrySource: ComputedMetricRegistrySource {
    public var onUpdate: (@MainActor (ComputedMetricLoadState<[ComputedMetricSummary]>) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ComputedMetricLoadState<[ComputedMetricSummary]>?

    public init(initial: ComputedMetricLoadState<[ComputedMetricSummary]>? = nil) {
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
    public func push(_ state: ComputedMetricLoadState<[ComputedMetricSummary]>) {
        onUpdate?(state)
    }
}

// MARK: - Registry view-model (P1/S8 binding)

/// The observable view-model for the metric registry. Subscribes to a
/// `ComputedMetricRegistrySource` and republishes its load state for SwiftUI to switch
/// over. The view performs no networking; `start`/`stop`/`refresh` delegate to the
/// source. The last-known list stays available (`metrics`) so the window/operator
/// dropdowns can derive their options even while a refetch is in flight.
@MainActor
@Observable
public final class ComputedMetricRegistryModel {
    /// The current cache-then-network state for the metrics registry.
    public private(set) var state: ComputedMetricLoadState<[ComputedMetricSummary]> = .idle

    /// The last-known metric list (web `metrics` prop), retained across loading/stale/
    /// offline so the dependent dropdowns keep working behind a refetch.
    public private(set) var metrics: [ComputedMetricSummary] = []

    @ObservationIgnored private let source: any ComputedMetricRegistrySource
    @ObservationIgnored private var started = false

    /// Live binding: observe the shared metrics feed.
    public init(source: any ComputedMetricRegistrySource) {
        self.source = source
        source.onUpdate = { [weak self] state in self?.apply(state) }
    }

    /// Preview / test binding: render a fixed state without the shared core.
    public init(previewState: ComputedMetricLoadState<[ComputedMetricSummary]>) {
        let inMemory = InMemoryComputedMetricRegistrySource(initial: previewState)
        source = inMemory
        apply(previewState)
        inMemory.onUpdate = { [weak self] state in self?.apply(state) }
    }

    /// Web-prop binding: the web reads `{ metrics, loading }`. Maps the loaded array (or
    /// the loading sentinel) onto the cache-then-network load state.
    public convenience init(metrics: [ComputedMetricSummary], loading: Bool) {
        self.init(previewState: ComputedMetricRegistryModel.loadState(metrics: metrics, loading: loading))
    }

    /// Pure web-prop → load-state mapping (unit-tested). `nonisolated` because it touches
    /// no actor state — callable off the main actor.
    public nonisolated static func loadState(
        metrics: [ComputedMetricSummary],
        loading: Bool
    ) -> ComputedMetricLoadState<[ComputedMetricSummary]> {
        if loading { return .loading(cached: metrics.isEmpty ? nil : metrics, stale: false) }
        return metrics.isEmpty ? .empty(stale: false) : .loaded(metrics, stale: false)
    }

    /// The resolved presentation for the bound state (web render projection).
    public var presentation: ComputedMetricRegistryPresentation {
        ComputedMetricRegistryPresentation.resolve(state)
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

    /// Forces a refresh; any cached metrics stay visible (web `refetch`).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ state: ComputedMetricLoadState<[ComputedMetricSummary]>) {
        self.state = state
        if let latest = ComputedMetricRegistryModel.value(of: state) {
            metrics = latest
        }
    }

    /// Extracts the carried metric list from any state that has one.
    private nonisolated static func value(
        of state: ComputedMetricLoadState<[ComputedMetricSummary]>
    ) -> [ComputedMetricSummary]? {
        switch state {
        case let .loaded(value, _):
            value
        case let .loading(cached, _), let .failed(_, cached, _):
            cached
        case .empty:
            []
        case .idle:
            nil
        }
    }
}
