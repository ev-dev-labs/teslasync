//
//  BatteryDegradationForecastWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0011 · BatteryDegradationForecastWidget (Apple)
//
//  Domain value types ported from
//  features/dashboard/widgets/BatteryDegradationForecastWidget.tsx: the cached
//  predictive-degradation snapshot (the subset of web `DegradationData` the widget
//  reads), the per-row risk factor (web `RiskFactorData`), the active vehicle
//  identity, and the merged projection the view renders. Pure Foundation — no
//  SwiftUI / transport.
//

import Foundation

// MARK: - Cached inputs (port of web `DegradationData` subset + `RiskFactorData`)

/// One predictive risk factor from `GET /analytics/battery-degradation`
/// `risk_factors[]` — a faithful Swift port of the web `RiskFactorData`
/// (`types/energy.ts`). `label` / `detail` are modelled optional so a partial
/// backend row degrades gracefully (web reads `rf.label ?? rf.name` and
/// `rf.detail ?? '—'`); `score` is the 0…10 severity the impact badge classifies.
public struct BatteryDegradationForecastRiskFactor: Sendable, Equatable, Identifiable {
    public var name: String
    public var score: Double
    public var label: String?
    public var detail: String?

    public init(name: String, score: Double, label: String? = nil, detail: String? = nil) {
        self.name = name
        self.score = score
        self.label = label
        self.detail = detail
    }

    /// Stable identity for the SwiftUI list (web `key={rf.name}`).
    public var id: String {
        name
    }

    /// Display title — the trimmed label, falling back to the raw name (web
    /// `rf.label ?? rf.name`).
    public var displayTitle: String {
        if let label = label?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty {
            return label
        }
        return name
    }

    /// Display detail — the trimmed detail, or `nil` when blank so the view can
    /// substitute the em-dash fallback glyph (web `rf.detail ?? '—'`).
    public var displayDetail: String? {
        guard
            let detail = detail?.trimmingCharacters(in: .whitespacesAndNewlines),
            !detail.isEmpty
        else {
            return nil
        }
        return detail
    }
}

/// The cached predictive-degradation snapshot — the subset of the web
/// `DegradationData` the forecast widget reads. All fields are optional so a
/// partial / missing response degrades to the friendly empty surface (web
/// `hasData = currentHealthPct != null || projected_80pct_date != null`).
///
/// `currentHealthPct` mirrors `current_health_pct` and `currentHealth` the legacy
/// `current_health`; the widget resolves state-of-health as
/// `currentHealthPct ?? currentHealth` (web nullish-coalesce). `degradationRate`
/// is unitless % per month; `projected80Date` is the decoded
/// `projected_80pct_date` (the source parses the ISO string, mirroring web
/// `new Date(projected_80pct_date)`).
public struct BatteryDegradationForecastSnapshot: Sendable, Equatable {
    public var currentHealthPct: Double?
    public var currentHealth: Double?
    public var degradationRatePctPerMonth: Double?
    public var projected80Date: Date?
    public var riskFactors: [BatteryDegradationForecastRiskFactor]
    public var recommendations: [String]

    public init(
        currentHealthPct: Double? = nil,
        currentHealth: Double? = nil,
        degradationRatePctPerMonth: Double? = nil,
        projected80Date: Date? = nil,
        riskFactors: [BatteryDegradationForecastRiskFactor] = [],
        recommendations: [String] = []
    ) {
        self.currentHealthPct = currentHealthPct
        self.currentHealth = currentHealth
        self.degradationRatePctPerMonth = degradationRatePctPerMonth
        self.projected80Date = projected80Date
        self.riskFactors = riskFactors
        self.recommendations = recommendations
    }

    /// Resolved state-of-health (web `current_health_pct ?? current_health`).
    public var resolvedHealth: Double? {
        currentHealthPct ?? currentHealth
    }

    /// The neutral snapshot shown before any data resolves.
    public static let empty = BatteryDegradationForecastSnapshot()
}

