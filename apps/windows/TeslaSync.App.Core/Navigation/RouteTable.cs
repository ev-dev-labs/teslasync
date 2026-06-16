namespace TeslaSync.App.Core.Navigation;

/// <summary>
/// The complete native route table — a one-for-one port of every <c>&lt;Route&gt;</c>
/// in <c>web/src/App.tsx</c>, including aliases, <c>&lt;Navigate&gt;</c> redirects,
/// parameter routes, the outer standalone routes and both catch-alls.
///
/// The table is page-body agnostic: <see cref="RouteDefinition.PageFactory"/> is
/// left <see langword="null"/> here and populated by the shell from the generated
/// W7 page classes. Routes whose page module has not been generated still appear in
/// the registry so navigation, deep links and the route-coverage gate see the full
/// surface.
/// </summary>
public static class RouteTable
{
    private const string PageGlyph = "\uE7C3";

    private static RouteDefinition Page(
        string name, string path, RouteGroup group, string title, string glyph = PageGlyph) =>
        new()
        {
            Name = name,
            PathPattern = path,
            Group = group,
            Glyph = glyph,
            TitleKey = $"route.{name}",
            DefaultTitle = title,
            ShowInNav = true,
        };

    private static RouteDefinition Hidden(
        string name, string path, RouteGroup group, string title) =>
        new()
        {
            Name = name,
            PathPattern = path,
            Group = group,
            TitleKey = $"route.{name}",
            DefaultTitle = title,
            ShowInNav = false,
        };

    private static RouteDefinition Standalone(
        string name, string path, RouteGroup group, string title, bool auth = true) =>
        new()
        {
            Name = name,
            PathPattern = path,
            Group = group,
            TitleKey = $"route.{name}",
            DefaultTitle = title,
            ShellMode = ShellMode.Standalone,
            AuthRequired = auth,
            ShowInNav = false,
        };

    private static RouteDefinition Redirect(string path, string to, RouteGroup group) =>
        new()
        {
            Name = $"redirect:{path}",
            PathPattern = path,
            Group = group,
            RedirectTo = to,
            ShowInNav = false,
        };

    private static RouteDefinition CatchAll() =>
        new()
        {
            Name = "NotFound",
            PathPattern = "*",
            Group = RouteGroup.None,
            TitleKey = "route.NotFound",
            DefaultTitle = "Not Found",
            IsCatchAll = true,
            ShowInNav = false,
        };

