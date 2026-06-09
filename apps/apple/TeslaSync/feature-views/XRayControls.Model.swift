//
//  XRayControls.Model.swift
//  TeslaSync — P4 feature view · 0033 · XRayControls (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for
//  the Ingest X-Ray controls bar. The view binds through `XRayControlsModel`; no
//  networking lives in the view. The model holds the cached vehicle list + the
//  operator-selected vehicle / window / bucket + freshness and exposes a render
//  `Phase` for the vehicle picker to switch over; the view derives the three
//  option lists via the pure adapter.
//
//  The web `XRayControls` is a controlled component: the parent owns
//  `vehicleId`/`windowSel`/`bucketSel` and passes `onVehicleChange` /
//  `onWindowChange` / `onBucketChange`. The native seam keeps that
//  unidirectional shape — the bar reports a selection through the `Source` (which
//  the production app wires into the shared selection state holder) and re-renders
//  from the snapshot the source pushes back. The vehicle list is the loadable
//  data the picker depends on, so its load lifecycle drives the picker's
//  loading / empty / error surfaces while the window and bucket selectors — pure
//  operator selections — stay usable in every state.
//
//  The seam mirrors the shared facade vocabulary — `LoadableState`
//  (loading/loaded/empty/failed, cached-stays-visible) and `LiveConnectionState`
//  (open/stale/closed) — without importing `Shared`, so the surface compiles and
//  unit-tests standalone.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared-core diagnostics (consent-gated + redacted there).
public protocol XRayControlsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogXRayControlsTelemetry: XRayControlsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the picker's vehicle list, mirroring the shared
/// `LoadableState` cases the production source projects from the vehicles
/// `Resource<T>` query.
public enum XRayControlsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): `live` ≈
/// open, `stale` ≈ open-but-past-the-freshness-window, `offline` ≈ closed.
public enum XRayControlsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `XRayControlsSource`: the cached vehicle
/// list + the operator-selected vehicle / window / bucket plus the
/// load/connection status. The window and bucket are always present (operator
/// selections that are meaningful even before the vehicle list loads); the
/// vehicle list is empty until the first successful fetch.
public struct XRayControlsUpdate: Sendable, Equatable {
    public var status: XRayControlsLoadStatus
    public var connection: XRayControlsConnection
    public var vehicles: [XRayVehicleRef]
    public var vehicleID: Int?
    public var window: IngestXRayWindow
    public var bucket: IngestXRayBucket
    public var updatedAt: Date?

