//
//  VehicleTwin.Model.swift
//  TeslaSync — P4 shared surface · 0235 · VehicleTwin (Apple)
//
//  The state-holder seam (P1/S8) + telemetry seam (P1/S11) for the VehicleTwin shared surface — the
//  native peer of web/src/components/vehicles/VehicleTwin.tsx. The web component is presentational:
//  it receives an already-merged `VehicleTwinState` plus the paint inputs (`vehicleId` /
//  `exteriorColor`) that `useVehiclePaint` resolves. This surface mirrors that — the source pushes a
//  coalesced `VehicleTwinInput` (the twin state + paint inputs + the P4 leaf connectivity axis + load
//  status, see VehicleTwin.State.swift), and the model projects it into the localized view-state. The
//  view never talks to the network or storage; the override persistence lives behind the seam.
//
//  The reusable Canvas illustration (`VehicleTwinView`) and the domain contract (`VehicleTwinState` +
//  the window / door / turn-signal enums, the port of web lib/vehicleState.ts) are owned by the
//  module and composed here — they are not redeclared.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol VehicleTwinTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
/// The slug is a static, non-identifying constant.
public struct OSLogVehicleTwinTelemetry: VehicleTwinTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (the KMP `SecurityStore` / `VehicleStore` / `ChargingStore` projected into a
/// `VehicleTwinState`, with the per-vehicle paint override read/written through the same store layer
/// as the web `useVehiclePaint` does to `localStorage` + the broadcast bus). Previews and tests use
/// `InMemoryVehicleTwinSource`. The view never talks to the network or storage.
@MainActor
public protocol VehicleTwinSource: AnyObject {
    var onUpdate: (@MainActor (VehicleTwinInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-requests the snapshot (header refresh + error retry).
    func refresh()
    /// Sets the per-vehicle paint override (web `useVehiclePaint.setPaint`).
    func setPaint(_ id: VehicleTwinPaintID?)
    /// Clears the override, reverting to the Tesla-inferred paint (web `useVehiclePaint.reset`).
    func resetPaint()
}

/// The surface's observable view-model. Subscribes to a `VehicleTwinSource`, recomputes the resolved
/// projection, exposes the render `phase` + resolved content + the `connection` axis, emits
/// `view.opened` once on start, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class VehicleTwinSurfaceModel {
    public private(set) var resolved: VehicleTwinResolved =
        VehicleTwinProjection.resolve(VehicleTwinInput(loadStatus: .loading))
    public private(set) var connection: VehicleTwinConnection = .live

    public var phase: VehicleTwinResolved.Phase {
        resolved.phase
    }

    public var content: VehicleTwinContent? {
        resolved.content
    }

    @ObservationIgnored private let source: any VehicleTwinSource
    @ObservationIgnored private let telemetry: any VehicleTwinTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any VehicleTwinSource,
        telemetry: any VehicleTwinTelemetry = OSLogVehicleTwinTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the upstream feed and emits `view.opened` exactly once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: VehicleTwin.surfaceSlug)
        }
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Sets the per-vehicle paint override (web `useVehiclePaint.setPaint`).
    public func setPaint(_ id: VehicleTwinPaintID?) {
        source.setPaint(id)
    }

    /// Clears the override, reverting to the Tesla-inferred paint (web `useVehiclePaint.reset`).
    public func resetPaint() {
        source.resetPaint()
    }

    private func apply(_ input: VehicleTwinInput) {
        resolved = VehicleTwinProjection.resolve(input, locale: locale)
        connection = input.connection
        handleAutoRefresh(for: input.connection)
    }

    /// Stale → one guarded refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline never auto-refreshes.
    private func handleAutoRefresh(for connection: VehicleTwinConnection) {
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

/// In-memory source for previews + unit / UI tests. Drive it with `push(_:)`; the call counters +
/// recorded last override let the wiring + delegation be asserted without a network.
@MainActor
public final class InMemoryVehicleTwinSource: VehicleTwinSource {
    public var onUpdate: (@MainActor (VehicleTwinInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var setPaintCount = 0
    public private(set) var resetPaintCount = 0
    public private(set) var lastSetPaint: VehicleTwinPaintID??

    private let initial: VehicleTwinInput?

    public init(initial: VehicleTwinInput? = nil) {
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

    public func setPaint(_ id: VehicleTwinPaintID?) {
        setPaintCount += 1
        lastSetPaint = .some(id)
    }

    public func resetPaint() {
        resetPaintCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: VehicleTwinInput) {
        onUpdate?(input)
    }
}
