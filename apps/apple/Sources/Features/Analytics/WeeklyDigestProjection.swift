import Foundation

// Pure week-bucketing + aggregation for the Weekly Digest (web `useWeeklyDigest` `useMemo`s +
// `helpers.ts`). Foundation-only so it unit-tests without SwiftUI or a store.

// MARK: - Week math (web `helpers.getWeekRange` / `dayOfWeekIndex` / `isInRange`)

/// Pure calendar helpers reproducing the web Monday-anchored week math exactly, including the
/// JavaScript `getDay()` Sunday quirk (`Sunday → next Monday`), so the SI-free digest buckets the
/// same drives/charging/alerts into the same weeks as the web page.
public enum WeeklyDigestCalendar {
    /// Week column labels (web `DAY_LABELS`), Monday-first.
    public static let dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    /// Seven zeroed day bars (the empty daily-chart series).
    public static var emptyDailyBars: [DigestDailyBar] {
        dayLabels.map { DigestDailyBar(day: $0, value: 0) }
    }

    /// Web `getWeekRange(offset)`: the Monday-anchored `[start, end]` for the week `offset` weeks from
    /// the one containing `now`. Reproduces `start.setDate(now.getDate() - now.getDay() + 1 +
    /// offset*7)` — including the JS `getDay()` Sunday-is-0 behavior that pushes a Sunday `now` to the
    /// following Monday — then spans to the inclusive end of the seventh day.
    public static func weekRange(offset: Int, now: Date, calendar: Calendar) -> (start: Date, end: Date) {
        let jsDay = calendar.component(.weekday, from: now) - 1 // 0 = Sunday … 6 = Saturday
        let startOfToday = calendar.startOfDay(for: now)
        let shift = 1 - jsDay + offset * 7
        let start = calendar.date(byAdding: .day, value: shift, to: startOfToday) ?? startOfToday
        let end = calendar.date(byAdding: DateComponents(day: 7, second: -1), to: start) ?? start
        return (start, end)
    }

    /// Web `dayOfWeekIndex(date)`: Mon = 0 … Sun = 6.
    public static func dayOfWeekIndex(_ date: Date, calendar: Calendar) -> Int {
        let jsDay = calendar.component(.weekday, from: date) - 1
        return jsDay == 0 ? 6 : jsDay - 1
    }

    /// Web `isInRange(date, start, end)`.
    public static func isInRange(_ date: Date, _ start: Date, _ end: Date) -> Bool {
        date >= start && date <= end
    }

    /// Web `weekLabel = ${formatDateShort(start)} – ${formatDateShort(end)}`.
    public static func weekLabel(offset: Int, now: Date, calendar: Calendar, locale: Locale) -> String {
        let range = weekRange(offset: offset, now: now, calendar: calendar)
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return "\(formatter.string(from: range.start)) – \(formatter.string(from: range.end))"
    }
}

// MARK: - Fun-fact heuristics (web `constants.CITY_PAIRS` + `helpers.findCityPair`)

/// One "you drove roughly this far" reference route (web `CITY_PAIRS`).
public struct DigestCityPair: Sendable, Equatable {
    public let from: String
    public let to: String
    public let kilometers: Double
}

/// The fun-fact + CO₂ constants (web `constants.ts`).
public enum WeeklyDigestConstants {
    /// Web `CO2_PER_KWH_GASOLINE_KG`.
    public static let co2PerKwhGasolineKg = 0.21

    /// Web `CITY_PAIRS`.
    public static let cityPairs: [DigestCityPair] = [
        DigestCityPair(from: "New York", to: "Boston", kilometers: 350),
        DigestCityPair(from: "LA", to: "San Francisco", kilometers: 615),
        DigestCityPair(from: "London", to: "Paris", kilometers: 460),
        DigestCityPair(from: "Berlin", to: "Munich", kilometers: 585),
        DigestCityPair(from: "Sydney", to: "Melbourne", kilometers: 880),
        DigestCityPair(from: "Tokyo", to: "Osaka", kilometers: 515)
    ]

