//
//  IncidentsCard.Types.swift
//  TeslaSync — P4 feature view · 0247 · IncidentsCard (Apple)
//
//  The value-typed model for the active-incidents block — the SwiftUI parity of the web
//  `features/system/components/status/IncidentsCard.tsx` data it reads from
//  `useIncidents({ activeOnly: true })`: the per-row `Incident` projection the card renders
//  (id / title / severity / status / affected_components / updates.length / started_at) plus
//  the bound source's load status and the live-stream freshness (ADR-013) the read states
//  switch over.
//
//  Everything here is pure + Foundation-only (no SwiftUI, no store). The `IncidentSeverity`
//  and `IncidentStatus` wire enums are REUSED from the sibling `IncidentForm.Types.swift`
//  (same module, surface 0246) — not redefined — so the two incident surfaces share one
//  source of truth for the severity/status discriminators. The shared `LocalizedText`
//  descriptor (defined once for the feature-views module in `ConditionBuilder.Types.swift`)
//  is likewise reused. The transforms over these types live in `IncidentsCard.Adapter.swift`.
//

import Foundation

// MARK: - Display-ready incident row (web `Incident`, the subset the card renders)

/// One active incident as the card renders it — the native projection of the web
/// `Incident` payload narrowed to the fields the row shows: the title, the severity +
/// lifecycle status (their icon/badge tones), the affected-component chips, the number of
/// timeline updates (web `inc.updates.length`), and the start instant the relative
/// "Started …" label is derived from. `id` mirrors the web numeric incident id and is the
/// `Identifiable` key + the route target the host opens (web
/// `/system-status/incidents/:id`).
public struct ActiveIncident: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let title: String
    public let severity: IncidentSeverity
    public let status: IncidentStatus
    /// The affected-component names (web `inc.affected_components`); empty hides the
    /// "Affects:" line entirely (web `affected_components.length > 0` guard).
    public let affectedComponents: [String]
    /// The count of timeline updates (web `inc.updates.length`); the "· N updates" suffix
    /// shows only when this is greater than one (web `inc.updates.length > 1`).
    public let updateCount: Int
    /// The incident start instant (web `inc.started_at`), already parsed at the source
    /// boundary so the relative-time projection stays pure.
    public let startedAt: Date

    public init(
        id: Int64,
        title: String,
        severity: IncidentSeverity,
        status: IncidentStatus,
        affectedComponents: [String],
        updateCount: Int,
        startedAt: Date
    ) {
        self.id = id
        self.title = title
        self.severity = severity
        self.status = status
        self.affectedComponents = affectedComponents
        self.updateCount = updateCount
        self.startedAt = startedAt
    }
}

// MARK: - Load status (web `useIncidents` query state)

/// The bound source's load status for the active-incidents query — the native mirror of the
/// web React Query `isLoading` / resolved / error states. `failed` carries a message kept
/// while cached rows remain on screen so a reload failure can surface without blanking the
/// card.
public enum IncidentsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

// MARK: - Live-stream freshness (ADR-013)

/// The freshness of the bound live feed (ADR-013): drives the header chip + the cached-data
/// banner so a cached incident list is clearly labeled while reconnecting / offline, and
/// gates the one-shot stale auto-refresh.
public enum IncidentsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Render phase

/// What the card body renders at the top level. The web source has a single branch — it
/// returns `null` when there are no active incidents and otherwise renders the list. The
/// native surface widens that into the prompt-required read states so no state is ever a
/// hidden / blank surface: a first-load spinner, a resolved-but-empty friendly state, a
/// fetch-failure state with retry, and the populated list. Cached rows keep the list on
/// screen through a refresh / failure (freshness shown by the banner; a reload failure
/// surfaced inline by the connection chip).
public enum IncidentsCardPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}
