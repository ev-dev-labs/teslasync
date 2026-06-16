import SwiftUI

// The eight headline stat cards (web `ChargingDetailPage.tsx` stat grid: Energy, Duration,
// Peak Power, SoC Range, Total/Est Cost, Per kWh, Miles Added, kWh/h Avg). Values format at
// the render boundary through `Units` / `ChargingDetailFormat`; the cost cards annotate an
// estimated value with the `atRate` / `fromSettings` sublabels exactly as the web does. The
// grid reflows for compact iPhone vs. regular macOS/iPad width.

/// The headline stat grid (web's eight `StatCard`s under the battery-progress panel).
struct ChargingStatGridSection: View {
    let session: ChargingSessionDetail
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            energyCard
            durationCard
            peakPowerCard
            socRangeCard
            costCard
            perKwhCard
            milesAddedCard
            avgRateCard
        }
    }

    // MARK: Energy / duration / power / SoC

    private var energyCard: ChargingStatCard {
        ChargingStatCard(
            title: "charging.detail.energy",
            value: Units.formatEnergy(session.totalEnergyAddedWh, units),
            systemImage: "bolt.fill"
        )
    }

    private var durationCard: ChargingStatCard {
        let minutes = Double(ChargingDetailDerivations.durationMinutes(session.startedAt, session.endedAt))
        return ChargingStatCard(
            title: "charging.detail.duration",
            value: ChargingDetailFormat.number(minutes, decimals: 0),
            unit: "min",
            systemImage: "clock.fill"
        )
    }

    private var peakPowerCard: ChargingStatCard {
        ChargingStatCard(
            title: "charging.detail.peakPower",
            value: ChargingDetailFormat.number((session.peakPowerW ?? 0) / 1000, decimals: 1),
            unit: "kW",
            systemImage: "gauge.with.dots.needle.bottom.50percent"
        )
    }

    private var socRangeCard: ChargingStatCard {
        ChargingStatCard(
            title: "charging.detail.socRange",
            value: ChargingDetailFormat.socRange(start: session.startSocPct, end: session.endSocPct),
            unit: "%",
            systemImage: "battery.100"
        )
    }

    // MARK: Cost / per-kWh / distance / rate

    private var costCard: ChargingStatCard {
        if let cost = session.costDecimal {
            return ChargingStatCard(
                title: "charging.detail.totalCost",
                value: ChargingDetailFormat.number(cost, decimals: 2),
                unit: ChargingDetailFormat.defaultCurrencySymbol,
                systemImage: "dollarsign.circle.fill"
            )
        }
        let hasEnergy = session.totalEnergyAddedWh > 0
        let estimate = (session.totalEnergyAddedWh / 1000) * ChargingDetailFormat.defaultCostPerKwh
        return ChargingStatCard(
            title: "charging.detail.estCost",
            value: hasEnergy ? ChargingDetailFormat.number(estimate, decimals: 2) : ChargingDetailFormat.emptyValue,
            unit: hasEnergy ? ChargingDetailFormat.defaultCurrencySymbol : nil,
            systemImage: "dollarsign.circle.fill",
            sublabel: hasEnergy ? atRateSublabel : nil
        )
    }

    private var perKwhCard: ChargingStatCard {
        let derived = ChargingDetailDerivations.costPerKwh(session)
        let rate = derived ?? ChargingDetailFormat.defaultCostPerKwh
        return ChargingStatCard(
            title: "charging.detail.perKwh",
            value: ChargingDetailFormat.number(rate, decimals: 2),
            unit: "$/kWh",
            systemImage: "dollarsign.circle.fill",
            sublabel: derived == nil ? String(localized: "charging.detail.fromSettings") : nil
        )
    }

    private var milesAddedCard: ChargingStatCard {
        let meters = ChargingDetailDerivations.addedDistanceM(session)
        return ChargingStatCard(
            title: "charging.detail.milesAdded",
            value: meters.map { Units.formatDistance($0, units) } ?? ChargingDetailFormat.emptyValue,
            systemImage: "mappin.and.ellipse"
        )
    }

    private var avgRateCard: ChargingStatCard {
        let rate = ChargingDetailDerivations.kwhPerHour(session)
        return ChargingStatCard(
            title: "charging.detail.avgRate",
            value: rate.map { ChargingDetailFormat.number($0, decimals: 1) } ?? ChargingDetailFormat.emptyValue,
            unit: rate != nil ? "kWh/h" : nil,
            systemImage: "bolt.fill"
        )
    }

    private var atRateSublabel: String {
        String(
            format: String(localized: "charging.detail.atRate"),
            ChargingDetailFormat.defaultCurrencySymbol,
            ChargingDetailFormat.number(ChargingDetailFormat.defaultCostPerKwh, decimals: 2)
        )
    }
}
