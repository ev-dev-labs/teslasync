using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// One resolved per-vehicle setting row from <c>GET /vehicles/{vehicleID}/settings</c> (web
/// <c>EffectiveSetting</c> in web/src/api/types.ts). <see cref="Value"/> is the already-stringified display value
/// (the web renders <c>value: unknown</c> against a per-key control); <see cref="ValueIsText"/> preserves whether
/// the wire value was a JSON string so the nickname resolver can reproduce the web's
/// <c>typeof value === 'string' &amp;&amp; value !== ''</c> guard verbatim. <see cref="Source"/> is the resolver
/// layer (<c>override | user | vehicle | default</c>) the web pill renders. Parsing is null-tolerant so a partial
/// row never throws.
/// </summary>
public sealed record EffectiveSettingData(string Key, string Value, bool ValueIsText, string Source)
{
    /// <summary>Project one settings-array element into the row, or null when it carries no usable key.</summary>
    public static EffectiveSettingData? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        string? key = VehicleDetailJson.String(element, "key");
        if (string.IsNullOrEmpty(key))
        {
            return null;
        }

        (string value, bool isText) = VehicleDetailJson.ScalarText(element, "value");
        string source = VehicleDetailJson.String(element, "source") ?? "default";
        return new EffectiveSettingData(key, value, isText, source);
    }
}

/// <summary>
/// The per-vehicle settings envelope from <c>GET /vehicles/{vehicleID}/settings</c> (web
/// <c>VehicleSettingsResponse</c>) — the single data source this parity unit binds (web <c>useVehicleSettings</c>).
/// The resolver always returns the full key whitelist, so a resolved-but-empty list is unusual but handled. The
/// <see cref="Find"/> selector is the native port of web <c>findEffectiveSetting</c>.
/// </summary>
public sealed record VehicleSettingsData(IReadOnlyList<EffectiveSettingData> Settings)
{
    /// <summary>The empty envelope (no settings resolved yet).</summary>
    public static VehicleSettingsData Empty { get; } = new(Array.Empty<EffectiveSettingData>());

    /// <summary>Project a <c>{ "settings": [...] }</c> body into the envelope, or null for a non-object body.</summary>
    public static VehicleSettingsData? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var rows = new List<EffectiveSettingData>();
        if (root.TryGetProperty("settings", out var settings) && settings.ValueKind == JsonValueKind.Array)
        {
            foreach (var element in settings.EnumerateArray())
            {
                if (EffectiveSettingData.FromJson(element) is { } row)
                {
                    rows.Add(row);
                }
            }
        }

        return new VehicleSettingsData(rows);
    }

    /// <summary>Pull a single key's effective row from the resolver payload (web <c>findEffectiveSetting</c>).</summary>
    public EffectiveSettingData? Find(string key) =>
        Settings.FirstOrDefault(setting => string.Equals(setting.Key, key, StringComparison.Ordinal));
}

/// <summary>
/// The one-source vehicle-detail snapshot the page renders from — the resolved per-vehicle settings (web
/// <c>useVehicleSettings</c>). The page owns the query lifecycle and projects this already-resolved snapshot, the
/// same way the sibling detail pages do.
/// </summary>
public sealed record VehicleDetailSnapshot(VehicleSettingsData? Settings)
{
    /// <summary>The empty snapshot — settings not resolved yet (loading / empty seed).</summary>
    public static VehicleDetailSnapshot Empty { get; } = new((VehicleSettingsData?)null);

    /// <summary>True once the settings read resolved an object body.</summary>
    public bool HasSettings => Settings is not null;
}

/// <summary>The render-time model: the parsed snapshot plus the page lifecycle flags (web query <c>isLoading</c> / error).</summary>
public sealed record VehicleDetailModel(VehicleDetailSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the settings query is in flight with nothing resolved yet.</summary>
    public static VehicleDetailModel Initial { get; } = new(VehicleDetailSnapshot.Empty, true, null);
}

/// <summary>The four mutually-exclusive top-level data states the page renders (web isLoading / error / no-data / ready).</summary>
public enum VehicleDetailState
{
    /// <summary>The settings read is in flight with nothing to show — the loading skeleton.</summary>
    Loading,

