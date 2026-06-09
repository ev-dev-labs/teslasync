//
//  BatteryHealthAnalyticsWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0014 · BatteryHealthAnalyticsWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a plain host
//  (the surface view layers SwiftUI chrome on top in BatteryHealthAnalyticsWidget.swift).
//
//  Parity target: features/dashboard/widgets/BatteryHealthAnalyticsWidget.tsx — a radial gauge of the
//  battery state-of-health (0-100) with a six-stat cluster (cycles, charge depth, discharge depth,
//  DC-fast ratio, temperature-exposure score, charge-habits score).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated and redacted there.
public protocol BatteryHealthAnalyticsWidgetTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct BatteryHealthAnalyticsWidgetOSLogTelemetry: BatteryHealthAnalyticsWidgetTelemetry {
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
/// production source projects from the battery-health `Resource<BatteryHealthAnalytics>` query
/// (web `useQuery`).
public enum BatteryHealthAnalyticsWidgetLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Query freshness, mirroring `LiveConnectionState` (ADR-013) and the web `WidgetShell`
/// `isStale` / `isFetching` / `isError` freshness chip.
public enum BatteryHealthAnalyticsWidgetConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The cached battery-health analytics the widget consumes — the subset of the web
/// `BatteryHealthAnalytics` DTO the source reads (`GET /analytics/battery-health?vehicle_id=…`). Every
/// numeric field is optional so the projector can reproduce the web `?? 0` fallbacks verbatim. Field
/// names mirror the snake_case JSON tags (`current_soh`, `total_cycles`, …) one-for-one.
public struct BatteryHealthAnalyticsWidgetDTO: Sendable, Equatable {
    /// `current_soh` — current state of health (0-100), the gauge value.
    public var currentSoh: Double?
    /// `total_cycles` — equivalent full charge cycles.
    public var totalCycles: Double?
    /// `full_charge_pct` — average charge depth, rendered as a percentage.
    public var fullChargePct: Double?
    /// `avg_depth_of_discharge` — average discharge depth, rendered as a percentage.
    public var avgDepthOfDischarge: Double?
    /// `fast_charge_pct` — DC-fast-charge ratio, rendered as a percentage.
    public var fastChargePct: Double?
    /// `temp_exposure_score` — temperature-exposure score out of 100.
    public var tempExposureScore: Double?
    /// `charge_habits_score` — charge-habits score out of 100.
    public var chargeHabitsScore: Double?

    public init(
        currentSoh: Double? = nil,
        totalCycles: Double? = nil,
        fullChargePct: Double? = nil,
        avgDepthOfDischarge: Double? = nil,
        fastChargePct: Double? = nil,
        tempExposureScore: Double? = nil,
        chargeHabitsScore: Double? = nil
    ) {
        self.currentSoh = currentSoh
        self.totalCycles = totalCycles
        self.fullChargePct = fullChargePct
        self.avgDepthOfDischarge = avgDepthOfDischarge
        self.fastChargePct = fastChargePct
        self.tempExposureScore = tempExposureScore
        self.chargeHabitsScore = chargeHabitsScore
    }
}

/// The user's number-display preferences, mirroring the web `fmtNumber` global locale + precision
/// (`useSettings` / `useUnits`). The view never reads settings directly; the source resolves these and
/// pushes them with each snapshot so the gauge readout groups + rounds exactly like the web widget.
///
/// Note: the web source also imports a temperature converter, but the rendered output reads only
/// scores + percentages (no temperature is displayed), so the unit-system preference has no visible
/// effect here — only the locale + precision do, which this carries.
public struct BatteryHealthAnalyticsWidgetFormatPrefs: Sendable, Equatable {
    public var localeIdentifier: String
    /// `getGlobalPrecision()` — the fraction-digit count used for a non-integer gauge value (web 2).
    public var precision: Int

    public init(localeIdentifier: String = "en_US", precision: Int = 2) {
        self.localeIdentifier = localeIdentifier
        self.precision = max(0, min(20, precision))
    }
}

/// One coalesced snapshot pushed by a `BatteryHealthAnalyticsWidgetSource`: the cached analytics +
/// display prefs plus their load/connection status. The model turns this into the projection.
public struct BatteryHealthAnalyticsWidgetUpdate: Sendable, Equatable {
    public var status: BatteryHealthAnalyticsWidgetLoadStatus
    public var connection: BatteryHealthAnalyticsWidgetConnection
    public var isFetching: Bool
    public var data: BatteryHealthAnalyticsWidgetDTO?
    public var format: BatteryHealthAnalyticsWidgetFormatPrefs
    public var updatedAt: Date?

