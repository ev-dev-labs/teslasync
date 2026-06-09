//
//  ScheduledExportsPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0262 · ScheduledExportsPanel (Apple)
//
//  The testable projection core for the scheduled-exports panel — the faithful port of
//  features/system/pages/ScheduledExportsPanel.tsx and the `useExports` wire types it
//  binds to (`ScheduledExport`, `ScheduledExportInput`, `ScheduledExportDelivery`).
//  Everything here is pure and dependency-free (Foundation only) so the enums, the
//  display-ready row, the editable form-state, the submit normalisation (drop the
//  delivery target for `download`, trim it otherwise), the option catalogs, and the
//  render-phase resolution are all unit-tested without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web panel has three render branches inside the glass panel — loading
//      (three `Skeleton` bars), empty (`EmptyState`), and the populated table — plus an
//      inline new/edit `<form>` and a delete `ConfirmDialog`. `resolvePhase` reproduces
//      loading / empty / content, widened with the prompt-required error envelope so a
//      first-load failure is never a blank panel.
//    • Client-side validation is deliberately minimal (the server owns it): the form is
//      submittable once name + cron are present and a non-download delivery has a target,
//      mirroring the web `required` attributes.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the
/// dependency-free core so the projection's unit tests can reach it.
public enum ScheduledExportsSurface {
    public static let slug = "ScheduledExportsPanel"
}

// MARK: - Option protocol (web `<Select>` option catalog)

/// A localizable, enumerable form option — the shared shape behind the three form
/// dropdowns (export type / format / delivery kind) so the SwiftUI picker is written once
/// and bound generically (DRY). Each case carries an i18n key + the web English fallback.
public protocol ScheduledExportOption: CaseIterable, Hashable, Sendable {
    var labelKey: String { get }
    var labelFallback: String { get }
}

// MARK: - Wire enums (web `ScheduledExport` discriminators)

/// The export dataset a schedule emits (web `ScheduledExport['export_type']`). The raw
/// value is the API token carried verbatim; the label resolves through the injected
/// P1/S10 localizer so the view holds no hardcoded English.
public enum ScheduledExportType: String, ScheduledExportOption {
    case drives
    case charging
    case trips
    case positions
    case signals

    /// The per-option i18n key (`dataExport.scheduled.exportType.<raw>`).
    public var labelKey: String {
        "dataExport.scheduled.exportType.\(rawValue)"
    }

    /// The web fallback label — the raw token, exactly as the web `<Select>` renders it.
    public var labelFallback: String {
        rawValue
    }
}

/// The serialisation format (web `ScheduledExport['format']`).
public enum ScheduledExportFormat: String, ScheduledExportOption {
    case csv
    case json

    public var labelKey: String {
        "dataExport.scheduled.format.\(rawValue)"
    }

    public var labelFallback: String {
        rawValue
    }
}

/// How a finished export is delivered (web `ScheduledExportDelivery['kind']`). `download`
/// keeps the artifact server-side; `email` / `webhook` require a `target`.
public enum ScheduledExportDeliveryKind: String, ScheduledExportOption {
    case download
    case email
    case webhook

    public var labelKey: String {
        "dataExport.scheduled.deliveryKind.\(rawValue)"
    }

    public var labelFallback: String {
        rawValue
    }

    /// Whether this kind needs a delivery target (web `delivery.kind !== 'download'`).
    public var requiresTarget: Bool {
        self != .download
    }
}

/// The outcome of a schedule's last run (web `ScheduledExport['last_status']`). `nil`
/// upstream (never run) is modelled as an absent value, not a case.
public enum ScheduledExportRunStatus: String, Sendable, Equatable, Hashable {
    case ok
    case failed
}

// MARK: - Delivery (web typed JSONB `delivery`)

/// The delivery dispatcher attached to a schedule — the native mirror of the web
/// `ScheduledExportDelivery`. `target` is required for `email` / `webhook`; for
/// `download` it is silently ignored (and dropped on write).
public struct ScheduledExportDelivery: Sendable, Equatable, Hashable {
    public var kind: ScheduledExportDeliveryKind
    public var target: String?

