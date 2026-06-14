using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="FleetComparePageViewModel"/> exposes — the native
/// union of the branches the web <c>FleetComparePage</c> composes
/// (web/src/features/analytics/pages/FleetComparePage.tsx, route <c>/vehicle-comparison</c>): the page-level
/// <c>loading</c> skeleton (web <c>PageContainer loading</c>), the focused single-vehicle empty surface (web
/// <c>vehicleList.length &lt; 2</c> gate that renders the <c>fleetCompare.singleVehicle.*</c> empty state),
/// the populated side-by-side comparison (<see cref="Content"/>), the retry surface on a hard error, and the
/// stale/offline freshness branches the shared cache-then-network engine emits. Every branch maps onto a
/// visible surface; none is ever hidden.
/// </summary>
public enum FleetCompareState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-page skeleton.</summary>
    Loading,

    /// <summary>A resolved fleet with at least two vehicles — render the comparison layout.</summary>
    Content,

    /// <summary>A resolved fleet with fewer than two vehicles — render the single-vehicle empty state.</summary>
    SingleVehicle,

    /// <summary>The first read failed with no cache — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — content plus an offline chip.</summary>
    Offline,
}

/// <summary>How a comparison metric ranks two values (web <c>WinnerSemantic</c>).</summary>
public enum FleetCompareWinnerSemantic
{
    /// <summary>The higher value wins (web <c>'higher'</c>).</summary>
    Higher,

    /// <summary>The lower value wins (web <c>'lower'</c>).</summary>
    Lower,

    /// <summary>Neither value wins — informational only (web <c>'neutral'</c>).</summary>
    Neutral,
}

/// <summary>
/// One vehicle from the fleet roster (web <c>GET /vehicles</c> row) reduced to the identity the comparison
/// surface needs: the database <see cref="Id"/>, the resolved <see cref="Name"/>
/// (web <c>display_name || vin</c>), and the <see cref="Model"/> / <see cref="Trim"/> / <see cref="State"/>
/// the status card header reads. Pure data so it is asserted headlessly and round-trips through the cache.
/// </summary>
public sealed record FleetCompareVehicleRef(long Id, string Name, string Model, string Trim, string State);

/// <summary>
/// One vehicle's live state slice (web <c>GET /vehicles/{id}/state</c> → <c>state</c>). All distances are SI
/// metres and temperatures SI Celsius exactly as the API delivers them; the unit conversion happens at
/// projection time. Nullable fields mirror the web <c>state?.field ?? null</c> reads so a missing reading
/// renders the em-dash rather than a fabricated zero.
/// </summary>
public sealed record FleetCompareVehicleState(
    double? BatteryLevel,
    double? RatedRangeMeters,
    double? InsideTempC,
    double? OutsideTempC,
    bool? IsLocked,
    bool SentryMode,
    string VehicleState);

/// <summary>
/// One vehicle's lifetime driving stats (web <c>GET /drives/stats</c>). Field names mirror the Go API's
/// snake_case JSON; distances are kilometres, speeds km/h and efficiency Wh/km exactly as the wire delivers
/// them (the SI restatement / unit conversion happens at projection time). Pure data.
/// </summary>
public sealed record FleetCompareStats(
    double TotalDrives,
    double TotalDistanceKm,
    double AvgEfficiencyWhKm,
    double AvgSpeedKmh,
    double TopSpeedKmh,
    double RegenRatio,
    double Co2SavedKg);

/// <summary>One vehicle's lifetime charging cost rollup (web <c>GET /analytics/tco</c>). Pure data.</summary>
public sealed record FleetCompareCost(double TotalChargingCost, double TotalWh, double TotalSessions);

/// <summary>
/// One monthly mileage bucket (web <c>GET /mileage/monthly</c> → <c>months[]</c>). The calendar key
/// (<c>year_month</c>, 'YYYY-MM'), the distance driven that month in kilometres (<c>total_km</c>) and the
/// drive count (<c>drive_count</c>) — the three fields the two comparison charts read. Pure data.
/// </summary>
public sealed record FleetCompareMonthlyBucket(string YearMonth, double TotalKm, double DriveCount);

/// <summary>
/// The assembled per-vehicle bundle the source fans out for one roster vehicle — the native analogue of the
/// web page's four per-vehicle queries (<c>useVehicleState</c> / <c>useDrivingStats</c> /
/// <c>useCostBreakdown</c> / <c>useMonthlyMileage</c>). Any slice whose read failed is left null (web parity:
/// the disabled/errored query yields <c>undefined</c> and the panel falls back to its em-dash). Pure data
/// so the whole snapshot round-trips losslessly through the cache-then-network engine.
/// </summary>
public sealed record FleetCompareVehicleBundle(
    long VehicleId,
    FleetCompareVehicleState? State,
    FleetCompareStats? Stats,
    FleetCompareCost? Cost,
    IReadOnlyList<FleetCompareMonthlyBucket> Monthly);

