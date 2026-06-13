using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The top-level data state the <c>RedisSignalViewerPage</c> can be in — the native union of the four web data
/// states the page renders (web/src/features/admin/pages/RedisSignalViewerPage.tsx). The web page selects a vehicle,
/// runs a TanStack query for that vehicle's cached Redis signals, and renders, in the table body, its
/// <c>no-vehicle → loading → no-match/diagnostic-empty → rows</c> branch. This enum is the top-level summary the
/// ledger/Narrator key off; per-region visibility is still driven by the projected flags so every branch maps onto a
/// visible surface and none is ever hidden.
/// </summary>
public enum RedisSignalViewerState
{
    /// <summary>The signals query is in flight for the selected vehicle (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>No vehicle is selected, or the selected vehicle has no cached signals (web empty branches).</summary>
    Empty,

    /// <summary>The signals query failed (web <c>isError</c>) — the failure banner is shown above the table.</summary>
    Error,

    /// <summary>The signals query produced rows (web <c>rows.length &gt; 0</c>).</summary>
    Success,
}

/// <summary>The classified value slot of a cached signal — the native union of the web table's value types.</summary>
public enum RedisSignalValueType
{
    /// <summary>A numeric value (web <c>type === 'number'</c>) — info-tinted badge, cyan value text.</summary>
    Number,

    /// <summary>A string value (web <c>type === 'string'</c>) — neutral badge, amber value text.</summary>
    Text,

    /// <summary>A boolean value (web <c>type === 'boolean'</c>) — warning-tinted badge, purple value text.</summary>
    Boolean,
}

/// <summary>The signal-name category bucket — the native port of the web <c>categorizeSignal</c> classifier.</summary>
public enum RedisSignalCategory
{
    /// <summary>Battery / BMS / pack / brick / module signals (web success-tinted).</summary>
    Battery,

    /// <summary>AC / DC / charge / charger signals (web info-tinted).</summary>
    Charging,

    /// <summary>Vehicle / odometer / latitude / longitude / GPS signals (web warning-tinted).</summary>
    Driving,

    /// <summary>Temperature / HVAC / inside / outside / climate signals (web danger-tinted).</summary>
    Climate,

    /// <summary>Everything else (web neutral-tinted).</summary>
    Other,
}

/// <summary>
/// Pure classification helpers porting the web page's <c>categorizeSignal</c>, <c>isLocationSignal</c>,
/// <c>CATEGORY_COLORS</c> and per-type badge-variant rules (web/src/features/admin/pages/RedisSignalViewerPage.tsx).
/// UI-free so the table projection is unit-tested without a XAML host.
/// </summary>
public static class RedisSignalClassifier
{
    /// <summary>Bucket a signal name (web <c>categorizeSignal</c>; lowercased, prefix rules then a climate contains rule).</summary>
    public static RedisSignalCategory Categorize(string name)
    {
        string n = (name ?? string.Empty).ToLowerInvariant();
        if (StartsWithAny(n, "battery", "bms", "pack", "brick", "module"))
        {
            return RedisSignalCategory.Battery;
        }

        if (StartsWithAny(n, "ac", "dc", "charge", "charger"))
        {
            return RedisSignalCategory.Charging;
        }

        if (StartsWithAny(n, "vehicle", "odometer", "latitude", "longitude", "gps"))
        {
            return RedisSignalCategory.Driving;
        }

        if (n.Contains("temp", StringComparison.Ordinal) ||
            n.Contains("hvac", StringComparison.Ordinal) ||
            n.Contains("inside", StringComparison.Ordinal) ||
            n.Contains("outside", StringComparison.Ordinal) ||
            n.Contains("climate", StringComparison.Ordinal))
        {
            return RedisSignalCategory.Climate;
        }

        return RedisSignalCategory.Other;
    }

    /// <summary>
    /// True for lat/lng/gps signal names that the web masks by default (web <c>isLocationSignal</c>): an exact,
    /// lowercased match against the location-coordinate name set so a casual screen share never leaks the parking spot.
    /// </summary>
    public static bool IsLocationSignal(string name)
    {
        string n = (name ?? string.Empty).ToLowerInvariant();
        return n is "latitude" or "longitude" or "gps_lat" or "gps_lng"
            or "gps_latitude" or "gps_longitude" or "location_lat" or "location_lng";
    }

    /// <summary>The literal category label rendered in the table chip (web uses the literal bucket name, un-i18n'd).</summary>
    public static string CategoryLabel(RedisSignalCategory category) => category switch
    {
        RedisSignalCategory.Battery => "Battery",
        RedisSignalCategory.Charging => "Charging",
        RedisSignalCategory.Driving => "Driving",
        RedisSignalCategory.Climate => "Climate",
        _ => "Other",
    };