    public init(
        status: XRayControlsLoadStatus = .loading,
        connection: XRayControlsConnection = .live,
        vehicles: [XRayVehicleRef] = [],
        vehicleID: Int? = nil,
        window: IngestXRayWindow = .h1,
        bucket: IngestXRayBucket = .m1,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicles = vehicles
        self.vehicleID = vehicleID
        self.window = window
        self.bucket = bucket
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the admin vehicles store + the ingest-xray
/// selection state); previews and tests use `InMemoryXRayControlsSource`. The
/// `select*` methods mirror the web `onVehicleChange` / `onWindowChange` /
/// `onBucketChange` callbacks — the bar never mutates global state directly.
@MainActor
public protocol XRayControlsSource: AnyObject {
    var onUpdate: (@MainActor (XRayControlsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func selectVehicle(_ vehicleID: Int?)
    func selectWindow(_ window: IngestXRayWindow)
    func selectBucket(_ bucket: IngestXRayBucket)
}

/// The bar's observable view-model. Subscribes to an `XRayControlsSource`, stores
/// the cached vehicle list + the selected vehicle / window / bucket + freshness,
/// and exposes a render `Phase` for the vehicle picker to switch over. The option
/// projections stay in the view (so a locale change re-derives them) via the pure
/// adapter.
@MainActor
@Observable
public final class XRayControlsModel {
    /// The mutually-exclusive render branches for the vehicle picker: a skeleton
    /// on the initial fetch, the `QueryError` equivalent on any failure, the
    /// friendly empty note when the vehicle list resolved with no vehicles, and
    /// the populated picker otherwise. The window and bucket selectors render in
    /// every branch.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: XRayControlsConnection = .live
    public private(set) var vehicles: [XRayVehicleRef] = []
    public private(set) var vehicleID: Int?
    public private(set) var window: IngestXRayWindow = .h1
    public private(set) var bucket: IngestXRayBucket = .m1
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any XRayControlsSource
    @ObservationIgnored private let telemetry: any XRayControlsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any XRayControlsSource,
        telemetry: any XRayControlsTelemetry = OSLogXRayControlsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: XRayControls.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh of the vehicle list (cached vehicles stay visible). Wired
    /// to retry and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Reports an operator vehicle selection (web `onVehicleChange`). Updates the
    /// local selection optimistically and forwards to the source.
    public func selectVehicle(_ vehicleID: Int?) {
        self.vehicleID = vehicleID
        source.selectVehicle(vehicleID)
    }

    /// Reports an operator window selection (web `onWindowChange`).
    public func selectWindow(_ window: IngestXRayWindow) {
        self.window = window
        source.selectWindow(window)
    }

    /// Reports an operator bucket selection (web `onBucketChange`).
    public func selectBucket(_ bucket: IngestXRayBucket) {
        self.bucket = bucket
        source.selectBucket(bucket)
    }

    private func apply(_ update: XRayControlsUpdate) {
        connection = update.connection
        vehicles = update.vehicles
        vehicleID = update.vehicleID
        window = update.window
        bucket = update.bucket
        updatedAt = update.updatedAt
        phase = Self.resolvePhase(update)
    }

    /// Resolves the vehicle-picker render phase. A skeleton only on the initial
    /// fetch (no cached vehicles); the error state on any failure; the friendly
    /// empty note when the load resolves with an empty vehicle list (or an
    /// explicit empty status). When vehicles are cached they stay visible — the
    /// freshness banner reflects stale/offline.
    public static func resolvePhase(_ update: XRayControlsUpdate) -> Phase {
        switch update.status {
        case .loading:
            update.vehicles.isEmpty ? .loading : .content
        case let .failed(message):
            .error(message)
        case .empty:
            .empty
        case .loaded:
            update.vehicles.isEmpty ? .empty : .content
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`; the
/// `select*` calls are recorded for assertions and echoed back into the snapshot
/// so a bound model stays consistent (the unidirectional controlled-component
/// loop the web parent provides).
@MainActor
public final class InMemoryXRayControlsSource: XRayControlsSource {
    public var onUpdate: (@MainActor (XRayControlsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var selectedVehicleCalls: [Int?] = []
    public private(set) var selectedWindowCalls: [IngestXRayWindow] = []
    public private(set) var selectedBucketCalls: [IngestXRayBucket] = []

    private var current: XRayControlsUpdate
    private let echoesSelections: Bool

    public init(initial: XRayControlsUpdate? = nil, echoesSelections: Bool = true) {
        current = initial ?? XRayControlsUpdate()
        self.echoesSelections = echoesSelections
    }

    public func start() {
        startCount += 1
        onUpdate?(current)
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func selectVehicle(_ vehicleID: Int?) {
        selectedVehicleCalls.append(vehicleID)
        current.vehicleID = vehicleID
        if echoesSelections { onUpdate?(current) }
    }

    public func selectWindow(_ window: IngestXRayWindow) {
        selectedWindowCalls.append(window)
        current.window = window
        if echoesSelections { onUpdate?(current) }
    }

    public func selectBucket(_ bucket: IngestXRayBucket) {
        selectedBucketCalls.append(bucket)
        current.bucket = bucket
        if echoesSelections { onUpdate?(current) }
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: XRayControlsUpdate) {
        current = update
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "XRayControls" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum XRayControlsStrings {
    public static let table = "XRayControls"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
