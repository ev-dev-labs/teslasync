using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Auth;
using TeslaSync.App.Auth.Onboarding;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Lifecycle;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Settings;
using TeslaSync.App.Core.Theme;
using TeslaSync.App.Notifications;
using TeslaSync.App.Platform.Lifecycle;
using TeslaSync.App.Push;
using TeslaSync.App.Settings;
using Windows.Graphics;
using Windows.System;
using Windows.UI.ViewManagement;

namespace TeslaSync.App.Shell;

/// <summary>
/// The application's top-level navigation shell (P2/W3-0001). Hosts a grouped WinUI
/// <see cref="NavigationView"/> built from the typed <see cref="RouteRegistry"/>, a
/// custom Mica-backed title bar (ExtendsContentIntoTitleBar via the window
/// <see cref="Microsoft.UI.Windowing.AppWindow"/>), breadcrumb + title chrome, a
/// status bar, keyboard back/forward accelerators, search, deep-link activation and
/// persisted window state. Page bodies are out of scope: routes without a generated
/// W7 page resolve to a <see cref="RoutePendingView"/> through the shell page factory.
/// </summary>
public sealed partial class ShellWindow : Window
{
    private readonly ShellViewModel _viewModel = new();
    private readonly WindowStateService _windowState = new();
    private readonly Dictionary<string, NavigationViewItem> _navItems = new(StringComparer.Ordinal);
    private readonly TsTeslaReauthBanner _authBanner = new();
    private readonly TsAlertBanner _pushBanner = new() { IsOpen = false, Dismissible = true };

    private ElementTheme _theme = ElementTheme.Default;
    private AccessibilitySettings? _accessibility;
    private bool _navigating;
    private string? _pendingProtectedPath;
    private bool _startupRouteApplied;

    public ShellWindow()
    {
        InitializeComponent();

        SystemBackdrop = new MicaBackdrop();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBarDragRegion);

        ShellBreadcrumbs.ItemsSource = _viewModel.Breadcrumbs;
        SearchBox.PlaceholderText = Localization.Get("shell.search.placeholder", "Search"); // parity:allow PlaceholderText is the WinUI hint API

        // Onboarding (P2/W7) — parity port of web OnboardingPage (the first-run setup checklist) at route /onboarding.
        // The Windows shell also uses this public route as the signed-out auth gate (P2/W4-0001), so the factory
        // renders the W7 checklist for an authenticated operator (web /onboarding = the checklist, shown post-auth)
        // and keeps the W4 sign-in surface while signed out (the only interactive sign-in entry point). The
        // checklist's internal CTAs (Connect Tesla account, footer account link, Skip, Continue) navigate via
        // NavigationRequested; its documentation links open in the browser via DocumentationRequested.
        _viewModel.PageFactory.Register("Onboarding", () =>
        {
            if (!AppAuth.IsAuthenticated)
            {
                return new OnboardingView();
            }

            var page = new FeatureViews.Onboarding.OnboardingPage();
            page.NavigationRequested += (_, route) => NavigateTo(route);
            page.DocumentationRequested += (_, path) => OpenDocumentation(path);
            return page;
        });

        // Dashboard / Command Center page (P2/W7) — parity port of web DashboardPage at the index route /.
        // The onboarding "Connect Tesla Account" action and the account-warning Settings link navigate to /settings.
        _viewModel.PageFactory.Register("Dashboard", () =>
        {
            var page = new FeatureViews.Dashboard.DashboardPage();
            page.NavigationRequested += (_, route) => NavigateTo(route);
            return page;
        });

        // Dashboard / Glance page (P2/W7) — parity port of web GlancePage at route /glance (group Dashboard/Explore).
        // RouteTable already maps Standalone("Glance","glance",RouteGroup.DashboardExplore). The "Open full app" link
        // navigates home (the Dashboard index route).
        _viewModel.PageFactory.Register("Glance", () =>
        {
            var page = new FeatureViews.Dashboard.GlancePage();
            page.NavigationRequested += (_, route) => NavigateTo(route);
            return page;
        });

        // Battery / Energy page (P2/W7) — parity port of web EnergyPage at route /energy.
        _viewModel.PageFactory.Register("Energy", static () => new FeatureViews.Battery.EnergyPage());

        // Admin / API Logs page (P2/W7) — parity port of web ApiLogsPage at route /api-logs.
        _viewModel.PageFactory.Register("ApiLogs", static () => new FeatureViews.Admin.ApiLogsPage());

        // Admin / Audit Log page (P2/W7) — parity port of web AuditLogPage at route /admin/audit-log.
        // RouteTable already maps Page("AuditLog","admin/audit-log",RouteGroup.AdminDevTools).
        _viewModel.PageFactory.Register("AuditLog", static () => new FeatureViews.Admin.AuditLogPage());

        // Admin / API Playground page (P2/W7) — parity port of web ApiPlaygroundPage at route /api-playground.
        // RouteTable already maps Page("ApiPlayground","api-playground",RouteGroup.AdminDevTools).
        _viewModel.PageFactory.Register("ApiPlayground", static () => new FeatureViews.Admin.ApiPlaygroundPage());

        // Admin / Fleet API page (P2/W7) — parity port of web FleetAPIPage at route /fleet-api.
        // RouteTable already maps Page("FleetAPI","fleet-api",RouteGroup.AdminDevTools).
        _viewModel.PageFactory.Register("FleetAPI", static () => new FeatureViews.Admin.FleetAPIPage());

        // Admin / API Keys page (P2/W7) — parity port of web APIKeysPage at route /api-keys.
        // RouteTable already maps Page("APIKeys","api-keys",RouteGroup.AdminDevTools).
        _viewModel.PageFactory.Register("APIKeys", static () => new FeatureViews.Admin.APIKeysPage());

        // Admin / GDPR Export page (P2/W7) — parity port of web GDPRExportPage at route /admin/gdpr-exports.
        // RouteTable already maps Page("GDPRExport","admin/gdpr-exports",RouteGroup.AdminDevTools).
        _viewModel.PageFactory.Register("GDPRExport", static () => new FeatureViews.Admin.GDPRExportPage());

        // Admin / DevTools page (P2/W7) — parity port of web DevToolsPage at route /dev-tools.
        // RouteTable already maps Page("DevTools","dev-tools",RouteGroup.AdminDevTools). The page is a thin shell:
        // a header (title/subtitle) over a five-tab navigator mounting the Fleet API, Telemetry, Infrastructure,
        // Utilities and Reference sections in the web order.
        _viewModel.PageFactory.Register("DevTools", static () => new FeatureViews.Admin.DevToolsPage());

        // Admin / Gas Price Auto-Poll page (P2/W7) — parity port of web GasPriceAutoPollPage at route /gas-price.
        // RouteTable already maps Page("GasPriceAutoPoll","gas-price",RouteGroup.AdminDevTools).
        _viewModel.PageFactory.Register("GasPriceAutoPoll", static () => new FeatureViews.Admin.GasPriceAutoPollPage());

        // Admin / Tesla Orders page (P2/W7) — parity port of web TeslaOrdersPage at route /tesla-orders.
        // RouteTable already maps Page("TeslaOrders","tesla-orders",RouteGroup.AdminDevTools). The page is a thin
        // wrapper: a PageContainer header (orders.title / orders.subtitle) over the shared ActiveOrdersSection.
        _viewModel.PageFactory.Register("TeslaOrders", static () => new FeatureViews.Admin.TeslaOrdersPage());