    /// <summary>The wire type token rendered in the table type chip (web <c>row.type</c>).</summary>
    public static string TypeLabel(RedisSignalValueType type) => type switch
    {
        RedisSignalValueType.Number => "number",
        RedisSignalValueType.Boolean => "boolean",
        _ => "string",
    };

    /// <summary>The type chip's semantic tint (web <c>number → info, boolean → warning, else neutral</c>).</summary>
    public static StatusKind TypeVariant(RedisSignalValueType type) => type switch
    {
        RedisSignalValueType.Number => StatusKind.Info,
        RedisSignalValueType.Boolean => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    /// <summary>The category chip's semantic tint (web <c>CATEGORY_COLORS</c>).</summary>
    public static StatusKind CategoryVariant(RedisSignalCategory category) => category switch
    {
        RedisSignalCategory.Battery => StatusKind.Success,
        RedisSignalCategory.Charging => StatusKind.Info,
        RedisSignalCategory.Driving => StatusKind.Warning,
        RedisSignalCategory.Climate => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    private static bool StartsWithAny(string value, params string[] prefixes)
    {
        foreach (var prefix in prefixes)
        {
            if (value.StartsWith(prefix, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }
}

/// <summary>Small null-tolerant JSON readers shared by the Redis-signal parsers (UI-free, unit-tested).</summary>
internal static class RedisJson
{
    public static string? Str(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    public static long? Long(JsonElement o, string name)
    {
        if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out var v))
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

    public static bool Bool(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) &&
        v.ValueKind is JsonValueKind.True or JsonValueKind.False && v.GetBoolean();
}

/// <summary>
/// One cached signal row — the native mirror of an entry in the web <c>RedisSignalsResponse.signals</c> map
/// (web/src/api/devtools.ts). <see cref="Value"/> is the already-stringified value (web <c>String(row.value)</c>);
/// <see cref="Type"/> / <see cref="Category"/> are the classified slots; <see cref="IsLocation"/> marks the rows the
/// table masks by default. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record RedisSignalEntry(
    string Name,
    string Value,
    RedisSignalValueType Type,
    RedisSignalCategory Category,
    bool IsLocation);

/// <summary>
/// The diagnostic metadata block returned alongside the signals (web <c>RedisSignalsMeta</c>): the live-signal-store
/// mode, the vehicle VIN and the L1/L2 last-seen timestamps the persistent header chips surface. Null-tolerant parse.
/// </summary>
public sealed record RedisSignalsMeta(
    string LiveSignalStoreMode,
    string? VehicleVin,
    string? L1LastSeenAt,
    string? L2LastSeenAt)
{
    /// <summary>Read the <c>meta</c> object, tolerating missing / null fields.</summary>
    public static RedisSignalsMeta FromJson(JsonElement o) => new(
        LiveSignalStoreMode: RedisJson.Str(o, "live_signal_store_mode") ?? string.Empty,
        VehicleVin: RedisJson.Str(o, "vehicle_vin"),
        L1LastSeenAt: RedisJson.Str(o, "l1_last_seen_at"),
        L2LastSeenAt: RedisJson.Str(o, "l2_last_seen_at"));
}

/// <summary>
/// One resolved Redis-signals payload — the native mirror of the web <c>RedisSignalsResponse</c>: the total
/// <see cref="SignalCount"/>, the classified + name-sorted <see cref="Signals"/> rows and the optional
/// <see cref="Meta"/> diagnostic block. Parsing is null-tolerant so a partial payload never throws.
/// </summary>
public sealed record RedisSignalsSnapshot(
    long VehicleId,
    int SignalCount,
    IReadOnlyList<RedisSignalEntry> Signals,
    RedisSignalsMeta? Meta)
{
    /// <summary>An empty, resolved snapshot.</summary>
    public static RedisSignalsSnapshot Empty { get; } = new(0, 0, Array.Empty<RedisSignalEntry>(), null);

    /// <summary>Parse a <c>GET /dev-tools/redis-signals</c> JSON object into a tolerant snapshot.</summary>
    public static RedisSignalsSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var rows = new List<RedisSignalEntry>();
        if (o.TryGetProperty("signals", out var signals) && signals.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in signals.EnumerateObject())
            {
                rows.Add(BuildEntry(prop.Name, prop.Value));
            }
        }

        // web: Object.entries(...).sort((a, b) => a.name.localeCompare(b.name)).
        rows.Sort(static (a, b) => string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));

        long vehicleId = RedisJson.Long(o, "vehicle_id") ?? 0;
        int count = (int)(RedisJson.Long(o, "signal_count") ?? rows.Count);

        RedisSignalsMeta? meta = null;
        if (o.TryGetProperty("meta", out var metaEl) && metaEl.ValueKind == JsonValueKind.Object)
        {
            meta = RedisSignalsMeta.FromJson(metaEl);
        }

        return new RedisSignalsSnapshot(vehicleId, count, rows, meta);
    }

    private static RedisSignalEntry BuildEntry(string name, JsonElement entry)
    {
        string typeToken = RedisJson.Str(entry, "type") ?? string.Empty;
        JsonElement valueEl = entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty("value", out var v)
            ? v
            : default;

        RedisSignalValueType type = typeToken switch
        {
            "number" => RedisSignalValueType.Number,
            "boolean" => RedisSignalValueType.Boolean,
            "string" => RedisSignalValueType.Text,
            _ => ClassifyByKind(valueEl),
        };

        return new RedisSignalEntry(
            name,
            FormatValue(valueEl, type),
            type,
            RedisSignalClassifier.Categorize(name),
            RedisSignalClassifier.IsLocationSignal(name));
    }

    private static RedisSignalValueType ClassifyByKind(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Number => RedisSignalValueType.Number,
        JsonValueKind.True or JsonValueKind.False => RedisSignalValueType.Boolean,
        _ => RedisSignalValueType.Text,
    };

    private static string FormatValue(JsonElement value, RedisSignalValueType type)
    {
        if (value.ValueKind == JsonValueKind.Undefined || value.ValueKind == JsonValueKind.Null)
        {
            return string.Empty;
        }

        return value.ValueKind switch
        {
            // web String(value): integers without a decimal, floats as written — the raw JSON literal matches closest.
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.String => value.GetString() ?? string.Empty,
            _ => value.GetRawText(),
        };
    }
}

/// <summary>
/// One fleet entry filling the page's vehicle picker — the native port of the web <c>useVehicles</c> list row
/// (<c>{ id, display_name, vin }</c>). <see cref="Label"/> mirrors the web
/// <c>display_name || vin || `Vehicle ${id}`</c> fallback. Pure data; parsing is null-tolerant.
/// </summary>
public sealed record RedisSignalViewerVehicle(long Id, string? DisplayName, string? Vin)
{
    /// <summary>The picker label (web <c>display_name || vin || `Vehicle ${id}`</c>).</summary>
    public string Label => !string.IsNullOrWhiteSpace(DisplayName)
        ? DisplayName!
        : !string.IsNullOrWhiteSpace(Vin)
            ? Vin!
            : string.Create(CultureInfo.CurrentCulture, $"Vehicle {Id}");

