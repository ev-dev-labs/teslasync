import SwiftUI

/// Native SwiftUI parity of `web/src/features/analytics/pages/MileagePage.tsx` (route `/mileage`).
/// Daily + monthly distance tracking: the web page chrome (web `PageContainer`: title + subtitle +
/// the vehicle `VehicleSelect`), the four summary `MetricCard`s (total distance, total drives,
/// 30-day daily average, annual projection), the odometer-over-time `AreaChart` panel, the
/// daily-distance `BarChart` panel, and the monthly-summary `DataTable` panel. Every data state the
/// source produces is implemented (loading / empty / error / success), including each panel's own
/// empty state (web per-panel `EmptyState`) and the web `anyError` non-fatal banner.
///
/// Adaptive (ADR-002/006): the summary grid and the chart panels reflow for macOS / iPad regular
/// width vs. compact iPhone, and the monthly table becomes a card list on compact width. All copy
/// resolves from `Localizable.xcstrings` with the web key names; data binds through the
/// `@Observable` `MileagePageModel` (no networking in the view). SI meters convert to the user's
/// distance unit only here, at the render boundary, via the shared `Units` facade (ADR-005).
public struct MileagePage: View {
    @State private var model: MileagePageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: MileagePageModel) {
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
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.stats == nil else { return }
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

    // MARK: - Header (web PageContainer title + subtitle + vehicle VehicleSelect)

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
            TSPageTitle("mileage.title")
            Text("mileage.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header `VehicleSelect` (shown only when `vehicles.length > 0`).
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
            MileageSkeleton()
        case .empty:
            emptyView
        case .error:
            errorView
        case .ready:
            readyView
        }
    }

    /// Web `!stats` no-data EmptyState (no recovery action — transient source gap).
    private var emptyView: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "mileage.title",
                message: "No Entries",
                systemImage: "gauge.with.dots.needle.bottom.50percent"
            )
            .frame(maxWidth: .infinity)
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
            // Web `anyError` AlertBanner — a non-fatal daily/monthly load failure surfaced above
            // content that still renders.
            if model.hasSecondaryError {
                TSAlertBanner(
                    tone: .danger,
                    systemImage: "exclamationmark.triangle.fill",
                    title: "error.loadFailed"
                )
            }
            MileageSummarySection(stats: model.stats, units: units)
            MileageOdometerSection(points: model.odometerPoints, units: units)
            MileageDailyDistanceSection(points: model.dailyPoints, units: units)
            MileageMonthlySummarySection(rows: model.monthlyPoints, units: units)
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        MileagePage(model: MileagePageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        MileagePage(model: MileagePageModel(dataSource: EmptyMileageDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        MileagePage(model: MileagePageModel(dataSource: FailingMileageDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Partial error") {
        MileagePage(model: MileagePageModel(dataSource: SecondaryFailingMileageDataSource()))
            .teslaSyncTheme()
    }
#endif
