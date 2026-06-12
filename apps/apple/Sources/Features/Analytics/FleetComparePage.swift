import SwiftUI

/// Native SwiftUI parity of `web/src/features/analytics/pages/FleetComparePage.tsx`
/// (route `/vehicle-comparison`). Compares two vehicles side by side: the web page chrome
/// (web `PageContainer`: title + subtitle), the period-compare disambiguation `AlertBanner`,
/// the A/B vehicle selectors, the two side-by-side live status cards (web `VehicleStatusCard`),
/// the overlaid monthly-distance line chart + drives-per-month bar chart, the lifetime stats
/// comparison table (web `DataTable` with winner highlighting), and the four key-highlight
/// stat cards. Every data state the source produces is implemented (loading / empty / error /
/// success), including the single-vehicle empty state (web `vehicleList.length < 2`).
///
/// Adaptive (ADR-002/006): the selectors, status-card grid, and highlight grid reflow for
/// macOS / iPad regular width vs. compact iPhone. All copy resolves from `Localizable.xcstrings`
/// with the web key names; data binds through the `@Observable` `FleetComparePageModel` (no
/// networking in the view). SI values convert to the user's unit preference only here, at the
/// render boundary, via the shared `Units` facade (ADR-005).
public struct FleetComparePage: View {
    @State private var model: FleetComparePageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private let onNavigate: (AppRoute) -> Void

    public init(model: FleetComparePageModel, onNavigate: @escaping (AppRoute) -> Void = { _ in }) {
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
            guard model.listState == .loading else { return }
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
            TSPageTitle("comparison.title")
            Text("comparison.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Top-level state switch (web PageContainer phases + single-vehicle empty)

    @ViewBuilder
    private var content: some View {
        switch model.listState {
        case .loading:
            loadingView
        case .single:
            singleVehicleEmpty
        case .error:
            errorView
        case .ready:
            readyView
        }
    }

    private var loadingView: some View {
        VStack(spacing: TSSpacing.md) {
            ProgressView()
            TSCaption("comparison.subtitle")
        }
        .frame(maxWidth: .infinity, minHeight: 240)
        .accessibilityLabel(Text("comparison.title"))
    }

    /// Web rose/HIG error region — message plus a Retry affordance.
    private var errorView: some View {
        TSGlassPanel {
            TSErrorDisplay(onRetry: { Task { await model.refresh() } })
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    /// GlassPanel4 — web single-vehicle EmptyState with a "Manage vehicles" CTA.
    private var singleVehicleEmpty: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "fleetCompare.singleVehicle.title",
                message: "fleetCompare.singleVehicle.body",
                systemImage: "car"
            ) {
                TSButton("fleetCompare.singleVehicle.cta", variant: .secondary, size: .small) {
                    onNavigate(.vehicles)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Ready (web main PageContainer body)

    private var readyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            if model.bannerVisible {
                banner
            }
            selectorsPanel
            statusSection
            FleetCompareMonthlyDistanceSection(
                points: model.monthlyChartData,
                nameA: nameA,
                nameB: nameB,
                units: units
            )
            FleetCompareDrivesSection(
                points: model.monthlyChartData,
                nameA: nameA,
                nameB: nameB
            )
            FleetCompareComparisonTable(
                rows: model.comparisonRows,
                nameA: nameA,
                nameB: nameB,
                isLoading: model.statsLoading,
                units: units
            )
            highlightsSection
        }
    }

    /// Disambiguation banner (web `AlertBanner` → Period comparison).
    private var banner: some View {
        TSAlertBanner(
            tone: .info,
            systemImage: "calendar",
            title: "comparison.banner.toPeriodPrefix",
            onDismiss: { model.dismissBanner() },
            action: {
                TSButton("comparison.banner.toPeriodCta", variant: .secondary, size: .small) {
                    onNavigate(.analytics)
                }
            }
        )
    }

    /// GlassPanel5 — the A/B vehicle selectors with a swap glyph (web `Select` × 2).
    private var selectorsPanel: some View {
        TSGlassPanel {
            Group {
                if isCompact {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        selectorA
                        swapIcon
                        selectorB
                    }
                } else {
                    HStack(alignment: .bottom, spacing: TSSpacing.lg) {
                        selectorA.frame(maxWidth: 260)
                        swapIcon.padding(.bottom, TSSpacing.sm)
                        selectorB.frame(maxWidth: 260)
                        Spacer(minLength: 0)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var selectorA: some View {
        TSSelect(
            selection: bindingA,
            options: model.optionsA.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) },
            label: "comparison.vehicleA"
        )
    }

    private var selectorB: some View {
        TSSelect(
            selection: bindingB,
            options: model.optionsB.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) },
            label: "comparison.vehicleB"
        )
    }

    private var swapIcon: some View {
        Image(systemName: "arrow.left.arrow.right")
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
    }

    private var bindingA: Binding<Int64> {
        Binding(
            get: { model.vehicleIdA ?? 0 },
            set: { newValue in Task { await model.selectA(newValue) } }
        )
    }

    private var bindingB: Binding<Int64> {
        Binding(
            get: { model.vehicleIdB ?? 0 },
            set: { newValue in Task { await model.selectB(newValue) } }
        )
    }

    /// Side-by-side status cards (web "Current Status").
    private var statusSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            sectionHeader("comparison.currentStatus")
            LazyVGrid(columns: pairColumns, spacing: TSSpacing.md) {
                FleetCompareStatusCard(
                    vehicle: model.vehicleA,
                    state: model.sideA.state,
                    isLoading: model.sideA.isLoadingState,
                    units: units
                )
                FleetCompareStatusCard(
                    vehicle: model.vehicleB,
                    state: model.sideB.state,
                    isLoading: model.sideB.isLoadingState,
                    units: units
                )
            }
        }
    }

    /// Key highlights (web "Key Highlights").
    private var highlightsSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            sectionHeader("comparison.highlights")
            FleetCompareHighlights(
                sideA: model.sideA,
                sideB: model.sideB,
                units: units,
                isStateLoading: model.sideA.isLoadingState || model.sideB.isLoadingState,
                isStatsLoading: model.statsLoading
            )
        }
    }

    private var pairColumns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)]
    }

    private func sectionHeader(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityAddTraits(.isHeader)
    }

    /// Web `vehicleA?.display_name ?? t('comparison.vehicleA')`.
    private var nameA: String {
        model.vehicleA?.name ?? String(localized: "comparison.vehicleA", defaultValue: "Vehicle A")
    }

    private var nameB: String {
        model.vehicleB?.name ?? String(localized: "comparison.vehicleB", defaultValue: "Vehicle B")
    }
}

#if DEBUG
    #Preview("Loaded") {
        FleetComparePage(model: FleetComparePageModel())
            .teslaSyncTheme()
    }

    #Preview("Single vehicle") {
        FleetComparePage(model: FleetComparePageModel(dataSource: SingleVehicleFleetCompareDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        FleetComparePage(model: FleetComparePageModel(dataSource: FailingFleetCompareDataSource()))
            .teslaSyncTheme()
    }
#endif
