using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets.VehicleSpecs;

/// <summary>
/// The lifecycle state a <see cref="VehicleSpecsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>VehicleSpecsWidget</c> renders
/// through <c>WidgetShell</c> + <c>WidgetDetailCard</c>
/// (web/src/features/dashboard/widgets/VehicleSpecsWidget.tsx). Every branch maps onto a visible surface;
/// none is ever hidden. <see cref="Empty"/> is the web <c>!hasAnyData</c> gate ("No specs available") — it
/// is reached both when the composite read resolves no specs / options / config and when no vehicle is
/// available (the web's disabled queries).
/// </summary>
public enum VehicleSpecsState
{
    /// <summary>Initial fetch with no cached payload — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh data (or non-stale cache) with at least one of specs / options / config present.</summary>
    Loaded,

    /// <summary>The read resolved no configuration reference at all — render the "No specs available" empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached value exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached value older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached value remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Tolerant JSON readers shared by the specs / options / config parsers. They never throw on an absent or
/// wrong-kind value so a partial wire body degrades gracefully, mirroring the web component's defensive
/// <c>asString(...) ?? …</c> reads (web/src/features/dashboard/widgets/VehicleSpecsWidget.tsx).
/// </summary>
internal static class VehicleSpecsJson
{
    /// <summary>
    /// The native port of the web <c>asString</c> helper: a non-empty JSON string is returned verbatim, a
    /// JSON number is stringified (invariant), and every other kind — JSON <c>null</c>, an empty string, a
    /// boolean, an object or an array — yields <see langword="null"/>.
    /// </summary>
    internal static string? AsString(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString() is { Length: > 0 } s ? s : null,
        JsonValueKind.Number => FormatNumber(value),
        _ => null,
    };

    /// <summary>Reads <paramref name="name"/> from <paramref name="obj"/> through <see cref="AsString"/> (absent ⇒ null).</summary>
    internal static string? StringField(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) ? AsString(v) : null;

