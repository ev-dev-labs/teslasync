using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="FleetStatsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>FleetStatsWidget</c> renders
/// through <c>WidgetShell</c> + <c>FleetStatsBar</c>
/// (web/src/features/dashboard/widgets/FleetStatsWidget.tsx). Every branch maps onto a visible surface;
/// none is ever hidden. <see cref="Empty"/> mirrors a fleet with no vehicles and no 30-day distance or
/// energy (the friendly "no fleet data yet" surface) rather than an empty HTTP body — the fleet endpoint
/// always returns a populated object. The fleet-analytics read is the spine that gates
/// loading / error / stale / offline; the vehicle, recent-drive and recent-charge reads only enrich the
/// projected value (web parity: only <c>useFleetAnalytics</c> is wired to <c>WidgetShell</c>).
/// </summary>
public enum FleetStatsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot from the network (or non-stale cache) with fleet data to show.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no vehicles, distance or energy — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The fleet analytics rollup from <c>GET /analytics/fleet?days=30</c> (web <c>useFleetAnalytics(30)</c>,
/// shape <c>FleetAnalytics</c> in web/src/api/types.ts). Only the fields the web <c>FleetStatsBar</c>
/// reads are projected; field names mirror the Go API's snake_case JSON tags
/// (<c>total_vehicles</c>, <c>total_distance_km</c>, <c>total_energy_kwh</c>,
/// <c>avg_efficiency_wh_km</c>). Parsing is null-tolerant so a partial body never throws. Distances are
/// kilometres and efficiency is Wh/km — both converted to the user's display unit only at projection time.
/// </summary>
/// <param name="TotalVehicles">Fleet vehicle count reported by the analytics endpoint (web <c>total_vehicles</c>).</param>
/// <param name="TotalDistanceKm">Fleet 30-day distance in kilometres (web <c>total_distance_km</c>).</param>
/// <param name="TotalEnergyKwh">Fleet 30-day energy in kilowatt-hours (web <c>total_energy_kwh</c>).</param>
/// <param name="AvgEfficiencyWhKm">Fleet average efficiency in Wh/km (web <c>avg_efficiency_wh_km</c>).</param>
public sealed record FleetStatsAnalytics(
    double TotalVehicles,
    double TotalDistanceKm,
    double TotalEnergyKwh,
    double AvgEfficiencyWhKm)
{
    /// <summary>An all-zero snapshot — the parse fallback for an absent/non-object body.</summary>
    public static FleetStatsAnalytics Empty { get; } = new(0, 0, 0, 0);

    /// <summary>Project a <c>GET /analytics/fleet</c> JSON object into a tolerant snapshot.</summary>
    public static FleetStatsAnalytics FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new FleetStatsAnalytics(
            TotalVehicles: JsonNumbers.GetDouble(element, "total_vehicles") ?? 0,
            TotalDistanceKm: JsonNumbers.GetDouble(element, "total_distance_km") ?? 0,
            TotalEnergyKwh: JsonNumbers.GetDouble(element, "total_energy_kwh") ?? 0,
            AvgEfficiencyWhKm: JsonNumbers.GetDouble(element, "avg_efficiency_wh_km") ?? 0);
    }
}

/// <summary>
/// The fleet vehicle rollup parsed from the <c>GET /vehicles</c> list (web <c>useVehicles</c>). It mirrors
/// the web component's <c>vehicleCount = vehicles?.length</c> and
/// <c>onlineCount = vehicles?.filter(v =&gt; v.state === 'online').length</c> reductions over the list, so
/// the view never iterates the raw list. Parsing is null-tolerant (a non-array body yields the empty rollup).
/// </summary>
/// <param name="Count">Total vehicles in the fleet (web <c>vehicles.length</c>).</param>
/// <param name="OnlineCount">Vehicles whose coarse <c>state</c> is <c>online</c> (web <c>filter(state === 'online')</c>).</param>
public sealed record FleetVehiclesRollup(int Count, int OnlineCount)
{
    /// <summary>An empty fleet (no vehicles) — the parse fallback for an absent/non-array body.</summary>
    public static FleetVehiclesRollup Empty { get; } = new(0, 0);

