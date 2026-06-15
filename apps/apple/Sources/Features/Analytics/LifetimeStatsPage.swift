import SwiftUI

/// Native SwiftUI parity of `web/src/features/analytics/pages/LifetimeStatsPage.tsx`
/// (route `/lifetime-stats`). Your all-time driving achievements and milestones: the web page
/// chrome (`PageContainer` title + subtitle + the header `VehicleSelect`), the hero distance
/// banner, the four headline stat cards (Total Drives / Distance / Energy / Savings), and the six
/// roll-up panels — Fun Facts, Savings vs Gasoline, Environmental Impact, Personal Records,
/// Activity Summary, and the Achievement Gallery. Every data state the source produces is
/// implemented (loading / error, and each panel's own empty / success).
///
/// Adaptive (ADR-002/006): the stat + fun-fact grids reflow for macOS / iPad regular width vs.
/// compact iPhone, and the panels stack in a scroll view. All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `LifetimeStatsPageModel` (no networking in the view). The lifetime roll-up is delivered in SI
/// (meters, m/s, watt-hours, seconds); the view converts to the user's unit preference only here,
/// at the render boundary, via the shared `Units` facade (ADR-005) — nothing non-SI is stored or
/// computed.
public struct LifetimeStatsPage: View {
    @State private var model: LifetimeStatsPageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: LifetimeStatsPageModel) {
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
        .navigationTitle(Text("lifetime.title"))
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

    // MARK: - Header (web PageContainer title + subtitle + VehicleSelect)

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
            TSPageTitle("lifetime.title")
            Text("lifetime.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header actions: the `VehicleSelect` plus a refresh affordance that surfaces the in-flight
    /// refetch (web `DataFreshnessAuto`).
    private var headerControls: some View {
        HStack(spacing: TSSpacing.md) {
            if !model.vehicles.isEmpty { vehiclePicker }
            refreshControl
        }
    }

    private var vehiclePicker: some View {
        TSSelect(
            selection: vehicleBinding,
            options: model.vehicles.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) }
        )
        .frame(maxWidth: 220)
        .accessibilityLabel(Text("route.vehicles"))
    }

    private var refreshControl: some View {
        Button {
            Task { await model.refresh() }
        } label: {
            if model.isRefreshing {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: "arrow.clockwise")
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.accent)
        .disabled(model.isRefreshing)
        .accessibilityLabel(Text("action.refresh"))
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
            LifetimeStatsSkeleton()
        case let .error(message):
            errorView(message)
        case .ready:
            readyView
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

    // MARK: - Ready (web main PageContainer body — hero + stat cards + the six panels)

    private var readyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LifetimeHeroSection(stats: model.stats, units: units)
            LifetimeKeyStatsSection(stats: model.stats, units: units, isCompact: isCompact)
            LifetimeFunFactsSection(stats: model.stats)
            LifetimeSavingsSection(savings: model.savingsBar)
            LifetimeEnvironmentalSection(stats: model.stats, isCompact: isCompact)
            LifetimeRecordsSection(stats: model.stats, units: units, isCompact: isCompact)
            LifetimeActivitySection(stats: model.stats, units: units, isCompact: isCompact)
            LifetimeAchievementsSection(achievements: model.achievements, unlockedCount: model.unlockedCount)
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        LifetimeStatsPage(model: LifetimeStatsPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        LifetimeStatsPage(model: LifetimeStatsPageModel(dataSource: EmptyLifetimeStatsDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        LifetimeStatsPage(model: LifetimeStatsPageModel(dataSource: FailingLifetimeStatsDataSource()))
            .teslaSyncTheme()
    }
#endif
