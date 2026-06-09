using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.OverviewVehicleComparison;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="OverviewVehicleComparisonViewModel"/> exposes —
/// the native union of the loading / loaded / empty / error / stale / offline branches the web
/// <c>OverviewVehicleComparison</c> surface composes through its parent analytics query
/// (web/src/features/analytics/components/analytics/OverviewVehicleComparison.tsx + AnalyticsPage's
/// <c>useFleetAnalytics</c>). Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum OverviewVehicleComparisonState
{
    /// <summary>Initial fetch with no cached snapshot yet — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) — render the four comparison panels.</summary>
    Loaded,

    /// <summary>The fleet-analytics read resolved with no analytics object — render the friendly empty grid.</summary>
    Empty,

    /// <summary>The read failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One row of the fleet <c>vehicle_comparison</c> array (web
/// <c>FleetAnalytics.vehicle_comparison[]</c>). <see cref="DistanceKm"/> is the raw SI kilometre wire
/// value, <see cref="EnergyKwh"/> is kilowatt-hours, <see cref="EfficiencyWhKm"/> is watt-hours per
/// kilometre, and <see cref="Drives"/> is a count — all carried verbatim and converted to display units
/// only at projection time. Pure data — no WinUI types — so the parse + projection are unit-tested
/// without a UI host.
/// </summary>
public sealed record VehicleComparisonVehicle(
    long Id,
    string Name,
    double DistanceKm,
    double EnergyKwh,
    double EfficiencyWhKm,
    double Drives);

/// <summary>
/// The parsed fleet comparison payload — the list of <see cref="VehicleComparisonVehicle"/> rows read
/// from a <c>GET /analytics/fleet</c> object's <c>vehicle_comparison</c> array. Mirrors the web
/// component's <c>vehicles = data?.vehicle_comparison ?? []</c> gate: a missing/non-array field yields an
/// empty list, never a throw.
/// </summary>
public sealed record OverviewVehicleComparisonData(IReadOnlyList<VehicleComparisonVehicle> Vehicles)
{
    /// <summary>The all-empty payload — the parse/projection fallback (web's <c>?? []</c>).</summary>
    public static OverviewVehicleComparisonData Empty { get; } = new(Array.Empty<VehicleComparisonVehicle>());

    /// <summary>True when at least one vehicle row is present (gates the per-panel content vs empty).</summary>
    public bool HasData => Vehicles.Count > 0;

    /// <summary>
    /// Read the <c>vehicle_comparison</c> rows from a <c>GET /analytics/fleet</c> object. Tolerant of a
    /// missing/non-array field (empty) and of numeric strings / missing numbers (default zero, mirroring
    /// the web <c>safe()</c> guard).
    /// </summary>
    public static OverviewVehicleComparisonData FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty("vehicle_comparison", out var array) ||
            array.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        var rows = new List<VehicleComparisonVehicle>(array.GetArrayLength());
        foreach (var element in array.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            rows.Add(new VehicleComparisonVehicle(
                GetLong(element, "id"),
                GetString(element, "name"),
                GetDouble(element, "distance"),
                GetDouble(element, "energy"),
                GetDouble(element, "efficiency"),
                GetDouble(element, "drives")));
        }

        return new OverviewVehicleComparisonData(rows);
    }

    private static long GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    private static string GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? string.Empty : string.Empty;

    // Web parity: safe(v.x) = Number.isFinite(x) ? x : 0. A missing field, a null, or a non-finite value
    // collapses to zero; numeric strings are tolerated like the JSON the API can emit.
    private static double GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && double.IsFinite(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) => n,
            _ => 0,
        };
    }
}

