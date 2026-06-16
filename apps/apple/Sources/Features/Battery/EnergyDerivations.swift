import Foundation

// Pure, unit-tested derivations for the Energy surface — the SwiftUI port of every
// `useMemo` / inline computation in `web/src/features/battery/pages/EnergyPage.tsx`.
// Kept SwiftUI-free and SI-native so the view layer only converts at the render
// boundary. Every helper guards against empty/zero inputs the same way the web does
// (JS `|| 0`, `> 0 ? … : 0`).

public enum EnergyDerivations {
    /// Default analytics window (web default range: today − 30 days … today). Used for the
    /// monthly/annual projections and the "Last N days" lifetime label.
    public static let defaultPeriodDays = 30

    /// Grid carbon factor (web `totalEnergy * 0.42` kg CO₂ per kWh-equivalent fallback).
    public static let co2PerWh = 0.42

    /// Gas-equivalent cost factor (web `totalDistance * 0.12`).
    public static let gasPerMeter = 0.12

    // MARK: Totals

    /// Web `sessions.reduce((s, c) => s + c.total_energy_added_wh, 0)`.
    public static func totalEnergyWh(_ sessions: [EnergyChargingSession]) -> Double {
        sessions.reduce(0) { $0 + $1.totalEnergyAddedWh }
    }

    /// Web `sessions.reduce((s, c) => s + (c.cost_decimal ?? 0), 0)`.
    public static func totalCost(_ sessions: [EnergyChargingSession]) -> Double {
        sessions.reduce(0) { $0 + ($1.costDecimal ?? 0) }
    }

    /// Web `stats?.co2_saved_kg ?? totalEnergy * 0.42`.
    public static func co2SavedKg(stats: EnergyStats?, totalEnergyWh: Double) -> Double {
        stats?.co2SavedKg ?? (totalEnergyWh * co2PerWh)
    }

    /// Web gauge efficiency: `avgEfficiency || (totalDistance > 0 ? (totalEnergy * 1000) /
    /// totalDistance : 0)` — the stats average in Wh/m, else a fallback from totals.
    public static func efficiencyWhPerM(
        stats: EnergyStats?,
        totalEnergyWh: Double,
        totalDistanceM: Double
    ) -> Double {
        let avg = stats?.avgEfficiencyWhPerM ?? 0
        if avg != 0 { return avg }
        return totalDistanceM > 0 ? (totalEnergyWh * 1000) / totalDistanceM : 0
    }

    // MARK: Cost ratios + projections

    /// Web `costPerKm = totalDistance > 0 ? totalCost / totalDistance : 0` (SI: per metre).
    public static func costPerMeter(totalDistanceM: Double, totalCost: Double) -> Double {
        totalDistanceM > 0 ? totalCost / totalDistanceM : 0
    }

    /// Web `costPerKwh = totalEnergy > 0 ? totalCost / (totalEnergy / 1000) : 0`.
    public static func costPerKwh(totalEnergyWh: Double, totalCost: Double) -> Double {
        totalEnergyWh > 0 ? totalCost / (totalEnergyWh / 1000) : 0
    }

    /// Web `gasEquivalent = totalDistance * 0.12`.
    public static func gasEquivalent(totalDistanceM: Double) -> Double {
        totalDistanceM * gasPerMeter
    }

    /// Web `monthlyProjectedCost = costPerKm > 0 ? costPerKm * (totalDistance / periodDays)
    /// * 30 : 0`.
    public static func monthlyProjectedCost(
        costPerMeter: Double,
        totalDistanceM: Double,
        periodDays: Int
    ) -> Double {
        guard costPerMeter > 0, periodDays > 0 else { return 0 }
        return costPerMeter * (totalDistanceM / Double(periodDays)) * 30
    }

    /// Web `yearlyProjectedCost = monthlyProjectedCost * 12`.
    public static func yearlyProjectedCost(monthly: Double) -> Double {
        monthly * 12
    }

    /// Web projected-annual gas cost `(gasEquivalent / periodDays) * 365`.
    public static func projectedAnnualGas(gasEquivalent: Double, periodDays: Int) -> Double {
        guard periodDays > 0 else { return 0 }
        return (gasEquivalent / Double(periodDays)) * 365
    }

    // MARK: No-data gate (web `hasNoEnergyData`)

