using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>FleetAPIPage</c> surface — the native mirror of the data states
/// the web page renders (web/src/features/admin/pages/FleetAPIPage.tsx). The web page composes four queries
/// (<c>useSettings</c>, <c>usePollingConfig</c>, <c>useCaptureStats</c>, <c>useVersionInfo</c>); the polling /
/// endpoint-control panels render once the config resolves while the "API Endpoints" panel shows either the configured
/// endpoint list (web <c>version.endpoints</c>) or the <c>common.noData</c> empty state. This enum carries the
/// three declared states the manifest requires — <see cref="Loading"/> while the first read is in flight,
/// <see cref="Empty"/> once it resolves with no configured endpoints (the web EmptyState branch) and
/// <see cref="Success"/> when the configured endpoints render — and the per-region visibility is driven off the
/// projected flags so the body renders exactly as the web composes it.
/// </summary>
public enum FleetApiState
{
    /// <summary>The first read is in flight — the page shows the loading spinner (Fluent shimmer).</summary>
    Loading,

    /// <summary>The reads resolved with no configured endpoints — the "API Endpoints" panel shows the empty state.</summary>
    Empty,

    /// <summary>The reads resolved with configured endpoints — the full surface renders.</summary>
    Success,
}

/// <summary>
/// The transient mutation outcome the page surfaces as a toast / InfoBar — the native analogue of the web
/// <c>toast.*</c> calls the page raises after the suspend toggle and the polling-config writes.
/// </summary>
public enum FleetApiNoticeKind
{
    /// <summary>No notice is shown.</summary>
    None,

    /// <summary>Tesla API polling was suspended (web info toast "API suspended").</summary>
    ApiSuspended,

    /// <summary>Tesla API polling was resumed (web success toast "API resumed").</summary>
    ApiResumed,

    /// <summary>The suspend toggle failed (web error toast "Failed").</summary>
    SuspendFailed,

    /// <summary>A polling-config write succeeded (web success toast "Polling config updated").</summary>
    PollingUpdated,

    /// <summary>A polling-config write failed (web error toast "Failed to update polling config").</summary>
    PollingFailed,
}

/// <summary>
/// The settings read marker — the native analogue of <c>useSettings().data</c>. The page only consumes the Tesla
/// API kill-switch flag (web <c>settings?.api_suspended</c>); the tolerant parser accepts the bare settings object and
/// the platform <c>{data:…}</c> envelope. Pure data.
/// </summary>
/// <param name="HasData">Whether the settings read returned an object (web <c>settings != null</c>).</param>
/// <param name="ApiSuspended">Whether Tesla Fleet API polling is suspended (web <c>settings.api_suspended</c>).</param>
public sealed record FleetSettingsSnapshot(bool HasData, bool ApiSuspended)
{
    /// <summary>The empty settings read (no object) — the headless / default result.</summary>
    public static FleetSettingsSnapshot Empty { get; } = new(false, false);

    /// <summary>Parse a settings read, tolerating the bare object and the platform <c>{data:…}</c> envelope.</summary>
    public static FleetSettingsSnapshot FromJson(JsonElement root)
    {
        JsonElement o = Unwrap(root);
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new FleetSettingsSnapshot(true, JsonReadHelpers.Bool(o, "api_suspended") ?? false);
    }

    internal static JsonElement Unwrap(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data) &&
            data.ValueKind is JsonValueKind.Object)
        {
            return data;
        }

        return root;
    }
}

