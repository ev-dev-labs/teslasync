import SwiftUI

/// Native SwiftUI parity of `web/src/features/driving/pages/RouteEfficiencyPage.tsx` (route
/// `/route-efficiency`). Compares efficiency across the most-driven routes: the page chrome (web
/// `PageContainer`: title + subtitle + the global `VehicleSelect` and the `RangePicker`), the
/// four-up summary panel, the best/avg/worst route-comparison bar chart, the per-route cards, and
/// the route-metrics bars. Every data state the source produces is implemented (loading / empty /
/// error / success).
///
/// Adaptive (ADR-002/006): the header, the summary grid, the route-card grid, and the metrics grid
/// reflow for macOS / iPad regular width vs. compact iPhone. All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `RouteEfficiencyPageModel` (no networking in the view). Consumption (`Wh/km`) and distance convert
/// to the user's unit preference only here, at the render boundary, via the shared `Units` facade
/// (ADR-005).
public struct RouteEfficiencyPage: View {
    @State private var model: RouteEfficiencyPageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: RouteEfficiencyPageModel) {
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
        .navigationTitle(Text("routeEfficiency.title"))
        .refreshable { await model.refresh() }
        .task {
            guard model.loadState == .loading, model.routes.isEmpty else { return }
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
            TSPageTitle("routeEfficiency.title")
            Text("routeEfficiency.subtitle")
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
        RouteEfficiencyRangeControl(
            startDate: model.startDate,
            endDate: model.endDate,
            onChange: { start, end in Task { await model.setDateRange(start: start, end: end) } }
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
            RouteEfficiencySkeleton()
        case let .error(message):
            errorView(message)
        case .empty, .ready:
            // Both render every panel; each panel surfaces its own empty state (web keeps the summary
            // + chart + metrics chrome visible and only the inner regions go empty), never a blank page.
            sections
        }
    }

    /// Web main `PageContainer` body — the four parity panels, always present.
    private var sections: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            RouteEfficiencySummarySection(model: model, units: units)
            RouteEfficiencyComparisonSection(model: model, units: units)
            RouteEfficiencyRoutesSection(model: model, units: units, isCompact: isCompact)
            RouteEfficiencyMetricsSection(model: model, units: units, isCompact: isCompact)
        }
    }

    /// Web `PageContainer error` region — message plus a Retry affordance.
    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(
                title: "routeEfficiency.title",
                message: LocalizedStringKey(message),
                onRetry: { Task { await model.refresh() } }
            )
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }
}

#if DEBUG
    #Preview("Loaded") {
        RouteEfficiencyPage(model: RouteEfficiencyPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        RouteEfficiencyPage(model: RouteEfficiencyPageModel(dataSource: EmptyRouteEfficiencyDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        RouteEfficiencyPage(model: RouteEfficiencyPageModel(dataSource: FailingRouteEfficiencyDataSource()))
            .teslaSyncTheme()
    }
#endif
