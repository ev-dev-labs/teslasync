using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>The generated OpenAPI operation ids the Trip Planner page consumes (driving / trip-planner domain).</summary>
internal static class TripPlannerOperations
{
    /// <summary>POST <c>/trip-planner/plan</c> (web <c>usePlanTrip</c>).</summary>
    public const string Plan = "post_api_v1_trip_planner_plan";

    /// <summary>POST <c>/vehicles/{vehicleID}/command</c> (web <c>handleSendToCar</c> navigation_request).</summary>
    public const string Command = "post_api_v1_vehicles_vehicleID_command";

    /// <summary>The path-parameter name the command endpoint declares.</summary>
    public const string VehiclePathParam = "vehicleID";
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the trip-plan payload behind the Trip Planner page.
/// Every getter returns a nullable / fallback rather than throwing so a partial or schema-drifted plan from
/// <c>POST /trip-planner/plan</c> never aborts the parse (web parity: the React page reads each field off a
/// typed-but-tolerant <c>TripPlan</c>). Kept free of WinUI types so the parse is unit-tested without a UI host.
/// </summary>
internal static class TripPlannerJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The double value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(
                prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The boolean value of <paramref name="name"/>, or null when absent / not a JSON boolean.</summary>
    public static bool? GetBool(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? prop.GetBoolean()
            : null;

    /// <summary>The object child <paramref name="name"/>, or the <c>undefined</c> element when absent.</summary>
    public static JsonElement GetObject(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.Object
            ? prop
            : default;
}

/// <summary>
/// A place chosen on the planned trip — the native analogue of the web <c>TripLocation</c> (<c>{ lat, lng, name }</c>)
/// the form owns for the origin and destination. Pure data — no WinUI types.
/// </summary>
/// <param name="Lat">Latitude in degrees (web <c>lat</c>).</param>
/// <param name="Lng">Longitude in degrees (web <c>lng</c>).</param>
/// <param name="Name">The resolved place label (web <c>name</c>).</param>
public sealed record TripLocationModel(double Lat, double Lng, string Name);

/// <summary>
/// The optimizer request the page POSTs — the native mirror of the web <c>TripPlanRequest</c> body assembled in
/// <c>handlePlan</c>. The charge-limit SOC and preference flags are fixed exactly as the web source fixes them
/// (<c>charge_limit_soc: 90</c>, <c>include_weather: true</c>, <c>prefer_superchargers: true</c>). Pure data.
/// </summary>
/// <param name="VehicleId">The scoped vehicle id (web <c>vehicle_id</c>).</param>
/// <param name="Origin">The trip origin (web <c>origin</c>).</param>
/// <param name="Destination">The trip destination (web <c>destination</c>).</param>
/// <param name="CurrentSoc">The current state of charge, percent (web <c>current_soc</c>).</param>
/// <param name="ChargeLimitSoc">The charge limit SOC, percent (web fixed <c>charge_limit_soc: 90</c>).</param>
/// <param name="MinArrivalSoc">The minimum arrival SOC, percent (web <c>min_arrival_soc</c>).</param>
/// <param name="SpeedFactor">The driving-speed factor (web <c>preferences.speed_factor</c>).</param>
public sealed record TripPlanRequestModel(
    long VehicleId,
    TripLocationModel Origin,
    TripLocationModel Destination,
    int CurrentSoc,
    int ChargeLimitSoc,
    int MinArrivalSoc,
    double SpeedFactor);

/// <summary>
/// The planned route summary — the native mirror of the web <c>TripPlanRoute</c> (web/src/types/driving.ts). Every
/// numeric stays SI-canonical exactly as the API and web keep it (metres, seconds, watt-hours, decimal cost), so the
/// projection converts only at its own display boundary. Parsing is null-tolerant. Pure data.
/// </summary>
public sealed record TripRouteSnapshot(
    double TotalDistanceM,
    double TotalDurationS,
    double DrivingDurationS,
    double ChargingDurationS,
    double TotalEnergyWh,
    double EstimatedCost,
    double ArrivalSoc,
    bool Feasible,
    bool IsEstimate)
{
    /// <summary>An all-zero, feasible, non-estimate route used as the tolerant fallback.</summary>
    public static TripRouteSnapshot Empty { get; } = new(0, 0, 0, 0, 0, 0, 0, true, false);

    /// <summary>Project the <c>route</c> JSON object into a tolerant snapshot.</summary>
    public static TripRouteSnapshot FromJson(JsonElement route)
    {
        if (route.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new TripRouteSnapshot(
            TripPlannerJson.GetDouble(route, "total_distance_m") ?? 0,
            TripPlannerJson.GetDouble(route, "total_duration_s") ?? 0,
            TripPlannerJson.GetDouble(route, "driving_duration_s") ?? 0,
            TripPlannerJson.GetDouble(route, "charging_duration_s") ?? 0,
            TripPlannerJson.GetDouble(route, "total_energy_wh") ?? 0,
            TripPlannerJson.GetDouble(route, "estimated_cost") ?? 0,
            TripPlannerJson.GetDouble(route, "arrival_soc") ?? 0,
            TripPlannerJson.GetBool(route, "feasible") ?? true,
            TripPlannerJson.GetBool(route, "is_estimate") ?? false);
    }
}

/// <summary>
/// The weather-impact note — the native mirror of the web <c>TripWeatherImpact</c>. <see cref="HasImpact"/> mirrors
/// the web render gate (<c>weather.efficiency_factor !== 1.0</c>). Parsing is null-tolerant. Pure data.
/// </summary>
public sealed record TripWeatherSnapshot(double? AvgTempC, double EfficiencyFactor, string Note)
{
    /// <summary>A neutral, no-impact weather snapshot used as the tolerant fallback.</summary>
    public static TripWeatherSnapshot Empty { get; } = new(null, 1.0, string.Empty);

    /// <summary>True when the weather panel shows (web <c>weather.efficiency_factor !== 1.0</c>).</summary>
    public bool HasImpact => Math.Abs(EfficiencyFactor - 1.0) > double.Epsilon;

    /// <summary>True when the efficiency-factor caption shows (web <c>weather.avg_temp_c != null</c>).</summary>
    public bool HasTemperature => AvgTempC.HasValue;

    /// <summary>Project the <c>weather_impact</c> JSON object into a tolerant snapshot.</summary>
    public static TripWeatherSnapshot FromJson(JsonElement weather)
    {
        if (weather.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new TripWeatherSnapshot(
            TripPlannerJson.GetDouble(weather, "avg_temp_c"),
            TripPlannerJson.GetDouble(weather, "efficiency_factor") ?? 1.0,
            TripPlannerJson.GetString(weather, "note") ?? string.Empty);
    }
}

/// <summary>
/// The fully parsed result of one <c>POST /trip-planner/plan</c> — the native analogue of the web <c>TripPlan</c>
/// the page stores in <c>plan</c>. It projects the wire payload into the typed shapes each sibling surface consumes:
/// the <see cref="Route"/> + <see cref="Weather"/> summaries the page renders directly, the SI
/// <see cref="SocCurve"/> + <see cref="ChargeStopSocs"/> the <c>SOCRouteChart</c> binds, the
/// <see cref="MapLegs"/> + <see cref="MapStops"/> the <c>TripPlannerMap</c> draws, and the lossless
/// <see cref="RawPlan"/> the <c>TripLegList</c> reads through its own tolerant <c>FromJson</c>. Parsing never throws.
/// Free of WinUI types so the parse is unit-tested headlessly.
/// </summary>
public sealed class TripPlanSnapshot
{
    private TripPlanSnapshot(
        TripRouteSnapshot route,
        TripWeatherSnapshot weather,
        IReadOnlyList<RouteSocPoint> socCurve,
        IReadOnlyList<RouteChargeStop> chargeStopSocs,
        IReadOnlyList<TripLegInput> mapLegs,
        IReadOnlyList<TripChargeStopInput> mapStops,
        JsonElement rawPlan)
    {
        Route = route;
        Weather = weather;
        SocCurve = socCurve;
        ChargeStopSocs = chargeStopSocs;
        MapLegs = mapLegs;
        MapStops = mapStops;
        RawPlan = rawPlan;
    }

    /// <summary>The planned route summary (web <c>plan.route</c>).</summary>
    public TripRouteSnapshot Route { get; }

    /// <summary>The weather-impact note (web <c>plan.weather_impact</c>).</summary>
    public TripWeatherSnapshot Weather { get; }

    /// <summary>The planned SOC samples for the chart (web <c>plan.soc_curve</c>).</summary>
    public IReadOnlyList<RouteSocPoint> SocCurve { get; }

    /// <summary>The charge-stop arrival SOCs the chart marks (web <c>chargeStops[].charge_from_soc</c>).</summary>
    public IReadOnlyList<RouteChargeStop> ChargeStopSocs { get; }

    /// <summary>The route legs the map polyline is drawn from (web <c>plan.legs</c>).</summary>
    public IReadOnlyList<TripLegInput> MapLegs { get; }

    /// <summary>The charge stops the map marks (web <c>plan.charge_stops</c>).</summary>
    public IReadOnlyList<TripChargeStopInput> MapStops { get; }

    /// <summary>The lossless plan JSON the <c>TripLegList</c> reads through its own tolerant parser.</summary>
    public JsonElement RawPlan { get; }

    /// <summary>Project one trip-plan JSON object into the typed snapshot every sibling surface consumes.</summary>
    public static TripPlanSnapshot FromJson(JsonElement plan)
    {
        var route = TripRouteSnapshot.FromJson(TripPlannerJson.GetObject(plan, "route"));
        var weather = TripWeatherSnapshot.FromJson(TripPlannerJson.GetObject(plan, "weather_impact"));

        var socCurve = ReadArray(plan, "soc_curve", static p => new RouteSocPoint(
            TripPlannerJson.GetDouble(p, "distance_m") ?? 0,
            TripPlannerJson.GetDouble(p, "soc") ?? 0));

        var chargeStopSocs = ReadArray(plan, "charge_stops", static s => new RouteChargeStop(
            TripPlannerJson.GetDouble(s, "charge_from_soc") ?? 0));

        var mapLegs = ReadArray(plan, "legs", static leg => new TripLegInput(
            ReadLocation(leg, "from"),
            ReadLocation(leg, "to")));

        var mapStops = ReadArray(plan, "charge_stops", static stop => new TripChargeStopInput(
            TripPlannerJson.GetString(stop, "name") ?? string.Empty,
            ReadLocation(stop, "location"),
            TripPlannerJson.GetDouble(stop, "charge_from_soc") ?? 0,
            TripPlannerJson.GetDouble(stop, "charge_to_soc") ?? 0,
            TripPlannerJson.GetDouble(stop, "charge_duration_s") ?? 0));

        return new TripPlanSnapshot(route, weather, socCurve, chargeStopSocs, mapLegs, mapStops, plan.Clone());
    }

    private static TripLocationInput ReadLocation(JsonElement obj, string name)
    {
        var loc = TripPlannerJson.GetObject(obj, name);
        return new TripLocationInput(
            TripPlannerJson.GetDouble(loc, "lat") ?? 0,
            TripPlannerJson.GetDouble(loc, "lng") ?? 0,
            TripPlannerJson.GetString(loc, "name"));
    }

    private static List<T> ReadArray<T>(JsonElement obj, string name, Func<JsonElement, T> parse)
    {
        if (obj.ValueKind != JsonValueKind.Object ||
            !obj.TryGetProperty(name, out var array) ||
            array.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var items = new List<T>(array.GetArrayLength());
        foreach (var element in array.EnumerateArray())
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
                items.Add(parse(element));
            }
        }

        return items;
    }
}

/// <summary>The mutually-exclusive plan-mutation state the page renders (the manifest's loading / error / success).</summary>
public enum TripPlannerPlanState
{
    /// <summary>No plan has been requested yet — the form is shown, the result regions are absent.</summary>
    Idle,

    /// <summary>The plan mutation is in flight (web <c>planMutation.isPending</c>) — the action shows a spinner.</summary>
    Planning,

    /// <summary>The plan mutation failed (web <c>planMutation.isError</c>) — the error banner shows.</summary>
    Error,

    /// <summary>A plan resolved (web <c>plan</c> truthiness) — every result region renders.</summary>
    Success,
}

/// <summary>One driving-speed option for the form select — the native mirror of one web <c>speedOptions</c> entry.</summary>
/// <param name="Value">The factor as the option value (web <c>'0.8'</c> … <c>'1.2'</c>).</param>
/// <param name="Label">The localized option label.</param>
public sealed record TripSpeedOption(string Value, string Label)
{
    /// <summary>The factor parsed back to a double (web <c>Number(e.target.value)</c>).</summary>
    public double Factor => double.TryParse(Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var f) ? f : 1.0;
}

/// <summary>One of the six trip-summary stat tiles — the native mirror of a web <c>StatCard</c> in the summary grid.</summary>
/// <param name="Key">The stable tile identity (distance / totalTime / drivingTime / chargingTime / energy / cost).</param>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted headline value (em dash before a plan resolves).</param>
/// <param name="Glyph">The decorative Segoe Fluent glyph standing in for the web Lucide icon.</param>
/// <param name="AutomationName">The composed Narrator name for the tile.</param>
public sealed record TripStat(string Key, string Label, string Value, string Glyph, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Trip Planner page for one plan result + form context — the native
/// analogue of what the web page composes from its hooks. Every visible string is resolved here (the page header,
/// the eight panels, the six stat tiles, the disclaimer, the feasibility and error banners and the weather note) so
/// the WinUI view is a thin renderer and every branch and string key is asserted headlessly. Pure data.
/// </summary>
public sealed record TripPlannerDisplay
{
    /// <summary>The localized page title (web <c>tripPlanner.title</c>).</summary>
    public required string Title { get; init; }

    /// <summary>The localized page subtitle (web <c>tripPlanner.subtitle</c>).</summary>
    public required string Subtitle { get; init; }

    /// <summary>The composed Narrator/document name for the page surface.</summary>
    public required string AutomationName { get; init; }

    // ── GlassPanel1 — Plan Your Trip form ───────────────────────────────────────────────────────────
    /// <summary>The form panel title (web <c>tripPlanner.form.title</c>).</summary>
    public required string FormTitle { get; init; }

    /// <summary>The origin field label (web <c>tripPlanner.form.from</c>).</summary>
    public required string FromLabel { get; init; }

    /// <summary>The destination field label (web <c>tripPlanner.form.to</c>).</summary>
    public required string ToLabel { get; init; }

    /// <summary>The origin field prompt text (web <c>tripPlanner.form.origin</c>).</summary>
    public required string OriginPrompt { get; init; }

    /// <summary>The destination field prompt text (web <c>tripPlanner.form.destination</c>).</summary>
    public required string DestinationPrompt { get; init; }

    /// <summary>The current-SOC slider label (web <c>tripPlanner.form.currentSOC</c>).</summary>
    public required string CurrentSocLabel { get; init; }

    /// <summary>The minimum-arrival-SOC slider label (web <c>tripPlanner.form.minArrival</c>).</summary>
    public required string MinArrivalLabel { get; init; }

    /// <summary>The driving-speed select label (web <c>tripPlanner.form.drivingSpeed</c>).</summary>
    public required string DrivingSpeedLabel { get; init; }

    /// <summary>The plan-action label when idle (web <c>tripPlanner.form.planTrip</c>).</summary>
    public required string PlanTripText { get; init; }

    /// <summary>The plan-action label while planning (web <c>tripPlanner.form.planning</c>).</summary>
    public required string PlanningText { get; init; }

    /// <summary>The plan-action label for the current state (planning ? planning : plan-trip).</summary>
    public required string PlanButtonText { get; init; }

    /// <summary>The send-to-car action label (web <c>tripPlanner.form.sendToCar</c>).</summary>
    public required string SendToCarText { get; init; }

    /// <summary>The vehicle-battery caption (web <c>tripPlanner.form.vehicleBattery</c>, interpolated).</summary>
    public required string VehicleBatteryText { get; init; }

    /// <summary>True when the vehicle reports a battery level (web <c>currentVehicle?.battery_level != null</c>).</summary>
    public required bool HasVehicleBattery { get; init; }

    /// <summary>The plan-error banner copy (web <c>tripPlanner.form.error</c>).</summary>
    public required string PlanErrorText { get; init; }

    /// <summary>True when the plan-error banner shows (web <c>planMutation.isError</c>).</summary>
    public required bool ShowPlanError { get; init; }

    /// <summary>The four driving-speed options (web <c>speedOptions</c>).</summary>
    public required IReadOnlyList<TripSpeedOption> SpeedOptions { get; init; }

    // ── Estimate disclaimer ─────────────────────────────────────────────────────────────────────────
    /// <summary>The estimate disclaimer copy (web <c>tripPlanner.disclaimer</c>).</summary>
    public required string DisclaimerText { get; init; }

    /// <summary>True when the disclaimer shows (web <c>route?.is_estimate</c>).</summary>
    public required bool ShowDisclaimer { get; init; }

    // ── Distance / Total-Time / Driving / Charging / Energy / Est-Cost ──────────────────────────────
    /// <summary>The six trip-summary stat tiles, always present (labels resolved even before a plan).</summary>
    public required IReadOnlyList<TripStat> Stats { get; init; }

    /// <summary>True when the summary grid shows (web <c>route</c> truthiness).</summary>
    public required bool ShowStats { get; init; }

    // ── Feasibility warning ─────────────────────────────────────────────────────────────────────────
    /// <summary>The not-feasible banner copy (web <c>tripPlanner.notFeasible</c>).</summary>
    public required string NotFeasibleText { get; init; }

    /// <summary>True when the feasibility warning shows (web <c>route &amp;&amp; !route.feasible</c>).</summary>
    public required bool ShowFeasibilityWarning { get; init; }

    // ── GlassPanel8 — Weather Impact ────────────────────────────────────────────────────────────────
    /// <summary>The weather panel title (web <c>tripPlanner.weather.title</c>).</summary>
    public required string WeatherTitle { get; init; }

    /// <summary>The weather note from the API (web <c>weather.note</c>).</summary>
    public required string WeatherNote { get; init; }

    /// <summary>The efficiency-factor caption (web <c>tripPlanner.weather.factor</c>, interpolated).</summary>
    public required string WeatherFactorText { get; init; }

    /// <summary>True when the efficiency-factor caption shows (web <c>weather.avg_temp_c != null</c>).</summary>
    public required bool ShowWeatherFactor { get; init; }

    /// <summary>True when the weather panel shows (web <c>weather &amp;&amp; efficiency_factor !== 1.0</c>).</summary>
    public required bool ShowWeather { get; init; }
}

/// <summary>
/// Pure projection from a plan result + form/vehicle context to the render-ready <see cref="TripPlannerDisplay"/> —
/// the native analogue of the web page's render body. It resolves every required i18n key unconditionally (so each
/// is asserted even when its branch is hidden), applies the SI converters at the display boundary (distance, energy,
/// currency, the composite hours/minutes duration), and mirrors the web's exact branch gates. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class TripPlannerProjection
{
    private const string Dash = "\u2014";

    // Decorative Segoe Fluent glyphs standing in for the web Lucide icons (hidden from Narrator in the view).
    internal const string DistanceGlyph = "\uE8AD";   // MapDirections (web Route)
    internal const string TotalTimeGlyph = "\uE823";  // clock-ish (web Clock)
    internal const string DrivingGlyph = "\uE804";    // navigation (web Navigation)
    internal const string ChargingGlyph = "\uE945";   // lightning (web Zap)
    internal const string EnergyGlyph = "\uE83E";     // battery (web Battery)
    internal const string CostGlyph = "\uE825";       // money (web DollarSign)

    /// <summary>Project a (possibly null) plan result and form/vehicle context into the render-ready display.</summary>
    /// <param name="result">The resolved plan, or null before one is requested.</param>
    /// <param name="vehicleBatteryLevel">The scoped vehicle's battery percent, or null when unknown.</param>
    /// <param name="isPlanning">True while the plan mutation is in flight.</param>
    /// <param name="isError">True when the last plan mutation failed.</param>
    /// <param name="units">The active display-unit preference (web <c>useUnits</c>).</param>
    /// <param name="currencySymbol">The active currency symbol (web <c>useFormatting</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static TripPlannerDisplay Project(
        TripPlanSnapshot? result,
        double? vehicleBatteryLevel,
        bool isPlanning,
        bool isError,
        UnitPref units,
        string currencySymbol,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;

        string title = localizer.GetString("tripPlanner.title", "Trip Planner");
        string subtitle = localizer.GetString(
            "tripPlanner.subtitle", "Plan your route with range estimation and charging stops");

        string planTrip = localizer.GetString("tripPlanner.form.planTrip", "Plan Trip");
        string planning = localizer.GetString("tripPlanner.form.planning", "Planning...");

        // The vehicle-battery caption resolves its key unconditionally (the view gates only its visibility).
        string batteryTemplate = localizer.GetString("tripPlanner.form.vehicleBattery", "Vehicle at {{level}}%");
        string batteryLevelText = vehicleBatteryLevel is { } level
            ? ((int)Math.Round(level, MidpointRounding.AwayFromZero)).ToString(CultureInfo.CurrentCulture)
            : "0";
        string vehicleBattery = Interpolate(batteryTemplate, "level", batteryLevelText);

        // The free-cost label resolves unconditionally so the key is asserted even when the cost is non-zero.
        string freeLabel = localizer.GetString("common.free", "Free");

        var route = result?.Route;
        var stats = BuildStats(route, units, symbol, freeLabel, localizer);

        var weather = result?.Weather ?? TripWeatherSnapshot.Empty;
        string factorTemplate = localizer.GetString("tripPlanner.weather.factor", "Efficiency factor: {{factor}}\u00D7");
        string factorText = Interpolate(
            factorTemplate,
            "factor",
            weather.EfficiencyFactor.ToString("0.00", CultureInfo.CurrentCulture));

        return new TripPlannerDisplay
        {
            Title = title,
            Subtitle = subtitle,
            AutomationName = title,

            FormTitle = localizer.GetString("tripPlanner.form.title", "Plan Your Trip"),
            FromLabel = localizer.GetString("tripPlanner.form.from", "From"),
            ToLabel = localizer.GetString("tripPlanner.form.to", "To"),
            OriginPrompt = localizer.GetString("tripPlanner.form.origin", "Enter starting location..."),
            DestinationPrompt = localizer.GetString("tripPlanner.form.destination", "Enter destination..."),
            CurrentSocLabel = localizer.GetString("tripPlanner.form.currentSOC", "Current SOC"),
            MinArrivalLabel = localizer.GetString("tripPlanner.form.minArrival", "Min Arrival SOC"),
            DrivingSpeedLabel = localizer.GetString("tripPlanner.form.drivingSpeed", "Driving Speed"),
            PlanTripText = planTrip,
            PlanningText = planning,
            PlanButtonText = isPlanning ? planning : planTrip,
            SendToCarText = localizer.GetString("tripPlanner.form.sendToCar", "Send to Car"),
            VehicleBatteryText = vehicleBattery,
            HasVehicleBattery = vehicleBatteryLevel.HasValue,
            PlanErrorText = localizer.GetString(
                "tripPlanner.form.error", "Failed to compute trip plan. Please try again."),
            ShowPlanError = isError,
            SpeedOptions = BuildSpeedOptions(localizer),

            DisclaimerText = localizer.GetString(
                "tripPlanner.disclaimer",
                "This is an estimate based on straight-line distance (\u00D71.3 driving factor) and your vehicle's "
                + "historical efficiency. Actual results may vary due to route geometry, traffic, elevation, and conditions."),
            ShowDisclaimer = route?.IsEstimate == true,

            Stats = stats,
            ShowStats = route is not null,

            NotFeasibleText = localizer.GetString(
                "tripPlanner.notFeasible",
                "This trip may not be feasible with the current battery level and available charging options. "
                + "Consider starting with a higher SOC or adjusting your preferences."),
            ShowFeasibilityWarning = route is not null && !route.Feasible,

            WeatherTitle = localizer.GetString("tripPlanner.weather.title", "Weather Impact"),
            WeatherNote = weather.Note,
            WeatherFactorText = factorText,
            ShowWeatherFactor = weather.HasTemperature,
            ShowWeather = result is not null && weather.HasImpact,
        };
    }

    /// <summary>Format an SI-seconds duration as the web's composite "{h}h {m}m" / "{m}m" label.</summary>
    internal static string FormatHoursMinutes(double seconds)
    {
        double minutes = seconds / 60.0;
        int h = (int)Math.Floor(minutes / 60.0);
        int m = (int)Math.Round(minutes % 60.0, MidpointRounding.AwayFromZero);
        return h == 0
            ? string.Create(CultureInfo.CurrentCulture, $"{m}m")
            : string.Create(CultureInfo.CurrentCulture, $"{h}h {m}m");
    }

    private static IReadOnlyList<TripSpeedOption> BuildSpeedOptions(ILocalizer localizer) =>
    [
        new TripSpeedOption("0.8", localizer.GetString("tripPlanner.speed.relaxed", "Relaxed (\u221220%)")),
        new TripSpeedOption("1.0", localizer.GetString("tripPlanner.speed.normal", "Normal")),
        new TripSpeedOption("1.1", localizer.GetString("tripPlanner.speed.brisk", "Brisk (+10%)")),
        new TripSpeedOption("1.2", localizer.GetString("tripPlanner.speed.fast", "Fast (+20%)")),
    ];

    private static IReadOnlyList<TripStat> BuildStats(
        TripRouteSnapshot? route, UnitPref units, string symbol, string freeLabel, ILocalizer localizer)
    {
        string distanceValue = route is null ? Dash : UnitFormatters.FormatDistance(route.TotalDistanceM, units, 0);
        string totalTimeValue = route is null ? Dash : FormatHoursMinutes(route.TotalDurationS);
        string drivingValue = route is null ? Dash : FormatHoursMinutes(route.DrivingDurationS);
        string chargingValue = route is null
            ? Dash
            : route.ChargingDurationS > 0 ? FormatHoursMinutes(route.ChargingDurationS) : Dash;
        string energyValue = route is null ? Dash : UnitFormatters.FormatEnergy(route.TotalEnergyWh, units, 1);
        string costValue = route is null
            ? Dash
            : route.EstimatedCost > 0 ? ScalarFormatters.FormatCurrency(route.EstimatedCost, symbol) : freeLabel;

        return
        [
            Stat("distance", localizer.GetString("tripPlanner.stats.distance", "Distance"), distanceValue, DistanceGlyph),
            Stat("totalTime", localizer.GetString("tripPlanner.stats.totalTime", "Total Time"), totalTimeValue, TotalTimeGlyph),
            Stat("drivingTime", localizer.GetString("tripPlanner.stats.drivingTime", "Driving"), drivingValue, DrivingGlyph),
            Stat("chargingTime", localizer.GetString("tripPlanner.stats.chargingTime", "Charging"), chargingValue, ChargingGlyph),
            Stat("energy", localizer.GetString("tripPlanner.stats.energy", "Energy"), energyValue, EnergyGlyph),
            Stat("cost", localizer.GetString("tripPlanner.stats.cost", "Est. Cost"), costValue, CostGlyph),
        ];
    }

    private static TripStat Stat(string key, string label, string value, string glyph) =>
        new(key, label, value, glyph, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));

    private static string Interpolate(string template, string token, string value) =>
        template
            .Replace("{{" + token + "}}", value, StringComparison.Ordinal)
            .Replace("{" + token + "}", value, StringComparison.Ordinal)
            .Replace("{0}", value, StringComparison.Ordinal);
}

/// <summary>
/// Canonical metadata for the Trip Planner page — the native mirror of the web route <c>/trip-planner</c> (nav name
/// <c>TripPlanner</c>). The shell page factory registers the surface under <see cref="RouteName"/>; the title and
/// subtitle resolve through the i18n facade with the web key names. The fixed request constants (the charge-limit
/// SOC and the form defaults) mirror the web source's literals.
/// </summary>
public static class TripPlannerRegistration
{
    /// <summary>The navigation route name the shell page factory registers this surface under.</summary>
    public const string RouteName = "TripPlanner";

    /// <summary>The deep-link route slug (web route <c>/trip-planner</c>).</summary>
    public const string Route = "trip-planner";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "TripPlannerPage";

    /// <summary>The fixed charge-limit SOC the request carries (web <c>charge_limit_soc: 90</c>).</summary>
    public const int ChargeLimitSoc = 90;

    /// <summary>The initial current-SOC the slider opens at (web <c>useState(80)</c>).</summary>
    public const int DefaultCurrentSoc = 80;

    /// <summary>The initial minimum-arrival SOC the slider opens at (web <c>useState(20)</c>).</summary>
    public const int DefaultMinArrivalSoc = 20;

    /// <summary>The initial driving-speed factor (web <c>useState(1.0)</c>).</summary>
    public const double DefaultSpeedFactor = 1.0;

    /// <summary>The localized page title (web <c>tripPlanner.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("tripPlanner.title", "Trip Planner");
    }

    /// <summary>The localized page subtitle (web <c>tripPlanner.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("tripPlanner.subtitle", "Plan your route with range estimation and charging stops");
    }
}

/// <summary>
/// PII-safe diagnostics for the Trip Planner page. Records only the operational <c>view.opened</c> event with the
/// surface slug — never an origin, destination, coordinate, SOC or VIN — so a diagnostics line can never leak where
/// a user is travelling. Thread-safe.
/// </summary>
public sealed class TripPlannerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public TripPlannerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface has been opened (test-observable; carries no fleet data).</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TripPlannerPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TripPlannerRegistration.Slug}");
    }
}

