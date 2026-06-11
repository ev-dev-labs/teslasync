using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state for the <c>FleetSummary</c> feature view. The web source
/// (web/src/features/vehicles/components/FleetSummary.tsx) is a pure child of its parent page: it receives a
/// <c>vehicles</c> prop and fans out one <c>fetchVehicleState</c> read per vehicle, always rendering the four
/// stat tiles (zeros until the states resolve). The native surface binds its own cache-then-network vehicle
/// list (the web <c>useVehicles</c>) plus the per-vehicle state fan-out (the web <c>useQuery</c>), so it
/// reproduces every state the P2 contract requires: the skeleton while loading, a friendly empty state when no
/// vehicle exists, a retry surface on a hard failure, and a freshness chip (stale / offline) over the tiles
/// otherwise.
/// </summary>
public enum FleetSummaryState
{
    /// <summary>First load, no cached fleet — render skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh fleet resolved — render the four-tile grid.</summary>
    Loaded,

    /// <summary>No vehicles in the fleet — render the friendly empty state, never a blank box.</summary>
    Empty,

    /// <summary>The vehicle-list load failed with no cache — render the retry surface.</summary>
    Error,

    /// <summary>A cached fleet older than the freshness window is shown — stale chip over the tiles.</summary>
    Stale,

    /// <summary>The network failed but a cached fleet is still shown — offline chip over the tiles.</summary>
    Offline,
}

/// <summary>
/// The SI-canonical slice of one vehicle's live state the fleet rollup reads — the native mirror of the fields
/// the web <c>FleetSummary</c> touches on each resolved <c>VehicleState</c>: <c>battery_level</c> (a 0..100
/// state-of-charge percent), <c>rated_range</c> (held in SI metres, converted to the user's distance unit only
/// at the render boundary per ADR-004) and <c>is_charging</c>. Nullable metrics stay null when the source did
/// not report them so the aggregate coerces them to zero exactly like the web <c>?? 0</c> guards. Pure data —
/// no WinUI types — so the parse + aggregate are unit-tested without a UI host.
/// </summary>
/// <param name="BatteryLevel">State-of-charge percent (web <c>state.battery_level</c>); null reads as 0.</param>
/// <param name="RatedRangeMeters">Rated range in SI metres (web <c>state.rated_range</c>); null reads as 0.</param>
/// <param name="IsCharging">Whether the vehicle is charging (web <c>state.is_charging</c>).</param>
public sealed record FleetVehicleStateLite(double? BatteryLevel, double? RatedRangeMeters, bool IsCharging)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{id}/state</c> response into the rollup slice — the native port of the web
    /// <c>fetchVehicleState</c> normalisation: prefer the canonical <c>res.state</c> object when it carries a
    /// <c>vehicle_id</c>; otherwise fall back to the position snapshot (range / battery) plus the top-level
    /// charging flag; a body that carries neither a state object nor a vehicle/position resolves to
    /// <see langword="null"/> (the web <c>data?.state ?? null</c> entry that the fleet filter drops).
    /// </summary>
    public static FleetVehicleStateLite? FromStateResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // Web parity: `if (res.state && 'vehicle_id' in res.state) return { state: res.state }`.
        if (FleetSummaryJson.Object(root, "state") is { } canonical && FleetSummaryJson.Has(canonical, "vehicle_id"))
        {
            return FromStateObject(canonical);
        }

        var vehicle = FleetSummaryJson.Object(root, "vehicle");
        var position = FleetSummaryJson.Object(root, "position");
        if (vehicle is null && position is null)
        {
            // Web parity: `if (!v && !p) return { state: res.state }` — use a bare state object when present.
            return FleetSummaryJson.Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        // Web parity fallback: battery / range from the position snapshot, charging from the top-level flag.
        return new FleetVehicleStateLite(
            BatteryLevel: position is { } p ? FleetSummaryJson.Double(p, "battery_level") : null,
            RatedRangeMeters: position is { } pr
                ? FleetSummaryJson.Double(pr, "rated_range") ?? FleetSummaryJson.Double(pr, "ideal_range")
                : null,
            IsCharging: FleetSummaryJson.Bool(root, "is_charging"));
    }

    private static FleetVehicleStateLite FromStateObject(JsonElement state) => new(
        BatteryLevel: FleetSummaryJson.Double(state, "battery_level"),
        RatedRangeMeters: FleetSummaryJson.Double(state, "rated_range"),
        IsCharging: FleetSummaryJson.Bool(state, "is_charging"));
}