    /// <summary>Parse a <c>GET /vehicles</c> JSON array into a tolerant list of fleet entries.</summary>
    public static IReadOnlyList<RedisSignalViewerVehicle> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<RedisSignalViewerVehicle>();
        }

        var list = new List<RedisSignalViewerVehicle>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long? id = RedisJson.Long(item, "id");
            if (id is null)
            {
                continue;
            }

            list.Add(new RedisSignalViewerVehicle(id.Value, RedisJson.Str(item, "display_name"), RedisJson.Str(item, "vin")));
        }

        return list;
    }
}

/// <summary>The result of a per-vehicle purge (web <c>RedisSignalsPurgeResponse</c>).</summary>
public sealed record RedisPurgeResult(bool Purged)
{
    /// <summary>Read the purge response, defaulting <c>purged</c> to false.</summary>
    public static RedisPurgeResult FromJson(JsonElement o) => new(RedisJson.Bool(o, "purged"));
}

/// <summary>The result of a cluster-wide purge (web <c>RedisSignalsPurgeAllResponse</c>).</summary>
public sealed record RedisPurgeAllResult(int Purged, int Scanned, int Limit, bool HasMore)
{
    /// <summary>Read the purge-all response, tolerating missing fields.</summary>
    public static RedisPurgeAllResult FromJson(JsonElement o) => new(
        Purged: (int)(RedisJson.Long(o, "purged") ?? 0),
        Scanned: (int)(RedisJson.Long(o, "scanned") ?? 0),
        Limit: (int)(RedisJson.Long(o, "limit") ?? 0),
        HasMore: RedisJson.Bool(o, "has_more"));
}

/// <summary>The two destructive purge paths a single confirmation dialog serves (web <c>purgeMode</c>).</summary>
public enum RedisPurgeMode
{
    /// <summary>No purge dialog is open.</summary>
    None,

    /// <summary>The per-vehicle purge (web <c>'one'</c>).</summary>
    One,

    /// <summary>The cluster-wide purge requiring a typed confirmation (web <c>'all'</c>).</summary>
    All,
}

