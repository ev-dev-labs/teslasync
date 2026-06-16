import SwiftUI

/// Native SwiftUI parity of `web/src/features/battery/pages/VampireDrainPage.tsx`
/// (route `/charging/vampire-drain`). Analyses phantom energy loss while the vehicle is
/// parked: the web page chrome (`PageContainer` title + subtitle + the header `VehicleSelect`
/// / `DataFreshnessAuto`), the four summary metric cards (Avg-Drain-Rate, Total-Phantom-Loss,
/// Worst-Session, Drain-Score), the drain-score `RadialGauge`, the Drain-Rate-Trend line
/// chart, the Daily-Drain-While-Parked grouped bar chart, the Drain-Sessions table, and the
/// Tips-to-Reduce-Vampire-Drain panel. Every data state the source produces is implemented
/// (loading / empty / error / success), including each section's own empty state.
///
/// Adaptive (ADR-002/006): the metric grid, the gauge/trend pair, and the table reflow for
/// macOS / iPad regular width vs. compact iPhone. All copy resolves from `Localizable.xcstrings`
/// with the web key names; data binds through the `@Observable` `VampireDrainPageModel` (no
/// networking in the view). All values are unit-system-independent percents / %·hr⁻¹ / kWh /
/// hours, formatted only at this render boundary via `VampireDrainFormat` (ADR-005).
public struct VampireDrainPage: View {
    @State private var model: VampireDrainPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: VampireDrainPageModel) {
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
        .navigationTitle(Text("vampire.title"))
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

    // MARK: - Header (web PageContainer title + subtitle + VehicleSelect / DataFreshnessAuto)

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
            TSPageTitle("Vampire Drain")
            Text("Analyze phantom energy loss while your vehicle is parked")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header actions: the `VehicleSelect` and the `DataFreshnessAuto` (a refresh
    /// affordance + in-flight indicator here).
    private var headerControls: some View {
        HStack(spacing: TSSpacing.md) {
            if !model.vehicles.isEmpty { vehiclePicker }
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
        .accessibilityLabel(Text("vampire.selectVehicle"))
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

    // MARK: - Top-level phase switch (web PageContainer phases)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            VampireDrainSkeleton()
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

    /// Web no-data state (`!data && !isLoading`) — a single page-level empty with the
    /// drain glyph + the "no sessions recorded" message.
    private var emptyView: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "No drain sessions recorded yet.",
                systemImage: "bolt.slash.fill"
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

    private func readyView(_ data: VampireDrainData) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            VampireDrainSummarySection(data: data)
            gaugeTrendPair(data)
            VampireDailyDrainSection(data: data)
            VampireDrainSessionsSection(data: data)
            VampireDrainTipsSection()
        }
    }

    /// Drain-score gauge beside the Drain-Rate-Trend line (web `grid-cols-3`: gauge 1 col,
    /// trend 2 cols); stacks on compact width.
    private func gaugeTrendPair(_ data: VampireDrainData) -> some View {
        let columns = isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.lg)]
            : [GridItem(.flexible(), spacing: TSSpacing.lg), GridItem(.flexible(), spacing: TSSpacing.lg)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            VampireDrainScoreGauge(data: data)
            VampireDrainTrendSection(data: data)
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        VampireDrainPage(model: VampireDrainPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty sections") {
        VampireDrainPage(
            model: VampireDrainPageModel(dataSource: EmptySectionsVampireDrainDataSource())
        )
        .teslaSyncTheme()
    }

    #Preview("No data") {
        VampireDrainPage(
            model: VampireDrainPageModel(dataSource: EmptyVampireDrainDataSource())
        )
        .teslaSyncTheme()
    }

    #Preview("Error") {
        VampireDrainPage(
            model: VampireDrainPageModel(dataSource: FailingVampireDrainDataSource())
        )
        .teslaSyncTheme()
    }
#endif
