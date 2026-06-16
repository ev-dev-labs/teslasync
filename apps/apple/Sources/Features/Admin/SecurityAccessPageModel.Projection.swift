import Foundation

/// Pure, dependency-free security-posture rules — the native port of the web
/// `helpers.ts` predicates (`doorClosed`, `allWindowsClosed`, `isSentryActive`) the
/// `SecurityAccessPage` derives `isSecure` from. No store, no SwiftUI, so the rules are
/// unit-testable in isolation and shared by the model and its tests.
public enum SecurityAccessPosture {
    /// Web `doorClosed(doorState)`: a closed door is an absent / false / empty signal,
    /// or the literal `Closed`. Any other truthy door string (e.g. "Driver Front Open")
    /// is open.
    public static func doorClosed(_ signal: SecuritySignalReading) -> Bool {
        switch signal {
        case .absent:
            return true
        case let .bool(flag):
            return !flag
        case let .text(value):
            return value.isEmpty || value.caseInsensitiveCompare("Closed") == .orderedSame
        }
    }

    /// Web `parseWindowState`: a closed window is absent / false / empty / `Closed`. A
    /// `Vent` or `Open` (or any other truthy string / `true`) is not closed.
    public static func windowClosed(_ signal: SecuritySignalReading) -> Bool {
        switch signal {
        case .absent:
            return true
        case let .bool(flag):
            return !flag
        case let .text(value):
            return value.isEmpty || value.caseInsensitiveCompare("Closed") == .orderedSame
        }
    }

    /// Web `allWindowsClosed(latest)`: every cabin window is closed.
    public static func allWindowsClosed(_ reading: SecurityReading) -> Bool {
        reading.windows.allSatisfy(windowClosed)
    }

    /// Web `isSecure`: locked AND the door is closed AND every window is closed.
    public static func isSecure(_ reading: SecurityReading?) -> Bool {
        guard let reading else { return true }
        return (reading.locked ?? false) && doorClosed(reading.doorState) && allWindowsClosed(reading)
    }
}

/// Pure projection of the loaded `SecurityAccessReport` into each child surface's input
/// type — the native port of the web page's `useMemo` derivations (`buildSentryBuckets`,
/// `computeSecurityStats`, `computeSentryUptime`, `findLastLockChange`, `deriveTimeline`)
/// plus the per-section prop wiring. Everything here is value-typed and side-effect-free.
public enum SecurityAccessProjection {
    // MARK: History windowing (web `useRangeState` client-side filter)

    /// Filters the history to the selected range by `createdAt` (web filter on
    /// `start`/`end`). The `all` range keeps every record; bounded ranges keep records
    /// whose timestamp parses and falls within the lookback window ending at `now`.
    public static func filterHistory(
        _ history: [SecurityEventInput],
        range: SecurityAccessRange,
        now: Date
    ) -> [SecurityEventInput] {
        guard let lookback = range.lookback else { return history }
        let cutoff = now.addingTimeInterval(-lookback)
        return history.filter { event in
            guard let date = parseISO(event.createdAt) else { return false }
            return date >= cutoff && date <= now
        }
    }

    // MARK: Latest-driven sections (cards / windows / live state)

    /// Web `<SecurityStatusCards latest={latest} />`.
    public static func cardsUpdate(_ latest: SecurityReading?) -> SecurityCardsUpdate {
        guard let latest else {
            return SecurityCardsUpdate(status: .empty, connection: .live, latest: nil, updatedAt: nil)
        }
        return SecurityCardsUpdate(
            status: .loaded,
            connection: .live,
            latest: SecurityCardsLatest(
                locked: latest.locked,
                sentryMode: cardsSignal(latest.sentryMode),
                doorState: cardsSignal(latest.doorState),
                frontDriverWindow: cardsSignal(latest.frontDriverWindow),
                frontPassengerWindow: cardsSignal(latest.frontPassengerWindow),
                rearDriverWindow: cardsSignal(latest.rearDriverWindow),
                rearPassengerWindow: cardsSignal(latest.rearPassengerWindow),
                homelinkNearby: latest.homelinkNearby,
                guestMode: latest.guestMode,
                createdAt: latest.createdAt
            ),
            updatedAt: latest.createdAt
        )
    }

