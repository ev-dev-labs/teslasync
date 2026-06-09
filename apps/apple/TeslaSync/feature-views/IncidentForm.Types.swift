//
//  IncidentForm.Types.swift
//  TeslaSync — P4 feature view · 0246 · IncidentForm (Apple)
//
//  The value-typed model for the manual incident-logging form — the SwiftUI parity of
//  the web `features/system/components/status/IncidentForm.tsx` state (`title`,
//  `severity`, `status`, `components`, `message`) plus the `useIncidents` wire shapes
//  it threads (`IncidentSeverity` / `IncidentStatus`), the create payload
//  (`useCreateIncident` body: `title` / `severity` / `status` / `initial_message` /
//  `affected_components`), the started-incident summary, and the create error taxonomy.
//
//  Everything here is pure + Foundation-only (no SwiftUI, no store, no `Shared`); the
//  transforms over these types live in `IncidentForm.Adapter.swift`, and both are
//  unit-tested. The shared `LocalizedText` descriptor (defined once for the
//  feature-views module in `ConditionBuilder.Types.swift`) is reused — not redefined.
//

import Foundation

// MARK: - Severity (web `IncidentSeverity`)

/// The three incident severities (web `IncidentSeverity`). Raw values are the wire
/// discriminators (`severity`); `CaseIterable` order matches the web `<Select>` option
/// order so the native dropdown lists identically. `.minor` is the web `useState`
/// default.
public enum IncidentSeverity: String, CaseIterable, Sendable, Equatable {
    case minor
    case major
    case critical
}

// MARK: - Status (web `IncidentStatus`)

/// The four incident lifecycle states (web `IncidentStatus`). Raw values are the wire
/// discriminators (`status`); `CaseIterable` order matches the web `<Select>` option
/// order. `.investigating` is the web `useState` default.
public enum IncidentStatus: String, CaseIterable, Sendable, Equatable {
    case investigating
    case identified
    case monitoring
    case resolved
}

// MARK: - Field bounds (web client + server mirror)

/// The validation bounds the web form enforces client-side and the server mirrors in
/// `database/status_incidents_repo.go`: the title is 3–200 chars (web `length < 3`
/// guard + `maxLength={200}`), and the initial message is capped at 4000 (web
/// `maxLength={4000}`). Kept as one source of truth for the adapter + the field chrome.
public enum IncidentFieldBounds {
    public static let titleMinLength = 3
    public static let titleMaxLength = 200
    public static let messageMaxLength = 4000
}

// MARK: - Draft (web controlled form state)

/// The controlled editor state — the native form of the web `useState` fields. Held by
/// the `IncidentFormModel`; the pure validation + request transforms in the adapter read
/// it so they stay testable without the observable model.
public struct IncidentDraft: Sendable, Equatable {
    public var title: String
    public var severity: IncidentSeverity
    public var status: IncidentStatus
    /// The raw comma-separated affected-components text (web `components` string). Split
    /// into the request array by the adapter, not stored pre-split.
    public var components: String
    /// The raw initial-timeline-message text (web `message`).
    public var message: String

    public init(
        title: String = "",
        severity: IncidentSeverity = .minor,
        status: IncidentStatus = .investigating,
        components: String = "",
        message: String = ""
    ) {
        self.title = title
        self.severity = severity
        self.status = status
        self.components = components
        self.message = message
    }
}

// MARK: - Create request (web `useCreateIncident` body)

/// The resolved create payload the model hands to the seam — the native mirror of the
/// web `create.mutateAsync({ title, severity, status, initial_message, affected_components })`
/// body. The title is trimmed; `initialMessage` is the trimmed message or `nil` (web
/// `message.trim() || undefined`); `affectedComponents` is the comma-split, trimmed,
/// empty-dropped list (web `components.split(',').map(trim).filter(Boolean)`).
public struct CreateIncidentRequest: Sendable, Equatable {
    public let title: String
    public let severity: IncidentSeverity
    public let status: IncidentStatus
    public let initialMessage: String?
    public let affectedComponents: [String]

    public init(
        title: String,
        severity: IncidentSeverity,
        status: IncidentStatus,
        initialMessage: String?,
        affectedComponents: [String]
    ) {
        self.title = title
        self.severity = severity
        self.status = status
        self.initialMessage = initialMessage
        self.affectedComponents = affectedComponents
    }
}

// MARK: - Create result (web created `Incident`)

/// The started-incident summary the create mutation resolves to — the native form of the
/// web `Incident` payload (only the fields this surface needs to confirm the write).
public struct CreatedIncidentSummary: Sendable, Equatable {
    public let id: Int64
    public let title: String

    public init(id: Int64, title: String) {
        self.id = id
        self.title = title
    }
}

// MARK: - Create error (web `onError` branches)

/// The classified failure of the create mutation. The production seam maps the shared
/// `ApiError` to a case so the model needs no transport knowledge: a transport failure
/// becomes `offline`, and any server/validation error becomes `failed(message:)` — the
/// native port of the web `err instanceof Error ? err.message : 'Failed to log incident'`
/// branch (an empty message falls back to the generic copy at the display boundary).
public enum CreateIncidentError: Error, Equatable, Sendable {
    case offline
    case failed(message: String)
}