/// <summary>
/// The render-time data model the <c>RedisSignalViewerPage</c> projects from — the native analogue of the web page's
/// resolved query + URL/local state (web/src/features/admin/pages/RedisSignalViewerPage.tsx). Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record RedisSignalViewerModel(
    IReadOnlyList<RedisSignalViewerVehicle> Vehicles,
    long? SelectedVehicleId,
    string Search,
    string CategoryFilter,
    bool AutoRefresh,
    RedisSignalsSnapshot? Snapshot,
    bool Loading,
    bool IsFetching,
    bool HasError,
    string? ErrorDetail,
    RedisPurgeMode PurgeMode,
    string PurgeTargetLabel,
    bool IsPurging)
{
    /// <summary>The initial model — nothing selected, the first load not yet started.</summary>
    public static RedisSignalViewerModel Initial { get; } = new(
        Vehicles: Array.Empty<RedisSignalViewerVehicle>(),
        SelectedVehicleId: null,
        Search: string.Empty,
        CategoryFilter: RedisCategoryFilter.All,
        AutoRefresh: false,
        Snapshot: null,
        Loading: false,
        IsFetching: false,
        HasError: false,
        ErrorDetail: null,
        PurgeMode: RedisPurgeMode.None,
        PurgeTargetLabel: string.Empty,
        IsPurging: false);
}

/// <summary>The sentinel category-filter value meaning "all categories" (web <c>'all'</c>).</summary>
public static class RedisCategoryFilter
{
    /// <summary>The all-categories sentinel.</summary>
    public const string All = "all";
}

/// <summary>One projected, render-ready signal row (web table row).</summary>
public sealed record RedisSignalRowDisplay(
    string Name,
    string Value,
    bool IsMasked,
    string RawValue,
    string TypeLabel,
    StatusKind TypeVariant,
    string CategoryLabel,
    StatusKind CategoryVariant);

/// <summary>One projected stat tile (web <c>StatCard</c>).</summary>
public sealed record RedisStatCardDisplay(string Label, string Value, string Glyph, string AutomationName);

/// <summary>One projected vehicle-picker option (web <c>VehicleSelect</c> option).</summary>
public sealed record RedisVehicleOptionDisplay(long Id, string Label);

/// <summary>One projected category-filter option (web <c>UiSelect</c> option with its live count).</summary>
public sealed record RedisCategoryOptionDisplay(string Value, string Label);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade. Holds the six panels (the controls panel
/// GlassPanel1, the four stat tiles, and the table panel GlassPanel6), the four data-state flags, the diagnostic
/// chips, and the destructive-purge dialog chrome. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record RedisSignalViewerDisplay(
    RedisSignalViewerState State,
    string Title,
    string Subtitle,
    string AutomationName,

    // Controls (GlassPanel1).
    string SelectVehiclePrompt,
    IReadOnlyList<RedisVehicleOptionDisplay> VehicleOptions,
    long? SelectedVehicleId,
    string SearchHint,
    string SearchValue,
    IReadOnlyList<RedisCategoryOptionDisplay> CategoryOptions,
    string CategoryFilter,
    string AutoRefreshLabel,
    bool AutoRefresh,
    string RefreshLabel,
    bool CanRefresh,
    string PurgeButtonText,
    string PurgeButtonTitle,
    bool CanPurgeOne,
    string PurgeAllButtonText,
    string PurgeAllButtonTitle,
    bool CanPurgeAll,

    // Failure banner (web isError).
    bool HasError,
    string ErrorBannerText,

    // Diagnostic chips (web meta chips).
    bool ShowDiagnosticChips,
    string ModeChipText,
    StatusKind ModeChipVariant,
    bool ShowVinChip,
    string VinChipText,
    bool ShowL1Chip,
    string L1ChipText,

    // Stat tiles (Total / Numbers / Strings / Booleans).
    bool ShowStats,
    IReadOnlyList<RedisStatCardDisplay> StatCards,

    // Table panel (GlassPanel6).
    IReadOnlyList<string> ColumnHeaders,
    IReadOnlyList<RedisSignalRowDisplay> Rows,
    bool ShowSelectPrompt,
    string SelectPromptMessage,
    bool ShowTableLoading,
    bool ShowNoMatch,
    string NoMatchMessage,
    bool ShowNoSignals,
    string NoSignalsMessage,
    bool ShowTable,
    string MaskedCoordLabel,

    // Purge dialog chrome (web ConfirmDialog).
    bool ShowPurgeDialog,
    bool PurgeRequiresTypedConfirmation,
    string PurgeDialogTitle,
    string PurgeDialogMessage,
    string PurgeConfirmLabel,
    string PurgeCancelLabel,
    string PurgeTypedConfirmationLabel,
    bool IsPurging,

    // Purge-result templates (web toasts) — formatted by the view-model on completion.
    string PurgeSuccessTitle,
    string PurgeSuccessDetailTemplate,
    string PurgeNoOpTitle,
    string PurgeNoOpDetailTemplate,
    string PurgeAllSuccessTitle,
    string PurgeAllSuccessDetailTemplate,
    string PurgeAllPartialTitle,
    string PurgeAllPartialDetailTemplate,
    string PurgeErrorTitle);

