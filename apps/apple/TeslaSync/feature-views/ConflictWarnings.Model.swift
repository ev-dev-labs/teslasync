//
//  ConflictWarnings.Model.swift
//  TeslaSync — P4 feature view · 0084 · ConflictWarnings (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and
//  the i18n facade (P1/S10). The view binds through `ConflictWarningsModel`; no
//  networking lives in the view.
//
//  The web component is a pure presentational leaf — its parent
//  (AutomationBuilderPage) computes `conflicts` from a validation request and
//  passes the array down, rendering the leaf only while `conflicts.length > 0`.
//  The native surface owns the full P4 states contract around that parent
//  query, so the source snapshot carries the query phase (loading / loaded /
//  failed) plus the freshness + connectivity flags that drive the stale +
//  offline chrome. The empty case is the native, never-a-blank-box treatment of
//  the web `if (conflicts.length === 0) return null`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter forwarding to the
/// shared core `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated
/// and redacted there.
public protocol ConflictWarningsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`
/// event.
public struct OSLogConflictWarningsTelemetry: ConflictWarningsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Parent query lifecycle (web AutomationBuilderPage conflict detection)

/// The load lifecycle of the parent's conflict-detection request, mirrored as
/// the source of truth the native surface renders around. `loaded([])` is the
/// healthy "no conflicts" outcome (web `conflicts.length === 0`).
public enum ConflictWarningsPhase: Sendable, Equatable {
    case loading
    case loaded([AutomationConflict])
    case failed
}

/// The resolved render branch the SwiftUI surface switches over. `empty` is the
/// native treatment of the web `return null`; `conflicts` carries the projected,
/// display-ready rows.
public enum ConflictWarningsRender: Sendable, Equatable {
    case loading
    case failed
    case empty
    case conflicts([ConflictWarningRow])
}

// MARK: - Input snapshot (web parent props + query meta)

/// One coalesced snapshot of the surface inputs — the parent's conflict-query
/// phase plus the freshness + connectivity flags. The production source composes
/// this from the builder's validation query; previews/tests construct it directly.
public struct ConflictWarningsInput: Sendable, Equatable {
    public var phase: ConflictWarningsPhase
    public var isStale: Bool
    public var isOffline: Bool

    public init(
        phase: ConflictWarningsPhase,
        isStale: Bool = false,
        isOffline: Bool = false
    ) {
        self.phase = phase
        self.isStale = isStale
        self.isOffline = isOffline
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// builder's conflict-detection query; previews + tests use
/// `InMemoryConflictWarningsSource`. The view never talks to the network directly.
@MainActor
public protocol ConflictWarningsSource: AnyObject {
    var onUpdate: (@MainActor (ConflictWarningsInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-requests the conflict-detection query (wired to retry + stale auto-refresh).
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `ConflictWarningsSource`,
/// recomputes the resolved render branch + the stale/offline chrome flags, and
/// exposes them for SwiftUI to switch over. Auto-refreshes once on each rising
/// edge into the stale state (the P4 "stale chip + auto-refresh" contract).
@MainActor
@Observable
public final class ConflictWarningsModel {
    public private(set) var render: ConflictWarningsRender = .loading
    public private(set) var isStale = false
    public private(set) var isOffline = false

    @ObservationIgnored private let source: any ConflictWarningsSource
    @ObservationIgnored private let telemetry: any ConflictWarningsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var wasStale = false

    public init(
        source: any ConflictWarningsSource,
        telemetry: any ConflictWarningsTelemetry = OSLogConflictWarningsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ConflictWarnings.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the conflict-detection query (wired to the retry affordance).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: ConflictWarningsInput) {
        render = Self.render(for: input.phase)
        isStale = input.isStale
        isOffline = input.isOffline
        if input.isStale, !wasStale {
            source.refresh()
        }
        wasStale = input.isStale
    }

    /// Resolves the render branch from the parent-query phase (web
    /// `conflicts.length === 0 ? null : list`, extended with loading/error).
    nonisolated static func render(for phase: ConflictWarningsPhase) -> ConflictWarningsRender {
        switch phase {
        case .loading:
            .loading
        case .failed:
            .failed
        case let .loaded(conflicts):
            conflicts.isEmpty
                ? .empty
                : .conflicts(ConflictWarningsProjection.rows(from: conflicts))
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryConflictWarningsSource: ConflictWarningsSource {
    public var onUpdate: (@MainActor (ConflictWarningsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ConflictWarningsInput?

    public init(initial: ConflictWarningsInput? = nil) {
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
    public func push(_ input: ConflictWarningsInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ConflictWarnings" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum CWStrings {
    public static let table = "ConflictWarnings"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
