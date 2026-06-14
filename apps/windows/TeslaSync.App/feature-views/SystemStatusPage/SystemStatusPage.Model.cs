using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Status;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The mutually-exclusive lifecycle state of one data region on the <c>SystemStatusPage</c> surface — the native
/// summary of the four web data states (loading / empty / error / success). The web page
/// (web/src/features/system/pages/SystemStatusPage.tsx) runs seven independent queries and, per region, renders a
/// loading shimmer, an explicit empty state, an inline error with retry, or the populated content. This enum is the
/// single summary the ledger / Narrator key off; per-region visibility is driven by the projected per-source value.
/// </summary>
public enum SystemStatusState
{
    /// <summary>The source is in flight with nothing cached yet (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>The source resolved but returned nothing meaningful (web empty branch).</summary>
    Empty,

    /// <summary>The source query failed (web <c>error</c>) — the inline error + retry shows.</summary>
    Error,

    /// <summary>The source produced data — the populated content renders.</summary>
    Success,
}

/// <summary>
/// One backend component health entry from <c>GET /system/health</c> (web <c>health.components</c>). The Go API
/// returns a map of name → <c>{ status }</c>; <see cref="Status"/> is the raw string ("ok" / "healthy" / "degraded"
/// / …). Pure data; parsing tolerates missing / null fields.
/// </summary>
public sealed record StatusComponentEntry(string Name, string Status);

/// <summary>
/// The system-health snapshot — the native mirror of the web <c>useSystemHealth</c> response (GET /system/health):
/// the overall <see cref="Status"/> string and the per-component <see cref="Components"/> roll-up. <see cref="HasData"/>
/// records whether the server returned a body. Pure data; parsing is null-tolerant.
/// </summary>
public sealed record SystemHealthSnapshot(bool HasData, string Status, IReadOnlyList<StatusComponentEntry> Components)
{
    /// <summary>The empty snapshot (no health yet).</summary>
    public static SystemHealthSnapshot Empty { get; } = new(false, string.Empty, []);

    /// <summary>Read the health body from JSON, tolerating missing / null fields.</summary>
    public static SystemHealthSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var components = new List<StatusComponentEntry>();
        if (o.TryGetProperty("components", out var comps) && comps.ValueKind == JsonValueKind.Object)
        {
            foreach (var member in comps.EnumerateObject())
            {
                // camelCaseKeys() in the web client adds duplicate camelCase aliases; keep only the
                // canonical snake_case keys (those without an uppercase letter), matching the web filter.
                if (member.Name.Any(char.IsUpper))
                {
                    continue;
                }

                string status = member.Value.ValueKind == JsonValueKind.Object
                    ? JsonReadHelpers.Str(member.Value, "status") ?? string.Empty
                    : member.Value.ValueKind == JsonValueKind.String
                        ? member.Value.GetString() ?? string.Empty
                        : string.Empty;
                components.Add(new StatusComponentEntry(member.Name, status));
            }
        }

        return new SystemHealthSnapshot(
            HasData: true,
            Status: JsonReadHelpers.Str(o, "status") ?? string.Empty,
            Components: components);
    }
}

/// <summary>The vehicle-count snapshot — the native mirror of the web <c>useVehicles</c> response (GET /vehicles).</summary>
public sealed record StatusVehiclesSnapshot(bool HasData, int Count)
{
    /// <summary>The empty snapshot (no vehicles loaded).</summary>
    public static StatusVehiclesSnapshot Empty { get; } = new(false, 0);

    /// <summary>Read the vehicle list from JSON (array body), tolerating a wrapping object.</summary>
    public static StatusVehiclesSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind == JsonValueKind.Array)
        {
            return new StatusVehiclesSnapshot(true, o.GetArrayLength());
        }

        if (o.ValueKind == JsonValueKind.Object && o.TryGetProperty("vehicles", out var arr) &&
            arr.ValueKind == JsonValueKind.Array)
        {
            return new StatusVehiclesSnapshot(true, arr.GetArrayLength());
        }

        return Empty;
    }
}

/// <summary>
/// The notification-stats snapshot — the native mirror of the web <c>useNotificationStats</c> response
/// (GET /notifications/stats): enabled / total channels, lifetime sent, pending and failed counts. Pure data;
/// parsing is null-tolerant.
/// </summary>
public sealed record NotificationStatsSnapshot(
    bool HasData,
    long EnabledChannels,
    long TotalChannels,
    long Sent,
    long Pending,
    long Failed)
{
    /// <summary>The empty snapshot (no stats yet).</summary>
    public static NotificationStatsSnapshot Empty { get; } = new(false, 0, 0, 0, 0, 0);

    /// <summary>Read the stats body from JSON, tolerating missing / null fields.</summary>
    public static NotificationStatsSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new NotificationStatsSnapshot(
            HasData: true,
            EnabledChannels: JsonReadHelpers.Long(o, "enabled_channels") ?? 0,
            TotalChannels: JsonReadHelpers.Long(o, "total_channels") ?? 0,
            Sent: JsonReadHelpers.Long(o, "total_sent") ?? JsonReadHelpers.Long(o, "sent") ?? 0,
            Pending: JsonReadHelpers.Long(o, "pending") ?? 0,
            Failed: JsonReadHelpers.Long(o, "failed") ?? 0);
    }
}

/// <summary>
/// The Tesla-auth snapshot — the native mirror of the web <c>useAuthStatus</c> response (GET /auth/status):
/// whether the account is connected and the optional token <see cref="ExpiresAt"/>. <see cref="HasAuthenticated"/>
/// mirrors the web <c>auth?.authenticated</c> tri-state (unknown when the field is absent). Pure data.
/// </summary>
public sealed record AuthStatusSnapshot(bool HasData, bool HasAuthenticated, bool Authenticated, string? ExpiresAt)
{
    /// <summary>The empty snapshot (no auth status yet).</summary>
    public static AuthStatusSnapshot Empty { get; } = new(false, false, false, null);

    /// <summary>Read the auth body from JSON, tolerating missing / null fields.</summary>
    public static AuthStatusSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        bool? authed = JsonReadHelpers.Bool(o, "authenticated");
        return new AuthStatusSnapshot(
            HasData: true,
            HasAuthenticated: authed is not null,
            Authenticated: authed ?? false,
            ExpiresAt: JsonReadHelpers.Str(o, "expires_at"));
    }
}

/// <summary>One backup run — the native mirror of a web <c>useBackupRuns</c> row: status + optional completion + size.</summary>
public sealed record BackupRunEntry(string Status, string? CompletedAt, long? FileSize)
{
    /// <summary>Read one run from a JSON object, tolerating missing / null fields.</summary>
    public static BackupRunEntry FromJson(JsonElement o) => new(
        Status: JsonReadHelpers.Str(o, "status") ?? string.Empty,
        CompletedAt: JsonReadHelpers.Str(o, "completed_at"),
        FileSize: JsonReadHelpers.Long(o, "file_size"));
}

