import SwiftUI

/// Native SwiftUI parity of `web/src/features/driving/pages/DrivetrainHealthPage.tsx` (route
/// `/drivetrain-health`). The drivetrain thermal-intelligence surface: the page chrome (web
/// `PageContainer`: title + subtitle + the global `VehicleSelect` and the `RangePicker`), the
/// health-overview banner + status panel, the health/motor/drive gauge grid, the four temperature
/// gauges, the six temperature metric tiles, the thermal-load indicators, the live motor status, the
/// stator-temperature / torque / temperature-trend / power-output charts, the tiered health
/// recommendations, and the temperature + power detail cards. Every data state the page produces is
/// implemented (loading / empty / error / success).
///
/// Adaptive (ADR-002/006): the gauge grid, the metric tiles, the chart rows, and the detail cards reflow
/// for macOS / iPad regular width vs. compact iPhone. All copy resolves from `Localizable.xcstrings` with
/// the web key names via `DrivetrainHealthPageStrings`; data binds through the `@Observable`
/// `DrivetrainHealthPageModel` (no networking in the view). SI values convert to the user's unit
/// preference only here, at the render boundary, via the shared `Units` facade + `DrivetrainHealthPageFormat`
/// (ADR-005). The sensors, chart series, and recommendations are derived in the model, mirroring the web
/// `useMemo` blocks.
public struct DrivetrainHealthPage: View {
    @State private var model: DrivetrainHealthPageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: DrivetrainHealthPageModel = DrivetrainHealthPageModel()) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 1200, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text(DrivetrainHealthPageStrings.key("drivetrain.title")))
        .refreshable { await model.refresh() }
        .onChange(of: units) { _, newValue in model.setUnits(newValue) }
        .task {
            model.setUnits(units)
            guard model.viewState == .loading, model.health == nil else { return }
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

    // MARK: - Header (web PageContainer title + subtitle + VehicleSelect + RangePicker)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    controls
                    if model.isStale { stalenessChip }
                }
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    HStack(alignment: .top, spacing: TSSpacing.lg) {
                        titleBlock
                        Spacer(minLength: TSSpacing.md)
                        controls
                    }
                    if model.isStale { stalenessChip }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle(DrivetrainHealthPageStrings.key("drivetrain.title"))
            Text(DrivetrainHealthPageStrings.key("drivetrain.subtitle"))
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
        DrivetrainRangeControl(
            startDate: model.startDate,
            endDate: model.endDate,
            onChange: { model.setDateRange(start: $0, end: $1) }
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

    /// Live `> 2 min` staleness indicator (ADR-013).
    private var stalenessChip: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "clock.badge.exclamationmark").accessibilityHidden(true)
            Text(DrivetrainHealthPageStrings.key("common.staleData"))
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.statusWarning)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.statusWarning.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }

    // MARK: - Top-level phase switch (web PageContainer + `health ? … : EmptyState`)

    @ViewBuilder
    private var content: some View {
        switch model.viewState {
        case .loading:
            loadingView
        case .empty:
            emptyView
        case let .error(message):
            errorView(message)
        case .success:
            successView
        }
    }

    // MARK: - Loading (web PageContainer `loading`)

    private var loadingView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSGlassPanel {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        TSPanelTitle(DrivetrainHealthPageStrings.key("drivetrain.liveMotor"))
                        Text(DrivetrainHealthPageStrings.key("drivetrain.realTime"))
                            .font(Font.TS.body)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .redacted(reason: .placeholder) // parity:allow native shimmer for the loading state
        .accessibilityLabel(Text(DrivetrainHealthPageStrings.key("drivetrain.title")))
    }

    // MARK: - Empty (web `health ? … : EmptyState(noData)`)

    private var emptyView: some View {
        TSEmptyState(
            title: DrivetrainHealthPageStrings.key("drivetrain.title"),
            message: DrivetrainHealthPageStrings.key("drivetrain.noData"),
            systemImage: "gearshape.2.fill"
        )
        .frame(maxWidth: .infinity, minHeight: 280)
    }

    // MARK: - Error (retryable equivalent of a total health-load failure)

    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(
                title: DrivetrainHealthPageStrings.key("drivetrain.title"),
                message: LocalizedStringKey(message),
                onRetry: { Task { await model.refresh() } }
            )
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Success (web main body — every section, each with its own empty)

    private var successView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSFadeIn {
                DrivetrainHealthOverviewSection(
                    grade: model.overallHealth,
                    score: model.healthScore,
                    motorStatus: motorStatus
                )
            }
            TSFadeIn(delay: 0.10) {
                DrivetrainHealthGaugeGridSection(
                    grade: model.overallHealth, score: model.healthScore, motorStatus: motorStatus,
                    activeSensors: model.activeSensorCount, stats: model.stats, units: units, isCompact: isCompact
                )
            }
            TSFadeIn(delay: 0.15) {
                DrivetrainTemperatureGaugesSection(sensors: model.sensors, units: units)
            }
            TSFadeIn(delay: 0.18) {
                DrivetrainTemperatureMetricsSection(
                    sensors: model.sensors, grade: model.overallHealth, score: model.healthScore,
                    peakPowerKw: model.peakPowerKw, units: units
                )
            }
            TSFadeIn(delay: 0.20) {
                DrivetrainThermalLoadSection(
                    sensors: model.sensors, peakPowerKw: model.peakPowerKw, avgPowerKw: model.avgPowerKw,
                    stats: model.stats, units: units, isCompact: isCompact
                )
            }
            TSFadeIn(delay: 0.22) {
                DrivetrainLiveMotorSection(
                    snapshot: model.motorLatest, isolationResistance: model.isolationResistance,
                    units: units, isCompact: isCompact
                )
            }
            chartSections
            TSFadeIn(delay: 0.35) {
                DrivetrainRecommendationsSection(recommendations: model.recommendations)
            }
            TSFadeIn(delay: 0.40) {
                DrivetrainDetailCardsSection(
                    health: model.health, peakPowerKw: model.peakPowerKw, avgPowerKw: model.avgPowerKw,
                    minRegenKw: model.minRegenKw, stats: model.stats, units: units, isCompact: isCompact
                )
            }
        }
    }

    @ViewBuilder
    private var chartSections: some View {
        TSFadeIn(delay: 0.24) {
            DrivetrainStatorTempChartSection(points: model.motorChartPoints, units: units)
        }
        TSFadeIn(delay: 0.26) {
            DrivetrainTorqueChartSection(points: model.motorChartPoints)
        }
        TSFadeIn(delay: 0.28) {
            DrivetrainTemperatureTrendChartSection(points: model.temperatureTrendPoints, units: units)
        }
        TSFadeIn(delay: 0.30) {
            DrivetrainPowerOutputChartSection(points: model.driveChartPoints)
        }
    }

    private var motorStatus: String {
        model.health?.motorStatus ?? DrivetrainHealthPageFormat.emptyValue
    }
}
