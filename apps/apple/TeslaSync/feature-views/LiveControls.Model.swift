//
//  LiveControls.Model.swift
//  TeslaSync — P4 feature view · 0233 · LiveControls (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the
//  i18n facade (P1/S10). The view binds through `LiveControlsModel`; no networking
//  lives in the view.
//
//  The web component is a purely controlled leaf — its parent (the FSM debugger
//  page) owns the transition-buffer query and passes the control props + the toggle
//  / step / window / clear callbacks down. The native surface owns the full P4
//  states contract around that parent query, so the source snapshot carries the
//  query phase (loading / loaded / failed) plus the freshness + connectivity flags
//  that drive the stale + offline chrome. The empty case is the native, never-a-
//  blank-box treatment of a buffer with zero transitions (the controls stay usable).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter forwarding to the
/// shared core `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated
/// and redacted there.
public protocol LiveControlsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`
/// event.
public struct OSLogLiveControlsTelemetry: LiveControlsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Parent query lifecycle (web debugger-page buffer derivation)

/// The load lifecycle of the parent's transition-buffer query, mirrored as the
/// source of truth the native surface renders around. `loaded(state)` carries the
/// controlled props (a buffer of zero transitions is still a healthy `loaded`).
public enum LiveControlsPhase: Sendable, Equatable {
    case loading
    case loaded(LiveControlsState)
    case failed
}

/// The resolved render branch the SwiftUI surface switches over. `ready` carries the
/// projected, display-ready toolbar state (whose counter may be empty).
public enum LiveControlsRender: Sendable, Equatable {
    case loading
    case failed
    case ready(LiveControlsProjection)
}

// MARK: - Input snapshot (web parent props + query meta)

/// One coalesced snapshot of the surface inputs — the parent's buffer-query phase
/// plus the freshness + connectivity flags. The production source composes this
/// from the debugger page's anchor query; previews/tests construct it directly.
public struct LiveControlsInput: Sendable, Equatable {
    public var phase: LiveControlsPhase
    public var isStale: Bool
    public var isOffline: Bool

    public init(phase: LiveControlsPhase, isStale: Bool = false, isOffline: Bool = false) {
        self.phase = phase
        self.isStale = isStale
        self.isOffline = isOffline
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// debugger page's anchor query; previews + tests use `InMemoryLiveControlsSource`.
/// The view never talks to the network directly — every control routes here (the
/// web `onToggleLive` / `onStepPrev` / `onStepNext` / `onWindowChange` /
/// `onClearBuffer` callbacks).
@MainActor
public protocol LiveControlsSource: AnyObject {
    var onUpdate: (@MainActor (LiveControlsInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-requests the buffer query (wired to retry + stale auto-refresh).
    func refresh()
    /// Web `onToggleLive(live)` — switch streaming Live (true) or Freeze (false).
    func toggleLive(_ live: Bool)
    /// Web `onStepPrev` — step to the previous buffered transition.
    func stepPrev()
    /// Web `onStepNext` — step to the next buffered transition.
    func stepNext()
    /// Web `onWindowChange(minutes)` — change the active buffer window.
    func changeWindow(_ minutes: Int)
    /// Web `onClearBuffer` — drop the buffered transitions.
    func clearBuffer()
}

/// The surface's observable view-model. Subscribes to a `LiveControlsSource`,
/// recomputes the resolved render branch + the stale/offline chrome flags, and
/// forwards every toolbar command to the bound source. Auto-refreshes once on each
/// rising edge into the stale state (the P4 "stale chip + auto-refresh" contract).
@MainActor
@Observable
public final class LiveControlsModel {
    public private(set) var render: LiveControlsRender = .loading
    public private(set) var isStale = false
    public private(set) var isOffline = false

    @ObservationIgnored private let source: any LiveControlsSource
    @ObservationIgnored private let telemetry: any LiveControlsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var wasStale = false

    public init(
        source: any LiveControlsSource,
        telemetry: any LiveControlsTelemetry = OSLogLiveControlsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LiveControls.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the buffer query (wired to the retry affordance).
    public func refresh() {
        source.refresh()
    }

    /// Web `onToggleLive` — forwards the Live/Freeze choice to the bound source.
    public func toggleLive(_ live: Bool) {
        source.toggleLive(live)
    }

    /// Web `onStepPrev` — forwards the step-previous command.
    public func stepPrev() {
        source.stepPrev()
    }

    /// Web `onStepNext` — forwards the step-next command.
    public func stepNext() {
        source.stepNext()
    }

    /// Web `onWindowChange` — forwards the new buffer window.
    public func changeWindow(_ minutes: Int) {
        source.changeWindow(minutes)
    }

    /// Web `onClearBuffer` — forwards the clear-buffer command.
    public func clearBuffer() {
        source.clearBuffer()
    }

    private func apply(_ input: LiveControlsInput) {
        render = Self.render(for: input.phase)
        isStale = input.isStale
        isOffline = input.isOffline
        if input.isStale, !wasStale {
            source.refresh()
        }
        wasStale = input.isStale
    }

    /// Resolves the render branch from the parent-query phase (web controlled
    /// toolbar, extended with the loading/error chrome the leaf delegates upward).
    nonisolated static func render(for phase: LiveControlsPhase) -> LiveControlsRender {
        switch phase {
        case .loading:
            .loading
        case .failed:
            .failed
        case let .loaded(state):
            .ready(LiveControlsProjection.make(from: state))
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`; every
/// forwarded command is recorded for assertion.
@MainActor
public final class InMemoryLiveControlsSource: LiveControlsSource {
    public var onUpdate: (@MainActor (LiveControlsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var toggledLive: [Bool] = []
    public private(set) var stepPrevCount = 0
    public private(set) var stepNextCount = 0
    public private(set) var windowChanges: [Int] = []
    public private(set) var clearCount = 0

    private let initial: LiveControlsInput?

    public init(initial: LiveControlsInput? = nil) {
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

    public func toggleLive(_ live: Bool) {
        toggledLive.append(live)
    }

    public func stepPrev() {
        stepPrevCount += 1
    }

    public func stepNext() {
        stepNextCount += 1
    }

    public func changeWindow(_ minutes: Int) {
        windowChanges.append(minutes)
    }

    public func clearBuffer() {
        clearCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: LiveControlsInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "LiveControls" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum LiveControlsStrings {
    public static let table = "LiveControls"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
