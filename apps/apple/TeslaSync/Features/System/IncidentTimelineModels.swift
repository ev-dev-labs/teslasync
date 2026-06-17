import Foundation

// Value types for the System feature's incident post-mortem surface — the native SwiftUI parity of
// `web/src/features/system/pages/IncidentTimelinePage.tsx` (route `/system-status/incidents/:id`).
// The page renders one incident's header, its full update timeline (newest first), an append-update
// form, and the resolve lifecycle control. Everything is plain Foundation (no SwiftUI, no store) so
// the model + formatters are testable without a rendered view; the data states + mutations bind
// through the `@Observable` `IncidentTimelinePageModel`, and networking lives behind the
// `IncidentTimelineDataSource` seam (ADR-004 — no networking in the view).
//
// Types are `IncidentTimeline…`-prefixed so this System-feature parity unit composes alongside the
// sibling `IncidentForm*` / `IncidentsCard*` surfaces in the SAME `TeslaSync` module without symbol
// collision. The `IncidentSeverity` / `IncidentStatus` wire enums are REUSED from the sibling
// `IncidentForm.Types.swift` (same module) — one source of truth for the severity / status
// discriminators — not redefined.

// MARK: - Timeline update (web `IncidentUpdateEntry`)

/// One entry in an incident's update timeline (web `IncidentUpdateEntry`: `at` / `status` /
/// `message` / `author?`). `author` is `nil` for a system-generated line (web `u.author &&`). The
/// identity is synthesized from the instant + the source-array index so the SwiftUI `ForEach` keys
/// match the web list key (`${u.at}-${idx}`), which is stable across the newest-first reversal.
public struct IncidentTimelineUpdate: Identifiable, Hashable, Sendable {
    public let id: String
    public let at: Date
    public let status: IncidentStatus
    public let message: String
    public let author: String?

    public init(
        id: String,
        at: Date,
        status: IncidentStatus,
        message: String,
        author: String? = nil
    ) {
        self.id = id
        self.at = at
        self.status = status
        self.message = message
        self.author = author
    }
}

// MARK: - Incident detail (web `Incident`, the subset the page renders)

/// One incident as the post-mortem page renders it — the native projection of the web `Incident`
/// payload narrowed to the fields this surface shows: the title + numeric id (web header +
/// `Incident #${id}`), the severity + lifecycle status (icon / badge tones), the source label, the
/// description, the affected-component names, the full update list, and the start / resolve instants
/// the duration + "Started …" labels derive from. `id` is the `Identifiable` key + the route target.
public struct IncidentTimelineDetail: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let title: String
    /// The incident detail (web `inc.description`); empty hides the description line entirely.
    public let description: String
    public let severity: IncidentSeverity
    public let status: IncidentStatus
    /// The origin label (web `inc.source`: "manual" / "auto"), shown verbatim as a muted chip.
    public let source: String
    /// The affected-component names (web `inc.affected_components`); empty hides the "Affects:" line.
    public let affectedComponents: [String]
    /// The update timeline in chronological order (web `inc.updates`); the view reverses it to render
    /// newest-first.
    public let updates: [IncidentTimelineUpdate]
    /// The incident start instant (web `inc.started_at`), parsed at the source boundary.
    public let startedAt: Date
    /// The resolve instant (web `inc.resolved_at`), `nil` while the incident is still open.
    public let resolvedAt: Date?

    public init(
        id: Int64,
        title: String,
        description: String,
        severity: IncidentSeverity,
        status: IncidentStatus,
        source: String,
        affectedComponents: [String],
        updates: [IncidentTimelineUpdate],
        startedAt: Date,
        resolvedAt: Date? = nil
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.severity = severity
        self.source = source
        self.status = status
        self.affectedComponents = affectedComponents
        self.updates = updates
        self.startedAt = startedAt
        self.resolvedAt = resolvedAt
    }

    /// Whether the incident is closed (web `incident.status === 'resolved'`). Gates the Resolve
    /// control + the append-update form (both hidden once resolved).
    public var isResolved: Bool {
        status == .resolved
    }

    /// The updates in render order — newest first (web `[...incident.updates].reverse()`).
    public var updatesNewestFirst: [IncidentTimelineUpdate] {
        updates.reversed()
    }
}

// MARK: - Page status (web `useIncident` query state)

/// The detail-query status the page body switches over — the native mirror of the web React Query
/// `isLoading` / resolved / `error || !incident` branches. `.error` carries a message and backs the
/// web "not found / no access" panel (GlassPanel4); `.ready` is the resolved post-mortem body
/// (header + timeline + append form).
public enum IncidentTimelineState: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}

// MARK: - Append / status selection (web append-form `nextStatus`)

/// The optional lifecycle transition an appended update can carry (web `nextStatus`: `'' | status`).
/// `.keep` leaves the status unchanged (web empty-string option "Keep status as …"); a concrete case
/// carries the new `IncidentStatus` the update advances to.
public enum IncidentTimelineStatusChange: Equatable, Hashable, Sendable {
    case keep
    case change(IncidentStatus)

    /// The wire status the append request carries (web `(nextStatus || undefined)`), `nil` when the
    /// status is left unchanged.
    public var wireStatus: IncidentStatus? {
        switch self {
        case .keep: nil
        case let .change(status): status
        }
    }
}

// MARK: - Data source seam (web useIncident + useAppendIncidentUpdate + usePatchIncident)

/// Supplies + mutates the incident this page renders. The production implementation binds the shared
/// KMP repositories / use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / error / success states + the mutation outcomes. Method ↔ web map:
///   - `loadIncident`  ← `useIncident(id)`            / `GET   /status/incidents/{id}`
///   - `appendUpdate`  ← `useAppendIncidentUpdate()`  / `POST  /status/incidents/{id}/updates`
///   - `resolveIncident` ← `usePatchIncident()`       / `PATCH /status/incidents/{id}` `{resolved:true}`
/// Each mutation resolves to the refreshed incident (web mutations invalidate + the page re-reads),
/// so the model can apply the new state in place.
public protocol IncidentTimelineDataSource: Sendable {
    func loadIncident(id: Int64) async throws -> IncidentTimelineDetail
    func appendUpdate(
        id: Int64,
        message: String,
        status: IncidentStatus?
    ) async throws -> IncidentTimelineDetail
    func resolveIncident(id: Int64) async throws -> IncidentTimelineDetail
}