/// <summary>
/// The plan-trip mutation port — the native analogue of the web <c>usePlanTrip</c> hook
/// (<c>POST /trip-planner/plan</c>).
/// </summary>
public interface IPlanTripClient
{
    /// <summary>Run the planner for <paramref name="request"/> and return the parsed plan.</summary>
    Task<TripPlanSnapshot> PlanAsync(TripPlanRequestModel request, CancellationToken cancellationToken = default);
}

/// <summary>
/// The send-to-car command port — the native analogue of the web <c>handleSendToCar</c> call
/// (<c>POST /vehicles/{vehicleID}/command</c> with a <c>navigation_request</c>).
/// </summary>
public interface ISendToCarClient
{
    /// <summary>Send a navigation request to the vehicle for <paramref name="lat"/> / <paramref name="lng"/>.</summary>
    Task SendNavigationAsync(long vehicleId, double lat, double lng, CancellationToken cancellationToken = default);
}

/// <summary>The default no-op plan-trip client — used by the parameterless page until a real client is wired.</summary>
public sealed class NoopPlanTripClient : IPlanTripClient
{
    /// <summary>The shared singleton instance.</summary>
    public static NoopPlanTripClient Instance { get; } = new();

    private NoopPlanTripClient()
    {
    }

    /// <inheritdoc />
    public Task<TripPlanSnapshot> PlanAsync(TripPlanRequestModel request, CancellationToken cancellationToken = default) =>
        Task.FromException<TripPlanSnapshot>(new InvalidOperationException("No plan-trip client is configured."));
}