/// <summary>
/// One ranked row of the Efficiency Leaderboard (web's sorted <c>leaderboard</c> list). Holds the
/// already-localized rank label, the formatted efficiency value with its unit, the proportional bar
/// fraction (0..1, the web <c>pct / 100</c>), the palette index and a Narrator name. Pure data.
/// </summary>
public sealed record LeaderboardEntry(
    int Rank,
    string Label,
    string FormattedValue,
    double BarFraction,
    int ColorIndex,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the vehicle comparison — the native analogue of the
/// <c>leaderboard</c> / <c>radarData</c> <c>useMemo</c>s plus the pie + bar series the web
/// <c>OverviewVehicleComparison</c> builds. Every string is localized and every numeric value is already
/// converted to the user's display unit, so the WinUI view is a thin renderer. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record OverviewVehicleComparisonDisplay(
    bool HasVehicles,
    bool HasComparison,
    string FleetUsageTitle,
    IReadOnlyList<ChartPoint> FleetUsage,
    string DistanceUnitLabel,
    string NoVehiclesMessage,
    string EfficiencyLeaderboardTitle,
    IReadOnlyList<LeaderboardEntry> Leaderboard,
    string EfficiencyUnitLabel,
    string NoEfficiencyMessage,
    string VehicleComparisonTitle,
    IReadOnlyList<ChartSeries> ComparisonSeries,
    double ComparisonMax,
    string NoComparisonMessage,
    string EnergyActivityTitle,
    IReadOnlyList<ChartSeries> EnergyActivitySeries,
    IReadOnlyList<string> VehicleNames)
{
    /// <summary>The empty projection — all four panels resolve to their friendly empty state.</summary>
    public static OverviewVehicleComparisonDisplay CreateEmpty(ILocalizer localizer) =>
        OverviewVehicleComparisonProjection.Project(OverviewVehicleComparisonData.Empty, UnitPref.Metric, localizer);
}

/// <summary>
/// Pure projection from the parsed <see cref="OverviewVehicleComparisonData"/> to the display model — the
/// native port of the four panels the web <c>OverviewVehicleComparison</c> renders: the Fleet Usage donut
/// (distance per vehicle, converted to the display unit), the Efficiency Leaderboard (sorted ascending by
/// Wh/km, proportional bars), the Vehicle Comparison radar (per-metric normalized 0..100, efficiency
/// inverted, only with 2+ vehicles) and the Energy &amp; Activity grouped bars (energy kWh + drives). The
/// distance and efficiency conversions happen here and only here; every label resolves through the i18n
/// facade.
/// </summary>
public static class OverviewVehicleComparisonProjection
{
    /// <summary>1 mile = 1.609344 km (web <c>KM_PER_MILE</c>); Wh/km × this = Wh/mi.</summary>
    public const double KmPerMile = 1.609344;

    /// <summary>The radar axis maximum — every metric is normalized to a 0..100 scale (web parity).</summary>
    public const double RadarMax = 100;

    // Web parity: the Energy & Activity bars use CHART_COLORS[1] (energy) and CHART_COLORS[3] (drives);
    // the leaderboard bars are a single accent (web bg-neon-cyan → palette index 0).
    private const int EnergyColorIndex = 1;
    private const int DrivesColorIndex = 3;
    private const int LeaderboardColorIndex = 0;

    /// <summary>Project <paramref name="data"/> for the user's <paramref name="units"/>, localized via <paramref name="localizer"/>.</summary>
    public static OverviewVehicleComparisonDisplay Project(
        OverviewVehicleComparisonData data,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var distanceUnit = units.Distance;
        string distanceUnitLabel = UnitLabels.Label(distanceUnit);
        bool miles = distanceUnit == DistanceUnit.Mi;
        // Web parity (OverviewVehicleComparison.tsx L25): efficiencyUnit = distance==='mi' ? 'Wh/mi' : 'Wh/km'.
        string efficiencyUnitLabel = miles
            ? localizer.GetString("analytics.overview.effUnitMi", "Wh/mi")
            : localizer.GetString("analytics.overview.effUnitKm", "Wh/km");

        var named = new List<(VehicleComparisonVehicle Row, string Name)>(data.Vehicles.Count);
        for (int i = 0; i < data.Vehicles.Count; i++)
        {
            named.Add((data.Vehicles[i], ResolveName(data.Vehicles[i], i, localizer)));
        }

        bool hasVehicles = named.Count > 0;
        bool hasComparison = named.Count >= 2;

        return new OverviewVehicleComparisonDisplay(
            HasVehicles: hasVehicles,
            HasComparison: hasComparison,
            FleetUsageTitle: localizer.GetString("analytics.overview.fleetUsage", "Fleet Usage"),
            FleetUsage: BuildFleetUsage(named, distanceUnit),
            DistanceUnitLabel: distanceUnitLabel,
            NoVehiclesMessage: localizer.GetString("analytics.overview.noVehicles", "No vehicle data"),
            EfficiencyLeaderboardTitle: localizer.GetString("analytics.overview.effLeaderboard", "Efficiency Leaderboard"),
            Leaderboard: BuildLeaderboard(named, miles, efficiencyUnitLabel),
            EfficiencyUnitLabel: efficiencyUnitLabel,
            NoEfficiencyMessage: localizer.GetString("analytics.overview.noEfficiency", "No efficiency data"),
            VehicleComparisonTitle: localizer.GetString("analytics.overview.vehicleComparison", "Vehicle Comparison"),
            ComparisonSeries: BuildComparison(named, localizer),
            ComparisonMax: RadarMax,
            NoComparisonMessage: localizer.GetString("analytics.overview.noComparison", "Need 2+ vehicles for comparison"),
            EnergyActivityTitle: localizer.GetString("analytics.overview.energyActivity", "Energy & Activity"),
            EnergyActivitySeries: BuildEnergyActivity(named, localizer),
            VehicleNames: named.ConvertAll(n => n.Name));
    }