    public init(kind: ScheduledExportDeliveryKind, target: String? = nil) {
        self.kind = kind
        self.target = target
    }

    /// The trailing "→ target" fragment the web row appends (`row.delivery.target ?
    /// ' → ' + target : ''`), or `nil` when there is no target to show.
    public var targetSuffix: String? {
        guard let target, !target.isEmpty else { return nil }
        return target
    }
}

// MARK: - Display-ready row (web `ScheduledExport`)

/// One scheduled export — the native parity of a web `ScheduledExport` table row. Times
/// are resolved `Date?` (the web carries ISO-8601 strings, always UTC); nullable columns
/// stay optional so the view picks the em-dash / "Never" fallbacks explicitly.
public struct ScheduledExportItem: Sendable, Equatable, Identifiable {
    public let id: Int
    public let name: String
    public let exportType: ScheduledExportType
    public let format: ScheduledExportFormat
    public let vehicleID: Int?
    public let columns: [String]?
    public let scheduleCron: String
    public let delivery: ScheduledExportDelivery
    public let rangeWindow: String
    public let enabled: Bool
    public let lastRunAt: Date?
    public let lastStatus: ScheduledExportRunStatus?
    public let nextRunAt: Date?
    public let lastError: String?

    public init(
        id: Int,
        name: String,
        exportType: ScheduledExportType,
        format: ScheduledExportFormat,
        vehicleID: Int? = nil,
        columns: [String]? = nil,
        scheduleCron: String,
        delivery: ScheduledExportDelivery,
        rangeWindow: String,
        enabled: Bool,
        lastRunAt: Date? = nil,
        lastStatus: ScheduledExportRunStatus? = nil,
        nextRunAt: Date? = nil,
        lastError: String? = nil
    ) {
        self.id = id
        self.name = name
        self.exportType = exportType
        self.format = format
        self.vehicleID = vehicleID
        self.columns = columns
        self.scheduleCron = scheduleCron
        self.delivery = delivery
        self.rangeWindow = rangeWindow
        self.enabled = enabled
        self.lastRunAt = lastRunAt
        self.lastStatus = lastStatus
        self.nextRunAt = nextRunAt
        self.lastError = lastError
    }

    /// The web "Type" cell: `{export_type} ({format})`, both arms resolved through the
    /// injected localizer so the proper-noun-ish tokens stay translatable.
    public func typeFormatLabel(localize: (String, String) -> String) -> String {
        let type = localize(exportType.labelKey, exportType.labelFallback)
        let fmt = localize(format.labelKey, format.labelFallback)
        return "\(type) (\(fmt))"
    }

    /// The web "Delivery" cell: the kind, plus an optional "→ target" suffix.
    public func deliveryLabel(localize: (String, String) -> String) -> String {
        let kind = localize(delivery.kind.labelKey, delivery.kind.labelFallback)
        if let suffix = delivery.targetSuffix {
            return "\(kind) → \(suffix)"
        }
        return kind
    }
}

// MARK: - Editable form-state (web `ScheduledExportInput`)

/// The inline new/edit form's editable state — the native mirror of the web
/// `ScheduledExportInput` plus the flattened `delivery` the form binds field-by-field.
/// `emptyInput` / `from(_:)` reproduce the web `emptyInput()` / `inputFromRow()` seeds.
public struct ScheduledExportFormState: Sendable, Equatable {
    public var name: String
    public var exportType: ScheduledExportType
    public var format: ScheduledExportFormat
    public var vehicleID: Int?
    public var columns: [String]?
    public var scheduleCron: String
    public var deliveryKind: ScheduledExportDeliveryKind
    public var deliveryTarget: String
    public var rangeWindow: String
    public var enabled: Bool

