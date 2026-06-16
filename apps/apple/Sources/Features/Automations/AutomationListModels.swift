import SwiftUI

// View-ready value types for the `AutomationListPage` parity surface (web
// `web/src/features/automations/pages/AutomationListPage.tsx`) — the streamlined "manage many at
// once" bulk table that co-exists with the card-based `AutomationsListPage`. The row model is the
// shared `AutomationListItem` (same module) so the two automations surfaces agree on the
// `Automation` shape (DRY); only the bulk-operation request/result types live here.

// MARK: - Bulk operation (web `AutomationBulkOp`)

/// The allow-listed bulk operation a selection of automations can be put through — the native
/// mirror of the web `AutomationBulkOp` union (`'enable' | 'disable' | 'delete'`). Identifiable so
/// it backs the toolbar's action buttons; `delete` is the destructive case gated behind a confirm.
public enum AutomationBulkOperation: String, Sendable, Equatable, CaseIterable, Identifiable {
    case enable
    case disable
    case delete

    public var id: String {
        rawValue
    }

    /// The wire value POSTed as `{ op }` to `/automations/bulk` (web `vars.op`).
    public var wireValue: String {
        rawValue
    }

    /// `Localizable.xcstrings` key for the toolbar button label (web action `label`).
    public var labelKey: LocalizedStringKey {
        switch self {
        case .enable: "automationList.bulk.enable"
        case .disable: "automationList.bulk.disable"
        case .delete: "automationList.bulk.delete"
        }
    }

    /// SF Symbol for the button (web `Icons.play` / `Icons.pause` / `Icons.delete`).
    public var systemImage: String {
        switch self {
        case .enable: "play.fill"
        case .disable: "pause.fill"
        case .delete: "trash"
        }
    }

    /// Web `variant: 'danger'` on the delete action — drives the destructive button tone + the
    /// confirmation gate.
    public var isDestructive: Bool {
        self == .delete
    }
}

// MARK: - Bulk result (web `AutomationBulkResult`)

/// One failed id within a bulk operation (web `AutomationBulkResult.failed[]`).
public struct AutomationBulkFailure: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let reason: String

    public init(id: Int64, reason: String) {
        self.id = id
        self.reason = reason
    }
}

/// The outcome of a `POST /automations/bulk` call (web `AutomationBulkResult`): how many rows were
/// updated / deleted, plus the per-id failures. Render-ready so the surface can surface a partial
/// outcome without re-deriving anything.
public struct AutomationBulkOutcome: Sendable, Equatable {
    public let updated: Int
    public let deleted: Int
    public let failed: [AutomationBulkFailure]

    public init(updated: Int = 0, deleted: Int = 0, failed: [AutomationBulkFailure] = []) {
        self.updated = max(0, updated)
        self.deleted = max(0, deleted)
        self.failed = failed
    }

    /// Whether any id failed — gates the partial-failure emphasis (web `result.failed.length`).
    public var hasFailures: Bool {
        !failed.isEmpty
    }
}

// MARK: - Select-all state (web `useBulkSelection.masterState`)

/// The header select-all checkbox state for the visible rows (web `masterState(visibleIds)`):
/// `none` (no visible row selected), `some` (an indeterminate subset), or `all`. Drives the
/// select-all glyph (empty / dash / filled).
public enum AutomationSelectAllState: String, Sendable, Equatable {
    case none
    case some
    case all
}

// MARK: - Row status (web `a.enabled` badge branch)

/// The per-row status badge state (web `a.enabled ? <Badge success/> : <Badge neutral/>`). Drives
/// the badge label key + tone in the table.
public enum AutomationRowStatus: String, Sendable, Equatable {
    case enabled
    case disabled

    /// `Localizable.xcstrings` key (web `common.enabled` / `common.disabled`).
    public var labelKey: LocalizedStringKey {
        switch self {
        case .enabled: "common.enabled"
        case .disabled: "common.disabled"
        }
    }
}

public extension AutomationListItem {
    /// Web `a.enabled` status-badge branch for the list table.
    var rowStatus: AutomationRowStatus {
        enabled ? .enabled : .disabled
    }

    /// Web `a.description ?? '—'` table cell.
    var descriptionText: String {
        description ?? "—"
    }

    /// Web `a.execution_count ?? 0` table cell, formatted for display.
    var runsText: String {
        executionCount.formatted(.number)
    }
}
