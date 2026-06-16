import SwiftUI

/// Native SwiftUI parity of `web/src/features/battery/pages/ProjectedRangePage.tsx` (route
/// `/analytics/range`). Personalised range estimates from driving patterns, weather, and
/// conditions: the web page chrome (`PageContainer` title + subtitle + the header `VehicleSelect`),
/// the five hero metric cards, the efficiency `RadialGauge` + the rated-vs-projected `AreaChart`,
/// the scenario cards, the personal efficiency matrix, the what-if calculator, the range-factor
/// cards, and the tips list. Every data state the source produces is implemented (loading / empty /
/// error / success), including each section's own empty state.
///
/// Adaptive (ADR-002/006): the hero grid, the gauge/curve pair, and the section grids reflow for
/// macOS / iPad regular width vs. compact iPhone. All copy resolves from `Localizable.xcstrings`
/// with the web key names; data binds through the `@Observable` `ProjectedRangePageModel` (no
/// networking in the view). SI metres / watt-hours / m·s⁻¹ / Celsius convert to the user's units
/// only here, at the render boundary, via the shared `Units` facade (ADR-005).
public struct ProjectedRangePage: View {
    @State private var model: ProjectedRangePageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: ProjectedRangePageModel) {
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
        .navigationTitle(Text("range.title"))
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.projection == nil else { return }
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

    // MARK: - Header (web PageContainer title + subtitle + VehicleSelect)

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
            TSPageTitle("range.title")
            Text("range.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header `VehicleSelect` (shown only when there is at least one vehicle).
    private var controls: some View {
        Group {
            if !model.vehicles.isEmpty {
                TSSelect(
                    selection: vehicleBinding,
                    options: model.vehicles.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) }
                )
                .frame(maxWidth: 220)
                .accessibilityLabel(Text("route.vehicles"))
            }
        }
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID ?? 0 },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    // MARK: - Phase switch (web PageContainer loading / error / body)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            TSPageLoader()
                .frame(maxWidth: .infinity, minHeight: 320)
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .ready:
            readyView
        }
    }

    /// Web `!data` — the honest no-projection state replacing the body.
    private var emptyState: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "range.noData",
                systemImage: "gauge.with.dots.needle.bottom.50percent"
            )
            .frame(maxWidth: .infinity, minHeight: 240)
        }
    }

    /// Web `error={...}` — the projection failure with a retry.
    private func errorState(_ message: String) -> some View {
        TSGlassPanel {
            TSQueryError(message: LocalizedStringKey(message), onRetry: { Task { await model.refresh() } })
                .frame(maxWidth: .infinity, minHeight: 240)
        }
    }

    // MARK: - Ready (web main PageContainer body)

    @ViewBuilder
    private var readyView: some View {
        if let projection = model.projection {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                TSFadeIn { ProjectedRangeHeroSection(projection: projection, units: units) }
                TSFadeIn(delay: 0.05) { gaugeAndCurveRow(projection) }
                TSFadeIn(delay: 0.1) {
                    ProjectedRangeScenariosSection(projection: projection, units: units)
                }
                TSFadeIn(delay: 0.15) { ProjectedRangeMatrixSection(projection: projection) }
                TSFadeIn(delay: 0.2) { ProjectedRangeWhatIfSection(model: model, units: units) }
                TSFadeIn(delay: 0.25) { ProjectedRangeFactorsSection(projection: projection) }
                TSFadeIn(delay: 0.3) { ProjectedRangeTipsSection(tips: model.tips) }
            }
        }
    }

    /// The gauge + projection-curve row (web `md:grid-cols-3` with a 1:2 split): side-by-side on
    /// regular width, stacked on compact.
    @ViewBuilder
    private func gaugeAndCurveRow(_ projection: ProjectedRangeSnapshot) -> some View {
        let gauge = ProjectedRangeGaugeSection(projection: projection, colorIndex: model.gaugeColorIndex)
        let curve = ProjectedRangeCurveSection(projection: projection, units: units)
        if isCompact {
            VStack(spacing: TSSpacing.lg) {
                gauge
                curve
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                gauge.frame(maxWidth: .infinity, alignment: .top)
                curve.frame(maxWidth: .infinity, alignment: .top)
            }
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        ProjectedRangePage(model: ProjectedRangePageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty sections") {
        ProjectedRangePage(model: ProjectedRangePageModel(dataSource: EmptySectionsProjectedRangeDataSource()))
            .teslaSyncTheme()
    }

    #Preview("No data") {
        ProjectedRangePage(model: ProjectedRangePageModel(dataSource: EmptyProjectedRangeDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        ProjectedRangePage(model: ProjectedRangePageModel(dataSource: FailingProjectedRangeDataSource()))
            .teslaSyncTheme()
    }
#endif
