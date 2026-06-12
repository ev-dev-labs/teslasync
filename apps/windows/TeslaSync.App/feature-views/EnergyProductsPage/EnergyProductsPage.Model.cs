using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The lifecycle state both the <see cref="EnergyProductsPageViewModel"/> (the energy-sites list) and each
/// <see cref="EnergySiteCardViewModel"/> (its per-site configuration) can be in — the native union of the
/// four web data states (<c>loading</c> / <c>empty</c> / <c>error</c> / <c>success</c>) plus the
/// cached / stale / offline freshness branches the cache-then-network engine emits. The surface renders its
/// populated layout for <see cref="Loaded"/>, <see cref="Stale"/> and <see cref="Offline"/> (web truthy
/// <c>data</c>); a genuinely empty response collapses to <see cref="Empty"/> and a failed first read with no
/// cache to <see cref="Error"/>.
/// </summary>
public enum EnergyProductsState
{
    /// <summary>Initial fetch with no cached snapshot — the loading body (web <c>isLoading</c> skeletons).</summary>
    Loading,

    /// <summary>A snapshot with data — render the summary stats and the site cards / site configuration.</summary>
    Loaded,

    /// <summary>A genuinely empty response — render the empty state (web <c>sites.length === 0</c>).</summary>
    Empty,

    /// <summary>The first read failed with no cache — render the error banner (web <c>error</c>).</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One Tesla energy product discovered from <c>GET /tesla/energy-sites</c> (web <c>TeslaEnergySite</c> in
/// web/src/types/energy.ts). Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant
/// so a partial row never throws. <see cref="TotalPackEnergyWh"/> is SI watt-hours. Pure data — no WinUI types.
/// </summary>
public sealed record EnergySite(
    long Id,
    long EnergySiteId,
    string ResourceType,
    string SiteName,
    double? TotalPackEnergyWh,
    double? PercentageCharged,
    string? BatteryType,
    bool BackupCapable,
    bool StormModeEnabled,
    bool HasSolar,
    bool HasBattery,
    bool HasGrid,
    bool TouCapable,
    bool StormModeCapable,
    DateTimeOffset? FetchedAt)
{
    /// <summary>Project one <c>GET /tesla/energy-sites</c> array element into a tolerant site record.</summary>
    public static EnergySite FromJson(JsonElement element) => new(
        Id: (long)Math.Round(EnergyJson.GetDouble(element, "id") ?? 0, MidpointRounding.AwayFromZero),
        EnergySiteId: (long)Math.Round(EnergyJson.GetDouble(element, "energy_site_id") ?? 0, MidpointRounding.AwayFromZero),
        ResourceType: EnergyJson.GetString(element, "resource_type") ?? string.Empty,
        SiteName: EnergyJson.GetString(element, "site_name") ?? string.Empty,
        TotalPackEnergyWh: EnergyJson.GetDouble(element, "total_pack_energy"),
        PercentageCharged: EnergyJson.GetDouble(element, "percentage_charged"),
        BatteryType: EnergyJson.GetNonEmptyString(element, "battery_type"),
        BackupCapable: EnergyJson.GetBool(element, "backup_capable"),
        StormModeEnabled: EnergyJson.GetBool(element, "storm_mode_enabled"),
        HasSolar: EnergyJson.GetBool(element, "has_solar"),
        HasBattery: EnergyJson.GetBool(element, "has_battery"),
        HasGrid: EnergyJson.GetBool(element, "has_grid"),
        TouCapable: EnergyJson.GetBool(element, "tou_capable"),
        StormModeCapable: EnergyJson.GetBool(element, "storm_mode_capable"),
        FetchedAt: EnergyJson.GetDate(element, "fetched_at"));
}

/// <summary>
/// The discovered-products snapshot from <c>GET /tesla/energy-sites</c> (web <c>useTeslaEnergySites</c>,
/// shape <c>TeslaEnergySite[]</c> via <c>safeArray</c>). Carries the parsed sites plus the summary roll-ups
/// the four hero stat cards read. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record EnergyProductsSnapshot(IReadOnlyList<EnergySite> Sites)
{
    /// <summary>An empty snapshot — the parse fallback for an absent / non-array body.</summary>
    public static EnergyProductsSnapshot Empty { get; } = new(Array.Empty<EnergySite>());

    /// <summary>The total number of discovered energy sites (web <c>sites.length</c>).</summary>
    public int Total => Sites.Count;

    /// <summary>The number of sites with solar (web <c>sites.filter(s =&gt; s.has_solar).length</c>).</summary>
    public int WithSolar => Count(static s => s.HasSolar);

    /// <summary>The number of sites with a battery (web <c>has_battery</c> filter).</summary>
    public int WithBattery => Count(static s => s.HasBattery);

    /// <summary>The number of backup-capable sites (web <c>backup_capable</c> filter).</summary>
    public int BackupCapable => Count(static s => s.BackupCapable);

    /// <summary>True when there is at least one site (web <c>sites.length &gt; 0</c>).</summary>
    public bool HasSites => Sites.Count > 0;

    /// <summary>Project a <c>GET /tesla/energy-sites</c> JSON array into a tolerant snapshot.</summary>
    public static EnergyProductsSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        var sites = new List<EnergySite>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                sites.Add(EnergySite.FromJson(item));
            }
        }

        return sites.Count == 0 ? Empty : new EnergyProductsSnapshot(sites);
    }

    private int Count(Func<EnergySite, bool> predicate)
    {
        int n = 0;
        foreach (var site in Sites)
        {
            if (predicate(site))
            {
                n++;
            }
        }

        return n;
    }
}

