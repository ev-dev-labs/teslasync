import SwiftUI

/// Native SwiftUI parity of `web/src/features/driving/pages/DriveDetailPage.tsx`
/// (route `/drives/:id`). One drive in full: the header (route title, vehicle, date, replay +
/// share affordances), the optional "no telemetry recorded" banner, five hero gauges, the
/// timeline, the eight headline stat cards, the AI coaching narrative, the more-details /
/// energy-summary / cost-savings panels, the route map, the journey-details panel, six
/// synced time-series charts (overview · SoC · elevation · temperature · power · tire) plus
/// the speed histogram, the AI speed-profile insights, and the lazy "why did this drive end?"
/// diagnostic. Every section is fronted by its own error boundary whose localized fallback
/// title is the web `SectionErrorBoundary fallbackTitle` (ADR-011 — never a blank region).
///
/// Adaptive (ADR-002/006): the gauge + stat grids reflow for macOS / iPad regular width vs.
/// compact iPhone, the chart pairs stack on compact width, and the panels scroll; in a
/// `NavigationStack` the system back button replaces the web back link. All copy resolves from
/// `Localizable.xcstrings` with the web key names; numeric values format at the render boundary
/// through `Units` / `TS*` SI formatters — nothing non-SI is stored or computed (ADR-005). Data
/// binds through the `@Observable` `DriveDetailPageModel` (no networking in the view).
public struct DriveDetailPage: View {
    @State private var model: DriveDetailPageModel

    public init(model: DriveDetailPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("driveDetail.title"))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .toolbar { shareToolbar }
            .refreshable { await model.refresh() }
            .task {
                guard model.phase == .loading else { return }
                await model.load()
            }
    }

    // MARK: - Top-level phase switch (web `isLoading ? Skeleton : error ? error : body`)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            DriveDetailPageSkeleton()
        case let .error(message):
            errorView(message)
        case .ready:
            readyView
        }
    }

    /// Retryable failure of the drive fetch (web `PageContainer error`), with the HIG retry
    /// affordance (ADR-011).
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

    // MARK: - Ready (web main body — `drive && stats && (...)`)

    @ViewBuilder
    private var readyView: some View {
        if let record = model.record, let stats = model.stats {
            let meaningful = model.hasMeaningfulDriveStats

            boundary(.header, "driveDetail.section.headerFailed") {
                DriveDetailHeaderSection(record: record, vehicleName: vehicleName)
            }

            if !meaningful {
                DriveDetailNoTelemetryBanner()
            }

            if meaningful {
                boundary(.heroGauges, "driveDetail.section.heroGaugesFailed") {
                    DriveHeroGaugeSection(record: record, stats: stats)
                }
            }

            boundary(.timeline, "driveDetail.section.timelineFailed") {
                DriveTimelineSection(record: record)
            }

            if meaningful {
                boundary(.statCards, "driveDetail.section.statCardsFailed") {
                    DriveStatGridSection(record: record, stats: stats)
                }
            }

            boundary(.aiCoaching, "driveDetail.section.aiCoachingFailed") {
                DriveAICoachingSection()
            }

            if meaningful {
                boundary(.moreDetails, "driveDetail.section.moreDetailsFailed") {
                    DriveMoreDetailsSection(record: record, stats: stats)
                }
                boundary(.energySummary, "driveDetail.section.energySummaryFailed") {
                    DriveEnergySummarySection(record: record, stats: stats)
                }
            }

            if stats.energyWh > 0 {
                boundary(.costSavings, "driveDetail.section.costSavingsFailed") {
                    DriveCostSavingsSection(record: record, stats: stats)
                }
            }

            boundary(.routeMap, "driveDetail.section.routeMapFailed") {
                DriveRouteMapSection(record: record, route: model.routeCoordinates)
            }
            boundary(.journeyDetails, "driveDetail.section.journeyDetailsFailed") {
                DriveJourneyDetailsSection(record: record)
            }

            chartSections(stats: stats)

            boundary(.tirePressure, "driveDetail.section.tirePressureFailed") {
                DriveTirePressureSection(samples: model.chartSamples, stats: stats)
            }
            boundary(.whyEnded, "driveDetail.section.whyEndedFailed") {
                DriveWhyEndedSection(model: model)
            }
        } else {
            DriveDetailPageSkeleton()
        }
    }

    /// The synced chart block (web `<ChartTimeRangeProvider>`): overview, then the SoC +
    /// elevation pair, the temperature + speed-histogram pair, the AI speed insights, and the
    /// power-profile chart.
    @ViewBuilder
    private func chartSections(stats: DriveStats) -> some View {
        let samples = model.chartSamples
        boundary(.overviewChart, "driveDetail.section.overviewChartFailed") {
            DriveOverviewChartSection(samples: samples)
        }
        AdaptiveChartPair {
            boundary(.socChart, "driveDetail.section.socChartFailed") {
                DriveSocChartSection(samples: samples)
            }
        } trailing: {
            boundary(.elevationChart, "driveDetail.section.elevationChartFailed") {
                DriveElevationChartSection(samples: samples, stats: stats)
            }
        }
        AdaptiveChartPair {
            boundary(.temperature, "driveDetail.section.temperatureFailed") {
                DriveTemperatureChartSection(samples: samples, stats: stats)
            }
        } trailing: {
            boundary(.speedHistogram, "driveDetail.section.speedHistogramFailed") {
                DriveSpeedHistogramSection(samples: samples)
            }
        }
        boundary(.aiSpeedProfileInsights, "driveDetail.section.aiSpeedProfileInsightsFailed") {
            DriveAISpeedInsightsSection()
        }
        boundary(.powerProfile, "driveDetail.section.powerProfileFailed") {
            DrivePowerProfileSection(samples: samples, stats: stats)
        }
    }

    /// Wraps a section in its localized error boundary (web `SectionErrorBoundary`): renders the
    /// content, or the fallback title + retry when the model marks the section failed.
    private func boundary(
        _ section: DriveDetailSectionID,
        _ fallbackTitle: LocalizedStringKey,
        @ViewBuilder content: @escaping () -> some View
    ) -> some View {
        DriveDetailSectionBoundary(
            fallbackTitle: fallbackTitle,
            failed: model.isFailed(section),
            onRetry: { Task { await model.refresh() } },
            content: content
        )
    }

    private var vehicleName: String {
        if let name = model.vehicle?.displayName, !name.isEmpty { return name }
        return String(localized: "driveDetail.vehicle")
    }

    /// The share affordance (web header `Share` + `PrintButton`). A `ShareLink` exports a plain
    /// drive summary on both idioms.
    @ToolbarContentBuilder
    private var shareToolbar: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            ShareLink(item: shareSummary) {
                Label("driveDetail.share", systemImage: "square.and.arrow.up")
            }
            .disabled(model.record == nil)
        }
    }

    private var shareSummary: String {
        guard let record = model.record else { return String(localized: "driveDetail.title") }
        let route = [record.startAddress, record.endAddress]
            .compactMap(\.self)
            .joined(separator: " → ")
        return route.isEmpty ? String(localized: "driveDetail.title") : route
    }
}

