import SwiftUI

/// Native SwiftUI parity of `web/src/features/driving/pages/TripPlannerPage.tsx` (route `/trip-planner`).
/// The deterministic baseline route planner: the page chrome (web `PageContainer`: title + subtitle +
/// the global `VehicleSelect`), the "Plan Your Trip" input form (origin/destination, current + min-arrival
/// SOC sliders, driving-speed select, Plan-Trip + Send-to-Car actions, the vehicle-battery readout), and
/// the plan result — the straight-line estimate disclaimer, the six summary stat cards (Distance /
/// Total-Time / Driving / Charging / Energy / Est-Cost), the not-feasible warning, and the weather-impact
/// panel. Every data state the `usePlanTrip` mutation produces is implemented (loading / error / success),
/// plus an idle prompt before the first plan; no region is ever left blank (ADR-011).
///
/// Adaptive (ADR-002/006): the address grid, the SOC/speed control grid, and the stat-card grid reflow
/// for macOS / iPad regular width vs. compact iPhone. All copy resolves from `Localizable.xcstrings` with
/// the web key names; data binds through the `@Observable` `TripPlannerPageModel` (no networking in the
/// view). SI values convert to the user's unit preference only here, at the render boundary, via the
/// shared `Units` facade + `TripPlannerFormat` (ADR-005). The rich address autocomplete, the route map,
/// the SOC chart, and the leg-by-leg list are sibling parity units; this page owns the form + summary.
public struct TripPlannerPage: View {
    @State private var model: TripPlannerPageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: TripPlannerPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                TripPlannerFormSection(model: model, isCompact: isCompact)
                resultsRegion
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("tripPlanner.title"))
        .onChange(of: units) { _, newValue in model.setUnits(newValue) }
        .task {
            model.setUnits(units)
            guard model.vehicles.isEmpty else { return }
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
                    if !model.vehicles.isEmpty { vehiclePicker }
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    if !model.vehicles.isEmpty { vehiclePicker.frame(maxWidth: 220) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("tripPlanner.title")
            Text("tripPlanner.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
            set: { newValue in model.selectVehicle(newValue) }
        )
    }

    // MARK: - Results region (web `usePlanTrip` mutation phases + the loaded result panels)

    @ViewBuilder
    private var resultsRegion: some View {
        switch model.planPhase {
        case .idle:
            idleView
        case .planning:
            loadingView
        case let .failed(message):
            errorView(message)
        case let .loaded(plan):
            TripPlannerResultSections(
                plan: plan,
                units: units,
                currencySymbol: model.currencySymbol,
                isCompact: isCompact
            )
        }
    }

    /// Idle prompt before the first plan (web shows nothing below the form; the native surface offers a
    /// HIG `ContentUnavailableView` so the region is never blank).
    private var idleView: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "tripPlanner.form.planTrip",
                message: "tripPlanner.subtitle",
                systemImage: "map"
            )
        }
    }

    /// Loading data state (web `planMutation.isPending`).
    private var loadingView: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.md) {
                ProgressView()
                TSCaption("tripPlanner.form.planning")
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text("tripPlanner.form.planning"))
        }
    }

    /// Error data state (web in-form danger `AlertBanner` for `planMutation.isError`, realized here as a
    /// retryable HIG error region per ADR-006).
    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(
                message: "tripPlanner.form.error",
                onRetry: { Task { await model.retry() } }
            )
            .accessibilityValue(Text(verbatim: message))
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }
}

#if DEBUG
    #Preview("Idle") {
        NavigationStack {
            TripPlannerPage(model: TripPlannerPageModel())
        }
        .teslaSyncTheme()
    }

    #Preview("Planned") {
        NavigationStack {
            TripPlannerPage(
                model: TripPlannerPageModel(
                    initialPhase: .loaded(SampleTripPlannerDataSource.plan(for: TripPlannerPreviewData.request))
                )
            )
        }
        .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationStack {
            TripPlannerPage(
                model: TripPlannerPageModel(
                    dataSource: FailingTripPlannerDataSource(),
                    initialPhase: .failed("Preview failure")
                )
            )
        }
        .teslaSyncTheme()
    }

    /// Shared preview request seed for the loaded-state preview.
    enum TripPlannerPreviewData {
        static let request = TripPlanRequest(
            vehicleID: 1,
            origin: TripLocation(lat: 0, lng: 0, name: "San Francisco, CA"),
            destination: TripLocation(lat: 0, lng: 0, name: "Los Angeles, CA"),
            currentSoc: 80,
            chargeLimitSoc: 90,
            minArrivalSoc: 20,
            speedFactor: 1.0,
            includeWeather: true,
            preferSuperchargers: true
        )
    }
#endif