/// <summary>
/// The aggregated fleet rollup the four tiles read — the native mirror of the web <c>FleetSummary</c>
/// derivations over the resolved <c>states</c> array: <see cref="VehicleCount"/> is <c>vehicles.length</c>,
/// <see cref="OnlineCount"/> is <c>states.length</c> (the vehicles whose state read resolved),
/// <see cref="ChargingCount"/> is <c>states.filter(s =&gt; s.is_charging).length</c>,
/// <see cref="AvgBatteryPercent"/> is the mean <c>battery_level</c> (0 when no state resolved) and
/// <see cref="TotalRangeMeters"/> is the sum of <c>rated_range</c> in SI metres. Pure data so the rollup is
/// asserted headlessly.
/// </summary>
/// <param name="VehicleCount">Total vehicles in the fleet (web <c>vehicles.length</c>).</param>
/// <param name="OnlineCount">Vehicles whose state read resolved (web <c>states.length</c>).</param>
/// <param name="ChargingCount">Vehicles currently charging (web charging filter count).</param>
/// <param name="AvgBatteryPercent">Mean state-of-charge over resolved states, 0..100.</param>
/// <param name="TotalRangeMeters">Sum of rated range across resolved states, SI metres.</param>
public sealed record FleetSummaryReading(
    int VehicleCount,
    int OnlineCount,
    int ChargingCount,
    double AvgBatteryPercent,
    double TotalRangeMeters)
{
    /// <summary>The zero rollup (no vehicles / no resolved states).</summary>
    public static FleetSummaryReading Empty { get; } = new(0, 0, 0, 0, 0);

    /// <summary>
    /// Reduce the resolved per-vehicle states into the fleet rollup — the native port of the web
    /// <c>avgBattery</c> / <c>totalRangeMeters</c> / <c>chargingCount</c> / <c>onlineCount</c> derivations.
    /// </summary>
    public static FleetSummaryReading Aggregate(int vehicleCount, IReadOnlyList<FleetVehicleStateLite> states)
    {
        ArgumentNullException.ThrowIfNull(states);

        int online = states.Count;
        int charging = 0;
        double batterySum = 0;
        double rangeSum = 0;
        foreach (var state in states)
        {
            if (state.IsCharging)
            {
                charging++;
            }

            batterySum += state.BatteryLevel ?? 0;
            rangeSum += state.RatedRangeMeters ?? 0;
        }

        double avg = online > 0 ? batterySum / online : 0;
        return new FleetSummaryReading(Math.Max(0, vehicleCount), online, charging, avg, rangeSum);
    }
}