/// <summary>The backup-runs snapshot — the native mirror of the web <c>useBackupRuns</c> response (GET /backup/runs).</summary>
public sealed record BackupRunsSnapshot(bool HasData, IReadOnlyList<BackupRunEntry> Runs)
{
    /// <summary>The empty snapshot (no runs loaded).</summary>
    public static BackupRunsSnapshot Empty { get; } = new(false, []);

    /// <summary>Read the runs array from JSON, tolerating a wrapping object.</summary>
    public static BackupRunsSnapshot FromJson(JsonElement o)
    {
        JsonElement arr = o;
        if (o.ValueKind == JsonValueKind.Object && o.TryGetProperty("runs", out var inner))
        {
            arr = inner;
        }

        if (arr.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        var runs = new List<BackupRunEntry>();
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                runs.Add(BackupRunEntry.FromJson(item));
            }
        }

        return new BackupRunsSnapshot(true, runs);
    }
}

/// <summary>The backup-configs snapshot — the native mirror of the web <c>useBackupConfigs</c> response (GET /backup/configs).</summary>
public sealed record BackupConfigsSnapshot(bool HasData, int Count)
{
    /// <summary>The empty snapshot (no configs loaded).</summary>
    public static BackupConfigsSnapshot Empty { get; } = new(false, 0);

    /// <summary>Read the configs array length from JSON, tolerating a wrapping object.</summary>
    public static BackupConfigsSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind == JsonValueKind.Array)
        {
            return new BackupConfigsSnapshot(true, o.GetArrayLength());
        }

        if (o.ValueKind == JsonValueKind.Object && o.TryGetProperty("configs", out var arr) &&
            arr.ValueKind == JsonValueKind.Array)
        {
            return new BackupConfigsSnapshot(true, arr.GetArrayLength());
        }

        return Empty;
    }
}

/// <summary>
/// The maintenance-mode snapshot — the native mirror of the web <c>useMaintenanceState</c> response
/// (GET /admin/maintenance): the operator <see cref="Mode"/> ("maintenance" when active) plus the optional banner
/// <see cref="Message"/>. Pure data; parsing is null-tolerant.
/// </summary>
public sealed record MaintenanceSnapshot(bool HasData, string Mode, string? Message)
{
    /// <summary>The empty snapshot (no maintenance state yet).</summary>
    public static MaintenanceSnapshot Empty { get; } = new(false, string.Empty, null);

    /// <summary>True when the operator has set maintenance mode (web <c>mode === 'maintenance'</c>).</summary>
    public bool IsActive => string.Equals(Mode, "maintenance", StringComparison.OrdinalIgnoreCase);

    /// <summary>Read the maintenance body from JSON, tolerating missing / null fields.</summary>
    public static MaintenanceSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new MaintenanceSnapshot(
            HasData: true,
            Mode: JsonReadHelpers.Str(o, "mode") ?? string.Empty,
            Message: JsonReadHelpers.Str(o, "maintenance_message"));
    }
}

/// <summary>One projected at-a-glance health row (web <c>HealthRow</c>): status + label + summary + leading glyph.</summary>
public sealed record StatusHealthRowDisplay(HealthStatus Status, string Label, string Summary, string IconGlyph);

/// <summary>
/// One projected server-resource row (web <c>ResourceRow</c>) — a UI-free mirror of the component
/// <c>TsResourceRow</c> so the projection stays headless-testable. The view maps it onto the Fluent control.
/// </summary>
public sealed record StatusResourceRow(string Label, string ValueText, string? MetaText = null, double? Percent = null, string? IconGlyph = null);

/// <summary>One projected label/value pair (web <c>DefList</c> row) — a UI-free mirror of the component <c>TsKeyValue</c>.</summary>
public sealed record StatusKvRow(string Key, string Value);

/// <summary>The semantic severity of an action item (web <c>ActionItem.severity</c>).</summary>
public enum CalloutSeverity
{
    /// <summary>Neutral / informational.</summary>
    Info,

    /// <summary>Cautionary (non-blocking).</summary>
    Warn,

    /// <summary>Error (needs attention now).</summary>
    Error,
}

/// <summary>One projected operator action item (web <c>ActionItem</c>): severity + title + description + optional CTA.</summary>
public sealed record StatusActionItemDisplay(
    CalloutSeverity Severity,
    string Title,
    string Description,
    string CtaLabel,
    string CtaRoute,
    bool CtaExternal);

/// <summary>One projected service-component row (web Services accordion list row): status + name + raw status text.</summary>
public sealed record StatusServiceRowDisplay(HealthStatus Status, string Name, string StatusText);

/// <summary>One projected recent-error row (web errors accordion list row): code + last message + count.</summary>
public sealed record StatusErrorRowDisplay(string Code, string Message, string Count);

/// <summary>
/// The render-time data model the <c>SystemStatusPage</c> projects from — the resolved state of the seven web
/// queries plus their per-source loading / error flags (web/src/features/system/pages/SystemStatusPage.tsx). Pure
/// data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record SystemStatusModel(
    bool HealthLoading,
    bool HealthHasError,
    string? HealthError,
    SystemHealthSnapshot Health,
    bool VehiclesLoading,
    bool VehiclesHasError,
    StatusVehiclesSnapshot Vehicles,
    bool NotificationsLoading,
    bool NotificationsHasError,
    NotificationStatsSnapshot Notifications,
    bool AuthLoading,
    bool AuthHasError,
    AuthStatusSnapshot Auth,
    bool BackupRunsLoading,
    bool BackupRunsHasError,
    BackupRunsSnapshot BackupRuns,
    bool BackupConfigsLoading,
    bool BackupConfigsHasError,
    BackupConfigsSnapshot BackupConfigs,
    bool MaintenanceLoading,
    bool MaintenanceHasError,
    MaintenanceSnapshot Maintenance,
    DateTimeOffset? HealthUpdatedAt)
{
    /// <summary>The initial model — the first load, every query in flight.</summary>
    public static SystemStatusModel Initial { get; } = new(
        HealthLoading: true, HealthHasError: false, HealthError: null, Health: SystemHealthSnapshot.Empty,
        VehiclesLoading: true, VehiclesHasError: false, Vehicles: StatusVehiclesSnapshot.Empty,
        NotificationsLoading: true, NotificationsHasError: false, Notifications: NotificationStatsSnapshot.Empty,
        AuthLoading: true, AuthHasError: false, Auth: AuthStatusSnapshot.Empty,
        BackupRunsLoading: true, BackupRunsHasError: false, BackupRuns: BackupRunsSnapshot.Empty,
        BackupConfigsLoading: true, BackupConfigsHasError: false, BackupConfigs: BackupConfigsSnapshot.Empty,
        MaintenanceLoading: true, MaintenanceHasError: false, Maintenance: MaintenanceSnapshot.Empty,
        HealthUpdatedAt: null);
}

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade and every count formatted at the display boundary.
/// Reproduces all eighteen web regions (hero, update callout, health rows, action items, resources, the nine
/// accordions, the Tesla-auth card, the uptime heatmap, the SLO / subscribe / status-API surfaces). Pure data so
/// every branch is asserted headlessly.
/// </summary>
public sealed record SystemStatusDisplay
{
    /// <summary>The top-level lifecycle state (loading / empty / error / success) — the ledger summary.</summary>
    public SystemStatusState State { get; init; } = SystemStatusState.Loading;