/// A chart pair that sits side-by-side at regular width (macOS / iPad) and stacks at compact
/// width (iPhone), matching the web `lg:grid-cols-2` chart rows.
struct AdaptiveChartPair<Leading: View, Trailing: View>: View {
    @ViewBuilder var leading: () -> Leading
    @ViewBuilder var trailing: () -> Trailing

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    private var isRegular: Bool {
        #if os(iOS)
            sizeClass == .regular
        #else
            true
        #endif
    }

    var body: some View {
        if isRegular {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                leading().frame(maxWidth: .infinity)
                trailing().frame(maxWidth: .infinity)
            }
        } else {
            VStack(spacing: TSSpacing.x2xl) {
                leading()
                trailing()
            }
        }
    }
}

#if DEBUG
    #Preview("Success") {
        NavigationStack {
            DriveDetailPage(model: DriveDetailPageModel(driveID: 7))
        }
        .tsUnits(.metric)
        .teslaSyncTheme()
    }

    #Preview("No telemetry") {
        NavigationStack {
            DriveDetailPage(
                model: DriveDetailPageModel(driveID: 7, dataSource: NoTelemetryDriveDetailDataSource())
            )
        }
        .tsUnits(.imperial)
        .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationStack {
            DriveDetailPage(
                model: DriveDetailPageModel(driveID: 7, dataSource: FailingDriveDetailDataSource())
            )
        }
        .tsUnits(.metric)
        .teslaSyncTheme()
    }
#endif