/// <summary>
/// One projected, display-ready stat tile consumed by the WinUI view — the native analogue of a web
/// <c>GlassPanel</c> stat card. Holds the localized <see cref="Label"/>, the resolved Segoe Fluent
/// <see cref="Glyph"/> standing in for the web Lucide icon, the accent <see cref="ColorKey"/> (a design-token
/// brush key, never a literal hex), the count-up <see cref="Value"/> target with its <see cref="Precision"/>
/// and unit <see cref="Suffix"/> (the web <c>AnimatedNumber</c>), the optional muted <see cref="TrailingText"/>
/// (the web "/ {onlineCount}" span) and the composed Narrator <see cref="AutomationName"/>. Pure data.
/// </summary>
/// <param name="Label">The localized tile label (web <c>t('fleet.*')</c>).</param>
/// <param name="Glyph">The Segoe Fluent glyph standing in for the web Lucide icon.</param>
/// <param name="ColorKey">The accent brush resource key (theme-aware token, never a literal hex).</param>
/// <param name="Value">The count-up target (web <c>AnimatedNumber value</c>).</param>
/// <param name="Precision">The count-up fraction digits (web <c>AnimatedNumber</c> default 0).</param>
/// <param name="Suffix">The unit suffix appended after the number (web <c>AnimatedNumber suffix</c>).</param>
/// <param name="TrailingText">The muted trailing text (web "/ {onlineCount}"), or null.</param>
/// <param name="AutomationName">The composed Narrator name (label + value).</param>
public sealed record FleetSummaryTile(
    string Label,
    string Glyph,
    string ColorKey,
    double Value,
    int Precision,
    string Suffix,
    string? TrailingText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the fleet summary for one rollup — the ordered <see cref="Tiles"/>
/// (the four always-present stat cards), the surface Narrator <see cref="RegionLabel"/>, the skeleton
/// <see cref="LoadingLabel"/>, the friendly <see cref="EmptyMessage"/> and the <see cref="HasData"/> gate
/// (whether the fleet has any vehicle). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Tiles">The ordered, formatted stat tiles (empty for the empty / loading states).</param>
/// <param name="RegionLabel">The Narrator group name for the surface.</param>
/// <param name="LoadingLabel">The Narrator announcement while the skeleton renders.</param>
/// <param name="EmptyMessage">The friendly empty-state message when the fleet has no vehicles.</param>
/// <param name="HasData">True when the fleet has at least one vehicle.</param>
public sealed record FleetSummaryDisplay(
    IReadOnlyList<FleetSummaryTile> Tiles,
    string RegionLabel,
    string LoadingLabel,
    string EmptyMessage,
    bool HasData)
{
    /// <summary>The empty display: no tiles, the friendly empty message, the resolved region / loading labels.</summary>
    public static FleetSummaryDisplay Empty(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new FleetSummaryDisplay(
            Array.Empty<FleetSummaryTile>(),
            FleetSummaryRegistration.RegionLabel(localizer),
            FleetSummaryRegistration.LoadingLabel(localizer),
            FleetSummaryRegistration.EmptyMessage(localizer),
            HasData: false);
    }
}

/// <summary>
/// Pure projection from a <see cref="FleetSummaryReading"/> to its <see cref="FleetSummaryDisplay"/> — the
/// native port of web/src/features/vehicles/components/FleetSummary.tsx. Reproduces the four tiles exactly: the
/// Vehicles count, the Avg-Battery percent (<c>Math.round(avgBattery)</c> with a "%" suffix), the Total-Range
/// tile (<c>Math.round(convertDistanceFromSI(totalRangeMeters, unit))</c> with the distance unit appended to
/// the label) and the Charging/Online tile (the charging count as the count-up value plus a muted "/ online"
/// trailing span). SI metres are converted to the user's distance unit only here (web <c>useUnits</c>) via the
/// WinUI-free <see cref="UnitConverters"/>; every number formats through the en-US
/// <see cref="ScalarFormatters"/> port and every label resolves through the i18n facade. No WinUI types —
/// unit-tested headless.
/// </summary>
public static class FleetSummaryProjection
{
    /// <summary>The "/ " lead-in on the Charging/Online tile's muted trailing span (web "/ {onlineCount}").</summary>
    private const string OnlineTrailingLeadIn = "/ ";

    /// <summary>Project <paramref name="reading"/> into a render-ready display using the user's distance unit.</summary>
    /// <param name="reading">The aggregated fleet rollup (the web derived values).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static FleetSummaryDisplay Project(FleetSummaryReading reading, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string distanceUnit = UnitLabels.Label(units.Distance);
        double avgBattery = Math.Round(reading.AvgBatteryPercent, MidpointRounding.AwayFromZero);
        double totalRange = Math.Round(
            UnitConverters.DistanceFromSi(reading.TotalRangeMeters, units.Distance),
            MidpointRounding.AwayFromZero);

        var tiles = new List<FleetSummaryTile>(4)
        {
            // web <Car className="text-cyan-400" /> + AnimatedNumber(vehicles.length) + "Vehicles".
            BuildTile(
                localizer.GetString(FleetSummaryRegistration.VehiclesKey, FleetSummaryRegistration.VehiclesFallback),
                FleetSummaryRegistration.VehiclesGlyph,
                FleetSummaryRegistration.VehiclesColor,
                reading.VehicleCount,
                suffix: string.Empty,
                trailing: null),

            // web <Battery className="text-green-500" /> + AnimatedNumber(round(avgBattery), suffix="%") + "Avg Battery".
            BuildTile(
                localizer.GetString(FleetSummaryRegistration.AvgBatteryKey, FleetSummaryRegistration.AvgBatteryFallback),
                FleetSummaryRegistration.AvgBatteryGlyph,
                FleetSummaryRegistration.AvgBatteryColor,
                avgBattery,
                suffix: FleetSummaryRegistration.PercentSuffix,
                trailing: null),

            // web <Gauge className="text-purple-400" /> + AnimatedNumber(round(convertDistanceFromSI(...))) + "Total Range {unit}".
            BuildTile(
                string.Create(
                    CultureInfo.CurrentCulture,
                    $"{localizer.GetString(FleetSummaryRegistration.TotalRangeKey, FleetSummaryRegistration.TotalRangeFallback)} {distanceUnit}"),
                FleetSummaryRegistration.TotalRangeGlyph,
                FleetSummaryRegistration.TotalRangeColor,
                totalRange,
                suffix: string.Empty,
                trailing: null),

            // web <Zap className="text-amber-400" /> + AnimatedNumber(chargingCount) + " / onlineCount" + "Charging / Online".
            BuildTile(
                localizer.GetString(FleetSummaryRegistration.ChargingOnlineKey, FleetSummaryRegistration.ChargingOnlineFallback),
                FleetSummaryRegistration.ChargingOnlineGlyph,
                FleetSummaryRegistration.ChargingOnlineColor,
                reading.ChargingCount,
                suffix: string.Empty,
                trailing: OnlineTrailingLeadIn + ScalarFormatters.FormatNumber(reading.OnlineCount)),
        };

        return new FleetSummaryDisplay(
            tiles,
            FleetSummaryRegistration.RegionLabel(localizer),
            FleetSummaryRegistration.LoadingLabel(localizer),
            FleetSummaryRegistration.EmptyMessage(localizer),
            HasData: reading.VehicleCount > 0);
    }

    private static FleetSummaryTile BuildTile(
        string label,
        string glyph,
        string colorKey,
        double value,
        string suffix,
        string? trailing)
    {
        string valueText = ScalarFormatters.FormatNumber(value) + suffix;
        string spoken = trailing is null
            ? string.Create(CultureInfo.CurrentCulture, $"{label}: {valueText}")
            : string.Create(CultureInfo.CurrentCulture, $"{label}: {valueText} {trailing}");

        return new FleetSummaryTile(
            label,
            glyph,
            colorKey,
            value,
            Precision: 0,
            suffix,
            trailing,
            AutomationName: spoken);
    }
}