    /// <summary>Reduce a <c>GET /vehicles</c> JSON array into the fleet-size + online-count rollup.</summary>
    public static FleetVehiclesRollup FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        int count = 0;
        int online = 0;
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            count++;
            if (item.TryGetProperty("state", out var state) &&
                state.ValueKind == JsonValueKind.String &&
                string.Equals(state.GetString(), "online", StringComparison.OrdinalIgnoreCase))
            {
                online++;
            }
        }

        return new FleetVehiclesRollup(count, online);
    }
}

/// <summary>
/// The fully merged fleet snapshot the projection consumes: the analytics rollup, the vehicle-list rollup,
/// and the recent drive/charge series that back the two sparklines. It is the native analogue of the four
/// web hooks (<c>useFleetAnalytics</c>, <c>useVehicles</c>, the recent-drives <c>useQuery</c> and the
/// recent-charges <c>useQuery</c>) folded into one value. The drive distances (metres) and charge energies
/// (watt-hours) are kept in the API's newest-first order; the projection slices and reverses them to draw
/// the sparkline chronologically (web <c>recentDrives.map(d =&gt; d.distance_m).reverse()</c>).
/// </summary>
/// <param name="Analytics">The fleet analytics rollup (distance, energy, efficiency, vehicle count).</param>
/// <param name="Vehicles">The vehicle-list rollup (fleet size + online count).</param>
/// <param name="RecentDriveDistancesM">Recent drive distances in metres, newest-first (web <c>distance_m</c>).</param>
/// <param name="RecentChargeEnergiesWh">Recent charge energies in watt-hours, newest-first (web <c>total_energy_added_wh</c>).</param>
public sealed record FleetStatsReading(
    FleetStatsAnalytics Analytics,
    FleetVehiclesRollup Vehicles,
    IReadOnlyList<double> RecentDriveDistancesM,
    IReadOnlyList<double> RecentChargeEnergiesWh)
{
    /// <summary>A fully-empty reading — no analytics, no vehicles, no recent activity.</summary>
    public static FleetStatsReading Empty { get; } = new(
        FleetStatsAnalytics.Empty, FleetVehiclesRollup.Empty, Array.Empty<double>(), Array.Empty<double>());

    /// <summary>
    /// True when there is something worth showing — any vehicle (from the list or the analytics count) or any
    /// 30-day distance or energy. Gates the empty state, mirroring the web bar which only collapses to nothing
    /// when the fleet is genuinely empty.
    /// </summary>
    public bool HasData =>
        Vehicles.Count > 0 ||
        Analytics.TotalVehicles > 0 ||
        Analytics.TotalDistanceKm > 0 ||
        Analytics.TotalEnergyKwh > 0;

    /// <summary>Parse a <c>GET /drives</c> JSON array into the recent drive distances (metres), preserving order.</summary>
    public static IReadOnlyList<double> ParseDriveDistances(JsonElement element) =>
        JsonNumbers.GetObjectField(element, "distance_m");

    /// <summary>Parse a <c>GET /charging</c> JSON array into the recent charge energies (watt-hours), preserving order.</summary>
    public static IReadOnlyList<double> ParseChargeEnergies(JsonElement element) =>
        JsonNumbers.GetObjectField(element, "total_energy_added_wh");
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c>; the
/// <see cref="GridColumns"/> derivation reproduces the responsive
/// <c>grid-cols-2 sm:grid-cols-3 md:grid-cols-4</c> card layout the web <c>FleetStatsBar</c> uses, clamped
/// to the dashboard's four-column grid.
/// </summary>
/// <param name="Cols">Footprint width in grid columns.</param>
/// <param name="Rows">Footprint height in grid rows.</param>
public readonly record struct FleetStatsSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (4×2).</summary>
    public static FleetStatsSize Default => new(4, 2);

    /// <summary>
    /// Card-grid column count for this footprint: 4 at full width, 3 at three columns, otherwise 2 — the
    /// native mapping of the web bar's responsive breakpoints (the five cards wrap across rows).
    /// </summary>
    public int GridColumns => Cols >= 4 ? 4 : Cols == 3 ? 3 : 2;
}