    /// <summary>True while the page is on its very first load with no health data yet (web <c>isLoading</c>).</summary>
    public bool IsFirstLoad { get; init; }

    /// <summary>The overall instance health (drives the hero ring + headline).</summary>
    public HealthStatus OverallStatus { get; init; } = HealthStatus.Unknown;

    // ── Per-source states (web four-state matrix, one per query) ──────────────────────────────────────────
    public SystemStatusState HealthSourceState { get; init; } = SystemStatusState.Loading;
    public SystemStatusState VehiclesSourceState { get; init; } = SystemStatusState.Loading;
    public SystemStatusState NotificationsSourceState { get; init; } = SystemStatusState.Loading;
    public SystemStatusState AuthSourceState { get; init; } = SystemStatusState.Loading;
    public SystemStatusState BackupRunsSourceState { get; init; } = SystemStatusState.Loading;
    public SystemStatusState BackupConfigsSourceState { get; init; } = SystemStatusState.Loading;
    public SystemStatusState MaintenanceSourceState { get; init; } = SystemStatusState.Loading;

    // ── Header / hero ─────────────────────────────────────────────────────────────────────────────────────
    public string Title { get; init; } = string.Empty;
    public string Subtitle { get; init; } = string.Empty;
    public string RefreshLabel { get; init; } = string.Empty;
    public string RefreshAriaLabel { get; init; } = string.Empty;
    public string RunHealthCheckLabel { get; init; } = string.Empty;
    public string HeroSubline { get; init; } = string.Empty;
    public bool IsLive { get; init; }
    public bool IsStale { get; init; }
    public string ErrorBannerMessage { get; init; } = string.Empty;
    public bool ShowErrorBanner { get; init; }

    // ── Update-available callout ──────────────────────────────────────────────────────────────────────────
    public bool ShowUpdateCallout { get; init; }
    public string UpdateAvailableTitle { get; init; } = string.Empty;
    public string UpdateCurrentText { get; init; } = string.Empty;
    public string ReleaseNotesLabel { get; init; } = string.Empty;

    // ── Health summary panel ──────────────────────────────────────────────────────────────────────────────
    public string HealthTitle { get; init; } = string.Empty;
    public IReadOnlyList<StatusHealthRowDisplay> HealthRows { get; init; } = [];

    // ── Action items ──────────────────────────────────────────────────────────────────────────────────────
    public string ActionItemsTitle { get; init; } = string.Empty;
    public IReadOnlyList<StatusActionItemDisplay> ActionItems { get; init; } = [];

    // ── Resources ─────────────────────────────────────────────────────────────────────────────────────────
    public IReadOnlyList<StatusResourceRow> ResourceRows { get; init; } = [];
    public string ResourcesFootnote { get; init; } = string.Empty;

    // ── Services & components accordion ───────────────────────────────────────────────────────────────────
    public string ServicesTitle { get; init; } = string.Empty;
    public string ServicesSummary { get; init; } = string.Empty;
    public IReadOnlyList<StatusServiceRowDisplay> ServiceRows { get; init; } = [];
    public string OpenLiveMonitorLabel { get; init; } = string.Empty;

    // ── Database & connections accordion ──────────────────────────────────────────────────────────────────
    public string DatabaseTitle { get; init; } = string.Empty;
    public string DatabaseSummary { get; init; } = string.Empty;
    public IReadOnlyList<StatusKvRow> DatabaseRows { get; init; } = [];
    public string OpenDbHealthLabel { get; init; } = string.Empty;

    // ── Telemetry pipeline accordion ──────────────────────────────────────────────────────────────────────
    public string TelemetryTitle { get; init; } = string.Empty;
    public string TelemetrySummary { get; init; } = string.Empty;

    // ── Tesla auth card ───────────────────────────────────────────────────────────────────────────────────
    public HealthStatus TeslaAuthStatus { get; init; } = HealthStatus.Unknown;
    public string TeslaAuthLabel { get; init; } = string.Empty;
    public string TeslaAuthSummary { get; init; } = string.Empty;
    public bool TeslaConnected { get; init; }
    public string TeslaNotConnectedTitle { get; init; } = string.Empty;
    public string TeslaNotConnectedDesc { get; init; } = string.Empty;
    public string ConnectLabel { get; init; } = string.Empty;

    // ── Notifications & audit accordion ───────────────────────────────────────────────────────────────────
    public string NotificationsTitle { get; init; } = string.Empty;
    public string NotificationsSummary { get; init; } = string.Empty;
    public IReadOnlyList<StatusKvRow> NotificationRows { get; init; } = [];
    public string OpenNotificationsLabel { get; init; } = string.Empty;

    // ── Background workers accordion ──────────────────────────────────────────────────────────────────────
    public string WorkersTitle { get; init; } = string.Empty;
    public string WorkersSummary { get; init; } = string.Empty;
    public string WorkersUnhealthyText { get; init; } = string.Empty;

    // ── Backups accordion ─────────────────────────────────────────────────────────────────────────────────
    public string BackupsTitle { get; init; } = string.Empty;
    public string BackupsSummary { get; init; } = string.Empty;
    public bool BackupsHasRuns { get; init; }
    public string NoBackupsMessage { get; init; } = string.Empty;
    public IReadOnlyList<StatusKvRow> BackupRows { get; init; } = [];
    public string ManageBackupsLabel { get; init; } = string.Empty;

    // ── Tesla API usage accordion ─────────────────────────────────────────────────────────────────────────
    public string ApiUsageTitle { get; init; } = string.Empty;
    public string ApiUsageSummary { get; init; } = string.Empty;
    public string ApiOverBudgetTitle { get; init; } = string.Empty;
    public string ApiOverBudgetDesc { get; init; } = string.Empty;
    public string OpenApiLogsLabel { get; init; } = string.Empty;

