import SwiftUI

/// Native SwiftUI parity of `web/src/features/battery/pages/BatteryHealthPage.tsx`
/// (route `/battery`). Degradation tracking, prediction, charging habits, and longevity
/// insights: the web page chrome (`PageContainer` title + subtitle + the header
/// `VehicleSelect` + the live indicator), the health-score hero (four gauges + band badge +
/// years-to-80 %), the three metric bars, the seven summary metric cards, the thermal-
/// monitoring panel, the smart-insights grid, the capacity-trend projection chart, the
/// estimated-range area chart, the charge-level distribution with its habit tiles, the
/// capacity-&-range new-vs-now panel, the AC/DC energy breakdown beside the charging-
/// statistics panel, the quick-links grid, and the recommendations panel. Every data state
/// the source produces is implemented (loading / empty / error / success), including each
/// section's own empty state.
///
/// Adaptive (ADR-002/006): the metric grids, the hero, the breakdown row, and the new-vs-now
/// tiles reflow for macOS / iPad regular width vs. compact iPhone. All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `BatteryHealthPageModel` (no networking in the view). SI kilometres, watt-hours, and
/// Celsius convert to the user's units only here, at the render boundary, via the shared
/// `Units` facade (ADR-005).
public struct BatteryHealthPage: View {
    @State private var model: BatteryHealthPageModel
    @Environment(\.tsUnits) private var units
    private let onNavigate: (AppRoute) -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: BatteryHealthPageModel, onNavigate: @escaping (AppRoute) -> Void = { _ in }) {
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
        .navigationTitle(Text("battery.title"))
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.analytics == nil else { return }
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

    // MARK: - Header (web PageContainer title + subtitle + VehicleSelect + LiveIndicator)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    headerControls
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    headerControls
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("battery.title")
            Text("battery.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var headerControls: some View {
        HStack(spacing: TSSpacing.md) {
            if !model.vehicles.isEmpty { vehiclePicker.frame(maxWidth: isCompact ? .infinity : 240) }
            TSLiveIndicator(isLive: model.isLiveCharging)
        }
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
            BatteryHealthSkeleton()
        case .empty:
            emptyView
        case let .error(message):
            errorView(message)
        case .ready:
            if let analytics = model.analytics {
                readyView(analytics)
            } else {
                emptyView
            }
        }
    }

    /// Web no-data state (`!health`) — a single page-level empty.
    private var emptyView: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "battery.empty",
                systemImage: "minus.plus.batteryblock"
            )
            .frame(maxWidth: .infinity)
        }
    }

    /// Web `PageContainer error` region — message plus a Retry affordance.
    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                TSErrorDisplay(onRetry: { Task { await model.refresh() } })
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web main PageContainer body)

    private func readyView(_ analytics: BatteryHealthAnalytics) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            overviewSections(analytics)
            trendSections
            breakdownSections(analytics)
        }
    }

    /// Hero + metric bars + summary cards + thermal + insights (web sections 1–4), each in
    /// its own resilience boundary (web `SectionErrorBoundary` with a fallback title).
    @ViewBuilder
    private func overviewSections(_ analytics: BatteryHealthAnalytics) -> some View {
        BatteryHealthSectionBoundary("battery.section.heroFailed") {
            BatteryHealthHeroSection(analytics: analytics, yearsTo80: model.yearsTo80Text)
        }
        BatteryHealthSectionBoundary("battery.section.metricBarsFailed") {
            BatteryHealthMetricBarsSection(analytics: analytics)
        }
        BatteryHealthSectionBoundary("battery.section.summaryCardsFailed") {
            BatteryHealthSummaryCardsSection(analytics: analytics, live: model.live, units: units)
        }
        BatteryHealthSectionBoundary("battery.section.thermalFailed") {
            BatteryHealthThermalSection(live: model.live, units: units)
        }
        BatteryHealthSectionBoundary("battery.section.insightsFailed") {
            BatteryHealthInsightsSection(insights: model.insights(prefs: units))
        }
    }

    /// Capacity-trend + range-trend charts (web sections 5–6, unwrapped like the web) plus
    /// the charge-distribution panel in its resilience boundary.
    @ViewBuilder
    private var trendSections: some View {
        BatteryHealthCapacityTrendSection(rows: model.trendRows)
        BatteryHealthRangeTrendSection(rows: model.rangeRows, units: units)
        BatteryHealthSectionBoundary("battery.section.chargeDistFailed") {
            BatteryHealthChargeDistSection(buckets: model.chargeBuckets, habits: model.habits)
        }
    }

    /// New-vs-now + AC/DC breakdown + quick links + recommendations (web sections 8–11), each
    /// in its own resilience boundary.
    @ViewBuilder
    private func breakdownSections(_ analytics: BatteryHealthAnalytics) -> some View {
        BatteryHealthSectionBoundary("battery.section.capacityRangeFailed") {
            if let newVsNow = model.newVsNow {
                BatteryHealthNewVsNowSection(data: newVsNow, units: units)
            }
        }
        BatteryHealthSectionBoundary("battery.section.acdcFailed") {
            BatteryHealthAcdcSection(breakdown: model.energyBreakdown, totalCycles: analytics.totalCycles)
        }
        BatteryHealthSectionBoundary("battery.section.quickLinksFailed") {
            BatteryHealthQuickLinksSection(onNavigate: onNavigate)
        }
        BatteryHealthSectionBoundary("battery.section.recommendationsFailed") {
            BatteryHealthRecommendationsSection(tipKeys: model.recommendationKeys)
        }
    }
}

/// A per-section resilience boundary (web `SectionErrorBoundary`): renders its content and,
/// when an error is signaled, the fallback title instead. SwiftUI has no render-time catch,
/// so `hasError` is supplied by the caller (page-level errors are handled by the phase
/// switch); the fallback title stays bound for the error path, mirroring the web `fallbackTitle`.
struct BatteryHealthSectionBoundary<Content: View>: View {
    private let failureTitle: LocalizedStringKey
    private let hasError: Bool
    private let content: () -> Content

    init(_ failureTitle: LocalizedStringKey, hasError: Bool = false, @ViewBuilder content: @escaping () -> Content) {
        self.failureTitle = failureTitle
        self.hasError = hasError
        self.content = content
    }

    var body: some View {
        if hasError {
            TSGlassPanel {
                TSErrorDisplay(title: failureTitle)
                    .frame(maxWidth: .infinity)
            }
        } else {
            content()
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        BatteryHealthPage(model: BatteryHealthPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty sections") {
        BatteryHealthPage(
            model: BatteryHealthPageModel(dataSource: EmptySectionsBatteryHealthDataSource())
        )
        .teslaSyncTheme()
    }

    #Preview("No data") {
        BatteryHealthPage(
            model: BatteryHealthPageModel(dataSource: EmptyBatteryHealthDataSource())
        )
        .teslaSyncTheme()
    }

    #Preview("Error") {
        BatteryHealthPage(
            model: BatteryHealthPageModel(dataSource: FailingBatteryHealthDataSource())
        )
        .teslaSyncTheme()
    }
#endif
