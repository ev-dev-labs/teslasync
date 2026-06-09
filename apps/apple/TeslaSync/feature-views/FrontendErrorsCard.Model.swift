//
//  FrontendErrorsCard.Model.swift
//  TeslaSync — P4 feature view · 0243 · FrontendErrorsCard (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  last-hour frontend-errors summary card. The view binds through `FrontendErrorsModel`; no
//  networking lives in the view. The web source reads one TanStack query (`useWebErrorsSummary` →
//  `GET /admin/web-errors/summary`), so the input snapshot here carries that row (plus the query
//  loading / error state and the live-state connectivity axis) rather than issuing HTTP itself.
//
//  States (every one renders — no hidden surface): loading (skeleton chrome), empty (healthy "no
//  errors" summary, never blank), error (retryable "unable to load"), data (total + offender list).
//  The orthogonal connection axis (live / stale / offline) drives a freshness chip + banner with a
//  one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold
/// no hardcoded prose. Keys live in the "FrontendErrorsCard" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. In tests / preview bundles (where the table
/// is absent) `NSLocalizedString` returns the `value:` fallback, keeping the projection deterministic.
public enum FrontendErrorsStrings {
    public static let table = "FrontendErrorsCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-templated key and substitutes the positional arguments. The template is
    /// localized first, so translators control word order around the (locale-formatted) numbers.
    public static func format(_ key: String, _ fallback: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallback), arguments: args)
    }
}

// MARK: - View-model value types (web list rows)

/// One resolved top-offender row — the native mirror of the web list item. `name` / `route` are
/// already em-dash-fallback-resolved and `count` is already locale-formatted, so the view is a pure
/// function of this value.
public struct FrontendErrorsOffender: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let route: String
    public let count: String

    public init(id: String, name: String, route: String, count: String) {
        self.id = id
        self.name = name
        self.route = route
        self.count = count
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the header chip +
/// banner. `live` hides the banner; `stale` / `offline` show it.
public enum FrontendErrorsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol FrontendErrorsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
/// The slug is a static, non-identifying constant.
public struct OSLogFrontendErrorsTelemetry: FrontendErrorsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web hook: useWebErrorsSummary + query state + connectivity)

/// One coalesced snapshot of the card's inputs — the native mirror of the summary query
/// (`useWebErrorsSummary`, plus its `isLoading` / `errorMessage`) and the live-state connectivity.
/// `summary == nil` reproduces the web `!data` branch.
public struct FrontendErrorsInput: Sendable, Equatable {
    public var summary: FrontendErrorsSummary?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: FrontendErrorsConnection

    public init(
        summary: FrontendErrorsSummary? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: FrontendErrorsConnection = .live
    ) {
        self.summary = summary
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the card's render branches. `phase` selects
/// the body; `totalText` (the formatted headline) and `offenders` are pre-localized + pre-formatted
/// so the view is a pure function of this value.
public struct FrontendErrorsResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Web `isLoading` (no data yet) → skeleton chrome.
        case loading
        /// P4 leaf mapping of web `!data` → a retryable "unable to load" surface.
        case error(String)
        /// Web data present with `top.length === 0` → the healthy "no errors" summary (header +
        /// headline total + friendly message). Never a blank box.
        case empty
        /// Web data present with `top.length > 0` → the header + headline total + offender list.
        case data
    }

    public let phase: Phase
    public let totalText: String
    public let offenders: [FrontendErrorsOffender]

    public init(phase: Phase, totalText: String = "", offenders: [FrontendErrorsOffender] = []) {
        self.phase = phase
        self.totalText = totalText
        self.offenders = offenders
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the web-errors query
/// holder composed with the live-state holder; previews and tests use
/// `InMemoryFrontendErrorsSource`. The view never talks to the network.
@MainActor
public protocol FrontendErrorsSource: AnyObject {
    var onUpdate: (@MainActor (FrontendErrorsInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The card's observable view-model. Subscribes to a `FrontendErrorsSource`, recomputes the resolved
/// projection, exposes the render `phase` + the resolved sections + the `connection` axis, emits
/// `view.opened` once on first presentation, and auto-refreshes once when the feed transitions to
/// stale.
@MainActor
@Observable
public final class FrontendErrorsModel {
    public private(set) var resolved: FrontendErrorsResolved =
        FrontendErrorsProjection.resolve(FrontendErrorsInput(isLoading: true))
    public private(set) var connection: FrontendErrorsConnection = .live

    public var phase: FrontendErrorsResolved.Phase {
        resolved.phase
    }

    public var totalText: String {
        resolved.totalText
    }

    public var offenders: [FrontendErrorsOffender] {
        resolved.offenders
    }

    @ObservationIgnored private let source: any FrontendErrorsSource
    @ObservationIgnored private let telemetry: any FrontendErrorsTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any FrontendErrorsSource,
        telemetry: any FrontendErrorsTelemetry = OSLogFrontendErrorsTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the upstream feed. Idempotent. `view.opened` is emitted on the first applied
    /// snapshot so the event fires exactly once the surface is actually presented.
    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: FrontendErrorsInput) {
        resolved = FrontendErrorsProjection.resolve(input, locale: locale)
        connection = input.connection
        maybeEmitOpen()
        handleAutoRefresh(for: input.connection)
    }

    /// Emits `view.opened` exactly once, on the first applied snapshot.
    private func maybeEmitOpen() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: FrontendErrorsCard.surfaceSlug)
    }

    /// Stale → one guarded auto-refresh of the summary query (prompt "stale chip + auto-refresh");
    /// reset once live so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: FrontendErrorsConnection) {
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

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryFrontendErrorsSource: FrontendErrorsSource {
    public var onUpdate: (@MainActor (FrontendErrorsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: FrontendErrorsInput?

    public init(initial: FrontendErrorsInput? = nil) {
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
    public func push(_ input: FrontendErrorsInput) {
        onUpdate?(input)
    }
}