/// <summary>
/// Pure projection from a <see cref="RedisSignalViewerModel"/> to its <see cref="RedisSignalViewerDisplay"/> — the
/// native port of the render logic in web/src/features/admin/pages/RedisSignalViewerPage.tsx. Every visible literal
/// resolves through the i18n facade using the exact web key names; counts format through
/// <see cref="NumberFormatting"/> (the web <c>fmtInt</c> port). Every chrome string is resolved on every projection
/// (visibility is gated by the returned flags), so the i18n contract holds in every data state. No WinUI types — the
/// projection is unit-tested without a UI host.
/// </summary>
public static class RedisSignalViewerProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> empty-value markers.</summary>
    public const string EmDash = "\u2014";

    private const string GlyphDatabase = "\uEA86"; // Database / storage (web Database icon)

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query + local state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static RedisSignalViewerDisplay Project(RedisSignalViewerModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("redis.title", "Redis Signal Viewer");
        string subtitle = localizer.GetString("redis.subtitle", "Inspect cached signal values in Redis");

        bool noVehicle = model.SelectedVehicleId is null;
        var allRows = model.Snapshot?.Signals ?? Array.Empty<RedisSignalEntry>();
        var filtered = FilterRows(allRows, model.Search, model.CategoryFilter);

        bool loading = !noVehicle && model.Loading;
        bool error = model.HasError;
        bool hasRows = allRows.Count > 0;

        RedisSignalViewerState state = noVehicle
            ? RedisSignalViewerState.Empty
            : loading
                ? RedisSignalViewerState.Loading
                : error
                    ? RedisSignalViewerState.Error
                    : hasRows
                        ? RedisSignalViewerState.Success
                        : RedisSignalViewerState.Empty;

        // ── Vehicle picker (web useVehicles → VehicleSelect) ────────────────────────────────────────────
        var vehicleOptions = new List<RedisVehicleOptionDisplay>(model.Vehicles.Count);
        foreach (var vehicle in model.Vehicles)
        {
            vehicleOptions.Add(new RedisVehicleOptionDisplay(vehicle.Id, vehicle.Label));
        }

        // ── Category filter options with live counts (web categoryCounts) ───────────────────────────────
        int battery = CountCategory(allRows, RedisSignalCategory.Battery);
        int charging = CountCategory(allRows, RedisSignalCategory.Charging);
        int driving = CountCategory(allRows, RedisSignalCategory.Driving);
        int climate = CountCategory(allRows, RedisSignalCategory.Climate);
        int other = CountCategory(allRows, RedisSignalCategory.Other);

        var categoryOptions = new List<RedisCategoryOptionDisplay>(6)
        {
            new(RedisCategoryFilter.All, localizer.GetString("redis.allCategories", "All Categories")),
            new("Battery", $"Battery ({FmtInt(battery)})"),
            new("Charging", $"Charging ({FmtInt(charging)})"),
            new("Driving", $"Driving ({FmtInt(driving)})"),
            new("Climate", $"Climate ({FmtInt(climate)})"),
            new("Other", $"Other ({FmtInt(other)})"),
        };

        // ── Stat tiles (web StatCard ×4) ────────────────────────────────────────────────────────────────
        bool showEmDash = loading || error;
        int total = model.Snapshot?.SignalCount ?? 0;
        int numbers = CountType(allRows, RedisSignalValueType.Number);
        int strings = CountType(allRows, RedisSignalValueType.Text);
        int booleans = CountType(allRows, RedisSignalValueType.Boolean);

        string totalLabel = localizer.GetString("redis.totalSignals", "Total Signals");
        string numbersLabel = localizer.GetString("redis.numbers", "Numbers");
        string stringsLabel = localizer.GetString("redis.strings", "Strings");
        string booleansLabel = localizer.GetString("redis.booleans", "Booleans");

        var statCards = new List<RedisStatCardDisplay>(4)
        {
            Stat(totalLabel, showEmDash ? EmDash : FmtInt(total), GlyphDatabase),
            Stat(numbersLabel, showEmDash ? EmDash : FmtInt(numbers), string.Empty),
            Stat(stringsLabel, showEmDash ? EmDash : FmtInt(strings), string.Empty),
            Stat(booleansLabel, showEmDash ? EmDash : FmtInt(booleans), string.Empty),
        };

        // ── Diagnostic chips (web meta chips) ───────────────────────────────────────────────────────────
        string modeTemplate = localizer.GetString("redis.headerChip.mode", "Mode: {0}");
        string l1Template = localizer.GetString("redis.headerChip.l1Seen", "L1 last: {0}");
        var meta = model.Snapshot?.Meta;
        bool showChips = !noVehicle && meta is not null;
        string mode = meta?.LiveSignalStoreMode ?? string.Empty;
        bool hybrid = string.Equals(mode, "hybrid", StringComparison.OrdinalIgnoreCase);
        string modeChip = string.Format(CultureInfo.CurrentCulture, modeTemplate, mode);
        bool showVin = showChips && !string.IsNullOrWhiteSpace(meta!.VehicleVin);
        string vinChip = meta?.VehicleVin ?? string.Empty;
        bool showL1 = showChips && !string.IsNullOrWhiteSpace(meta!.L1LastSeenAt);
        string l1Chip = string.Format(CultureInfo.CurrentCulture, l1Template, FormatTime(meta?.L1LastSeenAt));

        // ── Table chrome (web GlassPanel table body) ────────────────────────────────────────────────────
        var columnHeaders = new[]
        {
            localizer.GetString("redis.signalName", "Signal Name"),
            localizer.GetString("redis.value", "Value"),
            localizer.GetString("redis.type", "Type"),
            localizer.GetString("redis.category", "Category"),
        };
        string maskedCoordLabel = localizer.GetString("redis.maskedCoord", "Coordinate, click to reveal");

        var rows = new List<RedisSignalRowDisplay>(filtered.Count);
        foreach (var entry in filtered)
        {
            bool masked = entry.IsLocation;
            rows.Add(new RedisSignalRowDisplay(
                entry.Name,
                masked ? MaskCoordinate(entry.Value) : entry.Value,
                masked,
                entry.Value,
                RedisSignalClassifier.TypeLabel(entry.Type),
                RedisSignalClassifier.TypeVariant(entry.Type),
                RedisSignalClassifier.CategoryLabel(entry.Category),
                RedisSignalClassifier.CategoryVariant(entry.Category)));
        }

        bool showSelectPrompt = noVehicle;
        bool showTableLoading = loading;
        bool showNoMatch = !noVehicle && !loading && hasRows && filtered.Count == 0;
        bool showNoSignals = !noVehicle && !loading && !hasRows;
        bool showTable = !noVehicle && !loading && filtered.Count > 0;

        // ── Failure banner (web isError) ────────────────────────────────────────────────────────────────
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorBanner = error && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;

        // ── Purge buttons + dialog (web ConfirmDialog) ──────────────────────────────────────────────────
        string purgeButton = localizer.GetString("redis.purgeButton", "Purge Redis (L2)");
        string purgeButtonTitle = localizer.GetString("redis.purgeButtonTitle", "Delete this vehicle's cached signals from Redis (L2). The in-process L1 cache on each pod stays put and refills from new telemetry.");
        string purgeAllButton = localizer.GetString("redis.purgeAllButton", "Purge All Redis");
        string purgeAllButtonTitle = localizer.GetString("redis.purgeAllButtonTitle", "Delete every vehicle:*:signals HSET in Redis (L2). Requires typed confirmation.");

        string purgeTitleTemplate = localizer.GetString("redis.purgeTitle", "Purge Redis (L2) cache for {0}?");
        string purgeMessage = localizer.GetString("redis.purgeMessage", "This deletes the Redis HSET for this vehicle (L2 cache only). The L1 in-memory cache on this pod is NOT touched and will refill as new telemetry arrives. Read-paths on other pods may briefly read stale L1 values until the next signal arrives.");
        string purgeConfirm = localizer.GetString("redis.purgeConfirm", "Purge Redis (L2)");
        string purgeAllTitle = localizer.GetString("redis.purgeAllTitle", "Purge ALL Redis (L2) caches?");
        string purgeAllMessage = localizer.GetString("redis.purgeAllMessage", "This deletes every vehicle:*:signals HSET in Redis (the L2 cache). The L1 in-memory cache on each pod is NOT touched and will refill as new telemetry arrives. Read-paths on other pods may briefly read stale L1 values until the next signal arrives. If more than 1000 keys exist, you may need to click Purge All Redis again to drain.");
        string purgeAllConfirm = localizer.GetString("redis.purgeAllConfirm", "Purge All Vehicles");
        string purgeAllTypedLabel = localizer.GetString("redis.purgeAllTypedLabel", "Type PURGE ALL to confirm");
        string cancel = localizer.GetString("common.cancel", "Cancel");

        bool purgeAllMode = model.PurgeMode == RedisPurgeMode.All;
        bool showPurgeDialog = model.PurgeMode != RedisPurgeMode.None;
        string purgeDialogTitle = purgeAllMode
            ? purgeAllTitle
            : string.Format(CultureInfo.CurrentCulture, purgeTitleTemplate, model.PurgeTargetLabel);
        string purgeDialogMessage = purgeAllMode ? purgeAllMessage : purgeMessage;
        string purgeDialogConfirm = purgeAllMode ? purgeAllConfirm : purgeConfirm;

        // ── Purge-result templates (web toasts) — resolved here so every key is exercised in the projection.
        string purgeSuccessTitle = localizer.GetString("redis.purgeSuccess", "Redis L2 cache purged");
        string purgeSuccessDetail = localizer.GetString("redis.purgeSuccessDetail", "{0}: Redis HSET removed. L1 in-memory caches on each pod will refill from new telemetry.");
        string purgeNoOpTitle = localizer.GetString("redis.purgeNoOpTitle", "Nothing to purge");
        string purgeNoOpDetail = localizer.GetString("redis.purgeNoOpDetail", "{0} had no cached signals in Redis.");
        string purgeAllSuccessTitle = localizer.GetString("redis.purgeAllSuccess", "Redis L2 cache purged");
        string purgeAllSuccessDetail = localizer.GetString("redis.purgeAllSuccessDetail", "Removed {0} vehicle HSET(s) from Redis. L1 in-memory caches on each pod will refill from new telemetry.");
        string purgeAllPartialTitle = localizer.GetString("redis.purgeAllPartial", "Redis L2 cache partially purged");
        string purgeAllPartialDetail = localizer.GetString("redis.purgeAllPartialDetail", "Removed {0} of up to {1} vehicle HSET(s) from Redis. More keys remain — click Purge All Redis again to drain.");
        string purgeErrorTitle = localizer.GetString("redis.purgeError", "Purge failed");

        string autoRefreshLabel = localizer.GetString("redis.autoRefresh", "Auto-refresh");
        string refreshLabel = localizer.GetString("redis.refresh", "Refresh");
        string selectVehiclePrompt = localizer.GetString("redis.selectVehicle", "Select vehicle\u2026");
        string searchHint = localizer.GetString("redis.searchPlaceholder", "Filter signals\u2026"); // parity:allow web i18n key name redis.searchPlaceholder
        string selectPrompt = localizer.GetString("redis.selectPrompt", "Select a vehicle to view its cached Redis signals");
        string noMatch = localizer.GetString("redis.noMatch", "No signals match the current filter");
        string noSignals = localizer.GetString("redis.noSignals", "No signals cached for this vehicle");

        return new RedisSignalViewerDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            AutomationName: title,
            SelectVehiclePrompt: selectVehiclePrompt,
            VehicleOptions: vehicleOptions,
            SelectedVehicleId: model.SelectedVehicleId,
            SearchHint: searchHint,
            SearchValue: model.Search,
            CategoryOptions: categoryOptions,
            CategoryFilter: string.IsNullOrEmpty(model.CategoryFilter) ? RedisCategoryFilter.All : model.CategoryFilter,
            AutoRefreshLabel: autoRefreshLabel,
            AutoRefresh: model.AutoRefresh,
            RefreshLabel: refreshLabel,
            CanRefresh: !noVehicle && !model.IsFetching,
            PurgeButtonText: purgeButton,
            PurgeButtonTitle: purgeButtonTitle,
            CanPurgeOne: !noVehicle && !model.IsPurging,
            PurgeAllButtonText: purgeAllButton,
            PurgeAllButtonTitle: purgeAllButtonTitle,
            CanPurgeAll: !model.IsPurging,
            HasError: error,
            ErrorBannerText: errorBanner,
            ShowDiagnosticChips: showChips,
            ModeChipText: modeChip,
            ModeChipVariant: hybrid ? StatusKind.Success : StatusKind.Danger,
            ShowVinChip: showVin,
            VinChipText: vinChip,
            ShowL1Chip: showL1,
            L1ChipText: l1Chip,
            ShowStats: !noVehicle,
            StatCards: statCards,
            ColumnHeaders: columnHeaders,
            Rows: rows,
            ShowSelectPrompt: showSelectPrompt,
            SelectPromptMessage: selectPrompt,
            ShowTableLoading: showTableLoading,
            ShowNoMatch: showNoMatch,
            NoMatchMessage: noMatch,
            ShowNoSignals: showNoSignals,
            NoSignalsMessage: noSignals,
            ShowTable: showTable,
            MaskedCoordLabel: maskedCoordLabel,
            ShowPurgeDialog: showPurgeDialog,
            PurgeRequiresTypedConfirmation: purgeAllMode,
            PurgeDialogTitle: purgeDialogTitle,
            PurgeDialogMessage: purgeDialogMessage,
            PurgeConfirmLabel: purgeDialogConfirm,
            PurgeCancelLabel: cancel,
            PurgeTypedConfirmationLabel: purgeAllTypedLabel,
            IsPurging: model.IsPurging,
            PurgeSuccessTitle: purgeSuccessTitle,
            PurgeSuccessDetailTemplate: purgeSuccessDetail,
            PurgeNoOpTitle: purgeNoOpTitle,
            PurgeNoOpDetailTemplate: purgeNoOpDetail,
            PurgeAllSuccessTitle: purgeAllSuccessTitle,
            PurgeAllSuccessDetailTemplate: purgeAllSuccessDetail,
            PurgeAllPartialTitle: purgeAllPartialTitle,
            PurgeAllPartialDetailTemplate: purgeAllPartialDetail,
            PurgeErrorTitle: purgeErrorTitle);
    }

    /// <summary>Filter rows by the search query and the category sentinel (web <c>filteredRows</c>).</summary>
    public static IReadOnlyList<RedisSignalEntry> FilterRows(
        IReadOnlyList<RedisSignalEntry> rows,
        string search,
        string categoryFilter)
    {
        ArgumentNullException.ThrowIfNull(rows);
        IEnumerable<RedisSignalEntry> result = rows;

        if (!string.IsNullOrEmpty(search))
        {
            string q = search.ToLowerInvariant();
            result = result.Where(r => r.Name.ToLowerInvariant().Contains(q, StringComparison.Ordinal));
        }

        if (!string.IsNullOrEmpty(categoryFilter) && !string.Equals(categoryFilter, RedisCategoryFilter.All, StringComparison.Ordinal))
        {
            result = result.Where(r => string.Equals(RedisSignalClassifier.CategoryLabel(r.Category), categoryFilter, StringComparison.Ordinal));
        }

        return result.ToList();
    }

    /// <summary>Mask a coordinate value for default-hidden location rows (digits → •, structure preserved).</summary>
    public static string MaskCoordinate(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return EmDash;
        }

        var chars = value.ToCharArray();
        for (int i = 0; i < chars.Length; i++)
        {
            if (char.IsDigit(chars[i]))
            {
                chars[i] = '\u2022';
            }
        }

        return new string(chars);
    }

    private static int CountCategory(IReadOnlyList<RedisSignalEntry> rows, RedisSignalCategory category)
    {
        int count = 0;
        foreach (var row in rows)
        {
            if (row.Category == category)
            {
                count++;
            }
        }

        return count;
    }

    private static int CountType(IReadOnlyList<RedisSignalEntry> rows, RedisSignalValueType type)
    {
        int count = 0;
        foreach (var row in rows)
        {
            if (row.Type == type)
            {
                count++;
            }
        }

        return count;
    }

    private static RedisStatCardDisplay Stat(string label, string value, string glyph) =>
        new(label, value, glyph, $"{label}: {value}");

    private static string FmtInt(long value) => NumberFormatting.Format(value, null, 0);

    private static string FormatTime(string? iso)
    {
        if (string.IsNullOrWhiteSpace(iso))
        {
            return EmDash;
        }

        return DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed)
            ? parsed.ToLocalTime().ToString("t", CultureInfo.CurrentCulture)
            : iso;
    }
}

