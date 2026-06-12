import SwiftUI

// The metric-card grids and panels for the Statistics surface (web `MetricCard` cards, the
// Battery-Health `GlassPanel`, and the Mileage-Summary `GlassPanel`). Each value formats from
// raw SI via `StatisticsFormat` at this display boundary; each panel renders its own empty state
// (never a blank region). The state-distribution + vehicle-comparison charts live in
// `StatisticsPage.Charts.swift`.

// MARK: - Metric card (web `MetricCard` — label + value + tinted icon)

/// One labeled metric with a tinted SF Symbol (web `MetricCard` with its `color` prop). Composes
/// the shared `TSCard` + `TSIconBox` + typography so the per-card accent matches the web hue.
struct StatisticsMetricCard: View {
    let title: LocalizedStringKey
    let value: String
    let systemImage: String
    let tone: TSTone

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    TSMetricLabel(title)
                    Spacer(minLength: TSSpacing.sm)
                    TSIconBox(systemName: systemImage, tone: tone)
                }
                TSMetricValue(value)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Period stats (web 5 MetricCards: Total-Distance/Drives/Energy/Cost/CO₂)

/// The five lifetime period-stat cards (web Total-Distance, Total-Drives, Total-Energy,
/// Total-Cost, CO₂-Saved). SI values convert to the user's unit at the boundary.
struct StatisticsPeriodStatsSection: View {
    let stats: StatisticsPeriodStats
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            StatisticsMetricCard(
                title: "statistics.totalDistance",
                value: StatisticsFormat.distanceInt(stats.totalDistanceM, units),
                systemImage: "mappin.and.ellipse",
                tone: .accent
            )
            StatisticsMetricCard(
                title: "statistics.totalDrives",
                value: StatisticsFormat.integer(Double(stats.totalDrives)),
                systemImage: "chart.line.uptrend.xyaxis",
                tone: .success
            )
            StatisticsMetricCard(
                title: "statistics.totalEnergy",
                value: StatisticsFormat.energyKWh(stats.energyUsedWh, units),
                systemImage: "bolt.fill",
                tone: .warning
            )
            StatisticsMetricCard(
                title: "statistics.totalCost",
                value: StatisticsFormat.totalCost(stats.totalCost),
                systemImage: "dollarsign.circle",
                tone: .danger
            )
            StatisticsMetricCard(
                title: "statistics.co2Saved",
                value: StatisticsFormat.co2(stats.co2SavedKg, units),
                systemImage: "leaf.fill",
                tone: .success
            )
        }
    }
}

// MARK: - Averages (web 3 MetricCards: Avg-Drive-Distance/Efficiency/Cost-per-km)

/// The three average cards (web Avg-Drive-Distance, Avg-Efficiency, Cost-per-km).
struct StatisticsAveragesSection: View {
    let stats: StatisticsPeriodStats
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            StatisticsMetricCard(
                title: "statistics.avgDriveDistance",
                value: StatisticsFormat.distance(stats.avgDriveDistanceM, units),
                systemImage: "mappin.and.ellipse",
                tone: .accent
            )
            StatisticsMetricCard(
                title: "statistics.avgEfficiency",
                value: StatisticsFormat.efficiency(stats.avgEfficiencyWhKm, units),
                systemImage: "gauge.with.dots.needle.bottom.50percent",
                tone: .success
            )
            StatisticsMetricCard(
                title: "statistics.costPerKm",
                value: StatisticsFormat.costPerKm(stats.costPerKm),
                systemImage: "dollarsign.circle",
                tone: .warning
            )
        }
    }
}

// MARK: - Battery health (web GlassPanel9 — radial gauge + 4 MetricCards, or empty)