/// <summary>
/// Parses the <c>GET /vehicles</c> list (the web <c>useVehicles</c> result) into the ordered vehicle ids the
/// state fan-out reads — the native analogue of <c>vehicles.map(v =&gt; v.id)</c>. Tolerant of numeric-string
/// ids and missing fields; a non-array body yields no ids. Pure data so it is unit-tested headlessly.
/// </summary>
public static class FleetSummaryVehicles
{
    /// <summary>Read the <c>id</c> of every vehicle in the list, preserving order.</summary>
    public static IReadOnlyList<long> ParseIds(JsonElement listJson)
    {
        if (listJson.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<long>();
        }

        var ids = new List<long>(listJson.GetArrayLength());
        foreach (var item in listJson.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object && FleetSummaryJson.Long(item, "id") is { } id)
            {
                ids.Add(id);
            }
        }

        return ids;
    }
}

/// <summary>
/// Static registration metadata for the <c>FleetSummary</c> surface — the diagnostics slug, the i18n key set
/// (the four keys lifted verbatim from the web source plus the Windows-only Narrator / empty / freshness keys),
/// the Segoe Fluent glyph + design-token accent mapping for each tile, the SI-canonical refresh interval and
/// the localized label helpers. Centralised so the view, the projection and the tests reference one source of
/// truth.
/// </summary>
public static class FleetSummaryRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "FleetSummary";

    /// <summary>The web <c>refetchInterval: 30_000</c> — the fleet states auto-refresh cadence, in ms.</summary>
    public const int RefreshIntervalMs = 30_000;

    /// <summary>Path-parameter name filling the <c>{vehicleID}</c> slot of the state endpoint template.</summary>
    public const string VehicleIdPathParam = "vehicleID";

    /// <summary>Trailing "%" suffix on the Avg-Battery tile (web <c>suffix="%"</c>).</summary>
    public const string PercentSuffix = "%";

    /// <summary>i18n key for the Vehicles tile (web <c>t('fleet.vehicles', 'Vehicles')</c>).</summary>
    public const string VehiclesKey = "fleet.vehicles";

    /// <summary>English fallback for the Vehicles tile — verbatim from the web source.</summary>
    public const string VehiclesFallback = "Vehicles";

    /// <summary>i18n key for the Avg-Battery tile (web <c>t('fleet.avgBattery', 'Avg Battery')</c>).</summary>
    public const string AvgBatteryKey = "fleet.avgBattery";

    /// <summary>English fallback for the Avg-Battery tile — verbatim from the web source.</summary>
    public const string AvgBatteryFallback = "Avg Battery";

    /// <summary>i18n key for the Total-Range tile (web <c>t('fleet.totalRange', 'Total Range')</c>).</summary>
    public const string TotalRangeKey = "fleet.totalRange";

    /// <summary>English fallback for the Total-Range tile — verbatim from the web source.</summary>
    public const string TotalRangeFallback = "Total Range";

    /// <summary>i18n key for the Charging/Online tile (web <c>t('fleet.chargingOnline', 'Charging / Online')</c>).</summary>
    public const string ChargingOnlineKey = "fleet.chargingOnline";

    /// <summary>English fallback for the Charging/Online tile — verbatim from the web source.</summary>
    public const string ChargingOnlineFallback = "Charging / Online";

    /// <summary>i18n key for the surface's Narrator group label (Windows accessibility minimum; no visible web text).</summary>
    public const string RegionLabelKey = "fleet.summaryRegion";

    /// <summary>English fallback for the surface's Narrator group label.</summary>
    public const string RegionLabelFallback = "Fleet summary";

    /// <summary>i18n key for the skeleton's Narrator announcement.</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for the skeleton's Narrator announcement.</summary>
    public const string LoadingFallback = "Loading";

    /// <summary>i18n key for the friendly empty state (no vehicles in the fleet).</summary>
    public const string EmptyKey = "fleet.summaryEmpty";

    /// <summary>English fallback for the friendly empty state.</summary>
    public const string EmptyFallback = "No vehicles in your fleet yet.";

    /// <summary>i18n key for the hard-failure surface message.</summary>
    public const string ErrorKey = "fleet.summaryError";

    /// <summary>English fallback for the hard-failure surface message.</summary>
    public const string ErrorFallback = "Couldn't load fleet summary";

    /// <summary>i18n key for the offline chip / message.</summary>
    public const string OfflineKey = "fleet.summaryOffline";

    /// <summary>English fallback for the offline chip / message.</summary>
    public const string OfflineFallback = "You're offline — showing the last cached fleet summary";

    /// <summary>Segoe Fluent "Car" glyph — web Lucide <c>Car</c> (Vehicles tile).</summary>
    public const string VehiclesGlyph = "\uE804";

    /// <summary>Segoe Fluent "Battery" glyph — web Lucide <c>Battery</c> (Avg Battery tile).</summary>
    public const string AvgBatteryGlyph = "\uE83F";

    /// <summary>Segoe Fluent "Speed" glyph — web Lucide <c>Gauge</c> (Total Range tile).</summary>
    public const string TotalRangeGlyph = "\uE9D9";

    /// <summary>Segoe Fluent "lightning" glyph — web Lucide <c>Zap</c> (Charging/Online tile).</summary>
    public const string ChargingOnlineGlyph = "\uE945";

    /// <summary>Accent brush key for Vehicles — web <c>text-cyan-400</c> (theme-aware cyan info token).</summary>
    public const string VehiclesColor = "TsColorInfoBrush";

    /// <summary>Accent brush key for Avg Battery — web <c>text-green-500</c> (battery green token).</summary>
    public const string AvgBatteryColor = "TsChartBatteryBrush";

    /// <summary>Accent brush key for Total Range — web <c>text-purple-400</c> (purple power token).</summary>
    public const string TotalRangeColor = "TsChartPowerBrush";

    /// <summary>Accent brush key for Charging/Online — web <c>text-amber-400</c> (amber energy token).</summary>
    public const string ChargingOnlineColor = "TsChartEnergyBrush";

    /// <summary>Resolve the surface's Narrator group label.</summary>
    public static string RegionLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(RegionLabelKey, RegionLabelFallback);
    }

    /// <summary>Resolve the skeleton's Narrator announcement.</summary>
    public static string LoadingLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LoadingKey, LoadingFallback);
    }

    /// <summary>Resolve the friendly empty-state message.</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyKey, EmptyFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>FleetSummary</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle count, state-of-charge, range
/// or charging value — so a diagnostics line can never leak a user's fleet. Thread-safe.
/// </summary>
public sealed class FleetSummaryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FleetSummaryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FleetSummary</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FleetSummaryRegistration.Slug}");
    }
}

/// <summary>
/// Tolerant <see cref="JsonElement"/> readers for the fleet rollup parse — numeric-string coercion, missing
/// fields read as null/false, and a truthy-number bool (mirrors the web fields arriving as either JSON numbers
/// or strings). Uniquely named so it never collides with a sibling surface's reader in the linked test
/// assembly.
/// </summary>
internal static class FleetSummaryJson
{
    public static bool Has(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out _);

    public static JsonElement? Object(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var v)
        && v.ValueKind == JsonValueKind.Object
            ? v
            : null;

    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
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

    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
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

    public static bool Bool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when v.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String => bool.TryParse(v.GetString(), out var b) && b,
            _ => false,
        };
    }
}
