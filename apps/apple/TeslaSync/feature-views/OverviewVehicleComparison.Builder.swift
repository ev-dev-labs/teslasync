//
//  OverviewVehicleComparison.Builder.swift
//  TeslaSync — P4 feature view · 0060 · OverviewVehicleComparison (Apple)
//
//  The pure adapter (cached fleet rows → projection). A 1:1 port of the derivation
//  logic in the web source: the `safe` finite-guard, the SI distance + efficiency
//  unit conversions (web `convertDistanceFromSI` + `whPerKmToDisplay`), the
//  number formatter (web `fmtNumber`), the efficiency `leaderboard` memo, the
//  `radarData` normalization (with the inverted efficiency axis), the fleet-usage
//  pie slices, the energy/activity bars, the surface phase + freshness resolution,
//  and the accessible summaries. Foundation-only and side-effect-free so it is
//  unit-tested by an executed headless harness.
//

import Foundation

// MARK: - Projection value types

/// One efficiency-leaderboard entry (web `leaderboard` memo element): the 1-based
/// rank, the bar fill percent (`eff / maxEff * 100`), and the pre-formatted
/// efficiency text ("123.4 Wh/km") in the user's unit.
public struct OverviewLeaderboardEntry: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let name: String
    public let rank: Int
    public let pct: Double
    public let efficiencyText: String
}

/// One vehicle's normalized radar magnitudes (web `radarData`), each clamped to
/// 0...1. The efficiency axis is inverted (`(maxEff - eff) / maxEff`) so a lower
/// Wh/km reads as a larger, "better" spoke.
public struct OverviewRadarVehicle: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let name: String
    public let distanceNorm: Double
    public let energyNorm: Double
    public let drivesNorm: Double
    public let efficiencyNorm: Double
}

/// One fleet-usage donut slice (web pie datum): the per-vehicle distance in the
/// user's display unit + the palette index (web `PIE_COLORS[i % PIE_COLORS.length]`).
public struct OverviewUsageSlice: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let name: String
    public let value: Double
    public let colorIndex: Int
}

/// One energy/activity bar group (web bar datum): energy in kWh + the drive count.
public struct OverviewActivityBar: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let name: String
    public let energyKwh: Double
    public let drives: Double
}

/// The four radar metric axes, in the web's order.
public enum OverviewRadarMetric: String, Sendable, CaseIterable {
    case distance
    case energy
    case drives
    case efficiency
}

/// Stateless projector that turns the cached vehicle rows (+ the distance unit)
/// into the per-panel projections the SwiftUI surface renders. Every function is
/// pure.
public enum OverviewComparisonBuilder {
    /// Palette index for energy bars (web `CHART_COLORS[1]`).
    public static let energyColorIndex = 1
    /// Palette index for drive-count bars (web `CHART_COLORS[3]`).
    public static let drivesColorIndex = 3
    /// Kilometres per mile (web `KM_PER_MILE`), for the Wh/km → Wh/mi conversion.
    public static let kmPerMile = 1.609344
    /// Metres per mile (web `METERS_PER_MILE`), for SI distance display.
    public static let metersPerMile = 1609.344
    /// Metres per kilometre.
    public static let metersPerKm = 1000.0

    // MARK: Numeric guards / conversions (port of web `safe` + `convert*`)

    /// Coalesces a non-finite value to zero (web `safe`).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Converts SI metres to the display unit (web `convertDistanceFromSI`).
    public static func convertDistanceFromSI(meters: Double, to unit: OverviewDistanceUnit) -> Double {
        switch unit {
        case .km: meters / metersPerKm
        case .mi: meters / metersPerMile
        }
    }

    /// The fleet-usage value: a vehicle's kilometres rendered in the display unit
    /// (web `convertDistanceFromSI(safe(distance) * 1000, distanceUnit)`).
    public static func displayDistance(km: Double, unit: OverviewDistanceUnit) -> Double {
        convertDistanceFromSI(meters: safe(km) * metersPerKm, to: unit)
    }

    /// The display efficiency: backend Wh/km, scaled to Wh/mi when the user prefers
    /// miles (web `whPerKmToDisplay`).
    public static func displayEfficiency(whPerKm: Double, unit: OverviewDistanceUnit) -> Double {
        unit == .mi ? safe(whPerKm) * kmPerMile : safe(whPerKm)
    }

