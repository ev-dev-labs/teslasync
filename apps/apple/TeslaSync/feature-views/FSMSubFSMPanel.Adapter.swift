//
//  FSMSubFSMPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0230 · FSMSubFSMPanel (Apple)
//
//  The testable projection core for the active sub-FSM panel — the SwiftUI parity of
//  features/system/components/FSMSubFSMPanel.tsx plus the sibling `StateBadge.tsx` it
//  composes (web `getStateColor` → semantic variant) and the `TimeStamp` it renders the
//  session start with (web `formatRelative` from lib/dateFormat.ts). Everything here is
//  pure + dependency-free (no store, no bundle, no rendered view) so the kind model, the
//  per-state semantic variant table, the terminal/active rule, the ISO-8601 parsing, and
//  the relative-time wording are all unit tested in isolation.
//
//  Colour parity (ADR-006 semantic, not literal): the web `StateBadge` resolves a state to
//  one of five semantic variants (success / warning / danger / info / neutral) via the FSM
//  registry, with cosmetic Tailwind hue overrides on top. This core ports the *base
//  variant* — the documented semantic source of truth — and maps it to the platform status
//  tokens in the view layer, rather than reproducing the per-state hex overrides.
//

import Foundation

// MARK: - Sub-FSM kind (web `ActiveSubFSM.type`)

/// The two sub-FSM kinds the vehicle FSM spawns — the native mirror of the web
/// `sub.type` union (`'drive' | 'charge'`).
public enum FSMSubFSMKind: String, Sendable, Equatable, CaseIterable {
    case drive
    case charge
}

// MARK: - Active sub-FSM entry (web `ActiveSubFSM` from types/fsm/ui-types.ts)

/// One active sub-FSM — the native mirror of the web `ActiveSubFSM` prop element. `state`
/// is the raw FSM state name carried verbatim from the API (the web badge renders it
/// unlocalised); `startTime` is the ISO-8601 instant the session began. The optional
/// `driveID` / `sessionID` mirror the web `drive_id` / `session_id` fields.
public struct FSMSubFSMEntry: Sendable, Equatable {
    public let kind: FSMSubFSMKind
    public let state: String
    public let startTime: String
    public let driveID: Int?
    public let sessionID: Int?

    public init(
        kind: FSMSubFSMKind,
        state: String,
        startTime: String,
        driveID: Int? = nil,
        sessionID: Int? = nil
    ) {
        self.kind = kind
        self.state = state
        self.startTime = startTime
        self.driveID = driveID
        self.sessionID = sessionID
    }
}

// MARK: - Semantic state variant (web FSM registry `variant`)

/// The semantic colour intent of an FSM state — the native mirror of the web
/// `BadgeVariant`. Mapped to the platform status tokens (`TSTone`) in the view.
public enum FSMSubFSMVariant: String, Sendable, Equatable, CaseIterable {
    case success
    case warning
    case danger
    case info
    case neutral
}

/// The per-state semantic model — the native port of the web drive-/charge-session FSM
/// state tables (`DRIVE_SESSION_STATE_ENTRIES` / `CHARGE_SESSION_STATE_ENTRIES`) and the
/// panel's terminal-state rule. Pure + unit tested.
public enum FSMSubFSMStateModel {
    /// Web `DRIVE_SESSION_STATE_ENTRIES[*].variant` (base variant, pre-override).
    static let driveVariants: [String: FSMSubFSMVariant] = [
        "pending": .warning,
        "active": .success,
        "ending": .warning,
        "completed": .info,
        "recovered": .neutral
    ]

    /// Web `CHARGE_SESSION_STATE_ENTRIES[*].variant` (base variant, pre-override).
    static let chargeVariants: [String: FSMSubFSMVariant] = [
        "pending": .warning,
        "active": .success,
        "completing": .info,
        "done": .success,
        "recovered": .neutral
    ]

    /// Web `terminalStates` for a drive session (the panel's non-active set).
    static let driveTerminalStates: Set<String> = ["completed", "recovered"]

    /// Web `terminalStates` for a charge session.
    static let chargeTerminalStates: Set<String> = ["done", "recovered"]

