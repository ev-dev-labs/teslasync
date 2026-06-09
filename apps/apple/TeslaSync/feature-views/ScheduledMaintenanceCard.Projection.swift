//
//  ScheduledMaintenanceCard.Projection.swift
//  TeslaSync — P4 feature view · 0251 · ScheduledMaintenanceCard (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component's mutually-exclusive render branches (active-now,
//  scheduler-idle) plus the P4 leaf contract (loading / error) and the `now`-relative "active
//  until …" / 24-hour pre-banner derivations stay unit testable in isolation (no store, no SwiftUI).
//

import Foundation

// MARK: - Input snapshot (web hooks: useMaintenanceState + useDateFormat + `now` prop)

/// One coalesced snapshot of the card's inputs — the native mirror of the maintenance query
/// (`snapshot`, plus its `isLoading` / `errorMessage`), the live-state connectivity axis, and the
/// stable `now` the web receives as a prop for the relative "min remaining" / within-24h math.
public struct ScheduledMaintenanceInput: Sendable, Equatable {
    public var snapshot: MaintenanceSnapshot?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: ScheduledMaintenanceConnection
    public var now: Date

    public init(
        snapshot: MaintenanceSnapshot? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: ScheduledMaintenanceConnection = .live,
        now: Date = Date()
    ) {
        self.snapshot = snapshot
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
        self.now = now
    }
}

// MARK: - Ring tone (web dynamic `ringClass`)

/// The panel ring tint — the native mirror of the web `ringClass` ladder: a 24-hour-imminent
/// window goes amber, an active window goes blue, everything else is the neutral hairline.
public enum MaintenanceRingTone: String, Sendable, Equatable {
    case neutral
    case active
    case imminent
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The active-now body content — the native mirror of the web `isActive` block: the optional
/// operator message line and the optional "Active until … (N min remaining)" / "Until …" line.
public struct MaintenanceActiveContent: Sendable, Equatable {
    public let message: String?
    public let untilText: String?

    public init(message: String?, untilText: String?) {
        self.message = message
        self.untilText = untilText
    }
}

/// The resolved, view-ready state — the native mirror of the card's render branches. `phase`
/// selects the body; `ringTone` + the header flags are pre-derived so the view is a pure function
/// of this value.
public struct ScheduledMaintenanceResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Web `isLoading && !state` — keep the card shape with skeletons (P4 leaf chrome).
        case loading
        /// A query failure surfaces a retryable error (P4 leaf; the web has no isError branch).
        case error(String)
        /// Web `isActive` — the message + until line + Clear affordance.
        case active(MaintenanceActiveContent)
        /// Web `!isActive` — the friendly scheduler (explainer + "Schedule a window" / form). This
        /// is the surface's never-blank empty/idle state.
        case scheduler
    }

    public let phase: Phase
    public let ringTone: MaintenanceRingTone
    public let headerActive: Bool
    public let headerWithin24h: Bool

    public init(
        phase: Phase,
        ringTone: MaintenanceRingTone,
        headerActive: Bool,
        headerWithin24h: Bool
    ) {
        self.phase = phase
        self.ringTone = ringTone
        self.headerActive = headerActive
        self.headerWithin24h = headerWithin24h
    }
}

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `ScheduledMaintenanceCard` render plus the P4 leaf loading / error chrome. Unit tested across
/// loading / error / active (with + without within-24h) / scheduler, including the "min remaining"
/// vs "Until …" line selection.
public enum ScheduledMaintenanceProjection {
    public static func resolve(
        _ input: ScheduledMaintenanceInput,
        formatter: any MaintenanceDateFormatting = SystemMaintenanceDateFormatter()
    ) -> ScheduledMaintenanceResolved {
        // P4 leaf contract: a query failure surfaces a retryable error (web falls through to the
        // scheduler — this is the sanctioned leaf enhancement, asserted in the projection tests).
        if let message = input.errorMessage, !message.isEmpty {
            return neutral(.error(message))
        }

        // Web `isLoading && !state` — keep the card shape with skeletons until the row resolves.
        guard let snapshot = input.snapshot else {
            return neutral(input.isLoading ? .loading : .scheduler)
        }

        guard snapshot.mode.isActive else {
            // Web `!isActive` (mode ok / degraded) → the scheduler idle state.
            return neutral(.scheduler)
        }

        return active(snapshot: snapshot, now: input.now, formatter: formatter)
    }

    // MARK: Active-now body (web `isActive` block)

    private static func active(
        snapshot: MaintenanceSnapshot,
        now: Date,
        formatter: any MaintenanceDateFormatting
    ) -> ScheduledMaintenanceResolved {
        let until = snapshot.until.flatMap(MaintenanceInstant.parse)
        let minutes = MaintenanceClock.minutesRemaining(until: until, now: now)
        let within24h = MaintenanceClock.within24h(until: until, now: now)
        let message = snapshot.message.isEmpty ? nil : snapshot.message
        let untilText = until.map { date in untilLine(date: date, minutes: minutes, formatter: formatter) }

        return ScheduledMaintenanceResolved(
            phase: .active(MaintenanceActiveContent(message: message, untilText: untilText)),
            ringTone: within24h ? .imminent : .active,
            headerActive: true,
            headerWithin24h: within24h
        )
    }

    /// Web `minutesToStart > 0 ? 'Active until … (N min remaining)' : 'Until …'`.
    private static func untilLine(
        date: Date,
        minutes: Int?,
        formatter: any MaintenanceDateFormatting
    ) -> String {
        let stamp = formatter.dateTime(date)
        if let minutes, minutes > 0 {
            return ScheduledMaintenanceStrings.format(
                "scheduled.activeUntil",
                "Active until %@ (%@ min remaining)",
                stamp,
                String(minutes)
            )
        }
        return ScheduledMaintenanceStrings.format("scheduled.until", "Until %@", stamp)
    }

    private static func neutral(_ phase: ScheduledMaintenanceResolved.Phase) -> ScheduledMaintenanceResolved {
        ScheduledMaintenanceResolved(phase: phase, ringTone: .neutral, headerActive: false, headerWithin24h: false)
    }
}
