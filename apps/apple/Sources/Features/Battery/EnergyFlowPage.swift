import SwiftUI

/// Native SwiftUI parity of `web/src/features/battery/pages/EnergyFlowPage.tsx` (route
/// `/energy-flow`). Real-time power-flow schematic plus historical energy analytics: the web page
/// chrome (`PageContainer` title + subtitle + the header `VehicleSelect` + `RangePicker`), the live
/// energy-flow diagram (`/energy/flow`, polled in real time with a staleness guard), the six
/// summary cards, the daily-energy area chart, the paired daily-distance / daily-efficiency bar
/// charts, the efficiency-metrics panel, and the daily-energy-history table. Every data state the
/// sources produce is implemented (loading / empty / error / success), including each section's own
/// empty state.
///
/// Adaptive (ADR-002/006): the header, the flow schematic, the summary grid, and the chart rows
/// reflow for macOS / iPad regular width vs. compact iPhone. All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `EnergyFlowPageModel` (no networking in the view). SI watt-hours and metres convert to the
/// user's units only here, at the render boundary, via the shared `Units` facade (ADR-005).
public struct EnergyFlowPage: View {
    @State private var model: EnergyFlowPageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: EnergyFlowPageModel) {
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
        .navigationTitle(Text("Energy Flow"))
        .refreshable { await model.refresh() }
        .task {
            if model.stats == nil, model.phase == .loading { await model.load() }
            await pollLiveFlow()
        }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    /// Polls the live `/energy/flow` snapshot for the lifetime of the view (web `refetchInterval:
    /// REALTIME`); cancellation when the view disappears ends the loop.
    private func pollLiveFlow() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: model.liveRefreshInterval)
            if Task.isCancelled { break }
            await model.refreshFlow()
        }
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
            TSPageTitle("Energy Flow")
            Text("Power distribution and energy analysis")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header controls: the `VehicleSelect` and the `RangePicker` (presets-only here).
    private var controls: some View {
        HStack(alignment: .bottom, spacing: TSSpacing.md) {
            if !model.vehicles.isEmpty { vehiclePicker.frame(maxWidth: 220) }
            periodPicker.frame(maxWidth: 150)
        }
    }

    private var vehiclePicker: some View {
        TSSelect(
            selection: vehicleBinding,
            options: model.vehicles.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) }
        )
        .accessibilityLabel(Text("route.vehicles"))
    }

    private var periodPicker: some View {
        TSSelect(selection: periodBinding, options: periodOptions, label: "Period")
    }

    private var periodOptions: [TSSelectOption<Int>] {
        EnergyFlowDerivations.rangePresets.map { days in
            TSSelectOption(days, EnergyFlowPage.rangeLabel(days))
        }
    }

    private static func rangeLabel(_ days: Int) -> LocalizedStringKey {
        switch days {
        case 30: "energyFlow.range.30d"
        case 90: "energyFlow.range.90d"
        default: "energyFlow.range.7d"
        }
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID ?? 0 },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    private var periodBinding: Binding<Int> {
        Binding(
            get: { model.rangeDays },
            set: { newValue in Task { await model.setRangeDays(newValue) } }
        )
    }

    // MARK: - Phase switch (web PageContainer phases)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            EnergyFlowPageSkeleton()
        case .empty:
            emptyState
        case .error:
            errorState
        case .ready:
            readyView
        }
    }

    /// Web `{!stats && <EmptyState .../>}` — the honest no-data state replacing the body.
    private var emptyState: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "No Data",
                message: "No energy flow data available for this vehicle and time range.",
                systemImage: "bolt.fill"
            )
            .frame(maxWidth: .infinity, minHeight: 220)
        }
    }

    /// Web `error={statsError}` — the stats failure with a retry (the live flow is independent).
    private var errorState: some View {
        TSGlassPanel {
            TSQueryError(onRetry: { Task { await model.refresh() } })
                .frame(maxWidth: .infinity, minHeight: 220)
        }
    }

    // MARK: - Ready (web main PageContainer body)

    @ViewBuilder
    private var readyView: some View {
        if let stats = model.stats {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                TSFadeIn { EnergyFlowDiagramSection(model: model) }
                TSFadeIn(delay: 0.1) { EnergyFlowSummarySection(stats: stats, units: units) }
                TSFadeIn(delay: 0.2) {
                    EnergyFlowDailyEnergySection(rows: model.dailyBreakdown, units: units)
                }
                TSFadeIn(delay: 0.3) {
                    chartsRow(
                        EnergyFlowDailyDistanceSection(rows: model.dailyBreakdown, units: units),
                        EnergyFlowDailyEfficiencySection(rows: model.dailyBreakdown, units: units)
                    )
                }
                TSFadeIn(delay: 0.4) { EnergyFlowEfficiencySection(stats: stats, units: units) }
                TSFadeIn(delay: 0.5) {
                    EnergyFlowHistorySection(rows: model.sortedDailyRows, units: units)
                }
            }
        }
    }

    /// A two-column chart row on regular width that stacks on compact (web `lg:grid-cols-2`).
    @ViewBuilder
    private func chartsRow(_ leading: some View, _ trailing: some View) -> some View {
        if isCompact {
            VStack(spacing: TSSpacing.lg) {
                leading
                trailing
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                leading.frame(maxWidth: .infinity, alignment: .top)
                trailing.frame(maxWidth: .infinity, alignment: .top)
            }
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        EnergyFlowPage(model: EnergyFlowPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty sections") {
        EnergyFlowPage(model: EnergyFlowPageModel(dataSource: EmptySectionsEnergyFlowDataSource()))
            .teslaSyncTheme()
    }

    #Preview("No data") {
        EnergyFlowPage(model: EnergyFlowPageModel(dataSource: EmptyEnergyFlowDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        EnergyFlowPage(model: EnergyFlowPageModel(dataSource: FailingEnergyFlowDataSource()))
            .teslaSyncTheme()
    }
#endif
