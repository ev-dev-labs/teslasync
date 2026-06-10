//
//  VehicleCharts.Model.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  The state-holder seams the surface binds through: the surface identity + P1/S11
//  telemetry contract (`view.opened`), the P1/S8 source that pushes the resolved
//  slice (state + positions + config + preferences) with freshness, the
//  `@Observable` view-model that resolves the render phase and memoises the
//  projection, and the P1/S10 i18n facade (web `useTranslation`). Previews/tests
//  drive the model with the in-memory source; production wires a source over the
//  shared vehicle state holders. No networking lives in the view.
//

import Foundation
import Observation

// MARK: - Surface identity

/// Stable, non-identifying identity for the `VehicleCharts` feature view. The slug
/// is emitted with the P1/S11 `view.opened` contract and is shared by the view +
/// its tests so the two never drift. Kept Foundation-side so the model + tests
/// build without a rendering host.
public enum VehicleChartsSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "VehicleCharts"

    /// Reports the surface becoming visible — the exact path the view runs on
    /// appear, factored out so it is unit-testable without a host.
    public static func reportOpen(to telemetry: any VehicleChartsTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - State-holder seam (P1/S8)

/// The load lifecycle for the slice, mirroring the shared `LoadableState` a
/// production source projects from the vehicle `Resource<T>`s.
public enum VehicleChartsStatus: Equatable, Sendable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013): `live`, `stale` (older than the freshness
/// window), `offline` (no connectivity — cached value shown). Drives the chip.
public enum VehicleChartsConnection: Equatable, Sendable {
    case live
    case stale
    case offline

    /// Whether the slice is a fresh live read.
    public var isLive: Bool {
        self == .live
    }
}

/// One coalesced snapshot pushed by a source: the resolved slice and the
/// load/connection status. The model turns this into the render phase + projection.
public struct VehicleChartsUpdate: Equatable, Sendable {
    public var status: VehicleChartsStatus
    public var connection: VehicleChartsConnection
    public var data: VehicleChartsData
    public var updatedAt: Date?

    public init(
        status: VehicleChartsStatus = .loading,
        connection: VehicleChartsConnection = .live,
        data: VehicleChartsData = .empty,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.data = data
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared
/// P1/S8 vehicle state holders (the `useVehicleState` / `useLocations` /
/// `useVehicleSystems` slices the web page feeds these props from); previews/tests
/// use the in-memory source. The view never talks to the network directly.
@MainActor
public protocol VehicleChartsSource: AnyObject {
    var onUpdate: (@MainActor (VehicleChartsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - View-model

/// The surface's observable view-model. Subscribes to a source, holds the latest
/// slice + freshness, exposes a render `Phase`, and memoises the projection for
/// SwiftUI to render.
@MainActor
@Observable
public final class VehicleChartsModel {
    /// The mutually-exclusive render branches. `loaded` renders the composite;
    /// `empty` is a friendly no-content fallback; `loading` is the initial fetch;
    /// `error` is a hard failure with nothing cached to fall back to.
    public enum Phase: Equatable {
        case loading
        case error(String)
        case empty
        case loaded
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: VehicleChartsConnection = .live
    public private(set) var data: VehicleChartsData = .empty
    public private(set) var projection = VehicleChartsProjection()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any VehicleChartsSource
    @ObservationIgnored private let telemetry: any VehicleChartsTelemetry
    @ObservationIgnored let formatting: any VehicleChartsFormatting
    @ObservationIgnored let units: any VehicleChartsUnits
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false

    public init(
        source: any VehicleChartsSource,
        telemetry: any VehicleChartsTelemetry = OSLogVehicleChartsTelemetry(),
        formatting: any VehicleChartsFormatting = DefaultVehicleChartsFormatting(),
        units: any VehicleChartsUnits = DefaultVehicleChartsUnits(),
        localize: @escaping (String, String) -> String = VehicleChartsStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.units = units
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        VehicleChartsSurface.reportOpen(to: telemetry)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (any cached slice stays visible). Wired to retry/refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: VehicleChartsUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        switch update.status {
        case .loaded, .empty:
            data = update.data
        case .loading, .failed:
            if update.data != .empty { data = update.data }
        }
        projection = VehicleChartsProjection.make(from: data)
        phase = Self.resolvePhase(status: update.status, hasContent: projection.hasAnyContent)
    }

    /// Resolves the render phase. A cached slice stays visible behind a refresh /
    /// failure (freshness reflected by the chip); the skeleton shows only on the
    /// initial fetch with nothing cached; the empty state shows when the slice
    /// resolves with no section content; the hard-error state only when a failure
    /// arrives with nothing cached to render.
    public static func resolvePhase(status: VehicleChartsStatus, hasContent: Bool) -> Phase {
        switch status {
        case .loading:
            hasContent ? .loaded : .loading
        case .loaded:
            hasContent ? .loaded : .empty
        case .empty:
            .empty
        case let .failed(message):
            hasContent ? .loaded : .error(message)
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryVehicleChartsSource: VehicleChartsSource {
    public var onUpdate: (@MainActor (VehicleChartsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VehicleChartsUpdate?

    public init(initial: VehicleChartsUpdate? = nil) {
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
    public func push(_ update: VehicleChartsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "VehicleCharts" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; kept
/// per-surface so each parallel prompt owns its own strings without editing the
/// shared catalog.
public enum VehicleChartsStrings {
    public static let table = "VehicleCharts"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