    /// <summary>Resolved with no settings envelope — the friendly page-level empty surface.</summary>
    Empty,

    /// <summary>The read failed — the retriable error surface.</summary>
    Error,

    /// <summary>Settings resolved — the full detail content.</summary>
    Success,
}

/// <summary>One projected key/value row inside a section — WinUI-free so the projection stays testable.</summary>
public sealed record VehicleKvRow(string Label, string Value);

/// <summary>
/// One projected vehicle-detail section (one web <c>&lt;SectionErrorBoundary&gt;</c> wrapper). Carries the section
/// id, the localized error-boundary fallback title (web <c>fallbackTitle</c>), an optional heading, the gating
/// <see cref="Visible"/> flag, the real data rows drawn from the resolved settings, and the localized empty copy
/// shown when the section has no in-scope data (never a blank region).
/// </summary>
public sealed record VehicleSectionDisplay(
    string Id,
    string FallbackTitle,
    string? Heading,
    bool Visible,
    IReadOnlyList<VehicleKvRow> Rows,
    string? EmptyText,
    string AccessibleName);

/// <summary>
/// The fully-resolved, render-ready projection of <c>VehicleDetailPage</c> — every web region as pure data so the
/// WinUI view is a thin renderer and the projection is unit-tested without a UI host. The four-state flags drive
/// the top-level surfaces; the sixteen <c>SectionErrorBoundary</c> regions each carry their own localized fallback
/// title plus real-data or localized-empty content; and the wake strings back the header wake affordance.
/// </summary>
public sealed record VehicleDetailDisplay
{
    public required VehicleDetailState State { get; init; }
    public required string Title { get; init; }
    public required string AutomationName { get; init; }
    public required string EffectiveName { get; init; }

    // ── Sections (16 web SectionErrorBoundary regions) ──
    public required IReadOnlyList<VehicleSectionDisplay> Sections { get; init; }

    // ── State surfaces ──
    public required string ErrorText { get; init; }
    public required string RetryLabel { get; init; }
    public required string EmptyMessage { get; init; }

    // ── Wake affordance (web VehicleHeader wake button + toasts) ──
    public required string WakeLabel { get; init; }
    public required string WakeSuccess { get; init; }
    public required string WakeFailed { get; init; }

    public bool ShowLoading => State == VehicleDetailState.Loading;
    public bool ShowError => State == VehicleDetailState.Error;
    public bool ShowEmpty => State == VehicleDetailState.Empty;
    public bool ShowContent => State == VehicleDetailState.Success;

    /// <summary>The sections whose web visibility gating is satisfied (the ones actually rendered).</summary>
    public IReadOnlyList<VehicleSectionDisplay> VisibleSections =>
        Sections.Where(section => section.Visible).ToList();
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every i18n key the web
/// <c>VehicleDetailPage</c> feeds into <c>t(...)</c> at the page level (the 19 manifest keys: the page title, the
/// two wake toasts and the sixteen section-boundary fallback titles), resolved once through the i18n facade so the
/// projection stays readable and the string-coverage test can assert every manifest key in one pass.
/// </summary>
public sealed record VehicleDetailStrings
{
    public required string Title { get; init; }
    public required string WakeSuccess { get; init; }
    public required string WakeFailed { get; init; }

    public required string HeaderFailed { get; init; }
    public required string BatteryRangeFailed { get; init; }
    public required string LiveStateFailed { get; init; }
    public required string QuickStatsFailed { get; init; }
    public required string MotorFailed { get; init; }
    public required string ClimateFailed { get; init; }
    public required string SecurityFailed { get; init; }
    public required string TireFailed { get; init; }
    public required string ChargingTelemetryFailed { get; init; }
    public required string BatteryChartsFailed { get; init; }
    public required string RecentDrivesFailed { get; init; }
    public required string RecentChargesFailed { get; init; }
    public required string VehicleConfigFailed { get; init; }
    public required string AiPaintPreviewFailed { get; init; }
    public required string QuickLinksFailed { get; init; }
    public required string SettingsFailed { get; init; }

