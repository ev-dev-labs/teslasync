import SwiftUI

/// Native SwiftUI parity of `web/src/features/analytics/pages/AnalyticsPage.tsx` (route `/analytics`).
/// Fleet performance intelligence: the web page chrome (`PageContainer`: title + subtitle + the
/// data-freshness indicator and range picker actions), the six hero gauges, and the four-tab body —
/// Overview, Driving, Charging, Battery — each reproducing every `GlassPanel` region (charts, metric
/// grids, leaderboards, quick links) in the same data + grouping + order. Every data state the single
/// source produces is implemented (loading / empty / error / success), including each section's own
/// empty state.
///
/// Adaptive (ADR-002/006): the hero/metric grids, the two-column rows, and the header reflow for
/// macOS / iPad regular width vs. compact iPhone. All copy resolves from `Localizable.xcstrings` with
/// the web key names; data binds through the `@Observable` `AnalyticsPageModel` (no networking in the
/// view). SI values convert to the user's unit preference only here, at the render boundary, via the
/// shared `Units` facade (ADR-005), and the freshness indicator surfaces a >2 min staleness (ADR-013).
public struct AnalyticsPage: View {
    @State private var model: AnalyticsPageModel
    @Environment(\.tsUnits) private var units
    private let onNavigate: (AppRoute) -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: AnalyticsPageModel, onNavigate: @escaping (AppRoute) -> Void = { _ in }) {
        _model = State(initialValue: model)
        self.onNavigate = onNavigate
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.data == nil else { return }
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

    // MARK: - Header (web PageContainer title + subtitle + actions)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    headerActions
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    headerActions
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("analytics.title")
            Text("analytics.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header actions: the auto data-freshness indicator + the range picker.
    private var headerActions: some View {
        HStack(spacing: TSSpacing.md) {
            if model.lastUpdated != nil {
                AnalyticsFreshnessChip(isStale: model.isStale)
            }
            rangePicker
        }
    }

    /// Web `RangePicker` (presets 7d / 30d / 90d / 1y / all) — re-keys the fleet query on change.
    private var rangePicker: some View {
        Menu {
            ForEach(AnalyticsRange.allCases) { option in
                Button {
                    Task { await model.selectRange(option) }
                } label: {
                    if option == model.range {
                        Label(rangeTitle(option), systemImage: "checkmark")
                    } else {
                        Text(rangeTitle(option))
                    }
                }
            }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "calendar")
                Text(rangeTitle(model.range))
                Image(systemName: "chevron.down").font(.caption2)
            }
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textPrimary)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        }
        .accessibilityLabel(Text("analytics.range.label"))
    }

    private func rangeTitle(_ range: AnalyticsRange) -> LocalizedStringKey {
        switch range {
        case .day7: "analytics.range.7d"
        case .day30: "analytics.range.30d"
        case .day90: "analytics.range.90d"
        case .year1: "analytics.range.1y"
        case .all: "analytics.range.all"
        }
    }

    // MARK: - Phase switch (web PageContainer loading / error + data presence)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            AnalyticsSkeleton()
        case .empty:
            emptyView
        case .error:
            errorView
        case .ready:
            readyView
        }
    }

    /// Web defensive no-data state (the source returned an empty payload).
    private var emptyView: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "analytics.noData",
                message: "analytics.noDataMsg",
                systemImage: "chart.bar"
            )
            .frame(maxWidth: .infinity, minHeight: 200)
        }
    }

    /// Web `PageContainer error` region — message plus a Retry affordance.
    private var errorView: some View {
        TSGlassPanel {
            TSErrorDisplay(onRetry: { Task { await model.refresh() } })
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web hero + TabNav + active tab body)

    @ViewBuilder
    private var readyView: some View {
        if let data = model.data {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                AnalyticsHeroSection(data: data, units: units)
                TSTabs(selection: tabBinding, tabs: AnalyticsTab.allCases.map { tab in
                    TSTab(tab, LocalizedStringKey(tab.titleKey), systemImage: tab.systemImage)
                })
                tabBody(data)
            }
        }
    }

    @ViewBuilder
    private func tabBody(_ data: FleetAnalyticsData) -> some View {
        switch model.activeTab {
        case .overview:
            AnalyticsOverviewTab(data: data, model: model, units: units, onNavigate: onNavigate)
        case .driving:
            AnalyticsDrivingTab(data: data, units: units)
        case .charging:
            AnalyticsChargingTab(data: data, model: model, units: units)
        case .battery:
            AnalyticsBatteryTab(data: data, units: units)
        }
    }

    private var tabBinding: Binding<AnalyticsTab> {
        Binding(get: { model.activeTab }, set: { model.selectTab($0) })
    }
}

// MARK: - Freshness chip (web `DataFreshnessAuto`)

/// A compact data-freshness indicator (web `DataFreshnessAuto`): a tinted dot + label that flips to a
/// warning tone once the payload is older than two minutes (ADR-013 staleness).
struct AnalyticsFreshnessChip: View {
    let isStale: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(isStale ? Color.TS.statusWarning : Color.TS.statusSuccess)
                .frame(width: 7, height: 7)
            Text(isStale ? "analytics.freshness.stale" : "analytics.freshness.live")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(isStale ? "analytics.freshness.stale" : "analytics.freshness.live"))
    }
}

// MARK: - Loading skeleton (web PageContainer loading state)

/// Mirrors the page layout while the source loads (web `PageContainer loading`): the six hero cards,
/// the tab bar, and a few chart blocks under SwiftUI redaction (the manifest's `loading →
/// redacted(reason:)`).
struct AnalyticsSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            AnalyticsMetricGrid(minimum: 150) {
                ForEach(0 ..< 6, id: \.self) { _ in
                    skeletonBlock(height: 84)
                }
            }
            skeletonBlock(height: 44)
            skeletonBlock(height: 260)
            skeletonBlock(height: 260)
        }
        .analyticsRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("analytics.title"))
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies SwiftUI's skeleton redaction while `loading`, matching the web Skeleton loading state
    /// (the manifest's `loading → redacted(reason:)` requirement).
    func analyticsRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow SwiftUI redaction API, not a stub
        return redacted(reason: reasons)
    }
}

#if DEBUG
    #Preview("Loaded") {
        AnalyticsPage(model: AnalyticsPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        AnalyticsPage(model: AnalyticsPageModel(dataSource: EmptyAnalyticsDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        AnalyticsPage(model: AnalyticsPageModel(dataSource: FailingAnalyticsDataSource()))
            .teslaSyncTheme()
    }
#endif