/// <summary>The default no-op send-to-car client — swallows the request exactly as the web's try/catch does.</summary>
public sealed class NoopSendToCarClient : ISendToCarClient
{
    /// <summary>The shared singleton instance.</summary>
    public static NoopSendToCarClient Instance { get; } = new();

    private NoopSendToCarClient()
    {
    }

    /// <inheritdoc />
    public Task SendNavigationAsync(long vehicleId, double lat, double lng, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}

/// <summary>The default no-vehicle source — resolves no scoped vehicle (the parameterless page's vehicle feed).</summary>
public sealed class TripPlannerNoVehicleSource : IWidgetVehicleSource
{
    /// <summary>The shared singleton instance.</summary>
    public static TripPlannerNoVehicleSource Instance { get; } = new();

    private TripPlannerNoVehicleSource()
    {
    }

    /// <inheritdoc />
    public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<WidgetVehicleSnapshot?>(null);

    /// <inheritdoc />
    public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
        Task.FromResult<WidgetVehicleSnapshot?>(null);
}

/// <summary>
/// The default empty geocode source for the two <see cref="AddressInput"/> fields — yields a single empty result so
/// the parameterless page's address autocomplete renders its resting "no matches" surface rather than performing
/// HTTP. The full page wires the repository-backed <see cref="AddressGeocodeSource"/> instead.
/// </summary>
public sealed class EmptyTripGeocodeSource : IAddressGeocodeSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyTripGeocodeSource Instance { get; } = new();

    private EmptyTripGeocodeSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeocodeSuggestion>>> StreamAsync(
        string query,
        int limit,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<IReadOnlyList<GeocodeSuggestion>>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}