    /// Web `hasNoEnergyData`: no sessions AND no meaningful stats (all totals zero). Drives
    /// the honest empty hero instead of four zeroed gauges.
    public static func hasNoEnergyData(stats: EnergyStats?, sessions: [EnergyChargingSession]) -> Bool {
        let noSessions = sessions.isEmpty
        let noStats: Bool
        if let stats {
            noStats = (stats.totalWh == 0) && (stats.totalEnergyUsedWh == 0) && (stats.totalDistanceM == 0)
        } else {
            noStats = true
        }
        return noSessions && noStats
    }

    // MARK: Time-of-day analysis (web `timeOfDayData`)

    /// The local hour (0…23) of an ISO-8601 / `yyyy-MM-dd'T'HH:mm:ss` wire timestamp, using
    /// the supplied calendar (web `new Date(started_at).getHours()`). Returns nil when the
    /// timestamp cannot be parsed.
    public static func hour(fromISO raw: String, calendar: Calendar = .current) -> Int? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        let isoFractional = ISO8601DateFormatter()
        isoFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = iso.date(from: raw) ?? isoFractional.date(from: raw) else { return nil }
        return calendar.component(.hour, from: date)
    }

    /// Web `timeOfDayData`: buckets sessions into Night/Morning/Afternoon/Evening windows
    /// (0–6, 6–12, 12–18, 18–24) with each bucket's session count and total energy. `labels`
    /// are the four resolved bucket labels (ordered night, morning, afternoon, evening); an
    /// empty result mirrors the web `if (!sessions.length) return []`.
    public static func timeOfDay(
        _ sessions: [EnergyChargingSession],
        labels: [String],
        calendar: Calendar = .current
    ) -> [EnergyTimeOfDayBucket] {
        guard !sessions.isEmpty, labels.count == 4 else { return [] }
        var counts = [0, 0, 0, 0]
        var energy = [0.0, 0.0, 0.0, 0.0]
        for session in sessions {
            let bucket = bucketIndex(for: hour(fromISO: session.startedAt, calendar: calendar))
            counts[bucket] += 1
            energy[bucket] += session.totalEnergyAddedWh
        }
        return (0 ..< 4).map { index in
            EnergyTimeOfDayBucket(id: index, name: labels[index], count: counts[index], energyWh: energy[index])
        }
    }

    /// Web bucket selection `hour < 6 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : 3`; an
    /// unparseable hour falls into the night bucket (matching JS `NaN → 0`).
    static func bucketIndex(for hour: Int?) -> Int {
        guard let hour else { return 0 }
        if hour < 6 { return 0 }
        if hour < 12 { return 1 }
        if hour < 18 { return 2 }
        return 3
    }

    // MARK: Charger-type breakdown (web `chargerBreakdown`)

    /// Web `chargerBreakdown`: aggregates sessions into Supercharger / DC Fast / Home-AC
    /// categories with count, total energy, and total cost, in stable first-seen order. The
    /// palette index mirrors the web charger colour intent (Supercharger red, DC Fast amber,
    /// Home/AC green). Empty mirrors `if (!sessions.length) return []`.
    public static func chargerBreakdown(_ sessions: [EnergyChargingSession]) -> [EnergyChargerBreakdownRow] {
        guard !sessions.isEmpty else { return [] }
        var order: [String] = []
        var counts: [String: Int] = [:]
        var energy: [String: Double] = [:]
        var cost: [String: Double] = [:]
        for session in sessions {
            let label = chargerLabel(session.chargerType)
            if counts[label] == nil {
                order.append(label)
                counts[label] = 0
                energy[label] = 0
                cost[label] = 0
            }
            counts[label, default: 0] += 1
            energy[label, default: 0] += session.totalEnergyAddedWh
            cost[label, default: 0] += session.costDecimal ?? 0
        }
        return order.map { label in
            EnergyChargerBreakdownRow(
                name: label,
                count: counts[label] ?? 0,
                energyWh: energy[label] ?? 0,
                cost: cost[label] ?? 0,
                colorIndex: chargerColorIndex(label)
            )
        }
    }

    /// Web label rule: a `tesla` charger type → Supercharger; any other non-nil type → DC
    /// Fast; nil → Home/AC.
    static func chargerLabel(_ chargerType: String?) -> String {
        if let chargerType, chargerType.lowercased().contains("tesla") { return "Supercharger" }
        return chargerType != nil ? "DC Fast" : "Home/AC"
    }

    /// Palette index per charger category (Supercharger → orange-red, DC Fast → amber,
    /// Home/AC → green; anything else → cyan accent fallback like web `?? '#00f0ff'`).
    static func chargerColorIndex(_ label: String) -> Int {
        switch label {
        case "Supercharger": 5
        case "DC Fast": 1
        case "Home/AC": 2
        default: 4
        }
    }
}
