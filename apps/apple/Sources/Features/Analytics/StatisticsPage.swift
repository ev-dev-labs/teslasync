import SwiftUI

/// Native SwiftUI parity of `web/src/features/analytics/pages/StatisticsPage.tsx`
/// (route `/statistics`). Lifetime vehicle statistics and records: the web page chrome
/// (web `PageContainer`: title + subtitle + the vehicle `Select`), the five period-stat cards,
/// the three averages, the battery-health panel (radial gauge + four metrics), the side-by-side
/// state-distribution pie chart + mileage summary, and the fleet vehicle-comparison bar chart.
/// Every data state the source produces is implemented (loading / empty / error / success),
/// including each section's own empty state (web per-section `EmptyState`).
///
/// Adaptive (ADR-002/006): the stat grids, the battery panel, and the state/mileage row reflow
/// for macOS / iPad regular width vs. compact iPhone. All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `StatisticsPageModel` (no networking in the view). SI values convert to the user's unit
/// preference only here, at the render boundary, via the shared `Units` facade (ADR-005).
public struct StatisticsPage: View {
    @State private var model: StatisticsPageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: StatisticsPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.periodStats == nil else { return }
            await model.load()
        }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Header (web PageContainer title + subtitle + vehicle Select)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    if !model.vehicles.isEmpty { vehiclePicker }
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    if !model.vehicles.isEmpty { vehiclePicker.frame(maxWidth: 260) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("statistics.title")
            Text("statistics.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web vehicle `Select` (shown only when `vehicles.length > 0`).
    private var vehiclePicker: some View {
        TSSelect(
            selection: vehicleBinding,
            options: model.vehicles.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) }
        )
        .accessibilityLabel(Text("route.vehicles"))
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID ?? 0 },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    // MARK: - Top-level phase switch (web PageContainer phases)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            StatisticsSkeleton()
        case .empty:
            emptyView
        case .error:
            errorView
        case .ready:
            readyView
        }
    }

    /// Web `!stats` no-data EmptyState (no recovery action — transient source gap).
    private var emptyView: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "statistics.noData",
                message: "statistics.noDataMsg",
                systemImage: "chart.bar"
            )
            .frame(maxWidth: .infinity)
        }
    }

    /// Web `PageContainer error` region — message plus a Retry affordance.
    private var errorView: some View {
        TSGlassPanel {
            TSErrorDisplay(onRetry: { Task { await model.refresh() } })
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web main PageContainer body)

    private var readyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            if let stats = model.periodStats {
                StatisticsPeriodStatsSection(stats: stats, units: units)
                StatisticsAveragesSection(stats: stats, units: units)
            }
            StatisticsBatteryHealthSection(health: model.batteryHealth, units: units)
            stateAndMileage
            StatisticsComparisonSection(
                items: model.comparison,
                showsComparison: model.showsComparison,
                units: units
            )
        }
    }

    /// Side-by-side state-distribution pie + mileage summary (web two-column grid).
    private var stateAndMileage: some View {
        let columns = isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.lg)]
            : [GridItem(.flexible(), spacing: TSSpacing.lg), GridItem(.flexible(), spacing: TSSpacing.lg)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            StatisticsStateDistributionSection(slices: model.stateSlices)
            StatisticsMileageSection(mileage: model.mileage, units: units)
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        StatisticsPage(model: StatisticsPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        StatisticsPage(model: StatisticsPageModel(dataSource: EmptyStatisticsDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        StatisticsPage(model: StatisticsPageModel(dataSource: FailingStatisticsDataSource()))
            .teslaSyncTheme()
    }
#endif
