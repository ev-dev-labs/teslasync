using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state an <see cref="EnergySiteInfoViewModel"/> can be in — the native union of the
/// loading / loaded / no-site / no-data / error / stale / offline branches the web
/// <c>EnergySiteInfoWidget</c> renders through <c>WidgetShell</c> + <c>WidgetDetailCard</c>
/// (web/src/features/dashboard/widgets/EnergySiteInfoWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. The web has two distinct empty surfaces — <see cref="NoSite"/>
/// (the <c>!hasSites</c> gate, "No Tesla Energy site linked") and <see cref="NoData"/>
/// (a linked site whose <c>infoResponse?.data</c> is null, "No site info available") — so both are
/// modelled here rather than collapsed into one generic empty.
/// </summary>
public enum EnergySiteInfoState
{
    /// <summary>Initial fetch with no cached payload — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh data (or non-stale cache) for a linked site with resolved site info.</summary>
    Loaded,

    /// <summary>No Tesla Energy site is linked — render the "no site" empty state (web <c>!hasSites</c>).</summary>
    NoSite,

    /// <summary>A site is linked but its site-info payload is absent — render the "no data" empty state.</summary>
    NoData,

    /// <summary>The request failed and no cached value exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached value older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached value remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Tolerant JSON readers shared by the site-info parsers. Each returns <see langword="null"/> for an
/// absent / wrong-kind property so a partial wire body never throws — mirroring the web hook's defensive
/// <c>?? null</c> / <c>?? 0</c> reads. Numeric strings are accepted because the Go API occasionally
/// serializes ids as strings.
/// </summary>
internal static class EnergySiteInfoJson
{
    internal static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    internal static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    internal static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }
}