/// <summary>
/// The semantic accent of a metric card's value, resolved to a themed brush by the view. Mirrors the web
/// <c>FleetStatsBar</c> value colours: fleet size uses the primary text colour, distance is cyan, energy is
/// emerald, efficiency is amber, and the alert count is danger when unread alerts exist (web
/// <c>unreadAlerts &gt; 0 ? 'text-red-500' : 'text-emerald-500'</c>) or success when clear.
/// </summary>
public enum FleetStatTone
{
    /// <summary>Primary text colour (web <c>text-[var(--text-primary)]</c>, the fleet-size card).</summary>
    Primary,

    /// <summary>Cyan accent (web <c>text-cyan-300</c>, the distance card).</summary>
    Cyan,

    /// <summary>Emerald accent (web <c>text-emerald-300</c>, the energy card).</summary>
    Emerald,

    /// <summary>Amber accent (web <c>text-amber-300</c>, the efficiency card).</summary>
    Amber,

    /// <summary>Danger accent for a non-zero alert count (web <c>text-red-500</c>).</summary>
    AlertActive,

    /// <summary>Success accent for a clear alert count (web <c>text-emerald-500</c>).</summary>
    AlertClear,
}

/// <summary>
/// One projected, display-ready metric card consumed by the WinUI view. Holds the localized label, the
/// already-converted numeric value plus its precision and unit suffix (the view tweens it with
/// <c>TsAnimatedNumber</c>), an optional secondary subtitle, the value tone, the optional trend sparkline
/// (with its categorical palette index), and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">The localized card label (e.g. "Fleet Size").</param>
/// <param name="Value">The display-unit numeric value the view animates to.</param>
/// <param name="Precision">Fraction digits for the value (web <c>AnimatedNumber decimals</c>).</param>
/// <param name="Suffix">The unit suffix appended after the value (e.g. " km", " kWh", ""), or empty.</param>
/// <param name="Subtitle">An optional secondary line (e.g. "{n} online", "fleet average", "unread"), or null.</param>
/// <param name="Tone">The value's semantic accent.</param>
/// <param name="Sparkline">The trend series to draw beneath the value, or null when there is none (&lt; 2 points).</param>
/// <param name="SparkColorIndex">Categorical palette index for the sparkline (web <c>MiniChart color</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the whole card.</param>
public sealed record FleetStatCard(
    string Label,
    double Value,
    int Precision,
    string Suffix,
    string? Subtitle,
    FleetStatTone Tone,
    IReadOnlyList<double>? Sparkline,
    int SparkColorIndex,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the fleet stats for one footprint — the native analogue of
/// everything the web <c>FleetStatsBar</c> computes before returning JSX. Holds the five metric cards plus
/// the empty-gate flag. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when the fleet has something to show (gates the empty state).</param>
/// <param name="Cards">The five metric cards, in display order.</param>
public sealed record FleetStatsDisplay(bool HasData, IReadOnlyList<FleetStatCard> Cards);

/// <summary>
/// Pure projection from a raw <see cref="FleetStatsReading"/> to the display model — the native port of the
/// unit conversion + card composition in web/src/features/dashboard/components/FleetStatsBar.tsx. SI is
/// converted to the user's display unit here (and only here); every label resolves through the i18n facade.
/// </summary>
public static class FleetStatsProjection
{
    /// <summary>
    /// Miles→kilometres factor used to restate Wh/km efficiency as Wh/mi. Matches the web
    /// <c>FleetStatsWidget</c>'s <c>whPerKm * 1.609344</c> exactly (note: distinct from the sibling
    /// AnalyticsSummary widget's 1.60934 constant).
    /// </summary>
    public const double MiToKm = 1.609344;

    /// <summary>The recent drive/charge series cap that backs each sparkline (web <c>limit=5</c>).</summary>
    public const int RecentLimit = 5;

    /// <summary>Project <paramref name="reading"/> for <paramref name="size"/> using the user's units.</summary>
    public static FleetStatsDisplay Project(
        FleetStatsReading reading,
        FleetStatsSize size,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        _ = size;

        var distanceUnit = units.Distance;
        string distanceUnitLabel = UnitLabels.Label(distanceUnit);
        string efficiencyUnit = distanceUnit == DistanceUnit.Mi ? "Wh/mi" : "Wh/km";

        // Web parity (FleetStatsWidget.tsx): toDistanceDisplay(total_distance_km) calls
        // convertDistanceFromSI(value, unit) on the raw total_distance_km with NO km→m scaling — mirrored
        // verbatim here so the surface matches its binding spec (distinct from AnalyticsSummary's ×1000).
        double displayDistance = UnitConverters.DistanceFromSi(reading.Analytics.TotalDistanceKm, distanceUnit);
        double displayEfficiency = distanceUnit == DistanceUnit.Mi
            ? reading.Analytics.AvgEfficiencyWhKm * MiToKm
            : reading.Analytics.AvgEfficiencyWhKm;
        double energyKwh = reading.Analytics.TotalEnergyKwh;

        int vehicleCount = reading.Vehicles.Count;
        int onlineCount = reading.Vehicles.OnlineCount;
        const int unreadAlerts = 0; // Web parity: FleetStatsWidget passes unreadAlerts={0}.

        var distanceSparkline = Trend(reading.RecentDriveDistancesM);
        var energySparkline = Trend(reading.RecentChargeEnergiesWh);

        string fleetSizeLabel = localizer.GetString("widget.fleetStats.fleetSize", "Fleet Size");
        string onlineWord = localizer.GetString("widget.fleetStats.online", "online");
        string distanceLabel = localizer.GetString("widget.fleetStats.distance", "Distance (30d)");
        string energyLabel = localizer.GetString("widget.fleetStats.energy", "Energy (30d)");
        string efficiencyLabel = localizer.GetString("widget.fleetStats.efficiency", "Efficiency");
        string averageWord = localizer.GetString("widget.fleetStats.average", "fleet average");
        string alertsLabel = localizer.GetString("widget.fleetStats.alerts", "Alerts");
        string unreadWord = localizer.GetString("widget.fleetStats.unread", "unread");

        string fleetSizeSubtitle = string.Format(CultureInfo.CurrentCulture, "{0} {1}", onlineCount, onlineWord);

        var cards = new List<FleetStatCard>(5)
        {
            new(
                fleetSizeLabel,
                vehicleCount,
                0,
                string.Empty,
                fleetSizeSubtitle,
                FleetStatTone.Primary,
                null,
                0,
                CardAutomationName(fleetSizeLabel, vehicleCount, 0, string.Empty, fleetSizeSubtitle)),
            new(
                distanceLabel,
                displayDistance,
                0,
                $" {distanceUnitLabel}",
                null,
                FleetStatTone.Cyan,
                distanceSparkline,
                0,
                CardAutomationName(distanceLabel, displayDistance, 0, distanceUnitLabel, null)),
            new(
                energyLabel,
                energyKwh,
                1,
                " kWh",
                null,
                FleetStatTone.Emerald,
                energySparkline,
                1,
                CardAutomationName(energyLabel, energyKwh, 1, "kWh", null)),
            new(
                efficiencyLabel,
                displayEfficiency,
                0,
                $" {efficiencyUnit}",
                averageWord,
                FleetStatTone.Amber,
                null,
                2,
                CardAutomationName(efficiencyLabel, displayEfficiency, 0, efficiencyUnit, averageWord)),
            new(
                alertsLabel,
                unreadAlerts,
                0,
                string.Empty,
                unreadWord,
                unreadAlerts > 0 ? FleetStatTone.AlertActive : FleetStatTone.AlertClear,
                null,
                0,
                CardAutomationName(alertsLabel, unreadAlerts, 0, string.Empty, unreadWord)),
        };

        return new FleetStatsDisplay(reading.HasData, cards);
    }

    private static List<double>? Trend(IReadOnlyList<double> newestFirst)
    {
        if (newestFirst.Count < 2)
        {
            // Web parity: MiniChart renders nothing below two points (data.length < 2 → null).
            return null;
        }

        var slice = new List<double>(Math.Min(RecentLimit, newestFirst.Count));
        for (int i = 0; i < newestFirst.Count && slice.Count < RecentLimit; i++)
        {
            slice.Add(newestFirst[i]);
        }

        if (slice.Count < 2)
        {
            return null;
        }

        slice.Reverse(); // Newest-first API order → chronological for the sparkline.
        return slice;
    }

    private static string CardAutomationName(string label, double value, int precision, string unit, string? subtitle)
    {
        string formatted = ScalarFormatters.FormatNumber(value, precision);
        string core = string.IsNullOrEmpty(unit)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, formatted)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, formatted, unit);

        return string.IsNullOrEmpty(subtitle)
            ? core
            : string.Format(CultureInfo.CurrentCulture, "{0}, {1}", core, subtitle);
    }
}

