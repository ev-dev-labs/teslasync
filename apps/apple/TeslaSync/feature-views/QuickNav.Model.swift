//
//  QuickNav.Model.swift
//  TeslaSync — P4 feature view · 0129 · QuickNav (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the dashboard "Quick Navigation" surface. The view binds through
//  `QuickNavViewModel`; no networking lives in the view. SwiftUI parity of
//  features/dashboard/components/QuickNav.tsx.
//
//  The web component is purely presentational — its only hook is `useTranslation`
//  and it renders a static `NAV_ITEMS` catalog. The production source therefore
//  resolves straight to a live, loaded grid; the seam still exists so the surface
//  honors the P4 lifecycle (telemetry, refresh, loading / empty / error / stale /
//  offline) and so previews + tests can drive every state.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol QuickNavViewTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogQuickNavViewTelemetry: QuickNavViewTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "QuickNav" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time; the per-surface table
/// keeps each parallel surface prompt self-contained.
public enum QuickNavViewStrings {
    public static let table = "QuickNav"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `QuickNavCatalogSource`: the resolved shortcut
/// catalog + its load status + the live-state connection + the last-update instant.
/// The model turns this into the localized tile projection.
public struct QuickNavCatalogUpdate: Sendable, Equatable {
    public var status: QuickNavCatalogStatus
    public var shortcuts: [QuickNavShortcut]
    public var connection: QuickNavConnection
    public var updatedAt: Date?

    public init(
        status: QuickNavCatalogStatus = .loading,
        shortcuts: [QuickNavShortcut] = [],
        connection: QuickNavConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.shortcuts = shortcuts
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app uses `StaticQuickNavCatalogSource`
/// (the catalog is a module constant, exactly like the web `NAV_ITEMS`); previews and
/// tests use `InMemoryQuickNavCatalogSource`. The view never builds tiles itself nor
/// talks to the network.
@MainActor
public protocol QuickNavCatalogSource: AnyObject {
    var onUpdate: (@MainActor (QuickNavCatalogUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying resolve (the error-state retry / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `QuickNavCatalogSource`,
/// projects the localized `QuickNavTileModel`s, exposes a render `QuickNavPhase` +
/// connection for SwiftUI to switch over, and emits the `view.opened` diagnostics
/// event once on first appearance.
@MainActor
@Observable
public final class QuickNavViewModel {
    public private(set) var phase: QuickNavPhase = .loading
    public private(set) var connection: QuickNavConnection = .live
    public private(set) var items: [QuickNavTileModel] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any QuickNavCatalogSource
    @ObservationIgnored private let telemetry: any QuickNavViewTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any QuickNavCatalogSource,
        telemetry: any QuickNavViewTelemetry = OSLogQuickNavViewTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The grid container's VoiceOver label (P1/S10 facade).
    public var accessibilityLabel: String {
        QuickNavComponentAccessibility.gridLabel(localize: QuickNavViewStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: QuickNavSurface.slug)
        source.start()
    }

    /// Stops observing the upstream source.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying resolve — wired to the error-state retry + stale chip.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: QuickNavCatalogUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        items = QuickNavTileBuilder.build(shortcuts: update.shortcuts, localize: QuickNavViewStrings.string)
        phase = QuickNavProjection.resolvePhase(update.status, count: items.count)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached grid on screen and does not refetch.
    private func handleAutoRefresh(for connection: QuickNavConnection) {
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

// MARK: - Sources

/// The production source: publishes the canonical `QuickNavShortcut.catalog` (the
/// native analogue of the web `NAV_ITEMS` module constant). No networking — the
/// surface is presentational — so it resolves to a live, loaded grid immediately on
/// start / refresh.
@MainActor
public final class StaticQuickNavCatalogSource: QuickNavCatalogSource {
    public var onUpdate: (@MainActor (QuickNavCatalogUpdate) -> Void)?

    private let shortcuts: [QuickNavShortcut]
    private let clock: @MainActor () -> Date

    public init(
        shortcuts: [QuickNavShortcut] = QuickNavShortcut.catalog,
        clock: @escaping @MainActor () -> Date = { Date() }
    ) {
        self.shortcuts = shortcuts
        self.clock = clock
    }

    public func start() {
        publish()
    }

    public func stop() {}

    public func refresh() {
        publish()
    }

    private func publish() {
        onUpdate?(QuickNavCatalogUpdate(
            status: .loaded,
            shortcuts: shortcuts,
            connection: .live,
            updatedAt: clock()
        ))
    }
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryQuickNavCatalogSource: QuickNavCatalogSource {
    public var onUpdate: (@MainActor (QuickNavCatalogUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: QuickNavCatalogUpdate?

    public init(initial: QuickNavCatalogUpdate? = nil) {
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
    public func push(_ update: QuickNavCatalogUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension QuickNav {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        QuickNavSurface.slug
    }
}
