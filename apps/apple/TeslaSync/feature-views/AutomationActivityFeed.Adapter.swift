//
//  AutomationActivityFeed.Adapter.swift
//  TeslaSync — P4 feature view · 0081 · AutomationActivityFeed (Apple)
//
//  The testable projection core for the Automation "Recent Activity" feed — the SwiftUI
//  parity of features/automations/pages/AutomationActivityFeed.tsx plus the web utilities
//  it is fed by (lib/dateFormat.ts::formatDurationMs, lib/numberFormat.ts::fmtPercent, and
//  the component-local timeAgo / statusConfig / typeMap maps). Everything here is pure +
//  Foundation-only (no store, no bundle, no rendered view) so the status/event resolution,
//  the row projections, the duration / percent / relative-time formatting, the live-event
//  cap, and the VoiceOver summaries are all unit-tested in isolation. Colors / SF Symbols
//  are NOT decided here — they are a render concern (Views).
//

import Foundation

// MARK: - Run status (web `statusConfig`)

/// The eight automation execution statuses (web `AutomationHistoryStatus`). The view maps
/// each to an SF Symbol + tone; the adapter only resolves the semantic case + its label.
public enum AutomationRunStatus: String, Sendable, Equatable, CaseIterable {
    case success, partial, failed, skipped, test, undo, running, cancelled

    /// Web `statusConfig[item.status] ?? statusConfig.running` — an unknown / unmapped
    /// status falls back to `running`, exactly like the web nullish-coalescing default.
    public static func parse(_ raw: String) -> AutomationRunStatus {
        AutomationRunStatus(rawValue: raw.lowercased()) ?? .running
    }

    /// The P1/S10 localization key for the status label.
    public var labelKey: String {
        "automations.status.\(rawValue)"
    }

    /// The web English label (hardcoded in the web `statusConfig`, routed through the
    /// facade here so the native code holds no literals).
    public var labelFallback: String {
        switch self {
        case .success: "Succeeded"
        case .partial: "Partial"
        case .failed: "Failed"
        case .skipped: "Skipped"
        case .test: "Test"
        case .undo: "Undo"
        case .running: "Running"
        case .cancelled: "Cancelled"
        }
    }
}

// MARK: - Live event kind (web `typeMap`)

/// The five live SSE event kinds (web `AutomationSSEEventType`). The view maps each to an
/// SF Symbol + tone; the adapter only resolves the semantic case + its badge suffix.
public enum AutomationEventKind: String, Sendable, Equatable, CaseIterable {
    case triggered, succeeded, failed, skipped, stateChanged

    /// Web `typeMap[event.type] ?? typeMap['automation.triggered']` — an unknown type
    /// falls back to `triggered`, exactly like the web nullish-coalescing default.
    public static func parse(_ raw: String) -> AutomationEventKind {
        switch raw {
        case "automation.succeeded": .succeeded
        case "automation.failed": .failed
        case "automation.skipped": .skipped
        case "automation.state_changed": .stateChanged
        default: .triggered
        }
    }

    /// The web badge text — `event.type.replace('automation.', '')`.
    public var badgeSuffix: String {
        switch self {
        case .triggered: "triggered"
        case .succeeded: "succeeded"
        case .failed: "failed"
        case .skipped: "skipped"
        case .stateChanged: "state_changed"
        }
    }

    /// The P1/S10 localization key for the badge label.
    public var badgeKey: String {
        "automations.event.\(badgeSuffix)"
    }
}

// MARK: - Formatting (web `formatDurationMs` / `fmtPercent` / `timeAgo`)

/// Pure, locale-aware formatting ports shared by the projection + the views + the tests.
public enum AutomationFeedFormat {
    /// The web absent-value sentinel (`FALLBACK = '—'`).
    public static let dash = "—"

    /// Web `formatDurationMs`: nil / non-finite → "—"; `< 1000` → "{ms}ms"; otherwise the
    /// seconds form to one decimal ("1.5s"), matching `(ms / 1000).toFixed(1)`.
    public static func duration(_ milliseconds: Int?) -> String {
        guard let milliseconds else { return dash }
        if milliseconds < 1000 { return "\(milliseconds)ms" }
        return String(format: "%.1fs", Double(milliseconds) / 1000)
    }

    /// Web `fmtPercent(value, 0)`: a locale-grouped integer percent. A nil value folds to
    /// zero (web `safeNumber` coerces non-finite input to 0) so the surface never shows
    /// "NaN%".
    public static func percent(_ value: Double?, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        let text = formatter.string(from: NSNumber(value: value ?? 0)) ?? "0"
        return "\(text)%"
    }