/// <summary>
/// The polling-configuration read — the native mirror of the web <c>PollingConfig</c>
/// (web/src/api/hooks/useSettings.ts): a map of per-endpoint on/off flags plus the telemetry-capture retention window.
/// Every boolean property the server returns is preserved (so the write path round-trips unknown flags losslessly,
/// matching the web spread <c>{ ...pollingConfig, [key]: !pollingConfig[key] }</c>); the retention defaults to 7 days
/// when absent (web <c>telemetry_capture_retention_days || 7</c>). Pure data; parsing is null-tolerant.
/// </summary>
/// <param name="HasData">Whether the config resolved (web <c>pollingConfig != null</c>).</param>
/// <param name="Toggles">The per-endpoint on/off flags, keyed by the Go snake_case field name.</param>
/// <param name="RetentionDays">The telemetry-capture retention window in days (web default 7).</param>
public sealed record PollingConfigSnapshot(
    bool HasData,
    IReadOnlyDictionary<string, bool> Toggles,
    int RetentionDays)
{
    /// <summary>The telemetry-capture retention field name (web <c>telemetry_capture_retention_days</c>).</summary>
    public const string RetentionField = "telemetry_capture_retention_days";

    /// <summary>The empty config (not yet resolved) — the headless / default result.</summary>
    public static PollingConfigSnapshot Empty { get; } =
        new(false, new Dictionary<string, bool>(StringComparer.Ordinal), 7);

    /// <summary>True when the named endpoint flag is present and enabled (web <c>!!pollingConfig[key]</c>).</summary>
    public bool IsEnabled(string key) => Toggles.TryGetValue(key, out var on) && on;

    /// <summary>
    /// Read the polling config from JSON, tolerating missing / null fields and the platform <c>{data:…}</c> envelope.
    /// Every boolean property is captured into <see cref="Toggles"/>; the retention number is read separately.
    /// </summary>
    public static PollingConfigSnapshot FromJson(JsonElement root)
    {
        JsonElement o = FleetSettingsSnapshot.Unwrap(root);
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var toggles = new Dictionary<string, bool>(StringComparer.Ordinal);
        foreach (var property in o.EnumerateObject())
        {
            if (property.Value.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                toggles[property.Name] = property.Value.GetBoolean();
            }
        }

        int retention = JsonReadHelpers.Int(o, RetentionField) ?? 0;
        if (retention <= 0)
        {
            retention = 7;
        }

        return new PollingConfigSnapshot(true, toggles, retention);
    }

    /// <summary>
    /// Build the write payload (web <c>{ ...pollingConfig, [key]: value }</c>) for a single-flag flip, preserving every
    /// other known flag and the retention window. The result is a snake_case JSON-ready map the feed serialises verbatim.
    /// </summary>
    public IReadOnlyDictionary<string, object> WithToggle(string key, bool value)
    {
        var payload = BasePayload();
        payload[key] = value;
        return payload;
    }

    /// <summary>Build the write payload with a new retention window (web retention <c>Select</c> change).</summary>
    public IReadOnlyDictionary<string, object> WithRetention(int days)
    {
        var payload = BasePayload();
        payload[RetentionField] = days;
        return payload;
    }

    private Dictionary<string, object> BasePayload()
    {
        var payload = new Dictionary<string, object>(StringComparer.Ordinal);
        foreach (var (key, value) in Toggles)
        {
            payload[key] = value;
        }

        payload[RetentionField] = RetentionDays;
        return payload;
    }
}

/// <summary>
/// The telemetry-capture statistics read — the native mirror of the web <c>CaptureStats</c>: whether MongoDB is wired,
/// the total captured-document count and the number of distinct VINs seen. Pure data; parsing is null-tolerant.
/// </summary>
/// <param name="HasData">Whether the stats read resolved (web <c>captureStats != null</c>).</param>
/// <param name="MongoEnabled">Whether MongoDB capture is configured (web <c>captureStats.mongodb_enabled</c>).</param>
/// <param name="TotalDocuments">Total captured documents (web <c>captureStats.total_documents</c>).</param>
/// <param name="DistinctVinCount">Number of distinct VINs (web <c>captureStats.distinct_vins.length</c>).</param>
public sealed record CaptureStatsSnapshot(
    bool HasData,
    bool MongoEnabled,
    long TotalDocuments,
    int DistinctVinCount)
{
    /// <summary>The empty stats read — the headless / default result.</summary>
    public static CaptureStatsSnapshot Empty { get; } = new(false, false, 0, 0);

    /// <summary>Read the capture stats from JSON, tolerating missing / null fields and the <c>{data:…}</c> envelope.</summary>
    public static CaptureStatsSnapshot FromJson(JsonElement root)
    {
        JsonElement o = FleetSettingsSnapshot.Unwrap(root);
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        int vins = 0;
        if (o.TryGetProperty("distinct_vins", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            vins = arr.GetArrayLength();
        }

        return new CaptureStatsSnapshot(
            HasData: true,
            MongoEnabled: JsonReadHelpers.Bool(o, "mongodb_enabled") ?? false,
            TotalDocuments: JsonReadHelpers.Long(o, "total_documents") ?? 0,
            DistinctVinCount: vins);
    }
}

/// <summary>
/// The server version read — the native mirror of the web <c>VersionInfo</c>: the chart / Go / OS / arch identity and
/// the configured-endpoint URL map (web <c>version.endpoints</c>). Pure data; parsing is null-tolerant.
/// </summary>
public sealed record FleetVersionSnapshot(
    bool HasData,
    string ChartVersion,
    string GoVersion,
    string Os,
    string Arch,
    IReadOnlyDictionary<string, string> Endpoints)
{
    /// <summary>The empty version read — the headless / default result.</summary>
    public static FleetVersionSnapshot Empty { get; } =
        new(false, string.Empty, string.Empty, string.Empty, string.Empty, new Dictionary<string, string>(StringComparer.Ordinal));

    /// <summary>Read the version info from JSON, tolerating missing / null fields and the <c>{data:…}</c> envelope.</summary>
    public static FleetVersionSnapshot FromJson(JsonElement root)
    {
        JsonElement o = FleetSettingsSnapshot.Unwrap(root);
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var endpoints = new Dictionary<string, string>(StringComparer.Ordinal);
        if (o.TryGetProperty("endpoints", out var map) && map.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in map.EnumerateObject())
            {
                if (property.Value.ValueKind == JsonValueKind.String)
                {
                    endpoints[property.Name] = property.Value.GetString() ?? string.Empty;
                }
            }
        }

        return new FleetVersionSnapshot(
            HasData: true,
            ChartVersion: JsonReadHelpers.Str(o, "chart_version") ?? string.Empty,
            GoVersion: JsonReadHelpers.Str(o, "go_version") ?? string.Empty,
            Os: JsonReadHelpers.Str(o, "os") ?? string.Empty,
            Arch: JsonReadHelpers.Str(o, "arch") ?? string.Empty,
            Endpoints: endpoints);
    }
}