        // Telemetry / Signals workspace page (P2/W7) — parity port of web SignalsWorkspacePage at route /signals.
        _viewModel.PageFactory.Register("SignalsWorkspace", static () => new FeatureViews.Telemetry.SignalsWorkspacePage());

        // Admin / Redis Signal Viewer page (P2/W7) — parity port of web RedisSignalViewerPage at route /redis-signals.
        // RouteTable already maps Page("RedisSignalViewer","redis-signals",RouteGroup.TelemetrySignals).
        _viewModel.PageFactory.Register("RedisSignalViewer", static () => new FeatureViews.Admin.RedisSignalViewerPage());

        // Admin / Feedback queue page (P2/W7) — parity port of web FeedbackQueuePage at route /admin/feedback.
        _viewModel.PageFactory.Register("FeedbackQueue", static () => new FeatureViews.Admin.FeedbackQueuePage());

        // System / Command history page (P2/W7) — parity port of web CommandHistoryPage at route /command-history.
        // The "Commands" back-link navigates to the Commands route.
        _viewModel.PageFactory.Register("CommandHistory", () =>
        {
            var page = new FeatureViews.SystemOps.CommandHistoryPage();
            page.NavigationRequested += (_, route) => NavigateTo(route);
            return page;
        });
        // System / My Activity page (P2/W7) — parity port of web MyActivityPage at route /me/activity.
        _viewModel.PageFactory.Register("MyActivity", static () => new FeatureViews.SystemOps.MyActivityPage());

        // Telemetry / Signal Log Viewer page (P2/W7) — parity port of web SignalLogViewerPage at route /signal-log.
        _viewModel.PageFactory.Register("SignalLogViewer", static () => new FeatureViews.Telemetry.SignalLogViewerPage());

        // Notifications / Alert rules page (P2/W7) — parity port of web AlertRulesPage at route /notifications/rules.
        // The rule-name links and the "Open Alert Studio" affordances navigate to the studio route.
        _viewModel.PageFactory.Register("NotificationsRules", () =>
        {
            var page = new FeatureViews.Notifications.AlertRulesPage();
            page.NavigationRequested += (_, route) => NavigateTo(route);
            return page;
        });

        // Vehicles / Vehicle Access page (P2/W7) — parity port of web VehicleAccessPage at route
        // /vehicles/:id/access. The route id is read from the live match and feeds the drivers + invitations
        // queries (web enabled: !!vehicleId).
        _viewModel.PageFactory.Register("VehicleAccess", () =>
            new FeatureViews.Vehicles.VehicleAccessPage(_viewModel.Current.Param("id")));

        // Admin / Schema drift page (P2/W7) — parity port of web SchemaDriftPage at route /admin/schema-drift.
        _viewModel.PageFactory.Register("SchemaDrift", static () => new FeatureViews.Admin.SchemaDriftPage());

        // Admin / DLQ Inspector page (P2/W7) — parity port of web DLQInspectorPage at route /admin/dlq.
        _viewModel.PageFactory.Register("DLQInspector", static () => new FeatureViews.Admin.DLQInspectorPage());

        // Admin / Live Signal Inspector page (P2/W7) — parity port of web LiveSignalInspectorPage at route
        // /admin/live-signals. RouteTable already maps Page("LiveSignalInspector","admin/live-signals",
        // RouteGroup.AdminDevTools). The vehicle picker (web useVehicles) drives the page-local scope; the
        // per-second live snapshot (web useVehicleLiveSignals) is owned by the composed LiveSignalsTable.
        _viewModel.PageFactory.Register("LiveSignalInspector", static () => new FeatureViews.Admin.LiveSignalInspectorPage());
        // Admin / Ingest X-Ray page (P2/W7) — parity port of web IngestXRayPage at route /admin/ingest-xray.
        // RouteTable already maps Page("IngestXRay","admin/ingest-xray",RouteGroup.AdminDevTools).
        _viewModel.PageFactory.Register("IngestXRay", static () => new FeatureViews.Admin.IngestXRayPage());

        // Admin / Feature Flags page (P2/W7) — parity port of web FeatureFlagsPage at route /admin/flags.
        // RouteTable already maps Page("FeatureFlagsAdmin","admin/flags",RouteGroup.AdminDevTools).
        _viewModel.PageFactory.Register("FeatureFlagsAdmin", static () => new FeatureViews.Admin.FeatureFlagsPage());

        // Admin / RBAC matrix page (P2/W7) — parity port of web RbacMatrixPage. Unrouted in web App.tsx; reachable
        // here as a deep link. RouteTable maps Hidden("RbacMatrix","admin/rbac",RouteGroup.AdminDevTools).
        _viewModel.PageFactory.Register("RbacMatrix", static () => new FeatureViews.Admin.RbacMatrixPage());

        // Admin / Users (Subjects) page (P2/W7) — parity port of web UsersPage (the impersonation target picker).
        // The web page ships unrouted (no routeRegistry entry — an importable-but-unrouted symbol); there is likewise
        // no RouteTable entry, so this registration is a latent page-factory seam mirroring the web's wired-but-unrouted
        // state (the same approach as the Diagnostic registration below).
        _viewModel.PageFactory.Register("Users", static () => new FeatureViews.Admin.UsersPage());

        // System / DB Health page (P2/W7) — parity port of web DBHealthPage at route /db-health (group Diagnostics).
        _viewModel.PageFactory.Register("DBHealthDashboard", static () => new FeatureViews.Diagnostics.DBHealthPage());
        // System / Diagnostic page (P2/W7) — parity port of web DiagnosticPage (the operator self-test wizard). The web
        // page is unrouted; the shell registers it under the "Diagnostic" page-factory seam so a deep link can resolve
        // the native surface (ADR-002).
        _viewModel.PageFactory.Register("Diagnostic", static () => new FeatureViews.SystemDiagnostics.DiagnosticPage());

