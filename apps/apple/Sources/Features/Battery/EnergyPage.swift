import SwiftUI

/// Native SwiftUI parity of `web/src/features/battery/pages/EnergyPage.tsx` (route `/energy`).
/// Deep cost analytics, efficiency trends, savings projections, and consumption patterns: the
/// web page chrome (`PageContainer` title + subtitle + the header `VehicleSelect`), the four
/// hero gauges (or the honest empty hero), the six-chip quick-metric strip, the lifetime panel,
/// the two cost-vs-gas comparison cards, the four charts (energy-&-cost composed, efficiency
/// area, time-of-day bars, charger-breakdown donut), and the recent-sessions table. Every data
/// state the sources produce is implemented (loading / empty / error / success), including each
/// section's own empty state.
///
/// Adaptive (ADR-002/006): the gauge grid, the metric strip, the lifetime/cost grids, and the
/// chart rows reflow for macOS / iPad regular width vs. compact iPhone. All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `EnergyPageModel` (no networking in the view). SI watt-hours and metres convert to the
/// user's units only here, at the render boundary, via the shared `Units` facade (ADR-005).
public struct EnergyPage: View {
    @State private var model: EnergyPageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: EnergyPageModel) {
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
        .navigationTitle(Text("energy.title"))
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.stats == nil, model.sessions.isEmpty else { return }
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
                    if !model.vehicles.isEmpty { vehiclePicker.frame(maxWidth: 260) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("energy.pageTitle")
            Text("energy.pageSubtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header `VehicleSelect` (shown only when there is at least one vehicle).
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
            EnergyPageSkeleton()
        case .ready:
            readyView
        }
    }

    // MARK: - Ready (web main PageContainer body)

    private var readyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            if model.statsErrorMessage != nil { errorBanner }
            TSFadeIn { EnergyHeroSection(model: model, units: units) }
            EnergyMetricStripSection(model: model, units: units)
            TSFadeIn(delay: 0.05) { EnergyLifetimeSection(model: model, units: units) }
            EnergyCostComparisonSection(model: model)
            chartsRow(EnergyCostDailySection(rows: model.dailyBreakdown, units: units),
                      EnergyEfficiencyTrendSection(rows: model.dailyBreakdown, units: units))
            chartsRow(EnergyTimeOfDaySection(buckets: model.timeOfDayBuckets, units: units),
                      EnergyChargerBreakdownSection(rows: model.chargerBreakdown, units: units))
            TSFadeIn(delay: 0.1) { EnergySessionsSection(sessions: model.recentSessions, units: units) }
        }
    }

    /// Web `{statsError && <QueryError onRetry={refetch} />}` — a non-blocking banner above the
    /// body that offers a retry while the rest of the page still renders.
    private var errorBanner: some View {
        TSGlassPanel {
            TSQueryError(onRetry: { Task { await model.refresh() } })
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    /// A two-column chart row on regular width that stacks on compact (web `lg:grid-cols-2`).
    @ViewBuilder
    private func chartsRow(_ leading: some View, _ trailing: some View) -> some View {
        if isCompact {
            VStack(spacing: TSSpacing.lg) {
                leading
                trailing
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                leading.frame(maxWidth: .infinity, alignment: .top)
                trailing.frame(maxWidth: .infinity, alignment: .top)
            }
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        EnergyPage(model: EnergyPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty sections") {
        EnergyPage(model: EnergyPageModel(dataSource: EmptySectionsEnergyDataSource()))
            .teslaSyncTheme()
    }

    #Preview("No data") {
        EnergyPage(model: EnergyPageModel(dataSource: EmptyEnergyDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error banner") {
        EnergyPage(model: EnergyPageModel(dataSource: FailingEnergyDataSource()))
            .teslaSyncTheme()
    }
#endif