/// Minimal vehicle identity the widget needs (port of the web `useVehicles()`
/// first row — the widget only reads the id to scope the query, plus a name for
/// the optional accessibility context).
public struct BatteryDegradationForecastVehicle: Sendable, Equatable {
    public var id: Int64
    public var displayName: String?

    public init(id: Int64, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }

    /// Trimmed display name, or `nil` when blank (web `vehicles?.[0]`).
    public var primaryName: String? {
        guard
            let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines),
            !name.isEmpty
        else {
            return nil
        }
        return name
    }
}

// MARK: - Derived classifications (port of web `healthTier` / `scoreToImpact`)

/// The degradation-rate health tier — the Swift port of the web `healthTier`
/// classifier. Carries the i18n key + English fallback (web
/// `t(`widget.forecast.${tier.key}`, tier.label)`) and the semantic status colour
/// the badge uses (web `variant` success / warning / danger).
public enum BatteryDegradationForecastHealthTier: String, Sendable, Equatable, CaseIterable {
    case healthy
    case normal
    case accelerated

    /// The i18n key (web ``t(`widget.forecast.${tier.key}`)``).
    public var localizationKey: String {
        "widget.forecast.\(rawValue)"
    }

    /// The English fallback (web `tier.label`).
    public var fallback: String {
        switch self {
        case .healthy: "Healthy"
        case .normal: "Normal"
        case .accelerated: "Accelerated"
        }
    }
}

/// The risk-factor impact level — the Swift port of the web `scoreToImpact`
/// classifier. Maps a 0…10 severity score to high / medium / low, which the
/// badge renders with the matching status colour (web danger / warning / success).
public enum BatteryDegradationForecastImpact: String, Sendable, Equatable {
    case high
    case medium
    case low
}

// MARK: - Projection (port of the web component's derived render inputs)

/// The merged projection the view switches over — the resolved state-of-health,
/// the degradation rate + its health tier, the projected 80% date, the risk
/// factors and recommendations, and the `hasData` predicate. A faithful port of
/// the web component's derived values (`rate`, `tier`, `currentHealthPct`,
/// `projectedDate`, `riskFactors`, `recommendations`, `hasData`).
public struct BatteryDegradationForecastProjection: Sendable, Equatable {
    public var currentHealth: Double?
    public var rate: Double
    public var tier: BatteryDegradationForecastHealthTier
    public var projected80Date: Date?
    public var riskFactors: [BatteryDegradationForecastRiskFactor]
    public var recommendations: [String]
    public var hasData: Bool

    public init(
        currentHealth: Double?,
        rate: Double,
        tier: BatteryDegradationForecastHealthTier,
        projected80Date: Date?,
        riskFactors: [BatteryDegradationForecastRiskFactor],
        recommendations: [String],
        hasData: Bool
    ) {
        self.currentHealth = currentHealth
        self.rate = rate
        self.tier = tier
        self.projected80Date = projected80Date
        self.riskFactors = riskFactors
        self.recommendations = recommendations
        self.hasData = hasData
    }

    /// Whether the surface should show the friendly empty state (web `!hasData`).
    public var isEmpty: Bool {
        !hasData
    }

    /// Whether the degradation-rate sub-label renders (web `rate > 0`).
    public var showsRate: Bool {
        rate.isFinite && rate > 0
    }

    /// The first five risk factors the standard layout lists (web
    /// `riskFactors.slice(0, 5)`).
    public var visibleRiskFactors: [BatteryDegradationForecastRiskFactor] {
        Array(riskFactors.prefix(5))
    }

    /// The capacity threshold the forecast targets — 80% (web "Projected 80%
    /// Capacity"), surfaced for documentation/use by the accessibility summary.
    public static let capacityThreshold: Double = 80

    /// Empty projection (nothing resolved yet) — the neutral pre-data state.
    public static let empty = BatteryDegradationForecastProjection(
        currentHealth: nil,
        rate: 0,
        tier: .healthy,
        projected80Date: nil,
        riskFactors: [],
        recommendations: [],
        hasData: false
    )
}
