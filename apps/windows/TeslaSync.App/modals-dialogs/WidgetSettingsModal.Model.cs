using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The per-widget configuration the settings modal edits — the native mirror of the web <c>WidgetConfig</c>
/// (web/src/features/dashboard/widgets/types.ts) narrowed to the four keys the
/// <c>WidgetSettingsModal</c> writes: the scoped <see cref="VehicleId"/> (web <c>config.vehicleId</c>), the
/// <see cref="RefreshRate"/> in seconds (web <c>config.refreshRate</c>), the chart <see cref="TimeRange"/>
/// token (web <c>config.timeRange</c>) and the <see cref="ShowTitle"/> chrome flag (web
/// <c>config.showTitle</c>). The web config object also carries arbitrary forward-looking keys
/// (<c>[key: string]: unknown</c>, e.g. <c>chartType</c>) that the modal never edits but preserves when it
/// spreads <c>{ ...prev }</c> on save; <see cref="ExtraJson"/> round-trips those untouched keys verbatim so a
/// save is never lossy. Immutable; mutate through the <c>With*</c> helpers (the native analogue of the web
/// <c>setConfig(prev =&gt; ({ ...prev, key }))</c> updates). Pure data — no WinUI types.
/// </summary>
/// <param name="VehicleId">The scoped vehicle id, or null for "all vehicles" (web <c>config.vehicleId</c>).</param>
/// <param name="RefreshRate">The refresh interval in seconds, or null for the widget default (web <c>config.refreshRate</c>).</param>
/// <param name="TimeRange">The chart time-range token, or null for the default (web <c>config.timeRange</c>).</param>
/// <param name="ShowTitle">Whether the widget title chrome shows, or null (treated as true; web <c>config.showTitle</c>).</param>
/// <param name="ExtraJson">Canonical JSON of any config keys the modal does not edit, preserved on save, or null.</param>
public sealed record WidgetConfig(
    int? VehicleId = null,
    int? RefreshRate = null,
    string? TimeRange = null,
    bool? ShowTitle = null,
    string? ExtraJson = null)
{
    /// <summary>The empty config (no scope, default refresh, default range, default chrome; web <c>{}</c>).</summary>
    public static WidgetConfig Empty { get; } = new();

    /// <summary>The config keys the modal owns; every other key is preserved verbatim through <see cref="ExtraJson"/>.</summary>
    private static readonly HashSet<string> OwnedKeys = new(StringComparer.Ordinal)
    {
        "vehicleId", "vehicle_id", "refreshRate", "refresh_rate",
        "timeRange", "time_range", "showTitle", "show_title",
    };

    /// <summary>Returns a copy with the scoped <paramref name="vehicleId"/> (null clears the scope).</summary>
    /// <param name="vehicleId">The new scoped vehicle id, or null for "all vehicles".</param>
    public WidgetConfig WithVehicleId(int? vehicleId) => this with { VehicleId = vehicleId };

    /// <summary>Returns a copy with the <paramref name="refreshRate"/> in seconds (null restores the default).</summary>
    /// <param name="refreshRate">The new refresh interval in seconds, or null for the widget default.</param>
    public WidgetConfig WithRefreshRate(int? refreshRate) => this with { RefreshRate = refreshRate };

    /// <summary>Returns a copy with the chart <paramref name="timeRange"/> token.</summary>
    /// <param name="timeRange">The new chart time-range token.</param>
    public WidgetConfig WithTimeRange(string? timeRange) => this with { TimeRange = timeRange };

    /// <summary>Returns a copy with the <paramref name="showTitle"/> chrome flag.</summary>
    /// <param name="showTitle">Whether the widget title chrome shows.</param>
    public WidgetConfig WithShowTitle(bool showTitle) => this with { ShowTitle = showTitle };

    /// <summary>
    /// Parse a persisted widget-config object (web <c>widget.config</c>) into the typed shape, lifting the four
    /// owned keys (camelCase or snake_case tolerant) into typed fields and preserving every other key verbatim in
    /// <see cref="ExtraJson"/> (canonical, ordinal-sorted). A non-object body yields <see cref="Empty"/>.
    /// </summary>
    /// <param name="element">The JSON object element for a single widget's config.</param>
    public static WidgetConfig FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        int? vehicleId = ReadInt(element, "vehicleId", "vehicle_id");
        int? refreshRate = ReadInt(element, "refreshRate", "refresh_rate");
        string? timeRange = ReadString(element, "timeRange", "time_range");
        bool? showTitle = ReadBool(element, "showTitle", "show_title");

        var extras = new SortedDictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (JsonProperty property in element.EnumerateObject())
        {
            if (!OwnedKeys.Contains(property.Name))
            {
                extras[property.Name] = property.Value.Clone();
            }
        }

        string? extraJson = extras.Count == 0 ? null : SerializeExtras(extras);
        return new WidgetConfig(vehicleId, refreshRate, timeRange, showTitle, extraJson);
    }

    private static string SerializeExtras(SortedDictionary<string, JsonElement> extras)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            foreach (KeyValuePair<string, JsonElement> entry in extras)
            {
                writer.WritePropertyName(entry.Key);
                entry.Value.WriteTo(writer);
            }

            writer.WriteEndObject();
        }

        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    private static int? ReadInt(JsonElement element, string camel, string snake)
    {
        JsonElement value = Pick(element, camel, snake);
        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt32(out int n) => n,
            JsonValueKind.String when int.TryParse(
                value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out int s) => s,
            _ => null,
        };
    }

    private static string? ReadString(JsonElement element, string camel, string snake)
    {
        JsonElement value = Pick(element, camel, snake);
        return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static bool? ReadBool(JsonElement element, string camel, string snake)
    {
        JsonElement value = Pick(element, camel, snake);
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    private static JsonElement Pick(JsonElement element, string camel, string snake)
    {
        if (element.TryGetProperty(camel, out JsonElement byCamel))
        {
            return byCamel;
        }

        return element.TryGetProperty(snake, out JsonElement bySnake) ? bySnake : default;
    }
}

/// <summary>
/// One value/label choice for a settings dropdown — the native mirror of the web option objects
/// (<c>{ value, label }</c>) the <c>WidgetSettingsModal</c> passes to each <c>Select</c>. <see cref="Value"/>
/// is the stable wire token (the web <c>option.value</c>), <see cref="Label"/> the localized display string
/// (the web <c>option.label</c>). Pure data.
/// </summary>
/// <param name="Value">The stable selection token (web <c>option.value</c>).</param>
/// <param name="Label">The localized display label (web <c>option.label</c>).</param>
public sealed record WidgetSettingsOption(string Value, string Label);

/// <summary>
/// Canonical sentinels, refresh/range tokens and i18n keys for the <c>WidgetSettingsModal</c> surface — the
/// native mirror of <c>web/src/features/dashboard/components/WidgetSettingsModal.tsx</c>. The web component reads
/// its copy through <c>useTranslation('dashboard')</c>; every literal is keyed here (with that literal as the
/// English fallback) so the native view and view-model stay free of inline strings and resolve through the i18n
/// facade. The modal title (web <c>`${def.name} Settings`</c>) is keyed as a <c>{{name}}</c> template so it stays
/// translatable. UI-free so every key + token is asserted headlessly.
/// </summary>
public static class WidgetSettingsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "WidgetSettingsModal";

    /// <summary>The vehicle-scope sentinel for "all vehicles" (web <c>'all'</c>).</summary>
    public const string AllVehiclesValue = "all";

    /// <summary>The refresh-rate sentinel for the widget default (web <c>'default'</c>).</summary>
    public const string DefaultRefreshValue = "default";

    /// <summary>The default chart time-range token when none is configured (web <c>config.timeRange ?? '7d'</c>).</summary>
    public const string DefaultTimeRange = "7d";

    /// <summary>The refresh-interval option tokens, in web render order (default + 5/15/30/60 seconds).</summary>
    public static IReadOnlyList<string> RefreshValues { get; } =
        [DefaultRefreshValue, "5", "15", "30", "60"];

    /// <summary>The time-range option tokens, in web render order (24h / 7d / 30d / 90d).</summary>
    public static IReadOnlyList<string> TimeRangeValues { get; } = ["24h", "7d", "30d", "90d"];

    /// <summary>The modal title with the widget name interpolated (web <c>`${def.name} Settings`</c>).</summary>
    /// <param name="widgetName">The widget display name (web <c>def.name</c>).</param>
    /// <param name="localizer">The i18n facade resolving the title template.</param>
    public static string Title(string widgetName, ILocalizer localizer) =>
        Require(localizer)
            .GetString("dashboard.settings.title", "{{name}} Settings")
            .Replace("{{name}}", widgetName ?? string.Empty, StringComparison.Ordinal);

    /// <summary>Vehicle section title (web <c>dashboard.settings.vehicle</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string VehicleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("dashboard.settings.vehicle", "Vehicle");

    /// <summary>"All vehicles" option label (web <c>dashboard.settings.allVehicles</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string AllVehiclesLabel(ILocalizer localizer) =>
        Require(localizer).GetString("dashboard.settings.allVehicles", "All Vehicles (first)");

    /// <summary>Per-vehicle fallback label when a vehicle has no display name (web <c>`Vehicle ${v.id}`</c>).</summary>
    /// <param name="vehicleId">The vehicle id interpolated into the fallback.</param>
    /// <param name="localizer">The i18n facade.</param>
    public static string VehicleFallbackLabel(long vehicleId, ILocalizer localizer) =>
        Require(localizer)
            .GetString("dashboard.settings.vehicleFallback", "Vehicle {{id}}")
            .Replace("{{id}}", vehicleId.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal);

    /// <summary>Refresh-interval section title (web <c>dashboard.settings.refreshInterval</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string RefreshIntervalLabel(ILocalizer localizer) =>
        Require(localizer).GetString("dashboard.settings.refreshInterval", "Refresh Interval");

    /// <summary>Time-range section title (web <c>dashboard.settings.timeRange</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string TimeRangeLabel(ILocalizer localizer) =>
        Require(localizer).GetString("dashboard.settings.timeRange", "Time Range");

    /// <summary>Appearance section title (web <c>dashboard.settings.appearance</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string AppearanceLabel(ILocalizer localizer) =>
        Require(localizer).GetString("dashboard.settings.appearance", "Appearance");

    /// <summary>Show-title toggle label (web <c>dashboard.settings.showTitle</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ShowTitleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("dashboard.settings.showTitle", "Show widget title");

    /// <summary>Cancel button label (web <c>common.cancel</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string CancelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.cancel", "Cancel");

    /// <summary>Save button label (web <c>common.save</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string SaveLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.save", "Save");

    /// <summary>Loading affordance caption for the vehicle list (the native useVehicles loading branch).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string VehiclesLoadingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("dashboard.settings.vehiclesLoading", "Loading vehicles\u2026");

    /// <summary>Empty-state title for the vehicle list (no vehicles linked).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string VehiclesEmptyTitle(ILocalizer localizer) =>
        Require(localizer).GetString("dashboard.settings.vehiclesEmptyTitle", "No vehicles");

    /// <summary>Empty-state message for the vehicle list (no vehicles linked).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string VehiclesEmptyMessage(ILocalizer localizer) =>
        Require(localizer).GetString(
            "dashboard.settings.vehiclesEmptyMessage", "No vehicles are linked to this account yet.");

    /// <summary>Error-state title for a failed vehicle load (web useVehicles error branch).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string VehiclesErrorTitle(ILocalizer localizer) =>
        Require(localizer).GetString("dashboard.settings.vehiclesErrorTitle", "Couldn\u2019t load vehicles");

    /// <summary>Retry affordance label for a failed vehicle load.</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("dashboard.settings.retry", "Try again");

    /// <summary>Stale chip caption shown when the cached vehicle list is past its freshness window.</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string VehiclesStaleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("dashboard.settings.vehiclesStale", "Showing saved list\u2026 refreshing");

    /// <summary>Offline chip caption shown when the vehicle list is served from cache without connectivity.</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string VehiclesOfflineLabel(ILocalizer localizer) =>
        Require(localizer).GetString("dashboard.settings.vehiclesOffline", "Offline \u2014 showing saved list");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>WidgetSettingsModal</c> surface — the native analogue of the web component's
/// category predicates (<c>isVehicleWidget</c> / <c>isChartWidget</c>), its inline option arrays, the
/// <c>useVehicles</c> response shaping and the <c>setConfig</c> field updates. Every user-visible string flows
/// through the i18n facade so the projection is unit-tested headlessly and the view-model never resolves a
/// literal.
/// </summary>
public static class WidgetSettingsProjection
{
    /// <summary>
    /// True when the widget is vehicle-scoped and the vehicle selector renders (web
    /// <c>def.category !== 'system' &amp;&amp; def.category !== 'analytics'</c>).
    /// </summary>
    /// <param name="category">The widget category.</param>
    public static bool IsVehicleWidget(WidgetCategory category) =>
        category is not (WidgetCategory.System or WidgetCategory.Analytics);

    /// <summary>
    /// True when the widget is chart-backed and the time-range selector renders (web
    /// <c>['driving','charging','analytics','battery'].includes(def.category)</c>).
    /// </summary>
    /// <param name="category">The widget category.</param>
    public static bool IsChartWidget(WidgetCategory category) => category is
        WidgetCategory.Driving or WidgetCategory.Charging or
        WidgetCategory.Analytics or WidgetCategory.Battery;

    /// <summary>
    /// The vehicle dropdown options: the "All Vehicles (first)" sentinel followed by each vehicle, labelled by its
    /// display name or the <c>Vehicle {id}</c> fallback (web <c>[{ value:'all' }, ...vehicleList.map(...)]</c>).
    /// </summary>
    /// <param name="vehicles">The loaded fleet (web <c>vehicles ?? []</c>).</param>
    /// <param name="localizer">The i18n facade resolving the labels.</param>
    public static IReadOnlyList<WidgetSettingsOption> VehicleOptions(
        IReadOnlyList<VehicleOption> vehicles, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(localizer);

        var options = new List<WidgetSettingsOption>(vehicles.Count + 1)
        {
            new(WidgetSettingsRegistration.AllVehiclesValue, WidgetSettingsRegistration.AllVehiclesLabel(localizer)),
        };

        foreach (VehicleOption vehicle in vehicles)
        {
            string label = string.IsNullOrEmpty(vehicle.DisplayName)
                ? WidgetSettingsRegistration.VehicleFallbackLabel(vehicle.Id, localizer)
                : vehicle.DisplayName;
            options.Add(new WidgetSettingsOption(
                vehicle.Id.ToString(CultureInfo.InvariantCulture), label));
        }

        return options;
    }

    /// <summary>The refresh-interval options (default + 5/15/30/60 seconds) with localized labels (web inline array).</summary>
    /// <param name="localizer">The i18n facade resolving the labels.</param>
    public static IReadOnlyList<WidgetSettingsOption> RefreshOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return
        [
            new(WidgetSettingsRegistration.DefaultRefreshValue,
                localizer.GetString("dashboard.settings.default", "Default")),
            new("5", localizer.GetString("dashboard.settings.5s", "5 seconds")),
            new("15", localizer.GetString("dashboard.settings.15s", "15 seconds")),
            new("30", localizer.GetString("dashboard.settings.30s", "30 seconds")),
            new("60", localizer.GetString("dashboard.settings.60s", "1 minute")),
        ];
    }

    /// <summary>The time-range options (24h / 7d / 30d / 90d) with localized labels (web inline array).</summary>
    /// <param name="localizer">The i18n facade resolving the labels.</param>
    public static IReadOnlyList<WidgetSettingsOption> TimeRangeOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return
        [
            new("24h", localizer.GetString("dashboard.settings.24h", "Last 24 hours")),
            new("7d", localizer.GetString("dashboard.settings.7d", "Last 7 days")),
            new("30d", localizer.GetString("dashboard.settings.30d", "Last 30 days")),
            new("90d", localizer.GetString("dashboard.settings.90d", "Last 90 days")),
        ];
    }

    /// <summary>The selected vehicle dropdown token (web <c>config.vehicleId?.toString() ?? 'all'</c>).</summary>
    /// <param name="config">The current config.</param>
    public static string VehicleSelectionValue(WidgetConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);
        return config.VehicleId is { } id
            ? id.ToString(CultureInfo.InvariantCulture)
            : WidgetSettingsRegistration.AllVehiclesValue;
    }

    /// <summary>The selected refresh dropdown token (web <c>config.refreshRate?.toString() ?? 'default'</c>).</summary>
    /// <param name="config">The current config.</param>
    public static string RefreshSelectionValue(WidgetConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);
        return config.RefreshRate is { } rate
            ? rate.ToString(CultureInfo.InvariantCulture)
            : WidgetSettingsRegistration.DefaultRefreshValue;
    }

    /// <summary>The selected time-range dropdown token (web <c>config.timeRange ?? '7d'</c>).</summary>
    /// <param name="config">The current config.</param>
    public static string TimeRangeSelectionValue(WidgetConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);
        return string.IsNullOrEmpty(config.TimeRange)
            ? WidgetSettingsRegistration.DefaultTimeRange
            : config.TimeRange;
    }

    /// <summary>Whether the show-title toggle is on (web <c>config.showTitle !== false</c>; default on).</summary>
    /// <param name="config">The current config.</param>
    public static bool ShowTitleValue(WidgetConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);
        return config.ShowTitle != false;
    }

    /// <summary>
    /// Apply a vehicle dropdown selection to the config (web
    /// <c>vehicleId: val === 'all' ? undefined : Number(val)</c>).
    /// </summary>
    /// <param name="config">The current config.</param>
    /// <param name="value">The chosen dropdown token.</param>
    public static WidgetConfig WithVehicleSelection(WidgetConfig config, string? value)
    {
        ArgumentNullException.ThrowIfNull(config);
        if (string.Equals(value, WidgetSettingsRegistration.AllVehiclesValue, StringComparison.Ordinal) ||
            !int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out int id))
        {
            return config.WithVehicleId(null);
        }

        return config.WithVehicleId(id);
    }

    /// <summary>
    /// Apply a refresh dropdown selection to the config (web
    /// <c>refreshRate: val === 'default' ? undefined : Number(val)</c>).
    /// </summary>
    /// <param name="config">The current config.</param>
    /// <param name="value">The chosen dropdown token.</param>
    public static WidgetConfig WithRefreshSelection(WidgetConfig config, string? value)
    {
        ArgumentNullException.ThrowIfNull(config);
        if (string.Equals(value, WidgetSettingsRegistration.DefaultRefreshValue, StringComparison.Ordinal) ||
            !int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out int rate))
        {
            return config.WithRefreshRate(null);
        }

        return config.WithRefreshRate(rate);
    }

    /// <summary>Apply a time-range dropdown selection to the config (web <c>timeRange: e.target.value</c>).</summary>
    /// <param name="config">The current config.</param>
    /// <param name="value">The chosen dropdown token.</param>
    public static WidgetConfig WithTimeRangeSelection(WidgetConfig config, string? value)
    {
        ArgumentNullException.ThrowIfNull(config);
        return config.WithTimeRange(string.IsNullOrEmpty(value) ? WidgetSettingsRegistration.DefaultTimeRange : value);
    }

    /// <summary>Apply the show-title toggle to the config (web <c>showTitle: checked</c>).</summary>
    /// <param name="config">The current config.</param>
    /// <param name="showTitle">The new toggle state.</param>
    public static WidgetConfig WithShowTitle(WidgetConfig config, bool showTitle)
    {
        ArgumentNullException.ThrowIfNull(config);
        return config.WithShowTitle(showTitle);
    }

    /// <summary>
    /// Parse the <c>GET /vehicles</c> array into presentation-ready <see cref="VehicleOption"/>s (web
    /// <c>useVehicles</c> data), tolerating an absent / partial / schema-drifted body and skipping rows without an
    /// id. Reads snake_case and camelCase keys so the cached body round-trips either shape.
    /// </summary>
    /// <param name="element">The JSON array element returned by <c>GET /vehicles</c>.</param>
    public static IReadOnlyList<VehicleOption> ParseVehicles(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<VehicleOption>();
        }

        var vehicles = new List<VehicleOption>(element.GetArrayLength());
        foreach (JsonElement item in element.EnumerateArray())
        {
            if (ParseVehicle(item) is { } vehicle)
            {
                vehicles.Add(vehicle);
            }
        }

        return vehicles;
    }

    private static VehicleOption? ParseVehicle(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        long? id = ReadLong(element, "id", "id");
        if (id is null)
        {
            return null;
        }

        return new VehicleOption(
            id.Value,
            ReadString(element, "display_name", "displayName"),
            ReadString(element, "vin", "vin"),
            ReadString(element, "model", "model"));
    }

    private static long? ReadLong(JsonElement element, string snake, string camel)
    {
        JsonElement value = Pick(element, snake, camel);
        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt64(out long n) => n,
            JsonValueKind.String when long.TryParse(
                value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long s) => s,
            _ => null,
        };
    }

    private static string? ReadString(JsonElement element, string snake, string camel)
    {
        JsonElement value = Pick(element, snake, camel);
        return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static JsonElement Pick(JsonElement element, string first, string second)
    {
        if (element.TryGetProperty(first, out JsonElement byFirst))
        {
            return byFirst;
        }

        return element.TryGetProperty(second, out JsonElement bySecond) ? bySecond : default;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>WidgetSettingsModal</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never the configured vehicle id, refresh rate, time range or any
/// vehicle name — so a diagnostics line can never leak configuration content. Thread-safe.
/// </summary>
public sealed class WidgetSettingsModalDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _settingsSaved;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The diagnostics sink (defaults to a no-op collector).</param>
    public WidgetSettingsModalDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times settings were saved from this surface.</summary>
    public long SettingsSaved => Interlocked.Read(ref _settingsSaved);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WidgetSettingsModal</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={WidgetSettingsRegistration.Slug}"));
    }

    /// <summary>Record that settings were saved (the configured values are never logged).</summary>
    public void RecordSettingsSaved()
    {
        Interlocked.Increment(ref _settingsSaved);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"settings.saved slug={WidgetSettingsRegistration.Slug}"));
    }
}