    /// Web `<WindowStatusDetail latest={latest} />`.
    public static func windowInput(_ latest: SecurityReading?) -> WindowStatusInput {
        guard let latest else {
            return WindowStatusInput(status: .empty, event: nil, connection: .live, updatedAt: nil)
        }
        return WindowStatusInput(
            status: .loaded,
            event: WindowStatusEvent(
                frontDriver: windowSignal(latest.frontDriverWindow),
                frontPassenger: windowSignal(latest.frontPassengerWindow),
                rearDriver: windowSignal(latest.rearDriverWindow),
                rearPassenger: windowSignal(latest.rearPassengerWindow),
                recordedAt: latest.createdAt
            ),
            connection: .live,
            updatedAt: latest.createdAt
        )
    }

    /// Web `<LiveVehicleState latest={latest} />`.
    public static func liveStateUpdate(_ latest: SecurityReading?) -> LiveVehicleStateUpdate {
        guard let latest else {
            return LiveVehicleStateUpdate(status: .empty, connection: .live, latest: nil, updatedAt: nil)
        }
        return LiveVehicleStateUpdate(
            status: .loaded,
            connection: .live,
            latest: LiveVehicleStateLatest(
                lightsHazardsActive: latest.lightsHazardsActive,
                lightsHighBeams: latest.lightsHighBeams,
                lightsTurnSignal: liveSignal(latest.lightsTurnSignal),
                driverSeatOccupied: latest.driverSeatOccupied,
                pairedPhoneKeyCount: latest.pairedPhoneKeyCount,
                valetModeEnabled: latest.valetModeEnabled,
                serviceMode: latest.serviceMode,
                speedLimitMode: liveSignal(latest.speedLimitMode),
                homelinkDeviceCount: latest.homelinkDeviceCount,
                centerDisplay: liveSignal(latest.centerDisplay),
                createdAt: latest.createdAt
            ),
            updatedAt: latest.createdAt
        )
    }

    // MARK: History-driven sections (summary / sentry / statistics / timeline)

    /// Web `<SummaryStatsRow isSecure lastLockChange sentryUptime totalEvents />`.
    public static func summaryInput(
        latest: SecurityReading?,
        history: [SecurityEventInput],
        now: Date
    ) -> SummaryStatsInput {
        SummaryStatsInput(
            isSecure: SecurityAccessPosture.isSecure(latest),
            lastLockChange: lastLockChange(history),
            sentryUptime: sentryUptimePercent(history),
            totalEvents: history.count,
            isLoading: false
        )
    }

    /// Web `<SentryModeChart sentryBuckets={buildSentryBuckets(history)} />`.
    public static func sentryUpdate(_ history: [SecurityEventInput], now: Date) -> SentryModeUpdate {
        SentryModeUpdate(
            status: .loaded,
            buckets: buildSentryBuckets(history),
            connection: .live,
            refreshing: false,
            updatedAt: now
        )
    }

    /// Web `<SecurityStatistics securityStats={computeSecurityStats(history)} sentryUptime={…} />`.
    public static func statisticsOutcome(_ history: [SecurityEventInput]) -> SecurityStatisticsOutcome {
        guard !history.isEmpty else { return .empty }
        return .loaded(
            SecurityStatsSnapshot(
                stats: computeSecurityStats(history),
                sentryUptimePercent: sentryUptimePercent(history)
            )
        )
    }

    /// Web `<EventTimeline timelineEvents={deriveTimeline(history)} />`.
    public static func timelineUpdate(_ history: [SecurityEventInput]) -> EventTimelineUpdate {
        EventTimelineUpdate(
            status: history.isEmpty ? .empty : .loaded,
            events: history.map(timelineEvent),
            refreshing: false,
            connection: .live,
            updatedAt: nil
        )
    }

    // MARK: Derivations (ports of helpers.ts)

    /// Web `buildSentryBuckets(history)`: one bucket per `YYYY-MM-DD` day (the web
    /// `createdAt.slice(0,10)` key) tallying sentry-armed vs. sentry-off records, sorted
    /// chronologically.
    public static func buildSentryBuckets(_ history: [SecurityEventInput]) -> [SentryDayBucket] {
        var on: [String: Int] = [:]
        var off: [String: Int] = [:]
        for event in history {
            let day = String(event.createdAt.prefix(10))
            guard !day.isEmpty else { continue }
            if event.sentryMode.isTruthy {
                on[day, default: 0] += 1
            } else {
                off[day, default: 0] += 1
            }
        }
        let days = Set(on.keys).union(off.keys).sorted()
        return days.map { SentryDayBucket(date: $0, sentryOn: on[$0] ?? 0, sentryOff: off[$0] ?? 0) }
    }

