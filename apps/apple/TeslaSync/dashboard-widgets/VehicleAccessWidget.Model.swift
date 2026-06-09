//
//  VehicleAccessWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0106 · VehicleAccessWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a plain
//  host (the surface view layers SwiftUI chrome on top in VehicleAccessWidget.swift).
//
//  Parity target: features/dashboard/widgets/VehicleAccessWidget.tsx — the authorized-driver /
//  pending-invitation / mobile-access security card, driven by the
//  `useVehicleDrivers` + `useVehicleInvitations` + `useVehicleMobileEnabled` hook trio (with
//  `useVehicles` selecting the default vehicle). The web `WidgetShell` collapses the three queries'
//  `isLoading` / `isFetching` / `isStale` / `isError` / `dataUpdatedAt` into one freshness chrome;
//  this model reproduces that coalescing.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for a surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated and redacted.
public protocol VehicleAccessTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. Bridges 1:1 to the
/// shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogVehicleAccessTelemetry: VehicleAccessTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState` cases the
/// production source projects from `Resource<T>` (here a composite of the drivers, invitations, and
/// mobile-enabled queries the web widget reads via `useVehicleDrivers` / `useVehicleInvitations` /
/// `useVehicleMobileEnabled`).
public enum VehicleAccessLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying queries, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders from `isFetching` / `isStale` / `isError`.
public enum VehicleAccessConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One authorized driver, mirroring the `VehicleDriver` rows the web widget reads from
/// `useVehicleDrivers()`. The widget needs only the display name / email, the role (which selects
/// the Owner vs Driver badge), and the `fetched_at` timestamp it formats into the row value.
public struct VehicleAccessDriverDTO: Sendable, Equatable, Identifiable {
    public var id: Int
    public var driverName: String?
    public var driverEmail: String?
    public var role: String?
    public var fetchedAt: String?

    public init(
        id: Int,
        driverName: String? = nil,
        driverEmail: String? = nil,
        role: String? = nil,
        fetchedAt: String? = nil
    ) {
        self.id = id
        self.driverName = driverName
        self.driverEmail = driverEmail
        self.role = role
        self.fetchedAt = fetchedAt
    }
}

/// One vehicle-share invitation, mirroring the `VehicleInvitation` rows the web widget reads from
/// `useVehicleInvitations()`. The widget needs only the `created_by` label, the `status` (which
/// selects the Pending / Accepted / Expired badge), and the `created_at` timestamp it formats into
/// the row value.
public struct VehicleAccessInvitationDTO: Sendable, Equatable, Identifiable {
    public var id: Int
    public var createdBy: String?
    public var status: String
    public var createdAt: String?

    public init(id: Int, createdBy: String? = nil, status: String, createdAt: String? = nil) {
        self.id = id
        self.createdBy = createdBy
        self.status = status
        self.createdAt = createdAt
    }
}

/// One coalesced snapshot pushed by a `VehicleAccessSource`: the authorized drivers + pending
/// invitations + resolved mobile-access flag + display locale, plus their combined load /
/// connection status. The model turns this into the `VehicleAccessProjection` the view renders.
/// `drivers` mirrors the web `drivers ?? []`, `invitations` mirrors `invitations ?? []`, and
/// `mobileEnabled` mirrors `mobileData?.data?.enabled ?? null`.
public struct VehicleAccessUpdate: Sendable, Equatable {
    public var status: VehicleAccessLoadStatus
    public var connection: VehicleAccessConnection
    public var isFetching: Bool
    public var isError: Bool
    public var drivers: [VehicleAccessDriverDTO]
    public var invitations: [VehicleAccessInvitationDTO]
    public var mobileEnabled: Bool?
    public var localeIdentifier: String
    public var updatedAt: Date?

    public init(
        status: VehicleAccessLoadStatus = .loading,
        connection: VehicleAccessConnection = .live,
        isFetching: Bool = false,
        isError: Bool = false,
        drivers: [VehicleAccessDriverDTO] = [],
        invitations: [VehicleAccessInvitationDTO] = [],
        mobileEnabled: Bool? = nil,
        localeIdentifier: String = "en_US",
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.isError = isError
        self.drivers = drivers
        self.invitations = invitations
        self.mobileEnabled = mobileEnabled
        self.localeIdentifier = localeIdentifier
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (the drivers + invitations + mobile-enabled `StateHolderModel<LoadableState<…>>` from the
/// KMP `VehicleStore` plus the `SettingsStore` locale); previews and tests use
/// `InMemoryVehicleAccessSource`. The view never talks to the network directly.
@MainActor
public protocol VehicleAccessSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (VehicleAccessUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `VehicleAccessSource`, recomputes the
/// `VehicleAccessProjection` via `VehicleAccessProjector`, and exposes a render `Phase` + freshness
/// for SwiftUI to switch over. No networking lives here.
@MainActor
@Observable
public final class VehicleAccessModel {
    /// The mutually-exclusive render branches (web shell `loading` / `error` + body content vs the
    /// "No access data available" empty state).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: VehicleAccessConnection = .live
    public private(set) var isFetching = false
    public private(set) var isError = false
    public private(set) var projection: VehicleAccessProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any VehicleAccessSource
    @ObservationIgnored private let telemetry: any VehicleAccessTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any VehicleAccessSource,
        telemetry: any VehicleAccessTelemetry = OSLogVehicleAccessTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VehicleAccessSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh of all three queries (cached value stays visible). Wired to the retry /
    /// refresh affordances and to the stale auto-refresh — the native parity of the web
    /// `onRefresh={() => { refetchDrivers(); refetchInvitations(); refetchMobile(); }}`.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web `DataFreshnessAuto` self-refresh on stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: VehicleAccessUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        isError = update.isError
        updatedAt = update.updatedAt
        projection = VehicleAccessProjector.project(
            drivers: update.drivers,
            invitations: update.invitations,
            mobileEnabled: update.mobileEnabled,
            localeIdentifier: update.localeIdentifier
        )
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasAnyData)
    }

    /// Resolves the render phase, mirroring the web shell + body. The skeleton shows only on the
    /// initial fetch with nothing cached; whenever any data is known (drivers, invitations, or a
    /// resolved mobile-access flag) the content renders; the empty state covers the web
    /// `safeDrivers.length > 0 || safeInvitations.length > 0 || mobileEnabled !== null` predicate
    /// being false. Cached content stays visible behind refresh / transient failures so an offline
    /// or stale pod still shows the last-known access card (the web `isError` then only tints the
    /// freshness chip).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: VehicleAccessLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryVehicleAccessSource: VehicleAccessSource {
    public var onUpdate: (@MainActor (VehicleAccessUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VehicleAccessUpdate?

    public init(initial: VehicleAccessUpdate? = nil) {
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
    public func push(_ update: VehicleAccessUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/security.ts → "vehicle-access")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI
/// view so the model/adapter compile and test without SwiftUI. `VehicleAccessWidget` re-exposes
/// these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum VehicleAccessSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "VehicleAccessWidget"

    /// Canonical registry metadata (registry/security.ts → "vehicle-access").
    public static let registration = DashboardWidgetRegistration(
        id: "vehicle-access",
        nameKey: "widget.vehicleAccess.name",
        descriptionKey: "widget.vehicleAccess.description",
        category: "security",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "VehicleAccessWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so the adapter's
/// accessibility summary + badge labels can use it; the SwiftUI `text(_:_:)` helper lives in the
/// view.
public enum VehicleAccessStrings {
    public static let table = "VehicleAccessWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
