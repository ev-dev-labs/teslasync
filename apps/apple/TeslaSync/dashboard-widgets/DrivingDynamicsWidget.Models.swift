//
//  DrivingDynamicsWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0044 · DrivingDynamicsWidget (Apple)
//
//  Domain value types ported from
//  features/dashboard/widgets/DrivingDynamicsWidget.tsx: the cached driving
//  dynamics + acceleration-distribution DTOs, the vehicle identity, the
//  driving-style severity, the gauge color band, the projected gauge + g-force
//  histogram bar, and the merged projection the view renders. Pure Foundation —
//  no SwiftUI / transport.
//

import Foundation

// MARK: - Cached inputs (port of web DrivingDynamicsData / AccelerationDistributionData)

/// One cached driving-dynamics summary from `GET /drives/dynamics?vehicle_id=…`
/// — the Swift port of the web `DrivingDynamicsData` (`types/driving.ts`). Every
/// field is a g-force magnitude (already SI / unitless); the web reads each with
/// a `?? 0` guard, so the builder runs them through `safeNumber` to collapse any
/// non-finite value to 0 exactly like the web `fmtNumber`/`safeNumber` path.
public struct DrivingDynamicsDTO: Sendable, Equatable {
    public var maxAccelerationG: Double
    public var maxBrakingG: Double
    public var maxCorneringG: Double
    public var avgAccelerationG: Double
    public var avgBrakingG: Double
    public var smoothnessScore: Double

    public init(
        maxAccelerationG: Double = 0,
        maxBrakingG: Double = 0,
        maxCorneringG: Double = 0,
        avgAccelerationG: Double = 0,
        avgBrakingG: Double = 0,
        smoothnessScore: Double = 0
    ) {
        self.maxAccelerationG = maxAccelerationG
        self.maxBrakingG = maxBrakingG
        self.maxCorneringG = maxCorneringG
        self.avgAccelerationG = avgAccelerationG
        self.avgBrakingG = avgBrakingG
        self.smoothnessScore = smoothnessScore
    }
}

/// The cached acceleration histogram from
/// `GET /drives/acceleration-distribution?vehicle_id=…` — the Swift port of the
/// web `AccelerationDistributionData` (`{ values: number[] }`). Each entry is the
/// count of samples that fell in the corresponding g-force bucket; the bucket
/// width is derived from `G_MAX / values.count` exactly like the web `step`.
public struct DrivingDynamicsAccelerationDistribution: Sendable, Equatable {
    public var values: [Double]

    public init(values: [Double] = []) {
        self.values = values
    }
}

/// Minimal vehicle identity the widget needs (port of the web `useVehicles()`
/// first row — the widget only reads the id to scope the query, plus a name for
/// optional accessibility).
public struct DrivingDynamicsVehicle: Sendable, Equatable {
    public var id: Int64
    public var displayName: String?

    public init(id: Int64, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }

    /// Trimmed display name, or `nil` when blank (web `vehicles?.[0]`).
    public var primaryName: String? {
        guard let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
            return nil
        }
        return name
    }
}

// MARK: - Gauge color band (port of web `gaugeColor` + `SEVERITY_COLORS`)

/// The semantic color band a g-force magnitude (or a severity) maps onto — the
/// Swift port of the web `gaugeColor` thresholds and the `SEVERITY_COLORS` hex
/// map, expressed as design-token roles so the rendered color tracks
/// light/dark/high-contrast themes instead of hard-coding hex. The raw values
/// are stable so previews/tests can assert the band without a rendered view.
public enum DrivingDynamicsGaugeTone: String, Sendable, Equatable, CaseIterable {
    /// web `#10b981` — calm / low g.
    case success
    /// web `#22d3ee` — normal / moderate g.
    case info
    /// web `#f59e0b` — sporty / elevated g.
    case warning
    /// web `#ef4444` — aggressive / high g.
    case danger
}

// MARK: - Driving-style severity (port of web `deriveSeverity` + `Severity`)

/// The driving-style band derived from the average accel/brake g — a 1:1 port of
/// the web `Severity` union and `deriveSeverity` thresholds. The raw value
/// matches the web internal key so the strings catalog
/// (`widget.drivingDynamics.severity.<case>`) agrees across platforms.
public enum DrivingDynamicsSeverity: String, Sendable, Equatable, CaseIterable, Identifiable {
    case calm
    case normal
    case sporty
    case aggressive

    public var id: String {
        rawValue
    }

    /// The i18n key for the severity label
    /// (web `t('widget.drivingDynamics.severity.<case>', …)`).
    public var labelKey: String {
        "widget.drivingDynamics.severity.\(rawValue)"
    }

    /// The web English fallback — `severity[0].toUpperCase() + severity.slice(1)`.
    public var labelFallback: String {
        rawValue.prefix(1).uppercased() + rawValue.dropFirst()
    }

