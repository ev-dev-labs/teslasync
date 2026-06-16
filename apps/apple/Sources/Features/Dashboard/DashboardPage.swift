import SwiftUI

/// Native SwiftUI parity of `web/src/features/dashboard/pages/DashboardPage.tsx` (route `/`).
/// The Command Center: the web page chrome (`PageContainer` title "Command Center" + subtitle,
/// and its loading / error / body phases), the customize/refresh/kiosk/print header actions and
/// the edit-mode undo / redo / add / auto-arrange / templates / reset chrome, the first-run
/// theme banner, the customize-discovery hint, the Tesla-not-connected warning, the onboarding
/// empty (its hero + feature `GlassPanel`s), and — once vehicles resolve — the configurable
/// widget grid and the kiosk overlay. Every data state the source produces is implemented
/// (loading / error / success, the latter splitting into onboarding vs. populated); no region
/// is ever hidden behind a null check.
///
/// Adaptive (ADR-002/006): the content column caps its width and centres on macOS / iPad
/// regular width and fills the compact iPhone width, with the banners and tile grid reflowing.
/// All copy resolves from `Localizable.xcstrings` with the web key names; data binds through the
/// `@Observable` `DashboardPageModel` (no networking in the view). Auth status drives the
/// onboarding branch + warning; the sync action refreshes the garage (web `useSyncVehicles`).
public struct DashboardPage: View {
    @State private var model: DashboardPageModel
    @State private var showResetConfirm = false
    @State private var showTemplates = false
    @State private var showAddWidget = false

    /// Navigates the app shell to a route (web `<Link>` / widget drill-through). Injected by the
    /// route registration; a no-op default keeps previews / tests self-contained.
    private let onNavigate: (AppRoute) -> Void

    /// Triggers the app's print/snapshot command (web `PrintButton`). Injected by registration.
    private let onPrint: () -> Void

    /// Opens the theme picker (web `open-theme-popover` event). Injected by registration.
    private let onOpenThemePicker: () -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(
        model: DashboardPageModel,
        onNavigate: @escaping (AppRoute) -> Void = { _ in },
        onPrint: @escaping () -> Void = {},
        onOpenThemePicker: @escaping () -> Void = {}
    ) {
        _model = State(initialValue: model)
        self.onNavigate = onNavigate
        self.onPrint = onPrint
        self.onOpenThemePicker = onOpenThemePicker
    }

