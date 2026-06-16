import SwiftUI

/// Native SwiftUI parity of `web/src/features/maps/pages/LocationsPage.tsx` (route `/locations`).
/// Visited places ranked by frequency: the web page chrome (`PageContainer` title + subtitle + the
/// vehicle `Select`), the six summary `MetricCard`s (unique places / cities, total visits / time,
/// most visited, average visit), the Top-Locations-by-Visits and Top-Locations-by-Time bar charts,
/// and the searchable, paginated All-Locations list (each row its own panel, with the AI auto-name
/// affordance for unnamed places). Every data state the locations query produces is implemented
/// (loading / empty / error / success), including each panel's own empty state.
///
/// Adaptive (ADR-002/006): the summary grid + chart panels reflow for macOS / iPad regular width
/// vs. compact iPhone. All copy resolves from `Localizable.xcstrings` with the web key names; data
/// binds through the `@Observable` `LocationsPageModel` (no networking in the view). SI seconds
/// convert to the user's duration unit only here, at the render boundary, via the shared `Units`
/// facade (ADR-005).
public struct LocationsPage: View {
    @State private var model: LocationsPageModel
    @Environment(\.tsUnits) private var units

    /// Web empty-state `actionTo={{ to: '/drives' }}` — navigates to the Driving surface.
    private let onViewDrives: () -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: LocationsPageModel, onViewDrives: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onViewDrives = onViewDrives
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
        .navigationTitle(Text("Locations"))
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.rawLocations.isEmpty else { return }
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
            TSPageTitle("Visited Locations")
            Text("Places you've been \u{2014} ranked by frequency")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header `Select` (shown only when `vehicles.length > 0`).
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
            LocationsSkeleton()
        case .error:
            errorView
        case .ready:
            readyView
        }
    }

    /// Web primary-source error — message plus a Retry affordance (web `PageContainer` error region).
    private var errorView: some View {
        TSGlassPanel {
            TSErrorDisplay(
                title: "error.loadFailed",
                onRetry: { Task { await model.refresh() } }
            )
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web main PageContainer body)

    private var readyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LocationsSummarySection(model: model, units: units)
            LocationsVisitsChartSection(bars: model.visitsChartData)
            LocationsTimeChartSection(bars: model.timeChartData)
            LocationsListSection(model: model, units: units, onViewDrives: onViewDrives)
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        LocationsPage(model: LocationsPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        LocationsPage(model: LocationsPageModel(dataSource: EmptyLocationsDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        LocationsPage(model: LocationsPageModel(dataSource: FailingLocationsDataSource()))
            .teslaSyncTheme()
    }
#endif