    private static List<ChartPoint> BuildFleetUsage(
        List<(VehicleComparisonVehicle Row, string Name)> named,
        DistanceUnit distanceUnit)
    {
        var points = new List<ChartPoint>(named.Count);
        for (int i = 0; i < named.Count; i++)
        {
            // Web parity: convertDistanceFromSI(safe(v.distance) * 1000, distanceUnit) — km → metres → display.
            double display = UnitConverters.DistanceFromSi(named[i].Row.DistanceKm * 1000, distanceUnit);
            points.Add(new ChartPoint(i, display, named[i].Name));
        }

        return points;
    }

    private static IReadOnlyList<LeaderboardEntry> BuildLeaderboard(
        List<(VehicleComparisonVehicle Row, string Name)> named,
        bool miles,
        string efficiencyUnitLabel)
    {
        if (named.Count == 0)
        {
            return Array.Empty<LeaderboardEntry>();
        }

        // Web parity: sorted ascending by efficiency (stable); maxEff = the largest efficiency in the list.
        var sorted = named
            .Select((n, index) => (n.Row, n.Name, OriginalIndex: index))
            .OrderBy(x => x.Row.EfficiencyWhKm)
            .ToList();
        double maxEff = sorted[^1].Row.EfficiencyWhKm;

        var entries = new List<LeaderboardEntry>(sorted.Count);
        for (int i = 0; i < sorted.Count; i++)
        {
            var row = sorted[i].Row;
            int rank = i + 1;
            double displayEff = miles ? row.EfficiencyWhKm * KmPerMile : row.EfficiencyWhKm;
            double barFraction = maxEff > 0 ? row.EfficiencyWhKm / maxEff : 0;
            string label = string.Format(CultureInfo.CurrentCulture, "#{0} {1}", rank, sorted[i].Name);
            string formatted = string.Format(
                CultureInfo.CurrentCulture,
                "{0} {1}",
                ScalarFormatters.FormatNumber(displayEff, 1),
                efficiencyUnitLabel);

            entries.Add(new LeaderboardEntry(
                rank,
                label,
                formatted,
                Math.Clamp(barFraction, 0, 1),
                LeaderboardColorIndex,
                string.Format(CultureInfo.CurrentCulture, "{0}, {1}", label, formatted)));
        }

        return entries;
    }

