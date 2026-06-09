//
//  OperationsSection.Model.swift
//  TeslaSync — P4 feature view · 0250 · OperationsSection (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the system-status Operations surface. The view binds through
//  `OperationsModel`; no networking lives in the view. The web source
//  (OperationsSection.tsx) issues three polling `useQuery`s — notification stats (15s),
//  notification logs (15s), and audit logs (30s) — so the input snapshot here carries
//  all three resolved results plus the parent's loading / error / connectivity state
//  rather than issuing HTTP itself (the production app wires the source to the settings
//  + dev-tools clients; previews/tests use `InMemoryOperationsSource`).
//
//  States: the web branches are `isLoading` (two skeletons), the optional notification
//  delivery block (metric cards + success gauge + log table-or-empty), and the audit
//  log table-or-empty render. On top of those, this surface honours the P4 leaf
//  contract: a render `phase` (loading / ready / error) fed by the query state, and an
//  orthogonal `connection` axis (live / stale / offline) surfaced as a freshness chip +
//  banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol OperationsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogOperationsTelemetry: OperationsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// header chip + banner. `live` hides the banner; `stale` / `offline` show it (the web
/// queries poll continuously; this is the native-idiomatic surfacing of feed health).
public enum OperationsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web `useQuery` results + parent lifecycle)

/// One coalesced snapshot of the panel's inputs — the native mirror of the three web
/// query results (`notifStats`, `notifLogs`, `auditLogs`) plus the parent surface's
/// lifecycle (`isLoading`, an error message, and connectivity). `notifLogs == nil` is
/// "not yet loaded" (the web `EmptyState` "No data available"); `notifLogs == []` is
/// "loaded, none recent" (the web table empty message).
public struct OperationsInput: Sendable, Equatable {
    public var stats: NotificationStatsSnapshot?
    public var notifLogs: [NotificationLogItem]?
    public var auditLogs: [AuditLogItem]?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: OperationsConnection

    public init(
        stats: NotificationStatsSnapshot? = nil,
        notifLogs: [NotificationLogItem]? = nil,
        auditLogs: [AuditLogItem]? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: OperationsConnection = .live
    ) {
        self.stats = stats
        self.notifLogs = notifLogs
        self.auditLogs = auditLogs
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the panel's render branches.
/// `phase` selects the body; the stats snapshot, the (optional) notification-log list,
/// the audit-log list, and the derived success rate / gauge are pre-computed so the
/// view is a pure function of this value.
public struct OperationsResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case error(String)
        case ready
    }

    public let phase: Phase
    public let stats: NotificationStatsSnapshot?
    public let notifLogs: [NotificationLogItem]?
    public let auditLogs: [AuditLogItem]

    public init(
        phase: Phase,
        stats: NotificationStatsSnapshot?,
        notifLogs: [NotificationLogItem]?,
        auditLogs: [AuditLogItem]
    ) {
        self.phase = phase
        self.stats = stats
        self.notifLogs = notifLogs
        self.auditLogs = auditLogs
    }

    /// Whether the delivery block has stats (web `{notifStats && …}`). The section is
    /// always rendered native-side; this flag selects its content vs. its empty state.
    public var hasStats: Bool {
        stats != nil
    }

    /// Whether the notification-log query has resolved with at least one row (web
    /// truthy `notifLogs` with content → the delivery `DataTable`).
    public var hasNotifLogs: Bool {
        (notifLogs?.isEmpty == false)
    }

    /// Whether the notification-log query has resolved at all (web `notifLogs ?`):
    /// `nil` → the "No data available" empty state; a resolved (even empty) list →
    /// the table / "No recent notifications" branch.
    public var notifLogsLoaded: Bool {
        notifLogs != nil
    }

    /// Whether the audit query has any rows (web `auditLogs && auditLogs.length > 0`).
    public var hasAuditLogs: Bool {
        !auditLogs.isEmpty
    }

    /// The notification success rate (web `successRate`), a pure function of the stats.
    public var successRate: Double {
        OperationsSuccessRate.compute(stats)
    }

    /// The badge / gauge tone derived from the success rate (web threshold tone).
    public var successTone: OperationsTone {
        OperationsSuccessRate.tone(for: successRate)
    }

    /// The success rate as a clamped 0…1 fraction for the radial gauge (web
    /// `<RadialGauge value={successRate} max={100} />`).
    public var gaugeFraction: Double {
        min(max(successRate / 100, 0), 1)
    }

    /// The categorical-palette index the success gauge tints with, mapping the web
    /// threshold colour (green `#22c55e` / amber `#f59e0b` / red `#ef4444`) onto the
    /// closest shared brand-palette entries — the precise tone is also carried by the
    /// header badge, which uses the semantic status tokens directly.
    public var gaugeColorIndex: Int {
        switch successTone {
        case .success: 2
        case .warning: 1
        case .danger, .neutral: 5
        }
    }

    /// Whether the header success-rate badge shows (web `{notifStats ? <Badge…> }`).
    public var showStatsBadge: Bool {
        hasStats
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native port
/// of the web component's render branches plus the P4 leaf contract. Unit tested across
/// loading / error / ready and the derived success-rate / gauge values.
public enum OperationsProjection {
    public static func resolve(_ input: OperationsInput) -> OperationsResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return OperationsResolved(phase: .error(message), stats: nil, notifLogs: nil, auditLogs: [])
        }
        // Web `isLoading = statsLoading || logsLoading || auditLoading` → two skeletons.
        if input.isLoading {
            return OperationsResolved(phase: .loading, stats: nil, notifLogs: nil, auditLogs: [])
        }
        return OperationsResolved(
            phase: .ready,
            stats: input.stats,
            notifLogs: input.notifLogs,
            auditLogs: input.auditLogs ?? []
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// notification-stats / notification-logs / audit-logs queries; previews and tests use
/// `InMemoryOperationsSource`. The view never talks to the network directly.
@MainActor
public protocol OperationsSource: AnyObject {
    var onUpdate: (@MainActor (OperationsInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to an `OperationsSource`, recomputes
/// the resolved projection, exposes a render `phase` + the resolved view-state and the
/// `connection` axis, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class OperationsModel {
    public private(set) var resolved: OperationsResolved =
        OperationsProjection.resolve(OperationsInput(isLoading: true))
    public private(set) var connection: OperationsConnection = .live

    public var phase: OperationsResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any OperationsSource
    @ObservationIgnored private let telemetry: any OperationsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any OperationsSource,
        telemetry: any OperationsTelemetry = OSLogOperationsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: OperationsSection.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: OperationsInput) {
        resolved = OperationsProjection.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryOperationsSource: OperationsSource {
    public var onUpdate: (@MainActor (OperationsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: OperationsInput?

    public init(initial: OperationsInput? = nil) {
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
    public func push(_ input: OperationsInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "OperationsSection" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum OperationsStrings {
    public static let table = "OperationsSection"

    /// Resolved `String` for a key (web `t(key, fallback)`). The `LocalizedStringKey`
    /// convenience for shared components lives in `OperationsSection.Views.swift` (the
    /// SwiftUI layer) so this state-holder file stays SwiftUI-free.
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
