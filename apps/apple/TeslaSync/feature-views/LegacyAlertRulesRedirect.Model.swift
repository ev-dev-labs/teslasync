//
//  LegacyAlertRulesRedirect.Model.swift
//  TeslaSync — P4 feature view · 0184 · LegacyAlertRulesRedirect (Apple)
//
//  State-holder seam (P1/S8) + navigation seam + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the legacy Alert Rules redirect. The view binds through `LegacyAlertRulesRedirectModel`;
//  no routing or networking lives in the view. SwiftUI parity of
//  features/notifications/components/LegacyAlertRulesRedirect.tsx.
//
//  The web component reads `useLocation()` and immediately renders `<Navigate replace />`. The native
//  model owns that lifecycle: it observes the bound source for the inbound location, resolves the target
//  via `LegacyAlertRulesRedirectResolver`, fires the injected `onRedirect` navigation seam exactly once
//  (the automatic replace), exposes a manual Continue + an empty-state parent fallback, applies the
//  live-state freshness envelope, and emits `view.opened` once on first appearance.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), which is consent-gated and redacted there.
public protocol LegacyAlertRulesRedirectTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogLegacyAlertRulesRedirectTelemetry: LegacyAlertRulesRedirectTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the view holds no hardcoded
/// literals. The web source is anonymous (it renders nothing), so every key here backs native chrome;
/// they live in the "LegacyAlertRulesRedirect" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time, keeping each parallel surface prompt self-contained.
public enum LegacyAlertRulesRedirectStrings {
    public static let table = "LegacyAlertRulesRedirect"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// SwiftUI `Text` from the catalog (the view holds no English literals).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves the projection's injected, pre-localized copy from the catalog.
    public static func copy() -> LegacyAlertRulesRedirectCopy {
        LegacyAlertRulesRedirectCopy(
            destinationName: string("legacyAlertRulesRedirect.destination", "Alert Rules"),
            parentName: string("legacyAlertRulesRedirect.parent", "Notifications")
        )
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `LegacyAlertRulesRedirectSource`: the inbound-location load
/// status (web `useLocation` availability), the live-state connection, and the last-update timestamp.
public struct LegacyAlertRulesRedirectUpdate: Sendable, Equatable {
    public var status: AlertRulesRedirectLoadStatus
    public var connection: AlertRulesRedirectConnection
    public var updatedAt: Date?

    public init(
        status: AlertRulesRedirectLoadStatus = .idle,
        connection: AlertRulesRedirectConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders — wiring it to the host's current route location (the native analog of `useLocation`).
/// Previews + tests use `InMemoryLegacyAlertRulesRedirectSource`. The view never reads the router or
/// the network directly.
@MainActor
public protocol LegacyAlertRulesRedirectSource: AnyObject {
    var onUpdate: (@MainActor (LegacyAlertRulesRedirectUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-reads the inbound location (the error-state retry / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Observes the bound source for the inbound location, resolves the
/// navigation target, fires the injected `onRedirect` seam exactly once (web automatic `<Navigate
/// replace>`), exposes a manual Continue + an empty-state parent fallback + an error retry, applies the
/// freshness envelope, and emits the `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class LegacyAlertRulesRedirectModel {
    public private(set) var phase: AlertRulesRedirectPhase = .redirecting
    public private(set) var connection: AlertRulesRedirectConnection = .live
    /// The resolved navigation target, or `nil` while resolving / unavailable / failed.
    public private(set) var destination: AlertRulesRedirectDestination?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any LegacyAlertRulesRedirectSource
    @ObservationIgnored private let telemetry: any LegacyAlertRulesRedirectTelemetry
    @ObservationIgnored private let copy: LegacyAlertRulesRedirectCopy
    @ObservationIgnored private let onRedirect: @MainActor (AlertRulesRedirectDestination) -> Void
    @ObservationIgnored private var latestStatus: AlertRulesRedirectLoadStatus = .idle
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRedirect = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any LegacyAlertRulesRedirectSource,
        telemetry: any LegacyAlertRulesRedirectTelemetry = OSLogLegacyAlertRulesRedirectTelemetry(),
        copy: LegacyAlertRulesRedirectCopy = LegacyAlertRulesRedirectStrings.copy(),
        onRedirect: @escaping @MainActor (AlertRulesRedirectDestination) -> Void = { _ in }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.copy = copy
        self.onRedirect = onRedirect
        source.onUpdate = { [weak self] update in self?.apply(update) }
        recompute()
    }

    /// The destination's human name for the chrome (web has none — anonymous surface).
    public var destinationName: String {
        copy.destinationName
    }

    /// The view-ready breadcrumb for the resolved target (parent › destination + forwarded-param count).
    public var breadcrumb: AlertRulesRedirectBreadcrumb {
        AlertRulesRedirectBreadcrumb.make(copy: copy, destination: destination)
    }

    /// The spoken status of the surface for the current phase.
    public var accessibilitySummary: String {
        LegacyAlertRulesRedirectAccessibility.summary(
            for: phase,
            destination: copy.destinationName,
            localize: LegacyAlertRulesRedirectStrings.string
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent. Fires the automatic
    /// redirect immediately when the source has already resolved a target (web mount → `<Navigate>`).
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LegacyAlertRulesRedirectSurface.slug)
        source.start()
        dispatchIfReady()
    }

    /// Stops observing.
    public func stop() {
        started = false
        source.stop()
    }

    /// The manual Continue affordance: re-issues the navigation to the resolved target. A `replace` to
    /// the same destination is idempotent at the router, so this is safe when the host deferred the
    /// automatic redirect. No-op until a target has resolved.
    public func confirm() {
        guard let destination else { return }
        onRedirect(destination)
    }

    /// The empty-state fallback: navigates to the target's safe parent (`/notifications`) when the host
    /// supplied no inbound location, so the surface is never a dead end.
    public func goToParent() {
        onRedirect(LegacyAlertRulesRedirectResolver.parentDestination())
    }

    /// The error-state retry: re-reads the inbound location through the bound source.
    public func retry() {
        source.refresh()
    }

    private func apply(_ update: LegacyAlertRulesRedirectUpdate) {
        latestStatus = update.status
        connection = update.connection
        updatedAt = update.updatedAt
        recompute()
        dispatchIfReady()
        handleAutoRefresh(for: update.connection)
    }

    private func recompute() {
        destination = LegacyAlertRulesRedirectResolver.destination(for: latestStatus)
        phase = LegacyAlertRulesRedirectResolver.resolvePhase(latestStatus)
    }

    /// Fires the automatic redirect exactly once, the first time a target is available after `start()`
    /// (web `<Navigate replace>` on render). Guarded so a later snapshot never re-navigates.
    private func dispatchIfReady() {
        guard started, !didAutoRedirect, let destination else { return }
        didAutoRedirect = true
        onRedirect(destination)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the resolved target and does not refetch —
    /// the redirect is a local route change.
    private func handleAutoRefresh(for connection: AlertRulesRedirectConnection) {
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

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()`, records
/// the lifecycle counts, and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryLegacyAlertRulesRedirectSource: LegacyAlertRulesRedirectSource {
    public var onUpdate: (@MainActor (LegacyAlertRulesRedirectUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LegacyAlertRulesRedirectUpdate?

    public init(initial: LegacyAlertRulesRedirectUpdate? = nil) {
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
    public func push(_ update: LegacyAlertRulesRedirectUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension LegacyAlertRulesRedirect {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        LegacyAlertRulesRedirectSurface.slug
    }
}
