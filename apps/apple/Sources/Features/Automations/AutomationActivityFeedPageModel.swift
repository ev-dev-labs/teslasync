import Foundation
import Observation

// Native SwiftUI parity model for `web/src/features/automations/pages/AutomationActivityFeed.tsx`
// (an unrouted section rendered inside the `/automations` page). The web component is a pure
// presentational leaf fed `history` / `historyStats` / `isLoading` / `liveEvents` /
// `connectionState` as props from its parent's history query + `useAutomationEvents` SSE
// stream. Per the parity manifest this native unit "renders from navigation values / local
// state" (no API data sources), so the model resolves a typed render state over an injectable
// snapshot seam — no networking lives here (ADR-004).

// MARK: - Run status (web `statusConfig`)

/// The eight automation execution statuses (web `AutomationHistoryStatus`). The view maps each
/// to an SF Symbol + tint; the model resolves the semantic case + its localization key.
public enum AutomationActivityRunStatus: String, Sendable, Equatable, CaseIterable {
    case success, partial, failed, skipped, test, undo, running, cancelled

    /// Web `statusConfig[item.status] ?? statusConfig.running` — an unmapped status folds to
    /// `running`, exactly like the web nullish-coalescing default.
    public static func parse(_ raw: String) -> AutomationActivityRunStatus {
        AutomationActivityRunStatus(rawValue: raw.lowercased()) ?? .running
    }

    /// `Localizable.xcstrings` key for the status label (used in the VoiceOver summary).
    public var labelKey: String {
        "automations.status.\(rawValue)"
    }
}

// MARK: - Live event kind (web `typeMap`)

/// The five live SSE event kinds (web `AutomationSSEEventType`). The view maps each to an SF
/// Symbol + tint; the model resolves the semantic case + its badge suffix.
public enum AutomationActivityEventKind: String, Sendable, Equatable, CaseIterable {
    case triggered, succeeded, failed, skipped, stateChanged

    /// Web `typeMap[event.type] ?? typeMap['automation.triggered']` — an unknown type folds to
    /// `triggered`, exactly like the web nullish-coalescing default.
    public static func parse(_ raw: String) -> AutomationActivityEventKind {
        switch raw {
        case "automation.succeeded": .succeeded
        case "automation.failed": .failed
        case "automation.skipped": .skipped
        case "automation.state_changed": .stateChanged
        default: .triggered
        }
    }

    /// Web badge text — `event.type.replace('automation.', '')`. Derived, not localized
    /// (the web renders the raw suffix), so the view shows it verbatim.
    public var badgeSuffix: String {
        switch self {
        case .triggered: "triggered"
        case .succeeded: "succeeded"
        case .failed: "failed"
        case .skipped: "skipped"
        case .stateChanged: "state_changed"
        }
    }
}

// MARK: - Connection (web `connectionState`)

/// The live-feed connection state — the two web `connectionState` values rendered as the
/// header chip ("Live" / "Reconnecting").
public enum AutomationActivityConnection: String, Sendable, Equatable {
    case connected
    case reconnecting
}

// MARK: - Formatting (web `formatDurationMs` / `fmtPercent` / `timeAgo`)

/// Pure, locale-aware ports of the web utilities the surface is fed by. Unit-tested in
/// isolation so the view holds no formatting logic.
public enum AutomationActivityFormat {
    /// The web absent-value sentinel (`FALLBACK = '—'`).
    public static let dash = "—"

    /// Web `formatDurationMs`: nil / non-finite → "—"; `< 1000` → "{ms}ms"; otherwise the
    /// seconds form to one decimal ("1.5s"), matching `(ms / 1000).toFixed(1)`.
    public static func duration(_ milliseconds: Int?) -> String {
        guard let milliseconds else { return dash }
        if milliseconds < 1000 { return "\(milliseconds)ms" }
        return String(format: "%.1fs", Double(milliseconds) / 1000)
    }

    /// Web `fmtPercent(value, 0)` — a locale-grouped integer percent. A nil value folds to
    /// zero so the surface never shows "NaN%".
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

    /// Parses an ISO-8601 (optionally fractional) timestamp or numeric epoch-seconds string
    /// (web `new Date(iso)`). Returns nil when unparseable.
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