/// <summary>
/// The assembled fleet-comparison payload — the roster (web <c>useVehicles</c>) plus one
/// <see cref="FleetCompareVehicleBundle"/> per vehicle. The source fans out every read and assembles this; it
/// is cached as JSON by the cache-then-network engine, so it must round-trip losslessly. Vehicle selection is
/// a pure projection over this snapshot (no refetch on selection change), mirroring the web page where the
/// roster + per-vehicle queries are already resolved and the two <c>Select</c>s just pick which ids to render.
/// </summary>
public sealed record FleetCompareData(
    IReadOnlyList<FleetCompareVehicleRef> Vehicles,
    IReadOnlyList<FleetCompareVehicleBundle> Bundles)
{
    /// <summary>The all-empty payload — the parse / assembly fallback (web's <c>?? []</c>).</summary>
    public static FleetCompareData Empty { get; } =
        new(Array.Empty<FleetCompareVehicleRef>(), Array.Empty<FleetCompareVehicleBundle>());

    /// <summary>True when at least one vehicle is present (gates loading vs. a resolved snapshot).</summary>
    public bool HasData => Vehicles.Count > 0;

    /// <summary>True when the fleet has the two vehicles a side-by-side comparison needs (web <c>length &gt;= 2</c>).</summary>
    public bool HasComparison => Vehicles.Count >= 2;

    /// <summary>Resolve the bundle for <paramref name="vehicleId"/>, or null when absent.</summary>
    public FleetCompareVehicleBundle? BundleFor(long vehicleId)
    {
        foreach (var bundle in Bundles)
        {
            if (bundle.VehicleId == vehicleId)
            {
                return bundle;
            }
        }

        return null;
    }

    /// <summary>
    /// Read the fleet roster (web <c>GET /vehicles</c>) into the identities the per-vehicle reads scope to.
    /// Tolerant of a non-array body (empty) and of numeric-string ids; the name mirrors the web
    /// <c>vehicle.display_name || vehicle.vin</c> precedence.
    /// </summary>
    public static IReadOnlyList<FleetCompareVehicleRef> ParseVehicles(JsonElement vehiclesJson)
    {
        if (vehiclesJson.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<FleetCompareVehicleRef>();
        }

        var refs = new List<FleetCompareVehicleRef>(vehiclesJson.GetArrayLength());
        foreach (var element in vehiclesJson.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long id = FleetCompareJson.GetLong(element, "id");
            if (id == 0)
            {
                id = FleetCompareJson.GetLong(element, "vehicle_id");
            }

            refs.Add(new FleetCompareVehicleRef(
                id,
                ResolveRosterName(element),
                FleetCompareJson.GetString(element, "model"),
                FleetCompareJson.GetString(element, "trim_badging"),
                FleetCompareJson.GetString(element, "state")));
        }

        return refs;
    }

    /// <summary>
    /// Parse one <c>GET /vehicles/{id}/state</c> response into a state slice, or null when the response
    /// carries no usable state. Mirrors the web shape precedence: a <c>state</c> object first, then the
    /// top-level body (the <c>fetchVehicleState</c> fallback shape).
    /// </summary>
    public static FleetCompareVehicleState? ParseState(JsonElement stateResponse)
    {
        if (stateResponse.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        JsonElement source = stateResponse;
        if (stateResponse.TryGetProperty("state", out var nested) && nested.ValueKind == JsonValueKind.Object)
        {
            source = nested;
        }
        else if (!stateResponse.TryGetProperty("battery_level", out _) &&
                 !stateResponse.TryGetProperty("rated_range", out _))
        {
            return null;
        }

        return new FleetCompareVehicleState(
            BatteryLevel: FleetCompareJson.GetNullableDouble(source, "battery_level"),
            RatedRangeMeters: FleetCompareJson.GetNullableDouble(source, "rated_range"),
            InsideTempC: FleetCompareJson.GetNullableDouble(source, "inside_temp"),
            OutsideTempC: FleetCompareJson.GetNullableDouble(source, "outside_temp"),
            IsLocked: FleetCompareJson.GetNullableBool(source, "is_locked"),
            SentryMode: FleetCompareJson.GetBool(source, "sentry_mode"),
            VehicleState: FleetCompareJson.GetString(source, "state"));
    }

    /// <summary>Parse a <c>GET /drives/stats</c> response, or null when the body is not an object.</summary>
    public static FleetCompareStats? ParseStats(JsonElement statsJson)
    {
        if (statsJson.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new FleetCompareStats(
            TotalDrives: FleetCompareJson.GetDouble(statsJson, "total_drives"),
            TotalDistanceKm: FleetCompareJson.GetDouble(statsJson, "total_distance_km"),
            AvgEfficiencyWhKm: FleetCompareJson.GetDouble(statsJson, "avg_efficiency_wh_km"),
            AvgSpeedKmh: FleetCompareJson.GetDouble(statsJson, "avg_speed_kmh"),
            TopSpeedKmh: FleetCompareJson.GetDouble(statsJson, "top_speed_kmh"),
            RegenRatio: FleetCompareJson.GetDouble(statsJson, "regen_ratio"),
            Co2SavedKg: FleetCompareJson.GetDouble(statsJson, "co2_saved_kg"));
    }

    /// <summary>Parse a <c>GET /analytics/tco</c> response, or null when the body is not an object.</summary>
    public static FleetCompareCost? ParseCost(JsonElement costJson)
    {
        if (costJson.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new FleetCompareCost(
            TotalChargingCost: FleetCompareJson.GetDouble(costJson, "total_charging_cost"),
            TotalWh: FleetCompareJson.GetDouble(costJson, "total_wh"),
            TotalSessions: FleetCompareJson.GetDouble(costJson, "total_sessions"));
    }

    /// <summary>
    /// Parse the <c>GET /mileage/monthly</c> envelope (<c>{vehicle_id, months}</c>) into a tolerant list,
    /// preserving order. Mirrors the web hook's <c>select: (resp) =&gt; safeArray(resp?.months)</c>.
    /// </summary>
    public static IReadOnlyList<FleetCompareMonthlyBucket> ParseMonthly(JsonElement monthlyJson)
    {
        if (monthlyJson.ValueKind != JsonValueKind.Object ||
            !monthlyJson.TryGetProperty("months", out var months) ||
            months.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<FleetCompareMonthlyBucket>();
        }

        var list = new List<FleetCompareMonthlyBucket>(months.GetArrayLength());
        foreach (var item in months.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new FleetCompareMonthlyBucket(
                FleetCompareJson.GetString(item, "year_month"),
                FleetCompareJson.GetDouble(item, "total_km"),
                FleetCompareJson.GetDouble(item, "drive_count")));
        }

        return list;
    }

    // web: vehicle.display_name || vehicle.vin — the first truthy of the two (a blank name is left for the
    // projection to resolve to a stable fallback).
    private static string ResolveRosterName(JsonElement vehicle)
    {
        string displayName = FleetCompareJson.GetString(vehicle, "display_name");
        if (!string.IsNullOrWhiteSpace(displayName))
        {
            return displayName.Trim();
        }

        return FleetCompareJson.GetString(vehicle, "vin").Trim();
    }
}

/// <summary>Null-tolerant JSON readers shared by the fleet-comparison parsers (web <c>safe()</c> guards).</summary>
internal static class FleetCompareJson
{
    internal static long GetLong(JsonElement obj, string name)
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

    internal static string GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? string.Empty : string.Empty;

    internal static bool GetBool(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    internal static bool? GetNullableBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    // Web parity: safe(v) = Number.isFinite(v) ? v : 0. A missing field, null or non-finite collapses to zero;
    // numeric strings are tolerated like the JSON the API can emit.
    internal static double GetDouble(JsonElement obj, string name) => GetNullableDouble(obj, name) ?? 0;

    internal static double? GetNullableDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && double.IsFinite(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) => n,
            _ => null,
        };
    }
}

/// <summary>
/// One render-ready vehicle status card (web <c>VehicleStatusCard</c>): the header identity, the battery
/// bar, the rated range, the cabin/ambient temperature, the lock/sentry security row and the connection
/// status pill — all already localized and unit-formatted. <see cref="HasVehicle"/> false renders the
/// "select a vehicle" empty card. Pure data so the card is asserted headlessly.
/// </summary>
public sealed record FleetCompareStatusCard(
    bool HasVehicle,
    string Name,
    string SubLabel,
    bool IsOnline,
    bool HasBattery,
    double BatteryFraction,
    string BatteryText,
    StatusKind BatteryTier,
    string RangeText,
    string TemperatureText,
    bool HasState,
    bool IsLocked,
    string SecurityText,
    StatusKind SecurityTier,
    bool SentryOn,
    string StatusText,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// One lifetime comparison row (web comparison table row). Holds the localized metric label, the two
/// unit-formatted values and which side wins (so the view tints the winner emerald with a check), mirroring
/// the web <c>getWinner</c> / <c>winnerCell</c> derivation. Pure data.
/// </summary>
public sealed record FleetCompareRow(string Metric, string ValueA, string ValueB, bool IsWinnerA, bool IsWinnerB);

/// <summary>
/// One key-highlight stat card (web <c>StatCard</c> in the Key Highlights grid): the localized label, the
/// "A vs B" value, the optional unit suffix and the Segoe Fluent glyph. Pure data.
/// </summary>
public sealed record FleetCompareHighlight(string Label, string Value, string Unit, string Glyph);

/// <summary>One option in a vehicle <c>Select</c> (web <c>SelectOption</c>): the id, label and cross-disable flag.</summary>
public sealed record FleetCompareOption(long Id, string Label, bool Disabled);

/// <summary>
/// The fully projected, render-ready view of the comparison for one A/B selection — the native analogue of
/// everything the web page computes via <c>useMemo</c> before returning JSX: the two status cards, the merged
/// monthly distance line series and drives-per-month bar series, the lifetime comparison rows, the key
/// highlights and the two selector option lists. Every string is localized and every numeric value is already
/// converted to the user's display unit, so the WinUI view is a thin renderer.
/// </summary>
public sealed record FleetCompareDisplay(
    IReadOnlyList<FleetCompareOption> OptionsA,
    IReadOnlyList<FleetCompareOption> OptionsB,
    long? SelectedA,
    long? SelectedB,
    string NameA,
    string NameB,
    FleetCompareStatusCard CardA,
    FleetCompareStatusCard CardB,
    bool MonthlyHasData,
    IReadOnlyList<ChartSeries> MonthlySeries,
    bool DrivesHasData,
    IReadOnlyList<ChartSeries> DrivesSeries,
    IReadOnlyList<FleetCompareRow> Rows,
    IReadOnlyList<FleetCompareHighlight> Highlights);

/// <summary>
/// Pure projection from the assembled <see cref="FleetCompareData"/> and the current A/B selection to the
/// display model — the native port of the web <c>FleetComparePage</c> render body
/// (web/src/features/analytics/pages/FleetComparePage.tsx). It reproduces the web derivations exactly: the
/// per-vehicle status cards, the lifetime comparison table (<c>fromKm</c> / <c>fromKmh</c> /
/// <c>whPerKmToDisplay</c> conversions, <c>getWinner</c> semantics), the merged monthly distance line + drives
/// bar series, and the four key highlights. The distance/speed/efficiency conversions happen here and only
/// here; every label resolves through the i18n facade.
/// </summary>
public static class FleetCompareProjection
{
    /// <summary>1 mile = 1.609344 km (web <c>KM_PER_MILE</c>); Wh/km × this = Wh/mi.</summary>
    public const double KmPerMile = 1.609344;

    /// <summary>Metres per kilometre — restates the wire km fields to SI before conversion.</summary>
    public const double MetersPerKm = 1000.0;

    /// <summary>Seconds per hour — restates km/h to SI metres-per-second before conversion.</summary>
    public const double SecondsPerHour = 3600.0;

    /// <summary>Currency symbol used for the cost columns (web <c>currencySymbol</c> default).</summary>
    public const string CurrencySymbol = "$";

    /// <summary>Palette index for vehicle A's chart series (web <c>palette[0]</c>).</summary>
    public const int SeriesColorA = 0;

    /// <summary>Palette index for vehicle B's chart series (web <c>palette[1]</c>).</summary>
    public const int SeriesColorB = 1;

    private const double BatteryGoodThreshold = 50;
    private const double BatteryWarningThreshold = 20;
    private const string BatteryGlyph = "\uE83F";    // Segoe Fluent — Battery
    private const string EfficiencyGlyph = "\uE945"; // Segoe Fluent — Lightning
    private const string CostGlyph = "\uE1D6";       // Segoe Fluent — Currency
    private const string Co2Glyph = "\uE8C8";        // Segoe Fluent — leaf/eco

    /// <summary>
    /// Project <paramref name="data"/> for the <paramref name="selectedA"/> / <paramref name="selectedB"/>
    /// selection, using the user's <paramref name="units"/> and the <paramref name="localizer"/> for every
    /// label.
    /// </summary>
    public static FleetCompareDisplay Project(
        FleetCompareData data,
        long? selectedA,
        long? selectedB,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var vehicleA = FindVehicle(data, selectedA);
        var vehicleB = FindVehicle(data, selectedB);
        var bundleA = selectedA is { } a ? data.BundleFor(a) : null;
        var bundleB = selectedB is { } b ? data.BundleFor(b) : null;

        string nameA = vehicleA?.Name is { Length: > 0 } na ? na : localizer.GetString("comparison.vehicleA", "Vehicle A");
        string nameB = vehicleB?.Name is { Length: > 0 } nb ? nb : localizer.GetString("comparison.vehicleB", "Vehicle B");

        var monthly = BuildMonthly(bundleA, bundleB, nameA, nameB, units);
        var drives = BuildDrives(bundleA, bundleB, nameA, nameB);

        return new FleetCompareDisplay(
            OptionsA: BuildOptions(data, selectedB),
            OptionsB: BuildOptions(data, selectedA),
            SelectedA: selectedA,
            SelectedB: selectedB,
            NameA: nameA,
            NameB: nameB,
            CardA: BuildStatusCard(vehicleA, bundleA?.State, units, localizer),
            CardB: BuildStatusCard(vehicleB, bundleB?.State, units, localizer),
            MonthlyHasData: monthly.Count > 0,
            MonthlySeries: monthly.Series,
            DrivesHasData: drives.Count > 0,
            DrivesSeries: drives.Series,
            Rows: BuildRows(bundleA, bundleB, units, localizer),
            Highlights: BuildHighlights(bundleA, bundleB, units, localizer));
    }

    /// <summary>Select the semantic battery tier (web colour ladder: &gt;50 green, &gt;20 amber, else red).</summary>
    public static StatusKind BatteryTier(double level) =>
        level > BatteryGoodThreshold ? StatusKind.Success
        : level > BatteryWarningThreshold ? StatusKind.Warning
        : StatusKind.Danger;

    /// <summary>
    /// Resolve which side wins for <paramref name="semantic"/> (web <c>getWinner</c>): neutral or equal is a
    /// tie; higher wins the larger value; lower wins the smaller.
    /// </summary>
    public static (bool WinnerA, bool WinnerB) Winner(double rawA, double rawB, FleetCompareWinnerSemantic semantic)
    {
        if (semantic == FleetCompareWinnerSemantic.Neutral || rawA == rawB)
        {
            return (false, false);
        }

        bool aWins = semantic == FleetCompareWinnerSemantic.Higher ? rawA > rawB : rawA < rawB;
        return (aWins, !aWins);
    }

    /// <summary>The efficiency unit label (web <c>distance==='mi' ? 'Wh/mi' : 'Wh/km'</c>).</summary>
    public static string EfficiencyUnit(UnitPref units, ILocalizer localizer) =>
        units.Distance == DistanceUnit.Mi
            ? localizer.GetString("comparison.effUnitMi", "Wh/mi")
            : localizer.GetString("comparison.effUnitKm", "Wh/km");

    private static FleetCompareVehicleRef? FindVehicle(FleetCompareData data, long? id)
    {
        if (id is not { } vid)
        {
            return null;
        }

        foreach (var vehicle in data.Vehicles)
        {
            if (vehicle.Id == vid)
            {
                return vehicle;
            }
        }

        return null;
    }

    private static List<FleetCompareOption> BuildOptions(FleetCompareData data, long? disabledId)
    {
        var options = new List<FleetCompareOption>(data.Vehicles.Count);
        foreach (var vehicle in data.Vehicles)
        {
            string label = vehicle.Name is { Length: > 0 } n ? n : string.Create(CultureInfo.InvariantCulture, $"#{vehicle.Id}");
            options.Add(new FleetCompareOption(vehicle.Id, label, disabledId == vehicle.Id));
        }

        return options;
    }

    private static FleetCompareStatusCard BuildStatusCard(
        FleetCompareVehicleRef? vehicle,
        FleetCompareVehicleState? state,
        UnitPref units,
        ILocalizer localizer)
    {
        string dash = units.EmptyDisplay ?? UnitFormatters.DefaultEmptyDisplay;

        if (vehicle is null)
        {
            return new FleetCompareStatusCard(
                HasVehicle: false,
                Name: string.Empty,
                SubLabel: string.Empty,
                IsOnline: false,
                HasBattery: false,
                BatteryFraction: 0,
                BatteryText: dash,
                BatteryTier: StatusKind.Neutral,
                RangeText: dash,
                TemperatureText: dash,
                HasState: false,
                IsLocked: false,
                SecurityText: dash,
                SecurityTier: StatusKind.Neutral,
                SentryOn: false,
                StatusText: dash,
                EmptyMessage: localizer.GetString("comparison.selectVehicle", "Select a vehicle"),
                AutomationName: localizer.GetString("comparison.selectVehicle", "Select a vehicle"));
        }

        bool isOnline = string.Equals(vehicle.State, "online", StringComparison.OrdinalIgnoreCase);
        string subLabel = string.IsNullOrWhiteSpace(vehicle.Trim)
            ? vehicle.Model
            : string.Format(CultureInfo.CurrentCulture, "{0} \u00B7 {1}", vehicle.Model, vehicle.Trim).Trim();

        double? battery = state?.BatteryLevel;
        bool hasBattery = battery is { } bl && double.IsFinite(bl);
        string batteryText = hasBattery ? ScalarFormatters.FormatPercentage(battery, 0) : dash;
        StatusKind batteryTier = hasBattery ? BatteryTier(battery!.Value) : StatusKind.Neutral;
        double batteryFraction = hasBattery ? Math.Clamp(battery!.Value / 100.0, 0, 1) : 0;

        string rangeText = state?.RatedRangeMeters is { } range
            ? UnitFormatters.FormatDistance(range, units)
            : dash;

        string temperatureText = BuildTemperature(state, units, dash);

        bool hasState = state is not null;
        bool isLocked = state?.IsLocked ?? false;
        string securityText = hasState
            ? (isLocked
                ? localizer.GetString("comparison.locked", "Locked")
                : localizer.GetString("comparison.unlocked", "Unlocked"))
            : dash;
        StatusKind securityTier = hasState ? (isLocked ? StatusKind.Success : StatusKind.Danger) : StatusKind.Neutral;

        string statusText = string.IsNullOrWhiteSpace(vehicle.State)
            ? localizer.GetString("comparison.unknown", "Unknown")
            : vehicle.State;

        string name = vehicle.Name is { Length: > 0 } n ? n : statusText;

        return new FleetCompareStatusCard(
            HasVehicle: true,
            Name: name,
            SubLabel: subLabel,
            IsOnline: isOnline,
            HasBattery: hasBattery,
            BatteryFraction: batteryFraction,
            BatteryText: batteryText,
            BatteryTier: batteryTier,
            RangeText: rangeText,
            TemperatureText: temperatureText,
            HasState: hasState,
            IsLocked: isLocked,
            SecurityText: securityText,
            SecurityTier: securityTier,
            SentryOn: state?.SentryMode ?? false,
            StatusText: statusText,
            EmptyMessage: string.Empty,
            AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", name, batteryText, statusText));
    }

    private static string BuildTemperature(FleetCompareVehicleState? state, UnitPref units, string dash)
    {
        if (state?.InsideTempC is not { } inside)
        {
            return dash;
        }

        string insideText = UnitFormatters.FormatTemperature(inside, units);
        if (state.OutsideTempC is { } outside)
        {
            return string.Format(
                CultureInfo.CurrentCulture,
                "{0} / {1}",
                insideText,
                UnitFormatters.FormatTemperature(outside, units));
        }

        return insideText;
    }

    private readonly record struct SeriesSet(IReadOnlyList<ChartSeries> Series, int Count);

    private static SeriesSet BuildMonthly(
        FleetCompareVehicleBundle? bundleA,
        FleetCompareVehicleBundle? bundleB,
        string nameA,
        string nameB,
        UnitPref units)
    {
        var months = MergeMonths(bundleA, bundleB);
        if (months.Count == 0)
        {
            return new SeriesSet(Array.Empty<ChartSeries>(), 0);
        }

        var pointsA = new ChartPoint[months.Count];
        var pointsB = new ChartPoint[months.Count];
        for (int i = 0; i < months.Count; i++)
        {
            var month = months[i];
            // Native parity with MonthlyMileageWidget: restate wire km to SI metres and convert at the boundary.
            double distA = UnitConverters.DistanceFromSi(month.DistA * MetersPerKm, units.Distance);
            double distB = UnitConverters.DistanceFromSi(month.DistB * MetersPerKm, units.Distance);
            pointsA[i] = new ChartPoint(i, distA, month.Month);
            pointsB[i] = new ChartPoint(i, distB, month.Month);
        }

        string unitLabel = UnitLabels.Label(units.Distance);
        var series = new ChartSeries[]
        {
            new(nameA, pointsA) { Kind = ChartSeriesKind.Line, ColorIndex = SeriesColorA, Unit = unitLabel },
            new(nameB, pointsB) { Kind = ChartSeriesKind.Line, ColorIndex = SeriesColorB, Unit = unitLabel },
        };
        return new SeriesSet(series, months.Count);
    }

    private static SeriesSet BuildDrives(
        FleetCompareVehicleBundle? bundleA,
        FleetCompareVehicleBundle? bundleB,
        string nameA,
        string nameB)
    {
        var months = MergeMonths(bundleA, bundleB);
        if (months.Count == 0)
        {
            return new SeriesSet(Array.Empty<ChartSeries>(), 0);
        }

        var pointsA = new ChartPoint[months.Count];
        var pointsB = new ChartPoint[months.Count];
        for (int i = 0; i < months.Count; i++)
        {
            pointsA[i] = new ChartPoint(i, months[i].DrivesA, months[i].Month);
            pointsB[i] = new ChartPoint(i, months[i].DrivesB, months[i].Month);
        }

        var series = new ChartSeries[]
        {
            new(nameA, pointsA) { Kind = ChartSeriesKind.Bar, ColorIndex = SeriesColorA },
            new(nameB, pointsB) { Kind = ChartSeriesKind.Bar, ColorIndex = SeriesColorB },
        };
        return new SeriesSet(series, months.Count);
    }

    private readonly record struct MergedMonth(string Month, double DistA, double DistB, double DrivesA, double DrivesB);

    // Web parity: monthlyChartData merges the two month lists by year_month, aligns missing months to zero and
    // sorts ascending by the calendar key.
    private static List<MergedMonth> MergeMonths(FleetCompareVehicleBundle? bundleA, FleetCompareVehicleBundle? bundleB)
    {
        var map = new Dictionary<string, (double DistA, double DistB, double DrivesA, double DrivesB)>(StringComparer.Ordinal);

        if (bundleA is not null)
        {
            foreach (var month in bundleA.Monthly)
            {
                var key = month.YearMonth ?? string.Empty;
                var existing = map.TryGetValue(key, out var cur) ? cur : default;
                existing.DistA = month.TotalKm;
                existing.DrivesA = month.DriveCount;
                map[key] = existing;
            }
        }

        if (bundleB is not null)
        {
            foreach (var month in bundleB.Monthly)
            {
                var key = month.YearMonth ?? string.Empty;
                var existing = map.TryGetValue(key, out var cur) ? cur : default;
                existing.DistB = month.TotalKm;
                existing.DrivesB = month.DriveCount;
                map[key] = existing;
            }
        }

        var merged = new List<MergedMonth>(map.Count);
        foreach (var entry in map)
        {
            merged.Add(new MergedMonth(entry.Key, entry.Value.DistA, entry.Value.DistB, entry.Value.DrivesA, entry.Value.DrivesB));
        }

        merged.Sort(static (x, y) => string.CompareOrdinal(x.Month, y.Month));
        return merged;
    }

    private static List<FleetCompareRow> BuildRows(
        FleetCompareVehicleBundle? bundleA,
        FleetCompareVehicleBundle? bundleB,
        UnitPref units,
        ILocalizer localizer)
    {
        var statsA = bundleA?.Stats;
        var statsB = bundleB?.Stats;
        var costA = bundleA?.Cost;
        var costB = bundleB?.Cost;
        var energyPref = units with { Energy = EnergyUnit.Kwh };

        string distanceUnit = UnitLabels.Label(units.Distance);
        string speedUnit = UnitLabels.Label(units.Speed);
        string efficiencyUnit = EfficiencyUnit(units, localizer);

        double FromKm(double km) => UnitConverters.DistanceFromSi(km * MetersPerKm, units.Distance);
        double FromKmh(double kmh) => UnitConverters.SpeedFromSi(kmh * MetersPerKm / SecondsPerHour, units.Speed);
        double WhPerKm(double whPerKm) => units.Distance == DistanceUnit.Mi ? whPerKm * KmPerMile : whPerKm;

        var rows = new List<FleetCompareRow>(10)
        {
            Row(
                localizer.GetString("comparison.totalDrives", "Total Drives"),
                ScalarFormatters.FormatNumber(statsA?.TotalDrives ?? 0),
                ScalarFormatters.FormatNumber(statsB?.TotalDrives ?? 0),
                statsA?.TotalDrives ?? 0, statsB?.TotalDrives ?? 0, FleetCompareWinnerSemantic.Higher),
            Row(
                localizer.GetString("comparison.totalDistance", "Total Distance"),
                WithUnit(ScalarFormatters.FormatNumber(FromKm(statsA?.TotalDistanceKm ?? 0)), distanceUnit),
                WithUnit(ScalarFormatters.FormatNumber(FromKm(statsB?.TotalDistanceKm ?? 0)), distanceUnit),
                statsA?.TotalDistanceKm ?? 0, statsB?.TotalDistanceKm ?? 0, FleetCompareWinnerSemantic.Higher),
            Row(
                localizer.GetString("comparison.avgEfficiency", "Avg Efficiency"),
                WithUnit(ScalarFormatters.FormatNumber(WhPerKm(statsA?.AvgEfficiencyWhKm ?? 0)), efficiencyUnit),
                WithUnit(ScalarFormatters.FormatNumber(WhPerKm(statsB?.AvgEfficiencyWhKm ?? 0)), efficiencyUnit),
                statsA?.AvgEfficiencyWhKm ?? 0, statsB?.AvgEfficiencyWhKm ?? 0, FleetCompareWinnerSemantic.Lower),
            Row(
                localizer.GetString("comparison.avgSpeed", "Avg Speed"),
                WithUnit(ScalarFormatters.FormatNumber(FromKmh(statsA?.AvgSpeedKmh ?? 0)), speedUnit),
                WithUnit(ScalarFormatters.FormatNumber(FromKmh(statsB?.AvgSpeedKmh ?? 0)), speedUnit),
                statsA?.AvgSpeedKmh ?? 0, statsB?.AvgSpeedKmh ?? 0, FleetCompareWinnerSemantic.Neutral),
            Row(
                localizer.GetString("comparison.topSpeed", "Top Speed"),
                WithUnit(ScalarFormatters.FormatNumber(FromKmh(statsA?.TopSpeedKmh ?? 0)), speedUnit),
                WithUnit(ScalarFormatters.FormatNumber(FromKmh(statsB?.TopSpeedKmh ?? 0)), speedUnit),
                statsA?.TopSpeedKmh ?? 0, statsB?.TopSpeedKmh ?? 0, FleetCompareWinnerSemantic.Neutral),
            Row(
                localizer.GetString("comparison.regenRatio", "Regen Ratio"),
                ScalarFormatters.FormatPercentage((statsA?.RegenRatio ?? 0) * 100, 1),
                ScalarFormatters.FormatPercentage((statsB?.RegenRatio ?? 0) * 100, 1),
                statsA?.RegenRatio ?? 0, statsB?.RegenRatio ?? 0, FleetCompareWinnerSemantic.Higher),
            Row(
                localizer.GetString("comparison.co2Saved", "CO\u2082 Saved"),
                WithUnit(ScalarFormatters.FormatNumber(statsA?.Co2SavedKg ?? 0), "kg"),
                WithUnit(ScalarFormatters.FormatNumber(statsB?.Co2SavedKg ?? 0), "kg"),
                statsA?.Co2SavedKg ?? 0, statsB?.Co2SavedKg ?? 0, FleetCompareWinnerSemantic.Higher),
            Row(
                localizer.GetString("comparison.chargingCost", "Charging Cost"),
                ScalarFormatters.FormatCurrency(costA?.TotalChargingCost ?? 0, CurrencySymbol, 0),
                ScalarFormatters.FormatCurrency(costB?.TotalChargingCost ?? 0, CurrencySymbol, 0),
                costA?.TotalChargingCost ?? 0, costB?.TotalChargingCost ?? 0, FleetCompareWinnerSemantic.Lower),
            Row(
                localizer.GetString("comparison.totalEnergy", "Total Energy"),
                UnitFormatters.FormatEnergy(costA?.TotalWh ?? 0, energyPref),
                UnitFormatters.FormatEnergy(costB?.TotalWh ?? 0, energyPref),
                costA?.TotalWh ?? 0, costB?.TotalWh ?? 0, FleetCompareWinnerSemantic.Neutral),
            Row(
                localizer.GetString("comparison.chargeSessions", "Charge Sessions"),
                ScalarFormatters.FormatNumber(costA?.TotalSessions ?? 0),
                ScalarFormatters.FormatNumber(costB?.TotalSessions ?? 0),
                costA?.TotalSessions ?? 0, costB?.TotalSessions ?? 0, FleetCompareWinnerSemantic.Neutral),
        };

        return rows;
    }

    private static FleetCompareRow Row(
        string metric,
        string valueA,
        string valueB,
        double rawA,
        double rawB,
        FleetCompareWinnerSemantic semantic)
    {
        var (winnerA, winnerB) = Winner(rawA, rawB, semantic);
        return new FleetCompareRow(metric, valueA, valueB, winnerA, winnerB);
    }

    private static string WithUnit(string value, string unit) =>
        string.Format(CultureInfo.CurrentCulture, "{0} {1}", value, unit);

    private static List<FleetCompareHighlight> BuildHighlights(
        FleetCompareVehicleBundle? bundleA,
        FleetCompareVehicleBundle? bundleB,
        UnitPref units,
        ILocalizer localizer)
    {
        string dash = units.EmptyDisplay ?? UnitFormatters.DefaultEmptyDisplay;
        string efficiencyUnit = EfficiencyUnit(units, localizer);
        double WhPerKm(double whPerKm) => units.Distance == DistanceUnit.Mi ? whPerKm * KmPerMile : whPerKm;

        string batteryA = bundleA?.State?.BatteryLevel is { } ba ? ScalarFormatters.FormatPercentage(ba, 0) : dash;
        string batteryB = bundleB?.State?.BatteryLevel is { } bb ? ScalarFormatters.FormatPercentage(bb, 0) : dash;

        string Vs(string a, string b) => string.Format(CultureInfo.CurrentCulture, "{0} vs {1}", a, b);

        return new List<FleetCompareHighlight>(4)
        {
            new(
                localizer.GetString("comparison.batteryDiff", "Battery Level"),
                Vs(batteryA, batteryB),
                string.Empty,
                BatteryGlyph),
            new(
                localizer.GetString("comparison.efficiencyDiff", "Avg Efficiency"),
                Vs(
                    ScalarFormatters.FormatNumber(WhPerKm(bundleA?.Stats?.AvgEfficiencyWhKm ?? 0)),
                    ScalarFormatters.FormatNumber(WhPerKm(bundleB?.Stats?.AvgEfficiencyWhKm ?? 0))),
                efficiencyUnit,
                EfficiencyGlyph),
            new(
                localizer.GetString("comparison.costDiff", "Charging Cost"),
                Vs(
                    ScalarFormatters.FormatCurrency(bundleA?.Cost?.TotalChargingCost ?? 0, CurrencySymbol, 0),
                    ScalarFormatters.FormatCurrency(bundleB?.Cost?.TotalChargingCost ?? 0, CurrencySymbol, 0)),
                string.Empty,
                CostGlyph),
            new(
                localizer.GetString("comparison.co2Diff", "CO\u2082 Saved"),
                Vs(
                    ScalarFormatters.FormatNumber(bundleA?.Stats?.Co2SavedKg ?? 0),
                    ScalarFormatters.FormatNumber(bundleB?.Stats?.Co2SavedKg ?? 0)),
                "kg",
                Co2Glyph),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the fleet-comparison page — the native mirror of the web page at
/// <c>web/src/features/analytics/pages/FleetComparePage.tsx</c> (route <c>/vehicle-comparison</c>, nav name
/// <c>FleetCompare</c>): the route name the shell registers the page under, the diagnostics slug, the
/// navigation targets and the localized chrome strings. UI-free so the metadata is asserted in tests.
/// </summary>
public static class FleetCompareRegistration
{
    /// <summary>The route name the shell page factory registers this page under (RouteTable <c>FleetCompare</c>).</summary>
    public static string RouteName => "FleetCompare";

    /// <summary>The route path the page deep-links from (web <c>/vehicle-comparison</c>).</summary>
    public static string RoutePath => "vehicle-comparison";

    /// <summary>The diagnostics slug emitted with the <c>view.opened</c> event.</summary>
    public static string Slug => "FleetComparePage";

    /// <summary>The route the single-vehicle empty-state CTA navigates to (web <c>navigate('/vehicles')</c>).</summary>
    public static string VehiclesRoute => "vehicles";

    /// <summary>The route the disambiguation banner CTA opens (web <c>Link to="/period-compare"</c>).</summary>
    public static string PeriodCompareRoute => "period-compare";

    /// <summary>The localized page title (web <c>comparison.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("comparison.title", "Fleet Comparison");

    /// <summary>The localized page subtitle (web <c>comparison.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Require(localizer).GetString("comparison.subtitle", "Compare two vehicles side by side");

    /// <summary>The localized single-vehicle empty-state heading (web <c>fleetCompare.singleVehicle.title</c>).</summary>
    public static string SingleVehicleTitle(ILocalizer localizer) =>
        Require(localizer).GetString("fleetCompare.singleVehicle.title", "Add a second vehicle to compare");

    /// <summary>The localized single-vehicle empty-state body (web <c>fleetCompare.singleVehicle.body</c>).</summary>
    public static string SingleVehicleBody(ILocalizer localizer) =>
        Require(localizer).GetString(
            "fleetCompare.singleVehicle.body",
            "Fleet comparison shows two vehicles side-by-side. You currently have one vehicle in TeslaSync.");

    /// <summary>The localized single-vehicle empty-state CTA (web <c>fleetCompare.singleVehicle.cta</c>).</summary>
    public static string SingleVehicleCta(ILocalizer localizer) =>
        Require(localizer).GetString("fleetCompare.singleVehicle.cta", "Manage vehicles");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the fleet-comparison page (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle name, metric or location — so
/// a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class FleetCompareDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FleetCompareDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FleetComparePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FleetCompareRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;FleetCompareData&gt;</c> emissions through, preserving the
/// cache-then-network status so the view-model keeps content visible while refreshing. The engine already
/// fetches the typed snapshot, so this is an identity pass that exists as the single seam the view-model and
/// the tests bind to (kept symmetric with the sibling W7 pages' result mappers).
/// </summary>
public static class FleetCompareResultMapper
{
    /// <summary>Return <paramref name="raw"/> unchanged, asserting it is non-null.</summary>
    public static RepositoryResult<FleetCompareData> Map(RepositoryResult<FleetCompareData> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return raw;
    }
}
