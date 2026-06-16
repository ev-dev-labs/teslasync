import SwiftUI

/// Native SwiftUI parity of `web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx`
/// (route `/analytics/anomalies`, aliased from `/anomaly-detection`). Automatic health monitoring
/// and signal anomaly detection: the web page chrome (`PageContainer` title + subtitle + the
/// vehicle `Select`), the four summary stat cards (Signals-Monitored, Anomalies-7d, Anomalies-24h,
/// Health-Categories), the System-Health grid, the Anomaly-Timeline list, and the
/// Most-Frequent-Anomalies bar chart. Every data state the source produces is implemented
/// (loading / empty / error / success), including each section's own empty state (web per-`GlassPanel`
/// `EmptyState`).
///
/// Adaptive (ADR-002/006): the stat grid, the health grid, and the header reflow for macOS / iPad
/// regular width vs. compact iPhone. All copy resolves from `Localizable.xcstrings` with the web
/// key names; data binds through the `@Observable` `AnomalyDashboardPageModel` (no networking in
/// the view). The anomaly numbers are raw signal-space values (web `fmtNumber`, no unit
/// preference), so nothing on this page needs SI conversion.
///
/// The opt-in AI anomaly-explanation / learned-baseline panels the web page mounts are separate,
/// AI-gated parity units (their own `shared-surfaces` surfaces) and are intentionally out of this
/// page's manifest scope — the deterministic detector output below is the canonical baseline.
public struct AnomalyDashboardPage: View {
    @State private var model: AnomalyDashboardPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: AnomalyDashboardPageModel) {
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
            guard model.phase == .loading, model.data == nil else { return }
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
            TSPageTitle("anomaly.title")
            Text("anomaly.subtitle")
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
            AnomalyDashboardSkeleton()
        case .empty:
            emptyView
        case .error:
            errorView
        case .ready:
            readyView
        }
    }

    /// Web no-data EmptyState (no recovery action — transient source gap until a vehicle resolves).
    private var emptyView: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "anomaly.noData",
                message: "anomaly.noDataMsg",
                systemImage: "shield"
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

    @ViewBuilder
    private var readyView: some View {
        if let data = model.data {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                AnomalyDashboardSummarySection(data: data, isCompact: isCompact)
                AnomalyDashboardHealthSection(categories: data.healthCategories)
                AnomalyDashboardTimelineSection(anomalies: data.anomalies)
                AnomalyDashboardFrequencySection(items: data.signalFrequency)
            }
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        AnomalyDashboardPage(model: AnomalyDashboardPageModel())
            .teslaSyncTheme()
    }

    #Preview("Quiet") {
        AnomalyDashboardPage(model: AnomalyDashboardPageModel(dataSource: QuietAnomalyDashboardDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        AnomalyDashboardPage(model: AnomalyDashboardPageModel(dataSource: EmptyAnomalyDashboardDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        AnomalyDashboardPage(model: AnomalyDashboardPageModel(dataSource: FailingAnomalyDashboardDataSource()))
            .teslaSyncTheme()
    }
#endif
