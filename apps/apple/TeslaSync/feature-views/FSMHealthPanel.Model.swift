//
//  FSMHealthPanel.Model.swift
//  TeslaSync — P4 feature view · 0228 · FSMHealthPanel (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10)
//  for the FSM-health surface. The view binds through `FSMHealthPanelModel`; no networking
//  lives in the view. SwiftUI parity of features/system/components/FSMHealthPanel.tsx — the
//  health-alert panel shown on the FSM debugger / system page.
//
//  The web component receives `transitions` as a prop derived by the parent (the FSM
//  debugger page), and the parent owns the loading / error / freshness lifecycle. The
//  native surface reproduces that whole lifecycle through an `FSMHealthPanelSource` so
//  every prompt-required state (loading / healthy / alerts / error / stale / offline)
//  renders here. The model also exposes `flapIds` — the native parity of the web exported
//  `computeFlapIds` — so a parent can highlight the flagged transitions elsewhere.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that forwards
/// to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016), which is
/// consent-gated and redacted there.
public protocol FSMHealthPanelTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogFSMHealthPanelTelemetry: FSMHealthPanelTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "FSMHealthPanel" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; the per-surface table keeps each
/// parallel surface prompt self-contained.
public enum FSMHealthPanelStrings {
    public static let table = "FSMHealthPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by an `FSMHealthPanelSource`: the FSM transition log + the
/// load status, the live connection, the in-flight refresh flag, and the last-update
/// timestamp. The model turns these into the derived alerts + render phase via
/// `FSMHealthProjector`.
public struct FSMHealthPanelUpdate: Sendable, Equatable {
    public var status: FSMHealthLoadStatus
    public var transitions: [FSMHealthTransitionInput]
    public var connection: FSMHealthConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: FSMHealthLoadStatus = .loading,
        transitions: [FSMHealthTransitionInput] = [],
        connection: FSMHealthConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.transitions = transitions
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders — composing the FSM transition query the web page reads
/// (`useFSMTransitions`) and mapping each row into an `FSMHealthTransitionInput`. Previews +
/// tests use `InMemoryFSMHealthPanelSource`. The view never talks to the network directly.
@MainActor
public protocol FSMHealthPanelSource: AnyObject {
    var onUpdate: (@MainActor (FSMHealthPanelUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to an `FSMHealthPanelSource`, derives the
/// health alerts + the flagged-flap ids (web `useMemo` + `computeFlapIds`), exposes a render
/// `FSMHealthPhase` + freshness for SwiftUI to switch over, and emits the `view.opened`
/// diagnostics event once on first appearance.
@MainActor
@Observable
public final class FSMHealthPanelModel {
    public private(set) var phase: FSMHealthPhase = .loading
    public private(set) var connection: FSMHealthConnection = .live
    public private(set) var alerts: [FSMHealthAlert] = []
    /// The flagged-flap transition ids (web exported `computeFlapIds`), surfaced for a
    /// parent that highlights the flapping rows elsewhere.
    public private(set) var flapIds: Set<Int> = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any FSMHealthPanelSource
    @ObservationIgnored private let telemetry: any FSMHealthPanelTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let now: @MainActor () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any FSMHealthPanelSource,
        telemetry: any FSMHealthPanelTelemetry = OSLogFSMHealthPanelTelemetry(),
        locale: Locale = .current,
        now: @escaping @MainActor () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        self.now = now
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The locale used for number formatting (count badge / a11y summary).
    public var displayLocale: Locale {
        locale
    }

    /// The combined VoiceOver summary for the panel.
    public var accessibilitySummary: String {
        FSMHealthAccessibility.summary(
            for: phase,
            localize: FSMHealthPanelStrings.string,
            locale: locale
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: FSMHealthPanelSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: FSMHealthPanelUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        let computed = FSMHealthProjector.alerts(update.transitions, now: now())
        alerts = computed
        flapIds = FSMHealthProjector.flapIds(update.transitions)
        phase = FSMHealthProjector.resolvePhase(update.status, alerts: computed)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// alerts on screen and does not refetch.
    private func handleAutoRefresh(for connection: FSMHealthConnection) {
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

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryFSMHealthPanelSource: FSMHealthPanelSource {
    public var onUpdate: (@MainActor (FSMHealthPanelUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: FSMHealthPanelUpdate?

    public init(initial: FSMHealthPanelUpdate? = nil) {
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
    public func push(_ update: FSMHealthPanelUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension FSMHealthPanel {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        FSMHealthPanelSurface.slug
    }
}