    /// Locale-grouped number with a fixed fraction count (web `fmtNumber`).
    public static func formatNumber(_ value: Double, fractionDigits: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: safe(value))) ?? String(safe(value))
    }

    // MARK: Efficiency leaderboard (port of the web `leaderboard` memo)

    /// Sorts vehicles ascending by efficiency and computes each bar's fill percent
    /// against the least-efficient (largest) value, exactly as the web memo does.
    public static func leaderboard(
        _ vehicles: [OverviewVehicle],
        unit: OverviewDistanceUnit
    ) -> [OverviewLeaderboardEntry] {
        let sorted = vehicles.sorted { safe($0.efficiencyWhKm) < safe($1.efficiencyWhKm) }
        let maxEff = sorted.isEmpty ? 1 : safe(sorted[sorted.count - 1].efficiencyWhKm)
        return sorted.enumerated().map { offset, vehicle in
            let pct = maxEff > 0 ? (safe(vehicle.efficiencyWhKm) / maxEff) * 100 : 0
            let value = displayEfficiency(whPerKm: vehicle.efficiencyWhKm, unit: unit)
            let text = "\(formatNumber(value, fractionDigits: 1)) \(unit.efficiencyUnitLabel)"
            return OverviewLeaderboardEntry(
                id: vehicle.id,
                name: vehicle.name,
                rank: offset + 1,
                pct: pct,
                efficiencyText: text
            )
        }
    }

    // MARK: Radar comparison (port of the web `radarData` memo)

    /// Whether the radar renders (web `if (vehicles.length < 2) return []`).
    public static func showsRadar(_ vehicles: [OverviewVehicle]) -> Bool {
        vehicles.count >= 2
    }

    /// Normalizes each vehicle's four metrics to 0...1 against the fleet maxima,
    /// inverting efficiency so lower Wh/km reads larger (web `radarData`).
    public static func radarVehicles(_ vehicles: [OverviewVehicle]) -> [OverviewRadarVehicle] {
        guard showsRadar(vehicles) else { return [] }
        let maxDist = max(vehicles.map { safe($0.distanceKm) }.max() ?? 0, 1)
        let maxEnergy = max(vehicles.map { safe($0.energyKwh) }.max() ?? 0, 1)
        let maxDrives = max(vehicles.map { safe($0.drives) }.max() ?? 0, 1)
        let maxEff = max(vehicles.map { safe($0.efficiencyWhKm) }.max() ?? 0, 1)
        return vehicles.map { vehicle in
            OverviewRadarVehicle(
                id: vehicle.id,
                name: vehicle.name,
                distanceNorm: safe(vehicle.distanceKm) / maxDist,
                energyNorm: safe(vehicle.energyKwh) / maxEnergy,
                drivesNorm: safe(vehicle.drives) / maxDrives,
                efficiencyNorm: (maxEff - safe(vehicle.efficiencyWhKm)) / maxEff
            )
        }
    }

    /// The normalized spoke value for one metric (used by the radar view + tests).
    public static func radarValue(_ vehicle: OverviewRadarVehicle, metric: OverviewRadarMetric) -> Double {
        switch metric {
        case .distance: vehicle.distanceNorm
        case .energy: vehicle.energyNorm
        case .drives: vehicle.drivesNorm
        case .efficiency: vehicle.efficiencyNorm
        }
    }

    // MARK: Fleet-usage slices + energy/activity bars

    /// The donut slices: per-vehicle display distance + the 6-wrapped palette index
    /// (web `PIE_COLORS[i % PIE_COLORS.length]`, `PIE_COLORS` having six entries).
    public static func fleetUsage(
        _ vehicles: [OverviewVehicle],
        unit: OverviewDistanceUnit
    ) -> [OverviewUsageSlice] {
        vehicles.enumerated().map { offset, vehicle in
            OverviewUsageSlice(
                id: vehicle.id,
                name: vehicle.name,
                value: displayDistance(km: vehicle.distanceKm, unit: unit),
                colorIndex: offset % 6
            )
        }
    }

    /// The energy/activity bars: per-vehicle energy (kWh) + drive count, guarded.
    public static func energyActivity(_ vehicles: [OverviewVehicle]) -> [OverviewActivityBar] {
        vehicles.map { vehicle in
            OverviewActivityBar(
                id: vehicle.id,
                name: vehicle.name,
                energyKwh: safe(vehicle.energyKwh),
                drives: safe(vehicle.drives)
            )
        }
    }

    // MARK: Surface phase + freshness resolution

    /// Resolves the surface render branch. Whenever there are vehicles the grid
    /// shows (`.content`); a loaded-but-empty fleet shows the grid with per-panel
    /// empty states (`.empty`, the web's all-panels-present rendering); only a
    /// vehicle-less initial fetch shows the skeleton and only a vehicle-less failed
    /// fetch shows the retryable error.
    public static func resolvePhase(status: OverviewLoadStatus, vehicleCount: Int) -> OverviewRenderPhase {
        if vehicleCount > 0 {
            return .content
        }
        switch status {
        case .loading:
            return .loading
        case let .failed(message):
            return .error(message)
        case .loaded, .empty:
            return .empty
        }
    }

    /// Resolves the freshness status (offline ▸ error ▸ fetching ▸ stale ▸ fresh).
    public static func resolveFreshness(_ update: OverviewComparisonUpdate) -> OverviewFreshness {
        if update.connection == .offline {
            return .offline
        }
        if update.isError {
            return .error
        }
        if update.isFetching {
            return .fetching
        }
        if update.connection == .stale {
            return .stale
        }
        return .fresh
    }

    // MARK: Relative time (cached banner)

    /// A localized "just now / 5m ago / 2h ago / 3d ago / 1w ago" label, bucketed.
    public static func relativeTime(since date: Date, now: Date = Date()) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 {
            return OverviewComparisonStrings.string("overview.freshness.justNow", "just now")
        }
        if seconds < 3600 {
            return OverviewComparisonStrings.count("overview.freshness.minutes", "%lldm ago", seconds / 60)
        }
        if seconds < 86400 {
            return OverviewComparisonStrings.count("overview.freshness.hours", "%lldh ago", seconds / 3600)
        }
        if seconds < 604_800 {
            return OverviewComparisonStrings.count("overview.freshness.days", "%lldd ago", seconds / 86400)
        }
        return OverviewComparisonStrings.count("overview.freshness.weeks", "%lldw ago", seconds / 604_800)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver copy spoken for each panel's data. Pure + public so the
