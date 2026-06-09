//
//  EnergySiteInfoWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0047 · EnergySiteInfoWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a plain
//  host (the surface view layers SwiftUI chrome on top in EnergySiteInfoWidget.swift).
//
//  Parity target: features/dashboard/widgets/EnergySiteInfoWidget.tsx — the Tesla Energy site
//  detail card (Solar System, Powerwalls, Gateway Firmware, Installation Timezone), driven by the
//  `useTeslaEnergySites` → `useTeslaEnergySiteInfo(siteId)` hook pair.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated and redacted.
public protocol EnergySiteInfoTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`. Bridges 1:1 to the
/// shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogEnergySiteInfoTelemetry: EnergySiteInfoTelemetry {
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
/// production source projects from `Resource<T>` (here a composite of the energy-sites list query
/// and the per-site info query the web widget reads via `useTeslaEnergySites` /
/// `useTeslaEnergySiteInfo`).
public enum EnergySiteInfoLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying queries, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders from `isFetching` / `isStale` / `isError`.
public enum EnergySiteInfoConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One Tesla Energy product the user has linked, mirroring the `TeslaEnergySite` rows the web widget
/// reads from `useTeslaEnergySites()`. The widget only needs the site identifier (it drives the
/// `useTeslaEnergySiteInfo(siteId)` query) and the optional display name; the rest of the product
/// row is unused by this surface.
public struct EnergySiteInfoSiteDTO: Sendable, Equatable, Identifiable {
    public var energySiteID: Int
    public var siteName: String?

    public var id: Int {
        energySiteID
    }

    public init(energySiteID: Int, siteName: String? = nil) {
        self.energySiteID = energySiteID
        self.siteName = siteName
    }
}

/// The detailed site configuration this surface consumes, mirroring the `TeslaEnergySiteInfo` fields
/// the web widget reads off `infoResponse.data`. Physical quantities arrive SI/raw exactly as the
/// API delivers them: `nameplatePowerW` in WATTS, `nameplateEnergyWh` in WATT-HOURS. Display scaling
/// to kW / kWh happens in `EnergySiteInfoProjector`, never here. A non-nil DTO marks "info present"
/// (the web `else if (info)` branch that builds the detail rows).
public struct EnergySiteInfoDataDTO: Sendable, Equatable {
    public var nameplatePowerW: Double?
    public var nameplateEnergyWh: Double?
    public var batteryCount: Int?
    public var version: String?
    public var installationTimeZone: String?

    public init(
        nameplatePowerW: Double? = nil,
        nameplateEnergyWh: Double? = nil,
        batteryCount: Int? = nil,
        version: String? = nil,
        installationTimeZone: String? = nil
    ) {
        self.nameplatePowerW = nameplatePowerW
        self.nameplateEnergyWh = nameplateEnergyWh
        self.batteryCount = batteryCount
        self.version = version
        self.installationTimeZone = installationTimeZone
    }
}

/// One coalesced snapshot pushed by an `EnergySiteInfoSource`: the linked sites + the resolved
/// site-info detail + display locale plus their load / connection status. The model turns this into
/// the `EnergySiteInfoProjection` the view renders. `sites` mirrors the web `sites ?? []` and `info`
/// mirrors `infoResponse?.data ?? null`.
public struct EnergySiteInfoUpdate: Sendable, Equatable {
    public var status: EnergySiteInfoLoadStatus
    public var connection: EnergySiteInfoConnection
    public var isFetching: Bool
    public var sites: [EnergySiteInfoSiteDTO]
    public var info: EnergySiteInfoDataDTO?
    public var localeIdentifier: String
    public var updatedAt: Date?

    public init(
        status: EnergySiteInfoLoadStatus = .loading,
        connection: EnergySiteInfoConnection = .live,
        isFetching: Bool = false,
        sites: [EnergySiteInfoSiteDTO] = [],
        info: EnergySiteInfoDataDTO? = nil,
        localeIdentifier: String = "en_US",
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.sites = sites
        self.info = info
        self.localeIdentifier = localeIdentifier
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (the energy-sites list + per-site info `StateHolderModel<LoadableState<…>>` from the KMP
/// `EnergyStore` plus the `SettingsStore` locale); previews and tests use
/// `InMemoryEnergySiteInfoSource`. The view never talks to the network directly.
@MainActor
public protocol EnergySiteInfoSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (EnergySiteInfoUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to an `EnergySiteInfoSource`, recomputes the
/// `EnergySiteInfoProjection` via `EnergySiteInfoProjector`, and exposes a render `Phase` + freshness
/// for SwiftUI to switch over. No networking lives here.
@MainActor
@Observable
public final class EnergySiteInfoModel {
    /// The mutually-exclusive render branches (web shell loading / error + body detail-card vs the
    /// `WidgetDetailCard` empty state).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: EnergySiteInfoConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: EnergySiteInfoProjection?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any EnergySiteInfoSource
    @ObservationIgnored private let telemetry: any EnergySiteInfoTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any EnergySiteInfoSource,
        telemetry: any EnergySiteInfoTelemetry = OSLogEnergySiteInfoTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EnergySiteInfoSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the retry / refresh
    /// affordances and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web `DataFreshnessAuto` self-refresh on stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: EnergySiteInfoUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        projection = EnergySiteInfoProjector.project(
            info: update.info,
            hasSites: !update.sites.isEmpty,
            localeIdentifier: update.localeIdentifier
        )
        phase = Self.resolvePhase(status: update.status, hasInfo: update.info != nil)
    }

    /// Resolves the render phase, mirroring the web shell + `WidgetDetailCard`: the skeleton shows
    /// only on the initial fetch; whenever the site-info detail is known the rows render; the empty
    /// state covers both "no Tesla Energy site linked" and "no site info available" (the view picks
    /// the message from `projection.hasSites`). Cached detail stays visible behind refresh /
    /// transient failures so an offline or stale pod still shows the last-known site card.
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: EnergySiteInfoLoadStatus, hasInfo: Bool) -> Phase {
        switch status {
        case .loading:
            hasInfo ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasInfo ? .content : .empty
        case let .failed(message):
            hasInfo ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryEnergySiteInfoSource: EnergySiteInfoSource {
    public var onUpdate: (@MainActor (EnergySiteInfoUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: EnergySiteInfoUpdate?

    public init(initial: EnergySiteInfoUpdate? = nil) {
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
    public func push(_ update: EnergySiteInfoUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/energy.ts → "energy-site-info")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI
/// view so the model/adapter compile and test without SwiftUI. `EnergySiteInfoWidget` re-exposes
/// these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum EnergySiteInfoSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "EnergySiteInfoWidget"

    /// Canonical registry metadata (registry/energy.ts → "energy-site-info").
    public static let registration = DashboardWidgetRegistration(
        id: "energy-site-info",
        nameKey: "widget.energySiteInfo.name",
        descriptionKey: "widget.energySiteInfo.description",
        category: "energy",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "EnergySiteInfoWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so the adapter's
/// accessibility summary can use it; the SwiftUI `text(_:_:)` helper lives in the view.
public enum EnergySiteInfoStrings {
    public static let table = "EnergySiteInfoWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