/// <summary>The result of a Fleet API mutation (suspend toggle / polling-config write) — success or failure.</summary>
/// <param name="Success">Whether the mutation succeeded (web mutation <c>onSuccess</c> vs <c>onError</c>).</param>
public sealed record FleetMutationOutcome(bool Success)
{
    /// <summary>The success outcome.</summary>
    public static FleetMutationOutcome Ok { get; } = new(true);

    /// <summary>The failure outcome.</summary>
    public static FleetMutationOutcome Fail { get; } = new(false);
}

/// <summary>
/// One endpoint toggle row (web <c>EndpointToggle</c>) — the snake_case config key, the localized label + description
/// and the resolved on/off state. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record FleetApiEndpointItem(string Key, string Label, string Description, bool Enabled);

/// <summary>One configured-endpoint row (web <c>API Endpoints</c> list) — the localized label and the resolved URL.</summary>
public sealed record FleetApiConfiguredEndpoint(string Label, string Url);

/// <summary>One retention-window option (web retention <c>Select</c>) — the day value and its localized label.</summary>
public sealed record FleetApiRetentionOption(int Days, string Label);

/// <summary>The resolved, render-ready mutation notice (web toast) — its kind plus localized title and message.</summary>
public sealed record FleetApiNoticeDisplay(FleetApiNoticeKind Kind, string Title, string Message)
{
    /// <summary>The no-notice marker.</summary>
    public static FleetApiNoticeDisplay None { get; } = new(FleetApiNoticeKind.None, string.Empty, string.Empty);

    /// <summary>True when a notice should be shown (web parity: a toast is pending).</summary>
    public bool HasNotice => Kind != FleetApiNoticeKind.None;
}

/// <summary>
/// The data port the <see cref="FleetAPIPageViewModel"/> binds to (P1/S8 state-holder seam) — the native analogue of
/// the web page's six hooks (web/src/api/hooks/useSettings.ts): four reads (<c>useSettings</c>, <c>usePollingConfig</c>,
/// <c>useCaptureStats</c>, <c>useVersionInfo</c>) and two mutations (<c>useToggleAPISuspend</c>,
/// <c>useUpdatePollingConfig</c>). The view never performs HTTP itself; the default <see cref="EmptyFleetApiFeed"/>
/// resolves to the empty snapshots, and the generated-client-backed <see cref="FleetApiClientFeed"/> binds to the
/// generated OpenAPI contract client (ADR-004). Reads throw on a transport / HTTP fault; mutations resolve to a typed
/// outcome (web parity: the mutation surfaces a toast and the read is re-run).
/// </summary>
public interface IFleetApiFeed
{
    /// <summary>Resolve the settings read (web <c>useSettings</c> → <c>GET /settings</c>).</summary>
    Task<FleetSettingsSnapshot> FetchSettingsAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the polling-config read (web <c>usePollingConfig</c> → <c>GET /settings/polling-config</c>).</summary>
    Task<PollingConfigSnapshot> FetchPollingConfigAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the capture-stats read (web <c>useCaptureStats</c> → <c>GET /dev-tools/telemetry-capture/stats</c>).</summary>
    Task<CaptureStatsSnapshot> FetchCaptureStatsAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the version read (web <c>useVersionInfo</c> → <c>GET /system/version</c>).</summary>
    Task<FleetVersionSnapshot> FetchVersionAsync(CancellationToken cancellationToken);

    /// <summary>Toggle Tesla API suspension (web <c>useToggleAPISuspend</c> → <c>POST /settings/suspend-api</c>).</summary>
    Task<FleetMutationOutcome> ToggleSuspendAsync(bool suspended, CancellationToken cancellationToken);