/// <summary>
/// Folds the four raw cache-then-network reads (fleet analytics — the spine — plus the vehicle list and the
/// recent drive/charge lists) into a single parsed <c>RepositoryResult&lt;FleetStatsReading&gt;</c>,
/// preserving the analytics read's freshness status so the view-model can render the full state matrix. The
/// auxiliary reads only enrich the value — they never gate the surface — mirroring the web component, which
/// wires only <c>useFleetAnalytics</c> to <c>WidgetShell</c>. Kept pure so the combine contract is
/// unit-tested without a network or cache.
/// </summary>
public static class FleetStatsResultMapper
{
    /// <summary>Combine the four raw emissions, taking the analytics read's status as the surface status.</summary>
    public static RepositoryResult<FleetStatsReading> Combine(
        RepositoryResult<JsonElement> analytics,
        RepositoryResult<JsonElement> vehicles,
        RepositoryResult<JsonElement> drives,
        RepositoryResult<JsonElement> charges)
    {
        ArgumentNullException.ThrowIfNull(analytics);
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(drives);
        ArgumentNullException.ThrowIfNull(charges);

        FleetStatsReading Reading() => new(
            analytics.HasValue ? FleetStatsAnalytics.FromJson(analytics.Value) : FleetStatsAnalytics.Empty,
            vehicles.HasValue ? FleetVehiclesRollup.FromJson(vehicles.Value) : FleetVehiclesRollup.Empty,
            drives.HasValue ? FleetStatsReading.ParseDriveDistances(drives.Value) : Array.Empty<double>(),
            charges.HasValue ? FleetStatsReading.ParseChargeEnergies(charges.Value) : Array.Empty<double>());

        return analytics.Status switch
        {
            LoadStatus.Loading => RepositoryResult<FleetStatsReading>.Loading(),
            LoadStatus.Cached => RepositoryResult<FleetStatsReading>.Cached(Reading(), analytics.FetchedAt!.Value, analytics.IsStale),
            LoadStatus.Refreshing => RepositoryResult<FleetStatsReading>.Refreshing(Reading(), analytics.FetchedAt!.Value, analytics.IsStale),
            LoadStatus.Loaded => RepositoryResult<FleetStatsReading>.Loaded(Reading(), analytics.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<FleetStatsReading>.Empty(analytics.FetchedAt),
            LoadStatus.Offline => RepositoryResult<FleetStatsReading>.OfflineCached(Reading(), analytics.FetchedAt!.Value, analytics.Error!),
            _ => RepositoryResult<FleetStatsReading>.Failure(
                analytics.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Small null-tolerant JSON readers shared by the fleet-stats parse adapters: a scalar <c>double</c> reader
/// (number or numeric string) and an array-of-objects field extractor. Kept here so the parse contract is
/// exercised by the same unit tests as the records that use it.
/// </summary>
internal static class JsonNumbers
{
    /// <summary>Read a finite <c>double</c> from <paramref name="name"/>, or null when absent/unparseable.</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && IsFinite(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && IsFinite(n) => n,
            _ => null,
        };
    }

    /// <summary>
    /// Extract a finite numeric <paramref name="field"/> from each object in a JSON array, preserving order and
    /// skipping rows where the field is missing/non-finite. A non-array body yields an empty list.
    /// </summary>
    public static IReadOnlyList<double> GetObjectField(JsonElement element, string field)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<double>();
        }

        var list = new List<double>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (GetDouble(item, field) is { } value)
            {
                list.Add(value);
            }
        }

        return list;
    }

    private static bool IsFinite(double n) => !double.IsNaN(n) && !double.IsInfinity(n);
}