    /// <summary>Every route in the application, in <c>App.tsx</c> declaration order.</summary>
    public static IReadOnlyList<RouteDefinition> All { get; } = new[]
    {
        // ── Outer standalone routes (rendered outside the main Layout) ──────────
        Standalone("QuickStats", "quick-stats", RouteGroup.DashboardExplore, "Quick Stats"),
        Standalone("Glance", "glance", RouteGroup.DashboardExplore, "Glance"),
        Standalone("YearReview", "year-review/:year", RouteGroup.Analytics, "Year in Review"),
        Standalone("SharedDrive", "s/:token", RouteGroup.Sharing, "Shared Drive", auth: false),
        Standalone("WatchFace", "watch", RouteGroup.Standalone, "Watch Face", auth: false),
        Standalone("Onboarding", "onboarding", RouteGroup.Onboarding, "Onboarding", auth: false),

        // ── Dashboard / Explore ────────────────────────────────────────────────
        Page("Dashboard", "", RouteGroup.DashboardExplore, "Dashboard", "\uE80F"),
        Page("Explore", "explore", RouteGroup.DashboardExplore, "Explore", "\uE721"),

        // ── Maps / Location ────────────────────────────────────────────────────
        Page("LiveMap", "live", RouteGroup.MapsLocation, "Live Map", "\uE707"),

        // ── Vehicles ───────────────────────────────────────────────────────────
        Page("Vehicles", "vehicles", RouteGroup.Vehicles, "Vehicles", "\uE804"),
        Hidden("VehicleDetail", "vehicles/:id", RouteGroup.Vehicles, "Vehicle"),
        Hidden("VehicleAccess", "vehicles/:id/access", RouteGroup.Vehicles, "Vehicle Access"),
        Page("DigitalTwin", "digital-twin", RouteGroup.Vehicles, "Digital Twin", "\uE805"),

        // ── Battery / Energy ───────────────────────────────────────────────────
        Page("Energy", "energy", RouteGroup.BatteryEnergy, "Energy", "\uE945"),
        Page("BatteryHealth", "battery", RouteGroup.BatteryEnergy, "Battery Health", "\uE83E"),
        Hidden("BatteryHealth", "battery/health", RouteGroup.BatteryEnergy, "Battery Health"),

        // ── Driving ────────────────────────────────────────────────────────────
        Page("Drives", "drives", RouteGroup.TripsDriving, "Drives", "\uE700"),

        // ── Charging ───────────────────────────────────────────────────────────
        Page("Charging", "charging", RouteGroup.Charging, "Charging", "\uEBE8"),

        // ── Analytics ──────────────────────────────────────────────────────────
        Page("Analytics", "analytics", RouteGroup.Analytics, "Analytics", "\uE9D9"),
        Page("WeeklyDigest", "weekly-digest", RouteGroup.Analytics, "Weekly Digest", "\uE787"),

        // ── System / Ops ───────────────────────────────────────────────────────
        Page("Commands", "commands", RouteGroup.SystemOps, "Commands", "\uE756"),
        Page("CommandHistory", "command-history", RouteGroup.SystemOps, "Command History", "\uE81C"),

        // ── Automations ────────────────────────────────────────────────────────
        Page("Automations", "automations", RouteGroup.Automations, "Automations", "\uE701"),
        Hidden("AutomationList", "automations/list", RouteGroup.Automations, "Automation List"),
        Hidden("AutomationBuilder", "automations/new", RouteGroup.Automations, "New Automation"),
        Hidden("AutomationBuilder", "automations/:id/edit", RouteGroup.Automations, "Edit Automation"),

        // ── Notifications (legacy redirects + canonical pages) ─────────────────
        Redirect("alerts", "notifications/alerts", RouteGroup.Notifications),
        Redirect("alert-studio", "notifications/studio", RouteGroup.Notifications),
        Redirect("alert-rules", "notifications/rules", RouteGroup.Notifications),
        Redirect("notifications", "notifications/inbox", RouteGroup.Notifications),
        Page("NotificationsInbox", "notifications/inbox", RouteGroup.Notifications, "Inbox", "\uE7E7"),
        Page("NotificationsArchived", "notifications/archived", RouteGroup.Notifications, "Archived", "\uE702"),
        Page("NotificationsAlerts", "notifications/alerts", RouteGroup.Notifications, "Alerts", "\uE706"),
        Page("NotificationsChannels", "notifications/channels", RouteGroup.Notifications, "Channels", "\uE70F"),
        Page("NotificationsWebhooks", "notifications/webhooks", RouteGroup.Notifications, "Webhooks", "\uE710"),
        Page("NotificationsBrowser", "notifications/browser", RouteGroup.Notifications, "Browser Notifications", "\uE712"),
        Page("NotificationsQuietHours", "notifications/quiet-hours", RouteGroup.Notifications, "Quiet Hours", "\uE715"),
        Page("NotificationsRules", "notifications/rules", RouteGroup.Notifications, "Alert Rules", "\uE716"),
        Page("NotificationsStudio", "notifications/studio", RouteGroup.Notifications, "Alert Studio", "\uE718"),
        Page("NotificationsAudit", "notifications/audit", RouteGroup.Notifications, "Notification Audit", "\uE71B"),

        // ── Maps / Location (cont.) ────────────────────────────────────────────
        Page("Geofences", "geofences", RouteGroup.MapsLocation, "Geofences", "\uE909"),

        // ── Settings / Account / Integrations ──────────────────────────────────
        Page("Settings", "settings", RouteGroup.SettingsAccountIntegrations, "Settings", "\uE713"),
        Page("SafetySettingsPage", "settings/safety", RouteGroup.SettingsAccountIntegrations, "Safety Settings", "\uE71C"),
        Page("TwoFactorAuth", "account/2fa", RouteGroup.SettingsAccountIntegrations, "Two-Factor Auth", "\uE71D"),
        Page("ActiveSessions", "account/sessions", RouteGroup.SettingsAccountIntegrations, "Active Sessions", "\uE724"),
        Page("Privacy", "account/privacy", RouteGroup.SettingsAccountIntegrations, "Privacy", "\uE72A"),
        Page("Helix", "integrations/helix", RouteGroup.SettingsAccountIntegrations, "Helix", "\uEC05"),

        // ── Driving / Charging detail (param) ──────────────────────────────────
        Hidden("DriveDetail", "drives/:id", RouteGroup.TripsDriving, "Drive"),
        Hidden("TripReplay", "drives/:id/replay", RouteGroup.TripsDriving, "Trip Replay"),
        Hidden("ChargeDetail", "charging/:id", RouteGroup.Charging, "Charging Session"),

        // ── System / Ops (cont.) ───────────────────────────────────────────────
        Page("Chatbot", "chatbot", RouteGroup.SystemOps, "Chatbot", "\uE8BD"),

        // ── Vehicle Systems ────────────────────────────────────────────────────
        Page("TirePressure", "tire-pressure", RouteGroup.VehicleSystems, "Tire Pressure", "\uE950"),
        Page("SoftwareUpdates", "software-updates", RouteGroup.VehicleSystems, "Software Updates", "\uE895"),
        Hidden("SoftwareUpdates", "vehicle-systems/software", RouteGroup.VehicleSystems, "Software Updates"),

        // ── Battery / Charging extras ──────────────────────────────────────────
        Page("VampireDrain", "vampire-drain", RouteGroup.BatteryEnergy, "Vampire Drain", "\uE72C"),
        Hidden("VampireDrain", "charging/vampire-drain", RouteGroup.Charging, "Vampire Drain"),

        // ── Maps / Analytics ───────────────────────────────────────────────────
        Page("Locations", "locations", RouteGroup.MapsLocation, "Locations", "\uE81D"),
        Page("Timeline", "timeline", RouteGroup.Analytics, "Timeline", "\uE823"),
        Page("Mileage", "mileage", RouteGroup.Analytics, "Mileage", "\uE9D5"),
        Page("ProjectedRange", "projected-range", RouteGroup.BatteryEnergy, "Projected Range", "\uE9A9"),
        Hidden("ProjectedRange", "analytics/range", RouteGroup.BatteryEnergy, "Projected Range"),
        Page("Efficiency", "efficiency", RouteGroup.TripsDriving, "Efficiency", "\uE9D2"),

        // ── Trips ──────────────────────────────────────────────────────────────
        Page("Trips", "trips", RouteGroup.TripsDriving, "Trips", "\uE7C0"),
        Hidden("TripDetail", "trips/:id", RouteGroup.TripsDriving, "Trip"),
        Page("SharingTrips", "sharing/trips", RouteGroup.Sharing, "Trip Sharing", "\uE72D"),
        Page("TripPlanner", "trip-planner", RouteGroup.TripsDriving, "Trip Planner", "\uE8A7"),

        // ── Analytics (cont.) ──────────────────────────────────────────────────
        Page("Statistics", "statistics", RouteGroup.Analytics, "Statistics", "\uEB05"),
        Page("LifetimeStats", "lifetime-stats", RouteGroup.Analytics, "Lifetime Stats", "\uE730"),
        Redirect("analytics/lifetime", "lifetime-stats", RouteGroup.Analytics),

        // ── System status ──────────────────────────────────────────────────────
        Page("SystemStatus", "system-status", RouteGroup.SystemOps, "System Status", "\uEB90"),
        Hidden("IncidentTimeline", "system-status/incidents/:id", RouteGroup.SystemOps, "Incident"),
        Page("StatusApiDocs", "docs/status-api", RouteGroup.SystemOps, "Status API Docs", "\uE8A5"),
        Page("Roadmap", "roadmap", RouteGroup.SystemOps, "Roadmap", "\uE734"),
        // HelpPage is unrouted in web App.tsx (the component exists but is not wired into a visible nav route);
        // the Windows shell exposes it as a hidden deep-link destination so the W7 parity port is reachable.
        Hidden("Help", "help", RouteGroup.SystemOps, "Help"),

        // ── Admin / DevTools ───────────────────────────────────────────────────
        Page("APIKeys", "api-keys", RouteGroup.AdminDevTools, "API Keys", "\uE192"),
        Redirect("compare", "period-compare", RouteGroup.Analytics),
        Redirect("analytics/compare", "period-compare", RouteGroup.Analytics),
        Page("PeriodCompare", "period-compare", RouteGroup.Analytics, "Period Compare", "\uE73E"),
        Redirect("admin", "system-status", RouteGroup.AdminDevTools),
        Page("FeedbackQueue", "admin/feedback", RouteGroup.AdminDevTools, "Feedback Queue", "\uE740"),
        Page("FleetTelemetryCoverage", "admin/telemetry/coverage", RouteGroup.AdminDevTools, "Telemetry Coverage", "\uE749"),
        Page("DLQInspector", "admin/dlq", RouteGroup.AdminDevTools, "DLQ Inspector", "\uE74C"),
        Page("FeatureFlagsAdmin", "admin/flags", RouteGroup.AdminDevTools, "Feature Flags", "\uE74D"),
        // Web RbacMatrixPage is unrouted in App.tsx; registered hidden here so it is deep-linkable / route-coverage
        // visible without inventing a nav entry the web does not have.
        Hidden("RbacMatrix", "admin/rbac", RouteGroup.AdminDevTools, "RBAC Matrix"),
        Page("IngestXRay", "admin/ingest-xray", RouteGroup.AdminDevTools, "Ingest X-Ray", "\uE74E"),
        Page("LiveSignalInspector", "admin/live-signals", RouteGroup.AdminDevTools, "Live Signal Inspector", "\uE753"),
        Page("SchemaDrift", "admin/schema-drift", RouteGroup.AdminDevTools, "Schema Drift", "\uE754"),
        Page("SlowQueries", "admin/slow-queries", RouteGroup.AdminDevTools, "Slow Queries", "\uE765"),
        Page("VehicleCost", "admin/vehicle-cost", RouteGroup.AdminDevTools, "Vehicle Cost", "\uE767"),
        Page("DiskForecast", "admin/disk-forecast", RouteGroup.AdminDevTools, "Disk Forecast", "\uE769"),
        Page("SecretRotation", "admin/secret-rotation", RouteGroup.AdminDevTools, "Secret Rotation", "\uE774"),
        Page("AuditLog", "admin/audit-log", RouteGroup.AdminDevTools, "Audit Log", "\uE77A"),
        Page("GDPRExport", "admin/gdpr-exports", RouteGroup.AdminDevTools, "GDPR Exports", "\uE783"),
        Page("ApiLogs", "api-logs", RouteGroup.AdminDevTools, "API Logs", "\uE785"),
        Page("FleetAPI", "fleet-api", RouteGroup.AdminDevTools, "Fleet API", "\uE789"),
        Page("TeslaFeatureFlags", "tesla-features", RouteGroup.AdminDevTools, "Tesla Features", "\uE790"),
        Page("TeslaRegion", "tesla-region", RouteGroup.AdminDevTools, "Tesla Region", "\uE799"),
        Page("TeslaOrders", "tesla-orders", RouteGroup.AdminDevTools, "Tesla Orders", "\uE7A7"),
        Page("GasPriceAutoPoll", "gas-price", RouteGroup.AdminDevTools, "Gas Price", "\uE7B3"),
        Page("DevTools", "dev-tools", RouteGroup.AdminDevTools, "Dev Tools", "\uE90F"),
        Page("ApiPlayground", "api-playground", RouteGroup.AdminDevTools, "API Playground", "\uE7B7"),

        // ── Power User ─────────────────────────────────────────────────────────
        Page("PowerSqlPlayground", "power/sql", RouteGroup.PowerUser, "SQL Playground", "\uE7B8"),
        Page("PowerGrafanaPanel", "power/grafana", RouteGroup.PowerUser, "Grafana Panel", "\uE7BA"),
        Page("PowerDashboards", "power/dashboards", RouteGroup.PowerUser, "Dashboards", "\uE7C1"),

        // ── Telemetry / Signals ────────────────────────────────────────────────
        Page("RedisSignalViewer", "redis-signals", RouteGroup.TelemetrySignals, "Redis Signals", "\uE7E8"),
        Page("SignalsWorkspace", "signals", RouteGroup.TelemetrySignals, "Signals", "\uE7EF"),
        Page("SignalExplorer", "signal-explorer", RouteGroup.TelemetrySignals, "Signal Explorer", "\uE7F4"),
        Page("SignalLogViewer", "signal-log", RouteGroup.TelemetrySignals, "Signal Log", "\uE7F6"),
        Page("LiveSignalMonitor", "live-monitor", RouteGroup.TelemetrySignals, "Live Monitor", "\uE7F7"),
        Page("StateMachineDebugger", "state-debugger", RouteGroup.TelemetrySignals, "State Debugger", "\uE7FC"),
        Page("SignalDiff", "signal-diff", RouteGroup.TelemetrySignals, "Signal Diff", "\uE809"),
        Page("SignalGapDetector", "signal-gaps", RouteGroup.TelemetrySignals, "Signal Gaps", "\uE816"),

        // ── Diagnostics ────────────────────────────────────────────────────────
        Page("DBHealthDashboard", "db-health", RouteGroup.Diagnostics, "DB Health", "\uE9F5"),
        Page("MQTTInspector", "mqtt-inspector", RouteGroup.TelemetrySignals, "MQTT Inspector", "\uE81E"),
        Page("AnomalyDashboard", "anomaly-detection", RouteGroup.Diagnostics, "Anomaly Detection", "\uE821"),
        Hidden("AnomalyDashboard", "analytics/anomalies", RouteGroup.Diagnostics, "Anomaly Detection"),

        // ── Driving / Systems (cont.) ──────────────────────────────────────────
        Page("DrivingDynamics", "driving-dynamics", RouteGroup.TripsDriving, "Driving Dynamics", "\uE825"),
        Page("ClimateControl", "climate-control", RouteGroup.VehicleSystems, "Climate Control", "\uE9CA"),
        Hidden("ClimateControl", "climate", RouteGroup.VehicleSystems, "Climate Control"),
        Page("SecurityAccess", "security-access", RouteGroup.AdminDevTools, "Security & Access", "\uE72E"),

        // ── Charging (cont.) ───────────────────────────────────────────────────
        Page("ChargingCurve", "charging-curve", RouteGroup.Charging, "Charging Curve", "\uE82D"),
        Hidden("ChargingCurve", "charging/curves", RouteGroup.Charging, "Charging Curve"),
        Page("CostAnalysis", "cost-analysis", RouteGroup.Charging, "Cost Analysis", "\uE1D6"),
        Hidden("CostAnalysis", "charging/costs", RouteGroup.Charging, "Cost Analysis"),
        Page("TeslaChargingHistory", "tesla-charging-history", RouteGroup.Charging, "Tesla Charging History", "\uE83F"),
        Page("TeslaChargingSessions", "tesla-charging-sessions", RouteGroup.Charging, "Tesla Charging Sessions", "\uE88E"),
        Page("SmartCharge", "smart-charge", RouteGroup.Charging, "Smart Charge", "\uE890"),
        Hidden("SmartCharge", "charging/schedule", RouteGroup.Charging, "Smart Charge"),
        Page("Powershare", "powershare", RouteGroup.Charging, "Powershare", "\uE892"),

        // ── Battery / Driving / Analytics (cont.) ──────────────────────────────
        Page("BatteryCells", "battery-cells", RouteGroup.BatteryEnergy, "Battery Cells", "\uE894"),
        Page("DriveScore", "drive-score", RouteGroup.TripsDriving, "Drive Score", "\uE896"),
        Page("WeeklyDigest", "weekly-digest", RouteGroup.Analytics, "Weekly Digest", "\uE897"),
        Page("Maintenance", "maintenance", RouteGroup.VehicleSystems, "Maintenance", "\uE898"),
        Page("DataExport", "data-export", RouteGroup.SystemOps, "Data Export", "\uEDE1"),
        Page("Exports", "exports", RouteGroup.SystemOps, "Exports", "\uE8A1"),
        // Web ScheduledExportsPanel is mounted on the Data Export page (unrouted); exposed here as a deep-link-only
        // surface so the native shell can navigate to it directly (P2/W7).
        Hidden("ScheduledExports", "scheduled-exports", RouteGroup.SystemOps, "Scheduled Exports"),
        Page("EnergyFlow", "energy-flow", RouteGroup.BatteryEnergy, "Energy Flow", "\uE8A4"),
        Page("PowerFlowDashboard", "power-flow", RouteGroup.BatteryEnergy, "Power Flow", "\uE8A9"),
        Page("EnergyProducts", "energy-products", RouteGroup.BatteryEnergy, "Energy Products", "\uE8AB"),
        Page("DrivetrainHealth", "drivetrain-health", RouteGroup.TripsDriving, "Drivetrain Health", "\uEB51"),
        Page("MediaPlayer", "media-player", RouteGroup.VehicleSystems, "Media Player", "\uE768"),
        Page("SafetySettings", "safety-settings", RouteGroup.VehicleSystems, "Safety Settings", "\uE8AD"),
        Page("GuardMode", "guard-mode", RouteGroup.VehicleSystems, "Guard Mode", "\uEA18"),
        Page("NavigationRoute", "navigation", RouteGroup.MapsLocation, "Navigation", "\uE8B7"),
        Page("DataRepair", "data-repair", RouteGroup.SystemOps, "Data Repair", "\uE8BB"),
        Page("BackupRestore", "backup", RouteGroup.SettingsAccountIntegrations, "Backup & Restore", "\uE777"),
        Page("TemperatureImpact", "temperature-impact", RouteGroup.MapsLocation, "Temperature Impact", "\uE8C3"),
        Page("RouteEfficiency", "route-efficiency", RouteGroup.TripsDriving, "Route Efficiency", "\uE8C7"),
        Page("RegenEfficiency", "regen-efficiency", RouteGroup.TripsDriving, "Regen Efficiency", "\uE8C8"),
        Page("BatteryDegradation", "battery-degradation", RouteGroup.BatteryEnergy, "Battery Degradation", "\uE8C9"),
        Page("TrueCostOwnership", "tco", RouteGroup.Analytics, "True Cost of Ownership", "\uE8CB"),
        Hidden("TrueCostOwnership", "analytics/tco", RouteGroup.Analytics, "True Cost of Ownership"),
        Page("FleetCompare", "vehicle-comparison", RouteGroup.Analytics, "Vehicle Comparison", "\uE8D6"),
        Page("SleepEfficiency", "sleep-efficiency", RouteGroup.BatteryEnergy, "Sleep Efficiency", "\uEC46"),
        Page("ChargingHeatmap", "charging-heatmap", RouteGroup.Charging, "Charging Heatmap", "\uE8D7"),
        Page("SpeedProfile", "speed-profile", RouteGroup.TripsDriving, "Speed Profile", "\uE8E5"),
        Page("TeslaAccount", "tesla-account", RouteGroup.AdminDevTools, "Tesla Account", "\uE77B"),
        Page("MyActivity", "me/activity", RouteGroup.SystemOps, "My Activity", "\uE8EA"),
        Hidden("Search", "search", RouteGroup.SystemOps, "Search"),

        // ── Catch-all (NotFound) ───────────────────────────────────────────────
        CatchAll(),
    };
}
