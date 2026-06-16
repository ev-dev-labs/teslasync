import SwiftUI

/// Entry point for the TeslaSync native client.
///
/// A single SwiftUI `App` drives both the iOS/iPadOS and macOS targets
/// (adaptive layout, ADR-002). The window roots in `RootView`, the authentication
/// gate (P4/P5): it shows onboarding/sign-in until a session exists, then mounts
/// the navigation shell. The shared `AuthCoordinator` is owned here so its state
/// outlives any individual screen.
@main
struct TeslaSyncApp: App {
    #if os(iOS)
        @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
    #elseif os(macOS)
        @NSApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
    #endif

    @State private var selection: AppRoute? = .dashboard
    @State private var auth: AuthCoordinator
    @State private var settingsModel: AppSettingsModel
    @State private var commandActions = AppCommandActions()
    @State private var commanding: any VehicleCommanding = UnavailableVehicleCommanding()

    init() {
        let coordinator = AuthCoordinator.bootstrap()
        _auth = State(initialValue: coordinator)
        _settingsModel = State(initialValue: AppSettingsModel(
            biometric: coordinator,
            onClearCache: {
                WidgetSnapshotStore().clear()
                RecentRoutesStore().clear()
                VehicleDirectoryStore().clear()
            }
        ))
    }

    private var isLiveDemo: Bool {
        ProcessInfo.processInfo.arguments.contains("-uiTestLiveDemo")
    }

    private var isPushDemo: Bool {
        ProcessInfo.processInfo.arguments.contains("-uiTestPushDemo")
    }

    var body: some Scene {
        WindowGroup {
            rootContent
        }
        .commands {
            AppCommands(selection: $selection)
            AppMenuCommands(selection: $selection, actions: commandActions)
        }
        #if os(macOS)
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified)
        #endif