    /// Web `computeSentryUptime(history)`: the share of records captured with sentry armed,
    /// as a 0–100 percentage (0 when there is no history).
    public static func sentryUptimePercent(_ history: [SecurityEventInput]) -> Double {
        guard !history.isEmpty else { return 0 }
        let armed = history.reduce(0) { $0 + (($1.sentryMode.isTruthy) ? 1 : 0) }
        return (Double(armed) / Double(history.count)) * 100
    }

    /// Web `computeSecurityStats(history)`. `homelink` / `guest` are not carried on the
    /// history records the native input models (web `SecurityEvent` subset), so those
    /// counts resolve to zero rather than a fabricated value.
    public static func computeSecurityStats(_ history: [SecurityEventInput]) -> SecurityStatsValue {
        let lockEvents = history.reduce(0) { $0 + ($1.locked.isTruthy ? 1 : 0) }
        let doorOpenCount = history.reduce(0) { $0 + (doorOpen($1.doorState) ? 1 : 0) }
        let windowOpenCount = history.reduce(0) { $0 + ($1.windows.contains(where: windowOpen) ? 1 : 0) }
        return SecurityStatsValue(
            lockEvents: lockEvents,
            doorOpenCount: doorOpenCount,
            windowOpenCount: windowOpenCount,
            homelinkCount: 0,
            guestCount: 0,
            total: history.count
        )
    }

    /// Web `findLastLockChange(history)`: the timestamp of the most recent record (ISO
    /// string), or `nil` when there is no history (rendered as the web em-dash sentinel).
    public static func lastLockChange(_ history: [SecurityEventInput]) -> String? {
        history
            .compactMap { event -> (String, Date)? in
                guard let date = parseISO(event.createdAt) else { return nil }
                return (event.createdAt, date)
            }
            .max { $0.1 < $1.1 }?
            .0
    }

    // MARK: Signal mapping (superset reading → each child's signal type)

    private static func cardsSignal(_ signal: SecuritySignalReading) -> SecurityCardsSignalValue {
        switch signal {
        case let .bool(flag): .boolean(flag)
        case let .text(value): .text(value)
        case .absent: .absent
        }
    }

    private static func windowSignal(_ signal: SecuritySignalReading) -> WindowSignal {
        switch signal {
        case let .bool(flag): .bool(flag)
        case let .text(value): .string(value)
        case .absent: .absent
        }
    }

    private static func liveSignal(_ signal: SecuritySignalReading) -> LiveStateSignalValue {
        switch signal {
        case let .bool(flag): .boolean(flag)
        case let .text(value): .text(value)
        case .absent: .absent
        }
    }

    private static func timelineEvent(_ event: SecurityEventInput) -> EventTimelineSecurityEvent {
        EventTimelineSecurityEvent(
            id: event.id,
            createdAt: parseISO(event.createdAt),
            locked: lockedFlag(event.locked),
            sentryMode: timelineSignal(event.sentryMode),
            doorState: timelineSignal(event.doorState)
        )
    }

    private static func timelineSignal(_ signal: SecuritySignal) -> EventTimelineSignal {
        switch signal {
        case let .bool(flag): .bool(flag)
        case let .string(value): .string(value)
        case .number, .object, .null: .absent
        }
    }

    private static func lockedFlag(_ signal: SecuritySignal) -> Bool? {
        switch signal {
        case let .bool(flag): flag
        case .null: nil
        default: signal.isTruthy
        }
    }

    private static func doorOpen(_ signal: SecuritySignal) -> Bool {
        guard signal.isTruthy else { return false }
        if let text = signal.asNonEmptyString {
            return text.caseInsensitiveCompare("Closed") != .orderedSame
        }
        return true
    }

    private static func windowOpen(_ signal: SecuritySignal) -> Bool {
        guard signal.isTruthy else { return false }
        if let text = signal.asNonEmptyString {
            return text.caseInsensitiveCompare("Closed") != .orderedSame
        }
        return true
    }

    // MARK: ISO parsing (port of helpers.ts date handling)

    static func parseISO(_ raw: String) -> Date? {
        guard !raw.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: raw) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: raw) { return date }
        if let epoch = Double(raw) { return Date(timeIntervalSince1970: epoch) }
        return nil
    }
}