    // ── Recent errors accordion ───────────────────────────────────────────────────────────────────────────
    public string RecentErrorsTitle { get; init; } = string.Empty;
    public string RecentErrorsSummary { get; init; } = string.Empty;
    public bool HasErrors { get; init; }
    public IReadOnlyList<StatusErrorRowDisplay> ErrorRows { get; init; } = [];
    public string NoErrorsMessage { get; init; } = string.Empty;
    public string OpenErrorLogsLabel { get; init; } = string.Empty;

    // ── System info accordion ─────────────────────────────────────────────────────────────────────────────
    public string SystemInfoTitle { get; init; } = string.Empty;
    public string SystemInfoSummary { get; init; } = string.Empty;
    public IReadOnlyList<StatusKvRow> SystemInfoRows { get; init; } = [];

    // ── Uptime heatmap ────────────────────────────────────────────────────────────────────────────────────
    public IReadOnlyList<UptimeDay> UptimeDays { get; init; } = [];
    public string UptimeFootnote { get; init; } = string.Empty;

    // ── Status-API subscribe footer ───────────────────────────────────────────────────────────────────────
    public string SubscribeLabel { get; init; } = string.Empty;

    /// <summary>The composed accessible name for the whole surface.</summary>
    public string AutomationName { get; init; } = string.Empty;
}

