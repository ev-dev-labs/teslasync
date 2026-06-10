//
//  SignalSelector.Model.swift
//  TeslaSync — P4 feature view · 0270 · SignalSelector (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the signal multi-select. The view binds through
//  `SignalSelectorModel`; no networking lives in the view. The model owns the
//  operator's `selection` (web `value: string[]`), the configuration the web
//  takes as props (`max`, `showLayerHelp`, `labelOverride`), and the available
//  signal candidate list it receives from the bound `Source` (web `options`,
//  upstream `useSignals` / `/signals/{vehicleID}/available`). It derives the
//  label / accessibility summary through the pure `SignalSelectorProjection`, and
//  tracks the candidate-list load status + live-state freshness so the field can
//  layer the loading / empty / error / stale / offline chrome the Apple HIG
//  states contract requires under the always-present selector.
//
//  The seam mirrors the shared facade vocabulary — `LoadableState`
//  (loading/loaded/empty/failed) and `LiveConnectionState` (open/stale/closed) —
//  without importing `Shared`, so the surface compiles and unit-tests standalone.
//  The production app wires the real signals state holder (the web `useSignals`
//  query + the SSE freshness) into the `Source`.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared-core diagnostics (consent-gated + redacted there).
public protocol SignalSelectorTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSignalSelectorTelemetry: SignalSelectorTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the available-signal candidate list, mirroring the
/// shared `LoadableState` cases the production source projects from the
/// `useSignals` query (web `isLoading` / resolved / empty / `error`).
public enum SignalAvailabilityStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): `live` ≈
/// open, `stale` ≈ open-but-past-the-freshness-window, `offline` ≈ closed.
public enum SignalSelectorConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SignalSelectorSource`: the candidate-list
/// load status, the live-state connection, the available signal names (web
/// `options`), and when it was captured.
public struct SignalSelectorUpdate: Sendable, Equatable {
    public var status: SignalAvailabilityStatus
    public var connection: SignalSelectorConnection
    public var availableSignals: [String]
    public var updatedAt: Date?

    public init(
        status: SignalAvailabilityStatus = .loading,
        connection: SignalSelectorConnection = .live,
        availableSignals: [String] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.availableSignals = availableSignals
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 signals state holder (the web `useSignals` query + the SSE
/// freshness); previews and tests use `InMemorySignalSelectorSource`. The view
/// never talks to the network directly.
@MainActor
public protocol SignalSelectorSource: AnyObject {
    var onUpdate: (@MainActor (SignalSelectorUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The selector's observable view-model. Owns the operator `selection` (web
/// `value`), the web-prop configuration (`max` / `showLayerHelp` /
/// `labelOverride`), and the available candidate list, derives the label +
/// accessibility summary through the pure projection, enforces the cap on every
/// edit (web `slice(0, cap)`), and exposes a render `Phase` for SwiftUI to switch
/// over. The selector composition is always present; the phase only drives the
/// chrome layered around it.
@MainActor
@Observable
public final class SignalSelectorModel {
    /// The mutually-exclusive render branches for the candidate-list chrome
    /// layered under the always-present selector: a skeleton on the initial fetch,
    /// the `QueryError` equivalent on failure, the friendly empty hint when no
    /// signals are available, and no extra chrome when the list has signals.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var selection: [String]
    public private(set) var options: [String] = []
    public private(set) var phase: Phase = .loading
    public private(set) var connection: SignalSelectorConnection = .live
    public private(set) var hasData = false
    public private(set) var updatedAt: Date?

    /// Web prop `showLayerHelp` (default true) — whether the layer-help tooltip
    /// sits next to the label.
    public let showsLayerHelp: Bool

    @ObservationIgnored public let maxSelection: Int?
    @ObservationIgnored private let labelOverride: String?
    @ObservationIgnored private let source: any SignalSelectorSource
    @ObservationIgnored private let telemetry: any SignalSelectorTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SignalSelectorSource,
        telemetry: any SignalSelectorTelemetry = OSLogSignalSelectorTelemetry(),
        max: Int? = 5,
        showsLayerHelp: Bool = true,
        labelOverride: String? = nil,
        initialSelection: [String] = []
    ) {
        self.source = source
        self.telemetry = telemetry
        maxSelection = max
        self.showsLayerHelp = showsLayerHelp
        self.labelOverride = labelOverride
        selection = SignalSelectorProjection.applyCap(
            SignalSelectorProjection.options(from: initialSelection),
            cap: max
        )
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived projection (web label / a11y summary)

    /// The label above the field (web ``${t('Signals')} (${value.length} / ${max})``),
    /// re-derived on every read so a selection or locale change re-computes it.
    public var label: String {
        SignalSelectorProjection.label(
            selectedCount: selection.count,
            max: maxSelection,
            override: labelOverride,
            signalsWord: SignalSelectorStrings.string("Signals", "Signals")
        )
    }

    /// The combobox VoiceOver label (the role + selected/cap count).
    public var selectorSummary: String {
        SignalSelectorAccessibility.selectorSummary(
            selectedCount: selection.count,
            max: maxSelection,
            localize: SignalSelectorStrings.string
        )
    }

    /// Whether the selection has reached the cap (web at-`max`).
    public var isAtCapacity: Bool {
        SignalSelectorProjection.isAtCapacity(selectedCount: selection.count, max: maxSelection)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SignalSelector.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the available-signal list (wired to the error-state retry and
    /// the stale auto-refresh). The current selection stays intact.
    public func refresh() {
        source.refresh()
    }

    // MARK: Selection (web `onChange` → `slice(0, cap)`)

    /// Applies a `Set`-edit from the combobox, reconciling it into the ordered,
    /// capped selection (web `onChange={(next) => onChange(next.slice(0, cap))}`).
    public func setSelection(from incoming: Set<String>) {
        selection = SignalSelectorProjection.reconcile(
            previous: selection,
            incoming: incoming,
            cap: maxSelection
        )
    }

    // MARK: Snapshot application

    private func apply(_ update: SignalSelectorUpdate) {
        options = SignalSelectorProjection.options(from: update.availableSignals)
        connection = update.connection
        updatedAt = update.updatedAt
        hasData = !options.isEmpty
        phase = Self.resolvePhase(status: update.status, hasData: hasData)
        handleAutoRefresh(for: update.connection)
    }

    /// Resolves the candidate-list chrome phase: a skeleton on the initial fetch,
    /// the error state on failure, the friendly empty hint when the list resolved
    /// with no signals, and no extra chrome otherwise.
    public static func resolvePhase(status: SignalAvailabilityStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh");
    /// reset once live so a later stale episode re-triggers exactly once. Offline
    /// never auto-refreshes.
    private func handleAutoRefresh(for connection: SignalSelectorConnection) {
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

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`, and
/// inspect the call counts to assert the lifecycle wiring.
@MainActor
public final class InMemorySignalSelectorSource: SignalSelectorSource {
    public var onUpdate: (@MainActor (SignalSelectorUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SignalSelectorUpdate?

    public init(initial: SignalSelectorUpdate? = nil) {
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
    public func push(_ update: SignalSelectorUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SignalSelector" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum SignalSelectorStrings {
    public static let table = "SignalSelector"

    /// The web layer-help tooltip default — kept as a constant so the call sites
    /// (and this file) stay within the 120-column code width.
    public static let layersHelpDefault = "TeslaSync exposes three live-state layers: "
        + "L1 (in-process), L2 (Redis shared), and log (TimescaleDB history)."

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