        // Admin / Vehicle cost page (P2/W7) — parity port of web VehicleCostPage at route /admin/vehicle-cost.
        _viewModel.PageFactory.Register("VehicleCost", static () => new FeatureViews.Admin.VehicleCostPage());
        // Vehicle systems / Maintenance page (P2/W7) — parity port of web MaintenancePage at route /maintenance.
        _viewModel.PageFactory.Register("Maintenance", static () => new FeatureViews.VehicleSystems.MaintenancePage());
        // Vehicles / Digital Twin page (P2/W7) — parity port of web DigitalTwinPage at route /digital-twin.
        _viewModel.PageFactory.Register("DigitalTwin", static () => new FeatureViews.Vehicles.DigitalTwinPage());
        // Battery / Energy flow page (P2/W7) — parity port of web EnergyFlowPage at route /energy-flow.
        _viewModel.PageFactory.Register("EnergyFlow", static () => new FeatureViews.Battery.EnergyFlowPage());
        // Battery / Power flow dashboard (P2/W7) — parity port of web PowerFlowDashboardPage at route /power-flow.
        // RouteTable already maps Page("PowerFlowDashboard","power-flow",RouteGroup.BatteryEnergy).
        _viewModel.PageFactory.Register("PowerFlowDashboard", static () => new FeatureViews.Battery.PowerFlowDashboardPage());
        // Battery / Energy products page (P2/W7) — parity port of web EnergyProductsPage at route /energy-products.
        _viewModel.PageFactory.Register("EnergyProducts", static () => new FeatureViews.Battery.EnergyProductsPage());
        // Analytics / Timeline page (P2/W7) — parity port of web TimelinePage at route /timeline.
        _viewModel.PageFactory.Register("Timeline", static () => new FeatureViews.Analytics.TimelinePage());
        // Analytics / True Cost of Ownership page (P2/W7) — parity port of web TrueCostPage at route /analytics/tco.
        _viewModel.PageFactory.Register("TrueCostOwnership", static () => new FeatureViews.Analytics.TrueCostPage());
        // Analytics / Weekly digest page (P2/W7) — parity port of web WeeklyDigestPage at route /weekly-digest.
        _viewModel.PageFactory.Register("WeeklyDigest", static () => new FeatureViews.Analytics.WeeklyDigestPage());
        // Analytics / Fleet Comparison page (P2/W7) — parity port of web FleetComparePage at route
        // /vehicle-comparison (RouteTable Page("FleetCompare","vehicle-comparison",Analytics)). The
        // single-vehicle empty-state CTA navigates to /vehicles; the disambiguation banner opens /period-compare.
        _viewModel.PageFactory.Register("FleetCompare", () =>
        {
            var page = new FeatureViews.Analytics.FleetComparePage();
            page.NavigationRequested += (_, route) => NavigateTo(route);
            return page;
        });
        // Analytics / Statistics page (P2/W7) — parity port of web StatisticsPage at route /statistics. RouteTable
        // already maps Page("Statistics","statistics",RouteGroup.Analytics). The default empty-source ctor renders
        // the page-level empty state until a DI host wires the generated-client-backed StatisticsSource.
        _viewModel.PageFactory.Register("Statistics", static () => new FeatureViews.Analytics.StatisticsPage());
        // Analytics / Period comparison page (P2/W7) — parity port of web PeriodComparePage at route /period-compare.
        _viewModel.PageFactory.Register("PeriodCompare", static () => new FeatureViews.Analytics.PeriodComparePage());
        // Charging / Cost analysis page (P2/W7) — parity port of web CostAnalysisPage at route /charging/costs.
        _viewModel.PageFactory.Register("CostAnalysis", static () => new FeatureViews.Charging.CostAnalysisPage());

        // Analytics / Year-in-Review story player (P2/W7) — parity port of web YearReviewPage at route
        // /year-review/:year. The route year is read from the live match and close/Esc maps to back-navigation
        // (web navigate(-1)).
        _viewModel.PageFactory.Register("YearReview", () =>
        {
            var page = new FeatureViews.Review.YearReviewPage(ParseYearParam(_viewModel.Current.Param("year")));
            page.CloseRequested += (_, _) => GoBack();
            return page;
        });

        // Automations / list page (P2/W7) — parity port of web AutomationListPage at route /automations/list.
        _viewModel.PageFactory.Register("AutomationList", () =>
        {
            var page = new FeatureViews.Automations.AutomationListPage();
            page.NavigationRequested += (_, e) => NavigateTo(e.Route);
            return page;
        });

        // Automations hub page (P2/W7) — parity port of web AutomationsListPage at route /automations.
        _viewModel.PageFactory.Register("Automations", () =>
        {
            var page = new FeatureViews.Automations.AutomationsListPage();
            page.NavigationRequested += (_, e) => NavigateTo(e.Path);
            return page;
        });

        // Automations / AutomationBuilder page (P2/W7) — parity port of web AutomationBuilderPage at routes
        // automations/new + automations/:id/edit.
        _viewModel.PageFactory.Register("AutomationBuilder", static () => new FeatureViews.Automations.AutomationBuilderPage());
        // Battery / Degradation page (P2/W7) — parity port of web BatteryDegradationPage at route /battery-degradation.
        _viewModel.PageFactory.Register("BatteryDegradation", static () => new FeatureViews.Battery.BatteryDegradationPage());
        // Battery / Cells page (P2/W7) — parity port of web BatteryCellsPage at route /battery-cells.
        _viewModel.PageFactory.Register("BatteryCells", static () => new FeatureViews.Battery.BatteryCellsPage());
        // Battery / Health page (P2/W7) — parity port of web BatteryHealthPage at route /battery (hidden alias
        // battery/health). The quick-link tiles raise NavigationRequested with a route the shell resolves.
        _viewModel.PageFactory.Register("BatteryHealth", () =>
        {
            var page = new FeatureViews.Battery.BatteryHealthPage();
            page.NavigationRequested += (_, route) => NavigateTo(route);
            return page;
        });
        // Battery / Sleep Efficiency page (P2/W7) — parity port of web SleepEfficiencyPage at route /sleep-efficiency.
        _viewModel.PageFactory.Register("SleepEfficiency", static () => new FeatureViews.Battery.SleepEfficiencyPage());
        // Vehicle Systems / Safety Settings page (P2/W7) — parity port of web SafetySettingsPage at route /safety-settings.
        _viewModel.PageFactory.Register("SafetySettings", static () => new FeatureViews.VehicleSystems.SafetySettingsPage());
        // Battery / Projected Range page (P2/W7) — parity port of web ProjectedRangePage at route /analytics/range
        // (visible nav item /projected-range; /analytics/range is the hidden deep-link alias). Both resolve to the
        // "ProjectedRange" route name.
        _viewModel.PageFactory.Register("ProjectedRange", static () => new FeatureViews.Battery.ProjectedRangePage());

        // Vehicles / VehicleDetail page (P2/W7) — parity port of web VehicleDetailPage at route /vehicles/:id.
        // The route vehicle id is read from the live match; the web page has no in-body back affordance (the shell
        // NavigationView owns back navigation), so no BackRequested wiring is needed.
        _viewModel.PageFactory.Register("VehicleDetail", () =>
            new FeatureViews.Vehicles.VehicleDetailPage(ParseSessionId(_viewModel.Current.Param("id"))));
        // Vehicle Systems / Tire Pressure page (P2/W7) — parity port of web TirePressurePage at route
        // /tire-pressure. RouteTable already maps Page("TirePressure","tire-pressure",RouteGroup.VehicleSystems).
        _viewModel.PageFactory.Register("TirePressure", static () => new FeatureViews.VehicleSystems.TirePressurePage());

        // Driving / DriveDetail page (P2/W7) — parity port of web DriveDetailPage at route /drives/:id.
        // The route drive id is read from the live match and the back affordance maps to the drives list.
        _viewModel.PageFactory.Register("DriveDetail", () =>
        {
            var page = new FeatureViews.Driving.DriveDetailPage(ParseSessionId(_viewModel.Current.Param("id")));
            page.BackRequested += (_, _) => NavigateTo("drives");
            return page;
        });

