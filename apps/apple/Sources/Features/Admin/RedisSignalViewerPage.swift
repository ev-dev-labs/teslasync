import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/RedisSignalViewerPage.tsx` (route
/// `/redis-signals`). Reproduces the web page chrome (web `PageContainer`: title + subtitle)
/// and every region the source renders: the controls panel (GlassPanel1 — vehicle picker,
/// search, category filter, auto-refresh, refresh, and the two destructive purge buttons), the
/// persistent diagnostic chips, the four stat cards (Total-Signals / Numbers / Strings /
/// Booleans), and the signals table panel (GlassPanel6) with its full select-prompt → skeleton
/// → diagnostic → no-match → table state ladder. The cluster-wide purge requires a typed
/// confirmation and every command surfaces an outcome banner (web `toast.*`).
///
/// Two data sources drive the page — the vehicle list (web `useVehicles`) and the per-vehicle
/// Redis snapshot (web `['redis-signals', id]`). Every data state each produces is implemented
/// (loading / empty / error / success). Adaptive (ADR-002/006): the controls reflow to a stack
/// on compact iPhone width and the embedded `TSDataTable` becomes a card list. All copy resolves
/// from `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `RedisSignalViewerPageModel` (no networking in the view, ADR-004).
public struct RedisSignalViewerPage: View {
    @State private var model: RedisSignalViewerPageModel

    /// Vehicle-picker width on the controls row (web `w-64` = 256pt).
    static let pickerWidth: CGFloat = 256
    /// Keeps the table panel tall enough to breathe across its states (web `min-h`).
    static let panelMinHeight: CGFloat = 280

    public init(model: RedisSignalViewerPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                if let outcome = model.outcome {
                    RedisPurgeOutcomeBanner(outcome: outcome) { model.dismissOutcome() }
                }
                controlsPanel
                if model.showsMetaChips, let meta = model.meta {
                    RedisMetaChips(meta: meta)
                }
                if model.showsStats {
                    statsGrid
                }
                tablePanel
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            if case .loaded = model.vehiclesState { return }
            await model.load()
        }
        .task(id: model.selectedVehicleID) {
            await model.loadSignals()
        }
        .task(id: RedisAutoRefreshKey(vehicleID: model.selectedVehicleID, enabled: model.autoRefresh)) {
            await runAutoRefresh()
        }
        .sheet(isPresented: purgeSheetPresented) {
            RedisPurgeConfirmSheet(model: model)
        }
    }

    /// Drives the web `refetchInterval: INTERVALS.REALTIME` (5s) while auto-refresh is armed
    /// and a vehicle is selected. Tied to the view lifecycle via `.task(id:)`, so it cancels
    /// when the toggle flips, the vehicle changes, or the page disappears.
    private func runAutoRefresh() async {
        guard model.autoRefresh, model.hasSelection else { return }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 5 * 1_000_000_000)
            if Task.isCancelled { break }
            await model.refreshSignals()
        }
    }

    private var purgeSheetPresented: Binding<Bool> {
        Binding(
            get: { model.purgeMode != nil },
            set: { presented in if !presented { model.cancelPurge() } }
        )
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("redis.title")
            Text("redis.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - GlassPanel 1 — controls (web first GlassPanel)

    private var controlsPanel: some View {
        TSGlassPanel {
            controlsBody
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("redis.title"))
    }

    @ViewBuilder
    private var controlsBody: some View {
        switch model.vehiclesState {
        case .loading:
            TSSpinner(label: "redis.selectVehicle")
                .padding(.vertical, TSSpacing.xs)
        case .empty:
            TSEmptyState(
                title: "redis.selectVehicle",
                message: "redis.selectPrompt",
                systemImage: "car"
            )
            .frame(maxWidth: .infinity)
        case let .error(message):
            vehiclesError(message)
        case .loaded:
            RedisControlsBar(model: model)
        }
    }

    /// The vehicles source failed — an inline message with a Retry affordance (HIG).
    private func vehiclesError(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text("redis.vehiclesError")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.statusDanger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            TSButton("action.retry", variant: .secondary, size: .small) {
                Task { await model.refresh() }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityValue(Text(verbatim: message))
    }

    // MARK: - Stats (web 2x4 StatCard grid)

    private var statsGrid: some View {
        LazyVGrid(columns: Self.statColumns, spacing: TSSpacing.md) {
            TSStatCard(
                title: "redis.totalSignals",
                value: model.showsStatDash ? "—" : RedisSignalFormat.int(model.totalSignals),
                systemImage: "cylinder.split.1x2.fill"
            )
            TSStatCard(
                title: "redis.numbers",
                value: model.showsStatDash ? "—" : RedisSignalFormat.int(model.numbersCount)
            )
            TSStatCard(
                title: "redis.strings",
                value: model.showsStatDash ? "—" : RedisSignalFormat.int(model.stringsCount)
            )
            TSStatCard(
                title: "redis.booleans",
                value: model.showsStatDash ? "—" : RedisSignalFormat.int(model.booleansCount)
            )
        }
    }

    /// Web `grid-cols-2 sm:grid-cols-4` — an adaptive grid that holds 2 columns on compact
    /// width and expands toward 4 as space allows.
    private static let statColumns = [
        GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)
    ]

    // MARK: - GlassPanel 6 — table (web last GlassPanel)

    private var tablePanel: some View {
        TSGlassPanel {
            RedisSignalsTable(model: model)
                .frame(maxWidth: .infinity, minHeight: Self.panelMinHeight, alignment: .topLeading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("redis.title"))
    }
}

/// `.task(id:)` key that re-arms the auto-refresh loop whenever the selected vehicle or the
/// auto-refresh toggle changes (web `refetchInterval` re-keying).
struct RedisAutoRefreshKey: Equatable {
    let vehicleID: Int64?
    let enabled: Bool
}

#if DEBUG
    #Preview("Loaded — no selection") {
        RedisSignalViewerPage(model: RedisSignalViewerPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty vehicles") {
        RedisSignalViewerPage(
            model: RedisSignalViewerPageModel(vehicleSource: PreviewEmptyRedisVehicles())
        )
        .teslaSyncTheme()
    }

    #Preview("Vehicles error") {
        RedisSignalViewerPage(
            model: RedisSignalViewerPageModel(vehicleSource: PreviewFailingRedisVehicles())
        )
        .teslaSyncTheme()
    }

    /// Preview seam yielding no vehicles (drives the controls empty state).
    private struct PreviewEmptyRedisVehicles: RedisSignalViewerVehicleSource {
        func loadVehicles() async throws -> [RedisSignalVehicle] {
            []
        }
    }

    /// Preview seam that fails (drives the controls error state).
    private struct PreviewFailingRedisVehicles: RedisSignalViewerVehicleSource {
        struct Failure: Error {}
        func loadVehicles() async throws -> [RedisSignalVehicle] {
            throw Failure()
        }
    }
#endif
