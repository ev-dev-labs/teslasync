import Foundation

// Value types for the Anomaly Detection surface (web
// `web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx`, route `/analytics/anomalies`).
// These mirror the `useAnomalies` response (`web/src/api/hooks/useAnomalies.ts`): the anomaly
// list, the per-category health roll-up, and the three rolling counts. The values here are raw
// signal readings, z-scores, and counts — not SI unit-bearing quantities — so they carry through
// to the display boundary verbatim (web formats them with `fmtNumber`, no unit conversion).

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity + label strings,
/// shown in the page's vehicle `Select`.
public struct AnomalyVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vin: String

    public init(id: Int64, displayName: String, vin: String) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in the selector.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Severity (web `severity: 'critical' | 'warning' | 'info'`)

/// Anomaly severity, tolerant of unknown server values (web treats anything that is not
/// `critical`/`warning` as the benign/info tier). Drives the badge tint + row emphasis.
public enum AnomalySeverity: Hashable, Sendable {
    case critical
    case warning
    case info
    case other(String)

    public init(raw: String) {
        switch raw.lowercased() {
        case "critical": self = .critical
        case "warning": self = .warning
        case "info": self = .info
        default: self = .other(raw)
        }
    }

    /// The raw wire value, shown verbatim in the badge (web renders `{a.severity}`).
    public var raw: String {
        switch self {
        case .critical: "critical"
        case .warning: "warning"
        case .info: "info"
        case let .other(value): value
        }
    }
}

// MARK: - Anomaly entry (web `AnomalyEntry`)

/// One detected anomaly (web `AnomalyEntry`). `type` and `severity` keep the raw wire strings so
/// unknown server values still render (web `typeLabel` falls back to the raw type). `value`,
/// `baseline`, and `zScore` are raw signal-space numbers; `detectedAt` is an ISO-8601 instant.
public struct AnomalyEntry: Identifiable, Hashable, Sendable {
    public let signal: String
    public let type: String
    public let severity: AnomalySeverity
    public let value: Double
    public let baseline: Double
    public let zScore: Double
    public let detectedAt: String
    public let message: String

    public init(
        signal: String,
        type: String,
        severity: AnomalySeverity,
        value: Double,
        baseline: Double,
        zScore: Double,
        detectedAt: String,
        message: String
    ) {
        self.signal = signal
        self.type = type
        self.severity = severity
        self.value = value
        self.baseline = baseline
        self.zScore = zScore
        self.detectedAt = detectedAt
        self.message = message
    }

    /// Stable identity for the timeline list (web key `${signal}-${type}-${index}`); the index is
    /// folded in by the model when building the rows so repeated signal/type pairs stay distinct.
    public var id: String {
        "\(signal)-\(type)-\(detectedAt)"
    }

    /// Web `a.z_score > 0` — the σ chip only renders for a positive z-score.
    public var showsZScore: Bool {
        zScore > 0
    }
}

// MARK: - Health category (web `health_summary: Record<string, string>`)

/// One system-health bucket (web `health_summary` entry: category → status). Ordered as an array
/// so the SwiftUI grid keeps a stable layout (a Swift `Dictionary` would not preserve order).
public struct AnomalyHealthCategory: Identifiable, Hashable, Sendable {
    public let category: String
    public let status: String

    public init(category: String, status: String) {
        self.category = category
        self.status = status
    }

    public var id: String {
        category
    }

    /// Web `severity` of the status drives the icon tint + badge (`critical`/`warning`/else).
    public var severity: AnomalySeverity {
        AnomalySeverity(raw: status)
    }
}

// MARK: - Signal frequency (web `signalFrequency` useMemo)

/// One bar in the "Most Frequent Anomalies" chart (web `signalFrequency`): a signal and how many
/// times it tripped in the window. Derived by the model (count → sort desc → top 10).
public struct AnomalySignalCount: Identifiable, Hashable, Sendable {
    public let signal: String
    public let count: Int

    public init(signal: String, count: Int) {
        self.signal = signal
        self.count = count
    }

    public var id: String {
        signal
    }
}

// MARK: - Anomaly data (web `AnomalyData`)

/// The full `useAnomalies` payload (web `AnomalyData`): the anomaly list, the ordered health
/// roll-up, and the three rolling counts that feed the summary stat cards.
public struct AnomalyData: Hashable, Sendable {
    public let anomalies: [AnomalyEntry]
    public let healthCategories: [AnomalyHealthCategory]
    public let signalsMonitored: Int
    public let anomaliesLast7d: Int
    public let anomaliesLast24h: Int

    public init(
        anomalies: [AnomalyEntry],
        healthCategories: [AnomalyHealthCategory],
        signalsMonitored: Int,
        anomaliesLast7d: Int,
        anomaliesLast24h: Int
    ) {
        self.anomalies = anomalies
        self.healthCategories = healthCategories
        self.signalsMonitored = signalsMonitored
        self.anomaliesLast7d = anomaliesLast7d
        self.anomaliesLast24h = anomaliesLast24h
    }

    /// Web `Object.entries(health_summary).length` — the Health-Categories stat card value.
    public var healthCategoryCount: Int {
        healthCategories.count
    }

    /// Web `signalFrequency`: count anomalies per signal, sort by count desc, keep the top 10.
    public var signalFrequency: [AnomalySignalCount] {
        var counts: [String: Int] = [:]
        for anomaly in anomalies {
            counts[anomaly.signal, default: 0] += 1
        }
        let ranked = counts
            .map { AnomalySignalCount(signal: $0.key, count: $0.value) }
            .sorted { lhs, rhs in
                lhs.count == rhs.count ? lhs.signal < rhs.signal : lhs.count > rhs.count
            }
        return Array(ranked.prefix(10))
    }
}