        // Driving / TripReplay page (P2/W7) — parity port of web TripReplayPage at route /drives/:id/replay.
        // The route drive id is read from the live match and the back affordance maps to the drive-detail page.
        _viewModel.PageFactory.Register("TripReplay", () =>
        {
            var page = new FeatureViews.Driving.TripReplayPage(ParseSessionId(_viewModel.Current.Param("id")));
            page.BackRequested += (_, _) =>
            {
                string? driveId = _viewModel.Current.Param("id");
                NavigateTo(string.IsNullOrEmpty(driveId) ? "drives" : $"drives/{driveId}");
            };
            return page;
        });

        // Trips / TripDetail page (P2/W7) — parity port of web TripDetailPage at route /trips/:id.
        // The route trip id is read from the live match; the web page has no in-body back affordance (the shell
        // NavigationView owns back navigation), so no BackRequested wiring is needed.
        _viewModel.PageFactory.Register("TripDetail", () =>
            new FeatureViews.Trips.TripDetailPage(ParseSessionId(_viewModel.Current.Param("id"))));

        // Charging / ChargingList page (P2/W7) — parity port of web ChargingListPage at route /charging
        // (RouteTable Page("Charging","charging",RouteGroup.Charging)). The default empty-source ctor renders the
        // page-level empty state until a DI host wires the generated-client-backed ChargingListSource via
        // ChargingListPage.Create. The ChargeDetail back affordance below navigates here (NavigateTo("charging")).
        _viewModel.PageFactory.Register("Charging", static () => new FeatureViews.Charging.ChargingListPage());

        // Charging / ChargingDetail page (P2/W7) — parity port of web ChargingDetailPage at route /charging/:id.
        // The route session id is read from the live match and the back affordance maps to the charging list.
        _viewModel.PageFactory.Register("ChargeDetail", () =>
        {
            var page = new FeatureViews.Charging.ChargingDetailPage(ParseSessionId(_viewModel.Current.Param("id")));
            page.BackRequested += (_, _) => NavigateTo("charging");
            return page;
        });
        // Charging / Charging Curve page (P2/W7) — parity port of web ChargingCurvePage at route /charging-curve.
        _viewModel.PageFactory.Register("ChargingCurve", static () => new FeatureViews.Charging.ChargingCurvePage());
        // Charging / Charging Heatmap page (P2/W7) — parity port of web ChargingHeatmapPage at route /charging-heatmap.
        _viewModel.PageFactory.Register("ChargingHeatmap", static () => new FeatureViews.Charging.ChargingHeatmapPage());
        // Charging / Powershare page (P2/W7) — parity port of web PowersharePage at route /powershare.
        _viewModel.PageFactory.Register("Powershare", static () => new FeatureViews.Charging.PowersharePage());
        // Charging / Smart Charge page (P2/W7) — parity port of web SmartChargePage at routes /charging/schedule + /smart-charge.
        _viewModel.PageFactory.Register("SmartCharge", static () => new FeatureViews.Charging.SmartChargePage());
        // Charging / Tesla fleet charging sessions page (P2/W7) — parity port of web TeslaChargingSessionsPage at
        // route /tesla-charging-sessions.
        _viewModel.PageFactory.Register("TeslaChargingSessions", static () => new FeatureViews.Charging.TeslaChargingSessionsPage());
        // Charging / Tesla charging history page (P2/W7) — parity port of web TeslaChargingHistoryPage at
        // route /tesla-charging-history.
        _viewModel.PageFactory.Register("TeslaChargingHistory", static () => new FeatureViews.Charging.TeslaChargingHistoryPage());

        // Vehicle systems / Climate Control page (P2/W7) — parity port of web ClimateControlPage at route /climate
        // (nav route "ClimateControl" / "climate-control", hidden alias "climate").
        _viewModel.PageFactory.Register("ClimateControl", static () => new FeatureViews.VehicleSystems.ClimateControlPage());

        // Driving / Trip Planner page (P2/W7) — parity port of web TripPlannerPage at route /trip-planner.
        _viewModel.PageFactory.Register("TripPlanner", static () => new FeatureViews.Driving.TripPlannerPage());

        // Trips / Trip list page (P2/W7) — parity port of web TripListPage at route /trips. The RouteTable
        // already maps Page("Trips","trips",TripsDriving). The default-feed ctor renders the empty state until a
        // DI host supplies the generated-client-backed source via TripListPage.Create.
        _viewModel.PageFactory.Register("Trips", static () => new FeatureViews.Trips.TripListPage());

        // Dashboard / Quick Stats page (P2/W7) — parity port of web QuickStatsPage at route /quick-stats. The
        // footer "Open Dashboard" link navigates to the dashboard root (web Link to="/").
        _viewModel.PageFactory.Register("QuickStats", () =>
        {
            var page = new FeatureViews.Dashboard.QuickStatsPage();
            page.OpenDashboardRequested += (_, _) => NavigateTo(string.Empty);
            return page;
        });
        // Vehicle Systems / Software Updates page (P2/W7) — parity port of web SoftwareUpdatesPage at routes
        // /software-updates + /vehicle-systems/software. RouteTable already maps both to "SoftwareUpdates".
        _viewModel.PageFactory.Register(
            FeatureViews.VehicleSystems.SoftwareUpdatesRegistration.RouteName,
            static () => new FeatureViews.VehicleSystems.SoftwareUpdatesPage());
        // Driving / Efficiency page (P2/W7) — parity port of web EfficiencyPage at route /efficiency.
        _viewModel.PageFactory.Register("Efficiency", static () => new FeatureViews.Driving.EfficiencyPage());
        // Driving / DriveScore page (P2/W7) — parity port of web DriveScorePage at route /drive-score.
        _viewModel.PageFactory.Register("DriveScore", static () => new FeatureViews.Driving.DriveScorePage());
        // Driving / Drivetrain Health page (P2/W7) — parity port of web DrivetrainHealthPage at route /drivetrain-health.
        _viewModel.PageFactory.Register(
            FeatureViews.Driving.DrivetrainHealthRegistration.RouteName,
            static () => new FeatureViews.Driving.DrivetrainHealthPage());
        // Driving / Regen Efficiency page (P2/W7) — parity port of web RegenEfficiencyPage at route /regen-efficiency.
        _viewModel.PageFactory.Register("RegenEfficiency", static () => new FeatureViews.Driving.RegenEfficiencyPage());
        // Driving / Route Efficiency page (P2/W7) — parity port of web RouteEfficiencyPage at route /route-efficiency.
        _viewModel.PageFactory.Register("RouteEfficiency", static () => new FeatureViews.Driving.RouteEfficiencyPage());
        // Driving / Driving Dynamics page (P2/W7) — parity port of web DrivingDynamicsPage at route /driving-dynamics.
        // RouteTable already maps Page("DrivingDynamics","driving-dynamics",TripsDriving). The default-feed ctor renders
        // the loading/empty surfaces until a DI host supplies the generated-client source via DrivingDynamicsPage.Create.
        _viewModel.PageFactory.Register("DrivingDynamics", static () => new FeatureViews.Driving.DrivingDynamicsPage());
        // Analytics / Mileage page (P2/W7) — parity port of web MileagePage at route /mileage.
        _viewModel.PageFactory.Register("Mileage", static () => new FeatureViews.Analytics.MileagePage());
        // Vehicle Systems / Media Player page (P2/W7) — parity port of web MediaPlayerPage at route /media-player.
        _viewModel.PageFactory.Register("MediaPlayer", static () => new FeatureViews.VehicleSystems.MediaPlayerPage());
        // System / Exports page (P2/W7) — parity port of web ExportsPage at route /exports.
        _viewModel.PageFactory.Register("Exports", static () => new FeatureViews.Exports.ExportsPage());
        // System / Scheduled exports panel (P2/W7) — parity port of web ScheduledExportsPanel (mounted on the Data
        // Export page; web is unrouted). Registered as a deep-link-only surface (RouteTable Hidden "scheduled-exports").
        _viewModel.PageFactory.Register("ScheduledExports", static () => new FeatureViews.Exports.ScheduledExportsPanel());
        // System / Commands page (P2/W7) — parity port of web CommandsPage at route /commands. The header
        // "View History" link navigates to the command-history page (web Link to="/command-history").
        _viewModel.PageFactory.Register("Commands", () =>
        {
            var page = new FeatureViews.Commands.CommandsPage();
            page.ViewHistoryRequested += (_, _) => NavigateTo(FeatureViews.Commands.CommandsRegistration.CommandHistoryRoute);
            return page;
        });

