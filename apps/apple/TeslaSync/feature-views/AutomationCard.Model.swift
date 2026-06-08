//
//  AutomationCard.Model.swift
//  TeslaSync — P4 feature view · 0082 · AutomationCard (Apple)
//
//  Surface identity (P1/S11 diagnostics slug), telemetry seam (P1/S11 `view.opened`),
//  i18n facade (P1/S10), and the pure input value types for the SwiftUI parity of
//  web/src/features/automations/pages/AutomationCard.tsx.
//
//  The web component is purely presentational: it receives one `automation`
//  (the S8 `Automation` shape), the live `isFiring` flag, an optional
//  `vehicleName`, and four callbacks (onToggle / onReEnable / onDelete /
//  onTestRun). It performs no I/O and uses only `useTranslation`. The native
//  surface mirrors that exactly: it binds no store and does no networking — the
//  parent list surface (AutomationsPage) maps the shared S8 `Automation` holder
//  into `AutomationCardData` and supplies the callbacks. Keys arrive snake_case
//  from `GET /api/v1/automations`; the value type carries only the fields this
//  card reads.
//

import Foundation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `AutomationCard` feature view. The
/// slug is the value emitted with the P1/S11 `view.opened` diagnostics contract
/// and is referenced by both the view and its tests so the two never drift.
public enum AutomationCardSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "AutomationCard"

    /// Reports the surface becoming visible. Factored out of the view's `.task`
    /// so it is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any AutomationCardTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The view reports its