    /// <summary>Resolve every page-level string through the i18n facade (web key names, verbatim).</summary>
    public static VehicleDetailStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new VehicleDetailStrings
        {
            Title = localizer.GetString("vehicles.detail.title", "Vehicle Detail"),
            WakeSuccess = localizer.GetString("vehicles.detail.wakeSuccess", "Wake command sent"),
            WakeFailed = localizer.GetString("vehicles.detail.wakeFailed", "Failed to wake vehicle"),
            HeaderFailed = localizer.GetString("vehicles.detail.section.headerFailed", "Vehicle header failed to load"),
            BatteryRangeFailed = localizer.GetString("vehicles.detail.section.batteryRangeFailed", "Battery & range section failed to load"),
            LiveStateFailed = localizer.GetString("vehicles.detail.section.liveStateFailed", "Live state indicators failed to load"),
            QuickStatsFailed = localizer.GetString("vehicles.detail.section.quickStatsFailed", "Quick stats failed to load"),
            MotorFailed = localizer.GetString("vehicles.detail.section.motorFailed", "Motor section failed to load"),
            ClimateFailed = localizer.GetString("vehicles.detail.section.climateFailed", "Climate section failed to load"),
            SecurityFailed = localizer.GetString("vehicles.detail.section.securityFailed", "Security section failed to load"),
            TireFailed = localizer.GetString("vehicles.detail.section.tireFailed", "Tire pressure section failed to load"),
            ChargingTelemetryFailed = localizer.GetString("vehicles.detail.section.chargingTelemetryFailed", "Charging telemetry failed to load"),
            BatteryChartsFailed = localizer.GetString("vehicles.detail.section.batteryChartsFailed", "Battery & range charts failed to load"),
            RecentDrivesFailed = localizer.GetString("vehicles.detail.section.recentDrivesFailed", "Recent drives failed to load"),
            RecentChargesFailed = localizer.GetString("vehicles.detail.section.recentChargesFailed", "Recent charges failed to load"),
            VehicleConfigFailed = localizer.GetString("vehicles.detail.section.vehicleConfigFailed", "Vehicle config section failed to load"),
            AiPaintPreviewFailed = localizer.GetString("vehicles.detail.section.aiPaintPreviewFailed", "Helix paint preview failed to load"),
            QuickLinksFailed = localizer.GetString("vehicles.detail.section.quickLinksFailed", "Quick links failed to load"),
            SettingsFailed = localizer.GetString("vehicles.detail.section.settingsFailed", "Per-vehicle settings failed to load"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="VehicleDetailModel"/> to its <see cref="VehicleDetailDisplay"/> — the native
/// port of the web page composition (web/src/features/vehicles/pages/VehicleDetailPage.tsx). It selects the
/// four-state matrix, resolves every page-level label through the i18n facade, reproduces the web nickname
/// resolver (<c>findEffectiveSetting(settings,'nickname')</c> → page title), and assembles the sixteen
/// <c>SectionErrorBoundary</c> regions — each with its localized fallback title, its web visibility gating, and a
/// real data summary drawn from the resolved settings (header + settings) or its own localized empty copy. No
/// WinUI types so the whole contract is unit-tested without a UI host.
/// </summary>
public static class VehicleDetailProjection
{
    private const string NicknameKey = "nickname";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active localizer.</summary>
    /// <param name="model">The parsed settings snapshot plus the page lifecycle flags.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static VehicleDetailDisplay Project(VehicleDetailModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // Resolve every page-level string unconditionally so the manifest keys are requested in every state.
        VehicleDetailStrings s = VehicleDetailStrings.Resolve(localizer);
        VehicleSettingsData? settings = model.Snapshot.Settings;

        VehicleDetailState state =
            model.Loading && settings is null ? VehicleDetailState.Loading
            : model.ErrorDetail is not null ? VehicleDetailState.Error
            : settings is null ? VehicleDetailState.Empty
            : VehicleDetailState.Success;

        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? loadFailed
            : $"{loadFailed}: {model.ErrorDetail}";
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string emptyMessage = localizer.GetString("common.noData", "No data available");
        string wakeLabel = localizer.GetString("common.wakeUp", "Wake Up");

        // Web nickname resolver: typeof value === 'string' && value !== '' ? value : vehicle.display_name.
        // The vehicle display name is out of this unit's scope, so the fallback is the localized page title.
        EffectiveSettingData? nickname = settings?.Find(NicknameKey);
        string effectiveName = nickname is { ValueIsText: true } n && !string.IsNullOrEmpty(n.Value)
            ? n.Value
            : s.Title;

        List<VehicleSectionDisplay> sections = settings is null
            ? new List<VehicleSectionDisplay>()
            : BuildSections(settings, effectiveName, s, localizer);

        string automationName = settings is null ? s.Title : $"{s.Title}: {effectiveName}";

        return new VehicleDetailDisplay
        {
            State = state,
            Title = effectiveName,
            AutomationName = automationName,
            EffectiveName = effectiveName,
            Sections = sections,
            ErrorText = errorText,
            RetryLabel = retryLabel,
            EmptyMessage = emptyMessage,
            WakeLabel = wakeLabel,
            WakeSuccess = s.WakeSuccess,
            WakeFailed = s.WakeFailed,
        };
    }

    private static List<VehicleSectionDisplay> BuildSections(
        VehicleSettingsData settings,
        string effectiveName,
        VehicleDetailStrings s,
        ILocalizer localizer)
    {
        // Local label resolver — reuses existing catalog keys for section content (not part of the required set).
        string L(string key, string fallback) => localizer.GetString(key, fallback);

        string noData = localizer.GetString("common.noData", "No data available");

        var settingsRows = new List<VehicleKvRow>(settings.Settings.Count);
        foreach (var setting in settings.Settings)
        {
            settingsRows.Add(new VehicleKvRow(setting.Key, $"{setting.Value} ({setting.Source})"));
        }

        return new List<VehicleSectionDisplay>
        {
            Section("header", s.HeaderFailed, effectiveName, new[]
            {
                new VehicleKvRow(s.Title, effectiveName),
            }, null),

            Section("battery-range", s.BatteryRangeFailed, L("vehicles.detail.batteryOverview", "Battery & Range"),
                Array.Empty<VehicleKvRow>(), noData),

            Section("live-state", s.LiveStateFailed, null, Array.Empty<VehicleKvRow>(), noData),

            Section("quick-stats", s.QuickStatsFailed, null, Array.Empty<VehicleKvRow>(), noData),

            Section("motor", s.MotorFailed, L("vehicles.detail.motor", "Motor"),
                Array.Empty<VehicleKvRow>(), L("vehicles.detail.noMotorData", "No motor data available")),

            Section("climate", s.ClimateFailed, L("vehicles.detail.climate", "Climate"),
                Array.Empty<VehicleKvRow>(), L("vehicles.detail.noClimateData", "No climate data available")),

            Section("security", s.SecurityFailed, L("vehicles.detail.security", "Security"),
                Array.Empty<VehicleKvRow>(), L("vehicles.detail.noSecurityData", "No security data available")),

            Section("tire-pressure", s.TireFailed, L("vehicles.detail.tirePressure", "Tire Pressure"),
                Array.Empty<VehicleKvRow>(), L("vehicles.detail.noTireData", "No tire pressure data available")),

            Section("charging-telemetry", s.ChargingTelemetryFailed, L("vehicles.detail.chargingTelemetry", "Charging Telemetry"),
                Array.Empty<VehicleKvRow>(), L("vehicles.detail.noChargingTelemetry", "No charging telemetry available")),

            Section("battery-charts", s.BatteryChartsFailed, L("vehicles.detail.batteryLevel", "Battery Level"),
                Array.Empty<VehicleKvRow>(), noData),

            Section("recent-drives", s.RecentDrivesFailed, L("vehicles.detail.driveTrend", "Recent Drives"),
                Array.Empty<VehicleKvRow>(), L("vehicles.detail.noDriveData", "No recent drive data available")),

            Section("recent-charges", s.RecentChargesFailed, null, Array.Empty<VehicleKvRow>(), noData),

            Section("vehicle-config", s.VehicleConfigFailed, L("vehicles.detail.vehicleConfig", "Vehicle Configuration"),
                Array.Empty<VehicleKvRow>(), noData),

            Section("ai-paint-preview", s.AiPaintPreviewFailed, null, Array.Empty<VehicleKvRow>(), noData),

            Section("quick-links", s.QuickLinksFailed, L("vehicles.detail.quickLinks", "Quick Links"),
                Array.Empty<VehicleKvRow>(), noData),

            Section("settings", s.SettingsFailed, L("vehicleSettings.title", "Per-Vehicle Settings"),
                settingsRows, settingsRows.Count == 0 ? noData : null),
        };
    }

    private static VehicleSectionDisplay Section(
        string id,
        string fallbackTitle,
        string? heading,
        IReadOnlyList<VehicleKvRow> rows,
        string? emptyText)
    {
        string accessible = heading ?? (rows.Count > 0 ? rows[0].Label : fallbackTitle);
        return new VehicleSectionDisplay(id, fallbackTitle, heading, true, rows, emptyText, accessible);
    }
}

/// <summary>
/// Canonical registration metadata for the <c>VehicleDetailPage</c> surface — the shell route name, the
/// diagnostics slug, the generated-client operation ids for the settings read and the wake command the web page
/// performs, and the empty-surface glyph.
/// </summary>
public static class VehicleDetailPageRegistration
{
    /// <summary>The route / page-factory name the shell registers this page under.</summary>
    public const string RouteName = "VehicleDetail";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "VehicleDetailPage";

    /// <summary>The per-vehicle settings read — web <c>useVehicleSettings</c> (GET /vehicles/{id}/settings).</summary>
    public const string SettingsOperation = "get_api_v1_vehicles_vehicleID_settings";

    /// <summary>The wake command — web wake mutation (POST /vehicles/{id}/wake).</summary>
    public const string WakeOperation = "post_api_v1_vehicles_vehicleID_wake";

    /// <summary>Segoe Fluent glyph for the page-level empty surface (Car).</summary>
    public const string EmptyGlyph = "\uE804";

    /// <summary>The settings key whose override feeds the page title (web nickname resolver).</summary>
    public const string NicknameKey = "nickname";

    /// <summary>The localized page title (web <c>t('vehicles.detail.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("vehicles.detail.title", "Vehicle Detail");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>VehicleDetailPage</c> surface. Records only the operational
/// <c>view.opened</c> event with the surface slug — never a vehicle id, nickname or VIN — so a diagnostics line
/// can never leak fleet data. Thread-safe.
/// </summary>
public sealed class VehicleDetailPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public VehicleDetailPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleDetailPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VehicleDetailPageRegistration.Slug}");
    }
}

/// <summary>
/// Tolerant <see cref="JsonElement"/> readers for the vehicle-settings parsers (mirrors the sibling feature json
/// helpers). Every read is null-safe so a partial wire object never throws; the scalar reader stringifies the
/// web's <c>value: unknown</c> across string / number / boolean kinds for display.
/// </summary>
internal static class VehicleDetailJson
{
    private const string Dash = "\u2014";

    /// <summary>Reads a non-empty string property, or null when absent / non-string / blank.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
        {
            string? str = v.GetString();
            return string.IsNullOrEmpty(str) ? null : str;
        }

        return null;
    }

    /// <summary>
    /// Reads the per-key <c>value</c> as a display string, returning whether the wire value was a JSON string so
    /// the nickname resolver can reproduce the web's <c>typeof value === 'string'</c> guard. Absent / null values
    /// stringify to the em-dash sentinel and report <c>false</c>.
    /// </summary>
    public static (string Value, bool IsText) ScalarText(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return (Dash, false);
        }

        return v.ValueKind switch
        {
            JsonValueKind.String => (v.GetString() ?? string.Empty, true),
            JsonValueKind.Number => (v.GetRawText(), false),
            JsonValueKind.True => (bool.TrueString, false),
            JsonValueKind.False => (bool.FalseString, false),
            _ => (Dash, false),
        };
    }
}
