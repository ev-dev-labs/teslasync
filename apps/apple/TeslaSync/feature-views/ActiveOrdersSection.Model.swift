//
//  ActiveOrdersSection.Model.swift
//  TeslaSync — P4 feature view · 0196 · ActiveOrdersSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + toast seam +
//  i18n facade (P1/S10) for the settings "Active Orders" surface. The view binds
//  through `ActiveOrdersModel`; no networking lives in the view. SwiftUI parity of
//  features/settings/components/ActiveOrdersSection.tsx.
//
//  The web component reads `useTeslaUserOrders()` and triggers `useRefreshTeslaOrders()`
//  (a mutation that toasts success / failure). The native surface reproduces that
//  whole lifecycle through an `ActiveOrdersSource` so every prompt-required state
//  (loading / empty / error / stale / offline / content) renders here, and the
//  user-initiated refresh reports an outcome the model turns into a toast.
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
public protocol ActiveOrdersTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogActiveOrdersTelemetry: ActiveOrdersTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Toast seam (web `useToast`)

/// The result of a user-initiated orders refresh — the native parity of the web
/// mutation's `onSuccess` / `onError` callbacks.
public enum OrdersRefreshOutcome: Sendable, Equatable {
    case success
    case failure(String)
}

/// Presents a transient toast (web `useToast`). The default implementation logs;
/// the production app injects a sink that drives the shared toast presenter so the
/// refresh result is surfaced exactly like the web `toast.success` / `toast.error`.
public protocol ActiveOrdersToast: Sendable {
    func success(_ message: String)
    func error(_ title: String, _ detail: String)
}