/// <summary>
/// Pure projection from a <see cref="SystemStatusModel"/> to its <see cref="SystemStatusDisplay"/> — the native port
/// of the render logic in web/src/features/system/pages/SystemStatusPage.tsx. Every visible literal resolves through
/// the i18n facade using the exact web key/default text; counts format through <see cref="NumberFormatting"/> (web
/// <c>fmtInt</c>); the <c>{{var}}</c> i18n templates are interpolated verbatim. Every chrome string is resolved on
/// every projection (visibility is gated by the returned flags) so the i18n contract holds in every data state.
/// No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SystemStatusProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    /// <summary>The web stale-backup threshold (days) — <c>STALE_BACKUP_DAYS</c>.</summary>
    public const int StaleBackupDays = 7;

    private const int UptimeWindowDays = 30;
    private const double StaleSeconds = 2 * 60; // web 2-minute staleness gate (ADR-013)

    private const string ServerGlyph = "\uE968";   // Server
    private const string DatabaseGlyph = "\uE9F5";  // Database/Storage
    private const string ActivityGlyph = "\uE9D9";  // Pulse/Activity
    private const string BellGlyph = "\uEA8F";      // Bell
    private const string BoxesGlyph = "\uE74C";     // Packages
    private const string ShieldGlyph = "\uEA18";    // Shield/Permissions
    private const string HardDriveGlyph = "\uEDA2"; // Hard drive

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the seven resolved web query states).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for relative-time + uptime formatting.</param>
    public static SystemStatusDisplay Project(SystemStatusModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string L(string key, string fallback) => localizer.GetString(key, fallback);

        // ── Per-source four-state resolution ────────────────────────────────────────────────────────────────
        var healthState = SourceState(model.HealthLoading, model.HealthHasError, model.Health.HasData);
        var vehiclesState = SourceState(model.VehiclesLoading, model.VehiclesHasError, model.Vehicles.HasData);
        var notifState = SourceState(model.NotificationsLoading, model.NotificationsHasError, model.Notifications.HasData);
        var authState = SourceState(model.AuthLoading, model.AuthHasError, model.Auth.HasData);
        var runsState = SourceState(model.BackupRunsLoading, model.BackupRunsHasError, model.BackupRuns.HasData);
        var configsState = SourceState(model.BackupConfigsLoading, model.BackupConfigsHasError, model.BackupConfigs.HasData);
        var maintState = SourceState(model.MaintenanceLoading, model.MaintenanceHasError, model.Maintenance.HasData);

        // ── Overall status (web overallStatus) ──────────────────────────────────────────────────────────────
        var overall = ResolveOverall(model.Health, model.Maintenance);

        bool isFirstLoad = model.HealthLoading && !model.Health.HasData;

        // ── Health staleness + hero subline (web heroSubline) ───────────────────────────────────────────────
        double ageSeconds = model.HealthUpdatedAt is { } updated
            ? Math.Max(0, (now - updated).TotalSeconds)
            : double.PositiveInfinity;
        bool stale = model.HealthHasError || (model.HealthUpdatedAt is not null && ageSeconds > StaleSeconds);
        string lastChecked = model.HealthUpdatedAt is null ? EmDash : RelativeAge(ageSeconds);
        string heroSubline = model.HealthHasError
            ? Interpolate(L("systemStatus.healthCheckFailed", "Health check failed \u2014 {{message}}"), ("message", model.HealthError ?? EmDash))
            : stale
                ? Interpolate(L("systemStatus.lastCheckedStale", "Last checked {{when}} (stale)"), ("when", lastChecked))
                : model.HealthUpdatedAt is not null
                    ? Interpolate(L("systemStatus.lastChecked", "Last checked {{when}}"), ("when", lastChecked))
                    : L("systemStatus.awaitingFirstCheck", "Awaiting first check");

        // ── Component roll-up (web components / okCount / totalCount) ────────────────────────────────────────
        var components = model.Health.Components;
        int total = components.Count;
        int ok = components.Count(c => IsOk(c.Status));
        string servicesSummary = total == 0
            ? L("systemStatus.noData", "No data")
            : Interpolate(L("systemStatus.servicesSummary", "{{ok}} / {{total}} healthy"), ("ok", ok.ToString(CultureInfo.InvariantCulture)), ("total", total.ToString(CultureInfo.InvariantCulture)));

        // ── Tesla token derivation (web teslaTokenWarn) ─────────────────────────────────────────────────────
        var token = ResolveToken(model.Auth, now);

        // ── Backup derivation (web lastSuccessfulBackup / backupStaleDays) ──────────────────────────────────
        var lastSuccessful = model.BackupRuns.Runs.FirstOrDefault(r => string.Equals(r.Status, "completed", StringComparison.OrdinalIgnoreCase));
        int? backupStaleDays = ParseStaleDays(lastSuccessful?.CompletedAt, now);
        bool hasStaleBackup = backupStaleDays is { } d && d > StaleBackupDays;
        bool hasNoBackup = model.BackupRuns.HasData && model.BackupRuns.Runs.Count == 0 && model.BackupConfigs.Count > 0;

        int vehicleCount = model.Vehicles.Count;

        // ── Health rows (web HealthRow ×6) ──────────────────────────────────────────────────────────────────
        var healthRows = new List<StatusHealthRowDisplay>
        {
            new(
                total == 0 ? HealthStatus.Unknown : ok == total ? HealthStatus.Healthy : ok > total / 2 ? HealthStatus.Degraded : HealthStatus.Unhealthy,
                L("systemStatus.services", "Services"), servicesSummary, ServerGlyph),
            new(HealthStatus.Unknown, L("systemStatus.database", "Database"), EmDash, DatabaseGlyph),
            new(
                vehicleCount > 0 ? HealthStatus.Healthy : HealthStatus.Unknown,
                L("systemStatus.telemetry", "Telemetry"), TelemetrySummary(vehicleCount, localizer), ActivityGlyph),
            new(NotificationStatus(model.Notifications), L("systemStatus.notifications", "Notifications"), NotificationsSummary(model.Notifications, localizer), BellGlyph),
            new(HealthStatus.Unknown, L("systemStatus.workers", "Workers"), EmDash, BoxesGlyph),
            new(token.Status, L("systemStatus.teslaAuth", "Tesla auth"), token.Summary, ShieldGlyph),
        };

        // ── Action items (web ActionItemsPanel children) ────────────────────────────────────────────────────
        var actionItems = BuildActionItems(model, token, hasStaleBackup, backupStaleDays, hasNoBackup, localizer);

        // ── Resources (web ResourcesPanel rows; values out of unit scope render em-dash fallbacks) ───────────
        var resourceRows = new List<StatusResourceRow>
        {
            new(L("systemStatus.storageUsed", "Storage used"), EmDash, IconGlyph: HardDriveGlyph),
            new(L("systemStatus.totalRows", "Total rows"), EmDash, IconGlyph: BoxesGlyph),
            new(L("systemStatus.workers", "Workers"), EmDash, IconGlyph: ServerGlyph),
        };

        // ── Services list (web components map) ──────────────────────────────────────────────────────────────
        var serviceRows = components
            .Select(c => new StatusServiceRowDisplay(ResolveComponentStatus(c.Status), c.Name, c.Status))
            .ToList();

        // ── Database key/values (web DefList; pool/size/rows out of unit scope) ─────────────────────────────
        var databaseRows = new List<StatusKvRow>
        {
            new(L("systemStatus.latency", "Latency"), EmDash),
            new(L("systemStatus.poolAcquired", "Pool acquired"), EmDash),
            new(L("systemStatus.poolIdle", "Pool idle"), EmDash),
            new(L("systemStatus.storageUsed", "Storage used"), EmDash),
            new(L("systemStatus.tables", "Tables"), EmDash),
            new(L("systemStatus.totalRows", "Total rows"), EmDash),
        };

        // ── Notification key/values (web DefList) ───────────────────────────────────────────────────────────
        var notif = model.Notifications;
        var notificationRows = new List<StatusKvRow>
        {
            new(L("systemStatus.channels", "Channels"), notif.HasData ? Interpolate(L("systemStatus.channelsValue", "{{enabled}} of {{total}} enabled"), ("enabled", notif.EnabledChannels.ToString(CultureInfo.InvariantCulture)), ("total", notif.TotalChannels.ToString(CultureInfo.InvariantCulture))) : EmDash),
            new(L("systemStatus.sentLifetime", "Sent (lifetime)"), notif.HasData ? FmtInt(notif.Sent) : EmDash),
            new(L("systemStatus.pending", "Pending"), notif.HasData ? FmtInt(notif.Pending) : EmDash),
            new(L("systemStatus.failed", "Failed"), notif.HasData ? FmtInt(notif.Failed) : EmDash),
        };

        // ── Backups derivation (web Backups accordion) ──────────────────────────────────────────────────────
        string backupsSummary = lastSuccessful?.CompletedAt is not null
            ? backupStaleDays == 0
                ? L("systemStatus.lastBackupToday", "Last backup: today")
                : Interpolate(L("systemStatus.lastBackupDaysAgo", "Last backup: {{days}}d ago"), ("days", (backupStaleDays ?? 0).ToString(CultureInfo.InvariantCulture)))
            : model.BackupConfigs.Count > 0
                ? L("systemStatus.configuredNoRun", "Configured \u00b7 no successful run yet")
                : L("systemStatus.notConfigured", "Not configured");

        int recentFailures = model.BackupRuns.Runs.Count(r => string.Equals(r.Status, "failed", StringComparison.OrdinalIgnoreCase));
        var backupRows = new List<StatusKvRow>
        {
            new(L("systemStatus.configuredSchedules", "Configured schedules"), model.BackupConfigs.Count.ToString(CultureInfo.InvariantCulture)),
            new(L("systemStatus.totalRuns", "Total runs"), model.BackupRuns.Runs.Count.ToString(CultureInfo.InvariantCulture)),
            new(L("systemStatus.lastSuccessful", "Last successful"), FormatTimestamp(lastSuccessful?.CompletedAt, now)),
            new(L("systemStatus.lastSuccessfulSize", "Last successful size"), lastSuccessful?.FileSize is { } size ? FormatBytes(size) : EmDash),
            new(L("systemStatus.failuresRecent", "Failures (recent)"), recentFailures.ToString(CultureInfo.InvariantCulture)),
        };

        // ── System info (web SystemInfoRows; version/runtime out of unit scope) ─────────────────────────────
        var systemInfoRows = new List<StatusKvRow>
        {
            new(L("systemStatus.systemInfoCpuNote", "CPU %, memory bytes, and disk usage need a new /system/resources endpoint (Phase 2)."), string.Empty),
        };

        // ── Uptime heatmap (web uptimeDays — today = current status, prior days healthy) ────────────────────
        var uptimeDays = BuildUptimeDays(overall, now);

        // ── Top-level state summary ─────────────────────────────────────────────────────────────────────────
        var sourceStates = new[] { healthState, vehiclesState, notifState, authState, runsState, configsState, maintState };
        SystemStatusState state = model.HealthHasError
            ? SystemStatusState.Error
            : isFirstLoad
                ? SystemStatusState.Loading
                : sourceStates.Any(s => s == SystemStatusState.Success)
                    ? SystemStatusState.Success
                    : sourceStates.Any(s => s == SystemStatusState.Loading)
                        ? SystemStatusState.Loading
                        : SystemStatusState.Empty;

        string title = L("systemStatus.title", "System Status");

        return new SystemStatusDisplay
        {
            State = state,
            IsFirstLoad = isFirstLoad,
            OverallStatus = stale ? HealthStatus.Unknown : overall,
            HealthSourceState = healthState,
            VehiclesSourceState = vehiclesState,
            NotificationsSourceState = notifState,
            AuthSourceState = authState,
            BackupRunsSourceState = runsState,
            BackupConfigsSourceState = configsState,
            MaintenanceSourceState = maintState,

            Title = title,
            Subtitle = L("systemStatus.subtitle", "At-a-glance health for your TeslaSync instance"),
            RefreshLabel = L("systemStatus.refresh", "Refresh"),
            RefreshAriaLabel = L("systemStatus.refreshAria", "Refresh (R)"),
            RunHealthCheckLabel = L("systemStatus.runHealthCheck", "Run health check"),
            HeroSubline = heroSubline,
            IsLive = model.HealthUpdatedAt is not null && !stale,
            IsStale = stale,
            ShowErrorBanner = model.HealthHasError,
            ErrorBannerMessage = model.HealthError ?? string.Empty,

            ShowUpdateCallout = false,
            UpdateAvailableTitle = Interpolate(L("systemStatus.updateAvailable", "Update available \u2014 v{{version}}"), ("version", EmDash)),
            UpdateCurrentText = Interpolate(L("systemStatus.currentVersion", "Current: v{{current}}"), ("current", EmDash)),
            ReleaseNotesLabel = L("systemStatus.releaseNotes", "Release notes"),

            HealthTitle = L("systemStatus.health", "Health"),
            HealthRows = healthRows,

            ActionItemsTitle = L("systemStatus.needsAttention", "Needs your attention"),
            ActionItems = actionItems,

            ResourceRows = resourceRows,
            ResourcesFootnote = L("systemStatus.resourcesFootnote", "CPU %, memory bytes, and disk usage need a new /system/resources endpoint (Phase 2)."),

            ServicesTitle = L("systemStatus.servicesTitle", "Services & components"),
            ServicesSummary = servicesSummary,
            ServiceRows = serviceRows,
            OpenLiveMonitorLabel = L("systemStatus.openLiveMonitor", "Open Live Monitor"),

            DatabaseTitle = L("systemStatus.databaseTitle", "Database & connections"),
            DatabaseSummary = EmDash,
            DatabaseRows = databaseRows,
            OpenDbHealthLabel = L("systemStatus.openDbHealth", "Open DB Health"),

            TelemetryTitle = L("systemStatus.telemetryTitle", "Telemetry pipeline"),
            TelemetrySummary = TelemetrySummary(vehicleCount, localizer),

            TeslaAuthStatus = token.Status,
            TeslaAuthLabel = L("systemStatus.teslaAuth", "Tesla auth"),
            TeslaAuthSummary = token.Summary,
            TeslaConnected = model.Auth.HasAuthenticated && model.Auth.Authenticated,
            TeslaNotConnectedTitle = L("systemStatus.notConnected", "Tesla account not connected"),
            TeslaNotConnectedDesc = L("systemStatus.notConnectedDesc", "Connect your Tesla account to fetch vehicle data"),
            ConnectLabel = L("systemStatus.connect", "Connect"),

            NotificationsTitle = L("systemStatus.notificationsTitle", "Notifications & audit"),
            NotificationsSummary = NotificationsSummary(model.Notifications, localizer),
            NotificationRows = notificationRows,
            OpenNotificationsLabel = L("systemStatus.openNotifications", "Open Notifications"),

            WorkersTitle = L("systemStatus.workersTitle", "Background workers"),
            WorkersSummary = EmDash,
            WorkersUnhealthyText = Interpolate(L("systemStatus.workersUnhealthy", "{{down}} of {{total}} workers unhealthy"), ("down", EmDash), ("total", EmDash)),

            BackupsTitle = L("systemStatus.backups", "Backups"),
            BackupsSummary = backupsSummary,
            BackupsHasRuns = model.BackupRuns.Runs.Count > 0 || model.BackupConfigs.Count > 0,
            NoBackupsMessage = L("systemStatus.noBackups", "No backups recorded"),
            BackupRows = backupRows,
            ManageBackupsLabel = L("systemStatus.manageBackups", "Manage backups"),

            ApiUsageTitle = L("systemStatus.apiUsageTitle", "Tesla API usage"),
            ApiUsageSummary = Interpolate(L("systemStatus.apiUsageDesc", "{{cost}} of {{credit}} estimated this period"), ("cost", EmDash), ("credit", EmDash)),
            ApiOverBudgetTitle = Interpolate(L("systemStatus.apiOverBudget", "Tesla API estimated cost {{cost}} exceeds {{credit}} monthly credit"), ("cost", EmDash), ("credit", EmDash)),
            ApiOverBudgetDesc = L("systemStatus.apiOverBudgetDesc", "Review polling cadence or vehicle subscriptions"),
            OpenApiLogsLabel = L("systemStatus.openApiLogs", "Open Tesla API logs"),

            RecentErrorsTitle = L("systemStatus.recentErrors", "Recent errors"),
            RecentErrorsSummary = Interpolate(L("systemStatus.errorsSince", "{{count}} since {{uptime}} ago"), ("count", "0"), ("uptime", EmDash)),
            HasErrors = false,
            ErrorRows = [],
            NoErrorsMessage = L("systemStatus.noErrors", "No errors recorded recently."),
            OpenErrorLogsLabel = L("systemStatus.openErrorLogs", "Open error logs"),

            SystemInfoTitle = L("systemStatus.systemInfo", "System info"),
            SystemInfoSummary = L("systemStatus.systemInfoDesc", "Version, build, runtime"),
            SystemInfoRows = systemInfoRows,

            UptimeDays = uptimeDays,
            UptimeFootnote = L("systemStatus.uptimeFootnote", "Today reflects the current status. Day-level historical data ships with the backend health-history endpoint in Phase 2."),

            SubscribeLabel = L("systemStatus.subscribe", "Stable Status API for your own dashboards"),

            AutomationName = $"{title}: {servicesSummary}",
        };
    }

    /// <summary>Format a count with en-US grouping (web <c>fmtInt</c>).</summary>
    public static string FmtInt(long value) => NumberFormatting.Format(value, null, 0);

    /// <summary>Format a byte count (web <c>formatBytes</c>: B exact, KB/MB one decimal, GB two decimals).</summary>
    public static string FormatBytes(double bytes)
    {
        if (bytes < 1024)
        {
            return $"{(long)bytes} B";
        }

        if (bytes < 1024 * 1024)
        {
            return $"{(bytes / 1024).ToString("F1", CultureInfo.InvariantCulture)} KB";
        }

        if (bytes < 1024 * 1024 * 1024)
        {
            return $"{(bytes / (1024 * 1024)).ToString("F1", CultureInfo.InvariantCulture)} MB";
        }

        return $"{(bytes / (1024d * 1024 * 1024)).ToString("F2", CultureInfo.InvariantCulture)} GB";
    }

    /// <summary>Replace each <c>{{name}}</c> token in an i18n template with its value (web i18next interpolation).</summary>
    public static string Interpolate(string template, params (string Name, string Value)[] values)
    {
        ArgumentNullException.ThrowIfNull(template);
        string result = template;
        foreach (var (name, value) in values)
        {
            result = result.Replace("{{" + name + "}}", value, StringComparison.Ordinal);
        }

        return result;
    }

    private static SystemStatusState SourceState(bool loading, bool error, bool hasData)
    {
        if (error)
        {
            return SystemStatusState.Error;
        }

        if (hasData)
        {
            return SystemStatusState.Success;
        }

        return loading ? SystemStatusState.Loading : SystemStatusState.Empty;
    }

    private static HealthStatus ResolveOverall(SystemHealthSnapshot health, MaintenanceSnapshot maintenance)
    {
        if (maintenance.IsActive)
        {
            return HealthStatus.Maintenance;
        }

        if (!health.HasData)
        {
            return HealthStatus.Unknown;
        }

        return health.Status.ToLowerInvariant() switch
        {
            "healthy" or "ok" => HealthStatus.Healthy,
            "degraded" or "warning" => HealthStatus.Degraded,
            "unhealthy" or "down" or "offline" => HealthStatus.Unhealthy,
            _ => HealthStatus.Unknown,
        };
    }

    private static HealthStatus ResolveComponentStatus(string status) => status.ToLowerInvariant() switch
    {
        "ok" or "healthy" => HealthStatus.Healthy,
        "degraded" or "warning" => HealthStatus.Degraded,
        "unhealthy" or "down" or "offline" or "error" => HealthStatus.Unhealthy,
        _ => HealthStatus.Unknown,
    };

    private static bool IsOk(string status) =>
        string.Equals(status, "ok", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(status, "healthy", StringComparison.OrdinalIgnoreCase);

    private static HealthStatus NotificationStatus(NotificationStatsSnapshot notif) =>
        !notif.HasData ? HealthStatus.Unknown : notif.Failed > 0 ? HealthStatus.Degraded : HealthStatus.Healthy;

    private static string NotificationsSummary(NotificationStatsSnapshot notif, ILocalizer localizer)
    {
        if (!notif.HasData)
        {
            return localizer.GetString("systemStatus.operational", "operational");
        }

        if (notif.EnabledChannels == 0)
        {
            return localizer.GetString("systemStatus.noChannels", "No channels configured");
        }

        return Interpolate(
            localizer.GetString("systemStatus.notificationsSummary", "{{enabled}}/{{total}} channels \u00b7 {{sent}} sent"),
            ("enabled", notif.EnabledChannels.ToString(CultureInfo.InvariantCulture)),
            ("total", notif.TotalChannels.ToString(CultureInfo.InvariantCulture)),
            ("sent", FmtInt(notif.Sent)));
    }

    private static string TelemetrySummary(int vehicleCount, ILocalizer localizer) => vehicleCount > 0
        ? Interpolate(
            localizer.GetString(
                vehicleCount == 1 ? "systemStatus.telemetrySummaryOne" : "systemStatus.telemetrySummaryMany",
                vehicleCount == 1 ? "{{count}} vehicle" : "{{count}} vehicles"),
            ("count", vehicleCount.ToString(CultureInfo.InvariantCulture)))
        : localizer.GetString("systemStatus.telemetryIdle", "operational \u00b7 0 vehicles (idle)");

    private readonly record struct TokenInfo(HealthStatus Status, string Summary, CalloutSeverity? WarnSeverity, int Days);

    private static TokenInfo ResolveToken(AuthStatusSnapshot auth, DateTimeOffset now)
    {
        CalloutSeverity? warn = null;
        int days = 0;
        if (!string.IsNullOrWhiteSpace(auth.ExpiresAt) &&
            DateTimeOffset.TryParse(auth.ExpiresAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var exp))
        {
            days = (int)Math.Floor((exp - now).TotalDays);
            if (days < 0)
            {
                warn = CalloutSeverity.Error;
            }
            else if (days <= 7)
            {
                warn = CalloutSeverity.Warn;
            }
        }

        HealthStatus status = warn == CalloutSeverity.Error ? HealthStatus.Unhealthy
            : warn == CalloutSeverity.Warn ? HealthStatus.Degraded
            : auth.HasAuthenticated && !auth.Authenticated ? HealthStatus.Unhealthy
            : auth.HasAuthenticated && auth.Authenticated ? HealthStatus.Healthy
            : HealthStatus.Unknown;

        string summary = warn == CalloutSeverity.Error ? "Token expired"
            : warn == CalloutSeverity.Warn ? $"Expires in {days}d"
            : auth.HasAuthenticated && auth.Authenticated ? "Connected"
            : "Not connected";

        return new TokenInfo(status, summary, warn, days);
    }

    private static List<StatusActionItemDisplay> BuildActionItems(
        SystemStatusModel model, TokenInfo token, bool hasStaleBackup, int? backupStaleDays, bool hasNoBackup, ILocalizer localizer)
    {
        string L(string key, string fallback) => localizer.GetString(key, fallback);
        var items = new List<StatusActionItemDisplay>();

        if (model.Maintenance.IsActive)
        {
            items.Add(new StatusActionItemDisplay(
                CalloutSeverity.Info,
                L("systemStatus.maintenanceActive", "Maintenance mode is active"),
                string.IsNullOrWhiteSpace(model.Maintenance.Message) ? L("systemStatus.maintenanceActiveDesc", "System is in operator-set maintenance mode") : model.Maintenance.Message!,
                L("systemStatus.manage", "Manage"), "system-status", false));
        }

        if (token.WarnSeverity == CalloutSeverity.Error)
        {
            items.Add(new StatusActionItemDisplay(
                CalloutSeverity.Error,
                L("systemStatus.tokenExpired", "Tesla token expired"),
                L("systemStatus.tokenExpiredDesc", "Sign in again to resume Tesla-backed features"),
                L("systemStatus.reauthenticate", "Re-authenticate"), "tesla-account", false));
        }
        else if (token.WarnSeverity == CalloutSeverity.Warn)
        {
            items.Add(new StatusActionItemDisplay(
                CalloutSeverity.Warn,
                Interpolate(L("systemStatus.tokenExpiring", "Tesla token expires in {{days}} day(s)"), ("days", token.Days.ToString(CultureInfo.InvariantCulture))),
                L("systemStatus.tokenExpiringDesc", "Refresh to avoid disruption"),
                L("systemStatus.reauthenticate", "Re-authenticate"), "tesla-account", false));
        }
        else if (model.Auth.HasAuthenticated && !model.Auth.Authenticated)
        {
            items.Add(new StatusActionItemDisplay(
                CalloutSeverity.Warn,
                L("systemStatus.notConnected", "Tesla account not connected"),
                L("systemStatus.notConnectedDesc", "Connect your Tesla account to fetch vehicle data"),
                L("systemStatus.connect", "Connect"), "tesla-account", false));
        }

        if (hasStaleBackup)
        {
            items.Add(new StatusActionItemDisplay(
                CalloutSeverity.Warn,
                Interpolate(L("systemStatus.staleBackup", "Last backup is {{days}} days old"), ("days", (backupStaleDays ?? 0).ToString(CultureInfo.InvariantCulture))),
                L("systemStatus.staleBackupDesc", "Run a backup or check the schedule"),
                L("systemStatus.manageBackups", "Manage backups"), "backup", false));
        }

        if (hasNoBackup)
        {
            items.Add(new StatusActionItemDisplay(
                CalloutSeverity.Warn,
                L("systemStatus.noBackups", "No backups recorded"),
                L("systemStatus.noBackupsDesc", "Configure a schedule or run one now"),
                L("systemStatus.setUpBackups", "Set up backups"), "backup", false));
        }

        return items;
    }

    private static List<UptimeDay> BuildUptimeDays(HealthStatus overall, DateTimeOffset now)
    {
        var days = new List<UptimeDay>(UptimeWindowDays);
        for (int i = UptimeWindowDays - 1; i >= 0; i--)
        {
            var date = now.AddDays(-i);
            string iso = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            days.Add(new UptimeDay(iso, i == 0 ? overall : HealthStatus.Healthy));
        }

        return days;
    }

    private static int? ParseStaleDays(string? completedAt, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(completedAt) ||
            !DateTimeOffset.TryParse(completedAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var when))
        {
            return null;
        }

        return (int)Math.Floor((now - when).TotalDays);
    }

    private static string RelativeAge(double seconds)
    {
        if (seconds < 60)
        {
            return $"{(int)seconds}s ago";
        }

        if (seconds < 3600)
        {
            return $"{(int)(seconds / 60)}m ago";
        }

        return $"{(int)(seconds / 3600)}h ago";
    }

    private static string FormatTimestamp(string? raw, DateTimeOffset now)
    {
        if (!string.IsNullOrWhiteSpace(raw) &&
            DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var value))
        {
            return DateTimeFormatting.Format(value, DateTimeVariant.Full, now);
        }

        return EmDash;
    }
}