        // System / Status API docs page (P2/W7) — parity port of web StatusApiDocsPage at route /docs/status-api.
        // The header "Back to System Status" link navigates to the system-status page (web Link to="/system-status").
        // RouteTable already maps Page("StatusApiDocs","docs/status-api",RouteGroup.SystemOps).
        _viewModel.PageFactory.Register("StatusApiDocs", () =>
        {
            var page = new FeatureViews.SystemOps.StatusApiDocsPage();
            page.NavigationRequested += (_, route) => NavigateTo(route);
            return page;
        });

        // System / Help page (P2/W7) — parity port of web HelpPage (the deterministic RAG-help baseline). The web
        // page is unrouted in App.tsx; the Windows shell exposes it as the hidden "Help" deep-link (RouteTable path
        // `help`). The five curated cards navigate to existing canonical routes (docs/status-api, onboarding,
        // system-status, search, chatbot) via NavigationRequested -> NavigateTo.
        _viewModel.PageFactory.Register("Help", () =>
        {
            var page = new FeatureViews.SystemOps.HelpPage();
            page.NavigationRequested += (_, route) => NavigateTo(route);
            return page;
        });
        // System / Data Export page (P2/W7) — parity port of web DataExportPage at route /data-export.
        _viewModel.PageFactory.Register("DataExport", static () => new FeatureViews.SystemOps.DataExportPage());
        // Maps / Temperature Impact page (P2/W7) — parity port of web TemperatureImpactPage at route /temperature-impact.
        _viewModel.PageFactory.Register("TemperatureImpact", static () => new FeatureViews.Maps.TemperatureImpactPage());
        // Maps / Navigation & Route page (P2/W7) — parity port of web NavigationRoutePage at route /navigation.
        _viewModel.PageFactory.Register(
            FeatureViews.Maps.NavigationRouteRegistration.RouteName,
            static () => new FeatureViews.Maps.NavigationRoutePage());
        // Maps / Locations page (P2/W7) — parity port of web LocationsPage at route /locations. The empty-state
        // "View drives" call-to-action navigates to the drives list (web Link to="/drives").
        _viewModel.PageFactory.Register("Locations", () =>
        {
            var page = new FeatureViews.Maps.LocationsPage();
            page.NavigationRequested += (_, route) => NavigateTo(route);
            return page;
        });
        // Maps / Map Overview (Live Map) page (P2/W7) — parity port of web MapOverviewPage at route /live. The
        // quick links navigate to the navigation-route / geofences / locations routes, and the no-vehicle
        // onboarding call-to-action navigates to onboarding (web Link / navigate targets). RouteTable already
        // maps Page("LiveMap","live",MapsLocation).
        _viewModel.PageFactory.Register("LiveMap", () =>
        {
            var page = new FeatureViews.Maps.MapOverviewPage();
            page.NavigationRequested += (_, route) => NavigateTo(route);
            return page;
        });

        // Maps / Geofences page (P2/W7) — parity port of web GeofencesPage at route /geofences. RouteTable already
        // maps Page("Geofences","geofences",MapsLocation); the page owns its own create/edit + delete dialogs.
        _viewModel.PageFactory.Register("Geofences", static () => new FeatureViews.Maps.GeofencesPage());

        // Notifications / Archived page (P2/W7) — parity port of web ArchivedPage at route /notifications/archived.
        // The header "Back to inbox" action maps to the inbox; the hosted InboxBody's "View context" / empty-state
        // CTA map to the inbox / alert-rule studio (web Link targets). RouteTable already maps
        // Page("NotificationsArchived","notifications/archived",Notifications).
        _viewModel.PageFactory.Register("NotificationsArchived", () =>
        {
            var page = new FeatureViews.Notifications.ArchivedPage();
            page.BackToInboxRequested += (_, _) => NavigateTo(FeatureViews.Notifications.ArchivedRegistration.InboxRoute);
            page.ViewContextRequested += (_, _) => NavigateTo(FeatureViews.Notifications.ArchivedRegistration.InboxRoute);
            page.ConfigureAlertRulesRequested += (_, _) => NavigateTo("notifications/studio");
            return page;
        });
        // Notifications / Channels page (P2/W7) — parity port of web ChannelsPage at route /notifications/channels.
        _viewModel.PageFactory.Register("NotificationsChannels", static () => new FeatureViews.Notifications.ChannelsPage());
        // Notifications / Browser notifications page (P2/W7) — parity port of web BrowserNotificationsPage at route
        // /notifications/browser. The page wraps the shared NotificationSettings surface in a PageContainer
        // (title + subtitle + copy-link), mirroring the web page's thin <PageContainer><NotificationSettings/> shape.
        _viewModel.PageFactory.Register("NotificationsBrowser", static () => new FeatureViews.Notifications.BrowserNotificationsPage());

        // Notifications / Quiet Hours page (P2/W7) — parity port of web QuietHoursPage at route
        // /notifications/quiet-hours. Hosts the deterministic QuietHoursPanel inside the shared PageContainer
        // (title + subtitle + copy-link); RouteTable already maps Page("NotificationsQuietHours","notifications/quiet-hours").
        _viewModel.PageFactory.Register(
            "NotificationsQuietHours",
            static () => new FeatureViews.Notifications.QuietHoursPage());

        // Notifications / Inbox page (P2/W7) — parity port of web InboxPage at route /notifications/inbox. The
        // "View archived" header action navigates to the archived inbox (web Link to /notifications/archived) and
        // the hosted body's empty CTA navigates to the alert studio (web to /notifications/studio).
        _viewModel.PageFactory.Register("NotificationsInbox", () =>
        {
            var page = new FeatureViews.Notifications.InboxPage();
            page.ViewArchivedRequested += (_, _) => NavigateTo("notifications/archived");
            page.ConfigureAlertRulesRequested += (_, _) => NavigateTo("notifications/studio");
            return page;
        });

        // Notifications / Webhooks page (P2/W7) — parity port of web WebhooksPage at route /notifications/webhooks.
        _viewModel.PageFactory.Register(
            "NotificationsWebhooks",
            static () => new FeatureViews.Notifications.WebhooksPage());


