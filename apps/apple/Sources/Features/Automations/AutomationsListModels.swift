import Foundation

// View-ready value types for the `AutomationsListPage` parity surface (web
// `web/src/features/automations/pages/AutomationsListPage.tsx` + its `AutomationCard`).
// Every field is render-ready so the view body holds no business logic. Date / relative-time
// formatting reuses the sibling `AutomationActivityFormat` ports (same module) so the two
// automations surfaces share one localized formatting seam (DRY).

// MARK: - UI status (web `getUIStatus` / `statusStyles`)

/// The three card statuses the web derives per automation (`auto_disabled` → disabled →
/// active). Drives the status badge label key + tone.
public enum AutomationUIStatus: String, Sendable, Equatable, CaseIterable {
    case active
    case disabled
    case autoDisabled

    /// `Localizable.xcstrings` key for the status badge (web `automations.status.{uiStatus}`,
    /// whose auto-disabled key keeps the web hyphen).
    public var labelKey: String {
        switch self {
        case .active: "automations.status.active"
        case .disabled: "automations.status.disabled"
        case .autoDisabled: "automations.status.auto-disabled"
        }
    }
}

// MARK: - Status filter (web `StatusFilter` + `statusFilterOptions`)

/// The status filter options (web `statusFilterOptions`). Identifiable so it backs a `Picker`.
public enum AutomationStatusFilter: String, Sendable, Equatable, CaseIterable, Identifiable {
    case all
    case active
    case disabled
    case autoDisabled

    public var id: String {
        rawValue
    }

    /// `Localizable.xcstrings` key (web `automations.filters.{value}`).
    public var labelKey: String {
        switch self {
        case .all: "automations.filters.all"
        case .active: "automations.filters.active"
        case .disabled: "automations.filters.disabled"
        case .autoDisabled: "automations.filters.autoDisabled"
        }
    }
}

// MARK: - Conflict (web `AutomationConflict`)

/// One automation conflict (web `AutomationConflict`): a peer name + reason + severity. The
/// severity selects the inline callout tone (web amber for warning, blue for info).
public struct AutomationConflictInfo: Identifiable, Sendable, Equatable {
    public enum Severity: String, Sendable, Equatable {
        case warning
        case info
    }

    public let id: String
    public let automationName: String
    public let reason: String
    public let severity: Severity

    public init(id: String, automationName: String, reason: String, severity: Severity) {
        self.id = id
        self.automationName = automationName
        self.reason = reason
        self.severity = severity
    }
}

// MARK: - Vehicle lookup + pins

/// A vehicle reference (web `useVehicles` → `{ id, display_name }`) used to label cards.
public struct AutomationVehicleRef: Identifiable, Sendable, Equatable {
    public let id: Int64
    public let displayName: String

