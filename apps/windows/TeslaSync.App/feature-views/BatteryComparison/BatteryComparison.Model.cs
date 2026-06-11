using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.BatteryComparison;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="BatteryComparisonViewModel"/> exposes — the native
/// union of the loading / loaded / empty / error / stale / offline branches the web <c>BatteryComparison</c>
/// surface composes through its parent <c>useQuery(['fleet-battery-states', …])</c> fan-out
/// (web/src/features/vehicles/components/BatteryComparison.tsx). Every branch maps onto a visible surface;
/// none is ever hidden. The web component returns <c>null</c> when there are no bars; the prompt overrides
/// that with the friendly <see cref="Empty"/> surface (never a blank box).
/// </summary>
public enum BatteryComparisonState
{
    /// <summary>Initial fetch with no cached snapshot yet — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with at least one vehicle — render the battery bars.</summary>
    Loaded,

    /// <summary>The fleet read resolved with no battery rows — render the friendly empty state.</summary>
    Empty,

    /// <summary>The read failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One vehicle from the fleet roster (web <c>GET /vehicles</c> row), reduced to the identity the battery
/// surface needs: the database <see cref="Id"/> the per-vehicle state read is scoped to, and the already
/// resolved <see cref="Name"/> (web <c>vehicle.display_name || vehicle.vin</c>). Pure data.
/// </summary>
public sealed record VehicleRef(long Id, string Name);

/// <summary>
/// One battery bar's raw, unit-naive data — the native analogue of a resolved
/// <c>{ vehicle, state }</c> pair the web component keeps after filtering out null states. Carries the
/// vehicle identity, the state-of-charge percentage (0-100) and the SI-metre rated range exactly as the API
/// delivers them; the unit conversion and colour selection happen at projection time so this stays a
/// WinUI-free, unit-tested value.
/// </summary>
/// <param name="Id">The vehicle's database id (stable key for the bar).</param>
/// <param name="Name">The vehicle display name (<c>display_name || vin</c>); may be blank for a malformed row.</param>
/// <param name="BatteryLevel">State-of-charge percentage 0-100 (web <c>state.battery_level ?? 0</c>).</param>
/// <param name="RatedRangeMeters">Rated range in SI metres (web <c>state.rated_range ?? 0</c>, fed to <c>formatDistance</c>).</param>
public sealed record BatteryComparisonRow(long Id, string Name, double BatteryLevel, double RatedRangeMeters);

/// <summary>
/// The assembled fleet-battery payload — the list of resolved <see cref="BatteryComparisonRow"/> bars the web
/// component derives from <c>(allStates ?? []).filter(state !== null)</c>. The source fans out one
/// <c>GET /vehicles/{id}/state</c> read per roster vehicle and assembles this; it is cached as JSON by the
/// cache-then-network engine, so it must round-trip losslessly. A vehicle whose state read fails or yields no
/// usable state is simply absent (web parity: the catch returns null and the entry is filtered out).
/// </summary>
public sealed record BatteryComparisonData(IReadOnlyList<BatteryComparisonRow> Rows)
{
    /// <summary>The empty payload — the parse/assembly fallback (web's <c>?? []</c>).</summary>
    public static BatteryComparisonData Empty { get; } = new(Array.Empty<BatteryComparisonRow>());

    /// <summary>True when at least one battery bar is present (the web <c>bars.length === 0</c> gate, inverted).</summary>
    public bool HasData => Rows.Count > 0;

    /// <summary>
    /// Read the fleet roster (web <c>GET /vehicles</c>) into the identities the per-vehicle state reads scope
    /// to. Tolerant of a non-array body (empty) and of numeric-string ids; the name mirrors the web
    /// <c>vehicle.display_name || vehicle.vin</c> precedence (a blank name is left for the projection to
    /// resolve to a stable fallback).
    /// </summary>
    public static IReadOnlyList<VehicleRef> ParseVehicles(JsonElement vehiclesJson)
    {
        if (vehiclesJson.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<VehicleRef>();
        }

        var refs = new List<VehicleRef>(vehiclesJson.GetArrayLength());
        foreach (var element in vehiclesJson.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long id = GetLong(element, "id");
            if (id == 0)
            {
                id = GetLong(element, "vehicle_id");
            }

            refs.Add(new VehicleRef(id, ResolveName(element)));
        }

        return refs;
    }

