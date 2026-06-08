//
//  BackendTool.Model.swift
//  TeslaSync — P4 feature view · 0002 · BackendTool (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for
//  the BackendTool surface — the SwiftUI parity of the web
//  features/admin/components/devtools/BackendTool.tsx `useMutation` driver. The
//  view binds through `BackendToolModel`; no networking lives in the view.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable telemetry slug for the diagnostics `view.opened` event. Kept on a
/// non-generic type so the model can reference it without the view's generic
/// `Extra` parameter.
public enum BackendToolSurface {
    public static let slug = "BackendTool"
}

// MARK: - HTTP method (web `method?: 'GET' | 'POST' | 'DELETE'`)

/// The dev-tool request verb, mirroring the web `BackendToolProps['method']`.
public enum BackendToolMethod: String, Sendable, Equatable, CaseIterable {
    case get = "GET"
    case post = "POST"
    case delete = "DELETE"

    /// Semantic tone used to tint the method chip (read intent at a glance).
    public var tone: TSTone {
        switch self {
        case .get: .info
        case .post: .success
        case .delete: .danger
        }
    }
}

// MARK: - Run outcome (the seam's result; web `apiFetch` resolved value)

/// The result of invoking a dev-tool endpoint, mirroring the shapes the web
/// `apiFetch` collapses to: a JSON success body, a server/validation error string
/// (web `{ error }`), and the transport failure the native app surfaces as an
/// `offline` outcome so the last successful body can stay on screen behind an
/// offline chip rather than being blanked.
public enum BackendToolRunOutcome: Sendable, Equatable {
    case success(json: String)
    case failure(message: String)
    case offline(message: String)
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the diagnostics `view.opened` event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared
/// core diagnostics pipeline (consent-gated + redacted there).
public protocol BackendToolTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogBackendToolTelemetry: BackendToolTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer; never HTTP from the view)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 dev-tools mutation holder (which calls `POST /dev-tools/{endpoint}`
/// via the shared networking client); previews and tests inject
/// `InMemoryBackendToolRunner`. The view never performs I/O itself.
@MainActor
public protocol BackendToolRunner: AnyObject {
    var onOutcome: (@MainActor (BackendToolRunOutcome) -> Void)? { get set }
    func run()
}

// MARK: - View model

/// The surface's observable view-model. Drives the run lifecycle (web `useMutation`
/// status), keeps the last result visible as `cached`, and layers freshness
/// (stale / offline) on top so SwiftUI can render every state from the web source.
@MainActor
@Observable
public final class BackendToolModel {
    /// The run lifecycle, mirroring the web mutation status.
    public enum Phase: Equatable, Sendable {
        case idle
        case running
        case success
        case failure
    }

    public private(set) var phase: Phase = .idle
    public private(set) var result: BackendToolResult?
    public private(set) var lastRunAt: Date?
    public private(set) var isOffline = false

    @ObservationIgnored private let runner: any BackendToolRunner
    @ObservationIgnored private let telemetry: any BackendToolTelemetry
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let stalenessWindow: TimeInterval
    @ObservationIgnored private var didEmitOpen = false

    public init(
        runner: any BackendToolRunner,
        telemetry: any BackendToolTelemetry = OSLogBackendToolTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() },
        stalenessWindow: TimeInterval = 30
    ) {
        self.runner = runner
        self.telemetry = telemetry
        self.now = now
        self.stalenessWindow = stalenessWindow
        runner.onOutcome = { [weak self] outcome in self?.apply(outcome) }
    }

    /// Whether the displayed body is older than the freshness window. Only a
    /// successful result can go stale (an error is never "fresh data").
    public var isStale: Bool {
        guard phase == .success, let lastRunAt else { return false }
        return now().timeIntervalSince(lastRunAt) > stalenessWindow
    }

    /// Freshness/connectivity projection (mirrors `LiveConnectionState`, ADR-013).
    public var connection: BackendToolConnection {
        if isOffline { return .offline }
        if isStale { return .stale }
        return .live
    }

    /// Whether the run-status badge is shown (web `mutation.data && <Badge/>`).
    public var showsStatusBadge: Bool {
        phase == .success || phase == .failure
    }

    /// Emits the diagnostics `view.opened` event once. Idempotent.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: BackendToolSurface.slug)
    }

    /// Triggers a run (web `mutation.mutate()`); the outcome arrives via the seam.
    /// Re-entrancy is guarded so a double-tap cannot fan out two requests.
    public func run() {
        guard phase != .running else { return }
        phase = .running
        runner.run()
    }

    private func apply(_ outcome: BackendToolRunOutcome) {
        let at = now()
        lastRunAt = at
        switch outcome {
        case let .success(json):
            result = BackendToolResult(json: BackendToolJSON.prettyPrinted(json), error: nil, completedAt: at)
            phase = .success
            isOffline = false
        case let .failure(message):
            result = BackendToolResult(json: nil, error: message, completedAt: at)
            phase = .failure
            isOffline = false
        case let .offline(message):
            isOffline = true
            if let cached = result, cached.hasData {
                // Keep the last successful body visible behind the offline chip.
                phase = .success
            } else {
                result = BackendToolResult(json: nil, error: message, completedAt: at)
                phase = .failure
            }
        }
    }
}

// MARK: - In-memory runner (previews + tests; the view never performs I/O)

/// Deterministic runner for previews and unit/UI tests. Constructed with a canned
/// outcome (delivered synchronously on `run()` when `autoResponds`), or driven
/// manually via `push(_:)` to script multi-step flows (e.g. success → offline).
@MainActor
public final class InMemoryBackendToolRunner: BackendToolRunner {
    public var onOutcome: (@MainActor (BackendToolRunOutcome) -> Void)?
    public private(set) var runCount = 0

    private let outcome: BackendToolRunOutcome?
    private let autoResponds: Bool

    public init(outcome: BackendToolRunOutcome? = nil, autoResponds: Bool = true) {
        self.outcome = outcome
        self.autoResponds = autoResponds
    }

    public func run() {
        runCount += 1
        if autoResponds, let outcome {
            onOutcome?(outcome)
        }
    }

    /// Delivers an outcome to the bound model (deterministic test/preview affordance).
    public func push(_ outcome: BackendToolRunOutcome) {
        onOutcome?(outcome)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "BackendTool" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time. The web source
/// keys `Run` / `Failed` / `Success` are preserved verbatim so a shared catalog
/// resolves identically across web and native.
public enum BackendToolStrings {
    public static let table = "BackendTool"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
