//
//  ScheduledMaintenanceCard.Adapter.swift
//  TeslaSync — P4 feature view · 0251 · ScheduledMaintenanceCard (Apple)
//
//  The testable, dependency-free projection core for the operator-grade scheduled-maintenance
//  card — the SwiftUI parity of features/system/components/status/ScheduledMaintenanceCard.tsx.
//  Everything here is pure Foundation (no store, no SwiftUI, no bundle prose) so the
//  maintenance-window arithmetic the web component performs inline is unit tested in isolation
//  against the exact source semantics.
//
//  Parity notes (reproduced verbatim from the web source — do NOT "fix" the arithmetic):
//    • isActive          = state?.mode === 'maintenance'  (degraded / ok ⇒ not active).
//    • untilTs           = maintenance_until ? Date.parse(maintenance_until) : null (lenient ISO).
//    • minutesToStart    = isActive && untilTs ? Math.floor((untilTs - now) / 60_000) : null.
//    • within24h         = isActive && untilTs != null && untilTs - now <= 24h && untilTs - now > 0.
//    • handleSchedule    = durMin = max(5, Number(duration) || 60); end = start + durMin*60_000;
//                          message = message.trim() || `Scheduled maintenance · ends ${fmt(end)}`;
//                          until = new Date(end).toISOString().
//

import Foundation

// MARK: - Maintenance mode (web `MaintenanceState.mode` union)

/// The persisted service-mode the backend reports — the native mirror of the web
/// `'ok' | 'degraded' | 'maintenance'` union. Unknown wire values fold to `.ok` (the safe
/// "banner hidden" default, web `source === 'default'`).
public enum MaintenanceMode: String, Sendable, Equatable, CaseIterable {
    case ok
    case degraded
    case maintenance

    /// Parses a raw wire value, defaulting unknown strings to `.ok`.
    public static func from(raw: String) -> MaintenanceMode {
        MaintenanceMode(rawValue: raw.lowercased()) ?? .ok
    }

    /// Web `state?.mode === 'maintenance'` — only the maintenance mode counts as "active now".
    public var isActive: Bool {
        self == .maintenance
    }
}

// MARK: - Maintenance snapshot (web `MaintenanceState`)

/// The resolved maintenance row the card reads — the native mirror of the web `MaintenanceState`
/// (GET/POST `/admin/maintenance`). `until` is the raw ISO string (or `nil`), parsed lazily so the
/// projection reproduces the web `Date.parse` boundary exactly.
public struct MaintenanceSnapshot: Sendable, Equatable {
    public var mode: MaintenanceMode
    public var message: String
    public var until: String?
    public var updatedAt: String
    public var source: String

    public init(
        mode: MaintenanceMode,
        message: String = "",
        until: String? = nil,
        updatedAt: String = "",
        source: String = "default"
    ) {
        self.mode = mode
        self.message = message
        self.until = until
        self.updatedAt = updatedAt
        self.source = source
    }

    /// The neutral "service healthy" snapshot — the scheduler idle baseline.
    public static let ok = MaintenanceSnapshot(mode: .ok)
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the header chip
/// + banner. `live` hides the banner; `stale` / `offline` show it.
public enum ScheduledMaintenanceConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Mutation request / result (web `useUpdateMaintenance`)

/// The POST body the operator submits — the native mirror of the web `MaintenanceUpdateInput`
/// (`{ mode, message, until }`). `until` is the ISO instant or `nil` (the clear path).
public struct MaintenanceUpdateRequest: Sendable, Equatable {
    public var mode: MaintenanceMode
    public var message: String
    public var until: String?

    public init(mode: MaintenanceMode, message: String, until: String?) {
        self.mode = mode
        self.message = message
        self.until = until
    }

    /// Web `handleClear` payload — `{ mode: 'ok', message: '', until: null }`.
    public static let clear = MaintenanceUpdateRequest(mode: .ok, message: "", until: nil)
}

/// The outcome of a maintenance mutation — the native mirror of the web `mutateAsync`
/// resolve/reject. `failure` carries the operator-facing message (web `err.message`).
public enum MaintenanceMutationResult: Sendable, Equatable {
    case success(MaintenanceSnapshot)
    case failure(String)
}

// MARK: - ISO instant parsing / formatting (web `Date.parse` / `toISOString`)

/// Lenient ISO-8601 parsing + formatting, ported so the `maintenance_until` boundary matches the
/// web `Date.parse` (with or without fractional seconds, both emitted by the backend) and the
/// submitted `until` matches `new Date(end).toISOString()` (millisecond precision, `Z` zone).
public enum MaintenanceInstant {
    /// Parses an ISO-8601 instant with or without fractional seconds (web lenient `Date.parse`).
    public static func parse(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    /// Formats an instant as `toISOString()` does — UTC, millisecond precision, `Z` suffix.
    public static func iso(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: date)
    }
}

// MARK: - Maintenance clock (web inline `now`-relative arithmetic)

/// The pure, `now`-relative derivations the web component computes inline (`minutesToStart`,
/// `within24h`). Kept Foundation-only so the floor / threshold arithmetic is asserted without a
/// store or SwiftUI, with `now` injected for determinism.
public enum MaintenanceClock {
    /// One day in seconds — the web `ONE_DAY_MS` threshold expressed in the native time base.
    public static let oneDaySeconds: TimeInterval = 24 * 60 * 60