    public init(
        status: BatteryHealthAnalyticsWidgetLoadStatus = .loading,
        connection: BatteryHealthAnalyticsWidgetConnection = .live,
        isFetching: Bool = false,
        data: BatteryHealthAnalyticsWidgetDTO? = nil,
        format: BatteryHealthAnalyticsWidgetFormatPrefs = BatteryHealthAnalyticsWidgetFormatPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.data = data
        self.format = format
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (the `VehicleStore` for the active vehicle + the battery-health `Resource` +
/// `SettingsStore`); previews and tests use `BatteryHealthAnalyticsWidgetInMemorySource`. The view
/// never talks to the network.
@MainActor
public protocol BatteryHealthAnalyticsWidgetSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (BatteryHealthAnalyticsWidgetUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `BatteryHealthAnalyticsWidgetSource`,
/// recomputes the `BatteryHealthAnalyticsWidgetProjection` via the projector, and exposes a render
/// `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class BatteryHealthAnalyticsWidgetModel {
    /// The mutually-exclusive render branches (web shell loading / error + body gauge / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: BatteryHealthAnalyticsWidgetConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: BatteryHealthAnalyticsWidgetProjection?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any BatteryHealthAnalyticsWidgetSource
    @ObservationIgnored private let telemetry: any BatteryHealthAnalyticsWidgetTelemetry
    @ObservationIgnored private let copy: BatteryHealthAnalyticsCopy
    @ObservationIgnored private var started = false

    public init(
        source: any BatteryHealthAnalyticsWidgetSource,
        telemetry: any BatteryHealthAnalyticsWidgetTelemetry = BatteryHealthAnalyticsWidgetOSLogTelemetry(),
        copy: BatteryHealthAnalyticsCopy = BatteryHealthAnalyticsWidgetStrings.copy()
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
        telemetry.viewOpened(surface: BatteryHealthAnalyticsWidgetSurface.slug)
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

    private func apply(_ update: BatteryHealthAnalyticsWidgetUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        if let data = update.data {
            projection = BatteryHealthAnalyticsWidgetProjector.project(
                data: data,
                format: update.format,
                copy: copy
            )
        } else {
            projection = nil
        }
        phase = Self.resolvePhase(status: update.status, hasData: projection != nil)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch and the "No battery health data" empty state when there is no analytics object;
    /// whenever data is known the gauge renders (the cached gauge stays visible behind refresh /
    /// transient failures so an offline or stale pod still shows the last-known health).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(
        status: BatteryHealthAnalyticsWidgetLoadStatus,
        hasData: Bool
    ) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class BatteryHealthAnalyticsWidgetInMemorySource: BatteryHealthAnalyticsWidgetSource {
    public var onUpdate: (@MainActor (BatteryHealthAnalyticsWidgetUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: BatteryHealthAnalyticsWidgetUpdate?

    public init(initial: BatteryHealthAnalyticsWidgetUpdate? = nil) {
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
    public func push(_ update: BatteryHealthAnalyticsWidgetUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/battery.ts → "battery-health-analytics")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI view
/// so the model/adapter compile and test without SwiftUI. `BatteryHealthAnalyticsWidget` re-exposes
/// these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum BatteryHealthAnalyticsWidgetSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "BatteryHealthAnalyticsWidget"

    /// Canonical registry metadata (registry/battery.ts → "battery-health-analytics"): Battery
    /// Analytics, category `battery`, default 2×4, min 1×2, max 4×40.
    public static let registration = DashboardWidgetRegistration(
        id: "battery-health-analytics",
        nameKey: "widget.batteryHealthAnalytics.title",
        descriptionKey: "widget.batteryHealthAnalytics.description",
        category: "battery",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "BatteryHealthAnalyticsWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so the model +
/// adapter copy can use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum BatteryHealthAnalyticsWidgetStrings {
    public static let table = "BatteryHealthAnalyticsWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves the projector's injected, pre-localized copy from the catalog.
    public static func copy() -> BatteryHealthAnalyticsCopy {
        BatteryHealthAnalyticsCopy(
            scoreUnit: string("widget.batteryHealthAnalytics.score", "health"),
            totalCycles: string("widget.batteryHealthAnalytics.totalCycles", "Cycles"),
            avgChargeDepth: string("widget.batteryHealthAnalytics.avgChargeDepth", "Charge Depth"),
            avgDischargeDepth: string("widget.batteryHealthAnalytics.avgDischargeDepth", "Discharge"),
            dcFastRatio: string("widget.batteryHealthAnalytics.dcFastRatio", "DC Fast"),
            tempExposure: string("widget.batteryHealthAnalytics.tempExposure", "Temp Score"),
            chargeHabits: string("widget.batteryHealthAnalytics.chargeHabits", "Habits"),
            percentUnit: string("widget.batteryHealthAnalytics.percentUnit", "%"),
            outOfHundredUnit: string("widget.batteryHealthAnalytics.outOfHundred", "/ 100"),
            gaugeA11y: string("widget.batteryHealthAnalytics.gaugeA11y", "Battery health %1$@ out of 100")
        )
    }
}