    /// Parses an ISO-8601 (optionally fractional) timestamp or a numeric epoch-seconds
    /// string (web `new Date(iso)`). Returns nil when unparseable.
    public static func parseDate(_ raw: String) -> Date? {
        guard !raw.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: raw) { return date }
        if let seconds = Double(raw) { return Date(timeIntervalSince1970: seconds) }
        return nil
    }

    /// Web `timeAgo` — the OS-localized relative form ("5m ago"), delegated to the system
    /// so it is localized without hardcoded English. `now` is injectable for tests.
    public static func relative(for date: Date, relativeTo now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

// MARK: - Input DTOs (web `AutomationHistory` / `AutomationHistoryStats` / event)

/// One execution-history row pushed by an `AutomationFeedSource` — the native mirror of
/// the web `AutomationHistory`, carrying only the fields this surface reads.
public struct AutomationHistoryInput: Sendable, Equatable, Identifiable {
    public var id: String
    public var automationName: String
    public var status: String
    public var error: String?
    public var triggeredAt: String
    public var durationMs: Int?
    public var actionsTotal: Int
    public var actionsSucceeded: Int

    public init(
        id: String,
        automationName: String,
        status: String,
        error: String? = nil,
        triggeredAt: String = "",
        durationMs: Int? = nil,
        actionsTotal: Int = 0,
        actionsSucceeded: Int = 0
    ) {
        self.id = id
        self.automationName = automationName
        self.status = status
        self.error = error
        self.triggeredAt = triggeredAt
        self.durationMs = durationMs
        self.actionsTotal = actionsTotal
        self.actionsSucceeded = actionsSucceeded
    }
}

/// The aggregate execution stats (web `AutomationHistoryStats`), the fields this surface
/// reads from the history summary.
public struct AutomationHistoryStatsInput: Sendable, Equatable {
    public var totalExecutions: Int
    public var successRate: Double
    public var avgDurationMs: Int

    public init(totalExecutions: Int, successRate: Double, avgDurationMs: Int) {
        self.totalExecutions = totalExecutions
        self.successRate = successRate
        self.avgDurationMs = avgDurationMs
    }
}

/// One live SSE event pushed by an `AutomationFeedSource` — the native mirror of the web
/// `AutomationActivityEvent`. Every event variant carries `automation_id` + `name`; only
/// `failed` carries `error` and only `skipped` carries `reason`.
public struct AutomationLiveEventInput: Sendable, Equatable, Identifiable {
    public var id: String
    public var type: String
    public var automationId: Int
    public var name: String?
    public var error: String?
    public var reason: String?

    public init(
        id: String,
        type: String,
        automationId: Int,
        name: String? = nil,
        error: String? = nil,
        reason: String? = nil
    ) {
        self.id = id
        self.type = type
        self.automationId = automationId
        self.name = name
        self.error = error
        self.reason = reason
    }
}

// MARK: - Projected view rows

/// The view-ready history row after projection — every value precomputed so the view holds
/// no logic (web `HistoryRow`: status icon · name · optional error · time-ago · duration ·
/// optional actions count).
public struct AutomationHistoryRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let status: AutomationRunStatus
    public let error: String?
    public let triggeredAt: Date?
    public let durationText: String
    public let actionsText: String?

    public init(
        id: String,
        name: String,
        status: AutomationRunStatus,
        error: String?,
        triggeredAt: Date?,
        durationText: String,
        actionsText: String?
    ) {
        self.id = id
        self.name = name
        self.status = status
        self.error = error
        self.triggeredAt = triggeredAt
        self.durationText = durationText
        self.actionsText = actionsText
    }
}

/// The view-ready live-event row after projection (web `LiveEventRow`: kind icon · name ·
/// optional error · optional reason · kind badge).
public struct AutomationLiveEventRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let kind: AutomationEventKind
    public let name: String
    public let error: String?
    public let reason: String?

    public init(id: String, kind: AutomationEventKind, name: String, error: String?, reason: String?) {
        self.id = id
        self.kind = kind
        self.name = name
        self.error = error
        self.reason = reason
    }
}

/// The view-ready stats summary (web header: total runs · success rate · avg duration).
public struct AutomationFeedStats: Sendable, Equatable {
    public let totalExecutions: Int
    public let successRateText: String
    public let avgDurationText: String

    public init(totalExecutions: Int, successRateText: String, avgDurationText: String) {
        self.totalExecutions = totalExecutions
        self.successRateText = successRateText
        self.avgDurationText = avgDurationText
    }
}

