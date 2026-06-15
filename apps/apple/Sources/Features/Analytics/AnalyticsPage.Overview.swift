import SwiftUI

// MARK: - Overview tab (web `OverviewTab` + `OverviewVehicleComparison`)

/// The Overview tab (web `OverviewTab`): distance-by-vehicle bars, the fleet-usage donut + efficiency
/// leaderboard, the radar comparison + energy/activity bars, the day-of-week and monthly-cost trends,
/// and the quick-links grid. Each section converts SI → the user's unit at the boundary and renders
/// its own empty state (never a blank region).
struct AnalyticsOverviewTab: View {
    let data: FleetAnalyticsData
    let model: AnalyticsPageModel
    let units: UnitPreferences
    let onNavigate: (AppRoute) -> Void

    private var vehicles: [AnalyticsVehicleComparison] {
        data.vehicleComparison
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            distanceByVehicle
            AnalyticsTwoColumn {
                fleetUsage
            } trailing: {
                efficiencyLeaderboard
            }
            AnalyticsTwoColumn {
                radarComparison
            } trailing: {
                energyActivity
            }
            dayOfWeek
            monthlyCost
            quickLinks
        }
    }

    // MARK: Distance by Vehicle (web single-series BarChart)

    private var distanceByVehicle: some View {
        AnalyticsChartPanel(
            title: "analytics.overview.distByVehicle",
            summary: "analytics.overview.distByVehicle.aria",
            isEmpty: vehicles.isEmpty,
            emptyTitle: "analytics.overview.noVehicles",
            emptyIcon: "car"
        ) {
            AnalyticsSingleBars(
                series: AnalyticsSeries.values(
                    vehicles.map { AnalyticsFormat.distanceValue($0.distanceM, units) },
                    id: "distance",
                    name: units.distance,
                    colorIndex: 0
                ),
                labels: vehicles.map(\.name)
            )
        }
    }

    // MARK: Fleet Usage (web PieChart of distance share)

    private var fleetUsage: some View {
        AnalyticsChartPanel(
            title: "analytics.overview.fleetUsage",
            summary: "analytics.overview.fleetUsage.aria",
            isEmpty: vehicles.isEmpty,
            emptyTitle: "analytics.overview.noVehicles",
            emptyIcon: "car"
        ) {
            TSPieChart(slices: vehicles.map { vehicle in
                TSChartSlice(
                    id: "\(vehicle.id)",
                    name: LocalizedStringKey(vehicle.name),
                    nameText: vehicle.name,
                    value: AnalyticsFormat.distanceValue(vehicle.distanceM, units),
                    colorIndex: vehicles.firstIndex { $0.id == vehicle.id } ?? 0
                )
            })
            .frame(height: 240)
        }
    }

    // MARK: Efficiency Leaderboard (web flex rows + neon bars)

    private var efficiencyLeaderboard: some View {
        AnalyticsPanel(title: "analytics.overview.effLeaderboard") {
            let entries = model.efficiencyLeaderboard
            if entries.isEmpty {
                TSEmptyState(
                    title: "analytics.overview.noEfficiency",
                    systemImage: "gauge.with.dots.needle.bottom.50percent"
                )
                .frame(maxWidth: .infinity, minHeight: 160)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        AnalyticsBarRow(
                            leading: "#\(index + 1) \(entry.name)",
                            trailing: AnalyticsFormat.efficiency(entry.efficiencyWhKm, units),
                            fraction: entry.fraction,
                            tone: .accent
                        )
                    }
                }
            }
        }
    }

    // MARK: Vehicle Comparison radar (web RadarChart, one polygon per vehicle)

    private var radarComparison: some View {
        AnalyticsPanel(title: "analytics.overview.vehicleComparison") {
            let radar = model.radarVehicles
            if radar.isEmpty {
                TSEmptyState(title: "analytics.overview.noComparison", systemImage: "chart.dots.scatter")
                    .frame(maxWidth: .infinity, minHeight: 160)
            } else {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 130), spacing: TSSpacing.md)],
                    spacing: TSSpacing.md
                ) {
                    ForEach(radar) { vehicle in
                        VStack(spacing: TSSpacing.xs) {
                            TSRadarChart(axes: radarAxes(vehicle), colorIndex: vehicle.colorIndex)
                                .frame(height: 150)
                            Text(verbatim: vehicle.name)
                                .font(Font.TS.caption)
                                .foregroundStyle(Color.TS.textSecondary)
                                .lineLimit(1)
                        }
                    }
                }
            }
        }
    }

    private func radarAxes(_ vehicle: AnalyticsRadarVehicle) -> [TSRadarAxis] {
        [
            TSRadarAxis(
                id: "distance", label: "analytics.metric.distance",
                labelText: "Distance", value: vehicle.distanceFraction
            ),
            TSRadarAxis(
                id: "energy", label: "analytics.metric.energy",
                labelText: "Energy", value: vehicle.energyFraction
            ),
            TSRadarAxis(
                id: "drives", label: "analytics.metric.drives",
                labelText: "Drives", value: vehicle.drivesFraction
            ),
            TSRadarAxis(
                id: "efficiency", label: "analytics.metric.efficiency",
                labelText: "Efficiency", value: vehicle.efficiencyFraction
            )
        ]
    }

    // MARK: Energy & Activity (web grouped BarChart: energy + drives)

    private var energyActivity: some View {
        AnalyticsPanel(title: "analytics.overview.energyActivity") {
            if vehicles.isEmpty {
                TSEmptyState(title: "analytics.overview.noVehicles", systemImage: "car")
                    .frame(maxWidth: .infinity, minHeight: 160)
            } else {
                AnalyticsGroupedBars(
                    series: [
                        AnalyticsSeries.values(
                            vehicles.map { AnalyticsFormat.energyKWhValue($0.energyWh) },
                            id: "energy",
                            name: String(localized: "analytics.overview.energykWh", defaultValue: "Energy (kWh)"),
                            colorIndex: 1
                        ),
                        AnalyticsSeries.values(
                            vehicles.map { Double($0.drives) },
                            id: "drives",
                            name: String(localized: "analytics.overview.drives", defaultValue: "Drives"),
                            colorIndex: 3
                        )
                    ],
                    labels: vehicles.map(\.name)
                )
            }
        }
    }
}