/// The battery-health panel (web GlassPanel9): a state-of-health radial gauge plus the capacity,
/// degradation, cycles, and age cards — or a no-battery empty state when no data is available.
struct StatisticsBatteryHealthSection: View {
    let health: StatisticsBatteryHealth?
    let units: UnitPreferences

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle("statistics.batteryHealth")
                if let health {
                    content(health)
                } else {
                    TSEmptyState(title: "statistics.noBattery", systemImage: "minus.plus.batteryblock")
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func content(_ health: StatisticsBatteryHealth) -> some View {
        let gauge = StatisticsBatteryGauge(fraction: health.sohFraction)
        let cards = batteryCards(health)
        if isCompact {
            VStack(spacing: TSSpacing.lg) {
                gauge
                cards
            }
        } else {
            HStack(alignment: .center, spacing: TSSpacing.x2xl) {
                gauge.frame(maxWidth: .infinity)
                cards.frame(maxWidth: .infinity)
            }
        }
    }

    private func batteryCards(_ health: StatisticsBatteryHealth) -> some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)],
            spacing: TSSpacing.md
        ) {
            StatisticsMetricCard(
                title: "statistics.capacity",
                value: StatisticsFormat.capacityKWh(health.estimatedCapacityWh),
                systemImage: "battery.100",
                tone: .accent
            )
            StatisticsMetricCard(
                title: "statistics.degradation",
                value: StatisticsFormat.degradationPerYear(health.degradationRateYr),
                systemImage: "chart.line.uptrend.xyaxis",
                tone: .warning
            )
            StatisticsMetricCard(
                title: "statistics.cycles",
                value: StatisticsFormat.integer(Double(health.totalCycles)),
                systemImage: "arrow.triangle.2.circlepath",
                tone: .info
            )
            StatisticsMetricCard(
                title: "statistics.age",
                value: StatisticsFormat.ageMonths(health.batteryAgeMonths),
                systemImage: "clock",
                tone: .success
            )
        }
    }
}

// MARK: - Mileage summary (web GlassPanel15 — 4 MetricCards, or empty)

/// The mileage-summary panel (web GlassPanel15): total distance, daily average, total drives, and
/// yearly projection — or a no-mileage empty state when no data is available.
struct StatisticsMileageSection: View {
    let mileage: StatisticsMileage?
    let units: UnitPreferences

    private let columns = [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle("statistics.mileage")
                if let mileage {
                    LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                        StatisticsMetricCard(
                            title: "statistics.totalMileage",
                            value: StatisticsFormat.distanceInt(mileage.lifetimeDistanceM, units),
                            systemImage: "mappin.and.ellipse",
                            tone: .accent
                        )
                        StatisticsMetricCard(
                            title: "statistics.dailyAvg",
                            value: StatisticsFormat.distance(mileage.dailyAverageM, units),
                            systemImage: "car",
                            tone: .success
                        )
                        StatisticsMetricCard(
                            title: "statistics.totalDrives",
                            value: StatisticsFormat.integer(Double(mileage.driveCountLifetime)),
                            systemImage: "clock",
                            tone: .info
                        )
                        StatisticsMetricCard(
                            title: "statistics.yearlyProjection",
                            value: StatisticsFormat.distanceInt(mileage.yearlyProjectionM, units),
                            systemImage: "chart.line.uptrend.xyaxis",
                            tone: .warning
                        )
                    }
                } else {
                    TSEmptyState(title: "statistics.noMileage", systemImage: "car")
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Loading skeleton (web StatisticsSkeleton)

/// Mirrors the page layout while the primary source loads (web `StatisticsSkeleton`): five
/// period cards → three averages → the battery panel → the state/mileage row → the comparison
/// chart, all under SwiftUI redaction (the manifest's `loading → redacted(reason:)`).
struct StatisticsSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            skeletonGrid(count: 5, minimum: 150)
            skeletonGrid(count: 3, minimum: 200)
            skeletonBlock(height: 200)
            HStack(spacing: TSSpacing.lg) {
                skeletonBlock(height: 280)
                skeletonBlock(height: 280)
            }
            skeletonBlock(height: 300)
        }
        .statisticsRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("statistics.title"))
    }

    private func skeletonGrid(count: Int, minimum: CGFloat) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            ForEach(0 ..< count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: 84)
            }
        }
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

// MARK: - Loading redaction (web Skeleton loading state)

extension View {
    /// Applies SwiftUI's skeleton redaction while `loading`, matching the web Skeleton loading
    /// state (the manifest's `loading → redacted(reason:)` requirement).
    func statisticsRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}