/// `os.Logger`-backed default toast sink (used by previews / tests / headless).
public struct OSLogActiveOrdersToast: ActiveOrdersToast {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "toast")
    }

    public func success(_ message: String) {
        logger.info("toast.success \(message, privacy: .public)")
    }

    public func error(_ title: String, _ detail: String) {
        logger.error("toast.error \(title, privacy: .public): \(detail, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ActiveOrdersSection" table
/// (mirroring the web `useTranslation('settings')` `orders.*` / `toast.*` keys),
/// folded into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum OrdersStrings {
    public static let table = "ActiveOrdersSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by an `ActiveOrdersSource`: the raw order list +
/// its load status + the envelope sync timestamp + the live-state connection.
public struct OrdersUpdate: Sendable, Equatable {
    public var status: OrdersLoadStatus
    /// The web `ordersData.orders` list.
    public var orders: [TeslaOrderDTO]
    /// The web `ordersData.fetched_at` envelope timestamp (drives the "Synced" chip
    /// and which empty message shows).
    public var fetchedAt: Date?
    public var connection: OrdersConnection
    public var updatedAt: Date?

    public init(
        status: OrdersLoadStatus = .loading,
        orders: [TeslaOrderDTO] = [],
        fetchedAt: Date? = nil,
        connection: OrdersConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.orders = orders
        self.fetchedAt = fetchedAt
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the `useTeslaUserOrders` query and the
/// `useRefreshTeslaOrders` mutation — and projects each emission to an
/// `OrdersUpdate`. Previews + tests use `InMemoryActiveOrdersSource`. The view
/// never talks to the network.
@MainActor
public protocol ActiveOrdersSource: AnyObject {
    var onUpdate: (@MainActor (OrdersUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the orders refresh (web `useRefreshTeslaOrders().mutate`). Reports the
    /// outcome so the caller can toast; a fresh snapshot also arrives via `onUpdate`.
    func refresh(completion: @escaping @MainActor (OrdersRefreshOutcome) -> Void)
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to an `ActiveOrdersSource`,
/// projects each snapshot into ordered order rows + a render `OrdersPhase`, drives
/// the manual-refresh toast (web mutation `onSuccess` / `onError`), the error-state
/// retry, and the stale auto-refresh, and emits the `view.opened` diagnostics event
/// once on first appearance.
@MainActor
@Observable
public final class ActiveOrdersModel {
    public private(set) var phase: OrdersPhase = .loading
    public private(set) var connection: OrdersConnection = .live
    public private(set) var rows: [OrderRow] = []
    /// The last sync timestamp (web `ordersData.fetched_at`); `nil` until first sync.
    public private(set) var fetchedAt: Date?
    /// Whether a user-initiated refresh is in flight (web `ordersRefresh.isPending`).
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ActiveOrdersSource
    @ObservationIgnored private let telemetry: any ActiveOrdersTelemetry
    @ObservationIgnored private let toast: any ActiveOrdersToast
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any ActiveOrdersSource,
        telemetry: any ActiveOrdersTelemetry = OSLogActiveOrdersTelemetry(),
        toast: any ActiveOrdersToast = OSLogActiveOrdersToast()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.toast = toast
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The number of active orders (header count / a11y).
    public var orderCount: Int {
        rows.count
    }

    /// The combined VoiceOver summary for the section.
    public var accessibilitySummary: String {
        OrdersAccessibility.sectionSummary(
            rows: rows,
            hasFetchedAt: fetchedAt != nil,
            localize: OrdersStrings.string
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ActiveOrdersSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// The header "Refresh" action (web `ordersRefresh.mutate`): re-runs the refresh,
    /// shows the in-flight spinner, and toasts the success / failure outcome.
    public func refresh() {
        guard !refreshing else { return }
        refreshing = true
        source.refresh { [weak self] outcome in
            guard let self else { return }
            refreshing = false
            switch outcome {
            case .success:
                toast.success(OrdersStrings.string("settings.toast.ordersRefreshed", "Orders refreshed"))
            case let .failure(detail):
                toast.error(
                    OrdersStrings.string("settings.toast.ordersFailed", "Failed to refresh orders"),
                    detail
                )
            }
        }
    }

    /// The error-state retry (web `QueryError` refetch): a silent re-fetch with no
    /// toast — the bound source pushes a fresh snapshot via `onUpdate`.
    public func retry() {
        performSilentRefresh()
    }

    private func apply(_ update: OrdersUpdate) {
        connection = update.connection
        fetchedAt = update.fetchedAt
        updatedAt = update.updatedAt
        rows = OrdersProjection.rows(from: update.orders)
        phase = OrdersProjection.resolvePhase(
            update.status,
            count: rows.count,
            hasFetchedAt: update.fetchedAt != nil
        )
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached orders on screen and does not refetch. The auto-refresh is silent — no
    /// toast — because it is not user-initiated.
    private func handleAutoRefresh(for connection: OrdersConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            performSilentRefresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }

    /// A refresh that updates the data (via `onUpdate`) but never toasts — used by the
    /// error-state retry and the stale auto-refresh.
    private func performSilentRefresh() {
        source.refresh { _ in }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot
/// on `start()`, reports a configurable outcome from `refresh`, and optionally
/// pushes a follow-up snapshot to simulate the refetch.
@MainActor
public final class InMemoryActiveOrdersSource: ActiveOrdersSource {
    public var onUpdate: (@MainActor (OrdersUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    /// The outcome the next `refresh(completion:)` reports (web mutation result).
    public var nextOutcome: OrdersRefreshOutcome
    /// An optional snapshot pushed when `refresh` runs (the web query refetch).
    public var refreshedUpdate: OrdersUpdate?

    private let initial: OrdersUpdate?

    public init(
        initial: OrdersUpdate? = nil,
        nextOutcome: OrdersRefreshOutcome = .success,
        refreshedUpdate: OrdersUpdate? = nil
    ) {
        self.initial = initial
        self.nextOutcome = nextOutcome
        self.refreshedUpdate = refreshedUpdate
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh(completion: @escaping @MainActor (OrdersRefreshOutcome) -> Void) {
        refreshCount += 1
        if let refreshedUpdate { onUpdate?(refreshedUpdate) }
        completion(nextOutcome)
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: OrdersUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension ActiveOrdersSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        ActiveOrdersSurface.slug
    }
}
