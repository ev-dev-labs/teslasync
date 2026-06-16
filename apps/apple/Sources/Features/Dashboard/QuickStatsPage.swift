import SwiftUI

/// Native SwiftUI parity of `web/src/features/dashboard/pages/QuickStatsPage.tsx` (route
/// `/quick-stats`). A compact kiosk view of the fleet: the web page chrome (`PageContainer` title +
/// its loading / error phases), the vehicle header card (`GlassPanel` + car glyph + name + "model ·
/// state", degrading to the no-vehicle `EmptyState`), the four headline metric cards (Distance /
/// Drives / Energy / Cost), and the "Powered by TeslaSync · Open Dashboard" footer. Every data state
/// the source produces is implemented (loading / empty / error / success); the metric cards always
/// render with `?? 0` fallbacks rather than hiding, exactly as the web does.
///
/// Adaptive (ADR-002/006): the kiosk column centres on macOS / iPad regular width and fills the
/// compact iPhone width, with the metric grid reflowing 1↔2 columns. All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `QuickStatsPageModel` (no networking in the view). SI distance (metres) converts to the user's
/// unit only here — at the render boundary — via the shared `Units` facade + `QuickStatsPageFormat`
/// (ADR-005).
public struct QuickStatsPage: View {
    @State private var model: QuickStatsPageModel
    @Environment(\.tsUnits) private var units

    /// Navigates to the dashboard (web footer `<Link to="/">`). Injected by the route registration;
    /// a no-op default keeps previews / tests self-contained.
    private let onOpenDashboard: () -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: QuickStatsPageModel, onOpenDashboard: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onOpenDashboard = onOpenDashboard
    }

    public var body: some View {
        ScrollView {
            content
                .frame(maxWidth: .infinity)
                .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("quickStats.title"))
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading else { return }
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

    // MARK: - Top-level phase switch (web PageContainer phases)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            QuickStatsPageSkeleton()
        case let .error(message):
            errorView(message)
        case .ready:
            readyColumn
        }
    }

    /// Web `PageContainer error={vehiclesError || analyticsError}` — a message plus a Retry
    /// affordance.
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
        .frame(maxWidth: 440)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web body — vehicle card + metric grid + footer)

    /// The populated kiosk (web `FadeIn` column) — centred and width-capped like the web `max-w-md`
    /// body. The vehicle card shows the populated header or the no-vehicle empty; the four metric
    /// cards always render.
    private var readyColumn: some View {
        VStack(spacing: TSSpacing.lg) {
            QuickStatsPageVehicleCard(vehicle: model.vehicle, state: model.state)
            QuickStatsPageMetricGrid(summary: model.metrics, units: units, isCompact: isCompact)
            QuickStatsPageFooter(onOpenDashboard: onOpenDashboard)
        }
        .frame(maxWidth: 440)
        .frame(maxWidth: .infinity)
    }
}

#if DEBUG
    #Preview("Success") {
        QuickStatsPage(model: QuickStatsPageModel())
            .tsUnits(.metric)
            .teslaSyncTheme()
    }

    #Preview("No vehicle") {
        QuickStatsPage(model: QuickStatsPageModel(dataSource: NoVehicleQuickStatsPageDataSource()))
            .tsUnits(.imperial)
            .teslaSyncTheme()
    }

    #Preview("Degraded") {
        QuickStatsPage(model: QuickStatsPageModel(dataSource: EmptyQuickStatsPageDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        QuickStatsPage(model: QuickStatsPageModel(dataSource: FailingQuickStatsPageDataSource()))
            .teslaSyncTheme()
    }
#endif
