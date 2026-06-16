import SwiftUI

/// Native SwiftUI parity of `web/src/features/driving/pages/EfficiencyPage.tsx` (route `/efficiency`).
/// The energy-consumption / driving-efficiency analysis: the page chrome (web `PageContainer`: title +
/// subtitle + the global `VehicleSelect` and the `RangePicker`), the hero average-consumption gauge +
/// km/kWh + CO₂ + total-distance figures, the four summary stat cards, the daily-efficiency area chart,
/// the efficiency-by-speed-range bar chart, the speed-vs-efficiency and temperature-vs-efficiency
/// scatter plots, the temperature-bucketed table, the metric-bar summary, and the energy insights.
/// Every data state the source produces is implemented (loading / empty / error / success).
///
/// Adaptive (ADR-002/006): the hero grid, the stat-card grid, the chart rows, the summary grid, and the
/// insights grid reflow for macOS / iPad regular width vs. compact iPhone. All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `EfficiencyPageModel` (no networking in the view). SI values convert to the user's unit preference
/// only here, at the render boundary, via the shared `Units` facade + `EfficiencyPageFormat` (ADR-005). The
/// per-drive efficiency + all chart/table aggregations are derived in `EfficiencyEngine`, mirroring the
/// web `getEfficiency` + `useMemo` blocks.
public struct EfficiencyPage: View {
    @State private var model: EfficiencyPageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: EfficiencyPageModel) {
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
        .navigationTitle(Text("efficiency.title"))
        .refreshable { await model.refresh() }
        .onChange(of: units) { _, newValue in model.setUnits(newValue) }
        .task {
            model.setUnits(units)
            guard model.loadState == .loading, model.drives.isEmpty else { return }
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

    // MARK: - Header (web PageContainer title + subtitle + VehicleSelect + RangePicker)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    controls
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    controls
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("efficiency.title")
            Text("efficiency.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web `actions`: the global `VehicleSelect` plus the date `RangePicker`.
    private var controls: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    if !model.vehicles.isEmpty { vehiclePicker }
                    rangeControl
                }
            } else {
                HStack(spacing: TSSpacing.md) {
                    if !model.vehicles.isEmpty { vehiclePicker.frame(maxWidth: 220) }
                    rangeControl
                }
            }
        }
    }

    private var rangeControl: some View {
        EfficiencyRangeControl(
            startDate: model.startDate,
            endDate: model.endDate,
            onChange: { model.setDateRange(start: $0, end: $1) }
        )
    }

    /// Web global `VehicleSelect`.
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
            EfficiencySkeleton()
        case let .error(message):
            errorView(message)
        case .ready:
            readyView
        }
    }

    /// Web `PageContainer error` region — message plus a Retry affordance (the native equivalent of the
    /// web hooks silently degrading to empties on a total load failure).
    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(message: LocalizedStringKey(message), onRetry: { Task { await model.refresh() } })
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web main PageContainer body — every section, each with its own empty)

    private var readyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            EfficiencyHeroSection(stats: model.stats, units: units, isCompact: isCompact)
            EfficiencyStatCardsSection(stats: model.stats, units: units, isCompact: isCompact)
            chartRow {
                EfficiencyDailyTrendSection(points: model.dailyTrend, units: units)
            } trailing: {
                EfficiencySpeedRangeSection(buckets: model.speedDistribution, units: units)
            }
            chartRow {
                EfficiencySpeedScatterSection(points: model.speedVsEfficiency, units: units)
            } trailing: {
                EfficiencyTempScatterSection(points: model.temperatureVsEfficiency, units: units)
            }
            EfficiencyTempTableSection(buckets: model.temperatureBuckets, units: units)
            EfficiencySummarySection(stats: model.stats, units: units, isCompact: isCompact)
            EfficiencyInsightsSection(stats: model.stats, units: units, isCompact: isCompact)
        }
    }

    /// Web `lg:grid-cols-2` chart rows: side-by-side on regular width, stacked on compact iPhone.
    @ViewBuilder
    private func chartRow(
        @ViewBuilder leading: () -> some View,
        @ViewBuilder trailing: () -> some View
    ) -> some View {
        let columns = isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.lg)]
            : [GridItem(.flexible(), spacing: TSSpacing.lg), GridItem(.flexible(), spacing: TSSpacing.lg)]
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            leading()
            trailing()
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        EfficiencyPage(model: EfficiencyPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        EfficiencyPage(model: EfficiencyPageModel(dataSource: EmptyEfficiencyDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        EfficiencyPage(model: EfficiencyPageModel(dataSource: FailingEfficiencyDataSource()))
            .teslaSyncTheme()
    }
#endif