    /// The semantic variant for a `(kind, state)` — the native port of
    /// `getStateColor(fsmType, state)`. The state is lowercased before lookup (web
    /// `states[state.toLowerCase()]`); an unknown state falls back to `.neutral`
    /// (web `DEFAULT_STATE`).
    public static func variant(for kind: FSMSubFSMKind, state: String) -> FSMSubFSMVariant {
        let table = kind == .drive ? driveVariants : chargeVariants
        return table[state.lowercased()] ?? .neutral
    }

    /// Whether the session is still active — the native port of
    /// `!terminalStates.includes(sub.state)`. Matches the web case-sensitive membership
    /// check against the lowercased terminal sets (the API emits lowercase state names).
    public static func isActive(kind: FSMSubFSMKind, state: String) -> Bool {
        let terminal = kind == .drive ? driveTerminalStates : chargeTerminalStates
        return !terminal.contains(state)
    }
}

// MARK: - FSM-type applicability (web `isVehicleView` guard)

/// The panel's render gate — the native port of the web
/// `const isVehicleView = fsmType === 'vehicle' || fsmType === 'all'; if (!isVehicleView) return null`.
public enum FSMSubFSMApplicability {
    public static func isVehicleView(_ fsmType: String) -> Bool {
        fsmType == "vehicle" || fsmType == "all"
    }
}

// MARK: - Timestamp (web `TimeStamp` → lib/dateFormat.ts `formatRelative` / `formatDate`)

/// The session-start timestamp rendering — the native port of the web `TimeStamp`
/// element fed `sub.start_time`. The visible body is the relative form (web `formatRelative`)
/// and the absolute form is the accessibility/alternate (web tooltip), mirroring the
/// component's dual-format behaviour. `now` is injected so the projection is deterministic
/// and unit-testable (the web reads `Date.now()` at render time).
public enum FSMSubFSMTimestamp {
    /// The em-dash sentinel the web renders for a null/unparseable value.
    public static let dash = "—"

    /// Parses the API's ISO-8601 `start_time`. Tries the fractional-seconds variant first
    /// (`2026-06-07T19:30:00.123Z`) then the plain variant (`2026-06-07T19:30:00Z`),
    /// mirroring JavaScript's `new Date(iso)`. Returns `nil` for an unparseable value, just
    /// as `isNaN(d.getTime())` guards the web formatters.
    public static func parse(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) {
            return date
        }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    /// The relative label, ported 1:1 from `formatRelative`:
    ///   • unparseable           → "—"
    ///   • < 60 s (incl. future) → "just now"
    ///   • < 60 min              → "Nm ago"
    ///   • < 24 h                → "Nh ago"
    ///   • < 7 d                 → "Nd ago"
    ///   • otherwise             → absolute `formatDate` ("MMM d, yyyy", locale + tz aware)
    public static func relative(
        fromISO iso: String,
        now: Date,
        locale: Locale,
        timeZone: TimeZone
    ) -> String {
        guard let date = parse(iso) else { return dash }
        let seconds = Int(floor(now.timeIntervalSince(date)))
        if seconds < 60 { return "just now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days < 7 { return "\(days)d ago" }
        return absoluteDate(date, locale: locale, timeZone: timeZone)
    }

    /// The absolute body/alternate, ported from `formatDate` —
    /// `toLocaleDateString(locale, { year:'numeric', month:'short', day:'numeric', timeZone })`.
    /// The localized `yMMMd` template yields the locale-appropriate ordering
    /// (en-US → "Jun 7, 2026").
    public static func absoluteDate(_ date: Date, locale: Locale, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("yMMMd")
        return formatter.string(from: date)
    }

    /// The absolute label from an ISO string, or the em-dash sentinel when unparseable.
    public static func absolute(
        fromISO iso: String,
        locale: Locale,
        timeZone: TimeZone
    ) -> String {
        guard let date = parse(iso) else { return dash }
        return absoluteDate(date, locale: locale, timeZone: timeZone)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver string for a sub-FSM row from already-localised parts, so the
/// spoken content is asserted without rendering the view.
public enum FSMSubFSMAccessibility {
    /// The per-row spoken label: "{session}, {status}, {state}, {started}".
    public static func rowLabel(session: String, status: String, state: String, started: String) -> String {
        "\(session), \(status), \(state), \(started)"
    }
}