/// <summary>One boolean capability flag from a site's <c>components</c> map (web component badges).</summary>
/// <param name="Key">The humanized component key (underscores replaced with spaces, e.g. "load meter").</param>
/// <param name="Active">Whether the component is present.</param>
public sealed record EnergyComponentFlag(string Key, bool Active);

/// <summary>
/// The detailed site configuration from <c>GET /tesla/energy-sites/{siteID}/site-info</c> (web
/// <c>TeslaEnergySiteInfo</c> inside the <c>TeslaEnergySiteInfoResponse</c> wrapper). The handler wraps the
/// payload as <c>{ data, fetched_at }</c>; <see cref="FromResponse"/> reads the inner <c>data</c> object and
/// the wrapper's server-side fetch timestamp. <see cref="NameplatePowerW"/> is SI watts and
/// <see cref="NameplateEnergyWh"/> SI watt-hours. Pure data — no WinUI types.
/// </summary>
public sealed record EnergySiteInfo(
    string? DefaultRealMode,
    double? BackupReservePercent,
    int? BatteryCount,
    double? NameplatePowerW,
    double? NameplateEnergyWh,
    string? Version,
    string? InstallationTimeZone,
    bool TouCapable,
    string? TariffName,
    IReadOnlyList<EnergyComponentFlag> Components,
    DateTimeOffset? FetchedAt)
{
    /// <summary>An all-null configuration — the parse fallback for an absent inner <c>data</c> object.</summary>
    public static EnergySiteInfo Empty { get; } = new(
        null, null, null, null, null, null, null, false, null, Array.Empty<EnergyComponentFlag>(), null);

    /// <summary>The inner <c>data</c> object of a site-info response, or <see cref="JsonValueKind.Undefined"/>.</summary>
    public static JsonElement DataOf(JsonElement response)
    {
        if (response.ValueKind == JsonValueKind.Object && response.TryGetProperty("data", out var data))
        {
            return data;
        }

        // Defensive: some callers/tests pass the bare data object (no wrapper).
        return response.ValueKind == JsonValueKind.Object && response.TryGetProperty("default_real_mode", out _)
            ? response
            : default;
    }

    /// <summary>True when the response carries a usable inner <c>data</c> object (web <c>info</c> truthy).</summary>
    public static bool HasData(JsonElement response)
    {
        var data = DataOf(response);
        return data.ValueKind == JsonValueKind.Object && data.EnumerateObject().MoveNext();
    }

    /// <summary>Project a <c>GET /site-info</c> wrapper (<c>{ data, fetched_at }</c>) into a tolerant record.</summary>
    public static EnergySiteInfo FromResponse(JsonElement response)
    {
        var data = DataOf(response);
        if (data.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var fetchedAt = EnergyJson.GetDate(response, "fetched_at") ?? EnergyJson.GetDate(data, "fetched_at");

        return new EnergySiteInfo(
            DefaultRealMode: EnergyJson.GetNonEmptyString(data, "default_real_mode"),
            BackupReservePercent: EnergyJson.GetDouble(data, "backup_reserve_percent"),
            BatteryCount: EnergyJson.GetInt(data, "battery_count"),
            NameplatePowerW: EnergyJson.GetDouble(data, "nameplate_power"),
            NameplateEnergyWh: EnergyJson.GetDouble(data, "nameplate_energy"),
            Version: EnergyJson.GetNonEmptyString(data, "version"),
            InstallationTimeZone: EnergyJson.GetNonEmptyString(data, "installation_time_zone"),
            TouCapable: ReadTouCapable(data),
            TariffName: ReadTariffName(data),
            Components: ReadComponents(data),
            FetchedAt: fetchedAt);
    }

    private static bool ReadTouCapable(JsonElement data) =>
        data.TryGetProperty("components", out var components) &&
        components.ValueKind == JsonValueKind.Object &&
        EnergyJson.GetBool(components, "tou_capable");

    private static IReadOnlyList<EnergyComponentFlag> ReadComponents(JsonElement data)
    {
        if (!data.TryGetProperty("components", out var components) || components.ValueKind != JsonValueKind.Object)
        {
            return Array.Empty<EnergyComponentFlag>();
        }

        var flags = new List<EnergyComponentFlag>();
        foreach (var member in components.EnumerateObject())
        {
            if (member.Value.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                flags.Add(new EnergyComponentFlag(
                    member.Name.Replace('_', ' '),
                    member.Value.ValueKind == JsonValueKind.True));
            }
        }

        return flags;
    }

    // Web parity: read the active tariff name from tariff_content_v2.name (or the nested
    // tou_settings.tariff_content_v2.name), tolerating either shape.
    private static string? ReadTariffName(JsonElement data)
    {
        if (data.TryGetProperty("tariff_content_v2", out var tariff) && tariff.ValueKind == JsonValueKind.Object)
        {
            var name = EnergyJson.GetNonEmptyString(tariff, "name");
            if (name is not null)
            {
                return name;
            }
        }

        if (data.TryGetProperty("tou_settings", out var settings) &&
            settings.ValueKind == JsonValueKind.Object &&
            settings.TryGetProperty("tariff_content_v2", out var nested) &&
            nested.ValueKind == JsonValueKind.Object)
        {
            return EnergyJson.GetNonEmptyString(nested, "name");
        }

        return null;
    }
}

/// <summary>One projected, display-ready stat card: the localized label, the formatted value, a Fluent glyph
/// and a Narrator automation name (the native counterpart of the web <c>StatCard</c>). Pure data.</summary>
public sealed record EnergyStat(string Label, string Value, string Glyph, string AutomationName);

/// <summary>One projected capability chip (web <c>CapBadge</c>): a label, its active flag and a Fluent glyph.</summary>
public sealed record EnergyCapabilityBadge(string Label, bool Active, string Glyph);

/// <summary>
/// The projected summary view of the energy-products page header — the localized title / subtitle, the
/// refresh-action label and the four hero stat cards (Energy Sites / With Solar / With Battery / Backup
/// Capable) plus the page-level empty message. Pure data.
/// </summary>
public sealed record EnergyProductsDisplay(
    string Title,
    string Subtitle,
    string RefreshLabel,
    EnergyStat TotalSites,
    EnergyStat WithSolar,
    EnergyStat WithBattery,
    EnergyStat BackupCapable,
    string EmptyMessage);

/// <summary>
/// The projected view of one energy-site card (web <c>EnergySiteCard</c>): the header (name, resource label,
/// id sub-line, battery-type chip, resource glyph), the three stat cards (Charge / Capacity / Type), the
/// capability chips, the storm-mode-active chip and the last-fetched line. Pure data.
/// </summary>
public sealed record EnergySiteCardDisplay(
    string SiteName,
    string ResourceLabel,
    string SubLabel,
    string? BatteryType,
    string ResourceGlyph,
    EnergyStat Charge,
    EnergyStat Capacity,
    EnergyStat Type,
    IReadOnlyList<EnergyCapabilityBadge> Capabilities,
    bool StormActive,
    string StormActiveLabel,
    string LastFetchedLabel);

/// <summary>The projected Time-of-Use rate-plan panel (web TOU section): its heading, the active plan name (or
/// the "no plan" fallback), and the update / edit action labels. Pure data.</summary>
public sealed record EnergyRatePlanDisplay(string SectionTitle, string PlanName, string UpdateLabel, string EditPlanLabel);

/// <summary>
/// The projected view of a site's configuration section (web <c>SiteInfoSection</c>): the heading + refresh
/// label, the operation-mode + backup-reserve pair (the gauge value is the chart), the three rated stat cards
/// (Powerwalls / Rated Power / Rated Energy — always rendered, "—" when absent), the firmware + timezone line,
/// the component chips, the rate-plan panel, the last-fetched line and the empty message. Pure data.
/// </summary>
public sealed record EnergySiteInfoDisplay(
    string Title,
    string RefreshLabel,
    string OperationModeLabel,
    string OperationModeValue,
    string BackupReserveLabel,
    double BackupReservePercent,
    string BackupReserveValue,
    bool HasBackupReserve,
    EnergyStat Powerwalls,
    EnergyStat RatedPower,
    EnergyStat RatedEnergy,
    string FirmwareLabel,
    string? FirmwareValue,
    string? TimeZone,
    IReadOnlyList<EnergyComponentFlag> Components,
    bool ShowRatePlan,
    EnergyRatePlanDisplay RatePlan,
    string LastFetchedLabel,
    string EmptyMessage);

/// <summary>
/// Shared, null-tolerant JSON readers for the energy parse adapters — the native equivalent of the web
/// page's <c>?? 0</c> / <c>?? '—'</c> guards. Kept here so every record parses without a serializer attribute
/// surface and so the tolerance is unit-tested directly.
/// </summary>
internal static class EnergyJson
{
    public static bool TryGetProperty(JsonElement obj, string name, out JsonElement value)
    {
        if (obj.ValueKind == JsonValueKind.Object)
        {
            return obj.TryGetProperty(name, out value);
        }

        value = default;
        return false;
    }

    public static double? GetDouble(JsonElement obj, string name)
    {
        if (!TryGetProperty(obj, name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static int? GetInt(JsonElement obj, string name)
    {
        var value = GetDouble(obj, name);
        return value is { } d ? (int)Math.Round(d, MidpointRounding.AwayFromZero) : null;
    }

    public static bool GetBool(JsonElement obj, string name)
    {
        if (!TryGetProperty(obj, name, out var v))
        {
            return false;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when v.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String => string.Equals(v.GetString(), "true", StringComparison.OrdinalIgnoreCase),
            _ => false,
        };
    }

    public static string? GetString(JsonElement obj, string name) =>
        TryGetProperty(obj, name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static string? GetNonEmptyString(JsonElement obj, string name)
    {
        var s = GetString(obj, name);
        return string.IsNullOrWhiteSpace(s) ? null : s;
    }

    public static DateTimeOffset? GetDate(JsonElement obj, string name)
    {
        var s = GetString(obj, name);
        return DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var d)
            ? d
            : null;
    }
}

/// <summary>
/// Pure projections from the parsed energy read-models to the render-ready display records — the native port
/// of the JSX-time computation in web/src/features/battery/pages/EnergyProductsPage.tsx. SI energy / power are
/// restated to compact display units here (and only here); every label resolves through the i18n facade with
/// the web key names. No WinUI types.
/// </summary>
public static class EnergyProductsProjection
{
    // Segoe Fluent Icons glyphs (web lucide icons mapped to the nearest Fluent code points).
    internal const string ZapGlyph = "\uE945";       // Zap / lightning (sites)
    internal const string SolarGlyph = "\uE706";     // Brightness (Sun / solar)
    internal const string BatteryGlyph = "\uE83F";   // Battery
    internal const string GridGlyph = "\uE80A";      // Grid
    internal const string ShieldGlyph = "\uE730";    // Shield (backup)
    internal const string StormGlyph = "\uE9CA";     // Weather lightning (storm watch)
    internal const string GaugeGlyph = "\uE9D9";     // Speed / gauge (charge)
    internal const string ActivityGlyph = "\uE9D2";  // Activity / pulse (type)
    internal const string SettingsGlyph = "\uE713";  // Settings (site config)
    internal const string CpuGlyph = "\uE950";       // Processor (firmware)

    private const string EmDash = "\u2014";

    /// <summary>Project the page header + four summary stat cards (web summary <c>Grid</c> of <c>StatCard</c>s).</summary>
    public static EnergyProductsDisplay Project(EnergyProductsSnapshot snapshot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        return new EnergyProductsDisplay(
            Title: localizer.GetString("energy.products.title", "Energy Products"),
            Subtitle: localizer.GetString(
                "energy.products.subtitle", "Powerwalls, Solar Panels & Wall Connectors discovered from Tesla"),
            RefreshLabel: localizer.GetString("energy.products.refresh", "Refresh from Tesla"),
            TotalSites: Stat(
                localizer.GetString("energy.products.totalSites", "Energy Sites"),
                Count(snapshot.Total),
                ZapGlyph),
            WithSolar: Stat(
                localizer.GetString("energy.products.withSolar", "With Solar"),
                Count(snapshot.WithSolar),
                SolarGlyph),
            WithBattery: Stat(
                localizer.GetString("energy.products.withBattery", "With Battery"),
                Count(snapshot.WithBattery),
                BatteryGlyph),
            BackupCapable: Stat(
                localizer.GetString("energy.products.backupCapable", "Backup Capable"),
                Count(snapshot.BackupCapable),
                ShieldGlyph),
            EmptyMessage: localizer.GetString(
                "energy.products.empty",
                "No energy products found. Click \"Refresh from Tesla\" to discover your Powerwalls and Solar installations."));
    }

    /// <summary>Project one site card (web <c>EnergySiteCard</c>): header, three stats and capability chips.</summary>
    public static EnergySiteCardDisplay ProjectCard(EnergySite site, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(site);
        ArgumentNullException.ThrowIfNull(localizer);

        string resourceLabel = ResourceLabel(site.ResourceType);
        string siteName = string.IsNullOrWhiteSpace(site.SiteName)
            ? localizer.GetString("energy.products.unnamed", "Unnamed Site")
            : site.SiteName;
        string subLabel = string.Format(
            CultureInfo.CurrentCulture, "{0} \u00B7 ID {1}", resourceLabel, site.EnergySiteId);

        var capabilities = new[]
        {
            new EnergyCapabilityBadge(localizer.GetString("energy.products.solar", "Solar"), site.HasSolar, SolarGlyph),
            new EnergyCapabilityBadge(localizer.GetString("energy.products.battery", "Battery"), site.HasBattery, BatteryGlyph),
            new EnergyCapabilityBadge(localizer.GetString("energy.products.grid", "Grid"), site.HasGrid, GridGlyph),
            new EnergyCapabilityBadge(localizer.GetString("energy.products.backup", "Backup"), site.BackupCapable, ShieldGlyph),
            new EnergyCapabilityBadge(localizer.GetString("energy.products.stormWatch", "Storm Watch"), site.StormModeCapable, StormGlyph),
        };

        return new EnergySiteCardDisplay(
            SiteName: siteName,
            ResourceLabel: resourceLabel,
            SubLabel: subLabel,
            BatteryType: site.BatteryType,
            ResourceGlyph: ResourceGlyph(site.ResourceType),
            Charge: Stat(
                localizer.GetString("energy.products.charge", "Charge"),
                site.PercentageCharged is { } pct ? Percent(pct, 1) : EmDash,
                GaugeGlyph),
            Capacity: Stat(
                localizer.GetString("energy.products.capacity", "Capacity"),
                FormatEnergy(site.TotalPackEnergyWh),
                BatteryGlyph),
            Type: Stat(
                localizer.GetString("energy.products.type", "Type"),
                resourceLabel,
                ActivityGlyph),
            Capabilities: capabilities,
            StormActive: site.StormModeEnabled,
            StormActiveLabel: localizer.GetString("energy.products.stormActive", "Storm Mode Active"),
            LastFetchedLabel: string.Format(
                CultureInfo.CurrentCulture,
                "{0}: {1}",
                localizer.GetString("energy.products.lastFetched", "Last fetched"),
                DateTimeFormatting.Format(site.FetchedAt, DateTimeVariant.Full, DateTimeOffset.Now)));
    }

    /// <summary>Project a site's configuration section (web <c>SiteInfoSection</c> populated branch).</summary>
    public static EnergySiteInfoDisplay ProjectSiteInfo(EnergySiteInfo info, bool touCapableFromSite, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(info);
        ArgumentNullException.ThrowIfNull(localizer);

        bool hasBackupReserve = info.BackupReservePercent is >= 0;
        double backupReserve = info.BackupReservePercent ?? 0;

        var ratePlan = new EnergyRatePlanDisplay(
            SectionTitle: localizer.GetString("energy.tou.sectionTitle", "Rate Plan"),
            PlanName: info.TariffName ?? localizer.GetString("energy.tou.noPlan", "No rate plan configured"),
            UpdateLabel: localizer.GetString("energy.tou.updateButton", "Update"),
            EditPlanLabel: localizer.GetString("energy.tou.editPlan", "Update rate plan"));

        return new EnergySiteInfoDisplay(
            Title: localizer.GetString("energy.siteInfo.title", "Site Configuration"),
            RefreshLabel: localizer.GetString("energy.siteInfo.refresh", "Refresh site info"),
            OperationModeLabel: localizer.GetString("energy.siteInfo.operationMode", "Operation Mode"),
            OperationModeValue: OperationModeLabel(info.DefaultRealMode),
            BackupReserveLabel: localizer.GetString("energy.siteInfo.backupReserve", "Backup Reserve"),
            BackupReservePercent: backupReserve,
            BackupReserveValue: hasBackupReserve ? Percent(backupReserve, 0) : EmDash,
            HasBackupReserve: hasBackupReserve,
            Powerwalls: Stat(
                localizer.GetString("energy.siteInfo.batteryCount", "Powerwalls"),
                info.BatteryCount is { } c ? Count(c) : EmDash,
                BatteryGlyph),
            RatedPower: Stat(
                localizer.GetString("energy.siteInfo.ratedPower", "Rated Power"),
                FormatPower(info.NameplatePowerW),
                ZapGlyph),
            RatedEnergy: Stat(
                localizer.GetString("energy.siteInfo.ratedEnergy", "Rated Energy"),
                FormatEnergy(info.NameplateEnergyWh),
                GaugeGlyph),
            FirmwareLabel: localizer.GetString("energy.siteInfo.firmware", "Firmware"),
            FirmwareValue: info.Version,
            TimeZone: info.InstallationTimeZone,
            Components: info.Components,
            ShowRatePlan: touCapableFromSite || info.TouCapable,
            RatePlan: ratePlan,
            LastFetchedLabel: string.Format(
                CultureInfo.CurrentCulture,
                "{0}: {1}",
                localizer.GetString("energy.siteInfo.lastFetched", "Site info fetched"),
                DateTimeFormatting.Format(info.FetchedAt, DateTimeVariant.Full, DateTimeOffset.Now)),
            EmptyMessage: localizer.GetString(
                "energy.siteInfo.empty",
                "No site configuration loaded yet. Click refresh to fetch from Tesla."));
    }

    /// <summary>Resolve the resource-type display label (web <c>resourceLabel</c>): Powerwall / Solar / raw.</summary>
    public static string ResourceLabel(string? resourceType) => resourceType switch
    {
        "battery" => "Powerwall",
        "solar" => "Solar",
        null or "" => EmDash,
        _ => resourceType,
    };

    /// <summary>Resolve the resource glyph (web <c>resourceIcon</c>): Battery / Sun / Zap.</summary>
    public static string ResourceGlyph(string? resourceType) => resourceType switch
    {
        "battery" => BatteryGlyph,
        "solar" => SolarGlyph,
        _ => ZapGlyph,
    };

    /// <summary>Resolve the operation-mode display label (web <c>operationModeLabel</c>).</summary>
    public static string OperationModeLabel(string? mode) => mode switch
    {
        "self_consumption" => "Self-Powered",
        "autonomous" => "Time-Based Control",
        "backup" => "Backup Only",
        null or "" => EmDash,
        _ => mode,
    };

    /// <summary>Format SI watt-hours as compact energy (web <c>fmtEnergy</c>): kWh ≥ 1000 Wh, else Wh.</summary>
    public static string FormatEnergy(double? wh)
    {
        if (wh is not { } value)
        {
            return EmDash;
        }

        return value >= 1000
            ? $"{ScalarFormatters.FormatNumber(value / 1000, 1)} kWh"
            : $"{ScalarFormatters.FormatNumber(value, 0)} Wh";
    }

    /// <summary>Format SI watts as compact power (web <c>fmtPower</c>): kW ≥ 1000 W, else W.</summary>
    public static string FormatPower(double? w)
    {
        if (w is not { } value)
        {
            return EmDash;
        }

        return value >= 1000
            ? $"{ScalarFormatters.FormatNumber(value / 1000, 1)} kW"
            : $"{ScalarFormatters.FormatNumber(value, 0)} W";
    }

    private static string Count(int value) => ScalarFormatters.FormatNumber(value, 0);

    private static string Percent(double value, int decimals) => ScalarFormatters.FormatPercentage(value, decimals);

    private static EnergyStat Stat(string label, string value, string glyph) =>
        new(label, value, glyph, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;EnergyProductsSnapshot&gt;</c>, preserving every freshness flag so the view-model
/// renders the full state matrix. An empty array collapses to the empty state (web <c>sites.length === 0</c>).
/// Pure.
/// </summary>
public static class EnergyProductsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<EnergyProductsSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        EnergyProductsSnapshot Parse() =>
            raw.HasValue ? EnergyProductsSnapshot.FromJson(raw.Value) : EnergyProductsSnapshot.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<EnergyProductsSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<EnergyProductsSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<EnergyProductsSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => MapLoaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<EnergyProductsSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<EnergyProductsSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<EnergyProductsSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<EnergyProductsSnapshot> MapLoaded(EnergyProductsSnapshot snapshot, DateTimeOffset at) =>
        snapshot.HasSites
            ? RepositoryResult<EnergyProductsSnapshot>.Loaded(snapshot, at)
            : RepositoryResult<EnergyProductsSnapshot>.Empty(at);
}

/// <summary>
/// Maps the engine's raw site-info emissions onto parsed <c>RepositoryResult&lt;EnergySiteInfo&gt;</c>,
/// collapsing a wrapper with a null inner <c>data</c> to the empty state (web <c>info</c> null). Pure.
/// </summary>
public static class EnergySiteInfoResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s wrapper (when present) while preserving its status.</summary>
    public static RepositoryResult<EnergySiteInfo> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        bool HasData() => raw.HasValue && EnergySiteInfo.HasData(raw.Value);
        EnergySiteInfo Parse() => raw.HasValue ? EnergySiteInfo.FromResponse(raw.Value) : EnergySiteInfo.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<EnergySiteInfo>.Loading(),
            LoadStatus.Cached => HasData()
                ? RepositoryResult<EnergySiteInfo>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<EnergySiteInfo>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => HasData()
                ? RepositoryResult<EnergySiteInfo>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<EnergySiteInfo>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => HasData()
                ? RepositoryResult<EnergySiteInfo>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<EnergySiteInfo>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<EnergySiteInfo>.Empty(raw.FetchedAt),
            LoadStatus.Offline => HasData()
                ? RepositoryResult<EnergySiteInfo>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<EnergySiteInfo>.Empty(raw.FetchedAt),
            _ => RepositoryResult<EnergySiteInfo>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// The data port the <see cref="EnergyProductsPageViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the web <c>useTeslaEnergySites</c> + <c>useRefreshTeslaEnergySites</c> hooks. The view never
/// performs HTTP; the repository-backed <see cref="EnergyProductsSource"/> (or a test fake) drives this.
/// </summary>
public interface IEnergyProductsSource
{
    /// <summary>Stream the cache-then-network energy-sites snapshots, newest cache first (the GET hook).</summary>
    IAsyncEnumerable<RepositoryResult<EnergyProductsSnapshot>> StreamAsync(CancellationToken cancellationToken = default);

    /// <summary>POST <c>/tesla/energy-sites/refresh</c> then yield the fresh snapshot (the refresh mutation).</summary>
    IAsyncEnumerable<RepositoryResult<EnergyProductsSnapshot>> RefreshAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The data port each <see cref="EnergySiteCardViewModel"/> reads its configuration through — the native
/// analogue of the web <c>useTeslaEnergySiteInfo</c> + <c>useRefreshTeslaEnergySiteInfo</c> hooks, parameterized
/// by the site id so one source serves every card.
/// </summary>
public interface IEnergySiteInfoSource
{
    /// <summary>Stream the cache-then-network site-info for <paramref name="siteId"/> (the GET hook).</summary>
    IAsyncEnumerable<RepositoryResult<EnergySiteInfo>> StreamAsync(long siteId, CancellationToken cancellationToken = default);

    /// <summary>POST the site-info refresh for <paramref name="siteId"/> then yield it (the refresh mutation).</summary>
    IAsyncEnumerable<RepositoryResult<EnergySiteInfo>> RefreshAsync(long siteId, CancellationToken cancellationToken = default);
}

/// <summary>The default <see cref="IEnergyProductsSource"/> — resolves every read to the empty data state. The
/// parameterless-constructed page's feed until the navigation host wires <see cref="EnergyProductsSource"/>.</summary>
public sealed class EmptyEnergyProductsSource : IEnergyProductsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyEnergyProductsSource Instance { get; } = new();

    private EmptyEnergyProductsSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<EnergyProductsSnapshot>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<EnergyProductsSnapshot>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<EnergyProductsSnapshot>> RefreshAsync(CancellationToken cancellationToken = default) =>
        StreamAsync(cancellationToken);
}

/// <summary>The default <see cref="IEnergySiteInfoSource"/> — resolves every read to the empty data state.</summary>
public sealed class EmptyEnergySiteInfoSource : IEnergySiteInfoSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyEnergySiteInfoSource Instance { get; } = new();

    private EmptyEnergySiteInfoSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<EnergySiteInfo>> StreamAsync(
        long siteId,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<EnergySiteInfo>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<EnergySiteInfo>> RefreshAsync(long siteId, CancellationToken cancellationToken = default) =>
        StreamAsync(siteId, cancellationToken);
}

/// <summary>
/// Canonical metadata for the Energy Products page — the native mirror of the web route
/// <c>/energy-products</c> (nav name <c>EnergyProducts</c>). The shell page factory registers the surface
/// under <see cref="RouteName"/>; the title / subtitle resolve through the i18n facade with the web key names.
/// </summary>
public static class EnergyProductsRegistration
{
    /// <summary>The navigation route name the shell page factory registers this surface under.</summary>
    public const string RouteName = "EnergyProducts";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "EnergyProductsPage";

    /// <summary>The localized page title (web <c>energy.products.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("energy.products.title", "Energy Products");
    }

    /// <summary>The localized page subtitle (web <c>energy.products.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "energy.products.subtitle", "Powerwalls, Solar Panels & Wall Connectors discovered from Tesla");
    }
}

/// <summary>
/// PII-safe diagnostics for the Energy Products page (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a site id, energy figure or address —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class EnergyProductsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public EnergyProductsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EnergyProductsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EnergyProductsRegistration.Slug}");
    }
}