    private static string FormatNumber(JsonElement value)
    {
        if (value.TryGetInt64(out long whole))
        {
            return whole.ToString(CultureInfo.InvariantCulture);
        }

        return value.GetDouble().ToString(CultureInfo.InvariantCulture);
    }
}

/// <summary>
/// The projected <c>/vehicles/{id}/specs</c> payload (web <c>specsEnvelope?.data</c>) — only the fields the
/// seven detail rows and the compact Model/Trim read. Every field is a <see cref="VehicleSpecsJson.AsString"/>
/// result, so it is already a non-empty string or <see langword="null"/>; this record round-trips losslessly
/// through the cache (System.Text.Json).
/// </summary>
public sealed record VehicleSpecsInfo(
    string? CarType,
    string? Model,
    string? TrimBadging,
    string? Trim,
    string? ExteriorColor,
    string? WheelType,
    string? Interior,
    string? InteriorColor,
    string? AuxBatteryType,
    string? CarVersion)
{
    /// <summary>Project a specs <c>data</c> object into the model (all fields cleaned through <c>asString</c>).</summary>
    public static VehicleSpecsInfo FromObject(JsonElement data) => new(
        CarType: VehicleSpecsJson.StringField(data, "car_type"),
        Model: VehicleSpecsJson.StringField(data, "model"),
        TrimBadging: VehicleSpecsJson.StringField(data, "trim_badging"),
        Trim: VehicleSpecsJson.StringField(data, "trim"),
        ExteriorColor: VehicleSpecsJson.StringField(data, "exterior_color"),
        WheelType: VehicleSpecsJson.StringField(data, "wheel_type"),
        Interior: VehicleSpecsJson.StringField(data, "interior"),
        InteriorColor: VehicleSpecsJson.StringField(data, "interior_color"),
        AuxBatteryType: VehicleSpecsJson.StringField(data, "aux_battery_type"),
        CarVersion: VehicleSpecsJson.StringField(data, "car_version"));

    /// <summary>
    /// Project the <c>{ data, fetched_at }</c> specs envelope into the model — the native
    /// <c>specsEnvelope?.data ?? null</c>. Returns <see langword="null"/> when the body is not an object, the
    /// <c>data</c> property is absent, or <c>data</c> is JSON <c>null</c> / not an object. A present-but-sparse
    /// <c>data</c> object yields a non-null model with em-dash readouts, exactly as the web treats a non-null
    /// <c>specs</c> whose fields are all undefined.
    /// </summary>
    public static VehicleSpecsInfo? ParseEnvelope(JsonElement envelope)
    {
        if (envelope.ValueKind != JsonValueKind.Object ||
            !envelope.TryGetProperty("data", out var data) ||
            data.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return FromObject(data);
    }
}

/// <summary>
/// The projected <c>/vehicle-config/latest</c> snapshot (web <c>configData</c>, type
/// <c>VehicleConfigSnapshot | null</c>) — only the fields the detail rows fall back to. Each field is an
/// <see cref="VehicleSpecsJson.AsString"/> result; the record round-trips losslessly through the cache.
/// </summary>
public sealed record VehicleConfigInfo(
    string? CarType,
    string? Trim,
    string? ExteriorColor,
    string? WheelType,
    string? Version)
{
    /// <summary>Project a config snapshot object into the model (all fields cleaned through <c>asString</c>).</summary>
    public static VehicleConfigInfo FromObject(JsonElement obj) => new(
        CarType: VehicleSpecsJson.StringField(obj, "car_type"),
        Trim: VehicleSpecsJson.StringField(obj, "trim"),
        ExteriorColor: VehicleSpecsJson.StringField(obj, "exterior_color"),
        WheelType: VehicleSpecsJson.StringField(obj, "wheel_type"),
        Version: VehicleSpecsJson.StringField(obj, "version"));

    /// <summary>
    /// Project the config response into the model — the native <c>configData ?? null</c>. Returns
    /// <see langword="null"/> when the body is not an object (the web's null config snapshot); a sparse object
    /// yields a non-null model with null fields.
    /// </summary>
    public static VehicleConfigInfo? ParseResponse(JsonElement response) =>
        response.ValueKind == JsonValueKind.Object ? FromObject(response) : null;
}

/// <summary>
/// One decoded factory option (web's <c>Object.keys(options)</c> entry): the raw option <see cref="Code"/>
/// (the map key, rendered verbatim as it is a Tesla option code, not a translatable string) and its
/// <see cref="Decoded"/> human label (web <c>asString(options[key]) ?? key</c>, so it is never empty —
/// it falls back to the code).
/// </summary>
public sealed record VehicleSpecOption(string Code, string Decoded)
{
    /// <summary>
    /// Project an options <c>data</c> object into the ordered option list — the native analogue of the web
    /// <c>Object.keys(options)</c> iteration. Returns <see langword="null"/> when the body is not an object,
    /// the <c>data</c> property is absent, or <c>data</c> is JSON <c>null</c> / not an object (web
    /// <c>optionsEnvelope?.data ?? null</c>, then the <c>options &amp;&amp; typeof options === 'object'</c>
    /// gate). A present-but-empty object yields a non-null empty list, exactly as the web treats an empty
    /// <c>options</c> object as truthy (so <c>hasAnyData</c> stays true) while producing no option rows.
    /// </summary>
    public static IReadOnlyList<VehicleSpecOption>? ParseEnvelope(JsonElement envelope)
    {
        if (envelope.ValueKind != JsonValueKind.Object ||
            !envelope.TryGetProperty("data", out var data) ||
            data.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var options = new List<VehicleSpecOption>();
        foreach (var property in data.EnumerateObject())
        {
            string decoded = VehicleSpecsJson.AsString(property.Value) ?? property.Name;
            options.Add(new VehicleSpecOption(property.Name, decoded));
        }

        return options;
    }
}

/// <summary>
/// The parsed three-source payload backing the widget — the native analogue of the web component's composed
/// <c>useVehicleSpecs</c> + <c>useVehicleOptions</c> + <c>useVehicleConfigLatest</c> hooks
/// (web/src/features/dashboard/widgets/VehicleSpecsWidget.tsx). Each part is <see langword="null"/> when its
/// source resolved no object; <see cref="HasAnyData"/> is the web <c>hasAnyData</c> gate. This record
/// round-trips losslessly through the cache (System.Text.Json), so the source caches it directly rather than
/// three raw wire bodies.
/// </summary>
public sealed record VehicleSpecsSnapshot(
    VehicleSpecsInfo? Specs,
    IReadOnlyList<VehicleSpecOption>? Options,
    VehicleConfigInfo? Config)
{
    /// <summary>The absent-payload fallback (nothing resolved) used for the first projection.</summary>
    public static VehicleSpecsSnapshot Empty { get; } = new(null, null, null);

    /// <summary>True when at least one of specs / options / config resolved (web <c>hasAnyData</c>).</summary>
    [JsonIgnore]
    public bool HasAnyData => Specs is not null || Options is not null || Config is not null;

    /// <summary>Project the three wire bodies (specs envelope, options envelope, config response) into a snapshot.</summary>
    public static VehicleSpecsSnapshot FromJson(JsonElement specsEnvelope, JsonElement optionsEnvelope, JsonElement configResponse) =>
        new(
            VehicleSpecsInfo.ParseEnvelope(specsEnvelope),
            VehicleSpecOption.ParseEnvelope(optionsEnvelope),
            VehicleConfigInfo.ParseResponse(configResponse));
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> logic in web/src/features/dashboard/widgets/VehicleSpecsWidget.tsx: a single column hides
/// the title + icon header, renders the centred Model / Trim compact body instead of the detail card, and
/// drops the factory-option rows (web <c>optionKeys.slice(0, isCompact ? 0 : 8)</c>).
/// </summary>
public readonly record struct VehicleSpecsSize(int Cols, int Rows)
{
    /// <summary>Maximum factory-option rows the detail card renders (web <c>slice(0, 8)</c>).</summary>
    public const int MaxOptions = 8;

    /// <summary>The registry default footprint (2×4).</summary>
    public static VehicleSpecsSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>).</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready detail row consumed by the WinUI detail card — the native analogue of the web
/// <c>DetailEntry</c> (web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx). Holds the
/// <see cref="Label"/> (a localized field name, or a verbatim option code), the <see cref="Value"/>
/// (<see langword="null"/> renders as an em-dash, mirroring the web <c>entry.value ?? '—'</c>), the
/// <see cref="Mono"/> flag (Car Version), an optional <see cref="BadgeText"/> (the localized "Option" chip
/// for factory-option rows) and a Narrator <see cref="AccessibilityName"/>. Pure data — no WinUI types — so
/// the projection is unit-tested without a UI host.
/// </summary>
public sealed record VehicleSpecDetailEntry(
    string Label,
    string? Value,
    bool Mono,
    string? BadgeText,
    string AccessibilityName);

/// <summary>
/// The fully projected, render-ready view of the configuration reference for one footprint — the native
/// analogue of the <c>entries</c> array, the <c>CompactView</c> readouts and the <c>hasAnyData</c> gate the
/// web component computes before returning JSX. Pure data so the projection is unit-tested directly.
/// </summary>
public sealed record VehicleSpecsDisplay(
    bool HasAnyData,
    bool IsCompact,
    string CompactModel,
    string CompactTrimLine,
    string CompactAccessibilityName,
    IReadOnlyList<VehicleSpecDetailEntry> Entries);

/// <summary>
/// Pure projection from a parsed <see cref="VehicleSpecsSnapshot"/> to the display model — the native port of
/// the <c>entries</c> / <c>CompactView</c> computation in
/// web/src/features/dashboard/widgets/VehicleSpecsWidget.tsx. Reproduces each <c>asString(specs?.x) ??
/// asString(config?.y)</c> fallback chain, the seven fixed rows (Model, Trim, Paint, Wheels, Interior, Aux
/// Battery, Car Version[mono]), and the factory-option rows (capped at eight, dropped entirely in compact).
/// Every label resolves through the i18n facade.
/// </summary>
public static class VehicleSpecsProjection
{
    /// <summary>The em-dash fallback the web renders for a missing value (<c>value ?? '—'</c>).</summary>
    internal const string EmDash = "\u2014";

    /// <summary>Project <paramref name="snapshot"/> for <paramref name="size"/> using the i18n facade.</summary>
    public static VehicleSpecsDisplay Project(
        VehicleSpecsSnapshot snapshot,
        VehicleSpecsSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var specs = snapshot.Specs;
        var config = snapshot.Config;

        // Web fallback chains (verbatim order from the web useMemo).
        string? model = specs?.CarType ?? specs?.Model ?? config?.CarType;
        string? trim = specs?.TrimBadging ?? specs?.Trim ?? config?.Trim;
        string? paint = specs?.ExteriorColor ?? config?.ExteriorColor;
        string? wheels = specs?.WheelType ?? config?.WheelType;
        string? interior = specs?.Interior ?? specs?.InteriorColor;
        string? auxBattery = specs?.AuxBatteryType;
        string? carVersion = config?.Version ?? specs?.CarVersion;

        var entries = new List<VehicleSpecDetailEntry>(VehicleSpecsSize.MaxOptions + 7)
        {
            Entry(localizer.GetString("widget.specs.model", "Model"), model, mono: false),
            Entry(localizer.GetString("widget.specs.trim", "Trim"), trim, mono: false),
            Entry(localizer.GetString("widget.specs.paint", "Paint Color"), paint, mono: false),
            Entry(localizer.GetString("widget.specs.wheels", "Wheels"), wheels, mono: false),
            Entry(localizer.GetString("widget.specs.interior", "Interior"), interior, mono: false),
            Entry(localizer.GetString("widget.specs.auxBattery", "Aux Battery"), auxBattery, mono: false),
            Entry(localizer.GetString("widget.specs.carVersion", "Car Version"), carVersion, mono: true),
        };

        // Factory options as badged rows — web: optionKeys.slice(0, isCompact ? 0 : 8).
        if (snapshot.Options is { Count: > 0 } options && !size.IsCompact)
        {
            string optionBadge = localizer.GetString("widget.specs.option", "Option");
            int take = Math.Min(VehicleSpecsSize.MaxOptions, options.Count);
            for (int i = 0; i < take; i++)
            {
                entries.Add(OptionEntry(options[i], optionBadge));
            }
        }

        string compactModel = model ?? EmDash;
        string trimLabel = localizer.GetString("widget.specs.trim", "Trim");
        string compactTrimLine = string.Create(CultureInfo.CurrentCulture, $"{trimLabel}: {trim ?? EmDash}");
        string compactName = string.Create(
            CultureInfo.CurrentCulture,
            $"{localizer.GetString("widget.specs.model", "Model")}: {compactModel}, {compactTrimLine}");

        return new VehicleSpecsDisplay(
            HasAnyData: snapshot.HasAnyData,
            IsCompact: size.IsCompact,
            CompactModel: compactModel,
            CompactTrimLine: compactTrimLine,
            CompactAccessibilityName: compactName,
            Entries: entries);
    }

    private static VehicleSpecDetailEntry Entry(string label, string? value, bool mono)
    {
        string display = string.IsNullOrEmpty(value) ? EmDash : value;
        string accessibilityName = string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, display);
        return new VehicleSpecDetailEntry(label, value, mono, BadgeText: null, accessibilityName);
    }

    private static VehicleSpecDetailEntry OptionEntry(VehicleSpecOption option, string badgeText)
    {
        string accessibilityName = string.Format(
            CultureInfo.CurrentCulture, "{0}: {1}, {2}", option.Code, option.Decoded, badgeText);
        return new VehicleSpecDetailEntry(option.Code, option.Decoded, Mono: false, badgeText, accessibilityName);
    }
}