    /// Web `findCityPair`: the reference route whose distance is closest to `distanceKm`.
    public static func findCityPair(distanceKm: Double) -> DigestCityPair? {
        cityPairs.min { abs($0.kilometers - distanceKm) < abs($1.kilometers - distanceKm) }
    }
}

// MARK: - Projection (web `useWeeklyDigest` derivations)

/// Reproduces the web `useWeeklyDigest` memoized derivations: filter the loaded activity into the
/// selected week + the prior week, then aggregate the metrics, the two daily bar series, the alert
/// breakdown, and the fun fact — all from already-display-unit values.
public enum WeeklyDigestProjection {
    public static func compute(
        activity: DigestActivity,
        offset: Int,
        now: Date,
        calendar: Calendar
    ) -> DigestComputed {
        let week = WeeklyDigestCalendar.weekRange(offset: offset, now: now, calendar: calendar)
        let prev = WeeklyDigestCalendar.weekRange(offset: offset - 1, now: now, calendar: calendar)

        let weekDrives = activity.drives.filter { WeeklyDigestCalendar.isInRange($0.startDate, week.start, week.end) }
        let prevDrives = activity.drives.filter { WeeklyDigestCalendar.isInRange($0.startDate, prev.start, prev.end) }
        let weekCharging = activity.charging
            .filter { WeeklyDigestCalendar.isInRange($0.startTs, week.start, week.end) }
        let prevCharging = activity.charging
            .filter { WeeklyDigestCalendar.isInRange($0.startTs, prev.start, prev.end) }
        let weekAlerts = activity.alerts.filter { WeeklyDigestCalendar.isInRange($0.createdAt, week.start, week.end) }

        let metrics = metrics(
            weekDrives: weekDrives,
            prevDrives: prevDrives,
            weekCharging: weekCharging,
            prevCharging: prevCharging,
            weekAlerts: weekAlerts
        )

        return DigestComputed(
            metrics: metrics,
            dailyDistance: dailyBars(weekDrives, calendar: calendar, date: { $0.startDate }, value: { $0.distanceKm }),
            dailyEnergy: dailyBars(
                weekCharging,
                calendar: calendar,
                date: { $0.startTs },
                value: { $0.energyAddedKwh }
            ),
            alertSlices: alertSlices(metrics.alertCounts),
            funFact: funFact(totalDistance: metrics.totalDistance),
            hasData: !weekDrives.isEmpty || !weekCharging.isEmpty
        )
    }

    // MARK: Aggregation (web `metrics` useMemo)

    private static func metrics(
        weekDrives: [DigestDrive],
        prevDrives: [DigestDrive],
        weekCharging: [DigestCharge],
        prevCharging: [DigestCharge],
        weekAlerts: [DigestAlert]
    ) -> DigestMetrics {
        let totalDistance = weekDrives.reduce(0) { $0 + $1.distanceKm }
        let energyUsed = weekDrives.reduce(0) { $0 + $1.energyUsedKwh }
        let prevEnergy = prevDrives.reduce(0) { $0 + $1.energyUsedKwh }

        var alertOrder: [String] = []
        var alertTally: [String: Int] = [:]
        for alert in weekAlerts {
            if alertTally[alert.severity] == nil { alertOrder.append(alert.severity) }
            alertTally[alert.severity, default: 0] += 1
        }

        return DigestMetrics(
            totalDistance: totalDistance,
            prevDistance: prevDrives.reduce(0) { $0 + $1.distanceKm },
            totalDrives: weekDrives.count,
            prevDriveCount: prevDrives.count,
            energyUsed: energyUsed,
            prevEnergy: prevEnergy,
            chargingCost: weekCharging.reduce(0) { $0 + $1.cost },
            prevChargingCost: prevCharging.reduce(0) { $0 + $1.cost },
            co2Saved: energyUsed * WeeklyDigestConstants.co2PerKwhGasolineKg,
            prevCo2: prevEnergy * WeeklyDigestConstants.co2PerKwhGasolineKg,
            avgEfficiency: average(weekDrives.map(\.efficiencyWhKm)),
            prevAvgEfficiency: average(prevDrives.map(\.efficiencyWhKm)),
            totalDuration: weekDrives.reduce(0) { $0 + $1.durationMin },
            topDrive: topDrive(weekDrives),
            chargeEnergyAdded: weekCharging.reduce(0) { $0 + $1.energyAddedKwh },
            prevChargeEnergy: prevCharging.reduce(0) { $0 + $1.energyAddedKwh },
            avgChargeRate: averageChargeRate(weekCharging),
            chargingSessionCount: weekCharging.count,
            batteryStart: average(weekCharging.map(\.startBatteryPct)),
            batteryEnd: average(weekCharging.map(\.endBatteryPct)),
            alertCounts: alertOrder.map { DigestAlertCount(severity: $0, count: alertTally[$0] ?? 0) },
            alertTotal: weekAlerts.count
        )
    }