    /// <summary>
    /// Write the polling config (web <c>useUpdatePollingConfig</c> → <c>PUT /settings/polling-config</c>). The
    /// <paramref name="payload"/> is the full snake_case config object (web spread of the prior config plus the change).
    /// </summary>
    Task<FleetMutationOutcome> UpdatePollingConfigAsync(
        IReadOnlyDictionary<string, object> payload,
        CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every read to the empty snapshot and every mutation to a no-op success.</summary>
public sealed class EmptyFleetApiFeed : IFleetApiFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyFleetApiFeed Instance { get; } = new();

    private EmptyFleetApiFeed()
    {
    }

    /// <inheritdoc />
    public Task<FleetSettingsSnapshot> FetchSettingsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(FleetSettingsSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<PollingConfigSnapshot> FetchPollingConfigAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(PollingConfigSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<CaptureStatsSnapshot> FetchCaptureStatsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(CaptureStatsSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<FleetVersionSnapshot> FetchVersionAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(FleetVersionSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<FleetMutationOutcome> ToggleSuspendAsync(bool suspended, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(FleetMutationOutcome.Ok);
    }

    /// <inheritdoc />
    public Task<FleetMutationOutcome> UpdatePollingConfigAsync(
        IReadOnlyDictionary<string, object> payload,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(FleetMutationOutcome.Ok);
    }
}

/// <summary>
/// The render-time data model the <c>FleetAPIPage</c> projects from — the native analogue of the web page's resolved
/// query state (web/src/features/admin/pages/FleetAPIPage.tsx). Pure data so the projection is unit-tested headlessly.
/// </summary>
/// <param name="Loading">Whether the first read is in flight with no result yet (web initial <c>isLoading</c>).</param>
/// <param name="Settings">The resolved settings read (web <c>useSettings</c>).</param>
/// <param name="PollingConfig">The resolved polling config (web <c>usePollingConfig</c>).</param>
/// <param name="CaptureStats">The resolved capture stats (web <c>useCaptureStats</c>).</param>
/// <param name="Version">The resolved version read (web <c>useVersionInfo</c>).</param>
/// <param name="Notice">The pending mutation notice (web toast), or <see cref="FleetApiNoticeKind.None"/>.</param>
public sealed record FleetApiModel(
    bool Loading,
    FleetSettingsSnapshot Settings,
    PollingConfigSnapshot PollingConfig,
    CaptureStatsSnapshot CaptureStats,
    FleetVersionSnapshot Version,
    FleetApiNoticeKind Notice)
{
    /// <summary>The initial model — the first load, nothing resolved yet, no notice.</summary>
    public static FleetApiModel Initial { get; } = new(
        Loading: true,
        Settings: FleetSettingsSnapshot.Empty,
        PollingConfig: PollingConfigSnapshot.Empty,
        CaptureStats: CaptureStatsSnapshot.Empty,
        Version: FleetVersionSnapshot.Empty,
        Notice: FleetApiNoticeKind.None);
}

/// <summary>
/// The projected, render-ready content the <c>FleetAPIPage</c> view binds to — every visible literal resolved through
/// the i18n facade (the exact web defaults) plus the top-level <see cref="FleetApiState"/> and the per-region flags.
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record FleetApiDisplay(
    FleetApiState State,
    bool ShowLoading,
    string NavTitle,
    string Title,
    string Subtitle,
    // GlassPanel1 — Tesla API Polling.
    string PollingTitle,
    string PollingStatus,
    bool IsSuspended,
    // GlassPanel2 — suspended warning callout.
    string SuspendedNote,
    // GlassPanel3 — API Endpoint Controls.
    string ControlsTitle,
    string ControlsSubtitle,
    string EnabledSummary,
    bool ShowControls,
    string PollingSectionLabel,
    string OnDemandSectionLabel,
    string CommandsSectionLabel,
    IReadOnlyList<FleetApiEndpointItem> PollingEndpoints,
    IReadOnlyList<FleetApiEndpointItem> OnDemandEndpoints,
    IReadOnlyList<FleetApiEndpointItem> CommandEndpoints,
    // Telemetry capture.
    string TelemetryCaptureLabel,
    bool ShowMongoBadge,
    bool MongoEnabled,
    string MongoBadgeText,
    string RawSignalRecordingLabel,
    string RawSignalRecordingDescription,
    bool RawSignalRecordingEnabled,
    bool ShowRetention,
    string RetentionTitle,
    string RetentionDescription,
    int RetentionDays,
    IReadOnlyList<FleetApiRetentionOption> RetentionOptions,
    bool ShowCaptureStats,
    string CaptureStatsText,
    // GlassPanel7 — API Endpoints.
    string EndpointsTitle,
    string VersionSubtitle,
    string ConfiguredEndpointsLabel,
    IReadOnlyList<FleetApiConfiguredEndpoint> ConfiguredEndpoints,
    bool ShowConfiguredEndpoints,
    bool ShowEndpointsEmpty,
    string NoDataMessage,
    // Toast / InfoBar.
    FleetApiNoticeDisplay Notice,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="FleetApiModel"/> to its <see cref="FleetApiDisplay"/> — the native port of the
/// render logic in web/src/features/admin/pages/FleetAPIPage.tsx. Every one of the manifest's 70 strings resolves
/// through the i18n facade using the exact web defaults, on every projection (regardless of data state) so the i18n
/// contract holds while loading and once loaded. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class FleetApiProjection
{
    // (configKey, labelKey, labelDefault, descKey, descDefault) — the web pollingEndpoints array.
    private static readonly (string Key, string LabelKey, string Label, string DescKey, string Desc)[] PollingSpecs =
    [
        ("vehicle_discovery", "fleetApi.ep.label.vehicleDiscovery", "Vehicle Discovery", "fleetApi.ep.desc.listVehicles", "List vehicles from Tesla"),
        ("charge_state", "fleetApi.ep.label.chargeState", "Charge State", "fleetApi.ep.desc.batteryCharging", "Battery & charging data"),
        ("climate_state", "fleetApi.ep.label.climateState", "Climate State", "fleetApi.ep.desc.climateTemp", "Climate & temperature data"),
        ("drive_state", "fleetApi.ep.label.driveState", "Drive State", "fleetApi.ep.desc.locationSpeed", "Location & speed data"),
        ("location_data", "fleetApi.ep.label.locationData", "Location Data", "fleetApi.ep.desc.gps", "GPS coordinates"),
        ("vehicle_state", "fleetApi.ep.label.vehicleState", "Vehicle State", "fleetApi.ep.desc.locksDoors", "Locks, doors, odometer"),
        ("vehicle_config", "fleetApi.ep.label.vehicleConfig", "Vehicle Config", "fleetApi.ep.desc.modelTrim", "Model, trim, options"),
    ];

    // The web onDemandEndpoints array (labels reuse the polling label keys; descriptions differ).
    private static readonly (string Key, string LabelKey, string Label, string DescKey, string Desc)[] OnDemandSpecs =
    [
        ("on_demand_vehicle_discovery", "fleetApi.ep.label.vehicleDiscovery", "Vehicle Discovery", "fleetApi.ep.desc.syncVehicles", "Sync vehicles from Tesla"),
        ("on_demand_charge_state", "fleetApi.ep.label.chargeState", "Charge State", "fleetApi.ep.desc.batteryCharging", "Battery & charging data"),
        ("on_demand_climate_state", "fleetApi.ep.label.climateState", "Climate State", "fleetApi.ep.desc.climateTemp", "Climate & temperature data"),
        ("on_demand_drive_state", "fleetApi.ep.label.driveState", "Drive State", "fleetApi.ep.desc.locationSpeed", "Location & speed data"),
        ("on_demand_location_data", "fleetApi.ep.label.locationData", "Location Data", "fleetApi.ep.desc.gps", "GPS coordinates"),
        ("on_demand_vehicle_state", "fleetApi.ep.label.vehicleState", "Vehicle State", "fleetApi.ep.desc.locksDoors", "Locks, doors, odometer"),
        ("on_demand_vehicle_config", "fleetApi.ep.label.vehicleConfig", "Vehicle Config", "fleetApi.ep.desc.modelTrim", "Model, trim, options"),
        ("nearby_charging_sites", "fleetApi.ep.label.nearbyCharging", "Nearby Charging", "fleetApi.ep.desc.superchargers", "Supercharger locations"),
        ("release_notes", "fleetApi.ep.label.releaseNotes", "Release Notes", "fleetApi.ep.desc.firmwareNotes", "Firmware release notes"),
        ("recent_alerts", "fleetApi.ep.label.recentAlerts", "Recent Alerts", "fleetApi.ep.desc.alertHistory", "Vehicle alert history"),
        ("service_data", "fleetApi.ep.label.serviceData", "Service Data", "fleetApi.ep.desc.serviceHistory", "Service history & status"),
    ];

    // The web commandEndpoints array.
    private static readonly (string Key, string LabelKey, string Label, string DescKey, string Desc)[] CommandSpecs =
    [
        ("wake_up", "fleetApi.ep.label.wakeUp", "Wake Up", "fleetApi.ep.desc.wakeSleep", "Wake vehicle from sleep"),
        ("commands", "fleetApi.ep.label.commands", "Vehicle Commands", "fleetApi.ep.desc.lockUnlock", "Lock, unlock, climate, etc."),
    ];

    // The web "Configured Endpoints" list (key, labelKey, labelDefault).
    private static readonly (string Key, string LabelKey, string Label)[] ConfiguredSpecs =
    [
        ("api", "fleetApi.endpoint.api", "API (Internal)"),
        ("web", "fleetApi.endpoint.web", "Web Frontend"),
        ("oauth_callback", "fleetApi.endpoint.oauth", "OAuth Callback"),
        ("tesla_api", "fleetApi.endpoint.teslaApi", "Tesla Fleet API"),
    ];

    // The web retention Select options (days, labelKey, labelDefault).
    private static readonly (int Days, string Key, string Label)[] RetentionSpecs =
    [
        (1, "fleetApi.retention.d1", "1 day"),
        (3, "fleetApi.retention.d3", "3 days"),
        (7, "fleetApi.retention.d7", "7 days"),
        (14, "fleetApi.retention.d14", "14 days"),
        (30, "fleetApi.retention.d30", "30 days"),
    ];

    /// <summary>The full set of endpoint keys counted toward the "X/Y enabled" summary (web <c>allEndpointKeys</c>).</summary>
    public static readonly IReadOnlyList<string> AllEndpointKeys = BuildAllKeys();

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static FleetApiDisplay Project(FleetApiModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // Page header (web usePageTitle + PageContainer title/subtitle).
        string navTitle = localizer.GetString("fleetApi.navTitle", "Fleet API");
        string title = localizer.GetString("fleetApi.title", "Fleet API Settings");
        string subtitle = localizer.GetString(
            "fleetApi.subtitle",
            "Control Tesla Fleet API polling, endpoint toggles, and telemetry capture");

        // GlassPanel1 — Tesla API Polling.
        bool suspended = model.Settings.ApiSuspended;
        string pollingTitle = localizer.GetString("fleetApi.polling.title", "Tesla API Polling");
        string suspendedStatus = localizer.GetString(
            "fleetApi.polling.suspendedStatus", "All Tesla Fleet API calls are suspended");
        string activeStatus = localizer.GetString(
            "fleetApi.polling.activeStatus", "Vehicle data is being polled from Tesla");
        string pollingStatus = suspended ? suspendedStatus : activeStatus;

        // GlassPanel2 — suspended warning callout.
        string suspendedNote = localizer.GetString(
            "fleetApi.polling.suspendedNote",
            "Polling and commands are paused. Token refresh continues so you won't need to re-authenticate. "
                + "Useful when your vehicle is in service.");

        // GlassPanel3 — API Endpoint Controls.
        string controlsTitle = localizer.GetString("fleetApi.controls.title", "API Endpoint Controls");
        string controlsSubtitle = localizer.GetString(
            "fleetApi.controls.subtitle", "Toggle individual Tesla Fleet API endpoints on or off");
        string enabledWord = localizer.GetString("fleetApi.controls.enabled", "enabled");

        string pollingSection = localizer.GetString("fleetApi.section.polling", "Polling Endpoints");
        string onDemandSection = localizer.GetString("fleetApi.section.onDemand", "On-Demand Endpoints");
        string commandsSection = localizer.GetString("fleetApi.section.commands", "Commands");
        string telemetryCaptureLabel = localizer.GetString("fleetApi.section.telemetryCapture", "Telemetry Capture");

        var pollingEndpoints = BuildEndpoints(PollingSpecs, model.PollingConfig, localizer);
        var onDemandEndpoints = BuildEndpoints(OnDemandSpecs, model.PollingConfig, localizer);
        var commandEndpoints = BuildEndpoints(CommandSpecs, model.PollingConfig, localizer);

        bool showControls = model.PollingConfig.HasData;
        int enabledCount = AllEndpointKeys.Count(model.PollingConfig.IsEnabled);
        int totalCount = AllEndpointKeys.Count;
        string enabledSummary = showControls
            ? string.Create(CultureInfo.InvariantCulture, $"({enabledCount}/{totalCount} {enabledWord})")
            : string.Empty;

        // Telemetry capture.
        bool mongoEnabled = model.CaptureStats.MongoEnabled;
        bool showMongoBadge = model.CaptureStats.HasData;
        string connected = localizer.GetString("fleetApi.capture.connected", "MongoDB Connected");
        string notConfigured = localizer.GetString("fleetApi.capture.notConfigured", "MongoDB Not Configured");
        string rawTitle = localizer.GetString("fleetApi.capture.rawTitle", "Raw Signal Recording");
        string rawDescEnabled = localizer.GetString(
            "fleetApi.capture.enabledDesc", "Capture every fleet telemetry signal to MongoDB for debugging");
        string rawDescDisabled = localizer.GetString(
            "fleetApi.capture.disabledDesc", "Set MONGODB_ENABLED=true and configure MONGODB_URI to enable");
        string retentionTitle = localizer.GetString("fleetApi.capture.retentionTitle", "Retention Period");
        string retentionDesc = localizer.GetString(
            "fleetApi.capture.retentionDesc", "Auto-delete captured signals after this many days");
        string signalsCaptured = localizer.GetString("fleetApi.capture.signalsCaptured", "signals captured from");
        string vehicleWord = localizer.GetString("fleetApi.capture.vehicle", "vehicle");

        var retentionOptions = RetentionSpecs
            .Select(spec => new FleetApiRetentionOption(spec.Days, localizer.GetString(spec.Key, spec.Label)))
            .ToArray();

        bool telemetryCaptureOn = model.PollingConfig.IsEnabled("telemetry_capture");
        string rawDescription = showMongoBadge && !mongoEnabled ? rawDescDisabled : rawDescEnabled;
        bool showRetention = showControls && telemetryCaptureOn && mongoEnabled;
        bool showCaptureStats = showRetention && model.CaptureStats.TotalDocuments > 0;
        string captureStatsText = showCaptureStats
            ? string.Create(
                CultureInfo.InvariantCulture,
                $"{NumberFormatting.Format(model.CaptureStats.TotalDocuments, null, 0)} {signalsCaptured} "
                    + $"{model.CaptureStats.DistinctVinCount} {vehicleWord}{(model.CaptureStats.DistinctVinCount != 1 ? "s" : string.Empty)}")
            : string.Empty;

        // GlassPanel7 — API Endpoints.
        string endpointsTitle = localizer.GetString("fleetApi.endpoints.title", "API Endpoints");
        string configuredLabel = localizer.GetString("fleetApi.endpoints.configured", "Configured Endpoints");
        var configured = BuildConfigured(model.Version, localizer);
        string versionSubtitle = model.Version.HasData
            ? string.Create(
                CultureInfo.InvariantCulture,
                $"v{model.Version.ChartVersion} \u00b7 {model.Version.GoVersion} \u00b7 {model.Version.Os}/{model.Version.Arch}")
            : string.Empty;
        bool showConfigured = configured.Count > 0;
        string noData = localizer.GetString("common.noData", "No data available");

        // Toast / InfoBar — all eight toast strings resolve every projection so the i18n contract holds.
        string suspendedToastTitle = localizer.GetString("fleetApi.toast.suspendedTitle", "API suspended");
        string suspendedToastBody = localizer.GetString(
            "fleetApi.toast.suspendedBody", "All Tesla API calls have been paused");
        string resumedToastTitle = localizer.GetString("fleetApi.toast.resumedTitle", "API resumed");
        string resumedToastBody = localizer.GetString(
            "fleetApi.toast.resumedBody", "Tesla API polling has been re-enabled");
        string failedTitle = localizer.GetString("fleetApi.toast.failedTitle", "Failed");
        string suspendError = localizer.GetString("fleetApi.toast.suspendError", "Could not toggle API suspension");
        string pollingUpdated = localizer.GetString("fleetApi.toast.pollingUpdated", "Polling config updated");
        string pollingError = localizer.GetString("fleetApi.toast.pollingError", "Failed to update polling config");

        var notice = model.Notice switch
        {
            FleetApiNoticeKind.ApiSuspended => new FleetApiNoticeDisplay(model.Notice, suspendedToastTitle, suspendedToastBody),
            FleetApiNoticeKind.ApiResumed => new FleetApiNoticeDisplay(model.Notice, resumedToastTitle, resumedToastBody),
            FleetApiNoticeKind.SuspendFailed => new FleetApiNoticeDisplay(model.Notice, failedTitle, suspendError),
            FleetApiNoticeKind.PollingUpdated => new FleetApiNoticeDisplay(model.Notice, pollingUpdated, string.Empty),
            FleetApiNoticeKind.PollingFailed => new FleetApiNoticeDisplay(model.Notice, pollingError, string.Empty),
            _ => FleetApiNoticeDisplay.None,
        };

        FleetApiState state = model.Loading
            ? FleetApiState.Loading
            : showConfigured ? FleetApiState.Success : FleetApiState.Empty;

        return new FleetApiDisplay(
            State: state,
            ShowLoading: model.Loading,
            NavTitle: navTitle,
            Title: title,
            Subtitle: subtitle,
            PollingTitle: pollingTitle,
            PollingStatus: pollingStatus,
            IsSuspended: suspended,
            SuspendedNote: suspendedNote,
            ControlsTitle: controlsTitle,
            ControlsSubtitle: controlsSubtitle,
            EnabledSummary: enabledSummary,
            ShowControls: showControls,
            PollingSectionLabel: pollingSection,
            OnDemandSectionLabel: onDemandSection,
            CommandsSectionLabel: commandsSection,
            PollingEndpoints: pollingEndpoints,
            OnDemandEndpoints: onDemandEndpoints,
            CommandEndpoints: commandEndpoints,
            TelemetryCaptureLabel: telemetryCaptureLabel,
            ShowMongoBadge: showMongoBadge,
            MongoEnabled: mongoEnabled,
            MongoBadgeText: mongoEnabled ? connected : notConfigured,
            RawSignalRecordingLabel: rawTitle,
            RawSignalRecordingDescription: rawDescription,
            RawSignalRecordingEnabled: telemetryCaptureOn,
            ShowRetention: showRetention,
            RetentionTitle: retentionTitle,
            RetentionDescription: retentionDesc,
            RetentionDays: model.PollingConfig.RetentionDays,
            RetentionOptions: retentionOptions,
            ShowCaptureStats: showCaptureStats,
            CaptureStatsText: captureStatsText,
            EndpointsTitle: endpointsTitle,
            VersionSubtitle: versionSubtitle,
            ConfiguredEndpointsLabel: configuredLabel,
            ConfiguredEndpoints: configured,
            ShowConfiguredEndpoints: showConfigured,
            ShowEndpointsEmpty: !showConfigured,
            NoDataMessage: noData,
            Notice: notice,
            AutomationName: title);
    }

    private static List<FleetApiEndpointItem> BuildEndpoints(
        (string Key, string LabelKey, string Label, string DescKey, string Desc)[] specs,
        PollingConfigSnapshot config,
        ILocalizer localizer)
    {
        var items = new List<FleetApiEndpointItem>(specs.Length);
        foreach (var spec in specs)
        {
            items.Add(new FleetApiEndpointItem(
                Key: spec.Key,
                Label: localizer.GetString(spec.LabelKey, spec.Label),
                Description: localizer.GetString(spec.DescKey, spec.Desc),
                Enabled: config.IsEnabled(spec.Key)));
        }

        return items;
    }

    private static List<FleetApiConfiguredEndpoint> BuildConfigured(
        FleetVersionSnapshot version,
        ILocalizer localizer)
    {
        var items = new List<FleetApiConfiguredEndpoint>(ConfiguredSpecs.Length);
        foreach (var spec in ConfiguredSpecs)
        {
            // The label always resolves (i18n parity); the row only renders when the URL is present (web guard).
            string label = localizer.GetString(spec.LabelKey, spec.Label);
            if (version.Endpoints.TryGetValue(spec.Key, out var url) && !string.IsNullOrEmpty(url))
            {
                items.Add(new FleetApiConfiguredEndpoint(label, url));
            }
        }

        return items;
    }

    private static List<string> BuildAllKeys()
    {
        var keys = new List<string>();
        foreach (var spec in PollingSpecs)
        {
            keys.Add(spec.Key);
        }

        foreach (var spec in OnDemandSpecs)
        {
            keys.Add(spec.Key);
        }

        foreach (var spec in CommandSpecs)
        {
            keys.Add(spec.Key);
        }

        keys.Add("telemetry_capture");
        return keys;
    }
}

/// <summary>
/// Static identity + i18n helpers for the <c>FleetAPIPage</c> surface: the diagnostics slug, the navigation route name
/// (matching the RouteTable <c>FleetAPI</c> entry), the generated read / mutation operation ids (web hooks), and the
/// Segoe Fluent Icons glyphs standing in for the web Lucide icons.
/// </summary>
public static class FleetApiRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "FleetAPIPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>FleetAPI</c>).</summary>
    public const string RouteName = "FleetAPI";

    /// <summary>The generated operation id for the settings read (web <c>useSettings</c>).</summary>
    public const string SettingsOperation = "get_api_v1_settings";

    /// <summary>The generated operation id for the polling-config read (web <c>usePollingConfig</c>).</summary>
    public const string PollingConfigOperation = "get_api_v1_settings_polling_config";

    /// <summary>The generated operation id for the polling-config write (web <c>useUpdatePollingConfig</c>).</summary>
    public const string PollingConfigUpdateOperation = "put_api_v1_settings_polling_config";

    /// <summary>The generated operation id for the suspend toggle (web <c>useToggleAPISuspend</c>).</summary>
    public const string SuspendOperation = "post_api_v1_settings_suspend_api";

    /// <summary>The generated operation id for the capture-stats read (web <c>useCaptureStats</c>).</summary>
    public const string CaptureStatsOperation = "get_api_v1_dev_tools_telemetry_capture_stats";

    /// <summary>The generated operation id for the version read (web <c>useVersionInfo</c>).</summary>
    public const string VersionOperation = "get_api_v1_system_version";

    /// <summary>Segoe Fluent "Pause" glyph standing in for the web Lucide <c>Pause</c> icon.</summary>
    public const string PauseGlyph = "\uE769";

    /// <summary>Segoe Fluent "Play" glyph standing in for the web Lucide <c>Play</c> icon.</summary>
    public const string PlayGlyph = "\uE768";

    /// <summary>Segoe Fluent "Shield" glyph standing in for the web Lucide <c>Shield</c> icon.</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>Segoe Fluent "Globe" glyph standing in for the web Lucide <c>Globe</c> icon.</summary>
    public const string GlobeGlyph = "\uE774";

    /// <summary>Segoe Fluent "Link" glyph standing in for the web Lucide <c>Link</c> icon.</summary>
    public const string LinkGlyph = "\uE71B";

    /// <summary>Segoe Fluent "Activity" glyph standing in for the web Lucide <c>Activity</c> empty-state icon.</summary>
    public const string ActivityGlyph = "\uE9D9";

    /// <summary>The localized page title (web <c>Fleet API Settings</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("fleetApi.title", "Fleet API Settings");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>FleetAPIPage</c> surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never any setting value, endpoint URL or VIN — so a diagnostics line
/// can never leak fleet content. Thread-safe.
/// </summary>
public sealed class FleetApiDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FleetApiDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FleetAPIPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FleetApiRegistration.Slug}");
    }
}