// MARK: - Projection

/// Pure projections from the input DTOs to the view-ready rows — the native port of the
/// web render maps. Unit-tested across every branch.
public enum AutomationFeedAdapter {
    /// Web `liveEvents.slice(0, 5)` — the surface shows at most five live rows.
    public static let liveEventLimit = 5

    /// Web `'name' in event.data ? event.data.name : '#${automation_id}'`.
    public static func displayName(name: String?, automationId: Int) -> String {
        if let name, !name.isEmpty { return name }
        return "#\(automationId)"
    }

    /// Projects one history input into a view row.
    public static func historyRow(from input: AutomationHistoryInput) -> AutomationHistoryRow {
        let total = max(0, input.actionsTotal)
        let succeeded = max(0, input.actionsSucceeded)
        return AutomationHistoryRow(
            id: input.id,
            name: input.automationName,
            status: AutomationRunStatus.parse(input.status),
            error: normalized(input.error),
            triggeredAt: AutomationFeedFormat.parseDate(input.triggeredAt),
            durationText: AutomationFeedFormat.duration(input.durationMs),
            // Web `item.actions_total > 0 && ...` — only show the count when there are actions.
            actionsText: total > 0 ? "\(succeeded)/\(total)" : nil
        )
    }

    /// Projects the history in source order (web renders the array as received).
    public static func historyRows(from inputs: [AutomationHistoryInput]) -> [AutomationHistoryRow] {
        inputs.map(historyRow(from:))
    }

    /// Projects one live-event input into a view row.
    public static func liveRow(from input: AutomationLiveEventInput) -> AutomationLiveEventRow {
        AutomationLiveEventRow(
            id: input.id,
            kind: AutomationEventKind.parse(input.type),
            name: displayName(name: input.name, automationId: input.automationId),
            error: normalized(input.error),
            reason: normalized(input.reason)
        )
    }

    /// Web `liveEvents.slice(0, 5).map(...)` — caps to the five most recent, then projects.
    public static func liveRows(from inputs: [AutomationLiveEventInput]) -> [AutomationLiveEventRow] {
        inputs.prefix(liveEventLimit).map(liveRow(from:))
    }

    /// Web `historyStats && historyStats.total_executions > 0` gate: nil when there is no
    /// stats input or zero executions, so the header summary stays hidden.
    public static func stats(
        from input: AutomationHistoryStatsInput?,
        locale: Locale = .current
    ) -> AutomationFeedStats? {
        guard let input, input.totalExecutions > 0 else { return nil }
        return AutomationFeedStats(
            totalExecutions: input.totalExecutions,
            successRateText: AutomationFeedFormat.percent(input.successRate, locale: locale),
            avgDurationText: AutomationFeedFormat.duration(input.avgDurationMs)
        )
    }

    /// Web truthiness on `item.error` / `event.data.error` / `event.data.reason` — an empty
    /// string is falsy and folds to nil so the surface never renders a bare "— ".
    static func normalized(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }
}

// MARK: - Accessibility (localized through an injected facade)

/// Resolves each row's VoiceOver summary through an injected localizer `(key, fallback) ->
/// String`, so the strings stay in the P1/S10 catalog and the spoken content is asserted
/// without rendering. Pure + bundle-free in tests.
public enum AutomationFeedAccessibility {
    public typealias Localize = (String, String) -> String

    /// One combined VoiceOver string for a history row (name · status · time · duration ·
    /// actions · error).
    public static func historyRowSummary(
        for row: AutomationHistoryRow,
        now: Date = Date(),
        _ localize: Localize
    ) -> String {
        var parts: [String] = [row.name, localize(row.status.labelKey, row.status.labelFallback)]
        if let date = row.triggeredAt {
            parts.append(AutomationFeedFormat.relative(for: date, relativeTo: now))
        }
        parts.append(row.durationText)
        if let actions = row.actionsText { parts.append(actions) }
        if let error = row.error { parts.append(error) }
        return parts.joined(separator: ", ")
    }

    /// One combined VoiceOver string for a live-event row (name · kind · error · reason).
    public static func liveEventSummary(for row: AutomationLiveEventRow, _ localize: Localize) -> String {
        var parts: [String] = [row.name, localize(row.kind.badgeKey, row.kind.badgeSuffix)]
        if let error = row.error { parts.append(error) }
        if let reason = row.reason { parts.append(reason) }
        return parts.joined(separator: ", ")
    }
}