    /// Web `timeAgo` — the OS-localized relative form ("5m ago"), so it is localized without
    /// hardcoded English. `now` is injectable for tests.
    public static func relative(for date: Date, relativeTo now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

// MARK: - View-ready value types (web `HistoryRow` / `LiveEventRow` / stats)

/// One execution-history row (web `HistoryRow`): status · name · optional error · time-ago ·
/// duration · optional actions count. Every field is render-ready so the view holds no logic.
public struct AutomationActivityRun: Identifiable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let status: AutomationActivityRunStatus
    public let error: String?
    public let triggeredAt: Date?
    public let durationMs: Int?
    public let actionsTotal: Int
    public let actionsSucceeded: Int

    public init(
        id: String,
        name: String,
        status: AutomationActivityRunStatus,
        error: String? = nil,
        triggeredAt: Date? = nil,
        durationMs: Int? = nil,
        actionsTotal: Int = 0,
        actionsSucceeded: Int = 0
    ) {
        self.id = id
        self.name = name
        self.status = status
        self.error = Self.normalized(error)
        self.triggeredAt = triggeredAt
        self.durationMs = durationMs
        self.actionsTotal = max(0, actionsTotal)
        self.actionsSucceeded = max(0, actionsSucceeded)
    }

    /// Web `formatDurationMs(item.duration_ms)`.
    public var durationText: String {
        AutomationActivityFormat.duration(durationMs)
    }

    /// Web `item.actions_total > 0 && {succeeded}/{total}` — nil hides the count.
    public var actionsText: String? {
        actionsTotal > 0 ? "\(actionsSucceeded)/\(actionsTotal)" : nil
    }

    static func normalized(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }
}

/// One live SSE row (web `LiveEventRow`): kind · name · optional error · optional reason ·
/// kind badge. The web `'name' in data ? name : '#${automation_id}'` fallback is applied here.
public struct AutomationActivityLiveEvent: Identifiable, Sendable, Equatable {
    public let id: String
    public let kind: AutomationActivityEventKind
    public let name: String
    public let error: String?
    public let reason: String?

    public init(
        id: String,
        type: String,
        automationId: Int,
        name: String? = nil,
        error: String? = nil,
        reason: String? = nil
    ) {
        self.id = id
        kind = AutomationActivityEventKind.parse(type)
        if let name, !name.isEmpty {
            self.name = name
        } else {
            self.name = "#\(automationId)"
        }
        self.error = AutomationActivityRun.normalized(error)
        self.reason = AutomationActivityRun.normalized(reason)
    }
}

/// The aggregate header stats (web `AutomationHistoryStats`), the fields this surface reads.
public struct AutomationActivityStats: Sendable, Equatable {
    public let totalRuns: Int
    public let successRate: Double
    public let avgDurationMs: Int

    public init(totalRuns: Int, successRate: Double, avgDurationMs: Int) {
        self.totalRuns = totalRuns
        self.successRate = successRate
        self.avgDurationMs = avgDurationMs
    }

    /// Web `fmtPercent(historyStats.success_rate, 0)`.
    public func successRateText(locale: Locale = .current) -> String {
        AutomationActivityFormat.percent(successRate, locale: locale)
    }

    /// Web `formatDurationMs(historyStats.avg_duration_ms)`.
    public var avgDurationText: String {
        AutomationActivityFormat.duration(avgDurationMs)
    }
}

// MARK: - Snapshot (web props from the parent query + SSE stream)

/// One coalesced snapshot of the feed's inputs — the native mirror of the web props
/// (`history`, `historyStats`, `isLoading`, `liveEvents`, `connectionState`).
public struct AutomationActivityFeedSnapshot: Sendable, Equatable {
    public var runs: [AutomationActivityRun]
    public var stats: AutomationActivityStats?
    public var liveEvents: [AutomationActivityLiveEvent]
    public var connection: AutomationActivityConnection
    public var isLoading: Bool

