import Foundation

/// Pure aggregation helpers for the Charging Sessions list (web `lib/chargingAggregation.ts`
/// + the `lib/drivesAggregation.ts` re-exports `priorPeriod` / `localDayKey`). Kept
/// SwiftUI-free and deterministic so every derivation is unit-testable; inputs stay
/// SI-canonical (Wh, W, decimal currency) and only the display layer converts.
public enum ChargingAggregation {
    /// The UTC calendar used to bucket sessions into day keys, so the chart x-axis and the
    /// date-grouped rows agree regardless of the host locale (web `localDayKey(iso, tz)`;
    /// the Apple seam pins UTC for determinism — the display layer localizes the labels).
    public static let dayCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }()

    // MARK: - Day keys (web `localDayKey` / `parseLocalDay`)

    /// Web `localDayKey(iso, tz)` → the `YYYY-MM-DD` bucket for a timestamp. Built from the
    /// calendar components (rather than a shared `DateFormatter`) so it stays concurrency-safe
    /// under strict concurrency while remaining deterministic.
    public static func dayKey(_ date: Date) -> String {
        let parts = dayCalendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Web `parseLocalDay(key)` → midday-anchored `Date` for a `YYYY-MM-DD` key (nil when
    /// malformed). Anchoring at noon UTC keeps the label stable across time zones.
    public static func parseDay(_ key: String) -> Date? {
        let parts = key.split(separator: "-")
        guard parts.count == 3,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2])
        else { return nil }
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12
        return dayCalendar.date(from: components)
    }

    /// Web `inDateRange` — inclusive `[start, end]` filter on a session's day key.
    public static func inRange(_ session: ChargingSession, _ range: ChargingDateRange?) -> Bool {
        guard let range else { return true }
        let day = dayKey(session.startedAt)
        if day < range.start { return false }
        if day > range.end { return false }
        return true
    }

    // MARK: - Battery-friendly score (web `batteryFriendlyScore`)

    /// Web `batteryFriendlyScore(sessions)` — rewards starting low / stopping at the sweet
    /// spot, penalises 100 % charges and high start SoC; nil when nothing is scorable.
    public static func batteryFriendlyScore(_ sessions: [ChargingSession]) -> Double? {
        var total = 0.0
        var scored = 0
        for session in sessions {
            guard let start = session.startSocPct, let end = session.endSocPct else { continue }
            scored += 1
            let startBonus = start <= 30 ? 30.0 : start <= 50 ? 15.0 : start > 70 ? -10.0 : 0.0
            let endBonus = end <= 80 ? 20.0 : end <= 90 ? 0.0 : end < 100 ? -10.0 : -25.0
            total += max(0, min(100, 50 + startBonus + endBonus))
        }
        return scored > 0 ? total / Double(scored) : nil
    }

    // MARK: - Period stats (web `computeChargingPeriodStats`)

    /// Web `computeChargingPeriodStats(sessions, start, end, tz)` — the aggregate the
    /// overview cards + secondary line read from.
    public static func periodStats(
        _ sessions: [ChargingSession],
        range: ChargingDateRange? = nil
    ) -> ChargingPeriodStats {
        var count = 0
        var totalEnergyWh = 0.0
        var totalCost = 0.0
        var totalDurationMin = 0.0
        var powerSum = 0.0
        var powerN = 0
        var freeCount = 0
        var home = 0
        var supercharger = 0
        var dc = 0
        var hourCounts = [Int](repeating: 0, count: 24)
        var inWindow: [ChargingSession] = []

        for session in sessions where inRange(session, range) {
            count += 1
            inWindow.append(session)
            totalEnergyWh += session.energyAddedWh
            totalCost += session.costDecimal ?? 0
            totalDurationMin += session.durationMinutes
            let power = session.avgPowerW
            if power > 0 {
                powerSum += power
                powerN += 1
            }
            switch session.category {
            case .home: home += 1
            case .supercharger: supercharger += 1
            case .dc: dc += 1
            case .unknown: break
            }
            if session.isFree { freeCount += 1 }
            if let hour = startHour(session) { hourCounts[hour] += 1 }
        }

        let maxHour = hourCounts.max() ?? 0
        return ChargingPeriodStats(
            sessionCount: count,
            totalEnergyWh: totalEnergyWh,
            totalCost: totalCost,
            totalDurationMin: totalDurationMin,
            avgRateKw: totalDurationMin > 0 ? totalEnergyWh / 1000 / (totalDurationMin / 60) : nil,
            avgDurationMin: count > 0 ? totalDurationMin / Double(count) : nil,
            avgPowerW: powerN > 0 ? powerSum / Double(powerN) : nil,
            mostCommonStartHour: maxHour > 0 ? hourCounts.firstIndex(of: maxHour) : nil,
            homeCount: home,
            superchargerCount: supercharger,
            dcCount: dc,
            freeCount: freeCount,
            batteryFriendlyScore: batteryFriendlyScore(inWindow)
        )
    }

    /// Web `parseStartHour` — hour-of-day (0–23) of a session's start in the day calendar.
    private static func startHour(_ session: ChargingSession) -> Int? {
        dayCalendar.component(.hour, from: session.startedAt)
    }

    // MARK: - Prior period (web `priorPeriod`)

    /// Web `priorPeriod(start, end)` — the immediately preceding window of equal length.
    public static func priorPeriod(_ range: ChargingDateRange) -> ChargingDateRange? {
        guard let startDate = parseDay(range.start), let endDate = parseDay(range.end) else { return nil }
        let dayMs = 86_400.0
        let lengthDays = max(1, Int((endDate.timeIntervalSince(startDate) / dayMs).rounded()) + 1)
        guard let priorEnd = dayCalendar.date(byAdding: .day, value: -1, to: startDate),
              let priorStart = dayCalendar.date(byAdding: .day, value: -(lengthDays - 1), to: priorEnd)
        else { return nil }
        return ChargingDateRange(start: dayKey(priorStart), end: dayKey(priorEnd))
    }

    // MARK: - Anomalies (web `detectChargingAnomalies`)

    /// Web `detectChargingAnomalies` — at most one anomaly per session, first matching rule
    /// wins (telemetry_gap → cost_zero → bad_power → expensive → trickle).
    public static func detectAnomalies(_ sessions: [ChargingSession]) -> [ChargingAnomaly] {
        let expensiveCostPerKwh = 0.5
        let tricklePowerKw = 5.0
        let trickleMinDurationMin = 360.0
        var out: [ChargingAnomaly] = []
        for session in sessions {
            let duration = session.durationMinutes
            let energyKwh = session.energyAddedWh / 1000
            let powerKw = session.avgPowerW / 1000
            if energyKwh < 0.1, duration > 5 {
                out.append(ChargingAnomaly(session: session, kind: .telemetryGap)); continue
            }
            if energyKwh > 1, session.isFree, session.category != .home {
                out.append(ChargingAnomaly(session: session, kind: .costZero)); continue
            }
            if session.category == .dc, duration > 30, powerKw < 3 {
                out.append(ChargingAnomaly(session: session, kind: .badPower)); continue
            }
            if let cpk = session.costPerKwh, cpk > expensiveCostPerKwh {
                out.append(ChargingAnomaly(session: session, kind: .expensive)); continue
            }
            if duration > trickleMinDurationMin, powerKw < tricklePowerKw {
                out.append(ChargingAnomaly(session: session, kind: .trickle)); continue
            }
        }
        return out
    }

    // MARK: - Notable (web `detectNotableSessions`)

    /// Web `detectNotableSessions` — top-decile by energy or ≥150 kW peak power, capped 50.
    public static func detectNotable(_ sessions: [ChargingSession]) -> [ChargingSession] {
        guard !sessions.isEmpty else { return [] }
        let sorted = sessions.sorted { $0.energyAddedWh > $1.energyAddedWh }
        let cutoff = min(50, max(1, Int((Double(sessions.count) * 0.1).rounded(.up))))
        let topEnergy = Set(sorted.prefix(cutoff).map(\.id))
        var result: [ChargingSession] = []
        var seen = Set<Int64>()
        for session in sessions {
            let isFast = (session.peakPowerW ?? 0) >= 150_000
            if topEnergy.contains(session.id) || isFast, !seen.contains(session.id) {
                result.append(session)
                seen.insert(session.id)
            }
        }
        return result
    }

    // MARK: - Trend (web `dailyChargingTrend`)

    /// Web `dailyChargingTrend(sessions, metric, tz)` — daily buckets of one metric, sorted
    /// ascending by day. `power` averages; the rest sum.
    public static func dailyTrend(
        _ sessions: [ChargingSession],
        metric: ChargingTrendMetric
    ) -> [ChargingTrendPoint] {
        var sums: [String: Double] = [:]
        var counts: [String: Int] = [:]
        for session in sessions {
            let day = dayKey(session.startedAt)
            switch metric {
            case .sessions: sums[day, default: 0] += 1
            case .energy: sums[day, default: 0] += session.energyAddedWh / 1000
            case .cost: sums[day, default: 0] += session.costDecimal ?? 0
            case .power:
                let power = session.avgPowerW / 1000
                if power > 0 {
                    sums[day, default: 0] += power
                    counts[day, default: 0] += 1
                } else {
                    sums[day, default: 0] += 0
                }
            }
        }
        return sums.keys.sorted().map { day in
            let sum = sums[day] ?? 0
            if metric == .power {
                let count = counts[day] ?? 0
                return ChargingTrendPoint(date: day, value: count > 0 ? sum / Double(count) : 0)
            }
            return ChargingTrendPoint(date: day, value: sum)
        }
    }

    // MARK: - Collections, search, sort, grouping

    /// Web collection filter — the subset a pill selects from the date-filtered window.
    public static func collectionSessions(
        _ collection: ChargingCollection,
        dateFiltered: [ChargingSession],
        anomalies: [ChargingAnomaly],
        notable: [ChargingSession]
    ) -> [ChargingSession] {
        switch collection {
        case .all: dateFiltered
        case .home: dateFiltered.filter { $0.category == .home }
        case .supercharger: dateFiltered.filter { $0.category == .supercharger }
        case .dc: dateFiltered.filter { $0.category == .dc }
        case .free: dateFiltered.filter(\.isFree)
        case .anomalies: anomalies.map(\.session)
        case .notable: notable
        case .tagged: []
        }
    }

    /// Web free-text search over place / charger type / kWh / cost (the structured `kv:`
    /// token grammar collapses to a case-insensitive substring match on these fields here).
    public static func matchesSearch(_ session: ChargingSession, query: String) -> Bool {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return true }
        var haystack = [session.startPlace, session.chargerType]
            .compactMap { $0?.lowercased() }
        haystack.append(ChargingListFormat.plainNumber(session.energyAddedWh / 1000))
        if let cost = session.costDecimal { haystack.append(ChargingListFormat.plainNumber(cost)) }
        return haystack.contains { $0.contains(trimmed) }
    }

    /// Web sort comparator (`sortBy` + `sortDesc`).
    public static func sorted(
        _ sessions: [ChargingSession],
        field: ChargingSortField,
        descending: Bool
    ) -> [ChargingSession] {
        let ascending = sessions.sorted { lhs, rhs in
            switch field {
            case .energy: lhs.energyAddedWh < rhs.energyAddedWh
            case .cost: (lhs.costDecimal ?? 0) < (rhs.costDecimal ?? 0)
            case .duration: lhs.durationMinutes < rhs.durationMinutes
            case .power: lhs.avgPowerW < rhs.avgPowerW
            case .date: lhs.startedAt < rhs.startedAt
            }
        }
        return descending ? ascending.reversed() : ascending
    }
}
