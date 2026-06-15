import SwiftUI

// Value types for the Drive Score surface (web `web/src/features/driving/pages/DriveScorePage.tsx`,
// route `/drive-score`). Every measurement is SI canonical — meters, seconds, meters-per-second,
// watt-hours, watts — exactly as Phase-42 stores it; the user's unit preference is applied only at
// the SwiftUI render boundary via `Units`/`DriveScoreFormat` (ADR-005, SI-cutover instructions).
// Field names mirror the camelCase wire (web `Drive` / `DriveScore`) so the production KMP-backed
// data source maps straight across, while the unit suffix records the SI base unit on disk.

// MARK: - Trend (web `DriveScore.trend: 'up' | 'down' | 'flat'`)

/// The overall-score trend direction (web `apiScore.trend`). Drives the trend icon, label, and tint.
public enum DriveScoreTrend: String, Sendable, CaseIterable {
    case up
    case down
    case flat

    /// Web `trendLabel`: Improving / Declining / Stable.
    public var labelKey: LocalizedStringKey {
        switch self {
        case .up: "driveScore.trendUp"
        case .down: "driveScore.trendDown"
        case .flat: "driveScore.trendFlat"
        }
    }

    /// Web `TrendIcon` (`Icons.trendUp` / `Icons.trendDown` / `Icons.remove`).
    public var systemImage: String {
        switch self {
        case .up: "arrow.up.right"
        case .down: "arrow.down.right"
        case .flat: "minus"
        }
    }

    /// Web `trendColor`: green up / red down / secondary flat.
    public var tone: TSTone {
        switch self {
        case .up: .success
        case .down: .danger
        case .flat: .neutral
        }
    }
}

// MARK: - Grade (web `GRADE_COLORS` / `gradeVariant` / `gradeTextClass`)

/// A drive letter grade (web grades `A+`, `A`, `B`, `C`, `D`, `F`). Carries the verbatim label plus
/// the badge tone (web `gradeVariant`) and gauge palette slot (web `gradeColor`) so the same grade
/// keeps the same semantics everywhere.
public enum DriveGrade: String, Sendable, CaseIterable {
    case aPlus = "A+"
    case aGrade = "A"
    case bGrade = "B"
    case cGrade = "C"
    case dGrade = "D"
    case fGrade = "F"

    /// The verbatim label shown in the badge / table (web grade string).
    public var label: String {
        rawValue
    }

    /// Web `gradeVariant`: A+/A success, B info, C warning, D/F danger.
    public var tone: TSTone {
        switch self {
        case .aPlus, .aGrade: .success
        case .bGrade: .info
        case .cGrade: .warning
        case .dGrade, .fGrade: .danger
        }
    }

    /// Chart-palette slot used to tint the radial gauges (web `gradeColor` hue, mapped to the
    /// colorblind-safe brand palette): A+/A green, B cyan, C yellow, D amber, F red-orange.
    public var gaugeColorIndex: Int {
        switch self {
        case .aPlus, .aGrade: 2
        case .bGrade: 4
        case .cGrade: 3
        case .dGrade: 1
        case .fGrade: 5
        }
    }

    /// Web grade ladder: ≥90 A+, ≥80 A, ≥70 B, ≥60 C, ≥50 D, else F.
    public static func from(score: Int) -> DriveGrade {
        switch score {
        case 90...: .aPlus
        case 80...: .aGrade
        case 70...: .bGrade
        case 60...: .cGrade
        case 50...: .dGrade
        default: .fGrade
        }
    }

    /// Parses a (possibly backend-supplied) grade string, falling back to the score ladder when the
    /// label is unrecognized (web `GRADE_COLORS[grade] ?? fallback`).
    public static func parse(_ raw: String, score: Int) -> DriveGrade {
        DriveGrade(rawValue: raw) ?? from(score: score)
    }
}

// MARK: - Score categories (web efficiency / smoothness / speed)

/// The three scored categories (web `CATEGORY_COLORS` keys). Drives the breakdown gauges, the tip
/// targeting (web `weakestCategory`), and the category bar chart.
public enum DriveScoreCategory: String, Sendable, CaseIterable {
    case efficiency
    case smoothness
    case speed

    /// The category's maximum points (web `effScore` 40, `smoothScore` 30, `speedScore` 30).
    public var maxPoints: Int {
        switch self {
        case .efficiency: 40
        case .smoothness, .speed: 30
        }
    }

    /// Web `CATEGORY_COLORS` hue mapped to the brand palette: efficiency green, smoothness cyan,
    /// speed violet.
    public var colorIndex: Int {
        switch self {
        case .efficiency: 2
        case .smoothness: 4
        case .speed: 6
        }
    }

    /// The category's display name (web `driveScore.efficiency` / `.smoothness` / `.speedDiscipline`).
    public var titleKey: LocalizedStringKey {
        switch self {
        case .efficiency: "driveScore.efficiency"
        case .smoothness: "driveScore.smoothness"
        case .speed: "driveScore.speedDiscipline"
        }
    }
}

// MARK: - Sort field (web `SortField`)

/// The drive-history sort column (web `SortField = 'date' | 'distance' | 'score' | 'efficiency'`).
public enum DriveSortField: String, Sendable, CaseIterable {
    case date
    case distance
    case score
    case efficiency
}

/// Sort direction (web `SortDir`).
public enum DriveSortDirection: Sendable {
    case ascending
    case descending

    /// Web `setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')`.
    public var toggled: DriveSortDirection {
        self == .ascending ? .descending : .ascending
    }
}