    public init(id: Int64, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

/// One pin entry (web `usePinned('automation')` → `{ item_id, position }`) used to order cards.
public struct AutomationPin: Sendable, Equatable {
    public let itemID: String
    public let position: Int

    public init(itemID: String, position: Int) {
        self.itemID = itemID
        self.position = position
    }
}

// MARK: - List item (web `Automation` fields the card renders)

/// One automation row (the `Automation` fields the web `AutomationCard` renders): identity,
/// enablement, the auto-disabled outcome + reason, run counters, last-run / next-fire times,
/// and any conflicts. Render-ready, so the card view holds no logic.
public struct AutomationListItem: Identifiable, Sendable, Equatable {
    public let id: Int64
    public let name: String
    public let description: String?
    public let vehicleID: Int64?
    public let enabled: Bool
    public let autoDisabled: Bool
    public let autoDisabledReason: String?
    public let executionCount: Int
    public let failureCount: Int
    public let lastTriggeredAt: Date?
    public let nextFireTime: Date?
    public let conflicts: [AutomationConflictInfo]

    public init(
        id: Int64,
        name: String,
        description: String? = nil,
        vehicleID: Int64? = nil,
        enabled: Bool = false,
        autoDisabled: Bool = false,
        autoDisabledReason: String? = nil,
        executionCount: Int = 0,
        failureCount: Int = 0,
        lastTriggeredAt: Date? = nil,
        nextFireTime: Date? = nil,
        conflicts: [AutomationConflictInfo] = []
    ) {
        self.id = id
        self.name = name
        self.description = Self.normalized(description)
        self.vehicleID = vehicleID
        self.enabled = enabled
        self.autoDisabled = autoDisabled
        self.autoDisabledReason = Self.normalized(autoDisabledReason)
        self.executionCount = max(0, executionCount)
        self.failureCount = max(0, failureCount)
        self.lastTriggeredAt = lastTriggeredAt
        self.nextFireTime = nextFireTime
        self.conflicts = conflicts
    }

    /// Web `getUIStatus(a)`.
    public var status: AutomationUIStatus {
        if autoDisabled { return .autoDisabled }
        if !enabled { return .disabled }
        return .active
    }

    /// Web `Toggle checked={a.auto_disabled ? false : a.enabled}`.
    public var toggleIsOn: Bool {
        autoDisabled ? false : enabled
    }

    /// Web `last_triggered_at` time-ago, or the absent sentinel when never run.
    public var lastRunText: String {
        guard let date = lastTriggeredAt else { return AutomationActivityFormat.dash }
        return AutomationActivityFormat.relative(for: date)
    }

    /// Web `failure_count > 0` gate for the fails chip.
    public var showsFailures: Bool {
        failureCount > 0
    }

    /// Returns a copy with selected fields changed — the optimistic-update seam the model uses
    /// to reflect a toggle / re-enable before the source round-trip resolves.
    public func updating(
        enabled: Bool? = nil,
        autoDisabled: Bool? = nil,
        clearAutoDisabledReason: Bool = false
    ) -> AutomationListItem {
        AutomationListItem(
            id: id,
            name: name,
            description: description,
            vehicleID: vehicleID,
            enabled: enabled ?? self.enabled,
            autoDisabled: autoDisabled ?? self.autoDisabled,
            autoDisabledReason: clearAutoDisabledReason ? nil : autoDisabledReason,
            executionCount: executionCount,
            failureCount: failureCount,
            lastTriggeredAt: lastTriggeredAt,
            nextFireTime: nextFireTime,
            conflicts: conflicts
        )
    }

    static func normalized(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }
}

// MARK: - Stats (web `computeStats`)

/// The four header stats (web `computeStats`): the total plus the active / disabled /
/// auto-disabled split. Identical precedence to the web reducer (auto-disabled wins, then
/// enabled, then disabled).
public struct AutomationListStats: Sendable, Equatable {
    public let total: Int
    public let active: Int
    public let disabled: Int
    public let autoDisabled: Int

    public init(total: Int, active: Int, disabled: Int, autoDisabled: Int) {
        self.total = total
        self.active = active
        self.disabled = disabled
        self.autoDisabled = autoDisabled
    }

    /// Web `computeStats(automations)`.
    public static func compute(_ items: [AutomationListItem]) -> AutomationListStats {
        var active = 0
        var disabled = 0
        var autoDisabled = 0
        for item in items {
            switch item.status {
            case .autoDisabled: autoDisabled += 1
            case .active: active += 1
            case .disabled: disabled += 1
            }
        }
        return AutomationListStats(
            total: items.count,
            active: active,
            disabled: disabled,
            autoDisabled: autoDisabled
        )
    }

    /// Web `stats.autoDisabled > 0` — gates the warning banner + the danger emphasis.
    public var hasAutoDisabled: Bool {
        autoDisabled > 0
    }
}

// MARK: - Import (web `AutomationImportEnvelope` + `isAutomationImportEnvelope`)

/// A failed typed-import outcome (web import `catch`). Each case resolves a localized message
/// key for the surfaced alert.
public enum AutomationImportError: Error, Equatable {
    case unreadable
    case typedEnvelopeRequired

    /// `Localizable.xcstrings` key for the alert body.
    public var messageKey: String {
        switch self {
        case .unreadable: "automations.importUnknownError"
        case .typedEnvelopeRequired: "automations.importTypedEnvelopeRequired"
        }
    }
}

/// A validated typed-automation export (web `AutomationImportEnvelope`). The web guard
/// `isAutomationImportEnvelope` only accepts `{ version: number, automations: array }`; the
/// raw bytes are preserved so the production source can POST them to `/automations/import`.
public struct AutomationImportEnvelope: Sendable, Equatable {
    public let version: Int
    public let exportedAt: String?
    public let automationCount: Int
    public let rawData: Data

    public init(version: Int, exportedAt: String?, automationCount: Int, rawData: Data) {
        self.version = version
        self.exportedAt = exportedAt
        self.automationCount = automationCount
        self.rawData = rawData
    }

    /// Web `JSON.parse(text)` + `isAutomationImportEnvelope(data)`: a parse failure is the
    /// unknown-error case; a successful parse that is not a `{ version: number, automations:
    /// array }` record is the typed-envelope-required rejection (never translated).
    public static func parse(_ data: Data) throws -> AutomationImportEnvelope {
        guard let object = try? JSONSerialization.jsonObject(with: data) else {
            throw AutomationImportError.unreadable
        }
        guard
            let dict = object as? [String: Any],
            let version = dict["version"] as? NSNumber,
            let automations = dict["automations"] as? [Any]
        else {
            throw AutomationImportError.typedEnvelopeRequired
        }
        return AutomationImportEnvelope(
            version: version.intValue,
            exportedAt: dict["exported_at"] as? String,
            automationCount: automations.count,
            rawData: data
        )
    }
}

// MARK: - Next-fire formatting (web `formatDateTime`)

/// Localized formatting for the card's next-fire time (web `formatDateTime`), kept beside the
/// list models so the view stays declarative.
public enum AutomationListFormat {
    /// Web `formatDateTime(next_fire_time)` — an OS-localized abbreviated date + short time.
    public static func dateTime(_ date: Date?, locale: Locale = .current) -> String? {
        guard let date else { return nil }
        return date.formatted(
            .dateTime.locale(locale).month(.abbreviated).day().hour().minute()
        )
    }
}
