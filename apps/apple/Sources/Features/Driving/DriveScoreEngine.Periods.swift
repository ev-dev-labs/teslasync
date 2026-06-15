import Foundation

// The weekly / monthly calendar buckets for the Drive Score surface (web `periodStats`). Split into
// its own `DriveScoreEngine` extension so the core engine stays within the body-length budget. `now`
// is injected so the buckets are deterministic in tests.

public extension DriveScoreEngine {
    /// The Gregorian calendar (Sunday-first, matching the web `getDay()` week start).
    static var gregorian: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.firstWeekday = 1
        return calendar
    }

    /// The weekly / monthly roll-up (web `periodStats`), or nil when there are no scored drives.
    static func periodStats(
        _ scored: [ScoredDrive],
        now: Date = Date(),
        calendar: Calendar = DriveScoreEngine.gregorian
    ) -> DriveScorePeriodStats? {
        guard !scored.isEmpty else { return nil }

        let weekStart = startOfWeek(now, calendar: calendar)
        let lastWeekStart = calendar.date(byAdding: .day, value: -7, to: weekStart) ?? weekStart
        let monthStart = startOfMonth(now, calendar: calendar)
        let lastMonthStart = calendar.date(byAdding: .month, value: -1, to: monthStart) ?? monthStart

        let thisWeek = scored.filter { $0.drive.startTs >= weekStart }
        let lastWeek = scored.filter { $0.drive.startTs >= lastWeekStart && $0.drive.startTs < weekStart }
        let thisMonth = scored.filter { $0.drive.startTs >= monthStart }
        let lastMonth = scored.filter { $0.drive.startTs >= lastMonthStart && $0.drive.startTs < monthStart }

        let weekBest = bestBucket(scored, calendar: calendar, key: weekKey(for:calendar:))
        let monthBest = bestBucket(scored, calendar: calendar, key: monthKey(for:calendar:))
        let aOrBetter = scored.count(where: { $0.score.grade == .aPlus || $0.score.grade == .aGrade })

        return DriveScorePeriodStats(
            thisWeekAvg: average(thisWeek),
            lastWeekAvg: average(lastWeek),
            thisMonthAvg: average(thisMonth),
            lastMonthAvg: average(lastMonth),
            bestWeek: weekBest,
            bestMonth: monthBest,
            totalDrives: scored.count,
            aOrBetter: aOrBetter
        )
    }

    /// Web `avg(items)`: rounded mean total, or nil when empty.
    static func average(_ scored: [ScoredDrive]) -> Int? {
        guard !scored.isEmpty else { return nil }
        let sum = scored.reduce(0) { $0 + $1.score.total }
        return Int((Double(sum) / Double(scored.count)).rounded())
    }
}

private extension DriveScoreEngine {
    static func startOfWeek(_ date: Date, calendar: Calendar) -> Date {
        let weekday = calendar.component(.weekday, from: date)
        let start = calendar.startOfDay(for: date)
        return calendar.date(byAdding: .day, value: -(weekday - calendar.firstWeekday), to: start) ?? start
    }

    static func startOfMonth(_ date: Date, calendar: Calendar) -> Date {
        let components = calendar.dateComponents([.year, .month], from: date)
        return calendar.date(from: components) ?? calendar.startOfDay(for: date)
    }

    static func weekKey(for date: Date, calendar: Calendar) -> String {
        let day = calendar.component(.day, from: date)
        let monthStart = startOfMonth(date, calendar: calendar)
        let firstWeekday = calendar.component(.weekday, from: monthStart) - 1
        let weekNumber = Int((Double(day + firstWeekday) / 7).rounded(.up))
        let year = calendar.component(.year, from: date)
        return "\(year)-W\(weekNumber)"
    }

    static func monthKey(for date: Date, calendar: Calendar) -> String {
        let year = calendar.component(.year, from: date)
        let month = calendar.component(.month, from: date)
        return String(format: "%d-%02d", year, month)
    }

    static func bestBucket(
        _ scored: [ScoredDrive],
        calendar: Calendar,
        key: (Date, Calendar) -> String
    ) -> DriveScorePeriodBest {
        var buckets: [String: [ScoredDrive]] = [:]
        for item in scored {
            buckets[key(item.drive.startTs, calendar), default: []].append(item)
        }
        var best = DriveScorePeriodBest.empty
        for (label, items) in buckets {
            if let avg = average(items), avg > best.average {
                best = DriveScorePeriodBest(average: avg, label: label)
            }
        }
        return best
    }
}
