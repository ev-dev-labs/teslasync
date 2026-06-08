//
//  AlertCard.Model.swift
//  TeslaSync — P4 feature view · 0179 · AlertCard (Apple)
//
//  Surface identity (P1/S11 diagnostics slug), telemetry seam (P1/S11 `view.opened`),
//  i18n facade (P1/S10), and the pure input value types for the SwiftUI parity of
//  web/src/features/notifications/components/AlertCard.tsx.
//
//  The web component is purely presentational: it receives one `alert` (the S8
//  `Alert` shape) and four callbacks (onMarkRead / onAcknowledge / onOpenDetail /
//  onReopen) plus a `t` translator. It performs no I/O. The native surface mirrors
//  that exactly: it binds no store and does no networking — the parent list
//  surface (AlertsListPage) maps the shared S8 `Alert` holder into `AlertCardData`
//  and supplies the callbacks. Keys arrive snake_case from `GET /api/v1/alerts`;
//  the value type carries only the fields this card reads.
//

import Foundation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `AlertCard` feature view. The slug is
/// the value emitted with the P1/S11 `view.opened` diagnostics contract and is
/// referenced by both the view and its tests so the two never drift.
public enum AlertCardSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "AlertCard"

    /// Reports the surface becoming visible. Factored out of the view's `.task`
    /// so it is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any AlertCardTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The view reports its
/// appearance through this protocol so production wiring, previews, and tests can
/// each supply their own sink. It is `Sendable` (members non-isolated) so the view
/// can emit from its `.task` without a main-actor hop.
public protocol AlertCardTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is
/// a static, non-identifying constant logged verbatim; no alert title, message,
/// VIN, or actor is ever recorded.
public struct OSLogAlertCardTelemetry: AlertCardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default[, { actor }])`

/// Resolves the surface's strings by key with the web English fallback so the view
/// holds no hardcoded literals. Keys live in the "AlertCard" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time. The web source keys
/// (`alerts.*`, `Unread`, `Mark read`) are preserved verbatim so a shared catalog
/// resolves identically across web and native.
public enum AlertCardStrings {
    public static let table = "AlertCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-interpolated string (web i18next `{{actor}}`).
    public static func format(_ key: String, _ fallbackFormat: String, _ argument: String) -> String {
        String(format: string(key, fallbackFormat), argument)
    }
}

// MARK: - Card input (web `props.alert`)

/// The pure, `Equatable` input for one `AlertCard` — the projection of the shared
/// S8 `Alert`. The parent maps the store row into this; the card never touches the
/// network. Only the fields the web card reads are carried (plus the two
/// drill-through fields `getAlertDrillthroughHref` consumes).
public struct AlertCardData: Equatable, Sendable, Identifiable {
    public let id: Int64
    /// Free-form alert type slug (web `alert.type`, e.g. `geofence_exit`).
    public let type: String
    /// Raw wire severity (web `alert.severity`, e.g. `info`/`warning`/`critical`).
    public let severity: String
    public let title: String
    public let message: String
    public let isRead: Bool
    /// ISO-8601 creation timestamp (web `alert.created_at`, drives `timeAgo`).
    public let createdAt: String
    /// Acknowledgement state (web `alert.acknowledged_at` / `acknowledged_by`).
    public let acknowledgedAt: String?
    public let acknowledgedBy: String?
    /// Drill-through context the web `getAlertDrillthroughHref` reads.
    public let vehicleID: Int64
    public let ruleSignal: String?

    public init(
        id: Int64,
        type: String,
        severity: String,
        title: String,
        message: String,
        isRead: Bool = false,
        createdAt: String,
        acknowledgedAt: String? = nil,
        acknowledgedBy: String? = nil,
        vehicleID: Int64 = 0,
        ruleSignal: String? = nil
    ) {
        self.id = id
        self.type = type
        self.severity = severity
        self.title = title
        self.message = message
        self.isRead = isRead
        self.createdAt = createdAt
        self.acknowledgedAt = acknowledgedAt
        self.acknowledgedBy = acknowledgedBy
        self.vehicleID = vehicleID
        self.ruleSignal = ruleSignal
    }

    /// Web `isAcked = Boolean(alert.acknowledged_at)`.
    public var isAcknowledged: Bool {
        guard let acknowledgedAt else { return false }
        return !acknowledgedAt.isEmpty
    }
}

// MARK: - Freshness (live / stale / offline) for the alert inbox stream

/// Freshness of the live alert stream feeding this row (web SSE-driven inbox),
/// mirroring `LiveConnectionState` (ADR-013). The card always keeps its cached
/// content visible and surfaces a stale/offline chip rather than hiding the row,
/// satisfying the P4 stale/offline state requirement for an otherwise pure card.
public enum AlertLiveConnection: Equatable, Sendable {
    case live
    case stale
    case offline

    /// Whether the inbox stream is current; `stale`/`offline` show a chip.
    public var isFresh: Bool {
        self == .live
    }
}

// MARK: - Card state (every state renders — no hidden surfaces)

/// The render state for one `AlertCard`. The web card is always `loaded`; the
/// native surface additionally renders the load/empty/error chrome required of
/// every P4 surface so the parent never has to special-case a single row.
public enum AlertCardState: Equatable, Sendable {
    /// Initial fetch of the row's alert — skeleton chrome.
    case loading
    /// Resolved with no alert to show — friendly empty state, never blank.
    case empty
    /// The row's alert failed to load — message + retry affordance.
    case error(message: String?)
    /// The alert resolved — the full card with every web branch.
    case loaded(AlertCardData)

    /// The resolved alert, if any (convenience for the view/tests).
    public var alert: AlertCardData? {
        if case let .loaded(data) = self { return data }
        return nil
    }
}

// MARK: - Action seam (web `onMarkRead` / `onAcknowledge` / `onOpenDetail` / `onReopen`)

/// The callbacks the card invokes — the native port of the web card's four
/// required props plus the drill-through navigation the web expresses as a
/// `<Link to={drillHref}>` (native has no router, so the resolved target is
/// handed to the parent) and an optional retry for the native error state. No
/// mutation logic lives in the card: the parent owns the store-backed effects,
/// exactly like the web component. A plain value bag (used from the MainActor
/// view and constructed directly in tests).
public struct AlertCardActions {
    public let onMarkRead: (Int64) -> Void
    public let onAcknowledge: (Int64) -> Void
    public let onOpenDetail: (Int64) -> Void
    public let onReopen: (Int64) -> Void
    /// Web `<Link to={getAlertDrillthroughHref(alert)}>` — the parent navigates to
    /// the resolved drill-through target (the card computes it, like the web does).
    public let onViewContext: (AlertDrillthrough) -> Void
    public let onRetry: () -> Void

    public init(
        onMarkRead: @escaping (Int64) -> Void,
        onAcknowledge: @escaping (Int64) -> Void,
        onOpenDetail: @escaping (Int64) -> Void,
        onReopen: @escaping (Int64) -> Void,
        onViewContext: @escaping (AlertDrillthrough) -> Void = { _ in },
        onRetry: @escaping () -> Void = {}
    ) {
        self.onMarkRead = onMarkRead
        self.onAcknowledge = onAcknowledge
        self.onOpenDetail = onOpenDetail
        self.onReopen = onReopen
        self.onViewContext = onViewContext
        self.onRetry = onRetry
    }
}