        // Power User / Dashboard composer page (P2/W7) — parity port of web DashboardsPage at route
        // /power/dashboards. A purely local-state surface: it composes Grafana dashboard JSON and copies it to
        // the clipboard; it never pushes to Grafana.
        _viewModel.PageFactory.Register(
            "PowerDashboards", static () => new FeatureViews.PowerUser.DashboardsPage());
        // Settings / Active Sessions page (P2/W7) — parity port of web ActiveSessionsPage at route /account/sessions.
        _viewModel.PageFactory.Register("ActiveSessions", static () => new FeatureViews.Settings.ActiveSessionsPage());
        // Settings / Helix (AI) integration page (P2/W7) — parity port of web HelixPage at route /integrations/helix.
        // Thin PageContainer wrapper (title + subtitle + integrations/helix breadcrumb overrides, page-level loading
        // bound to useSettings) around the already-ported AISettings surface. RouteTable already maps
        // Page("Helix","integrations/helix",SettingsAccountIntegrations).
        _viewModel.PageFactory.Register("Helix", static () => new FeatureViews.Settings.HelixPage());
        // Settings / Account / Integrations — Settings page (P2/W7) — parity port of web SettingsPage at route
        // /settings. The cross-page search box and the Data Export panel deep-link to other routes; the Onboarding
        // Tour launcher re-runs the guided walkthrough (web dispatchTourLauncherOpen → the Onboarding route). The
        // setup-checklist restart surfaces its own confirmation toast in-page (web restartChecklist + toast).
        _viewModel.PageFactory.Register("Settings", () =>
        {
            var page = new FeatureViews.Settings.SettingsPage();
            page.NavigationRequested += (_, route) => NavigateTo(route);
            page.TourLauncherRequested += (_, _) => NavigateTo("onboarding");
            return page;
        });
        // Settings / Account / Two-factor auth page (P2/W7) — parity port of web TwoFactorAuthPage at route
        // /account/2fa. Hosts the native TOTPEnrollmentSection inside the shared PageContainer (title + subtitle +
        // copy-link); RouteTable already maps Page("TwoFactorAuth","account/2fa").
        _viewModel.PageFactory.Register(
            "TwoFactorAuth",
            static () => new FeatureViews.Settings.TwoFactorAuthPage());
        // Sharing / Shared Drive public report (P2/W7) — parity port of web SharedDrivePage at route /s/:token
        // (chrome-less + unauthenticated). The share token is read from the live match; the expired view's
        // "Go to TeslaSync" home link maps to the dashboard index (web ExpiredShareView href="/").
        _viewModel.PageFactory.Register("SharedDrive", () =>
        {
            var page = new FeatureViews.Sharing.SharedDrivePage(_viewModel.Current.Param("token") ?? string.Empty);
            page.HomeRequested += (_, _) => NavigateTo(string.Empty);
            return page;
        });


        // Sharing / Trip Sharing page (P2/W7) — parity port of web SharingTripsPage at route /sharing/trips.
        // RouteTable already maps Page("SharingTrips","sharing/trips",Sharing); the page wires the recent-trips
        // list (loading / empty / success), the static share-card hint and the default-off trip-postcard drafter.
        _viewModel.PageFactory.Register(
            "SharingTrips", static () => new FeatureViews.Sharing.SharingTripsPage());
        // System / NotFound catch-all page (P2/W7) — parity port of web NotFoundPage at the wildcard route /*.
        // The unmatched path is read from the live match (web location.pathname) so the body + closest-route
        // suggestions reflect the actual URL. The three escape hatches map to the native shell: "Go back" to the
        // history stack (web window.history.back()), "Go to dashboard" to the index route (web navigate('/')), and
        // "Open command palette" to the shell search box (web toggle-command-palette); suggestion links navigate to
        // the chosen route path (web Link to={s.path}).
        _viewModel.PageFactory.Register("NotFound", () =>
        {
            var page = new FeatureViews.SystemOps.NotFoundPage(_viewModel.Current.MatchedPath);
            page.GoBackRequested += (_, _) => GoBack();
            page.GoHomeRequested += (_, _) => NavigateTo(string.Empty);
            page.OpenSearchRequested += (_, _) => SearchBox.Focus(FocusState.Programmatic);
            page.NavigationRequested += (_, route) => NavigateTo(route);
            return page;
        });

        // Telemetry / MQTT Inspector page (P2/W7) — parity port of web MQTTInspectorPage at route /mqtt-inspector
        // (group TelemetrySignals). RouteTable already maps Page("MQTTInspector","mqtt-inspector",TelemetrySignals);
        // the page binds the broker-status query (loading / empty / success), the Signal-Throughput area chart and
        // the per-vehicle streaming breakdown table.
        _viewModel.PageFactory.Register(
            "MQTTInspector", static () => new FeatureViews.Telemetry.MQTTInspectorPage());
        ReauthBannerHost.Content = _authBanner;
        PushBannerHost.Content = _pushBanner;
        AppAuth.Service.StateChanged += OnAuthStateChanged;
        AppSettingsHost.Service.Changed += OnSettingsChanged;
        Closed += OnShellClosed;

        // Foreground push registration + notification routing (P2/W6-0002). Best-effort: an
        // unpackaged dev run without WNS/package identity simply leaves push inactive. The W8
        // notification graph (actionable toasts, taskbar, jump list) starts first so it provides the
        // foreground push router; push registration then follows the auth session.
        AppNotifications.Start(this, DispatcherQueue, _pushBanner);
        AppPush.Start(DispatcherQueue, _pushBanner);

        ConfigureWindow();
        BuildNavigation();
        AddNavigationAccelerators();

        RootGrid.Loaded += OnRootLoaded;

        // Land on the index (Dashboard) route on launch.
        NavigateTo(string.Empty);