        #if os(macOS)
            TeslaSyncSettingsScene(model: settingsModel, onOpenNotifications: { selection = .notifications })
        #endif
    }

    @ViewBuilder private var rootContent: some View {
        if isPushDemo {
            PushDemoView()
                .teslaSyncTheme()
        } else if isLiveDemo {
            LiveDemoView()
                .teslaSyncTheme()
        } else {
            RootView(coordinator: auth, selection: $selection)
                .environment(\.routeHosts, routeHostRegistry)
                .platformIntegration(selection: $selection, settingsModel: settingsModel, onCommand: runCommand)
                .commandActionsPresentation(commandActions)
                .task {
                    connectPush()
                    configureCommandActions()
                    syncIntentMirror()
                }
                .onChange(of: auth.state) { _, _ in syncIntentMirror() }
                .onChange(of: pushDelegate.runtime.coordinator?.pendingRoute) { _, route in
                    if let route {
                        selection = route
                        _ = pushDelegate.runtime.consumePendingRoute()
                    }
                }
                .onOpenURL { url in
                    if let route = AppRouteParser.parse(url: url) {
                        selection = route
                    }
                }
        }
    }

    /// Builds the route → page-view registry the shell renders from, threading one shared
    /// base through every P7 page registration (each registers its own route, so order is
    /// irrelevant). Flattened from a deeply-nested call chain so adding a registration never
    /// breaches the line-length budget.
    @MainActor private var routeHostRegistry: AppRouteHostRegistry {
        var registry = SettingsRouteRegistration.registry(
            model: settingsModel,
            onOpenNotifications: { selection = .notifications }
        )
        registry = ApiPlaygroundRouteRegistration.registry(base: registry)
        registry = DiskForecastRouteRegistration.registry(base: registry)
        registry = FleetTelemetryCoverageRouteRegistration.registry(base: registry)
        registry = SchemaDriftRouteRegistration.registry(base: registry)
        registry = SlowQueriesRouteRegistration.registry(base: registry)
        registry = SecretRotationRouteRegistration.registry(base: registry)
        registry = VehicleCostRouteRegistration.registry(base: registry)
        registry = LiveSignalInspectorRouteRegistration.registry(base: registry)
        registry = RedisSignalViewerRouteRegistration.registry(base: registry)
        registry = TeslaOrdersRouteRegistration.registry(base: registry)
        registry = TeslaRegionRouteRegistration.registry(base: registry)
        registry = FleetCompareRouteRegistration.registry(base: registry, onNavigate: { selection = $0 })
        registry = StatisticsRouteRegistration.registry(base: registry)
        // Fleet Analytics is the canonical `.analytics` owner (its `pathSegment` is `/analytics` and
        // it is a primary tab); registered after Statistics — which aliases onto the route via
        // `/statistics` — so the primary tab + `/analytics` deep link render the Fleet Analytics page.
        registry = AnalyticsRouteRegistration.registry(base: registry, onNavigate: { selection = $0 })
        registry = TimelineRouteRegistration.registry(base: registry)
        registry = LifetimeStatsRouteRegistration.registry(base: registry)
        registry = MileageRouteRegistration.registry(base: registry)
        registry = TrueCostRouteRegistration.registry(base: registry)
        registry = BatteryCellsRouteRegistration.registry(base: registry)
        registry = BatteryDegradationRouteRegistration.registry(base: registry)
        registry = SleepEfficiencyRouteRegistration.registry(base: registry)
        registry = DriveScoreRouteRegistration.registry(base: registry)
        registry = PowershareRouteRegistration.registry(base: registry)
        registry = GlanceRouteRegistration.registry(base: registry, onOpenApp: { selection = .dashboard })
        registry = AutomationsListRouteRegistration.registry(base: registry)
        registry = AutomationListRouteRegistration.registry(base: registry, onNavigate: { selection = $0 })
        registry = AuditLogRouteRegistration.registry(base: registry)
        registry = FeatureFlagsRouteRegistration.registry(base: registry)
        registry = DLQInspectorRouteRegistration.registry(base: registry)
        registry = IngestXRayRouteRegistration.registry(base: registry)
        registry = FeedbackQueueRouteRegistration.registry(base: registry)
        registry = ApiLogsRouteRegistration.registry(base: registry)
        registry = LiveLogsRouteRegistration.registry(base: registry)
        registry = FleetAPIRouteRegistration.registry(base: registry)
        registry = DevToolsRouteRegistration.registry(base: registry)
        registry = APIKeysRouteRegistration.registry(base: registry)
        registry = GDPRExportRouteRegistration.registry(base: registry)
        registry = RbacMatrixRouteRegistration.registry(base: registry)
        registry = UsersRouteRegistration.registry(base: registry)
        registry = SystemRouteRegistration.registry(base: registry)
        registry = GasPriceAutoPollRouteRegistration.registry(base: registry)
        registry = TeslaFeatureFlagsRouteRegistration.registry(base: registry)
        registry = BackupRestoreRouteRegistration.registry(base: registry)
        return registry
    }

    /// Wires the menu/command hub to the app's command executor + refresh signals.
    private func configureCommandActions() {
        commandActions.onRefresh = {
            NotificationCenter.default.post(name: .teslaSyncRefreshRequested, object: nil)
        }
        commandActions.onPrint = {
            NotificationCenter.default.post(name: .teslaSyncPrintRequested, object: nil)
        }
        commandActions.onRunCommand = { kind in
            runCommand(VehicleCommandRequest(kind: kind))
        }
    }

    /// Executes a (confirmed) vehicle command via the injected commander and
    /// surfaces the outcome. The default commander reports `.unavailable` until the
    /// command facade is wired (P7) — never a silent success.
    private func runCommand(_ request: VehicleCommandRequest) {
        Task { @MainActor in
            commandActions.lastOutcome = await commanding.perform(request)
        }
    }

    /// Mirrors the non-sensitive auth flag to the App Group (for out-of-process
    /// intent gating) and to the command menu's enablement.
    private func syncIntentMirror() {
        let authenticated = auth.state.showsAppContent
        IntentBridge.shared.setAuthenticated(authenticated)
        commandActions.isAuthenticated = authenticated
    }

    /// Wires the push runtime to the app's auth + API base URL once at launch. The
    /// base URL comes from the bundle (the macOS-pinned config), mirroring the
    /// facade's bootstrap convention.
    private func connectPush() {
        let configured = Bundle.main.object(forInfoDictionaryKey: "TeslaSyncAPIBaseURL") as? String
        let baseURL = URL(string: configured ?? "https://teslasync.local") ?? URL(fileURLWithPath: "/")
        pushDelegate.runtime.connect(auth: auth, baseURL: baseURL)
    }
}
