import SwiftUI

/// Native SwiftUI parity of `web/src/features/driving/pages/DriveScorePage.tsx` (route
/// `/drive-score`). The driving rating + breakdown: the page chrome (web `PageContainer`: title +
/// subtitle + the global `VehicleSelect` and the `RangePicker`), the hero overall-score gauge, the
/// grade badge, the three category gauges, the score-trend / category-breakdown / score-distribution
/// charts, the improvement tips, the best/worst drive cards, the sortable + paginated drive-history
/// table, the four summary stat cards, the six weekly/monthly period-stat cards, the achievement
/// badges, and the two breakdown KVLists. Every data state the source produces is implemented
/// (loading / empty / error / success).
///
/// Adaptive (ADR-002/006): the gauge grids, the chart panels, the best/worst row, and the period-stat
/// grid reflow for macOS / iPad regular width vs. compact iPhone. All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `DriveScorePageModel` (no networking in the view). SI values convert to the user's unit preference
/// only here, at the render boundary, via the shared `Units` facade (ADR-005). The locally-computed
/// scores are derived in `DriveScoreEngine`, mirroring the web `scoreDrive` algorithm.
public struct DriveScorePage: View {
    @State private var model: DriveScorePageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: DriveScorePageModel) {
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
        .navigationTitle(Text("driveScore.title"))
        .refreshable { await model.refresh() }
        .task {
            guard model.loadState == .loading, model.drives.isEmpty else { return }
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
            TSPageTitle("driveScore.title")
            Text("driveScore.subtitle")
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
                    DriveScoreRangeControl(
                        startDate: model.startDate,
                        endDate: model.endDate,
                        onChange: { model.setDateRange(start: $0, end: $1) }
                    )
                }
            } else {
                HStack(spacing: TSSpacing.md) {
                    if !model.vehicles.isEmpty { vehiclePicker.frame(maxWidth: 220) }
                    DriveScoreRangeControl(
                        startDate: model.startDate,
                        endDate: model.endDate,
                        onChange: { model.setDateRange(start: $0, end: $1) }
                    )
                }
            }
        }
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
            DriveScoreSkeleton()
        case .empty:
            emptyView
        case let .error(message):
            errorView(message)
        case .ready:
            readyView
        }
    }

    /// Web `scoredDrives.length === 0` guard — both the "No Scored Drives" empty (driveScore.empty)
    /// and the inner "No data available" empty (common.noData), neither of which hides the chrome.
    private var emptyView: some View {
        VStack(spacing: TSSpacing.lg) {
            TSGlassPanel {
                TSEmptyState(
                    title: "driveScore.emptyTitle",
                    message: "driveScore.empty",
                    systemImage: "speedometer"
                )
                .frame(maxWidth: .infinity)
            }
            TSGlassPanel {
                TSEmptyState(title: "common.noData", systemImage: "gauge.with.dots.needle.bottom.50percent")
                    .frame(maxWidth: .infinity)
            }
        }
    }

    /// Web `PageContainer error` region — message plus a Retry affordance.
    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(message: LocalizedStringKey(message), onRetry: { Task { await model.refresh() } })
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web main PageContainer body — the StaggerContainer sections)

    private var readyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            DriveScoreHeroSection(model: model)
            DriveScoreGradeBadgeSection(model: model)
            DriveScoreBreakdownSection(model: model, units: units, isCompact: isCompact)
            DriveScoreTrendSection(points: model.trendPoints, gradeColorIndex: model.overallGrade.gaugeColorIndex)
            DriveScoreCategoryBreakdownSection(bars: model.categoryBars)
            DriveScoreDistributionSection(bins: model.histogram)
            DriveScoreTipsSection(weakest: model.weakestCategory, tips: model.relevantTips)
            DriveScoreBestWorstSection(model: model, units: units, isCompact: isCompact)
            DriveScoreHistorySection(model: model, units: units)
            DriveScoreSummaryStatsSection(model: model, units: units)
            DriveScorePeriodStatsSection(stats: model.periodStats)
            DriveScoreAchievementsSection(achievements: model.achievements, isCompact: isCompact)
            DriveScoreBreakdownDetailSection(model: model, units: units, isCompact: isCompact)
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        DriveScorePage(model: DriveScorePageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        DriveScorePage(model: DriveScorePageModel(dataSource: EmptyDriveScoreDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        DriveScorePage(model: DriveScorePageModel(dataSource: FailingDriveScoreDataSource()))
            .teslaSyncTheme()
    }
#endif
