//
//  VehicleConfigSection.Model.swift
//  TeslaSync — P4 feature view · 0300 · VehicleConfigSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10)
//  for the vehicle-detail "Vehicle Configuration" surface. The view binds through
//  `VehicleConfigSectionModel`; no networking lives in the view. SwiftUI parity of
//  web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx.
//
//  The web component receives `vehicleConfig: VehicleConfigSnapshot | null | undefined` and
//  `softwareVersion: string | undefined` as props from the parent vehicle-detail page, which
//  owns the `isLoading` / error / freshness lifecycle. The native surface reproduces that
//  whole lifecycle through a `VehicleConfigSectionSource` so every prompt-required state
//  (loading / empty / error / stale / offline / content) renders here.
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
public protocol VCSectionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogVCSectionTelemetry: VCSectionTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "VehicleConfigSection" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; the per-surface table keeps each
/// parallel surface prompt self-contained.
public enum VCSectionStrings {
    public static let table = "VehicleConfigSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `VehicleConfigSectionSource`: the configuration reading
/// (or `nil` when none is available) + its load status + the live-state connection.
public struct VCSectionUpdate: Sendable, Equatable {
    public var status: VCSectionLoadStatus
    public var snapshot: VCSectionSnapshot?
    public var connection: VCSectionConnection

    public init(
        status: VCSectionLoadStatus = .loading,
        snapshot: VCSectionSnapshot? = nil,
        connection: VCSectionConnection = .live
    ) {
        self.status = status
        self.snapshot = snapshot
        self.connection = connection
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders — composing the vehicle-configuration query the web page reads and mapping
/// its snapshot into a `VCSectionSnapshot`. Previews + tests use
/// `InMemoryVehicleConfigSectionSource`. The view never talks to the network directly.
@MainActor
public protocol VehicleConfigSectionSource: AnyObject {
    var onUpdate: (@MainActor (VCSectionUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `VehicleConfigSectionSource`,
/// projects each snapshot into the view-ready `VCSectionProjection`, exposes a render
/// `VCSectionPhase` + freshness for SwiftUI to switch over, and emits the `view.opened`
/// diagnostics event once on first appearance.
@MainActor
@Observable
public final class VehicleConfigSectionModel {
    public private(set) var phase: VCSectionPhase = .loading
    public private(set) var connection: VCSectionConnection = .live
    public private(set) var projection: VCSectionProjection = .empty

    @ObservationIgnored private let source: any VehicleConfigSectionSource
    @ObservationIgnored private let telemetry: any VCSectionTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any VehicleConfigSectionSource,
        telemetry: any VCSectionTelemetry = OSLogVCSectionTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The combined VoiceOver summary for the panel.
    public var accessibilitySummary: String {
        VCSectionAccessibility.summary(projection: projection, localize: VCSectionStrings.string)
    }

    /// The localized `Yes`/`No`/`—` literals the value ternaries need, resolved from the
    /// P1/S10 facade so the pure projector stays bundle-free.
    private var valueStrings: VCSectionValueStrings {
        VCSectionValueStrings(
            yes: VCSectionStrings.string("common.yes", "Yes"),
            no: VCSectionStrings.string("common.no", "No"),
            dash: VCSectionStrings.string("configSection.noValue", "—")
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VCSectionSurface.slug)
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

    private func apply(_ update: VCSectionUpdate) {
        connection = update.connection
        projection = VCSectionProjector.project(snapshot: update.snapshot, strings: valueStrings)
        phase = VCSectionProjector.resolvePhase(update.status, hasContent: projection.hasContent)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live
    /// so a later stale episode re-triggers exactly once. Offline keeps the cached rows on
    /// screen and does not refetch.
    private func handleAutoRefresh(for connection: VCSectionConnection) {
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
public final class InMemoryVehicleConfigSectionSource: VehicleConfigSectionSource {
    public var onUpdate: (@MainActor (VCSectionUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VCSectionUpdate?

    public init(initial: VCSectionUpdate? = nil) {
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
    public func push(_ update: VCSectionUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension VehicleConfigSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        VCSectionSurface.slug
    }
}