    public var body: some View {
        ScrollView {
            content
                .frame(maxWidth: 1100)
                .frame(maxWidth: .infinity)
                .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("title"))
        .toolbar { headerActions }
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading else { return }
            await model.load()
        }
        .task(id: hintGateActive) { await runCustomizeHintTimer() }
        .confirmationDialog("dashboard.reset", isPresented: $showResetConfirm, titleVisibility: .visible) {
            Button("dashboard.reset", role: .destructive) { model.resetToDefault() }
        } message: {
            Text("layout.resetMessage")
        }
        .confirmationDialog("dashboard.templates", isPresented: $showTemplates, titleVisibility: .visible) {
            Button("dashboard.newDashboard") { model.newBlankDashboard() }
        }
        .sheet(isPresented: $showAddWidget) {
            DashboardAddWidgetSheet(model: model, onClose: { showAddWidget = false })
        }
        .overlay {
            if model.isKiosk {
                DashboardKioskOverlay(
                    widgets: model.layout,
                    vehicleName: vehicleName,
                    onExit: { model.exitKiosk() }
                )
            }
        }
    }

    // MARK: - Top-level phase switch (web PageContainer phases)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            DashboardSkeleton()
        case .error:
            DashboardErrorRegion(onRetry: { Task { await model.refresh() } })
                .frame(maxWidth: .infinity)
        case .ready:
            readyBody
        }
    }

    // MARK: - Ready body (web header + banners + onboarding / grid)

    private var readyBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            header
            banners
            if model.showsOnboarding {
                DashboardOnboarding(
                    authenticated: model.isAuthenticated,
                    isSyncing: model.isSyncing,
                    onSync: { Task { await model.sync() } },
                    onConnect: { onNavigate(.settings) }
                )
                .frame(maxWidth: .infinity)
            } else {
                populatedDashboard
            }
        }
    }

    /// Web `PageContainer` title "Command Center" + subtitle "Real-time fleet intelligence…".
    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text("title")
                .font(Font.TS.display).foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text("subtitle")
                .font(Font.TS.body).foregroundStyle(Color.TS.textSecondary)
        }
    }

    @ViewBuilder
    private var banners: some View {
        if model.showsThemeBanner {
            DashboardThemeBanner(
                onOpenPicker: { onOpenThemePicker(); model.dismissThemeBanner() },
                onDismiss: { model.dismissThemeBanner() }
            )
        }
        if model.isStale {
            TSLiveStaleDataBanner()
        }
        if model.showsCustomizeHint {
            DashboardCustomizeHintBanner(
                onAddWidgets: { showAddWidget = true; model.dismissCustomizeHint() },
                onDismiss: { model.dismissCustomizeHint() }
            )
        }
        if model.showsAuthWarning {
            DashboardAuthBanner(onOpenSettings: { onNavigate(.settings) })
        }
    }

    private var populatedDashboard: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.editMode {
                DashboardEditHint()
            }
            if model.layout.isEmpty {
                DashboardEmptyLayout(onAddWidget: { showAddWidget = true })
            } else {
                DashboardWidgetGrid(
                    widgets: model.layout,
                    editMode: model.editMode,
                    vehicleName: vehicleName,
                    onOpen: { onNavigate($0.route) },
                    onRemove: { model.removeWidget($0) }
                )
            }
        }
    }

    // MARK: - Header actions (web `headerActions`)

    @ToolbarContentBuilder
    private var headerActions: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            if model.editMode {
                editModeActions
            } else {
                viewModeActions
            }
        }
    }

    @ViewBuilder
    private var editModeActions: some View {
        Button(action: { model.undo() }, label: { Image(systemName: "arrow.uturn.backward") })
            .disabled(!model.canUndo)
            .accessibilityLabel(Text("dashboard.undo"))
        Button(action: { model.redo() }, label: { Image(systemName: "arrow.uturn.forward") })
            .disabled(!model.canRedo)
            .accessibilityLabel(Text("dashboard.redo"))
        Button(action: { showAddWidget = true }, label: {
            Label("dashboard.addWidget", systemImage: "plus")
        })
        Button(action: { model.autoArrange() }, label: {
            Label("dashboard.autoArrange", systemImage: "square.grid.2x2")
        })
        Button(action: { showTemplates = true }, label: {
            Label("dashboard.templates", systemImage: "rectangle.on.rectangle")
        })
        Button(action: { showResetConfirm = true }, label: {
            Label("dashboard.reset", systemImage: "arrow.counterclockwise")
        })
        Button(action: { model.setEditMode(false) }, label: { Text("dashboard.done") })
    }

    @ViewBuilder
    private var viewModeActions: some View {
        Button(action: { Task { await model.refresh() } }, label: { Image(systemName: "arrow.clockwise") })
            .accessibilityLabel(Text("dashboard.refresh"))
        Button(action: { model.enterKiosk() }, label: {
            Label("dashboard.kiosk", systemImage: "tv")
        })
        Button(action: onPrint, label: {
            Label("dashboard.printSnapshot", systemImage: "printer")
        })
        Button(action: { model.setEditMode(true) }, label: {
            Label("dashboard.customize", systemImage: "slider.horizontal.3")
        })
    }

    // MARK: - Derivations

    /// The resolved name of the first synced vehicle (web `vehicle.display_name || model`).
    private var vehicleName: String? {
        model.vehicles.first?.resolvedName
    }

    /// True while the soft customize hint is eligible to appear (web `isOnlyDefault && !hintDismissed
    /// && !editMode`); drives the 5s discovery timer.
    private var hintGateActive: Bool {
        !model.showsOnboarding
            && model.isOnlyDefaultLayout
            && !model.customizeHintDismissed
            && !model.editMode
            && model.phase == .ready
    }

    /// Web `CUSTOMIZE_HINT_DELAY_MS` (5s) timer that surfaces the hint once eligible.
    private func runCustomizeHintTimer() async {
        guard hintGateActive else { return }
        try? await Task.sleep(for: .seconds(5))
        guard !Task.isCancelled, hintGateActive else { return }
        model.markCustomizeHintReady()
    }
}

#if DEBUG
    #Preview("Success · populated") {
        NavigationStack {
            DashboardPage(model: DashboardPageModel())
                .teslaSyncTheme()
        }
    }

    #Preview("Onboarding · sync") {
        NavigationStack {
            DashboardPage(model: DashboardPageModel(dataSource: SyncNeededDashboardDataSource()))
                .teslaSyncTheme()
        }
    }

    #Preview("Onboarding · connect") {
        NavigationStack {
            DashboardPage(model: DashboardPageModel(dataSource: NotConnectedDashboardDataSource()))
                .teslaSyncTheme()
        }
    }

    #Preview("Error") {
        NavigationStack {
            DashboardPage(model: DashboardPageModel(dataSource: FailingDashboardDataSource()))
                .teslaSyncTheme()
        }
    }
#endif
