using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>TripLegList</c> surface — the native union of the branches the
/// web component renders (web/src/features/driving/components/TripLegList.tsx). The web source is a pure
/// presentational component: it takes already-resolved <c>legs</c> / <c>chargeStops</c> props and performs no
/// fetching, so — exactly like the sibling <c>DriveTimeline</c> / <c>DriveHighlightSlide</c> ports — the parent
/// Trip Planner page owns the query lifecycle (it renders the page-level skeleton / <c>QueryError</c> / stale /
/// offline chrome once before mounting this list with already-resolved legs). There is therefore no fetch-driven
/// loading / error / stale / offline branch to reproduce inside this surface; the only branches are the
/// in-component <see cref="Ready"/> render (the web <c>legItems.length &gt; 0</c> path) and the
/// <see cref="Empty"/> stand-in the web returns when <c>legItems.length === 0</c>. Both branches map onto a
/// visible surface; neither is ever hidden.
/// </summary>
public enum TripLegListState
{
    /// <summary>At least one leg is bound (the web list render): the title above the per-leg cards.</summary>
    Ready,

    /// <summary>No legs bound (web <c>legItems.length === 0</c>) — the panel title over a friendly stand-in.</summary>
    Empty,
}

/// <summary>
/// Shared tolerant JSON readers for the trip-leg snapshots — a small DRY helper so each
/// <c>FromJson</c> parser stays null-safe without duplicating the same kind-switching. UI-free.
/// </summary>
internal static class TripLegJson
{
    /// <summary>Read a finite double from <paramref name="name"/>, accepting JSON numbers and numeric strings.</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
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

    /// <summary>Read a string from <paramref name="name"/>, or null when absent / not a string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Read a boolean from <paramref name="name"/>, or null when absent / not a boolean.</summary>
    public static bool? GetBool(JsonElement obj, string name)
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
}

/// <summary>
/// One route endpoint a leg starts from or ends at — the native mirror of the web <c>TripLocation</c>
/// (web/src/types/driving.ts). Field names mirror the Go API's snake_case JSON tags (<c>lat</c> / <c>lng</c> /
/// <c>name</c>); the leg's display label prefers <see cref="Name"/> and falls back to the rounded
/// "lat, lng" pair exactly as the web <c>leg.from.name || `${lat.toFixed(2)}, ${lng.toFixed(2)}`</c> does.
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Lat">The endpoint latitude (web <c>lat</c>).</param>
/// <param name="Lng">The endpoint longitude (web <c>lng</c>).</param>
/// <param name="Name">The endpoint display name (web <c>name</c>), or null / empty to fall back to coordinates.</param>
public sealed record TripLegLocationSnapshot(double Lat, double Lng, string? Name)
{
    /// <summary>An origin-coordinate, unnamed endpoint used when a cached leg omits its <c>from</c> / <c>to</c>.</summary>
    public static TripLegLocationSnapshot Unknown { get; } = new(0, 0, null);

    /// <summary>Project a single location JSON object into a tolerant snapshot.</summary>
    public static TripLegLocationSnapshot FromJson(JsonElement obj) => new(
        TripLegJson.GetDouble(obj, "lat") ?? 0,
        TripLegJson.GetDouble(obj, "lng") ?? 0,
        TripLegJson.GetString(obj, "name"));
}