    /// Web `Math.floor((untilTs - now) / 60_000)` — whole minutes from `now` to `until`, floored
    /// (so it can go negative once the window has elapsed). Returns `nil` when no instant is set.
    public static func minutesRemaining(until: Date?, now: Date) -> Int? {
        guard let until else { return nil }
        return Int(floor(until.timeIntervalSince(now) / 60))
    }

    /// Web `untilTs - now <= ONE_DAY_MS && untilTs - now > 0` — the 24-hour pre-banner window.
    public static func within24h(until: Date?, now: Date) -> Bool {
        guard let until else { return false }
        let delta = until.timeIntervalSince(now)
        return delta > 0 && delta <= oneDaySeconds
    }
}

// MARK: - Schedule math (web `handleSchedule`)

/// The validation outcome for a missing / unrepresentable start instant — the native mirror of the
/// web `toast.error('Pick a start time.')` / `'Invalid start time.'` guards.
public enum MaintenanceScheduleError: Error, Sendable, Equatable {
    case missingStart
    case invalidStart

    /// The i18n key carrying the operator-facing copy for this guard.
    public var key: String {
        switch self {
        case .missingStart: "scheduled.toast.pickStart"
        case .invalidStart: "scheduled.toast.invalidStart"
        }
    }

    /// The web English fallback for this guard.
    public var fallback: String {
        switch self {
        case .missingStart: "Pick a start time."
        case .invalidStart: "Invalid start time."
        }
    }
}

/// The pure port of the web `handleSchedule` body: clamps the duration, derives the end instant,
/// resolves the default message, and assembles the POST request. The date formatter is injected so
/// the default message ("…ends {dt}") is deterministic under test.
public enum MaintenanceScheduleMath {
    /// The minimum window length the web enforces — `Math.max(5, …)`.
    public static let minimumDurationMinutes: Double = 5
    /// The web fallback when `Number(duration)` is falsy (empty / NaN / 0) — `… || 60`.
    public static let defaultDurationMinutes: Double = 60

    /// Web `Math.max(5, Number(duration) || 60)`. `Number('')`/`Number('abc')`/`Number('0')` are
    /// all falsy ⇒ 60, so a parsed value of exactly 0 (or non-numeric) falls back to 60 BEFORE the
    /// `max(5, …)` clamp — reproduced verbatim.
    public static func clampDuration(_ text: String) -> Double {
        let parsed = Double(text.trimmingCharacters(in: .whitespaces)) ?? 0
        let base = (parsed.isFinite && parsed != 0) ? parsed : defaultDurationMinutes
        return max(minimumDurationMinutes, base)
    }

    /// Builds the maintenance POST request from the operator's inputs, mirroring `handleSchedule`.
    /// `start` is the chosen window start (`nil` ⇒ the "pick a start" guard); a non-finite instant
    /// trips the "invalid start" guard. The end instant is `start + durMin·60s`; an empty message
    /// falls back to the localized "Scheduled maintenance · ends {dt}" default.
    public static func buildRequest(
        start: Date?,
        durationText: String,
        message: String,
        formatter: any MaintenanceDateFormatting
    ) -> Result<MaintenanceUpdateRequest, MaintenanceScheduleError> {
        guard let start else { return .failure(.missingStart) }
        guard start.timeIntervalSince1970.isFinite else { return .failure(.invalidStart) }

        let minutes = clampDuration(durationText)
        let end = start.addingTimeInterval(minutes * 60)
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolved = trimmed.isEmpty
            ? ScheduledMaintenanceStrings.format(
                "scheduled.defaultMessage",
                "Scheduled maintenance · ends %@",
                formatter.dateTime(end)
            )
            : trimmed

        return .success(MaintenanceUpdateRequest(
            mode: .maintenance,
            message: resolved,
            until: MaintenanceInstant.iso(from: end)
        ))
    }
}

// MARK: - Date formatting seam (web `useDateFormat().formatDateTime`)

/// Renders an instant as the card's `formatDateTime` does. Injected so the projection + schedule
/// math stay deterministic under test; the production app binds the user's locale + timezone.
public protocol MaintenanceDateFormatting: Sendable {
    func dateTime(_ date: Date) -> String
}

/// Locale + timezone-aware `formatDateTime` peer (medium date + short time), the native default for
/// the surface. Locale / timezone are injectable so the production app threads the user's settings.
public struct SystemMaintenanceDateFormatter: MaintenanceDateFormatting {
    private let locale: Locale
    private let timeZone: TimeZone

    public init(locale: Locale = .current, timeZone: TimeZone = .current) {
        self.locale = locale
        self.timeZone = timeZone
    }

    public func dateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds VoiceOver strings from already-localised parts, so the spoken content is asserted without
/// rendering the view.
public enum ScheduledMaintenanceAccessibility {
    /// The card's combined spoken label: the title, plus the active / within-24h qualifiers when
    /// present, joined with commas (e.g. "Scheduled maintenance, maintenance active, within 24h").
    public static func cardLabel(title: String, active: String?, within24h: String?) -> String {
        [title, active, within24h].compactMap(\.self).joined(separator: ", ")
    }
}