    /// The color band for the severity text (web `SEVERITY_COLORS`).
    public var tone: DrivingDynamicsGaugeTone {
        switch self {
        case .calm: .success
        case .normal: .info
        case .sporty: .warning
        case .aggressive: .danger
        }
    }

    /// `true` when the web Badge uses the `success` variant (calm / normal); the
    /// `sporty` / `aggressive` bands use the `warning` variant.
    public var isCalmCategory: Bool {
        self == .calm || self == .normal
    }
}

// MARK: - Projection (port of the 3 RadialGauges + histogram + derived stats)

/// The role a gauge cell plays — the three web `RadialGauge`s: average
/// acceleration, average braking, and peak cornering (lateral) g.
public enum DrivingDynamicsGaugeRole: String, Sendable, Equatable, CaseIterable, Identifiable {
    case accel
    case brake
    case lateral

    public var id: String {
        rawValue
    }

    /// The i18n key for the gauge caption (web `t('widget.drivingDynamics.<role>', …)`).
    public var labelKey: String {
        "widget.drivingDynamics.\(rawValue)"
    }

    /// The web English fallback caption.
    public var labelFallback: String {
        switch self {
        case .accel: "Accel"
        case .brake: "Brake"
        case .lateral: "Lateral"
        }
    }
}

/// One projected gauge — the Swift port of a web `RadialGauge`: the raw g value,
/// the gauge ceiling (`G_MAX`), the 0…1 fill `fraction`, the formatted center
/// readout (web `label={fmtNumber(value, 2)}`), the color band (web
/// `gaugeColor(value)`), and the role caption rendered under it.
public struct DrivingDynamicsGauge: Sendable, Equatable, Identifiable {
    public var role: DrivingDynamicsGaugeRole
    public var value: Double
    public var max: Double
    public var fraction: Double
    public var valueText: String
    public var tone: DrivingDynamicsGaugeTone

    public init(
        role: DrivingDynamicsGaugeRole,
        value: Double,
        max: Double,
        fraction: Double,
        valueText: String,
        tone: DrivingDynamicsGaugeTone
    ) {
        self.role = role
        self.value = value
        self.max = max
        self.fraction = fraction
        self.valueText = valueText
        self.tone = tone
    }

    public var id: String {
        role.rawValue
    }
}

/// One projected histogram bar — the Swift port of the web `histogramData` datum:
/// the lower-bound g label (web `fmtNumber(i * step, 2)`), the sample `count`,
/// and a stable, unique `plotKey` so Swift Charts keeps bars ordered and never
/// collapses two buckets that round to the same label.
public struct DrivingGForceBar: Sendable, Equatable, Identifiable {
    public var plotKey: String
    public var rangeLabel: String
    public var count: Double

    public init(plotKey: String, rangeLabel: String, count: Double) {
        self.plotKey = plotKey
        self.rangeLabel = rangeLabel
        self.count = count
    }

    public var id: String {
        plotKey
    }
}

/// The merged projection the view switches over — whether the dynamics summary
/// resolved (web `dynamics` truthy, the gate for the gauges/severity vs the
/// empty state), the peak `maxG` + its formatted readout, the smoothness flag
/// (web `isSmooth(maxG)`), the derived driving-style `severity`, the three
/// gauges, and the acceleration-distribution `bars` (rendered only on a wide
/// widget, web `isWide && histogramData.length > 0`).
public struct DrivingDynamicsProjection: Sendable, Equatable {
    public var hasDynamics: Bool
    public var maxG: Double
    public var maxGText: String
    public var smooth: Bool
    public var severity: DrivingDynamicsSeverity
    public var gauges: [DrivingDynamicsGauge]
    public var bars: [DrivingGForceBar]

    public init(
        hasDynamics: Bool,
        maxG: Double,
        maxGText: String,
        smooth: Bool,
        severity: DrivingDynamicsSeverity,
        gauges: [DrivingDynamicsGauge],
        bars: [DrivingGForceBar]
    ) {
        self.hasDynamics = hasDynamics
        self.maxG = maxG
        self.maxGText = maxGText
        self.smooth = smooth
        self.severity = severity
        self.gauges = gauges
        self.bars = bars
    }

    /// Whether the wide-layout acceleration histogram has any bucket to draw
    /// (web `histogramData.length > 0`).
    public var hasDistribution: Bool {
        !bars.isEmpty
    }

    /// Empty projection (no dynamics resolved yet) — the view renders the
    /// loading chrome or the "No dynamics data" empty state over it.
    public static let empty = DrivingDynamicsProjection(
        hasDynamics: false,
        maxG: 0,
        maxGText: "0.00",
        smooth: true,
        severity: .calm,
        gauges: [],
        bars: []
    )
}
