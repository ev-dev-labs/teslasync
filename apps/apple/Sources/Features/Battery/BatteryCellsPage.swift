import SwiftUI

/// Native SwiftUI parity of `web/src/features/battery/pages/BatteryCellsPage.tsx`
/// (route `/battery-cells`). Individual cell voltage monitoring and analysis: the
/// web page chrome (`PageContainer` title + subtitle + the header `VehicleSelect`),
/// the six summary metric cards, the voltage heatmap with its bar/grid toggle, the
/// per-cell bar chart, the voltage-distribution histogram + imbalance trend, the
/// cell-voltage-over-time lines, the sortable cell-details table, the voltage-spread
/// trend area chart, the temperature summary, the health recommendations, and the
/// summary-stat tiles. Every data state the source produces is implemented (loading
/// / empty / error / success), including each section's own empty state.
///
/// Adaptive (ADR-002/006): the metric grids, the chart pairs, and the table reflow
/// for macOS / iPad regular width vs. compact iPhone. All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the
/// `@Observable` `BatteryCellsPageModel` (no networking in the view). SI Celsius
/// temperatures convert to the user's unit only here, at the render boundary, via
/// the shared `Units` facade (ADR-005).
public struct BatteryCellsPage: View {
    @State private var model: BatteryCellsPageModel
    @State private var showHeatmap = true
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: BatteryCellsPageModel) {
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
        .navigationTitle(Text("battery.cells.title"))
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.data == nil else { return }
            await model.load()
        }
    }

    var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Header (web PageContainer title + subtitle + VehicleSelect)

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
            TSPageTitle("Battery Cells")
            Text("Individual cell voltage monitoring and analysis")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header `VehicleSelect` (shown only when there is at least one vehicle).
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
            BatteryCellsSkeleton()
        case .empty:
            emptyView
        case let .error(message):
            errorView(message)
        case .ready:
            if let data = model.data {
                readyView(data)
            } else {
                emptyView
            }
        }
    }

    /// Web no-data state (no vehicle scope / empty query) — a single page-level empty.
    private var emptyView: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "battery.cells.empty.title",
                message: "battery.cells.empty.message",
                systemImage: "square.grid.3x3"
            )
            .frame(maxWidth: .infinity)
        }
    }

    /// Web `PageContainer error` region — message plus a Retry affordance.
    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                TSErrorDisplay(onRetry: { Task { await model.refresh() } })
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web main PageContainer body)

    private func readyView(_ data: BatteryCellData) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            BatteryCellsSummarySection(data: data)
            BatteryCellsHeatmapSection(data: data, showHeatmap: $showHeatmap)
            BatteryCellsVoltageBarSection(data: data)
            chartPair(data)
            BatteryCellsVoltageOverTimeSection(data: data)
            BatteryCellsDetailsSection(data: data)
            BatteryCellsSpreadTrendSection(data: data)
            BatteryCellsTemperatureSection(data: data, units: units)
            BatteryCellsRecommendationsSection(data: data)
            BatteryCellsSummaryStatsSection(data: data, units: units)
        }
    }

    /// Side-by-side voltage distribution + imbalance trend (web two-column grid).
    private func chartPair(_ data: BatteryCellData) -> some View {
        let columns = isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.lg)]
            : [GridItem(.flexible(), spacing: TSSpacing.lg), GridItem(.flexible(), spacing: TSSpacing.lg)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            BatteryCellsDistributionSection(data: data)
            BatteryCellsImbalanceTrendSection(data: data)
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        BatteryCellsPage(model: BatteryCellsPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty sections") {
        BatteryCellsPage(model: BatteryCellsPageModel(dataSource: EmptySectionsBatteryCellsDataSource()))
            .teslaSyncTheme()
    }

    #Preview("No data") {
        BatteryCellsPage(model: BatteryCellsPageModel(dataSource: EmptyBatteryCellsDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        BatteryCellsPage(model: BatteryCellsPageModel(dataSource: FailingBatteryCellsDataSource()))
            .teslaSyncTheme()
    }
#endif