/// <summary>
/// One drive leg between two endpoints (or charge stops) — the native mirror of the web <c>TripLeg</c>
/// (web/src/types/driving.ts). Every numeric stays SI-canonical exactly as the API and the web source keep it
/// (<see cref="DistanceM"/> in metres, <see cref="DurationS"/> in seconds, <see cref="EnergyWh"/> in watt-hours,
/// the two SoC values in percent), so the projection converts only at its own display boundary. Parsing is
/// null-tolerant so a partial cached row never throws. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="From">The leg's start endpoint (web <c>from</c>).</param>
/// <param name="To">The leg's end endpoint (web <c>to</c>).</param>
/// <param name="DistanceM">Leg distance in metres (web <c>distance_m</c>, SI).</param>
/// <param name="DurationS">Leg duration in seconds (web <c>duration_s</c>, SI).</param>
/// <param name="EnergyWh">Leg energy in watt-hours (web <c>energy_wh</c>, SI).</param>
/// <param name="StartSoc">State of charge at the start of the leg, percent (web <c>start_soc</c>).</param>
/// <param name="ArrivalSoc">State of charge on arrival, percent (web <c>arrival_soc</c>).</param>
public sealed record TripLegSnapshot(
    TripLegLocationSnapshot From,
    TripLegLocationSnapshot To,
    double DistanceM,
    double DurationS,
    double EnergyWh,
    double StartSoc,
    double ArrivalSoc)
{
    /// <summary>Project a single leg JSON object into a tolerant snapshot.</summary>
    public static TripLegSnapshot FromJson(JsonElement obj) => new(
        Endpoint(obj, "from"),
        Endpoint(obj, "to"),
        TripLegJson.GetDouble(obj, "distance_m") ?? 0,
        TripLegJson.GetDouble(obj, "duration_s") ?? 0,
        TripLegJson.GetDouble(obj, "energy_wh") ?? 0,
        TripLegJson.GetDouble(obj, "start_soc") ?? 0,
        TripLegJson.GetDouble(obj, "arrival_soc") ?? 0);

    private static TripLegLocationSnapshot Endpoint(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Object
            ? TripLegLocationSnapshot.FromJson(v)
            : TripLegLocationSnapshot.Unknown;
}

/// <summary>
/// One recommended charging stop inserted after a leg — the native mirror of the web <c>TripChargeStop</c>
/// (web/src/types/driving.ts). Only the fields the web component renders are carried (the charger
/// <see cref="Name"/>, the SoC window, the SI <see cref="ChargeDurationS"/> / <see cref="EnergyWh"/>, the decimal
/// <see cref="Cost"/> and the <see cref="IsRecommended"/> flag); the source's <c>location</c> is never shown, so it
/// is intentionally omitted. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Name">The charger location label (web <c>name</c>).</param>
/// <param name="ChargeFromSoc">State of charge when the stop begins, percent (web <c>charge_from_soc</c>).</param>
/// <param name="ChargeToSoc">State of charge when the stop ends, percent (web <c>charge_to_soc</c>).</param>
/// <param name="ChargeDurationS">Charging duration in seconds (web <c>charge_duration_s</c>, SI).</param>
/// <param name="EnergyWh">Energy added in watt-hours (web <c>energy_wh</c>, SI).</param>
/// <param name="Cost">Stop cost in the user's currency (web <c>cost</c>).</param>
/// <param name="IsRecommended">Whether the "actual charger locations may vary" note shows (web <c>is_recommended</c>).</param>
public sealed record TripChargeStopSnapshot(
    string Name,
    double ChargeFromSoc,
    double ChargeToSoc,
    double ChargeDurationS,
    double EnergyWh,
    double Cost,
    bool IsRecommended)
{
    /// <summary>Project a single charge-stop JSON object into a tolerant snapshot.</summary>
    public static TripChargeStopSnapshot FromJson(JsonElement obj) => new(
        TripLegJson.GetString(obj, "name") ?? string.Empty,
        TripLegJson.GetDouble(obj, "charge_from_soc") ?? 0,
        TripLegJson.GetDouble(obj, "charge_to_soc") ?? 0,
        TripLegJson.GetDouble(obj, "charge_duration_s") ?? 0,
        TripLegJson.GetDouble(obj, "energy_wh") ?? 0,
        TripLegJson.GetDouble(obj, "cost") ?? 0,
        TripLegJson.GetBool(obj, "is_recommended") ?? false);
}

/// <summary>
/// The render-time data model the <c>TripLegList</c> view binds to — the native analogue of the web component's
/// props (<c>legs</c>, <c>chargeStops</c>) plus the distance display context the web threads through
/// <c>toDistanceDisplay</c> / <c>distanceUnit</c> (the <c>useUnits</c> seam). The component is presentational, so
/// user-facing labels are resolved from the i18n facade by the projection, not passed in, and the energy / cost
/// formatting context (currency symbol + precision) is supplied to the projection alongside the localizer. Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Legs">The drive legs to render (web <c>legs</c>); an empty list renders the empty branch.</param>
/// <param name="ChargeStops">The charge stops interleaved after each leg (web <c>chargeStops</c>).</param>
/// <param name="DistanceUnit">The user's distance display unit (web <c>distanceUnit</c> + <c>toDistanceDisplay</c>).</param>
public sealed record TripLegListModel(
    IReadOnlyList<TripLegSnapshot> Legs,
    IReadOnlyList<TripChargeStopSnapshot> ChargeStops,
    DistanceUnit DistanceUnit = DistanceUnit.Km)
{
    /// <summary>The initial model — no legs bound (the empty branch).</summary>
    public static TripLegListModel Empty { get; } = new([], []);

    /// <summary>
    /// Project a cached trip-plan payload into a model, mirroring the web prop shape: the <c>legs</c> and
    /// <c>charge_stops</c> arrays of a <c>TripPlan</c> object are read tolerantly (non-array / non-object members
    /// are skipped), so a partial cached plan never throws and simply yields fewer rows.
    /// </summary>
    /// <param name="plan">The cached trip-plan JSON object (the web <c>TripPlan</c>).</param>
    /// <param name="distanceUnit">The user's distance display unit applied to every leg.</param>
    public static TripLegListModel FromJson(JsonElement plan, DistanceUnit distanceUnit = DistanceUnit.Km) => new(
        ReadArray(plan, "legs", TripLegSnapshot.FromJson),
        ReadArray(plan, "charge_stops", TripChargeStopSnapshot.FromJson),
        distanceUnit);

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

/// <summary>
/// The fully projected, render-ready view of one charge stop the list interleaves after a leg — the native
/// analogue of the web charge-stop block (the <c>Zap</c> row, the name, the clock duration, the SoC window, the
/// energy, the cost and the optional "recommended" note). Every value is already formatted with the web's exact
/// rounding and unit suffixes. Pure data so every field is asserted headlessly.
/// </summary>
/// <param name="Name">The charger location label (web <c>stops[idx].name</c>).</param>
/// <param name="DurationText">The rounded charge duration with the localized "min" suffix (web <c>round(s / 60) min</c>).</param>
/// <param name="SocRangeText">The rounded "{from}% → {to}%" SoC window (web <c>round(from)% → round(to)%</c>).</param>
/// <param name="EnergyText">The energy added in the user's unit (web <c>formatEnergy(energy_wh, { precision: 1 })</c>).</param>
/// <param name="CostText">The stop cost in the user's currency (web <c>formatCurrency(cost)</c>).</param>
/// <param name="IsRecommended">Whether the "recommended" note shows (web <c>stops[idx].is_recommended</c>).</param>
/// <param name="RecommendedText">The localized "recommended" note, or empty when not recommended.</param>
/// <param name="AutomationName">The composed Narrator name for the stop card.</param>
public sealed record TripChargeStopDisplay(
    string Name,
    string DurationText,
    string SocRangeText,
    string EnergyText,
    string CostText,
    bool IsRecommended,
    string RecommendedText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of one leg row — the native analogue of everything the web component
/// computes for a single <c>legItems.map</c> iteration before returning JSX. Holds the 1-based
/// <see cref="Index"/> badge, the two endpoint labels, the four already-formatted metrics (distance, duration,
/// energy and the SoC pair), the <see cref="ArrivalIsLow"/> flag driving the arrival-SoC tint (web
/// <c>arrival_soc &lt; 20 ? rose : amber</c>), the optional <see cref="ChargeStop"/> that follows this leg, and
/// the composed Narrator name. Pure data so every field is asserted headlessly.
/// </summary>
/// <param name="Index">The 1-based leg number shown in the badge (web <c>idx + 1</c>).</param>
/// <param name="FromLabel">The start endpoint label (web <c>leg.from.name</c> or the rounded coordinates).</param>
/// <param name="ToLabel">The end endpoint label (web <c>leg.to.name</c> or the rounded coordinates).</param>
/// <param name="DistanceLabel">The localized "Distance" caption.</param>
/// <param name="DistanceText">The leg distance in the user's unit (web <c>toDistanceDisplay(distance_m).toFixed(1)</c>).</param>
/// <param name="DurationLabel">The localized "Duration" caption.</param>
/// <param name="DurationText">The leg duration with the localized "min" suffix (web <c>round(duration_s) min</c>).</param>
/// <param name="EnergyLabel">The localized "Energy" caption.</param>
/// <param name="EnergyText">The leg energy in the user's unit (web <c>formatEnergy(energy_wh, { precision: 1 })</c>).</param>
/// <param name="SocLabel">The localized "Battery" caption.</param>
/// <param name="StartSocText">The rounded start SoC, e.g. "85%" (web <c>round(start_soc)%</c>).</param>
/// <param name="ArrivalSocText">The rounded arrival SoC, e.g. "18%" (web <c>round(arrival_soc)%</c>).</param>
/// <param name="ArrivalIsLow">True when the arrival SoC is below the low threshold (web <c>arrival_soc &lt; 20</c>).</param>
/// <param name="ChargeStop">The charge stop interleaved after this leg, or null when none applies.</param>
/// <param name="AutomationName">The composed Narrator name for the leg card.</param>
public sealed record TripLegItemDisplay(
    string Index,
    string FromLabel,
    string ToLabel,
    string DistanceLabel,
    string DistanceText,
    string DurationLabel,
    string DurationText,
    string EnergyLabel,
    string EnergyText,
    string SocLabel,
    string StartSocText,
    string ArrivalSocText,
    bool ArrivalIsLow,
    TripChargeStopDisplay? ChargeStop,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the whole list — the native analogue of everything the web
/// component computes before returning its <c>GlassPanel</c>. Holds the resolved <see cref="State"/>, the
/// localized panel <see cref="Title"/>, the empty-branch <see cref="EmptyMessage"/>, the per-leg
/// <see cref="Items"/> (empty in the empty branch) and the composed surface <see cref="AutomationName"/>. Pure
/// data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="Title">The localized "Route Breakdown" panel title (both branches).</param>
/// <param name="EmptyMessage">The localized "Plan a trip…" copy (empty branch).</param>
/// <param name="Items">The projected leg rows (ready branch); empty in the empty branch.</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record TripLegListDisplay(
    TripLegListState State,
    string Title,
    string EmptyMessage,
    IReadOnlyList<TripLegItemDisplay> Items,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="TripLegListModel"/> to its <see cref="TripLegListDisplay"/> — the native port
/// of <c>web/src/features/driving/components/TripLegList.tsx</c>. The branch precedence mirrors the web
/// (empty when there are no legs, otherwise the list), each leg reproduces the web composition with the web's exact
/// formatting: the distance is <c>convertDistanceFromSI(distance_m, unit)</c> rendered with a fixed single decimal
/// like the web's <c>.toFixed(1)</c>, the energy is the shared <c>formatEnergy(energy_wh, { precision: 1 })</c>
/// (kWh, the <c>useUnits</c> default), the cost is <c>formatCurrency(cost)</c>, and every rounded readout uses
/// JavaScript <c>Math.round</c> (round-half-up). The leg "duration" is reproduced verbatim from the web — the
/// source interpolates <c>Math.round(leg.duration_s)</c> with a "min" suffix, so this port does the same rather
/// than silently diverging from the specification. Every user-facing label resolves through the i18n facade using
/// the catalog keys that mirror the web <c>tripPlanner.legs</c> namespace. No WinUI types — unit-tested without a
/// host.
/// </summary>
public static class TripLegListProjection
{
    /// <summary>i18n key for the panel title (web <c>t('tripPlanner.legs.title', …)</c>).</summary>
    public const string TitleKey = "translation.tripPlanner.legs.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (matches the web default and the catalog value).</summary>
    public const string TitleFallback = "Route Breakdown";

    /// <summary>i18n key for the empty-state copy (web <c>t('tripPlanner.legs.empty', …)</c>).</summary>
    public const string EmptyKey = "translation.tripPlanner.legs.empty";

    /// <summary>English fallback for <see cref="EmptyKey"/> (matches the web default and the catalog value).</summary>
    public const string EmptyFallback = "Plan a trip to see the route breakdown";

    /// <summary>i18n key for the "Distance" caption (web <c>t('tripPlanner.legs.distance', …)</c>).</summary>
    public const string DistanceKey = "translation.tripPlanner.legs.distance";

    /// <summary>English fallback for <see cref="DistanceKey"/>.</summary>
    public const string DistanceFallback = "Distance";

    /// <summary>i18n key for the "Duration" caption (web <c>t('tripPlanner.legs.duration', …)</c>).</summary>
    public const string DurationKey = "translation.tripPlanner.legs.duration";

    /// <summary>English fallback for <see cref="DurationKey"/>.</summary>
    public const string DurationFallback = "Duration";

    /// <summary>i18n key for the "Energy" caption (web <c>t('tripPlanner.legs.energy', …)</c>).</summary>
    public const string EnergyKey = "translation.tripPlanner.legs.energy";

    /// <summary>English fallback for <see cref="EnergyKey"/>.</summary>
    public const string EnergyFallback = "Energy";

    /// <summary>i18n key for the "Battery" caption (web <c>t('tripPlanner.legs.soc', …)</c>).</summary>
    public const string SocKey = "translation.tripPlanner.legs.soc";

    /// <summary>English fallback for <see cref="SocKey"/>.</summary>
    public const string SocFallback = "Battery";

    /// <summary>i18n key for the recommended-stop note (web <c>t('tripPlanner.legs.recommended', …)</c>).</summary>
    public const string RecommendedKey = "translation.tripPlanner.legs.recommended";

    /// <summary>English fallback for <see cref="RecommendedKey"/> (matches the web em-dash default).</summary>
    public const string RecommendedFallback = "Recommended stop point \u2014 actual charger locations may vary";

    /// <summary>i18n key for the "min" duration unit (web <c>t('common.min', 'min')</c>).</summary>
    public const string MinKey = "translation.common.min";

    /// <summary>English fallback for <see cref="MinKey"/>.</summary>
    public const string MinFallback = "min";

    /// <summary>Arrival SoC below this percent renders in the danger tint (web <c>arrival_soc &lt; 20</c>).</summary>
    public const double LowSocThreshold = 20.0;

    private const string EmDash = "\u2014";
    private const string SocArrow = "\u2192";
    private const double SecondsPerMinute = 60.0;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade + currency context.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="currencySymbol">The active currency symbol for the cost text (web <c>formatCurrency</c>; default <c>$</c>).</param>
    /// <param name="decimalPrecision">The user's default decimal precision (web global precision; default 2).</param>
    public static TripLegListDisplay Project(
        TripLegListModel model,
        ILocalizer localizer,
        string? currencySymbol = null,
        int decimalPrecision = 2)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string currency = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        int precision = decimalPrecision < 0 ? 0 : decimalPrecision;

        string title = localizer.GetString(TitleKey, TitleFallback);

        IReadOnlyList<TripLegSnapshot> legs = model.Legs;
        IReadOnlyList<TripChargeStopSnapshot> stops = model.ChargeStops;

        if (legs.Count == 0)
        {
            string emptyMessage = localizer.GetString(EmptyKey, EmptyFallback);
            return new TripLegListDisplay(
                TripLegListState.Empty,
                title,
                emptyMessage,
                Items: [],
                AutomationName: string.Concat(title, ". ", emptyMessage));
        }

        string minLabel = localizer.GetString(MinKey, MinFallback);
        string distanceLabel = localizer.GetString(DistanceKey, DistanceFallback);
        string durationLabel = localizer.GetString(DurationKey, DurationFallback);
        string energyLabel = localizer.GetString(EnergyKey, EnergyFallback);
        string socLabel = localizer.GetString(SocKey, SocFallback);
        string recommendedText = localizer.GetString(RecommendedKey, RecommendedFallback);

        // Web parity: useUnits() always formats energy in kWh (DEFAULT_ENERGY_PREF) regardless of the
        // distance unit, so the energy formatter pref pins kWh while distance follows the user's unit.
        var energyPref = UnitPref.Metric with { Distance = model.DistanceUnit, Energy = EnergyUnit.Kwh };
        string distanceUnit = UnitLabels.Label(model.DistanceUnit);

        var items = new List<TripLegItemDisplay>(legs.Count);
        for (int i = 0; i < legs.Count; i++)
        {
            var leg = legs[i];

            string fromLabel = LocationLabel(leg.From);
            string toLabel = LocationLabel(leg.To);
            string distanceText = string.Concat(
                Fixed(UnitConverters.DistanceFromSi(leg.DistanceM, model.DistanceUnit), 1), " ", distanceUnit);
            string durationText = string.Concat(RoundToIntString(leg.DurationS), " ", minLabel);
            string energyText = UnitFormatters.FormatEnergy(leg.EnergyWh, energyPref, precision: 1);
            string startSocText = string.Concat(RoundToIntString(leg.StartSoc), "%");
            string arrivalSocText = string.Concat(RoundToIntString(leg.ArrivalSoc), "%");
            bool arrivalIsLow = leg.ArrivalSoc < LowSocThreshold;

            // Web parity: the charge stop after this leg only renders while idx < stops.length.
            TripChargeStopDisplay? stop = i < stops.Count
                ? ProjectStop(stops[i], energyPref, currency, precision, minLabel, recommendedText)
                : null;

            string automation = BuildLegAutomation(
                i + 1, fromLabel, toLabel,
                distanceLabel, distanceText,
                durationLabel, durationText,
                energyLabel, energyText,
                socLabel, startSocText, arrivalSocText);

            items.Add(new TripLegItemDisplay(
                Index: (i + 1).ToString(CultureInfo.InvariantCulture),
                FromLabel: fromLabel,
                ToLabel: toLabel,
                DistanceLabel: distanceLabel,
                DistanceText: distanceText,
                DurationLabel: durationLabel,
                DurationText: durationText,
                EnergyLabel: energyLabel,
                EnergyText: energyText,
                SocLabel: socLabel,
                StartSocText: startSocText,
                ArrivalSocText: arrivalSocText,
                ArrivalIsLow: arrivalIsLow,
                ChargeStop: stop,
                AutomationName: automation));
        }

        return new TripLegListDisplay(
            TripLegListState.Ready,
            title,
            EmptyMessage: string.Empty,
            Items: items,
            AutomationName: title);
    }

    /// <summary>
    /// Round to the nearest integer with JavaScript <c>Math.round</c> semantics (round-half-up) and render it
    /// without grouping separators, matching the web's raw <c>{Math.round(value)}</c> interpolation. A non-finite
    /// input yields an em dash.
    /// </summary>
    public static string RoundToIntString(double value)
    {
        if (!double.IsFinite(value))
        {
            return EmDash;
        }

        long rounded = (long)Math.Floor(value + 0.5);
        return rounded.ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Render <paramref name="value"/> with exactly <paramref name="digits"/> fixed decimals and no grouping —
    /// the native equivalent of the web's <c>value.toFixed(digits)</c> (round-half-away-from-zero). A non-finite
    /// input yields an em dash.
    /// </summary>
    public static string Fixed(double value, int digits)
    {
        if (!double.IsFinite(value))
        {
            return EmDash;
        }

        double rounded = Math.Round(value, digits, MidpointRounding.AwayFromZero);
        return rounded.ToString("F" + digits.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
    }

    private static TripChargeStopDisplay ProjectStop(
        TripChargeStopSnapshot stop,
        UnitPref energyPref,
        string currency,
        int precision,
        string minLabel,
        string recommendedText)
    {
        string name = stop.Name;

        // Web parity: round(charge_duration_s / 60) for the stop (the only place the source divides by 60).
        string durationText = string.Concat(RoundToIntString(stop.ChargeDurationS / SecondsPerMinute), " ", minLabel);
        string socRange = string.Concat(
            RoundToIntString(stop.ChargeFromSoc), "% ", SocArrow, " ", RoundToIntString(stop.ChargeToSoc), "%");
        string energyText = UnitFormatters.FormatEnergy(stop.EnergyWh, energyPref, precision: 1);
        string costText = Currency(currency, stop.Cost, precision);
        string recommended = stop.IsRecommended ? recommendedText : string.Empty;

        var parts = new List<string>(6) { name, durationText, socRange, energyText, costText };
        if (stop.IsRecommended)
        {
            parts.Add(recommendedText);
        }

        return new TripChargeStopDisplay(
            name,
            durationText,
            socRange,
            energyText,
            costText,
            stop.IsRecommended,
            recommended,
            string.Join(". ", parts));
    }

    private static string LocationLabel(TripLegLocationSnapshot location)
    {
        if (!string.IsNullOrEmpty(location.Name))
        {
            return location.Name;
        }

        return string.Concat(Fixed(location.Lat, 2), ", ", Fixed(location.Lng, 2));
    }

    private static string BuildLegAutomation(
        int number,
        string fromLabel,
        string toLabel,
        string distanceLabel,
        string distanceText,
        string durationLabel,
        string durationText,
        string energyLabel,
        string energyText,
        string socLabel,
        string startSocText,
        string arrivalSocText)
    {
        string ordinal = number.ToString(CultureInfo.InvariantCulture);
        string route = string.Concat(fromLabel, " ", SocArrow, " ", toLabel);
        string battery = string.Concat(socLabel, " ", startSocText, " ", SocArrow, " ", arrivalSocText);

        return string.Join(
            ". ",
            ordinal,
            route,
            string.Concat(distanceLabel, " ", distanceText),
            string.Concat(durationLabel, " ", durationText),
            string.Concat(energyLabel, " ", energyText),
            battery);
    }

    // web formatCurrency(amount, decimals) = `${symbol}${fmtNumber(amount, decimals)}`; a non-finite amount
    // formats as 0 (the web safeNumber guard inside the formatter).
    private static string Currency(string symbol, double amount, int decimals) =>
        symbol + NumberFormatting.Format(double.IsFinite(amount) ? amount : 0, null, decimals);
}

/// <summary>
/// Canonical metadata for the <c>TripLegList</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/driving/components/TripLegList.tsx</c>. Holds the diagnostics slug and the Segoe Fluent
/// glyphs that stand in for the web Lucide icons (MapPin, ArrowRight, Zap, Clock). UI-free so the metadata is
/// asserted in tests.
/// </summary>
public static class TripLegListRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TripLegList";

    /// <summary>Segoe Fluent "MapPin" glyph for the leg endpoints (web <c>MapPin</c>).</summary>
    public const string MapPinGlyph = "\uE81D";

    /// <summary>Segoe Fluent "Forward" glyph between the two endpoints (web <c>ArrowRight</c>).</summary>
    public const string ArrowRightGlyph = "\uE72A";

    /// <summary>Segoe Fluent "LightningBolt" glyph for the charge stop (web <c>Zap</c>).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent "Recent" glyph for the charge-stop duration (web <c>Clock</c>).</summary>
    public const string ClockGlyph = "\uE823";
}

/// <summary>
/// PII-safe diagnostics for the <c>TripLegList</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a route, charger name, distance, energy or
/// cost — so a diagnostics line can never leak a user's planned trip or whereabouts. Thread-safe.
/// </summary>
public sealed class TripLegListDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public TripLegListDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TripLegList</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TripLegListRegistration.Slug}");
    }
}
