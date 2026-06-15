import SwiftUI

/// Native SwiftUI parity of `web/src/features/analytics/pages/TimelinePage.tsx`
/// (route `/timeline`). Vehicle state history and transitions: the web page chrome
/// (web `PageContainer`: title + subtitle + the vehicle `Select`), the four summary metric cards
/// (total transitions, driving time, charging time, idle/sleep time), the proportional
/// state-distribution bar + legend, the daily-breakdown stacked bar chart, and the state-transition
/// table. Every data state the source produces is implemented (loading / empty / error / success),
/// including each section's own empty state (web per-section `EmptyState`).
///
/// Adaptive (ADR-002/006): the metric grid, the header, and the panels reflow for macOS / iPad
/// regular width vs. compact iPhone. All copy resolves from `Localizable.xcstrings` with the web
/// key names; data binds through the `@Observable` `TimelinePageModel` (no networking in the view).
/// Durations are SI seconds; formatting to "Xh Ym" happens only here at the render boundary.
public struct TimelinePage: View {
    @State private var model: TimelinePageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: TimelinePageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
                header
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.transitionRecords.isEmpty else { return }
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
            TSPageTitle("timeline.title")
            Text("timeline.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web vehicle `Select` with the `timeline.selectVehicle` prompt (shown only when
    /// `vehicles.length > 0`).
    private var vehiclePicker: some View {
        TSSelect(
            selection: vehicleBinding,
            options: model.vehicles.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) }
        )
        .accessibilityLabel(Text("timeline.selectVehicle"))
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
            TimelineSkeleton()
        case .empty:
            emptyView
        case .error:
            errorView
        case .ready:
            readyView
        }
    }

    /// Web no-vehicle state — the select-a-vehicle prompt (no recovery action).
    private var emptyView: some View {
        TSGlassPanel {
            TSEmptyState(title: "timeline.selectVehicle", systemImage: "car")
                .frame(maxWidth: .infinity)
        }
    }

    /// Web `anyError` AlertBanner region — message plus a Retry affordance.
    private var errorView: some View {
        TSGlassPanel {
            TSErrorDisplay(title: "error.loadFailed", onRetry: { Task { await model.refresh() } })
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web main PageContainer body)

    private var readyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xl) {
            TimelineMetricsSection(model: model)
            TimelineStateDistributionSection(
                segments: model.distributionSegments,
                hasStateData: model.hasStateData
            )
            TimelineDailyBreakdownSection(buckets: model.dailyBuckets)
            TimelineTransitionsSection(rows: model.transitionRows)
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        TimelinePage(model: TimelinePageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        TimelinePage(model: TimelinePageModel(dataSource: EmptyTimelineDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        TimelinePage(model: TimelinePageModel(dataSource: FailingTimelineDataSource()))
            .teslaSyncTheme()
    }
#endif
