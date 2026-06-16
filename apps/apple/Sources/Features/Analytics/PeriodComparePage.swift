import SwiftUI

/// Native SwiftUI parity of `web/src/features/analytics/pages/PeriodComparePage.tsx`
/// (route `/period-compare`). Compares one vehicle's key metrics across two time periods: the web
/// page chrome (web `PageContainer`: title + subtitle), the fleet-compare disambiguation
/// `AlertBanner`, the vehicle + Period A/B selectors (GlassPanel1), the six metric cards
/// (MetricCard2), the side-by-side bar chart (GlassPanel3), the comparison `DataTable`
/// (GlassPanel4), and the insights panel (GlassPanel5). Every data state the source produces is
/// implemented (loading / empty / error / success): `loading` and `error` replace the body (web
/// `PageContainer` props), while `empty` and `ready` keep the banner + selectors visible (web
/// renders them above the `!a || !b` switch).
///
/// Adaptive (ADR-002/006): the selectors row and metric-card grid reflow for macOS / iPad regular
/// width vs. compact iPhone. All copy resolves from `Localizable.xcstrings` with the web key
/// names; data binds through the `@Observable` `PeriodComparePageModel` (no networking in the
/// view). SI values convert to the user's unit preference only here, at the render boundary, via
/// the shared `Units` facade (ADR-005).
public struct PeriodComparePage: View {
    @State private var model: PeriodComparePageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private let onNavigate: (AppRoute) -> Void

    public init(model: PeriodComparePageModel, onNavigate: @escaping (AppRoute) -> Void = { _ in }) {
        _model = State(initialValue: model)
        self.onNavigate = onNavigate
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
            guard model.viewState == .loading else { return }
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

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("compare.title")
            Text("compare.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Top-level state switch (web PageContainer phases + the `!a || !b` empty branch)

    @ViewBuilder
    private var content: some View {
        switch model.viewState {
        case .loading:
            loadingView
        case let .error(message):
            errorView(message)
        case .empty:
            chrome { emptyBody }
        case .ready:
            chrome { readyBody }
        }
    }

    /// Web PageContainer `loading` — a centered spinner that replaces the body.
    private var loadingView: some View {
        VStack(spacing: TSSpacing.md) {
            ProgressView()
            TSCaption("compare.subtitle")
        }
        .frame(maxWidth: .infinity, minHeight: 240)
        .accessibilityLabel(Text("compare.title"))
    }

    /// Web PageContainer `error` — a rose/HIG error region with a Retry affordance.
    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(
                message: LocalizedStringKey(message),
                onRetry: { Task { await model.refresh() } }
            )
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    /// Shared chrome for the empty + ready states (web selectors render above the `!a || !b`
    /// switch): the disambiguation banner and the selectors panel, then the state-specific body.
    private func chrome(@ViewBuilder _ body: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            if model.bannerVisible {
                banner
            }
            selectorsPanel
            body()
        }
    }

    /// Web `!a || !b` EmptyState — prompts the user to pick a vehicle and two periods.
    private var emptyBody: some View {
        TSGlassPanel {
            TSEmptyState(title: "compare.empty", systemImage: "calendar")
                .frame(maxWidth: .infinity)
        }
    }

    /// Web populated body — metric cards, the comparison chart, the table, and the insights.
    private var readyBody: some View {
        let values = model.metricValues(units)
        return VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            PeriodCompareMetricCards(values: values, isCompact: isCompact)
            PeriodCompareChartSection(values: values)
            PeriodCompareComparisonTable(values: values)
            PeriodCompareInsightsPanel(lines: model.insights)
        }
    }

    // MARK: - Banner (web `AlertBanner` → Fleet comparison)

    private var banner: some View {
        TSAlertBanner(
            tone: .info,
            systemImage: "arrow.left.arrow.right",
            title: "compare.banner.toFleetPrefix",
            onDismiss: { model.dismissBanner() },
            action: {
                TSButton("compare.banner.toFleetCta", variant: .secondary, size: .small) {
                    onNavigate(.fleetCompare)
                }
            }
        )
    }

    // MARK: - Selectors (GlassPanel1 — web `Select` × 3)

    private var selectorsPanel: some View {
        TSGlassPanel {
            Group {
                if isCompact {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        vehicleSelect
                        periodASelect
                        periodBSelect
                    }
                } else {
                    HStack(alignment: .bottom, spacing: TSSpacing.lg) {
                        vehicleSelect.frame(maxWidth: 240)
                        periodASelect.frame(maxWidth: 200)
                        periodBSelect.frame(maxWidth: 200)
                        Spacer(minLength: 0)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var vehicleSelect: some View {
        TSSelect(
            selection: vehicleBinding,
            options: model.vehicles.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) },
            label: "compare.vehicle"
        )
    }

    private var periodASelect: some View {
        TSSelect(
            selection: periodABinding,
            options: PeriodCompareWindow.allCases.map { TSSelectOption($0, $0.labelKey) },
            label: "compare.periodA"
        )
    }

    private var periodBSelect: some View {
        TSSelect(
            selection: periodBBinding,
            options: PeriodCompareWindow.allCases.map { TSSelectOption($0, $0.labelKey) },
            label: "compare.periodB"
        )
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.vehicleId ?? 0 },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    private var periodABinding: Binding<PeriodCompareWindow> {
        Binding(
            get: { model.periodA },
            set: { newValue in Task { await model.selectPeriodA(newValue) } }
        )
    }

    private var periodBBinding: Binding<PeriodCompareWindow> {
        Binding(
            get: { model.periodB },
            set: { newValue in Task { await model.selectPeriodB(newValue) } }
        )
    }
}

#if DEBUG
    #Preview("Loaded") {
        PeriodComparePage(model: PeriodComparePageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        PeriodComparePage(model: PeriodComparePageModel(dataSource: EmptyPeriodCompareDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        PeriodComparePage(model: PeriodComparePageModel(dataSource: FailingPeriodCompareDataSource()))
            .teslaSyncTheme()
    }
#endif
