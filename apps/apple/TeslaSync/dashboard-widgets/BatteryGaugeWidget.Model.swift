//
//  BatteryGaugeWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0013 · BatteryGaugeWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a plain
//  host (the surface view layers SwiftUI chrome on top in BatteryGaugeWidget.swift).
//
//  Parity target: features/dashboard/widgets/BatteryGaugeWidget.tsx — a radial gauge of the active
//  vehicle's battery percentage (0-100) with a colour band + a charging caption.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated and redacted there.
public protocol BatteryGaugeWidgetTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct BatteryGaugeWidgetOSLogTelemetry: BatteryGaugeWidgetTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState` cases the
/// production source projects from the vehicle-state `Resource<VehicleState>` query (web `useQuery`).
public enum BatteryGaugeWidgetLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Query freshness, mirroring `LiveConnectionState` (ADR-013) and the web `WidgetShell`
/// `isStale` / `isFetching` / `isError` freshness chip.
public enum BatteryGaugeWidgetConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The cached vehicle state the widget consumes — the subset of the web `VehicleState` DTO the source
/// reads (`GET /vehicles/{id}/state`). `batteryLevel` is the `battery_level` percentage and
/// `isCharging` is the `is_charging` flag that gates the charging caption.
public struct BatteryGaugeWidgetStateDTO: Sendable, Equatable {
    public var batteryLevel: Double
    public var isCharging: Bool

    public init(batteryLevel: Double, isCharging: Bool = false) {
        self.batteryLevel = batteryLevel
        self.isCharging = isCharging
    }
}

/// The user's number-display preferences, mirroring the web `fmtNumber` global locale + precision
/// (`useSettings`). The view never reads settings directly; the source resolves these and pushes them
/// with each snapshot so the gauge readout groups + rounds exactly like the web widget.
public struct BatteryGaugeWidgetFormatPrefs: Sendable, Equatable {
    public var localeIdentifier: String
    /// `getGlobalPrecision()` — the fraction-digit count used for a non-integer gauge value (web
    /// default 2).
    public var precision: Int

    public init(localeIdentifier: String = "en_US", precision: Int = 2) {
        self.localeIdentifier = localeIdentifier
        self.precision = max(0, min(20, precision))
    }
}

/// One coalesced snapshot pushed by a `BatteryGaugeWidgetSource`: the cached state + display prefs
/// plus their load/connection status. The model turns this into the projection.
public struct BatteryGaugeWidgetUpdate: Sendable, Equatable {
    public var status: BatteryGaugeWidgetLoadStatus
    public var connection: BatteryGaugeWidgetConnection
    public var isFetching: Bool
    public var state: BatteryGaugeWidgetStateDTO?
    public var format: BatteryGaugeWidgetFormatPrefs
    public var updatedAt: Date?

    public init(
        status: BatteryGaugeWidgetLoadStatus = .loading,
        connection: BatteryGaugeWidgetConnection = .live,
        isFetching: Bool = false,
        state: BatteryGaugeWidgetStateDTO? = nil,
        format: BatteryGaugeWidgetFormatPrefs = BatteryGaugeWidgetFormatPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.state = state
        self.format = format
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (the `VehicleStore` for the active vehicle + the vehicle-state `Resource` + `SettingsStore`);
/// previews and tests use `BatteryGaugeWidgetInMemorySource`. The view never talks to the network.
@MainActor
public protocol BatteryGaugeWidgetSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (BatteryGaugeWidgetUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `BatteryGaugeWidgetSource`, recomputes the
/// `BatteryGaugeWidgetProjection` via `BatteryGaugeWidgetProjector`, and exposes a render `Phase`
/// + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class BatteryGaugeWidgetModel {
    /// The mutually-exclusive render branches (web shell loading / error + body gauge / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: BatteryGaugeWidgetConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: BatteryGaugeWidgetProjection?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any BatteryGaugeWidgetSource
    @ObservationIgnored private let telemetry: any BatteryGaugeWidgetTelemetry
    @ObservationIgnored private let copy: BatteryGaugeWidgetCopy
    @ObservationIgnored private var started = false

    public init(
        source: any BatteryGaugeWidgetSource,
        telemetry: any BatteryGaugeWidgetTelemetry = BatteryGaugeWidgetOSLogTelemetry(),
        copy: BatteryGaugeWidgetCopy = BatteryGaugeWidgetStrings.copy()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.copy = copy
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: BatteryGaugeWidgetSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (the cached gauge stays visible). Wired to the retry / refresh
    /// affordances and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web freshness self-refresh on stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: BatteryGaugeWidgetUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        if let state = update.state {
            projection = BatteryGaugeWidgetProjector.project(state: state, format: update.format, copy: copy)
        } else {
            projection = nil
        }
        phase = Self.resolvePhase(status: update.status, hasState: projection != nil)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch and the "No battery data" empty state when there is no state; whenever a state is
    /// known the gauge renders (the cached gauge stays visible behind refresh/transient failures so an
    /// offline or stale pod still shows the last-known battery level).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(
        status: BatteryGaugeWidgetLoadStatus,
        hasState: Bool
    ) -> Phase {
        switch status {
        case .loading:
            hasState ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasState ? .content : .empty
        case let .failed(message):
            hasState ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class BatteryGaugeWidgetInMemorySource: BatteryGaugeWidgetSource {
    public var onUpdate: (@MainActor (BatteryGaugeWidgetUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: BatteryGaugeWidgetUpdate?

    public init(initial: BatteryGaugeWidgetUpdate? = nil) {
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
    public func push(_ update: BatteryGaugeWidgetUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/battery.ts → "battery-gauge")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI
/// view so the model/adapter compile and test without SwiftUI. `BatteryGaugeWidget` re-exposes
/// these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum BatteryGaugeWidgetSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "BatteryGaugeWidget"

    /// Canonical registry metadata (registry/battery.ts → "battery-gauge"): Battery Level, category
    /// `battery`, default 1×2, min 1×2, max 2×40.
    public static let registration = DashboardWidgetRegistration(
        id: "battery-gauge",
        nameKey: "widget.battery.title",
        descriptionKey: "widget.battery.description",
        category: "battery",
        defaultSize: DashboardWidgetSize(cols: 1, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 2, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "BatteryGaugeWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so the model +
/// adapter copy can use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum BatteryGaugeWidgetStrings {
    public static let table = "BatteryGaugeWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves the projector's injected, pre-localized copy from the catalog.
    public static func copy() -> BatteryGaugeWidgetCopy {
        BatteryGaugeWidgetCopy(
            batteryLabel: string("widget.battery", "Battery"),
            charging: string("widget.charging", "Charging"),
            batteryA11y: string("widget.battery.a11y", "Battery %1$@ percent")
        )
    }
}
