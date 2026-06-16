import SwiftUI

/// Native SwiftUI parity of `web/src/features/charging/pages/ChargingListPage.tsx`
/// (route `/charging`). The Charging Sessions list: the web page chrome (`PageContainer`
/// title + subtitle + the header `VehicleSelect` / `RangePicker` / freshness), the sticky
/// summary, the search + active-filter chips, the six-KPI Overview card (Sessions /
/// Energy-kWh / Cost / Avg-rate-kW / Avg-duration / Avg-power-kW) with its prior-period
/// deltas, secondary line, and anomaly callout — or the no-stats GlassPanel when the window
/// is empty — the metric-switcher trend chart, the collection pills, the threshold-gated
/// analytical sections, and the date-grouped session list with bulk-delete + pagination.
/// Every data state the source produces is implemented (loading / empty / error / success),
/// including each section's own empty.
///
/// Adaptive (ADR-002/006): the header controls, the KPI grid, and the analytical pair
/// reflow for macOS / iPad regular width vs. compact iPhone, and the list scrolls in a
/// single column. All copy resolves from `Localizable.xcstrings` with the web key names;
/// data binds through the `@Observable` `ChargingListPageModel` (no networking in the view).
/// Energy / power arrive SI (Wh / W) and the cost cards apply the user's currency symbol —
/// converted only here, at the render boundary, via `ChargingListFormat` (ADR-005).
public struct ChargingListPage: View {
    @State private var model: ChargingListPageModel
    @State private var rangePreset: ChargingRangePreset = .month

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: ChargingListPageModel) {
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
        .navigationTitle(Text("charging.list.title"))
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.sessions.isEmpty else { return }
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

    // MARK: - Header (web PageContainer title + subtitle + VehicleSelect / RangePicker)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    headerControls
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    headerControls
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("charging.list.title")
            Text("charging.list.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header actions: the `VehicleSelect`, the `RangePicker`, and the
    /// `DataFreshnessAuto` (a refresh affordance + in-flight indicator here).
    private var headerControls: some View {
        HStack(spacing: TSSpacing.md) {
            if !model.vehicles.isEmpty { vehiclePicker }
            rangePicker
            refreshControl
        }
    }

    private var vehiclePicker: some View {
        TSSelect(
            selection: vehicleBinding,
            options: model.vehicles.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) }
        )
        .frame(maxWidth: 200)
        .accessibilityLabel(Text("charging.selectVehicle"))
    }

    private var rangePicker: some View {
        TSSelect(
            selection: rangeBinding,
            options: ChargingRangePreset.allCases.map { TSSelectOption($0, LocalizedStringKey($0.labelKey)) }
        )
        .frame(maxWidth: 150)
        .accessibilityLabel(Text("charging.range.label"))
    }

    /// Web `DataFreshnessAuto` — a refresh control that surfaces the in-flight refetch.
    private var refreshControl: some View {
        Button {
            Task { await model.refresh() }
        } label: {
            if model.isRefreshing {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: "arrow.clockwise")
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.accent)
        .disabled(model.isRefreshing)
        .accessibilityLabel(Text("action.refresh"))
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID ?? 0 },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    private var rangeBinding: Binding<ChargingRangePreset> {
        Binding(
            get: { rangePreset },
            set: { newValue in
                rangePreset = newValue
                Task { await model.setRange(newValue.range()) }
            }
        )
    }

    // MARK: - Top-level phase switch (web PageContainer phases)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ChargingListSkeleton()
        case let .error(message):
            errorView(message)
        case .empty, .ready:
            readyView
        }
    }

    /// Web `QueryError` region — message plus a Retry affordance.
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

    // MARK: - Ready (web main PageContainer body — always-rendered scaffold + section empties)

    private var readyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            ChargingStickySummary(model: model)
            ChargingSearchSection(model: model)
            ChargingOverviewSection(model: model, isCompact: isCompact)
            if model.currentStats.hasData {
                ChargingTrendChart(model: model)
            }
            ChargingCollectionsSection(model: model)
            ChargingAnalyticsSections(model: model, isCompact: isCompact)
            ChargingListSection(model: model)
        }
    }
}

// MARK: - Range presets (web `RangePicker` canonical preset windows)

/// The lookback windows the header range picker offers (web `RangePicker` presets, default
/// 30 days). Each resolves to an inclusive `from`/`to` day-key window ending today.
public enum ChargingRangePreset: String, CaseIterable, Identifiable, Sendable {
    case week
    case month
    case quarter
    case year

    public var id: String { rawValue }

    public var days: Int {
        switch self {
        case .week: 7
        case .month: 30
        case .quarter: 90
        case .year: 365
        }
    }

    public var labelKey: String {
        "charging.range.\(rawValue)"
    }

    /// The day-key window ending today (web preset → `from`/`to`).
    public func range(referenceDate: Date = Date()) -> ChargingDateRange {
        let calendar = ChargingAggregation.dayCalendar
        let start = calendar.date(byAdding: .day, value: -days, to: referenceDate) ?? referenceDate
        return ChargingDateRange(
            start: ChargingAggregation.dayKey(start),
            end: ChargingAggregation.dayKey(referenceDate)
        )
    }
}

#if DEBUG
    #Preview("Loaded") {
        ChargingListPage(model: ChargingListPageModel())
            .teslaSyncTheme()
    }

    #Preview("Sparse sections") {
        ChargingListPage(model: ChargingListPageModel(dataSource: SparseChargingListDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        ChargingListPage(model: ChargingListPageModel(dataSource: EmptyChargingListDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        ChargingListPage(model: ChargingListPageModel(dataSource: FailingChargingListDataSource()))
            .teslaSyncTheme()
    }
#endif