/// <summary>
/// The data port the <see cref="SystemStatusPageViewModel"/> reads the seven status queries through — the native
/// parity of the web <c>useSystemHealth</c> / <c>useVehicles</c> / <c>useNotificationStats</c> / <c>useAuthStatus</c>
/// / <c>useBackupRuns</c> / <c>useBackupConfigs</c> / <c>useMaintenanceState</c> hooks. The view never performs HTTP
/// itself; the default <see cref="EmptySystemStatusFeed"/> resolves to the empty states, and the generated-client
/// backed <see cref="SystemStatusClientFeed"/> binds to the generated OpenAPI contract client (ADR-004). A failing
/// fetch throws so the view-model can surface the per-source error / empty branches.
/// </summary>
public interface ISystemStatusFeed
{
    /// <summary>Resolve the system-health snapshot (web <c>useSystemHealth</c>).</summary>
    Task<SystemHealthSnapshot> FetchHealthAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the vehicle-count snapshot (web <c>useVehicles</c>).</summary>
    Task<StatusVehiclesSnapshot> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the notification-stats snapshot (web <c>useNotificationStats</c>).</summary>
    Task<NotificationStatsSnapshot> FetchNotificationsAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the Tesla-auth snapshot (web <c>useAuthStatus</c>).</summary>
    Task<AuthStatusSnapshot> FetchAuthAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the backup-runs snapshot (web <c>useBackupRuns</c>).</summary>
    Task<BackupRunsSnapshot> FetchBackupRunsAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the backup-configs snapshot (web <c>useBackupConfigs</c>).</summary>
    Task<BackupConfigsSnapshot> FetchBackupConfigsAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the maintenance-mode snapshot (web <c>useMaintenanceState</c>).</summary>
    Task<MaintenanceSnapshot> FetchMaintenanceAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every fetch to the empty snapshot (the empty data states).</summary>
public sealed class EmptySystemStatusFeed : ISystemStatusFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySystemStatusFeed Instance { get; } = new();