// MARK: - Drive (web `Drive` — SI canonical)

/// One driving session (web `Drive`). All measurements are SI canonical (meters, seconds,
/// meters-per-second, watt-hours, watts); the view converts at the render boundary.
public struct DriveScoreDrive: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let vehicleID: Int64
    public let startTs: Date
    public let endTs: Date?
    public let distanceM: Double
    public let durationS: Double
    public let maxSpeedMps: Double?
    public let avgSpeedMps: Double?
    public let startBatteryPct: Double?
    public let endBatteryPct: Double?
    public let startAddress: String?
    public let endAddress: String?
    public let outsideTempAvgC: Double?
    public let avgPowerW: Double?
    public let energyUsedWh: Double?

    public init(
        id: Int64,
        vehicleID: Int64,
        startTs: Date,
        endTs: Date? = nil,
        distanceM: Double,
        durationS: Double,
        maxSpeedMps: Double? = nil,
        avgSpeedMps: Double? = nil,
        startBatteryPct: Double? = nil,
        endBatteryPct: Double? = nil,
        startAddress: String? = nil,
        endAddress: String? = nil,
        outsideTempAvgC: Double? = nil,
        avgPowerW: Double? = nil,
        energyUsedWh: Double? = nil
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.startTs = startTs
        self.endTs = endTs
        self.distanceM = distanceM
        self.durationS = durationS
        self.maxSpeedMps = maxSpeedMps
        self.avgSpeedMps = avgSpeedMps
        self.startBatteryPct = startBatteryPct
        self.endBatteryPct = endBatteryPct
        self.startAddress = startAddress
        self.endAddress = endAddress
        self.outsideTempAvgC = outsideTempAvgC
        self.avgPowerW = avgPowerW
        self.energyUsedWh = energyUsedWh
    }

    /// Web `${start} → ${end}` route label, or the unknown-route fallback when no start address.
    public var routeLabel: String? {
        guard let startAddress, !startAddress.isEmpty else { return nil }
        if let endAddress, !endAddress.isEmpty {
            return "\(startAddress) → \(endAddress)"
        }
        return startAddress
    }
}

// MARK: - API score (web `DriveScore`)

/// The backend drive-score roll-up (web `useDriveScore` → `DriveScore`). When present it overrides
/// the locally-averaged scores (web `apiScore?.overall ?? avgScores.total`).
public struct DriveScoreSummary: Hashable, Sendable {
    public let overall: Int
    public let efficiency: Int
    public let smoothness: Int
    public let speedDiscipline: Int
    public let grade: String
    public let totalDrives: Int
    public let trend: DriveScoreTrend

    public init(
        overall: Int,
        efficiency: Int,
        smoothness: Int,
        speedDiscipline: Int,
        grade: String,
        totalDrives: Int,
        trend: DriveScoreTrend
    ) {
        self.overall = overall
        self.efficiency = efficiency
        self.smoothness = smoothness
        self.speedDiscipline = speedDiscipline
        self.grade = grade
        self.totalDrives = totalDrives
        self.trend = trend
    }

    /// The category score for a category (web `apiScore?.efficiency` / `.smoothness` /
    /// `.speedDiscipline`).
    public func score(for category: DriveScoreCategory) -> Int {
        switch category {
        case .efficiency: efficiency
        case .smoothness: smoothness
        case .speed: speedDiscipline
        }
    }
}

// MARK: - Computed breakdown (web `scoreDrive` result)

/// The locally-computed score for a single drive (web `scoreDrive` return). `total` is the rounded
/// sum of the three category scores; `whPerKm` is the derived consumption used for the efficiency
/// column + averages.
public struct DriveScoreBreakdown: Hashable, Sendable {
    public let total: Int
    public let efficiency: Int
    public let smoothness: Int
    public let speed: Int
    public let grade: DriveGrade
    public let whPerKm: Double

    public init(total: Int, efficiency: Int, smoothness: Int, speed: Int, grade: DriveGrade, whPerKm: Double) {
        self.total = total
        self.efficiency = efficiency
        self.smoothness = smoothness
        self.speed = speed
        self.grade = grade
        self.whPerKm = whPerKm
    }

    /// The category score for a category (mirrors `DriveScoreSummary.score(for:)`).
    public func score(for category: DriveScoreCategory) -> Int {
        switch category {
        case .efficiency: efficiency
        case .smoothness: smoothness
        case .speed: speed
        }
    }
}

/// A drive paired with its computed score (web `scoredDrives[]` element `{ drive, score }`). The
/// stable identity is the drive id so SwiftUI lists diff correctly.
public struct ScoredDrive: Identifiable, Hashable, Sendable {
    public let drive: DriveScoreDrive
    public let score: DriveScoreBreakdown

    public var id: Int64 {
        drive.id
    }

    public init(drive: DriveScoreDrive, score: DriveScoreBreakdown) {
        self.drive = drive
        self.score = score
    }
}

// MARK: - Style helpers (web `gradeVariant` / `gradeColor` / `scoreTextClass`)

/// Pure semantic-style helpers shared by the gauges, badges, and table (web `gradeVariant`,
/// `gradeColor`, `scoreTextClass`). Keeps the color decisions in one place.
public enum DriveScoreStyle {
    /// Web `scoreTextClass`: ≥80 green, ≥60 amber, else red; nil → muted.
    public static func scoreTone(_ score: Int?) -> TSTone {
        guard let score else { return .neutral }
        if score >= 80 { return .success }
        if score >= 60 { return .warning }
        return .danger
    }
}