    public init(
        name: String,
        exportType: ScheduledExportType,
        format: ScheduledExportFormat,
        vehicleID: Int? = nil,
        columns: [String]? = nil,
        scheduleCron: String,
        deliveryKind: ScheduledExportDeliveryKind,
        deliveryTarget: String,
        rangeWindow: String,
        enabled: Bool
    ) {
        self.name = name
        self.exportType = exportType
        self.format = format
        self.vehicleID = vehicleID
        self.columns = columns
        self.scheduleCron = scheduleCron
        self.deliveryKind = deliveryKind
        self.deliveryTarget = deliveryTarget
        self.rangeWindow = rangeWindow
        self.enabled = enabled
    }

    /// The web `emptyInput()` seed: a weekly drives CSV download with a 7-day window.
    public static func empty() -> ScheduledExportFormState {
        ScheduledExportFormState(
            name: "",
            exportType: .drives,
            format: .csv,
            vehicleID: nil,
            columns: nil,
            scheduleCron: "0 9 * * 0",
            deliveryKind: .download,
            deliveryTarget: "",
            rangeWindow: "7d",
            enabled: true
        )
    }

    /// The web `inputFromRow(row)` seed used when editing an existing schedule.
    public static func from(_ item: ScheduledExportItem) -> ScheduledExportFormState {
        ScheduledExportFormState(
            name: item.name,
            exportType: item.exportType,
            format: item.format,
            vehicleID: item.vehicleID,
            columns: item.columns,
            scheduleCron: item.scheduleCron,
            deliveryKind: item.delivery.kind,
            deliveryTarget: item.delivery.target ?? "",
            rangeWindow: item.rangeWindow,
            enabled: item.enabled
        )
    }

    /// Whether the delivery-target field is shown + required (web
    /// `form.delivery.kind !== 'download'`).
    public var requiresDeliveryTarget: Bool {
        deliveryKind.requiresTarget
    }

    /// Whether the form can be submitted — name + cron present, and a non-download
    /// delivery has a non-blank target (the web `required` attributes; the server owns
    /// the deep validation).
    public var isSubmittable: Bool {
        guard !name.trimmed.isEmpty, !scheduleCron.trimmed.isEmpty else { return false }
        if requiresDeliveryTarget, deliveryTarget.trimmed.isEmpty { return false }
        return true
    }

    /// The normalised delivery the web `submit` builds: drop the target for `download`
    /// (so an unused string never round-trips), trim it otherwise.
    public func normalizedDelivery() -> ScheduledExportDelivery {
        if deliveryKind == .download {
            return ScheduledExportDelivery(kind: .download, target: nil)
        }
        return ScheduledExportDelivery(kind: deliveryKind, target: deliveryTarget.trimmed)
    }
}

// MARK: - Render phase / load status / freshness

/// What the panel body renders. The web splits loading / empty / table; the error
/// envelope is added so a first-load failure with no cached rows is never a blank panel.
public enum ScheduledExportsPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

/// The bound source's load status for the schedules query (web `isLoading` / resolved /
/// failure).
public enum ScheduledExportsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner
/// so a cached list is clearly labeled while reconnecting / offline.
public enum ScheduledExportsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free resolution from the bound source's load status + row count to the
/// body render phase. Cached rows survive a refresh / failure (freshness shown by the
/// banner, the failure surfaced inline), matching the web table that keeps the last list
/// on screen while a refetch is in flight.
public enum ScheduledExportsProjection {
    public static func resolvePhase(
        status: ScheduledExportsLoadStatus,
        rowCount: Int
    ) -> ScheduledExportsPhase {
        let hasRows = rowCount > 0
        switch status {
        case .loading:
            return hasRows ? .content : .loading
        case .loaded:
            return hasRows ? .content : .empty
        case let .failed(message):
            return hasRows ? .content : .error(message)
        }
    }
}

// MARK: - String trimming helper (file-scoped to avoid module-wide collisions)

private extension String {
    /// Whitespace/newline-trimmed copy — the native equivalent of the web `.trim()`
    /// applied to the delivery target + the submit-time validation reads.
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