    /// <summary>
    /// Parse one <c>GET /vehicles/{id}/state</c> response into a battery bar for <paramref name="vehicle"/>,
    /// or <c>null</c> when the response carries no usable state (web parity: <c>fetchVehicleState</c> returns
    /// a null state and the entry is filtered out). Mirrors the web shape precedence: a <c>state</c> object
    /// first, then a <c>position</c> / <c>vehicle</c> object (rated range falling back to ideal range), then
    /// top-level battery fields. Missing numeric fields coerce to zero, exactly like the web <c>?? 0</c>.
    /// </summary>
    public static BatteryComparisonRow? ParseStateRow(VehicleRef vehicle, JsonElement stateResponse)
    {
        ArgumentNullException.ThrowIfNull(vehicle);

        if (stateResponse.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (TryObject(stateResponse, "state", out var state))
        {
            return RowFrom(vehicle, state);
        }

        if (TryObject(stateResponse, "position", out var position))
        {
            return RowFrom(vehicle, position);
        }

        if (TryObject(stateResponse, "vehicle", out var vehicleObj))
        {
            return RowFrom(vehicle, vehicleObj);
        }

        if (stateResponse.TryGetProperty("battery_level", out _) || stateResponse.TryGetProperty("rated_range", out _))
        {
            return RowFrom(vehicle, stateResponse);
        }

        return null;
    }

    // web: state.battery_level ?? 0 ; state.rated_range ?? state.ideal_range ?? 0 (the fetchVehicleState shape).
    private static BatteryComparisonRow RowFrom(VehicleRef vehicle, JsonElement source)
    {
        double battery = GetDouble(source, "battery_level");
        double range = source.TryGetProperty("rated_range", out _)
            ? GetDouble(source, "rated_range")
            : GetDouble(source, "ideal_range");
        return new BatteryComparisonRow(vehicle.Id, vehicle.Name, battery, range);
    }

    // web: vehicle.display_name || vehicle.vin — the first truthy of the two (blank left for the projection).
    private static string ResolveName(JsonElement vehicle)
    {
        string displayName = GetString(vehicle, "display_name");
        if (!string.IsNullOrWhiteSpace(displayName))
        {
            return displayName.Trim();
        }

        return GetString(vehicle, "vin").Trim();
    }

    private static bool TryObject(JsonElement obj, string name, out JsonElement value)
    {
        if (obj.TryGetProperty(name, out value) && value.ValueKind == JsonValueKind.Object)
        {
            return true;
        }

        value = default;
        return false;
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

    // Web parity: a missing field, a null, or a non-finite value collapses to zero; numeric strings are
    // tolerated like the JSON the API can emit.
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
/// One fully projected battery bar — the native analogue of everything the web component derives inside its
/// <c>bars.map(…)</c>: the resolved <see cref="Name"/>, the clamped <see cref="BarFraction"/> (web
/// <c>width: {level}%</c>), the <see cref="PercentText"/> (web <c>{level}%</c>), the unit-formatted
/// <see cref="RangeText"/> (web <c>formatDistance(rated_range)</c>), the semantic colour <see cref="Tier"/>
/// (web <c>batteryColor(level)</c>), its token-backed <see cref="AccentBrushKey"/>, and a Narrator name.
/// Pure data so every value is asserted headlessly.
/// </summary>
public sealed record BatteryBar(
    long Id,
    string Name,
    double BarFraction,
    string PercentText,
    string RangeText,
    StatusKind Tier,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// The render-ready view of the fleet-battery surface — the native analogue of the JSX the web
/// <c>BatteryComparison</c> returns: the localized <see cref="Title"/> ("Fleet Battery Status"), the ordered
/// <see cref="Bars"/>, and the friendly <see cref="EmptyMessage"/> shown when the fleet has no battery rows.
/// Every string is localized and every numeric value is already converted to the user's display unit, so the
/// WinUI view is a thin renderer.
/// </summary>
public sealed record BatteryComparisonDisplay(
    string Title,
    bool HasRows,
    IReadOnlyList<BatteryBar> Bars,
    string EmptyMessage)
{
    /// <summary>The empty projection — the surface title plus the friendly empty message, no bars.</summary>
    public static BatteryComparisonDisplay CreateEmpty(ILocalizer localizer) =>
        BatteryComparisonProjection.Project(BatteryComparisonData.Empty, UnitPref.Metric, localizer);
}

/// <summary>
/// Pure projection from the assembled <see cref="BatteryComparisonData"/> to the display model — the native
/// port of the web <c>BatteryComparison</c> render body
/// (web/src/features/vehicles/components/BatteryComparison.tsx). Reproduces the web derivations exactly: the
/// bar colour is <c>batteryColor(level)</c> (<c>level &gt; 60</c> good, <c>&gt; 25</c> warning, else
/// critical, mapped to the equivalent <see cref="StatusKind"/> token brushes whose dark values are the same
/// <c>#10B981 / #F59E0B / #EF4444</c>); the percentage is <c>{level}%</c>; the range is
/// <c>formatDistance(rated_range)</c> in the user's unit; and the bar fill is <c>{level}%</c> clamped to a
/// valid 0..1 width. The distance conversion happens here and only here; every label resolves through the
/// i18n facade.
/// </summary>
public static class BatteryComparisonProjection
{
    /// <summary>Above this level the bar is the "good" tier (web <c>batteryColor</c> <c>level &gt; 60</c>).</summary>
    public const double GoodThreshold = 60;

    /// <summary>Above this level (but not above <see cref="GoodThreshold"/>) the bar is the "warning" tier (web <c>level &gt; 25</c>).</summary>
    public const double WarningThreshold = 25;

    private const double FullPercent = 100.0;
    private const string PercentSign = "%";

    /// <summary>
    /// Select the semantic colour tier for <paramref name="level"/>, mirroring the web
    /// <c>batteryColor(level)</c>: <c>level &gt; 60 ? good : level &gt; 25 ? warning : critical</c>. A
    /// non-finite level fails both comparisons and falls through to <see cref="StatusKind.Danger"/>.
    /// </summary>
    public static StatusKind Tier(double level) =>
        level > GoodThreshold ? StatusKind.Success
        : level > WarningThreshold ? StatusKind.Warning
        : StatusKind.Danger;

    /// <summary>Project <paramref name="data"/> for the user's <paramref name="units"/>, localized via <paramref name="localizer"/>.</summary>
    public static BatteryComparisonDisplay Project(BatteryComparisonData data, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var bars = new List<BatteryBar>(data.Rows.Count);
        for (int i = 0; i < data.Rows.Count; i++)
        {
            bars.Add(BuildBar(data.Rows[i], i, units, localizer));
        }

        return new BatteryComparisonDisplay(
            Title: localizer.GetString("vehicles.fleet.batteryStatus", "Fleet Battery Status"),
            HasRows: bars.Count > 0,
            Bars: bars,
            EmptyMessage: localizer.GetString("vehicles.batteryComparison.empty", "No vehicle battery data"));
    }

    private static BatteryBar BuildBar(BatteryComparisonRow row, int index, UnitPref units, ILocalizer localizer)
    {
        double level = double.IsFinite(row.BatteryLevel) ? row.BatteryLevel : 0;
        StatusKind tier = Tier(level);
        string name = ResolveName(row.Name, index, localizer);
        string percentText = NumberFormatting.Format(level, units.Locale, 0) + PercentSign;
        string rangeText = UnitFormatters.FormatDistance(row.RatedRangeMeters, units);
        string automationName = string.Format(
            CultureInfo.CurrentCulture,
            "{0}: {1}, {2}",
            name,
            percentText,
            rangeText);

        return new BatteryBar(
            Id: row.Id,
            Name: name,
            BarFraction: BarFractionOf(level),
            PercentText: percentText,
            RangeText: rangeText,
            Tier: tier,
            AccentBrushKey: StatusResources.AccentBrushKey(tier),
            AutomationName: automationName);
    }

    // Web parity: the inline bar width is `${level}%`; the parent panel clips overflow, so a >100 level fills
    // the track and a negative/non-finite level renders empty.
    private static double BarFractionOf(double level)
    {
        if (!double.IsFinite(level))
        {
            return 0;
        }

        return Math.Clamp(level / FullPercent, 0.0, 1.0);
    }

    // Web shows `display_name || vin`; a pathological row with neither gets a stable, unique fallback so the
    // bar's Narrator name and label are never blank.
    private static string ResolveName(string rawName, int index, ILocalizer localizer)
    {
        if (!string.IsNullOrWhiteSpace(rawName))
        {
            return rawName.Trim();
        }

        return string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("vehicles.batteryComparison.vehicleFallback", "Vehicle {0}"),
            index + 1);
    }
}

/// <summary>
/// Canonical metadata for the fleet-battery surface — the native mirror of the web component at
/// <c>web/src/features/vehicles/components/BatteryComparison.tsx</c>: the stable diagnostics slug, the
/// 30-second live-refresh cadence the web <c>useQuery</c> uses, and the localized name/description. UI-free so
/// the metadata is asserted in tests.
/// </summary>
public static class BatteryComparisonRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "battery-comparison";

    /// <summary>Surface category (the web vehicles feature).</summary>
    public const string Category = "vehicles";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BatteryComparison";

    /// <summary>Live refresh cadence in seconds (web <c>refetchInterval: 30_000</c>).</summary>
    public const int RefreshIntervalSeconds = 30;

    /// <summary>Localized surface display name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("vehicles.fleet.batteryStatus", "Fleet Battery Status");
    }

    /// <summary>Localized surface description.</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "vehicles.batteryComparison.description",
            "Compare the state of charge and rated range across every vehicle in the fleet");
    }
}

/// <summary>
/// PII-safe diagnostics for the fleet-battery surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle name, battery level or range —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class BatteryComparisonDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BatteryComparisonDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryComparison</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryComparisonRegistration.Slug}");
    }
}
