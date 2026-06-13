import SwiftUI

/// Native SwiftUI parity of `web/src/features/automations/pages/AutomationActivityFeed.tsx`
/// (an unrouted section of the `/automations` page). Reproduces the single web `GlassPanel`:
/// the header (Activity glyph + "Recent Activity" title + the Live/Reconnecting connection
/// chip + the gated total/success/avg stats), the live SSE rows, and the execution-history
/// list with every web data state — loading (skeletons) / success (rows) / empty
/// (`EmptyState`). Adaptive (ADR-002/006): macOS/iPad lay the title row and stats side by
/// side; compact iPhone stacks them. All copy resolves from `Localizable.xcstrings`; data
/// binds through the `@Observable` `AutomationActivityFeedPageModel` (no networking here).
public struct AutomationActivityFeedPage: View {
    @State private var model: AutomationActivityFeedPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Number of shimmer rows shown while the history loads (web 5 × `<Skeleton h-10 />`).
    private static let skeletonRowCount = 5

    public init(model: AutomationActivityFeedPageModel = AutomationActivityFeedPageModel()) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            TSFadeIn(delay: 0.1) {
                panel
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle("automations.recentActivity")
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .task {
                if case .loading = model.state { await model.load() }
            }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - GlassPanel1 (web "Recent Activity" panel)

    private var panel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                liveEvents
                historyContent
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("automations.recentActivity"))
    }

    // MARK: - Header (web title + connection chip + stats)

    @ViewBuilder
    private var header: some View {
        if isCompact {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                titleGroup
                if let stats = model.stats {
                    AutomationActivityStatsRow(stats: stats)
                }
            }
        } else {
            HStack(alignment: .center, spacing: TSSpacing.sm) {
                titleGroup
                Spacer(minLength: TSSpacing.sm)
                if let stats = model.stats {
                    AutomationActivityStatsRow(stats: stats)
                }
            }
        }
    }

    private var titleGroup: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            Text("automations.recentActivity")
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            AutomationActivityConnectionChip(connection: model.connection)
        }
    }

    // MARK: - Live events (web SSE rows)

    @ViewBuilder
    private var liveEvents: some View {
        if !model.liveEvents.isEmpty {
            VStack(spacing: TSSpacing.xs) {
                ForEach(model.liveEvents) { event in
                    AutomationActivityLiveRow(event: event)
                }
            }
            .accessibilityElement(children: .contain)
        }
    }

    // MARK: - History list (web isLoading / data / empty)

    @ViewBuilder
    private var historyContent: some View {
        switch model.state {
        case .loading:
            VStack(spacing: TSSpacing.xs) {
                ForEach(0 ..< Self.skeletonRowCount, id: \.self) { _ in
                    TSSkeleton(height: 36, cornerRadius: TSRadius.sm)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement()
            .accessibilityLabel(Text("automations.activityFeed.loading"))
        case .success:
            VStack(spacing: 2) {
                ForEach(model.runs) { run in
                    AutomationActivityRunRow(run: run)
                }
            }
        case .empty:
            TSEmptyState(
                title: "automations.noHistory",
                systemImage: "waveform.path.ecg"
            )
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.md)
        }
    }
}

#if DEBUG
    @MainActor
    private func previewModel(_ snapshot: AutomationActivityFeedSnapshot) -> AutomationActivityFeedPageModel {
        AutomationActivityFeedPageModel(provider: PreviewAutomationActivityFeed(snapshot))
    }

    private struct PreviewAutomationActivityFeed: AutomationActivityFeedProviding {
        let value: AutomationActivityFeedSnapshot
        init(_ value: AutomationActivityFeedSnapshot) {
            self.value = value
        }

        func snapshot() async -> AutomationActivityFeedSnapshot {
            value
        }
    }

    private let previewRuns: [AutomationActivityRun] = [
        AutomationActivityRun(
            id: "1", name: "Precondition at 7 AM", status: .success,
            triggeredAt: Date(timeIntervalSinceNow: -9 * 60), durationMs: 1840,
            actionsTotal: 3, actionsSucceeded: 3
        ),
        AutomationActivityRun(
            id: "2", name: "Charge to 80%", status: .partial,
            triggeredAt: Date(timeIntervalSinceNow: -50 * 60), durationMs: 920,
            actionsTotal: 2, actionsSucceeded: 1
        ),
        AutomationActivityRun(
            id: "3", name: "Lock when away", status: .failed, error: "Vehicle unreachable",
            triggeredAt: Date(timeIntervalSinceNow: -3 * 3600), durationMs: 450,
            actionsTotal: 1, actionsSucceeded: 0
        )
    ]

    private let previewStats = AutomationActivityStats(totalRuns: 142, successRate: 93, avgDurationMs: 1320)

    private let previewLive: [AutomationActivityLiveEvent] = [
        AutomationActivityLiveEvent(
            id: "ae-1",
            type: "automation.triggered",
            automationId: 7,
            name: "Precondition at 7 AM"
        ),
        AutomationActivityLiveEvent(
            id: "ae-2",
            type: "automation.failed",
            automationId: 9,
            name: "Lock when away",
            error: "Vehicle unreachable"
        )
    ]

    #Preview("Success + Live") {
        NavigationStack {
            AutomationActivityFeedPage(model: previewModel(
                AutomationActivityFeedSnapshot(runs: previewRuns, stats: previewStats, liveEvents: previewLive)
            ))
        }
        .teslaSyncTheme()
    }

    #Preview("Loading") {
        NavigationStack {
            AutomationActivityFeedPage(model: previewModel(
                AutomationActivityFeedSnapshot(stats: previewStats, isLoading: true)
            ))
        }
        .teslaSyncTheme()
    }

    #Preview("Empty / Reconnecting") {
        NavigationStack {
            AutomationActivityFeedPage(model: previewModel(
                AutomationActivityFeedSnapshot(connection: .reconnecting)
            ))
        }
        .teslaSyncTheme()
    }
#endif