/// <summary>
/// The projected Tesla Energy site-info payload the widget renders — the native analogue of the web
/// <c>TeslaEnergySiteInfo</c> object reached via <c>infoResponse?.data</c> (web/src/types/energy.ts). Only
/// the fields the four detail rows consume are kept: the SI solar <see cref="NameplatePowerWatts"/> and
/// battery <see cref="NameplateEnergyWattHours"/> (both divided by 1000 for the kW / kWh readouts as the web
/// does), the <see cref="BatteryCount"/>, the gateway <see cref="Version"/> and the
/// <see cref="InstallationTimeZone"/>. Parsing is null-tolerant so a partial row never throws, and the record
/// round-trips losslessly through the cache (System.Text.Json).
/// </summary>
public sealed record EnergySiteInfoData(
    double? NameplatePowerWatts,
    double? NameplateEnergyWattHours,
    long? BatteryCount,
    string? Version,
    string? InstallationTimeZone)
{
    /// <summary>Project a site-info <c>data</c> object (web <c>TeslaEnergySiteInfo</c>) into the model.</summary>
    public static EnergySiteInfoData FromInfoObject(JsonElement info) => new(
        NameplatePowerWatts: EnergySiteInfoJson.GetDouble(info, "nameplate_power"),
        NameplateEnergyWattHours: EnergySiteInfoJson.GetDouble(info, "nameplate_energy"),
        BatteryCount: EnergySiteInfoJson.GetLong(info, "battery_count"),
        Version: EnergySiteInfoJson.GetString(info, "version"),
        InstallationTimeZone: EnergySiteInfoJson.GetString(info, "installation_time_zone"));

    /// <summary>
    /// Project the <c>{ data, fetched_at }</c> site-info envelope into the model — the native
    /// <c>infoResponse?.data ?? null</c>. Returns <see langword="null"/> when the body is not an object, the
    /// <c>data</c> property is absent, or <c>data</c> is JSON <c>null</c> / not an object (the web's "no site
    /// info available" branch). A present-but-sparse <c>data</c> object yields a non-null model with em-dash
    /// readouts, exactly as the web renders an info object whose fields are all undefined.
    /// </summary>
    public static EnergySiteInfoData? ParseResponse(JsonElement response)
    {
        if (response.ValueKind != JsonValueKind.Object ||
            !response.TryGetProperty("data", out var data) ||
            data.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return FromInfoObject(data);
    }
}

/// <summary>
/// The parsed two-source payload backing the widget: whether a Tesla Energy site is linked
/// (<see cref="HasSites"/> + its <see cref="SiteId"/>) and that site's resolved <see cref="Info"/> (or
/// <see langword="null"/> when the site-info body has no <c>data</c>). The web composes
/// <c>useTeslaEnergySites</c> (for the first site id) with <c>useTeslaEnergySiteInfo</c>; this snapshot is
/// the native analogue of both resolved. <see cref="HasData"/> distinguishes a fetched payload (even one
/// with no site / no info) from the absent-body fallback used for the first projection. This type
/// round-trips losslessly through the cache (System.Text.Json over its own serialization), so the source
/// caches it directly rather than the raw wire JSON.
/// </summary>
public sealed record EnergySiteInfoSnapshot(
    bool HasSites,
    long? SiteId,
    EnergySiteInfoData? Info)
{
    /// <summary>The absent-body fallback (no payload yet) — flagged <see cref="HasData"/> = false.</summary>
    public static EnergySiteInfoSnapshot Empty { get; } =
        new(false, null, null) { HasData = false };

    /// <summary>A fetched payload that resolved no linked Tesla Energy site (web <c>hasSites === false</c>).</summary>
    public static EnergySiteInfoSnapshot NoSites { get; } =
        new(false, null, null);

    /// <summary>True when a payload has been fetched (web <c>data</c> truthiness). False only for <see cref="Empty"/>.</summary>
    public bool HasData { get; init; } = true;

    /// <summary>True when a linked site resolved a non-null site-info object (web <c>info != null</c>).</summary>
    [JsonIgnore]
    public bool HasInfo => Info is not null;

    /// <summary>
    /// The first site's <c>energy_site_id</c> from the energy-sites array (web
    /// <c>(sites ?? [])[0]?.energy_site_id</c>), or <see langword="null"/> when the list is empty / the
    /// element is not an object / the id is absent.
    /// </summary>
    public static long? ParseFirstSiteId(JsonElement sites)
    {
        if (sites.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var site in sites.EnumerateArray())
        {
            if (site.ValueKind == JsonValueKind.Object)
            {
                return EnergySiteInfoJson.GetLong(site, "energy_site_id");
            }
        }

        return null;
    }

    /// <summary>A linked-site snapshot from the resolved <paramref name="siteId"/> and its site-info envelope.</summary>
    public static EnergySiteInfoSnapshot FromSiteAndInfo(long siteId, JsonElement infoResponse) =>
        new(true, siteId, EnergySiteInfoData.ParseResponse(infoResponse));

    /// <summary>
    /// Project both wire bodies into a snapshot: the energy-sites array (for the first site id) and the
    /// site-info envelope. When no site resolves, the info body is ignored and <see cref="NoSites"/> is
    /// returned — exactly as the web short-circuits on a missing <c>siteId</c> (<c>enabled: !!siteId</c>).
    /// </summary>
    public static EnergySiteInfoSnapshot FromJson(JsonElement sites, JsonElement infoResponse) =>
        ParseFirstSiteId(sites) is { } siteId ? FromSiteAndInfo(siteId, infoResponse) : NoSites;
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> logic in web/src/features/dashboard/widgets/EnergySiteInfoWidget.tsx: a single column
/// hides the title + icon header and the <c>WidgetDetailCard</c> shows at most the first four entries
/// (<c>compact ? entries.slice(0, 4) : entries</c>). The surface defines exactly four entries, so the cap is
/// a no-op on content and the compact flag only drives the header chrome — but the cap is honoured so the
/// projection matches the web byte-for-byte.
/// </summary>
public readonly record struct EnergySiteInfoSize(int Cols, int Rows)
{
    /// <summary>Maximum detail rows the <c>WidgetDetailCard</c> renders (web <c>slice(0, 4)</c>).</summary>
    public const int MaxEntries = 4;

    /// <summary>The registry default footprint (2×4).</summary>
    public static EnergySiteInfoSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>).</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready detail row consumed by the WinUI detail card — the native analogue of the
/// web <c>DetailEntry</c> (web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx). Holds the
/// localized <see cref="Label"/>, the formatted <see cref="Value"/> (<see langword="null"/> renders as an
/// em-dash, mirroring the web <c>entry.value ?? '—'</c>), the <see cref="Mono"/> flag (firmware) and a
/// Narrator <see cref="AccessibilityName"/>. Pure data — no WinUI types — so the projection is unit-tested
/// without a UI host.
/// </summary>
public sealed record EnergySiteDetailEntry(
    string Label,
    string? Value,
    bool Mono,
    string AccessibilityName);

/// <summary>
/// The fully projected, render-ready view of the site info for one footprint — the native analogue of the
/// <c>entries</c> array and the <c>hasSites</c> / <c>info</c> gates the web component computes before
/// returning JSX. Pure data so the projection is unit-tested directly.
/// </summary>
public sealed record EnergySiteInfoDisplay(
    bool HasData,
    bool HasSites,
    bool HasInfo,
    bool IsCompact,
    IReadOnlyList<EnergySiteDetailEntry> Entries);

/// <summary>
/// Pure projection from a parsed <see cref="EnergySiteInfoSnapshot"/> to the display model — the native port
/// of the <c>solarKw</c> / <c>batteryKwh</c> / <c>entries</c> computation in
/// web/src/features/dashboard/widgets/EnergySiteInfoWidget.tsx. SI watts/watt-hours are divided by 1000 for
/// the kW / kWh readouts and formatted through the shared <see cref="ScalarFormatters"/> (a 1:1 port of the
/// web <c>fmtNumber</c> / <c>fmtInt</c>); every label resolves through the i18n facade.
/// </summary>
public static class EnergySiteInfoProjection
{
    /// <summary>The em-dash fallback the web renders for a missing value (<c>value ?? '—'</c>).</summary>
    internal const string EmDash = "\u2014";

    private const double WattsPerKilowatt = 1000.0;
    private const double WattHoursPerKilowattHour = 1000.0;
    private const string MultiplicationSign = "\u00d7";
    private const int KilowattDecimals = 1;
    private const int CountDecimals = 0;

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the i18n facade.</summary>
    public static EnergySiteInfoDisplay Project(
        EnergySiteInfoSnapshot data,
        EnergySiteInfoSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<EnergySiteDetailEntry> entries = data.HasInfo
            ? BuildEntries(data.Info!, localizer)
            : Array.Empty<EnergySiteDetailEntry>();

        return new EnergySiteInfoDisplay(
            HasData: data.HasData,
            HasSites: data.HasSites,
            HasInfo: data.HasInfo,
            IsCompact: size.IsCompact,
            Entries: entries);
    }

    /// <summary>
    /// Format the solar nameplate readout: <c>"{nameplate_power / 1000} kW"</c> at one decimal, or an em-dash
    /// when the SI power is absent (web <c>solarKw != null ? `${solarKw} kW` : '—'</c>).
    /// </summary>
    public static string FormatSolar(double? nameplatePowerWatts) =>
        nameplatePowerWatts is { } watts
            ? string.Create(
                CultureInfo.InvariantCulture,
                $"{ScalarFormatters.FormatNumber(watts / WattsPerKilowatt, KilowattDecimals)} kW")
            : EmDash;

    /// <summary>
    /// Format the Powerwall readout: <c>"{battery_count} × {nameplate_energy / 1000} kWh"</c> when at least
    /// one Powerwall is present, with an em-dash for an absent energy rating, otherwise an em-dash for the
    /// whole value (web <c>batteryCount &gt; 0 ? `${fmtInt(batteryCount)} × ${batteryKwh ?? '—'} kWh` : '—'</c>).
    /// </summary>
    public static string FormatPowerwalls(long? batteryCount, double? nameplateEnergyWattHours)
    {
        long count = batteryCount ?? 0;
        if (count <= 0)
        {
            return EmDash;
        }

        string kwh = nameplateEnergyWattHours is { } wattHours
            ? ScalarFormatters.FormatNumber(wattHours / WattHoursPerKilowattHour, KilowattDecimals)
            : EmDash;

        return string.Create(
            CultureInfo.InvariantCulture,
            $"{ScalarFormatters.FormatNumber(count, CountDecimals)} {MultiplicationSign} {kwh} kWh");
    }

    private static List<EnergySiteDetailEntry> BuildEntries(EnergySiteInfoData info, ILocalizer localizer)
    {
        var entries = new List<EnergySiteDetailEntry>(EnergySiteInfoSize.MaxEntries)
        {
            Entry(
                localizer.GetString("widget.energySiteInfo.solarSize", "Solar System"),
                FormatSolar(info.NameplatePowerWatts),
                mono: false),
            Entry(
                localizer.GetString("widget.energySiteInfo.powerwall", "Powerwalls"),
                FormatPowerwalls(info.BatteryCount, info.NameplateEnergyWattHours),
                mono: false),
            Entry(
                localizer.GetString("widget.energySiteInfo.firmware", "Gateway Firmware"),
                info.Version,
                mono: true),
            Entry(
                localizer.GetString("widget.energySiteInfo.timezone", "Installation Timezone"),
                info.InstallationTimeZone,
                mono: false),
        };

        // Web parity: the WidgetDetailCard slices to the first four entries in compact; the surface defines
        // exactly four, so the list is already at the cap and the slice is a content no-op.
        return entries.Count > EnergySiteInfoSize.MaxEntries
            ? entries.GetRange(0, EnergySiteInfoSize.MaxEntries)
            : entries;
    }

    private static EnergySiteDetailEntry Entry(string label, string? value, bool mono)
    {
        string display = string.IsNullOrEmpty(value) ? EmDash : value;
        string accessibilityName = string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, display);
        return new EnergySiteDetailEntry(label, value, mono, accessibilityName);
    }
}
