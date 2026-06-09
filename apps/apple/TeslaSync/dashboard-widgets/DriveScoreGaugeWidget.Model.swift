//
//  DriveScoreGaugeWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0039 · DriveScoreGaugeWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a plain
//  host (the surface view layers SwiftUI chrome on top in DriveScoreGaugeWidget.swift).
//
//  Parity target: features/dashboard/widgets/DriveScoreGaugeWidget.tsx — a radial gauge of the
//  weekly drive score (0-100) with the grade + efficiency / smoothness / speed-discipline breakdown.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated and redacted there.
public protocol DriveScoreGaugeWidgetTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct DriveScoreGaugeWidgetOSLogTelemetry: DriveScoreGaugeWidgetTelemetry {
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
/// production source projects from the drive-score `Resource<DriveScore>` query (web `useQuery`).
public enum DriveScoreGaugeWidgetLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Query freshness, mirroring `LiveConnectionState` (ADR-013) and the web `WidgetShell`
/// `isStale` / `isFetching` / `isError` freshness chip.
public enum DriveScoreGaugeWidgetConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The cached drive score the widget consumes — the subset of the web `DriveScore` DTO the source
/// reads (`GET /drives/score?vehicle_id=…`). The numeric sub-scores are optional so the projector can
/// reproduce the web `?? 0` fallbacks verbatim; `grade` is optional so it can reproduce `?? '—'`.
public struct DriveScoreGaugeWidgetScoreDTO: Sendable, Equatable {
    public var overall: Double?
    public var efficiency: Double?
    public var smoothness: Double?
    public var speedDiscipline: Double?
    public var grade: String?

    public init(
        overall: Double? = nil,
        efficiency: Double? = nil,
        smoothness: Double? = nil,
        speedDiscipline: Double? = nil,
        grade: String? = nil
    ) {
        self.overall = overall
        self.efficiency = efficiency
        self.smoothness = smoothness
        self.speedDiscipline = speedDiscipline
        self.grade = grade
    }
}

/// The user's number-display preferences, mirroring the web `fmtNumber` global locale + precision
/// (`useSettings`). The view never reads settings directly; the source resolves these and pushes them
/// with each snapshot so the gauge readout groups + rounds exactly like the web widget.
public struct DriveScoreGaugeWidgetFormatPrefs: Sendable, Equatable {
    public var localeIdentifier: String
    /// `getGlobalPrecision()` — the fraction-digit count used for a non-integer gauge value (web default 2).
    public var precision: Int

    public init(localeIdentifier: String = "en_US", precision: Int = 2) {
        self.localeIdentifier = localeIdentifier
        self.precision = max(0, min(20, precision))
    }
}

/// One coalesced snapshot pushed by a `DriveScoreGaugeWidgetSource`: the cached score + display prefs
/// plus their load/connection status. The model turns this into the projection.
public struct DriveScoreGaugeWidgetUpdate: Sendable, Equatable {
    public var status: DriveScoreGaugeWidgetLoadStatus
    public var connection: DriveScoreGaugeWidgetConnection
    public var isFetching: Bool
    public var score: DriveScoreGaugeWidgetScoreDTO?
    public var format: DriveScoreGaugeWidgetFormatPrefs
    public var updatedAt: Date?

