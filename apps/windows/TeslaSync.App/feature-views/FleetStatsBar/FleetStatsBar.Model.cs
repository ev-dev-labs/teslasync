using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="FleetStatsBarViewModel"/> can be in — the native
/// superset of the branches the web Fleet-stats bar renders
/// (web/src/features/dashboard/components/FleetStatsBar.tsx). The web component is a pure child of the
/// dashboard <c>FleetStatsWidget</c> (it takes its figures as props); the native surface binds its own
/// cache-then-network aggregate read (fleet analytics + vehicles + recent drives + recent charges + unread
/// alerts), so it owns the full loading / loaded / empty / error / stale / offline matrix the P2 state
/// contract requires. Every value maps onto a visible surface (never a blank panel): <see cref="Loaded"/>,
/// <see cref="Stale"/>, <see cref="Offline"/> and <see cref="Empty"/> all render the five stat panels (the web
/// grid is always visible, the panels falling back to zeroed values, the web <c>?? 0</c>), while
/// <see cref="Loading"/> shows the per-panel skeleton chrome and <see cref="Error"/> the retry affordance.
/// </summary>
public enum FleetStatsBarState
{
    /// <summary>Initial fetch with no cached snapshot — render the per-panel skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with at least one vehicle / non-zero figure.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no fleet data — the panels render zeroed (web parity).</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The aggregate fleet figures the web Fleet-stats bar shows — the native mirror of the props the dashboard
/// <c>FleetStatsWidget</c> hands <c>&lt;FleetStatsBar /&gt;</c>
/// (web/src/features/dashboard/widgets/FleetStatsWidget.tsx). Each field reproduces a web prop:
/// <list type="bullet">
/// <item><see cref="VehicleCount"/> / <see cref="OnlineCount"/> — <c>vehicles.length</c> and the count whose
/// <c>state === 'online'</c> (web <c>useVehicles</c>).</item>
/// <item><see cref="TotalDistanceKm"/> / <see cref="TotalEnergyKwh"/> / <see cref="AvgEfficiencyWhKm"/> — the
/// <c>/analytics/fleet</c> rollup the web reads with <c>useFleetAnalytics(30)</c> (kilometres, kWh and Wh/km
/// respectively — the API's own field units, confirmed in internal/api/analytics/queries.go).</item>
/// <item><see cref="RecentDriveDistancesM"/> / <see cref="RecentChargeEnergiesWh"/> — the most-recent drive
/// distances (metres) and charge energies (Wh) the web plots in the two mini charts, already reversed so the
/// sparkline reads oldest → newest (web <c>recentDrives.map(d =&gt; d.distance_m).reverse()</c>).</item>
/// <item><see cref="UnreadAlerts"/> — the unread-notification count. The web widget hard-codes this prop to
/// <c>0</c>; the native surface reads the real <c>/notifications/unread-count</c> so the Alerts panel is a
/// working production surface rather than a stubbed zero.</item>
/// </list>
/// WinUI-free so the aggregate parse is unit-tested without a UI host. Parsing is null-tolerant (the web
/// <c>?? 0</c>) so a partial body never throws.
/// </summary>
public sealed record FleetStatsBarData(
    int VehicleCount,
    int OnlineCount,
    int UnreadAlerts,
    double TotalDistanceKm,
    double TotalEnergyKwh,
    double AvgEfficiencyWhKm,
    IReadOnlyList<double> RecentDriveDistancesM,
    IReadOnlyList<double> RecentChargeEnergiesWh)
{
    /// <summary>The no-data snapshot — the parse fallback for absent bodies and the loading fallback.</summary>
    public static FleetStatsBarData Empty { get; } = new(
        0, 0, 0, 0, 0, 0, Array.Empty<double>(), Array.Empty<double>());

    /// <summary>
    /// True when any real fleet data backed the figures (a vehicle, a non-zero rollup, an unread alert or a
    /// recent drive/charge). Drives the Loaded-vs-Empty classification; the five panels render either way.
    /// </summary>
    [JsonIgnore]
    public bool HasData =>
        VehicleCount > 0
        || OnlineCount > 0
        || UnreadAlerts > 0
        || TotalDistanceKm > 0
        || TotalEnergyKwh > 0
        || AvgEfficiencyWhKm > 0
        || RecentDriveDistancesM.Count > 0
        || RecentChargeEnergiesWh.Count > 0;

    /// <summary>
    /// Assemble the snapshot from the five raw endpoint bodies the web parent aggregates — the
    /// <c>/analytics/fleet</c> object, the <c>/vehicles</c> array, the recent <c>/drives</c> and
    /// <c>/charging</c> arrays and the <c>/notifications/unread-count</c> object. Every read is null-tolerant
    /// so a missing/partial body degrades to zero rather than throwing (web <c>?? 0</c>).
    /// </summary>
    /// <param name="recentLimit">
    /// How many of the most-recent drive/charge rows feed each sparkline. The generated contract client
    /// rejects a <c>limit</c> query parameter the OpenAPI descriptor does not declare (the drives and
    /// charging-sessions endpoints declare only <c>vehicle_id</c>), so the native source cannot replicate the
    /// web query's <c>limit=5</c> server-side; instead the rows arrive newest-first (both repos
    /// <c>ORDER BY started_at DESC</c>) and the parse keeps the newest <paramref name="recentLimit"/> — the
    /// same window the web bar plots.
    /// </param>
    public static FleetStatsBarData FromParts(
        JsonElement analytics,
        JsonElement vehicles,
        JsonElement drives,
        JsonElement charges,
        JsonElement unread,
        int recentLimit = FleetStatsBarRegistration.RecentLimit)
    {
        (int count, int online) = CountVehicles(vehicles);
        return new FleetStatsBarData(
            VehicleCount: count,
            OnlineCount: online,
            UnreadAlerts: ReadCount(unread),
            TotalDistanceKm: GetDouble(analytics, "total_distance_km") ?? 0,
            TotalEnergyKwh: GetDouble(analytics, "total_energy_kwh") ?? 0,
            AvgEfficiencyWhKm: GetDouble(analytics, "avg_efficiency_wh_km") ?? 0,
            RecentDriveDistancesM: ReadReversedSeries(drives, "distance_m", recentLimit),
            RecentChargeEnergiesWh: ReadReversedSeries(charges, "total_energy_added_wh", recentLimit));
    }

    // web: vehicleCount = vehicles.length, onlineCount = vehicles.filter(v => v.state === 'online').length.
    private static (int Count, int Online) CountVehicles(JsonElement vehicles)
    {
        if (vehicles.ValueKind != JsonValueKind.Array)
        {
            return (0, 0);
        }

        int count = 0;
        int online = 0;
        foreach (var v in vehicles.EnumerateArray())
        {
            if (v.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            count++;
            if (string.Equals(GetString(v, "state"), "online", StringComparison.OrdinalIgnoreCase))
            {
                online++;
            }
        }

        return (count, online);
    }

    // web mini chart: arr.map(x => x.field).reverse() over the limit=5 query result — the rows arrive
    // newest-first (ORDER BY started_at DESC), so keeping the first <paramref name="limit"/> and reversing
    // yields the newest window read oldest → newest left-to-right. Null/non-numeric rows are skipped.
    private static IReadOnlyList<double> ReadReversedSeries(JsonElement array, string field, int limit)
    {
        if (array.ValueKind != JsonValueKind.Array || limit <= 0)
        {
            return Array.Empty<double>();
        }

        var values = new List<double>(Math.Min(limit, array.GetArrayLength()));
        foreach (var item in array.EnumerateArray())
        {
            if (values.Count >= limit)
            {
                break;
            }

            if (item.ValueKind == JsonValueKind.Object && GetDouble(item, field) is { } d)
            {
                values.Add(d);
            }
        }

        values.Reverse();
        return values;
    }

    // /notifications/unread-count returns { "count": n }.
    private static int ReadCount(JsonElement unread)
    {
        double? n = GetDouble(unread, "count");
        return n is { } v && v > 0 ? (int)Math.Round(v, MidpointRounding.AwayFromZero) : 0;
    }

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
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

    private static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var v)
        && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;
}

/// <summary>
/// One projected, render-ready stat panel — the native analogue of one of the web Fleet-stats bar's five
/// <see cref="TeslaSync.App.Components.UI.TsGlassPanel"/> cells (a label, a count-up numeric value with an
/// optional unit suffix, and either a sparkline or a small secondary caption). Pure data so every value is
/// asserted headlessly.
/// </summary>
/// <param name="Key">Stable panel id (e.g. <c>fleet-size</c>) used by the view and tests.</param>
/// <param name="Label">The localized panel label (web <c>metric-label</c>).</param>
/// <param name="Value">The numeric value the count-up animates to (already in display units).</param>
/// <param name="Precision">Fraction digits for the value (web <c>AnimatedNumber decimals</c>).</param>
/// <param name="Suffix">The unit suffix appended after the value (e.g. <c>" km"</c>), or null.</param>
/// <param name="FormattedValue">The value pre-formatted at <see cref="Precision"/> (for a11y + tests).</param>
/// <param name="SubLabel">A small secondary caption (e.g. <c>"3 online"</c>), or null when a chart is shown.</param>
/// <param name="Chart">The sparkline series for the distance/energy panels, or null for caption panels.</param>
/// <param name="AutomationName">The composed Narrator name for the whole panel.</param>
public sealed record FleetStatPanel(
    string Key,
    string Label,
    double Value,
    int Precision,
    string? Suffix,
    string FormattedValue,
    string? SubLabel,
    ChartSeries? Chart,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Fleet-stats bar — the five stat panels the web component
/// draws plus the localized surface label. The grid is always populated (web parity: the panels render zeroed
/// when there is no data), so <see cref="Panels"/> always has five entries; <see cref="HasData"/> only
/// reflects whether real fleet data backed the figures. Pure data.
/// </summary>
public sealed record FleetStatsBarDisplay(
    IReadOnlyList<FleetStatPanel> Panels,
    bool HasData,
    string AutomationName)
{
    /// <summary>An all-zero display (the five panels in their zeroed branch) for the loading / empty fallback.</summary>
    public static FleetStatsBarDisplay Empty(UnitPref units, ILocalizer localizer) =>
        FleetStatsBarProjection.Project(FleetStatsBarData.Empty, units, localizer);
}

/// <summary>
/// Pure projection from a raw <see cref="FleetStatsBarData"/> to its <see cref="FleetStatsBarDisplay"/> — the
/// native port of the render logic in web/src/features/dashboard/components/FleetStatsBar.tsx. The five panels
/// reproduce the web call sites one-for-one: the fleet size (with an "{n} online" caption), the 30-day
/// distance (with a sparkline of recent drive distances), the 30-day energy (with a sparkline of recent
/// charge energies), the fleet-average efficiency, and the unread-alert count. Distance and efficiency are
/// converted to the user's display unit at this boundary (the SI/display-boundary contract); energy is shown
/// in kWh exactly as the web does. Every translatable label resolves through the i18n facade using the same
/// keys the web source passes to <c>t()</c>. WinUI-free — unit-tested without a UI host.
/// </summary>
public static class FleetStatsBarProjection
{
    /// <summary>1 mile = 1.609344 km exactly — efficiency Wh/km → Wh/mi (web <c>whPerKm * 1.609344</c>).</summary>
    public const double KmPerMile = 1.609344;

    /// <summary>1 km = 1000 m — used to lift the API's <c>total_distance_km</c> into SI metres for conversion.</summary>
    private const double MetersPerKm = 1000.0;

    // web AnimatedNumber decimals per panel (FleetStatsBar.tsx): size/distance/efficiency/alerts default to 0,
    // energy is decimals={1}.
    private const int CountDecimals = 0;
    private const int DistanceDecimals = 0;
    private const int EnergyDecimals = 1;
    private const int EfficiencyDecimals = 0;

    private const int DistanceChartColorIndex = 0;
    private const int EnergyChartColorIndex = 0;

    // i18n keys (resolve against the P1/S10 catalog; the fallbacks mirror the web English literals).
    private const string SizeKey = "fleet.size";
    private const string SizeFallback = "Fleet Size";
    private const string OnlineKey = "fleet.online";
    private const string OnlineFallback = "online";
    private const string DistanceKey = "fleet.distance";
    private const string DistanceFallback = "Distance (30d)";
    private const string EnergyKey = "fleet.energy";
    private const string EnergyFallback = "Energy (30d)";
    private const string EfficiencyKey = "fleet.efficiency";
    private const string EfficiencyFallback = "Efficiency";
    private const string AverageKey = "fleet.average";
    private const string AverageFallback = "fleet average";
    private const string AlertsKey = "fleet.alerts";
    private const string AlertsFallback = "Alerts";
    private const string UnreadKey = "fleet.unread";
    private const string UnreadFallback = "unread";
    private const string AriaKey = "fleet.stats.aria";
    private const string AriaFallback = "Fleet statistics";

    /// <summary>The energy unit suffix the web hard-codes onto the 30-day energy figure.</summary>
    public const string EnergyUnit = "kWh";

    /// <summary>Project <paramref name="data"/> using the user's <paramref name="units"/> + i18n facade.</summary>
    public static FleetStatsBarDisplay Project(FleetStatsBarData data, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string distanceUnit = UnitLabels.Label(units.Distance);
        string efficiencyUnit = $"Wh/{distanceUnit}";

        // Distance: total_distance_km is kilometres (Go: DistanceM / 1000). The web widget passes that km
        // value straight into convertDistanceFromSI(), which expects METRES — a latent ×1000 unit bug. The
        // native surface lifts km → SI metres first, then converts to the user's unit, so the "Distance (30d)"
        // panel shows the correct figure per the SI display-boundary contract (documented, not silent drift).
        double distanceDisplay = UnitConverters.DistanceFromSi(data.TotalDistanceKm * MetersPerKm, units.Distance);

        // Efficiency: avg_efficiency_wh_km is Wh/km; convert to Wh/mi only when the distance unit is miles
        // (web toEfficiencyDisplay: distance === 'mi' ? whPerKm * 1.609344 : whPerKm).
        double efficiencyDisplay = units.Distance == DistanceUnit.Mi
            ? data.AvgEfficiencyWhKm * KmPerMile
            : data.AvgEfficiencyWhKm;

        string onlineWord = localizer.GetString(OnlineKey, OnlineFallback);
        string onlineCaption = string.Format(
            CultureInfo.CurrentCulture,
            "{0} {1}",
            ScalarFormatters.FormatNumber(data.OnlineCount, CountDecimals),
            onlineWord);

        var panels = new[]
        {
            CaptionPanel(
                "fleet-size",
                localizer.GetString(SizeKey, SizeFallback),
                data.VehicleCount,
                CountDecimals,
                suffix: null,
                onlineCaption),
            ChartPanel(
                "fleet-distance",
                localizer.GetString(DistanceKey, DistanceFallback),
                distanceDisplay,
                DistanceDecimals,
                $" {distanceUnit}",
                BuildSparkline(localizer.GetString(DistanceKey, DistanceFallback), data.RecentDriveDistancesM, ChartRole.Speed, DistanceChartColorIndex)),
            ChartPanel(
                "fleet-energy",
                localizer.GetString(EnergyKey, EnergyFallback),
                data.TotalEnergyKwh,
                EnergyDecimals,
                $" {EnergyUnit}",
                BuildSparkline(localizer.GetString(EnergyKey, EnergyFallback), data.RecentChargeEnergiesWh, ChartRole.Energy, EnergyChartColorIndex)),
            CaptionPanel(
                "fleet-efficiency",
                localizer.GetString(EfficiencyKey, EfficiencyFallback),
                efficiencyDisplay,
                EfficiencyDecimals,
                $" {efficiencyUnit}",
                localizer.GetString(AverageKey, AverageFallback)),
            CaptionPanel(
                "fleet-alerts",
                localizer.GetString(AlertsKey, AlertsFallback),
                data.UnreadAlerts,
                CountDecimals,
                suffix: null,
                localizer.GetString(UnreadKey, UnreadFallback)),
        };

        return new FleetStatsBarDisplay(
            Panels: panels,
            HasData: data.HasData,
            AutomationName: localizer.GetString(AriaKey, AriaFallback));
    }

    private static FleetStatPanel CaptionPanel(
        string key,
        string label,
        double value,
        int precision,
        string? suffix,
        string? subLabel)
    {
        string formatted = ScalarFormatters.FormatNumber(value, precision);
        return new FleetStatPanel(
            Key: key,
            Label: label,
            Value: value,
            Precision: precision,
            Suffix: suffix,
            FormattedValue: formatted,
            SubLabel: subLabel,
            Chart: null,
            AutomationName: ComposeAutomation(label, formatted, suffix, subLabel));
    }

    private static FleetStatPanel ChartPanel(
        string key,
        string label,
        double value,
        int precision,
        string? suffix,
        ChartSeries chart)
    {
        string formatted = ScalarFormatters.FormatNumber(value, precision);
        return new FleetStatPanel(
            Key: key,
            Label: label,
            Value: value,
            Precision: precision,
            Suffix: suffix,
            FormattedValue: formatted,
            SubLabel: null,
            Chart: chart,
            AutomationName: ComposeAutomation(label, formatted, suffix, subLabel: null));
    }

    // web MiniChart: `data={arr ?? [0]}` — an absent/empty series still renders (a single flat zero point), so
    // the panel never collapses to a blank box.
    private static ChartSeries BuildSparkline(string name, IReadOnlyList<double> values, ChartRole role, int colorIndex)
    {
        var points = new List<ChartPoint>(Math.Max(1, values.Count));
        if (values.Count == 0)
        {
            points.Add(new ChartPoint(0, 0));
        }
        else
        {
            for (int i = 0; i < values.Count; i++)
            {
                double y = values[i];
                points.Add(new ChartPoint(i, double.IsFinite(y) ? y : 0));
            }
        }

        return new ChartSeries(name, points)
        {
            Kind = ChartSeriesKind.Area,
            Role = role,
            ColorIndex = colorIndex,
        };
    }

    private static string ComposeAutomation(string label, string formatted, string? suffix, string? subLabel)
    {
        string value = string.IsNullOrEmpty(suffix) ? formatted : formatted + suffix;
        return string.IsNullOrEmpty(subLabel)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1}. {2}", label, value, subLabel);
    }
}

/// <summary>
/// Canonical metadata for the Fleet-stats bar surface — the native mirror of the web component at
/// web/src/features/dashboard/components/FleetStatsBar.tsx. The surface aggregates the same fleet analytics,
/// vehicle roster, recent drives/charges and unread-alert count the dashboard feeds the web bar.
/// </summary>
public static class FleetStatsBarRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "fleet-stats-bar";

    /// <summary>Surface category.</summary>
    public const string Category = "dashboard";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "FleetStatsBar";

    /// <summary>The trailing-window day count requested from the fleet-analytics endpoint (web <c>useFleetAnalytics(30)</c>).</summary>
    public const int AnalyticsDays = 30;

    /// <summary>The number of recent drives/charges fetched for the sparklines (web <c>limit=5</c>).</summary>
    public const int RecentLimit = 5;

    /// <summary>Localized surface name (web dashboard fleet-stats bar).</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("fleet.stats.aria", "Fleet statistics");
    }
}

/// <summary>
/// PII-safe diagnostics for the Fleet-stats bar surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a distance, energy, vehicle id or alert
/// count — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class FleetStatsBarDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FleetStatsBarDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FleetStatsBar</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FleetStatsBarRegistration.Slug}");
    }
}
