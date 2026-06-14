import SwiftUI

/// Native SwiftUI parity of `web/src/features/battery/pages/BatteryDegradationPage.tsx`
/// (route `/battery-degradation`). Battery health trends, degradation predictions, and
/// charging-habit impact: the web page chrome (`PageContainer` title + subtitle + the
/// header `VehicleSelect`), the four summary metric cards, the health gauge, the
/// prediction panel with its four sub-metrics, the health-trend projection chart, the
/// range-loss area chart, the scored risk-factor gauges, the recommendations list, the
/// charging-impact banner, the battery-health-factor cards, and the sortable
/// degradation-history table. Every data state the source produces is implemented
/// (loading / empty / error / success), including each section's own empty state.
///
/// Adaptive (ADR-002/006): the metric grids, the gauge/prediction pair, the risk-factor
/// grid, and the table reflow for macOS / iPad regular width vs. compact iPhone. All copy
/// resolves from `Localizable.xcstrings` with the web key names; data binds through the
/// `@Observable` `BatteryDegradationPageModel` (no networking in the view). SI kilometres
/// and watt-hours convert to the user's units only here, at the render boundary, via the
/// shared `Units` facade (ADR-005).
public struct BatteryDegradationPage: View {
    @State private var model: BatteryDegradationPageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: BatteryDegradationPageModel) {
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
        .navigationTitle(Text("battery.degradation.title"))
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.health == nil else { return }
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
            TSPageTitle("Battery Degradation")
            Text("Health trends, degradation predictions, and charging habit impact")
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
            BatteryDegradationSkeleton()
        case .empty:
            emptyView
        case let .error(message):
            errorView(message)
        case .ready:
            if let health = model.health {
                readyView(health)
            } else {
                emptyView
            }
        }
    }

    /// Web no-data state (no vehicle scope / empty query) — a single page-level empty.
    private var emptyView: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "battery.degradation.empty.title",
                message: "battery.degradation.empty.message",
                systemImage: "minus.plus.batteryblock"
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

    private func readyView(_ health: BatteryHealthData) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            BatteryDegradationSummarySection(health: health, units: units)
            gaugePredictionPair(health)
            BatteryDegradationProjectionSection(rows: model.projectionRows)
            BatteryDegradationRangeLossSection(health: health, units: units)
            BatteryDegradationRiskFactorsSection(detail: model.detail)
            BatteryDegradationRecommendationsSection(detail: model.detail)
            BatteryDegradationChargingImpactSection(detail: model.detail)
            BatteryDegradationHealthFactorsSection(health: health, units: units)
            BatteryDegradationHistorySection(health: health, units: units)
        }
    }

    /// Side-by-side health gauge + prediction panel (web two-column grid).
    private func gaugePredictionPair(_ health: BatteryHealthData) -> some View {
        let columns = isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.lg)]
            : [GridItem(.flexible(), spacing: TSSpacing.lg), GridItem(.flexible(), spacing: TSSpacing.lg)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            BatteryDegradationGaugeSection(health: health)
            BatteryDegradationPredictionSection(health: health, detail: model.detail, units: units)
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        BatteryDegradationPage(model: BatteryDegradationPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty sections") {
        BatteryDegradationPage(
            model: BatteryDegradationPageModel(dataSource: EmptySectionsBatteryDegradationDataSource())
        )
        .teslaSyncTheme()
    }

    #Preview("No data") {
        BatteryDegradationPage(
            model: BatteryDegradationPageModel(dataSource: EmptyBatteryDegradationDataSource())
        )
        .teslaSyncTheme()
    }

    #Preview("Error") {
        BatteryDegradationPage(
            model: BatteryDegradationPageModel(dataSource: FailingBatteryDegradationDataSource())
        )
        .teslaSyncTheme()
    }
#endif
