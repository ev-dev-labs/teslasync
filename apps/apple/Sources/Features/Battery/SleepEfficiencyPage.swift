import SwiftUI

/// Native SwiftUI parity of `web/src/features/battery/pages/SleepEfficiencyPage.tsx`
/// (route `/sleep-efficiency`). Vehicle sleep patterns, vampire drain, and Sentry-mode
/// costs: the web page chrome (`PageContainer` title + subtitle + the header
/// `VehicleSelect` / `RangePicker` / freshness), the four summary metric cards
/// (Sleep-Efficiency, Avg-Time-to-Sleep, Sentry-Drain-Rate, Sentry-Monthly-Cost), the
/// State-Distribution donut, the Sentry-vs-No-Sentry comparison bars, the Monthly Sentry
/// Impact callout, and the Recent-Drain-Events table. Every data state the source
/// produces is implemented (loading / empty / error / success), including each section's
/// own empty state.
///
/// Adaptive (ADR-002/006): the metric grid, the donut/comparison pair, and the table
/// reflow for macOS / iPad regular width vs. compact iPhone. All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `SleepEfficiencyPageModel` (no networking in the view). SI Celsius converts to the
/// user's unit, and the cost cards apply the user's currency symbol, only here — at the
/// render boundary, via the shared `Units` facade + `SleepEfficiencyFormat` (ADR-005).
public struct SleepEfficiencyPage: View {
    @State private var model: SleepEfficiencyPageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: SleepEfficiencyPageModel) {
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
        .navigationTitle(Text("sleep.title"))
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.sleep == nil else { return }
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
            TSPageTitle("sleep.title")
            Text("sleep.subtitle")
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

    /// Web header `VehicleSelect` (shown only when there is at least one vehicle).
    private var vehiclePicker: some View {
        TSSelect(
            selection: vehicleBinding,
            options: model.vehicles.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) }
        )
        .frame(maxWidth: 220)
        .accessibilityLabel(Text("sleep.selectVehicle"))
    }

    /// Web header `RangePicker` (canonical preset window → the `days` query param).
    private var rangePicker: some View {
        TSSelect(
            selection: rangeBinding,
            options: SleepRange.allCases.map { TSSelectOption($0, LocalizedStringKey($0.labelKey)) }
        )
        .frame(maxWidth: 150)
        .accessibilityLabel(Text("sleep.range.label"))
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

    private var rangeBinding: Binding<SleepRange> {
        Binding(
            get: { model.range },
            set: { newValue in Task { await model.selectRange(newValue) } }
        )
    }

    // MARK: - Top-level phase switch (web PageContainer phases)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SleepEfficiencySkeleton()
        case .empty:
            emptyView
        case let .error(message):
            errorView(message)
        case .ready:
            if let sleep = model.sleep {
                readyView(sleep)
            } else {
                emptyView
            }
        }
    }

    /// Web no-data state (`!sleep && !isLoading`) — a single page-level empty with the
    /// moon glyph + the "data will appear after sleep/wake events" message.
    private var emptyView: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "sleep.noData",
                systemImage: "moon.zzz.fill"
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

    private func readyView(_ sleep: SleepEfficiencyData) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            SleepEfficiencySummarySection(sleep: sleep, units: units, currencySymbol: model.currencySymbol)
            chartPair(sleep)
            SleepRecentDrainEventsSection(sleep: sleep, units: units)
        }
    }

    /// State-Distribution donut beside the Sentry comparison + impact callout (web
    /// two-column grid; stacks on compact width).
    private func chartPair(_ sleep: SleepEfficiencyData) -> some View {
        let columns = isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.lg)]
            : [GridItem(.flexible(), spacing: TSSpacing.lg), GridItem(.flexible(), spacing: TSSpacing.lg)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            SleepStateDistributionSection(sleep: sleep)
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                SleepSentryComparisonSection(sleep: sleep)
                SleepSentryImpactCallout(sleep: sleep, units: units, currencySymbol: model.currencySymbol)
            }
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        SleepEfficiencyPage(model: SleepEfficiencyPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty sections") {
        SleepEfficiencyPage(
            model: SleepEfficiencyPageModel(dataSource: EmptySectionsSleepEfficiencyDataSource())
        )
        .teslaSyncTheme()
    }

    #Preview("No data") {
        SleepEfficiencyPage(
            model: SleepEfficiencyPageModel(dataSource: EmptySleepEfficiencyDataSource())
        )
        .teslaSyncTheme()
    }

    #Preview("Error") {
        SleepEfficiencyPage(
            model: SleepEfficiencyPageModel(dataSource: FailingSleepEfficiencyDataSource())
        )
        .teslaSyncTheme()
    }
#endif
