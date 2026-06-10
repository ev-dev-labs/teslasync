using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="RangeEstimateViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>RangeEstimateWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/RangeEstimateWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>{state ? … : &lt;EmptyState&gt;}</c>
/// gate (no resolved vehicle, or no usable state in the response) — the "No range data" surface. Unlike the
/// sibling range-bar surface, a state whose rated and ideal range are both zero still renders the two readouts
/// (the web gate is <c>state</c> truthiness, not a positive-range check).
/// </summary>
public enum RangeEstimateState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a vehicle state to render the rated / ideal readouts for.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no state — render the "No range data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the readouts plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the readouts plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The two fields the range estimate reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of
/// the web <c>VehicleState</c> slice the widget consumes (<c>state.rated_range</c> + <c>state.ideal_range</c>,
/// web/src/api/types). Both are SI metres (the Phase-42/48 SI-canonical wire shape the web feeds straight into
/// <c>convertDistanceFromSI</c>); display conversion happens only at projection time via the shared
/// <see cref="UnitConverters"/>. A <see langword="null"/> parse result models the web <c>stateData?.state</c>
/// being undefined (no state in the response → the empty surface). Parsing is null-tolerant so a partial body
/// never throws.
/// </summary>
/// <param name="RatedRange">EPA/rated range in SI metres (web <c>state.rated_range ?? 0</c>).</param>
/// <param name="IdealRange">Ideal range in SI metres (web <c>state.ideal_range ?? 0</c>).</param>
public sealed record RangeEstimateReading(double RatedRange, double IdealRange)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the range slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook (shared with the native <c>BatteryGaugeWidget</c>
    /// and <c>RangeBarWidget</c>): prefer the canonical <c>state</c> object (the one carrying
    /// <c>vehicle_id</c>), otherwise fall back to a plain <c>state</c> object, otherwise reconstruct from the
    /// <c>position</c> snapshot when a <c>vehicle</c>/<c>position</c> is present. Returns
    /// <see langword="null"/> when none of those yield a state — the native analogue of the web
    /// <c>state</c> being undefined.
    /// </summary>
    public static RangeEstimateReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // Web parity (primary): res.state with a vehicle_id is the canonical SignalStore state object.
        if (Object(root, "state") is { } state && Has(state, "vehicle_id"))
        {
            return FromStateObject(state);
        }

        var vehicle = Object(root, "vehicle");
        var position = Object(root, "position");
        if (vehicle is null && position is null)
        {
            // Web parity: a plain state object is still usable, otherwise there is no state and the widget
            // shows its empty surface.
            return Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        // Web parity (fallback): build the state from the position snapshot (which carries the range fields).
        return position is { } p
            ? new RangeEstimateReading(ReadDouble(p, "rated_range") ?? 0, ReadDouble(p, "ideal_range") ?? 0)
            : new RangeEstimateReading(0, 0);
    }

    private static RangeEstimateReading FromStateObject(JsonElement state) => new(
        RatedRange: ReadDouble(state, "rated_range") ?? 0,
        IdealRange: ReadDouble(state, "ideal_range") ?? 0);

    private static JsonElement? Object(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object &&
        parent.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.Object
            ? value
            : null;

    private static bool Has(JsonElement obj, string name) => obj.TryGetProperty(name, out _);

    private static double? ReadDouble(JsonElement obj, string name)
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
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> in
/// web/src/features/dashboard/widgets/RangeEstimateWidget.tsx. The web composition is layout-invariant across
/// the footprint (there is no compact branch), so this type exists purely to bind the registry size
/// constraints in the dashboard grid system.
/// </summary>
public readonly record struct RangeEstimateSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (1×2).</summary>
    public static RangeEstimateSize Default => new(1, 2);
}

/// <summary>
/// The fully projected, render-ready view of the range estimate — the native analogue of everything the web
/// component computes before returning JSX (the converted rated / ideal range plus the formatted "{value}
/// {unit}" readouts). Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record RangeEstimateDisplay(
    string DistanceUnitLabel,
    double RatedValue,
    double IdealValue,
    string RatedText,
    string IdealText,
    string RatedValueText,
    string IdealValueText,
    string RatedLabel,
    string IdealLabel,
    string RatedAutomationName,
    string IdealAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="RangeEstimateReading"/> to the display model — the native port of the
/// <c>convertDistanceFromSI</c> + <c>fmtNumber</c> composition in
/// web/src/features/dashboard/widgets/RangeEstimateWidget.tsx. Range arrives as SI metres, so this converts to
/// the user's display unit (web <c>convertDistanceFromSI(value, unitPrefs.distance)</c>), formats with the web
/// <c>fmtNumber</c> precision (0 fraction digits), and pairs each value with its unit label; every label
/// resolves through the i18n facade.
/// </summary>
public static class RangeEstimateProjection
{
    /// <summary>Segoe Fluent "Speedometer" glyph for the surface empty state (web <c>Gauge</c> icon).</summary>
    public const string HeaderGlyph = "\uEC4A";

    /// <summary>Project <paramref name="reading"/> using the user's units and the localizer for every label.</summary>
    public static RangeEstimateDisplay Project(RangeEstimateReading reading, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        double ratedMeters = SafeNumber(reading.RatedRange);
        double idealMeters = SafeNumber(reading.IdealRange);

        var distanceUnit = units.Distance;
        string unitLabel = UnitLabels.Label(distanceUnit);

        double ratedValue = UnitConverters.DistanceFromSi(ratedMeters, distanceUnit);
        double idealValue = UnitConverters.DistanceFromSi(idealMeters, distanceUnit);

        string ratedText = Fmt(ratedValue);
        string idealText = Fmt(idealValue);
        string ratedLabel = localizer.GetString("widget.ratedRange", "Rated Range");
        string idealLabel = localizer.GetString("widget.idealRange", "Ideal Range");

        string ratedValueText = string.Format(CultureInfo.CurrentCulture, "{0} {1}", ratedText, unitLabel);
        string idealValueText = string.Format(CultureInfo.CurrentCulture, "{0} {1}", idealText, unitLabel);

        return new RangeEstimateDisplay(
            DistanceUnitLabel: unitLabel,
            RatedValue: ratedValue,
            IdealValue: idealValue,
            RatedText: ratedText,
            IdealText: idealText,
            RatedValueText: ratedValueText,
            IdealValueText: idealValueText,
            RatedLabel: ratedLabel,
            IdealLabel: idealLabel,
            RatedAutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}", ratedLabel, ratedValueText),
            IdealAutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}", idealLabel, idealValueText));
    }

    /// <summary>
    /// Format a number exactly as the web <c>fmtNumber</c> does: coerce null / NaN / ±∞ to 0 (web
    /// <c>safeNumber</c>) then render with no fraction digits and en-US grouping.
    /// </summary>
    private static string Fmt(double value) =>
        ScalarFormatters.FormatNumber(SafeNumber(value), 0);

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;RangeEstimateReading&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline). A successful emission whose body carries no usable state collapses
/// to <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{state ? readouts : empty}</c>
/// gate. A zero-range state is preserved (the web shows "0 {unit}" readouts when a state is present), so the
/// only path to the empty surface is an absent state. Kept pure so the parse-and-preserve contract is
/// unit-tested without a network or cache.
/// </summary>
public static class RangeEstimateResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<RangeEstimateReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        RangeEstimateReading? Parse() => raw.HasValue ? RangeEstimateReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<RangeEstimateReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<RangeEstimateReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<RangeEstimateReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<RangeEstimateReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<RangeEstimateReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<RangeEstimateReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<RangeEstimateReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<RangeEstimateReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<RangeEstimateReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<RangeEstimateReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<RangeEstimateReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