/// <summary>
/// Navigation / contract registration for the <c>RedisSignalViewerPage</c> surface — the route name, the diagnostics
/// slug, the generated operation ids the feed binds, the query/path parameter names, and the localized title /
/// subtitle. Centralizing the operation ids keeps the contract strings out of the feed and lets a single test assert
/// they resolve against the generated endpoint table.
/// </summary>
public static class RedisSignalViewerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "RedisSignalViewerPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>RedisSignalViewer</c>).</summary>
    public const string RouteName = "RedisSignalViewer";

    /// <summary>The browser-tab title key (web <c>usePageTitle(t('redis.title'))</c>).</summary>
    public const string PageTitleKey = "redis.title";

    /// <summary>Generated operation id for <c>GET /api/v1/vehicles</c> (web <c>useVehicles</c> fleet list).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>Generated operation id for <c>GET /api/v1/dev-tools/redis-signals</c> (web <c>getRedisSignals</c>).</summary>
    public const string SignalsOperation = "get_api_v1_dev_tools_redis_signals";

    /// <summary>Generated operation id for <c>DELETE /api/v1/dev-tools/redis-signals</c> (web <c>purgeRedisSignals</c>).</summary>
    public const string PurgeOperation = "delete_api_v1_dev_tools_redis_signals";

    /// <summary>Generated operation id for <c>DELETE /api/v1/dev-tools/redis-signals/keys</c> (web <c>purgeAllRedisSignals</c>).</summary>
    public const string PurgeAllOperation = "delete_api_v1_dev_tools_redis_signals_keys";

    /// <summary>The snake_case vehicle-id query-parameter name the Go API expects (never camelCase).</summary>
    public const string VehicleIdQueryParam = "vehicle_id";

    /// <summary>The localized page title (web <c>redis.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("redis.title", "Redis Signal Viewer");
    }

    /// <summary>The localized page subtitle (web <c>redis.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("redis.subtitle", "Inspect cached signal values in Redis");
    }

    /// <summary>The localized browser-tab title (web <c>usePageTitle</c>).</summary>
    public static string PageTitle(ILocalizer localizer) => Title(localizer);
}

/// <summary>
/// PII-safe diagnostics for the <c>RedisSignalViewerPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a VIN, signal value, coordinate or error body —
/// so a diagnostics line can never leak cached telemetry. Thread-safe.
/// </summary>
public sealed class RedisSignalViewerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public RedisSignalViewerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RedisSignalViewerPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RedisSignalViewerRegistration.Slug}");
    }
}
