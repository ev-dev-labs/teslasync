//
//  QuickNavWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0075 · QuickNavWidget (Apple)
//
//  The registry + telemetry + state-holder + i18n seams for the Quick Navigation
//  surface. The view binds through `QuickNavModel`; it never builds its own items
//  or talks to a store. Because the web `QuickNav` is purely presentational (no
//  query/hook), the production source publishes the static catalog; the seam still
//  exists so the surface honors the dashboard widget contract (telemetry, refresh,
//  loading/empty/error) and so previews/tests can drive every state.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Dashboard-widget registry primitives (web `WidgetSize` / `WidgetDef`)

//
// `DashboardWidgetSize` and `DashboardWidgetRegistration` are owned by the first
// dashboard-widget surface (0036 DigitalTwinWidget) and are REUSED here — never
// redeclared — so the per-surface bundles share one definition with no duplicate
// symbols when they compile together in the app module. The 0054 GuardModeWidget
// surface follows the same convention.

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared diagnostics boundary (consent-gated + redacted there).
public protocol QuickNavTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogQuickNavTelemetry: QuickNavTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's catalog. The web source has no async fetch,
/// so the production source resolves straight to `.loaded`; the cases exist so the
/// widget honors the dashboard loading/empty/error contract and tests can drive them.
public enum QuickNavLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// One coalesced snapshot from a `QuickNavSource`: the resolved shortcut catalog +
/// its load status. The model turns this into the localized item projection.
public struct QuickNavUpdate: Sendable, Equatable {
    public var status: QuickNavLoadStatus
    public var destinations: [QuickNavDestination]
    public var updatedAt: Date?

    public init(
        status: QuickNavLoadStatus = .loading,
        destinations: [QuickNavDestination] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.destinations = destinations
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app uses `StaticQuickNavSource`
/// (the catalog is a module constant, exactly like the web `NAV_ITEMS`); previews
/// and tests use `InMemoryQuickNavSource`. The view never builds items itself.
@MainActor
public protocol QuickNavSource: AnyObject {
    var onUpdate: (@MainActor (QuickNavUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `QuickNavSource`, projects
/// the localized `QuickNavItem`s, and exposes a render `Phase` for SwiftUI to switch
/// over. Emits the P1/S11 `view.opened` event on first start.
@MainActor
@Observable
public final class QuickNavModel {
    /// The mutually-exclusive render branches (web shell loading / content / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var items: [QuickNavItem] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any QuickNavSource
    @ObservationIgnored private let telemetry: any QuickNavTelemetry
    @ObservationIgnored private var started = false

    public init(source: any QuickNavSource, telemetry: any QuickNavTelemetry = OSLogQuickNavTelemetry()) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: QuickNavWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached items stay visible). Wired to the error retry.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: QuickNavUpdate) {
        updatedAt = update.updatedAt
        items = QuickNavItemBuilder.build(destinations: update.destinations, localize: QuickNavStrings.string)
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. Cached items keep the grid visible behind a
    /// refresh/error (web freshness intent); the empty state shows only when the
    /// resolved catalog is genuinely empty.
    public static func resolvePhase(_ update: QuickNavUpdate) -> Phase {
        let hasItems = !update.destinations.isEmpty
        switch update.status {
        case .loading:
            return hasItems ? .content : .loading
        case .loaded:
            return hasItems ? .content : .empty
        case .empty:
            return .empty
        case let .failed(message):
            return hasItems ? .content : .error(message)
        }
    }
}

// MARK: - Sources

/// The production source: publishes the canonical `QuickNavCatalog` (the native
/// analogue of the web `NAV_ITEMS` module constant). No networking — the surface is
/// presentational — so it resolves to `.loaded` immediately on start/refresh.
@MainActor
public final class StaticQuickNavSource: QuickNavSource {
    public var onUpdate: (@MainActor (QuickNavUpdate) -> Void)?

    private let destinations: [QuickNavDestination]

    public init(destinations: [QuickNavDestination] = QuickNavCatalog.all) {
        self.destinations = destinations
    }

    public func start() {
        publish()
    }

    public func stop() {}

    public func refresh() {
        publish()
    }

    private func publish() {
        onUpdate?(QuickNavUpdate(status: .loaded, destinations: destinations, updatedAt: Date()))
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryQuickNavSource: QuickNavSource {
    public var onUpdate: (@MainActor (QuickNavUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: QuickNavUpdate?

    public init(initial: QuickNavUpdate? = nil) {
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
    public func push(_ update: QuickNavUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "QuickNavWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum QuickNavStrings {
    public static let table = "QuickNavWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