    private EmptySystemStatusFeed()
    {
    }

    /// <inheritdoc />
    public Task<SystemHealthSnapshot> FetchHealthAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(SystemHealthSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<StatusVehiclesSnapshot> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(StatusVehiclesSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<NotificationStatsSnapshot> FetchNotificationsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(NotificationStatsSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<AuthStatusSnapshot> FetchAuthAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(AuthStatusSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<BackupRunsSnapshot> FetchBackupRunsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(BackupRunsSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<BackupConfigsSnapshot> FetchBackupConfigsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(BackupConfigsSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<MaintenanceSnapshot> FetchMaintenanceAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(MaintenanceSnapshot.Empty);
    }
}

/// <summary>
/// Canonical metadata for the <c>SystemStatusPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/system/pages/SystemStatusPage.tsx</c> (route <c>/system-status</c>, nav name
/// <c>SystemStatus</c>, group System Ops).
/// </summary>
public static class SystemStatusRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SystemStatusPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>SystemStatus</c>).</summary>
    public const string RouteName = "SystemStatus";

    /// <summary>The route path (web <c>/system-status</c>).</summary>
    public const string RoutePath = "system-status";

    /// <summary>Generated operation id for the system-health query (web <c>useSystemHealth</c>).</summary>
    public const string HealthOperation = "get_api_v1_system_health";

    /// <summary>Generated operation id for the vehicle list (web <c>useVehicles</c>).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>Generated operation id for the notification-stats query (web <c>useNotificationStats</c>).</summary>
    public const string NotificationsOperation = "get_api_v1_notifications_stats";

    /// <summary>Generated operation id for the Tesla-auth query (web <c>useAuthStatus</c>).</summary>
    public const string AuthOperation = "get_api_v1_auth_status";

    /// <summary>Generated operation id for the backup-runs query (web <c>useBackupRuns</c>).</summary>
    public const string BackupRunsOperation = "get_api_v1_backup_runs";

    /// <summary>Generated operation id for the backup-configs query (web <c>useBackupConfigs</c>).</summary>
    public const string BackupConfigsOperation = "get_api_v1_backup_configs";

    /// <summary>Generated operation id for the maintenance-mode query (web <c>useMaintenanceState</c>).</summary>
    public const string MaintenanceOperation = "get_api_v1_admin_maintenance";

    /// <summary>The localized page title (web <c>System Status</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("systemStatus.title", "System Status");
    }
}

/// <summary>
/// Tolerant snake_case JSON readers shared by the <c>SystemStatusPage</c> snapshot parsers — kept internal to the
/// System-Ops feature namespace so each surface stays self-contained (the same per-feature pattern as DBHealthPage).
/// </summary>
internal static class JsonReadHelpers
{
    public static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static long? Long(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.Number when v.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static bool? Bool(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }
}