    private static IReadOnlyList<ChartSeries> BuildComparison(
        List<(VehicleComparisonVehicle Row, string Name)> named,
        ILocalizer localizer)
    {
        // Web parity: the radar renders only with 2+ vehicles (radarData = [] otherwise).
        if (named.Count < 2)
        {
            return Array.Empty<ChartSeries>();
        }

        double maxDist = Math.Max(1, named.Max(n => n.Row.DistanceKm));
        double maxEnergy = Math.Max(1, named.Max(n => n.Row.EnergyKwh));
        double maxDrives = Math.Max(1, named.Max(n => n.Row.Drives));
        double maxEff = Math.Max(1, named.Max(n => n.Row.EfficiencyWhKm));

        string distanceMetric = localizer.GetString("analytics.overview.metricDistance", "Distance");
        string energyMetric = localizer.GetString("analytics.overview.metricEnergy", "Energy");
        string drivesMetric = localizer.GetString("analytics.overview.metricDrives", "Drives");
        string efficiencyMetric = localizer.GetString("analytics.overview.metricEfficiency", "Efficiency");

        var series = new List<ChartSeries>(named.Count);
        for (int i = 0; i < named.Count; i++)
        {
            var row = named[i].Row;
            var points = new ChartPoint[]
            {
                new(0, row.DistanceKm / maxDist * 100, distanceMetric),
                new(1, row.EnergyKwh / maxEnergy * 100, energyMetric),
                new(2, row.Drives / maxDrives * 100, drivesMetric),
                // Web parity: efficiency is inverted ((maxEff - eff) / maxEff) so lower Wh/km ranks higher.
                new(3, (maxEff - row.EfficiencyWhKm) / maxEff * 100, efficiencyMetric),
            };
            series.Add(new ChartSeries(named[i].Name, points) { ColorIndex = i });
        }

        return series;
    }

    private static ChartSeries[] BuildEnergyActivity(
        List<(VehicleComparisonVehicle Row, string Name)> named,
        ILocalizer localizer)
    {
        if (named.Count == 0)
        {
            return Array.Empty<ChartSeries>();
        }

        var energyPoints = new ChartPoint[named.Count];
        var drivesPoints = new ChartPoint[named.Count];
        for (int i = 0; i < named.Count; i++)
        {
            energyPoints[i] = new ChartPoint(i, named[i].Row.EnergyKwh, named[i].Name);
            drivesPoints[i] = new ChartPoint(i, named[i].Row.Drives, named[i].Name);
        }

        return new ChartSeries[]
        {
            new(localizer.GetString("analytics.overview.energykWh", "Energy (kWh)"), energyPoints)
            {
                Kind = ChartSeriesKind.Bar,
                ColorIndex = EnergyColorIndex,
            },
            new(localizer.GetString("analytics.overview.drives", "Drives"), drivesPoints)
            {
                Kind = ChartSeriesKind.Bar,
                ColorIndex = DrivesColorIndex,
            },
        };
    }

    private static string ResolveName(VehicleComparisonVehicle row, int index, ILocalizer localizer)
    {
        if (!string.IsNullOrWhiteSpace(row.Name))
        {
            return row.Name.Trim();
        }

        return string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("analytics.overview.vehicleFallback", "Vehicle {0}"),
            index + 1);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions into parsed
/// <c>RepositoryResult&lt;OverviewVehicleComparisonData&gt;</c> snapshots, preserving the cache-then-network
/// status (loading / cached / refreshing / loaded / empty / offline / error) so the view-model keeps
/// content visible while refreshing. Kept pure so the contract is unit-tested without a network or cache.
/// </summary>
public static class OverviewVehicleComparisonResultMapper
{
    /// <summary>Project one raw emission into a typed snapshot, preserving its lifecycle status.</summary>
    public static RepositoryResult<OverviewVehicleComparisonData> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<OverviewVehicleComparisonData>.Loading(),
            LoadStatus.Empty => RepositoryResult<OverviewVehicleComparisonData>.Empty(raw.FetchedAt),
            LoadStatus.Error => RepositoryResult<OverviewVehicleComparisonData>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load vehicle comparison")),
            LoadStatus.Cached => RepositoryResult<OverviewVehicleComparisonData>.Cached(
                OverviewVehicleComparisonData.FromJson(raw.Value), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<OverviewVehicleComparisonData>.Refreshing(
                OverviewVehicleComparisonData.FromJson(raw.Value), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<OverviewVehicleComparisonData>.OfflineCached(
                OverviewVehicleComparisonData.FromJson(raw.Value),
                raw.FetchedAt ?? DateTimeOffset.UtcNow,
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "A fleet read is unavailable")),
            _ => RepositoryResult<OverviewVehicleComparisonData>.Loaded(
                OverviewVehicleComparisonData.FromJson(raw.Value), raw.FetchedAt ?? DateTimeOffset.UtcNow),
        };
    }
}