    public init(
        runs: [AutomationActivityRun] = [],
        stats: AutomationActivityStats? = nil,
        liveEvents: [AutomationActivityLiveEvent] = [],
        connection: AutomationActivityConnection = .connected,
        isLoading: Bool = false
    ) {
        self.runs = runs
        self.stats = stats
        self.liveEvents = liveEvents
        self.connection = connection
        self.isLoading = isLoading
    }
}

// MARK: - Render state (web history-list branches)

/// The history list's render state — the native mirror of the web
/// `isLoading ? skeletons : (history.length ? rows : <EmptyState/>)` ladder.
public enum AutomationActivityFeedState: Sendable, Equatable {
    case loading
    case empty
    case success
}

// MARK: - Snapshot seam (web props supplier)

/// Supplies the feed snapshot. The production host (the `/automations` page) implements this
/// over its history query + `useAutomationEvents` SSE stream; previews + tests use stubs. The
/// view never talks to the network directly (ADR-004).
public protocol AutomationActivityFeedProviding: Sendable {
    func snapshot() async -> AutomationActivityFeedSnapshot
}

/// The default snapshot used by the standalone navigable screen — representative local
/// activity (the navigation/local-state values the web parent would pass). Vehicle-agnostic
/// reference state, no networking.
public struct DefaultAutomationActivityFeed: AutomationActivityFeedProviding {
    public init() {}

    public func snapshot() async -> AutomationActivityFeedSnapshot {
        AutomationActivityFeedSnapshot(
            runs: [
                AutomationActivityRun(
                    id: "run-1",
                    name: "Precondition at 7 AM",
                    status: .success,
                    triggeredAt: Date(timeIntervalSinceNow: -8 * 60),
                    durationMs: 1840,
                    actionsTotal: 3,
                    actionsSucceeded: 3
                ),
                AutomationActivityRun(
                    id: "run-2",
                    name: "Charge to 80%",
                    status: .partial,
                    triggeredAt: Date(timeIntervalSinceNow: -42 * 60),
                    durationMs: 920,
                    actionsTotal: 2,
                    actionsSucceeded: 1
                ),
                AutomationActivityRun(
                    id: "run-3",
                    name: "Lock when away",
                    status: .failed,
                    error: "Vehicle unreachable",
                    triggeredAt: Date(timeIntervalSinceNow: -3 * 3600),
                    durationMs: 450,
                    actionsTotal: 1,
                    actionsSucceeded: 0
                ),
                AutomationActivityRun(
                    id: "run-4",
                    name: "Sentry on departure",
                    status: .skipped,
                    triggeredAt: Date(timeIntervalSinceNow: -19 * 3600),
                    durationMs: 120
                )
            ],
            stats: AutomationActivityStats(totalRuns: 142, successRate: 93, avgDurationMs: 1320),
            liveEvents: [
                AutomationActivityLiveEvent(
                    id: "ae-1",
                    type: "automation.triggered",
                    automationId: 7,
                    name: "Precondition at 7 AM"
                )
            ],
            connection: .connected
        )
    }
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to. Resolves the history-list render state
/// plus the always-on header overlays (connection chip, gated stats, live rows) from an
/// injectable snapshot seam. Holds no networking or business logic (ADR-004).
@MainActor
@Observable
public final class AutomationActivityFeedPageModel {
    /// Web `liveEvents.slice(0, 5)` — the surface shows at most five live rows.
    public static let liveEventLimit = 5

    public private(set) var state: AutomationActivityFeedState = .loading
    public private(set) var runs: [AutomationActivityRun] = []
    public private(set) var liveEvents: [AutomationActivityLiveEvent] = []
    public private(set) var stats: AutomationActivityStats?
    public private(set) var connection: AutomationActivityConnection = .connected

    @ObservationIgnored private let provider: any AutomationActivityFeedProviding

    public init(provider: any AutomationActivityFeedProviding = DefaultAutomationActivityFeed()) {
        self.provider = provider
    }

    /// Whether the header stats summary is shown (web `historyStats && total_executions > 0`).
    public var showsStats: Bool {
        stats != nil
    }

    /// Loads the snapshot and resolves the terminal render state.
    public func load() async {
        state = .loading
        let snapshot = await provider.snapshot()
        apply(snapshot)
    }

    /// Re-runs the load (header connection-chip recovery / pull-to-refresh).
    public func refresh() async {
        await load()
    }

    private func apply(_ snapshot: AutomationActivityFeedSnapshot) {
        connection = snapshot.connection
        // Web header guard: render stats only when there is at least one execution.
        if let candidate = snapshot.stats, candidate.totalRuns > 0 {
            stats = candidate
        } else {
            stats = nil
        }
        liveEvents = Array(snapshot.liveEvents.prefix(Self.liveEventLimit))
        runs = snapshot.runs
        if snapshot.isLoading {
            state = .loading
        } else if runs.isEmpty {
            state = .empty
        } else {
            state = .success
        }
    }
}