/// spoken content can be unit-tested without rendering the view. The radar metric
/// labels reuse the web `drives` key and native Distance/Energy/Efficiency keys.
public enum OverviewComparisonAccessibility {
    /// The localized label for a radar axis (web hardcodes these English strings;
    /// the native surface localizes them, reusing the web `drives` key).
    public static func radarMetricLabel(_ metric: OverviewRadarMetric) -> String {
        switch metric {
        case .distance:
            OverviewComparisonStrings.string("overview.metric.distance", "Distance")
        case .energy:
            OverviewComparisonStrings.string("overview.metric.energy", "Energy")
        case .drives:
            OverviewComparisonStrings.string("analytics.overview.drives", "Drives")
        case .efficiency:
            OverviewComparisonStrings.string("overview.metric.efficiency", "Efficiency")
        }
    }

    /// "Tesla 1 120 km, Tesla 2 80 km" — the donut distances spoken as one element.
    public static func fleetUsageSummary(_ slices: [OverviewUsageSlice], unit: OverviewDistanceUnit) -> String {
        slices
            .map { slice in
                let value = OverviewComparisonBuilder.formatNumber(slice.value, fractionDigits: 0)
                return "\(slice.name) \(value) \(unit.distanceUnitLabel)"
            }
            .joined(separator: ", ")
    }

    /// "Rank 1, Tesla 1, 123.4 Wh/km" — one leaderboard row spoken as one element.
    public static func leaderboardLabel(_ entry: OverviewLeaderboardEntry) -> String {
        let rank = OverviewComparisonStrings.count("overview.rank", "Rank %lld", entry.rank)
        return "\(rank), \(entry.name), \(entry.efficiencyText)"
    }

    /// "Tesla 1: Distance 100%, Energy 80%, Drives 60%, Efficiency 90%".
    public static func radarVehicleLabel(_ vehicle: OverviewRadarVehicle) -> String {
        let parts = OverviewRadarMetric.allCases.map { metric -> String in
            let percent = Int((OverviewComparisonBuilder.radarValue(vehicle, metric: metric) * 100).rounded())
            return "\(radarMetricLabel(metric)) \(percent)%"
        }
        return "\(vehicle.name): \(parts.joined(separator: ", "))"
    }

    /// "Tesla 1: Energy 12 kWh, Drives 5" — one bar group spoken as one element.
    public static func activityLabel(_ bar: OverviewActivityBar) -> String {
        let energyLabel = OverviewComparisonStrings.string("analytics.overview.energykWh", "Energy (kWh)")
        let drivesLabel = OverviewComparisonStrings.string("analytics.overview.drives", "Drives")
        let energy = OverviewComparisonBuilder.formatNumber(bar.energyKwh, fractionDigits: 1)
        let drives = OverviewComparisonBuilder.formatNumber(bar.drives, fractionDigits: 0)
        return "\(bar.name): \(energyLabel) \(energy), \(drivesLabel) \(drives)"
    }
}
