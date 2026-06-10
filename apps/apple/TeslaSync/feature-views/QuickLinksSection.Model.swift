//
//  QuickLinksSection.Model.swift
//  TeslaSync — P4 feature view · 0294 · QuickLinksSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the vehicle-detail "Quick Links" surface. The view binds through
//  `QuickLinksViewModel`; no networking lives in the view. SwiftUI parity of
//  features/vehicles/components/vehicle-detail/QuickLinksSection.tsx.
//
//  The web component is purely presentational — its only hook is `useTranslation` and
//  it renders a local `quickLinks` catalog. The production source therefore resolves
//  straight to a live, loaded grid; the seam still exists so the surface honors the P4
//  lifecycle (telemetry, refresh, loading / empty / error / stale / offline) and so
//  previews + tests can drive every state.
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
public protocol QuickLinksViewTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The
/// slug is a static, non-identifying constant logged verbatim; no payload, VIN, or
/// location is ever recorded.
public struct OSLogQuickLinksViewTelemetry: QuickLinksViewTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "QuickLinksSection" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; the per-surface
/// table keeps each parallel surface prompt self-contained.
public enum QuickLinksViewStrings {
    public static let table = "QuickLinksSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `QuickLinksCatalogSource`: the resolved link
/// catalog + its load status + the live-state connection + the last-update instant.
/// The model turns this into the localized tile projection.
public struct QuickLinksCatalogUpdate: Sendable, Equatable {
    public var status: QuickLinksCatalogStatus
    public var destinations: [QuickLinksDestination]
    public var connection: QuickLinksConnection
    public var updatedAt: Date?

    public init(
        status: QuickLinksCatalogStatus = .loading,
        destinations: [QuickLinksDestination] = [],
        connection: QuickLinksConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.destinations = destinations
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app uses
/// `StaticQuickLinksCatalogSource` (the catalog is a module constant, exactly like the
/// web `quickLinks` array); previews and tests use `InMemoryQuickLinksCatalogSource`.
/// The view never builds tiles itself nor talks to the network.
@MainActor
public protocol QuickLinksCatalogSource: AnyObject {
    var onUpdate: (@MainActor (QuickLinksCatalogUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying resolve (the error-state retry / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `QuickLinksCatalogSource`,
/// projects the localized `QuickLinksTileModel`s, exposes a render `QuickLinksPhase` +
/// connection for SwiftUI to switch over, and emits the `view.opened` diagnostics
/// event once on first appearance.
@MainActor
@Observable
public final class QuickLinksViewModel {
    public private(set) var phase: QuickLinksPhase = .loading
    public private(set) var connection: QuickLinksConnection = .live
    public private(set) var items: [QuickLinksTileModel] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any QuickLinksCatalogSource
    @ObservationIgnored private let telemetry: any QuickLinksViewTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any QuickLinksCatalogSource,
        telemetry: any QuickLinksViewTelemetry = OSLogQuickLinksViewTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The section container's VoiceOver label (P1/S10 facade).
    public var accessibilityLabel: String {
        QuickLinksAccessibility.sectionLabel(localize: QuickLinksViewStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: QuickLinksSurface.slug)
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

    private func apply(_ update: QuickLinksCatalogUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        items = QuickLinksTileBuilder.build(destinations: update.destinations, localize: QuickLinksViewStrings.string)
        phase = QuickLinksProjection.resolvePhase(update.status, count: items.count)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached grid on screen and does not refetch.
    private func handleAutoRefresh(for connection: QuickLinksConnection) {
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

/// The production source: publishes the canonical `QuickLinksDestination.catalog` (the
/// native analogue of the web `quickLinks` array). No networking — the surface is
/// presentational — so it resolves to a live, loaded grid immediately on start /
/// refresh.
@MainActor
public final class StaticQuickLinksCatalogSource: QuickLinksCatalogSource {
    public var onUpdate: (@MainActor (QuickLinksCatalogUpdate) -> Void)?

    private let destinations: [QuickLinksDestination]
    private let clock: @MainActor () -> Date

    public init(
        destinations: [QuickLinksDestination] = QuickLinksDestination.catalog,
        clock: @escaping @MainActor () -> Date = { Date() }
    ) {
        self.destinations = destinations
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
        onUpdate?(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: destinations,
            connection: .live,
            updatedAt: clock()
        ))
    }
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryQuickLinksCatalogSource: QuickLinksCatalogSource {
    public var onUpdate: (@MainActor (QuickLinksCatalogUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: QuickLinksCatalogUpdate?

    public init(initial: QuickLinksCatalogUpdate? = nil) {
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
    public func push(_ update: QuickLinksCatalogUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension QuickLinksSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        QuickLinksSurface.slug
    }
}
