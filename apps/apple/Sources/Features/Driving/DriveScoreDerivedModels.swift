import SwiftUI

// Derived value types for the Drive Score surface (web useMemo outputs: `avgScores`,
// `trendChartData`, `categoryBarData`, `histogramData`, `periodStats`, `buildAchievements`,
// `buildTips`). Pure data carried from `DriveScoreEngine` into the views; no logic lives here.

/// The averaged category scores across the scored drives (web `avgScores`).
public struct DriveScoreAverages: Equatable, Sendable {
    public let total: Int
    public let efficiency: Int
    public let smoothness: Int
    public let speed: Int

    public init(total: Int, efficiency: Int, smoothness: Int, speed: Int) {
        self.total = total
        self.efficiency = efficiency
        self.smoothness = smoothness
        self.speed = speed
    }

    /// The category average (web `avgScores.efficiency` / `.smoothness` / `.speed`).
    public func score(for category: DriveScoreCategory) -> Int {
        switch category {
        case .efficiency: efficiency
        case .smoothness: smoothness
        case .speed: speed
        }
    }

    public static let zero = DriveScoreAverages(total: 0, efficiency: 0, smoothness: 0, speed: 0)
}

/// One point on the score-trend line chart (web `trendChartData[]`).
public struct DriveScoreTrendPoint: Identifiable, Hashable, Sendable {
    public let index: Int
    public let date: Date
    public let score: Int
    public let efficiency: Int
    public let smoothness: Int
    public let speed: Int

    public var id: Int {
        index
    }

    public init(index: Int, date: Date, score: Int, efficiency: Int, smoothness: Int, speed: Int) {
        self.index = index
        self.date = date
        self.score = score
        self.efficiency = efficiency
        self.smoothness = smoothness
        self.speed = speed
    }
}

/// One bar in the category-breakdown chart (web `categoryBarData[]`).
public struct DriveScoreCategoryBar: Identifiable, Hashable, Sendable {
    public let category: DriveScoreCategory
    public let value: Int
    public let maxValue: Int

    public var id: String {
        category.rawValue
    }

    public init(category: DriveScoreCategory, value: Int, maxValue: Int) {
        self.category = category
        self.value = value
        self.maxValue = maxValue
    }
}

/// One bucket in the score-distribution histogram (web `histogramData[]`).
public struct DriveScoreHistogramBin: Identifiable, Hashable, Sendable {
    public let rangeLabel: String
    public let driveCount: Int
    public let colorIndex: Int

    public var id: String {
        rangeLabel
    }

    public init(rangeLabel: String, driveCount: Int, colorIndex: Int) {
        self.rangeLabel = rangeLabel
        self.driveCount = driveCount
        self.colorIndex = colorIndex
    }
}

/// A best-period roll-up (web `bestWeek` / `bestMonth`): the top average and its bucket label.
public struct DriveScorePeriodBest: Equatable, Sendable {
    public let average: Int
    public let label: String

    public init(average: Int, label: String) {
        self.average = average
        self.label = label
    }

    public static let empty = DriveScorePeriodBest(average: 0, label: "—")
}

/// The weekly / monthly roll-up cards (web `periodStats`). `nil` averages render the em-dash.
public struct DriveScorePeriodStats: Equatable, Sendable {
    public let thisWeekAvg: Int?
    public let lastWeekAvg: Int?
    public let thisMonthAvg: Int?
    public let lastMonthAvg: Int?
    public let bestWeek: DriveScorePeriodBest
    public let bestMonth: DriveScorePeriodBest
    public let totalDrives: Int
    public let aOrBetter: Int

    public init(
        thisWeekAvg: Int?,
        lastWeekAvg: Int?,
        thisMonthAvg: Int?,
        lastMonthAvg: Int?,
        bestWeek: DriveScorePeriodBest,
        bestMonth: DriveScorePeriodBest,
        totalDrives: Int,
        aOrBetter: Int
    ) {
        self.thisWeekAvg = thisWeekAvg
        self.lastWeekAvg = lastWeekAvg
        self.thisMonthAvg = thisMonthAvg
        self.lastMonthAvg = lastMonthAvg
        self.bestWeek = bestWeek
        self.bestMonth = bestMonth
        self.totalDrives = totalDrives
        self.aOrBetter = aOrBetter
    }

    /// Web `aOrBetter / totalDrives * 100` share of A+/A drives, or nil when there are no drives.
    public var aOrBetterShare: Double? {
        totalDrives > 0 ? Double(aOrBetter) / Double(totalDrives) * 100 : nil
    }
}

/// One achievement badge (web `buildAchievements` + its unlocked flag). Carries `LocalizedStringKey`
/// copy, so it is `Identifiable` (for `ForEach`) but not `Hashable`/`Sendable`.
public struct DriveScoreAchievement: Identifiable {
    public let id: String
    public let titleKey: LocalizedStringKey
    public let descriptionKey: LocalizedStringKey
    public let systemImage: String
    public let unlocked: Bool

    public init(
        id: String,
        titleKey: LocalizedStringKey,
        descriptionKey: LocalizedStringKey,
        systemImage: String,
        unlocked: Bool
    ) {
        self.id = id
        self.titleKey = titleKey
        self.descriptionKey = descriptionKey
        self.systemImage = systemImage
        self.unlocked = unlocked
    }
}

/// One improvement tip (web `buildTips` element) targeted at a weak category. Carries a
/// `LocalizedStringKey`, so it is `Identifiable` (for `ForEach`) but not `Hashable`/`Sendable`.
public struct DriveScoreTip: Identifiable {
    public let id: String
    public let textKey: LocalizedStringKey
    public let category: DriveScoreCategory

    public init(id: String, textKey: LocalizedStringKey, category: DriveScoreCategory) {
        self.id = id
        self.textKey = textKey
        self.category = category
    }

    /// Web tip icon per category (efficiency bolt / smoothness gauge / speed speedometer).
    public var systemImage: String {
        switch category {
        case .efficiency: "bolt.fill"
        case .smoothness: "gauge.with.dots.needle.bottom.50percent"
        case .speed: "speedometer"
        }
    }
}