        // Signal the lifecycle coordinator that launch activation is complete (Launching -> Running).
        // Theme/density/startup-route are applied by OnSettingsChanged once the async settings load
        // raises Changed; first paint keeps the fast-cached theme restored in ConfigureWindow (no flash).
        AppLifecycle.MarkLaunched();
    }

    /// <summary>The shell's navigation/state view-model (exposed for diagnostics and tests).</summary>
    internal ShellViewModel ViewModel => _viewModel;

    /// <summary>
    /// Activate the shell from an external deep link (custom <c>teslasync://</c> scheme
    /// or an https universal link), resolving redirects and extracting parameters.
    /// </summary>
    public void ActivateFromUri(Uri uri)
    {
        if (DeepLink.TryActivate(uri, _viewModel.Registry, out var match))
        {
            NavigateTo(match.MatchedPath);
        }
    }

    private void ConfigureWindow()
    {
        var appWindow = AppWindow;
        _theme = _windowState.Restore(appWindow);
        ApplyTheme(_theme);

        appWindow.Changed += OnAppWindowChanged;
        appWindow.Closing += OnAppWindowClosing;

        // P2/W8-0002 — compose app lifecycle: the window's foreground/background and the system
        // network state drive suspend/resume, and a crash-safe persist flushes settings + window
        // state on suspend, window close, or a fatal unhandled exception.
        AppLifecycle.Start(this, AppSettingsHost.Service, AppSettingsHost.Cache, PersistWindowState);
    }

    private void OnRootLoaded(object sender, RoutedEventArgs e)
    {
        // Reserve title-bar space for the system caption buttons so the search box and
        // theme toggle never sit underneath them.
        try
        {
            double scale = RootGrid.XamlRoot?.RasterizationScale ?? 1.0;
            if (scale <= 0)
            {
                scale = 1.0;
            }

            RightInsetColumn.Width = new GridLength(AppWindow.TitleBar.RightInset / scale);
        }
        catch (Exception)
        {
            RightInsetColumn.Width = new GridLength(150);
        }
    }

    private void OnAppWindowChanged(AppWindow sender, AppWindowChangedEventArgs args)
    {
        if (!args.DidSizeChange)
        {
            return;
        }

        var size = sender.Size;
        int width = Math.Max(size.Width, _windowState.MinWidth);
        int height = Math.Max(size.Height, _windowState.MinHeight);
        if (width != size.Width || height != size.Height)
        {
            sender.Resize(new SizeInt32(width, height));
        }
    }

    private void OnAppWindowClosing(AppWindow sender, AppWindowClosingEventArgs args) =>
        // Flush settings + window state through the coordinator's crash-safe persist path.
        AppLifecycle.RequestShutdownPersist(LifecycleShutdownReason.WindowClosing);

    private void PersistWindowState(LifecycleShutdownReason reason)
    {
        try
        {
            _windowState.Save(AppWindow, _theme);

            // On a fatal teardown keep the work minimal; otherwise remember the active route so the
            // "open last visited" startup option can restore it.
            if (reason != LifecycleShutdownReason.FatalError)
            {
                WindowStateService.SaveLastRoute(_viewModel.CurrentPath);
            }
        }
        catch (Exception)
        {
            // Persistence is best-effort; never let a teardown save crash the app.
        }
    }

    private void BuildNavigation()
    {
        foreach (var info in RouteGroups.Ordered)
        {
            var routes = _viewModel.Registry.RoutesInGroup(info.Group);
            if (routes.Count == 0)
            {
                continue;
            }

            RootNavigation.MenuItems.Add(new NavigationViewItemHeader
            {
                Content = Localization.GroupTitle(info),
            });

            foreach (var route in routes)
            {
                RootNavigation.MenuItems.Add(CreateNavItem(route));
            }
        }

        // Footer shortcuts: settings + account.
        RootNavigation.FooterMenuItems.Add(CreateFooterItem("settings", "Settings", "\uE713"));
        RootNavigation.FooterMenuItems.Add(CreateFooterItem("account/privacy", "Account", "\uE77B"));
    }

    private NavigationViewItem CreateNavItem(RouteDefinition route)
    {
        var label = Localization.Title(route);
        var item = new NavigationViewItem
        {
            Content = label,
            Tag = route.PathPattern,
            Icon = new FontIcon { Glyph = route.Glyph },
        };
        AutomationProperties.SetName(item, label);
        _navItems[RouteRegistry.Normalize(route.PathPattern)] = item;
        return item;
    }

    private NavigationViewItem CreateFooterItem(string path, string fallbackLabel, string glyph)
    {
        var route = _viewModel.Registry.Resolve(path).Route;
        var label = route.IsCatchAll ? fallbackLabel : Localization.Title(route);
        var item = new NavigationViewItem
        {
            Content = label,
            Tag = path,
            Icon = new FontIcon { Glyph = glyph },
        };
        AutomationProperties.SetName(item, label);
        return item;
    }

    private void AddNavigationAccelerators()
    {
        var back = new KeyboardAccelerator { Key = VirtualKey.Left, Modifiers = VirtualKeyModifiers.Menu };
        back.Invoked += (_, e) =>
        {
            e.Handled = true;
            GoBack();
        };

        var forward = new KeyboardAccelerator { Key = VirtualKey.Right, Modifiers = VirtualKeyModifiers.Menu };
        forward.Invoked += (_, e) =>
        {
            e.Handled = true;
            GoForward();
        };

        RootGrid.KeyboardAccelerators.Add(back);
        RootGrid.KeyboardAccelerators.Add(forward);
    }

    private void OnItemInvoked(NavigationView sender, NavigationViewItemInvokedEventArgs args)
    {
        if (args.InvokedItemContainer?.Tag is string path)
        {
            NavigateTo(path);
        }
    }

    private void OnBackRequested(NavigationView sender, NavigationViewBackRequestedEventArgs args) => GoBack();

    private void OnBreadcrumbClicked(BreadcrumbBar sender, BreadcrumbBarItemClickedEventArgs args)
    {
        if (args.Index >= 0 && args.Index < _viewModel.Breadcrumbs.Count)
        {
            NavigateTo(_viewModel.Breadcrumbs[args.Index].Key);
        }
    }

    private void GoBack()
    {
        var previous = _viewModel.History.Back();
        if (previous is not null)
        {
            NavigateTo(previous, pushHistory: false, record: false);
        }
    }

    private void GoForward()
    {
        var next = _viewModel.History.Forward();
        if (next is not null)
        {
            NavigateTo(next, pushHistory: false, record: false);
        }
    }

    private void NavigateTo(string path, bool pushHistory = true, bool record = true)
    {
        if (_navigating)
        {
            return;
        }

        _navigating = true;
        try
        {
            // Preserve the outgoing page's scroll offset for restoration on return.
            if (ContentFrame.Content is RoutePendingView outgoing)
            {
                _viewModel.Scroll.Save(_viewModel.CurrentPath, outgoing.ScrollHost.VerticalOffset);
            }

            var match = _viewModel.Registry.Resolve(path);

            // Auth gating (P2/W4-0001, ADR-008): protected routes require a live session.
            // When signed out, redirect to the public onboarding surface and surface the
            // re-authentication banner rather than rendering authenticated chrome.
            if (match.Route.AuthRequired && !AppAuth.IsAuthenticated)
            {
                _pendingProtectedPath = match.MatchedPath;
                ShowAuthBanner();
                match = _viewModel.Registry.Resolve("onboarding");
            }
            else
            {
                HideAuthBanner();
            }

            if (pushHistory)
            {
                _viewModel.History.Push(match.MatchedPath);
            }

            _viewModel.UpdateForRoute(match);

            var element = _viewModel.PageFactory.Create(match);
            ContentFrame.Content = element;

            if (record)
            {
                _viewModel.RecordVisit();
            }

            SyncChrome();
            SelectNavItem(match);
            RouteAnnouncer.AnnounceRoute(_viewModel.Title);
            RestoreScroll(element, match.MatchedPath);
        }
        finally
        {
            _navigating = false;
        }
    }

    private void RestoreScroll(UIElement element, string path)
    {
        if (element is not RoutePendingView view)
        {
            return;
        }

        double offset = _viewModel.Scroll.Restore(path);
        if (offset <= 0)
        {
            return;
        }

        void OnLoaded(object sender, RoutedEventArgs e)
        {
            view.ScrollHost.ChangeView(null, offset, null);
            view.ScrollHost.Loaded -= OnLoaded;
        }

        view.ScrollHost.Loaded += OnLoaded;
    }

    private void SyncChrome()
    {
        HeaderTitle.Text = _viewModel.Title;
        StatusText.Text = _viewModel.StatusText;
        RootNavigation.IsBackEnabled = _viewModel.CanGoBack;
        RootNavigation.IsPaneVisible = !_viewModel.IsStandalone;
        HeaderTitle.Visibility = _viewModel.IsStandalone ? Visibility.Collapsed : Visibility.Visible;

        Title = _viewModel.Title;
        try
        {
            AppWindow.Title = _viewModel.Title;
        }
        catch (Exception)
        {
            // AppWindow title is cosmetic; ignore transient failures.
        }
    }

    private void SelectNavItem(RouteMatch match)
    {
        RootNavigation.SelectedItem =
            _navItems.TryGetValue(match.MatchedPath, out var item) ? item : null;
    }

    private void OnSearchTextChanged(AutoSuggestBox sender, AutoSuggestBoxTextChangedEventArgs args)
    {
        if (args.Reason != AutoSuggestionBoxTextChangeReason.UserInput)
        {
            return;
        }

        var query = sender.Text?.Trim() ?? string.Empty;
        if (query.Length == 0)
        {
            sender.ItemsSource = null;
            return;
        }

        sender.ItemsSource = _viewModel.Registry.NavigableRoutes
            .Select(Localization.Title)
            .Where(t => t.Contains(query, StringComparison.OrdinalIgnoreCase))
            .OrderBy(t => t, StringComparer.OrdinalIgnoreCase)
            .Take(8)
            .ToList();
    }

    private void OnSearchSubmitted(AutoSuggestBox sender, AutoSuggestBoxQuerySubmittedEventArgs args)
    {
        var query = (args.ChosenSuggestion as string ?? args.QueryText)?.Trim() ?? string.Empty;
        if (query.Length == 0)
        {
            return;
        }

        // Prefer an exact title match; otherwise hand the raw query to the search page.
        var route = _viewModel.Registry.NavigableRoutes
            .FirstOrDefault(r => string.Equals(Localization.Title(r), query, StringComparison.OrdinalIgnoreCase));

        NavigateTo(route is not null ? route.PathPattern : "search");
        sender.Text = string.Empty;
        sender.ItemsSource = null;
    }

    private void OnToggleTheme(object sender, RoutedEventArgs e)
    {
        // Cycle System -> Light -> Dark -> System through the settings service, which persists the
        // choice and raises Changed; OnSettingsChanged then applies it to the live window.
        var next = NextTheme(AppSettingsHost.Current.Theme);
        _ = AppSettingsHost.Service.UpdateAsync(s => s with { Theme = next });
    }

    private void ApplyTheme(ElementTheme theme)
    {
        if (Content is FrameworkElement root)
        {
            root.RequestedTheme = theme;
        }
    }

    private void OnSettingsChanged(object? sender, AppSettings settings)
    {
        if (DispatcherQueue.HasThreadAccess)
        {
            ApplySettings(settings);
        }
        else
        {
            DispatcherQueue.TryEnqueue(() => ApplySettings(settings));
        }
    }

    private void ApplySettings(AppSettings settings)
    {
        _theme = ToElementTheme(settings.Theme);
        ApplyTheme(_theme);
        ApplyDensity(settings.Density);
        MaybeApplyStartupRoute(settings);
    }

    private void ApplyDensity(InterfaceDensity density) =>
        RootNavigation.OpenPaneLength = density == InterfaceDensity.Compact ? 220 : 280;

    private void MaybeApplyStartupRoute(AppSettings settings)
    {
        // Honour the "open last visited" preference exactly once, after the first settings load.
        if (_startupRouteApplied)
        {
            return;
        }

        _startupRouteApplied = true;
        if (settings.StartupPage != AppStartupPage.LastVisited)
        {
            return;
        }

        var last = WindowStateService.ReadLastRoute();
        if (!string.IsNullOrEmpty(last) && !string.Equals(last, _viewModel.CurrentPath, StringComparison.Ordinal))
        {
            NavigateTo(last);
        }
    }

    private ElementTheme ToElementTheme(AppThemePreference preference) =>
        ThemeResolver.Resolve(preference, SystemHighContrast()) switch
        {
            ThemeVariant.Light => ElementTheme.Light,
            ThemeVariant.Dark => ElementTheme.Dark,
            _ => ElementTheme.Default,
        };

    /// <summary>
    /// Reads the OS high-contrast flag defensively. The packaged host always exposes it, but a
    /// non-packaged or headless launch must never crash theme application, so any failure reports
    /// "not high contrast" and the persisted light/dark preference is honoured unchanged.
    /// </summary>
    private bool SystemHighContrast()
    {
        try
        {
            _accessibility ??= new AccessibilitySettings();
            return _accessibility.HighContrast;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static AppThemePreference NextTheme(AppThemePreference preference) => preference switch
    {
        AppThemePreference.System => AppThemePreference.Light,
        AppThemePreference.Light => AppThemePreference.Dark,
        _ => AppThemePreference.System,
    };

    // Parse the /year-review/:year route param (web Number(yearParam) || new Date().getFullYear()).
    private static int ParseYearParam(string? year) =>
        int.TryParse(year, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var parsed) && parsed > 0
            ? parsed
            : DateTime.Now.Year;

    // Parse the /charging/:id route param (web Number(id)); 0 when absent so the page renders its empty state.
    private static long ParseSessionId(string? id) =>
        long.TryParse(id, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var parsed) && parsed > 0
            ? parsed
            : 0;

    private void OnAuthStateChanged(object? sender, AuthState state)
    {
        if (DispatcherQueue.HasThreadAccess)
        {
            ApplyAuthState(state);
        }
        else
        {
            DispatcherQueue.TryEnqueue(() => ApplyAuthState(state));
        }
    }

    private void ApplyAuthState(AuthState state)
    {
        if (state.IsAuthenticated)
        {
            var target = _pendingProtectedPath ?? string.Empty;
            _pendingProtectedPath = null;
            HideAuthBanner();
            NavigateTo(target);
        }
        else if (state is AuthState.SignedOut)
        {
            // A sign-out (or expired session) must re-gate the current route immediately.
            NavigateTo(_viewModel.CurrentPath);
        }
    }

    // Open an external documentation link in the default browser (web onboarding doc links: <a href target="_blank">).
    // Resolved against the configured API origin since the self-hosted docs ship from the same deployment.
    private static void OpenDocumentation(string relativePath)
    {
        try
        {
            var origin = new ApiClientOptions().BaseAddress;
            _ = Windows.System.Launcher.LaunchUriAsync(new Uri(origin, relativePath));
        }
        catch (Exception)
        {
            // Best-effort: opening external documentation must never crash navigation.
        }
    }

    private void ShowAuthBanner()
    {
        _authBanner.Title = Localization.Get("auth.reauth.title", "Sign in required");
        _authBanner.Message = Localization.Get(
            "auth.reauth.message",
            "Your session has ended. Sign in to access this page.");
        _authBanner.IsOpen = true;
        ReauthBannerHost.Visibility = Visibility.Visible;
    }

    private void HideAuthBanner()
    {
        _authBanner.IsOpen = false;
        ReauthBannerHost.Visibility = Visibility.Collapsed;
    }

    private void OnShellClosed(object sender, WindowEventArgs args)
    {
        AppAuth.Service.StateChanged -= OnAuthStateChanged;
        AppSettingsHost.Service.Changed -= OnSettingsChanged;
        AppPush.Stop();
        AppNotifications.Stop();
        AppLifecycle.Stop();
    }
}
