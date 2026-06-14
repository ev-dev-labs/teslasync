import SwiftUI

/// Native SwiftUI parity of `web/src/features/analytics/pages/TrueCostPage.tsx`
/// (route `/analytics/tco`). The True Cost of Ownership surface: the web page chrome
/// (web `PageContainer`: title + subtitle + the vehicle `Select` + the loading / empty / error
/// states), the opt-in AI narration slot at its web position, the four hero cost cards, the
/// cumulative-savings area chart, the side-by-side cost-per-km + monthly EV-vs-gas bar charts, and
/// the savings-breakdown panel. Every data state the source produces is implemented
/// (loading / empty / error / success), including each chart's own monthly empty state.
///
/// Adaptive (ADR-002/006): the hero grid, the two-up chart row, and the breakdown grid reflow for
/// macOS / iPad regular width vs. compact iPhone. All copy resolves from `Localizable.xcstrings`
/// with the web key names; data binds through the `@Observable` `TrueCostPageModel` (no networking
/// in the view). SI energy/distance convert to the user's unit preference only here, at the render
/// boundary, via the shared `Units` facade (ADR-005); monetary values are currency amounts.
public struct TrueCostPage: View {
    @State private var model: TrueCostPageModel
    private let narration: AnyView
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// - Parameters:
    ///   - model: the bound state holder (ADR-004).
    ///   - narration: the opt-in AI narration panel mounted at the web `AITCONarration` position.
    ///     The baseline (web `ai_mode === 'off'`) injects nothing, so the deterministic envelope is
    ///     the canonical surface; production wires the real panel here (ADR-015 §I3).
    public init(model: TrueCostPageModel, narration: AnyView = AnyView(EmptyView())) {
        _model = State(initialValue: model)
        self.narration = narration
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                // Web `<AITCONarration />` — rendered OUTSIDE the `tco ?` gate so it stays visible
                // across every phase; the baseline injects an empty view.
                narration
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.breakdown == nil else { return }
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
            TSPageTitle("tco.title")
            Text("tco.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web `<VehicleSelect />` (shown only when there are vehicles).
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
            TrueCostSkeleton()
        case .empty:
            TrueCostNoDataPanel()
        case .error:
            errorView
        case .ready:
            readyView
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

    // MARK: - Ready (web main `tco ?` body)

    @ViewBuilder
    private var readyView: some View {
        if let breakdown = model.breakdown {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                TrueCostHeroCardsSection(
                    breakdown: breakdown,
                    gasUnit: model.gasUnit,
                    currencySymbol: model.currencySymbol,
                    units: units
                )
                TrueCostCumulativeSavingsSection(monthly: model.monthlyBreakdown)
                costAndMonthly(breakdown)
                TrueCostSavingsBreakdownSection(
                    breakdown: breakdown,
                    currencySymbol: model.currencySymbol,
                    units: units
                )
            }
        }
    }

    /// Side-by-side cost-per-km + monthly EV-vs-gas charts (web `grid-cols-1 lg:grid-cols-2`).
    @ViewBuilder
    private func costAndMonthly(_ breakdown: CostBreakdown) -> some View {
        let costPerKm = TrueCostCostPerKmSection(breakdown: breakdown, currencySymbol: model.currencySymbol)
        let monthly = TrueCostMonthlyComparisonSection(monthly: model.monthlyBreakdown)
        if isCompact {
            VStack(spacing: TSSpacing.lg) {
                costPerKm
                monthly
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                costPerKm.frame(maxWidth: .infinity, alignment: .top)
                monthly.frame(maxWidth: .infinity, alignment: .top)
            }
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        TrueCostPage(model: TrueCostPageModel())
            .teslaSyncTheme()
    }

    #Preview("No monthly data") {
        TrueCostPage(model: TrueCostPageModel(dataSource: NoMonthlyTrueCostDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        TrueCostPage(model: TrueCostPageModel(dataSource: EmptyTrueCostDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        TrueCostPage(model: TrueCostPageModel(dataSource: FailingTrueCostDataSource()))
            .teslaSyncTheme()
    }
#endif