    public init(
        status: DriveScoreGaugeWidgetLoadStatus = .loading,
        connection: DriveScoreGaugeWidgetConnection = .live,
        isFetching: Bool = false,
        score: DriveScoreGaugeWidgetScoreDTO? = nil,
        format: DriveScoreGaugeWidgetFormatPrefs = DriveScoreGaugeWidgetFormatPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.score = score
        self.format = format
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (the `VehicleStore` for the active vehicle + the drive-score `Resource` + `SettingsStore`);
/// previews and tests use `DriveScoreGaugeWidgetInMemorySource`. The view never talks to the network.
@MainActor
public protocol DriveScoreGaugeWidgetSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (DriveScoreGaugeWidgetUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `DriveScoreGaugeWidgetSource`, recomputes the
/// `DriveScoreGaugeWidgetProjection` via `DriveScoreGaugeWidgetProjector`, and exposes a render `Phase`
/// + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class DriveScoreGaugeWidgetModel {
    /// The mutually-exclusive render branches (web shell loading / error + body gauge / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: DriveScoreGaugeWidgetConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: DriveScoreGaugeWidgetProjection?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DriveScoreGaugeWidgetSource
    @ObservationIgnored private let telemetry: any DriveScoreGaugeWidgetTelemetry
    @ObservationIgnored private let copy: DriveScoreGaugeCopy
    @ObservationIgnored private var started = false

    public init(
        source: any DriveScoreGaugeWidgetSource,
        telemetry: any DriveScoreGaugeWidgetTelemetry = DriveScoreGaugeWidgetOSLogTelemetry(),
        copy: DriveScoreGaugeCopy = DriveScoreGaugeWidgetStrings.copy()
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
        telemetry.viewOpened(surface: DriveScoreGaugeWidgetSurface.slug)
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

    private func apply(_ update: DriveScoreGaugeWidgetUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        if let score = update.score {
            projection = DriveScoreGaugeWidgetProjector.project(score: score, format: update.format, copy: copy)
        } else {
            projection = nil
        }
        phase = Self.resolvePhase(status: update.status, hasScore: projection != nil)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch and the "No score yet" empty state when there is no score; whenever a score is
    /// known the gauge renders (the cached gauge stays visible behind refresh/transient failures so an
    /// offline or stale pod still shows the last-known score).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(
        status: DriveScoreGaugeWidgetLoadStatus,
        hasScore: Bool
    ) -> Phase {
        switch status {
        case .loading:
            hasScore ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasScore ? .content : .empty
        case let .failed(message):
            hasScore ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class DriveScoreGaugeWidgetInMemorySource: DriveScoreGaugeWidgetSource {
    public var onUpdate: (@MainActor (DriveScoreGaugeWidgetUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DriveScoreGaugeWidgetUpdate?

    public init(initial: DriveScoreGaugeWidgetUpdate? = nil) {
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
    public func push(_ update: DriveScoreGaugeWidgetUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/driving.ts → "drive-score-gauge")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI
/// view so the model/adapter compile and test without SwiftUI. `DriveScoreGaugeWidget` re-exposes
/// these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum DriveScoreGaugeWidgetSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "DriveScoreGaugeWidget"

    /// Canonical registry metadata (registry/driving.ts → "drive-score-gauge"): Drive Score Gauge,
    /// category `driving`, default 1×2, min 1×2, max 2×40.
    public static let registration = DashboardWidgetRegistration(
        id: "drive-score-gauge",
        nameKey: "widget.driveScoreGauge.title",
        descriptionKey: "widget.driveScoreGauge.description",
        category: "driving",
        defaultSize: DashboardWidgetSize(cols: 1, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 2, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "DriveScoreGaugeWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so the model +
/// adapter copy can use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum DriveScoreGaugeWidgetStrings {
    public static let table = "DriveScoreGaugeWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves the projector's injected, pre-localized copy from the catalog.
    public static func copy() -> DriveScoreGaugeCopy {
        DriveScoreGaugeCopy(
            weeklyScore: string("widget.driveScoreGauge.weekly", "Weekly score"),
            efficiency: string("widget.driveScoreGauge.efficiency", "Efficiency"),
            smoothness: string("widget.driveScoreGauge.smoothness", "Smoothness"),
            speedDiscipline: string("widget.driveScoreGauge.speed", "Speed Discipline"),
            gradeUnknown: string("widget.driveScoreGauge.gradeFallback", "—"),
            overallA11y: string("widget.driveScoreGauge.overallA11y", "Weekly drive score %1$@ out of 100, grade %2$@"),
            subScoreA11y: string("widget.driveScoreGauge.subScoreA11y", "%1$@ %2$@ out of 100")
        )
    }
}