    /// Web `avgEfficiency = totalDrives > 0 ? sum / totalDrives : 0` — plain arithmetic mean, or 0.
    private static func average(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        return values.reduce(0, +) / Double(values.count)
    }

    /// Web `avgChargeRate`: mean of each session's `(energyAdded / duration) * 60`, 0 when no sessions.
    private static func averageChargeRate(_ sessions: [DigestCharge]) -> Double {
        guard !sessions.isEmpty else { return 0 }
        let total = sessions.reduce(0.0) { sum, session in
            sum + (session.durationMin > 0 ? (session.energyAddedKwh / session.durationMin) * 60 : 0)
        }
        return total / Double(sessions.count)
    }

    /// Web `topDrive`: the longest drive, keeping the first on ties (web `reduce` `>` comparison).
    private static func topDrive(_ drives: [DigestDrive]) -> DigestDrive? {
        var best: DigestDrive?
        for drive in drives where best == nil || drive.distanceKm > (best?.distanceKm ?? 0) {
            best = drive
        }
        return best
    }

    // MARK: Daily bars (web `dailyDistanceData` / `dailyEnergyData`)

    private static func dailyBars<Element>(
        _ items: [Element],
        calendar: Calendar,
        date: (Element) -> Date,
        value: (Element) -> Double
    ) -> [DigestDailyBar] {
        var bins = [Double](repeating: 0, count: 7)
        for item in items {
            let index = WeeklyDigestCalendar.dayOfWeekIndex(date(item), calendar: calendar)
            if bins.indices.contains(index) { bins[index] += value(item) }
        }
        return WeeklyDigestCalendar.dayLabels.enumerated().map { offset, label in
            DigestDailyBar(day: label, value: bins[offset])
        }
    }

    // MARK: Alert distribution (web `alertPieData`)

    private static func alertSlices(_ counts: [DigestAlertCount]) -> [DigestAlertSlice] {
        counts.enumerated().map { index, entry in
            DigestAlertSlice(
                name: capitalizedSeverity(entry.severity),
                value: entry.count,
                severity: entry.severity,
                colorIndex: index
            )
        }
    }

    /// Web `severity.charAt(0).toUpperCase() + severity.slice(1)`.
    private static func capitalizedSeverity(_ severity: String) -> String {
        guard let first = severity.first else { return severity }
        return first.uppercased() + severity.dropFirst()
    }

    // MARK: Fun fact (web `funFact` useMemo)

    private static func funFact(totalDistance: Double) -> DigestFunFact? {
        guard totalDistance >= 10, let pair = WeeklyDigestConstants.findCityPair(distanceKm: totalDistance) else {
            return nil
        }
        let times = totalDistance / pair.kilometers
        return DigestFunFact(from: pair.from, to: pair.to, times: WeeklyDigestFormat.number(times, decimals: 1))
    }
}