/// The remaining Overview sections live in an extension so the primary `View` declaration stays within
/// the type-body length budget (the sections share the struct's private state across the same file).
extension AnalyticsOverviewTab {
    // MARK: Day of Week Pattern (web dual-axis ComposedChart: drives + avg distance)

    private var dayOfWeek: some View {
        let rows = data.driveAnalytics.dayOfWeek
        return AnalyticsChartPanel(
            title: "analytics.overview.dayOfWeek",
            summary: "analytics.overview.dayOfWeek.aria",
            isEmpty: rows.isEmpty,
            emptyTitle: "analytics.overview.noDow"
        ) {
            AnalyticsTrendPair(
                barSeries: AnalyticsSeries.values(
                    rows.map { Double($0.drives) },
                    id: "drives",
                    name: String(localized: "analytics.overview.drives", defaultValue: "Drives"),
                    colorIndex: 2
                ),
                lineSeries: AnalyticsSeries.values(
                    rows.map { AnalyticsFormat.distanceValue($0.avgDistanceM, units) },
                    id: "avgDistance",
                    name: String(localized: "analytics.overview.avgDist", defaultValue: "Avg Distance"),
                    colorIndex: 3
                ),
                labels: rows.map(\.day)
            )
        }
    }

    // MARK: Monthly Cost Comparison (web ComposedChart: electric + gas bars, savings line)

    private var monthlyCost: some View {
        let rows = data.chargingAnalytics.monthlyTrend
        return AnalyticsChartPanel(
            title: "analytics.overview.monthlyCost",
            summary: "analytics.overview.monthlyCost.aria",
            isEmpty: rows.isEmpty,
            emptyTitle: "analytics.overview.noMonthly"
        ) {
            AnalyticsGroupedBars(
                series: [
                    AnalyticsSeries.values(
                        rows.map(\.cost),
                        id: "electric",
                        name: String(localized: "analytics.overview.electricCost", defaultValue: "Electric Cost"),
                        colorIndex: 0
                    ),
                    AnalyticsSeries.values(
                        rows.map(\.gasCost),
                        id: "gas",
                        name: String(localized: "analytics.overview.gasCost", defaultValue: "Gas Cost"),
                        colorIndex: 5
                    ),
                    AnalyticsSeries.values(
                        rows.map(\.savings),
                        id: "savings",
                        name: String(localized: "analytics.overview.savings", defaultValue: "Savings"),
                        colorIndex: 1
                    )
                ],
                labels: rows.map(\.month),
                height: 280
            )
        }
    }

    // MARK: Quick Links (web QUICK_LINKS grid)

    private var quickLinks: some View {
        AnalyticsPanel(title: "analytics.overview.quickLinks") {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.sm)],
                spacing: TSSpacing.sm
            ) {
                ForEach(AnalyticsQuickLink.all) { link in
                    quickLinkCard(link)
                }
            }
        }
    }

    @ViewBuilder
    private func quickLinkCard(_ link: AnalyticsQuickLink) -> some View {
        let label = HStack(spacing: TSSpacing.sm) {
            TSIconBox(systemName: link.systemImage, tone: .accent)
            Text(LocalizedStringKey(link.labelKey))
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.xs)
            Image(systemName: "chevron.right")
                .font(.caption2)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))

        if let route = link.route {
            Button { onNavigate(route) } label: { label }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isLink)
        } else {
            label
        }
    }
}

/// A two-column layout that collapses to one column on compact iPhone widths (web `grid lg:grid-cols-2`).
struct AnalyticsTwoColumn<Leading: View, Trailing: View>: View {
    @ViewBuilder var leading: () -> Leading
    @ViewBuilder var trailing: () -> Trailing

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
        let columns = isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.lg)]
            : [GridItem(.flexible(), spacing: TSSpacing.lg), GridItem(.flexible(), spacing: TSSpacing.lg)]
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            leading()
            trailing()
        }
    }
}

/// One quick-link destination (web `QUICK_LINKS`). Resolves its web path to an `AppRoute` so the card
/// deep-links into the native shell where a matching route exists.
struct AnalyticsQuickLink: Identifiable {
    let labelKey: String
    let systemImage: String
    let path: String

    var id: String {
        path
    }

    /// The resolved native route (web `href`), or `nil` when no `AppRoute` maps to the path.
    var route: AppRoute? {
        AppRouteParser.parse(path: path)
    }

    static let all: [AnalyticsQuickLink] = [
        AnalyticsQuickLink(labelKey: "analytics.links.statistics", systemImage: "chart.bar", path: "/statistics"),
        AnalyticsQuickLink(
            labelKey: "analytics.links.compare",
            systemImage: "arrow.left.arrow.right",
            path: "/period-compare"
        ),
        AnalyticsQuickLink(labelKey: "analytics.links.weeklyDigest", systemImage: "calendar", path: "/weekly-digest"),
        AnalyticsQuickLink(labelKey: "analytics.links.mileage", systemImage: "mappin.and.ellipse", path: "/mileage"),
        AnalyticsQuickLink(labelKey: "analytics.links.timeline", systemImage: "clock", path: "/timeline")
    ]
}