/// appearance through this protocol so production wiring, previews, and tests can
/// each supply their own sink. It is `Sendable` (members non-isolated) so the
/// view can emit from its `.task` without a main-actor hop.
public protocol AutomationCardTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is
/// a static, non-identifying constant logged verbatim; no automation name, VIN,
/// or payload is ever recorded.
public struct OSLogAutomationCardTelemetry: AutomationCardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default[, { name }])`

/// Resolves the surface's strings by key with the web English fallback so the
/// view holds no hardcoded literals. Keys live in the "AutomationCard" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time. The
/// web source keys (`automations.*`, `common.cancel`) are preserved verbatim so a
/// shared catalog resolves identically across web and native.
public enum AutomationCardStrings {
    public static let table = "AutomationCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-interpolated string (web i18next `{{name}}`).
    public static func format(_ key: String, _ fallbackFormat: String, _ argument: String) -> String {
        String(format: string(key, fallbackFormat), argument)
    }
}

// MARK: - Conflict input (web `AutomationConflict`)

/// One potential clash flagged on an automation — the port of the web
/// `AutomationConflict` (the subset the card renders: the other automation's
/// name, the human reason, and the severity that drives the row tint).
public struct AutomationConflictData: Equatable, Sendable, Identifiable {
    /// The conflicting automation's id — stable identity for the rendered row.
    public let id: Int64
    /// The conflicting automation's display name (server text, rendered verbatim).
    public let automationName: String
    /// The human-readable reason (server text, rendered verbatim).
    public let reason: String
    /// The raw severity string (`"warning"` ⇒ amber; anything else ⇒ info/blue),
    /// matching the web `c.severity === 'warning' ? … : …` branch.
    public let severity: String

    public init(id: Int64, automationName: String, reason: String, severity: String) {
        self.id = id
        self.automationName = automationName
        self.reason = reason
        self.severity = severity
    }
}

// MARK: - Card input (web `props.automation` + isFiring + vehicleName)

/// The pure, `Equatable` input for one `AutomationCard` — the projection of the
/// shared S8 `Automation` plus the two presentational props the web card takes
/// (`isFiring`, `vehicleName`). The parent maps the store row into this; the card
/// never touches the network.
public struct AutomationCardData: Equatable, Sendable, Identifiable {
    public let id: Int64
    public let name: String
    public let description: String?
    public let enabled: Bool
    public let autoDisabled: Bool
    public let autoDisabledReason: String?
    public let lastTriggeredAt: String?
    public let executionCount: Int64
    public let failureCount: Int64
    public let nextFireTime: String?
    public let conflicts: [AutomationConflictData]
    /// Live SSE flag (web `isFiring`) — the automation is currently executing.
    public let isFiring: Bool
    /// The bound vehicle's display name, or `nil` for an all-vehicles automation
    /// (web `vehicleName` prop).
    public let vehicleName: String?
    /// Whether the row is pinned — the native port of the embedded web
    /// `<PinButton itemType="automation" itemId={a.id} />`.
    public let isPinned: Bool

    public init(
        id: Int64,
        name: String,
        description: String? = nil,
        enabled: Bool = false,
        autoDisabled: Bool = false,
        autoDisabledReason: String? = nil,
        lastTriggeredAt: String? = nil,
        executionCount: Int64 = 0,
        failureCount: Int64 = 0,
        nextFireTime: String? = nil,
        conflicts: [AutomationConflictData] = [],
        isFiring: Bool = false,
        vehicleName: String? = nil,
        isPinned: Bool = false
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.enabled = enabled
        self.autoDisabled = autoDisabled
        self.autoDisabledReason = autoDisabledReason
        self.lastTriggeredAt = lastTriggeredAt
        self.executionCount = executionCount
        self.failureCount = failureCount
        self.nextFireTime = nextFireTime
        self.conflicts = conflicts
        self.isFiring = isFiring
        self.vehicleName = vehicleName
        self.isPinned = isPinned
    }
}

// MARK: - Freshness (live / stale / offline) for the live firing flag

/// Freshness of the live `isFiring` signal (web SSE-driven), mirroring
/// `LiveConnectionState` (ADR-013). The card keeps its cached content visible and
/// swaps the live firing pulse for a stale/offline chip, never hiding the row.
public enum AutomationLiveConnection: Equatable, Sendable {
    case live
    case stale
    case offline

    /// Only a `live` connection animates the firing pulse; stale/offline downgrade
    /// it to a static chip so the UI never implies fresh activity it cannot prove.
    public var showsLiveFiringPulse: Bool {
        self == .live
    }
}

// MARK: - Card state (every state renders — no hidden surfaces)

/// The render state for one `AutomationCard`. The web card is always `loaded`;
/// the native surface additionally renders the load/empty/error chrome required
/// of every P4 surface so the parent never has to special-case a single row.
public enum AutomationCardState: Equatable, Sendable {
    /// Initial fetch of the row's automation — skeleton chrome.
    case loading
    /// Resolved with no automation to show — friendly empty state, never blank.
    case empty
    /// The row's automation failed to load — message + retry affordance.
    case error(message: String?)
    /// The automation resolved — the full card with every web branch.
    case loaded(AutomationCardData)

    /// The resolved automation, if any (convenience for the view/tests).
    public var automation: AutomationCardData? {
        if case let .loaded(data) = self { return data }
        return nil
    }
}

// MARK: - Action seam (web `onToggle` / `onReEnable` / `onDelete` / `onTestRun`)

/// The callbacks the card invokes — the native port of the web card's four
/// required props plus the two menu items the web renders inert (Duplicate /
/// Export close the menu with no handler) and an optional retry for the native
/// error state. No mutation logic lives in the card: the parent owns the
/// store-backed effects, exactly like the web component. A plain value bag (used
/// from the MainActor view and constructed directly in tests).
public struct AutomationCardActions {
    public let onToggle: (Int64, Bool) -> Void
    public let onReEnable: (Int64) -> Void
    public let onDelete: (Int64) -> Void
    public let onTestRun: (Int64) -> Void
    public let onDuplicate: (Int64) -> Void
    public let onExport: (Int64) -> Void
    public let onTogglePin: (Int64) -> Void
    public let onRetry: () -> Void

    public init(
        onToggle: @escaping (Int64, Bool) -> Void,
        onReEnable: @escaping (Int64) -> Void,
        onDelete: @escaping (Int64) -> Void,
        onTestRun: @escaping (Int64) -> Void,
        onDuplicate: @escaping (Int64) -> Void = { _ in },
        onExport: @escaping (Int64) -> Void = { _ in },
        onTogglePin: @escaping (Int64) -> Void = { _ in },
        onRetry: @escaping () -> Void = {}
    ) {
        self.onToggle = onToggle
        self.onReEnable = onReEnable
        self.onDelete = onDelete
        self.onTestRun = onTestRun
        self.onDuplicate = onDuplicate
        self.onExport = onExport
        self.onTogglePin = onTogglePin
        self.onRetry = onRetry
    }

    /// Resolves the web `handleToggle` branch: when the automation is
    /// auto-disabled and the user flips it on, the web calls `onReEnable`;
    /// otherwise it calls `onToggle(id, checked)`.
    public func dispatchToggle(_ intent: AutomationToggleIntent) {
        switch intent {
        case let .toggle(id, enabled): onToggle(id, enabled)
        case let .reEnable(id): onReEnable(id)
        }
    }
}
