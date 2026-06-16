import Foundation

// The derived state the page binds to — the web `ChargingListPage` `useMemo` pipeline
// reproduced as pure computed properties over the bound model (date filtering → stats →
// collections → search → sort → pagination → date grouping → trend). Kept in an extension
// so the model file stays focused on lifecycle + mutations.
public extension ChargingListPageModel {
    /// Web `dateFilteredSessions` — sessions whose day key falls in the selected window.
    var dateFilteredSessions: [ChargingSession] {
        sessions.filter { ChargingAggregation.inRange($0, range) }
    }

    /// Web `currentStats` — the overview aggregate for the window.
    var currentStats: ChargingPeriodStats {
        ChargingAggregation.periodStats(dateFilteredSessions)
    }

    /// Web `priorRange` — the comparison window immediately preceding the current one.
    var priorRange: ChargingDateRange? {
        ChargingAggregation.priorPeriod(range)
    }

    /// Web `priorStats` — the aggregate for the prior window (over all loaded sessions).
    var priorStats: ChargingPeriodStats? {
        guard let priorRange else { return nil }
        return ChargingAggregation.periodStats(sessions, range: priorRange)
    }

    /// Web `priorHasData` — whether the prior window had any sessions (gates the deltas).
    var priorHasData: Bool {
        priorStats?.hasData ?? false
    }

    /// Web `anomalies` — detected over the date-filtered window.
    var anomalies: [ChargingAnomaly] {
        ChargingAggregation.detectAnomalies(dateFilteredSessions)
    }

    /// Web `anomalyById` — session id → its anomaly, for the inline row badge.
    var anomalyByID: [Int64: ChargingAnomaly] {
        Dictionary(anomalies.map { ($0.session.id, $0) }, uniquingKeysWith: { first, _ in first })
    }

    /// Web `notable` — notable sessions in the window.
    var notable: [ChargingSession] {
        ChargingAggregation.detectNotable(dateFilteredSessions)
    }

    // MARK: Collection counts (web pill `count`s — computed before the active filter)

    var homeCount: Int { dateFilteredSessions.lazy.filter { $0.category == .home }.count }
    var superchargerCount: Int { dateFilteredSessions.lazy.filter { $0.category == .supercharger }.count }
    var dcCount: Int { dateFilteredSessions.lazy.filter { $0.category == .dc }.count }
    var freeCount: Int { dateFilteredSessions.lazy.filter(\.isFree).count }

    /// Web pill count for a given collection.
    func count(for collection: ChargingCollection) -> Int {
        switch collection {
        case .all: dateFilteredSessions.count
        case .home: homeCount
        case .supercharger: superchargerCount
        case .dc: dcCount
        case .free: freeCount
        case .anomalies: anomalies.count
        case .notable: notable.count
        case .tagged: 0
        }
    }

    // MARK: Filter → sort → page → group

    /// Web `collectionFiltered` — the active collection's subset.
    var collectionFiltered: [ChargingSession] {
        ChargingAggregation.collectionSessions(
            collection, dateFiltered: dateFilteredSessions, anomalies: anomalies, notable: notable
        )
    }

    /// Web `filteredSessions` — the collection subset narrowed by the search query.
    var filteredSessions: [ChargingSession] {
        collectionFiltered.filter { ChargingAggregation.matchesSearch($0, query: search) }
    }

    /// Web `sortedSessions` — the filtered list under the active sort.
    var sortedSessions: [ChargingSession] {
        ChargingAggregation.sorted(filteredSessions, field: sortField, descending: sortDescending)
    }

    /// Web `Pagination` page count over the sorted list.
    var pageCount: Int {
        max(1, Int(ceil(Double(sortedSessions.count) / Double(pageSize))))
    }

    /// Web `paginatedSessions` — the current page slice.
    var paginatedSessions: [ChargingSession] {
        let start = page * pageSize
        guard start < sortedSessions.count else { return [] }
        let end = min(start + pageSize, sortedSessions.count)
        return Array(sortedSessions[start..<end])
    }

    /// Web `groupedSessions` — the page slice bucketed by day with a per-day summary.
    var groupedSessions: [ChargingDayGroup] {
        var buckets: [String: [ChargingSession]] = [:]
        for session in paginatedSessions {
            buckets[ChargingAggregation.dayKey(session.startedAt), default: []].append(session)
        }
        let keys = buckets.keys.sorted { sortDescending ? $0 > $1 : $0 < $1 }
        return keys.map { key in
            let items = buckets[key] ?? []
            let totalKwh = items.reduce(0) { $0 + $1.energyAddedWh } / 1000
            let noun = items.count == 1
                ? String(localized: "bulk.noun.session_one")
                : String(localized: "bulk.noun.session_other")
            let summary = "\(items.count) \(noun) · \(ChargingListFormat.number(totalKwh)) kWh"
            return ChargingDayGroup(
                dateKey: key,
                dateLabel: ChargingListFormat.dayLong(key),
                relativeLabel: ChargingListFormat.relativeDays(key, now: Date()),
                summary: summary,
                sessions: items
            )
        }
    }

    // MARK: Trend (web `trendSeries` / `MetricSwitcherChart`)

    /// Web `trendSeries[metric]` — the daily points for one metric over the window.
    func trendPoints(for metric: ChargingTrendMetric) -> [ChargingTrendPoint] {
        ChargingAggregation.dailyTrend(dateFilteredSessions, metric: metric)
    }

    // MARK: Labels

    /// Web `formattedRange` — "April 1, 2026 – April 30, 2026".
    var periodLabel: String {
        "\(ChargingListFormat.dayLong(range.start)) – \(ChargingListFormat.dayLong(range.end))"
    }

    /// Web `priorLabel` — the prior-window descriptor or the "no prior data" note.
    var priorLabel: String? {
        guard let priorRange else { return nil }
        let start = ChargingListFormat.dayLong(priorRange.start)
        let end = ChargingListFormat.dayLong(priorRange.end)
        if priorHasData {
            return String(format: String(localized: "charging.priorPeriod"), start, end)
        }
        return String(format: String(localized: "charging.noPriorData"), start, end)
    }
}
