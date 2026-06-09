using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="RangeBarViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>RangeBarWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/RangeBarWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>hasData = state != null &amp;&amp; (rated &gt; 0 || ideal &gt; 0)</c> gate (no resolved vehicle, no
/// state in the response, or a state whose rated and ideal range are both zero) — the "No range data"
/// surface.
/// </summary>
public enum RangeBarState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a range to render the bars for.</summary>
    Loaded,

    /// <summary>No vehicle resolved, no state, or both ranges zero — render the "No range data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the bars plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the bars plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The two fields the range bar reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of the
/// web <c>VehicleState</c> slice the widget consumes (<c>state.rated_range</c> + <c>state.ideal_range</c>,
/// web/src/api/types). Both are SI metres (the Phase-42/48 SI-canonical wire shape the web feeds straight into
/// <c>convertDistanceFromSI</c>); display conversion happens only at projection time via the shared
/// <see cref="UnitConverters"/>. A <see langword="null"/> parse result models the web <c>stateData?.state</c>
/// being undefined (no state in the response → the empty surface). Parsing is null-tolerant so a partial body
/// never throws.
/// </summary>
/// <param name="RatedRange">EPA/rated range in SI metres (web <c>state.rated_range ?? 0</c>).</param>
/// <param name="IdealRange">Ideal range in SI metres (web <c>state.ideal_range ?? 0</c>).</param>
public sealed record VehicleRangeState(double RatedRange, double IdealRange)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the range slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook (shared with the native
    /// <c>BatteryGaugeWidget</c>): prefer the canonical <c>state</c> object (the one carrying
    /// <c>vehicle_id</c>), otherwise fall back to a plain <c>state</c> object, otherwise reconstruct from
    /// the <c>position</c> snapshot when a <c>vehicle</c>/<c>position</c> is present. Returns
    /// <see langword="null"/> when none of those yield a state — the native analogue of the web
    /// <c>state</c> being undefined.
    /// </summary>
    public static VehicleRangeState? FromResponse(JsonElement root)
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
            ? new VehicleRangeState(ReadDouble(p, "rated_range") ?? 0, ReadDouble(p, "ideal_range") ?? 0)
            : new VehicleRangeState(0, 0);
    }

    private static VehicleRangeState FromStateObject(JsonElement state) => new(
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
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols === 1 &amp;&amp; size.rows === 1</c> flag in
/// web/src/features/dashboard/widgets/RangeBarWidget.tsx.
/// </summary>
public readonly record struct RangeBarSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static RangeBarSize Default => new(2, 2);

    /// <summary>
    /// True at exactly one column and one row (web <c>isCompact = size.cols === 1 &amp;&amp; size.rows === 1</c>):
    /// collapse the two bars into a single big rated-range readout.
    /// </summary>
    public bool IsCompact => Cols == 1 && Rows == 1;
}

/// <summary>
/// The fully projected, render-ready view of the range bars for one footprint — the native analogue of
/// everything the web component computes before returning JSX (the converted rated / ideal / max range, the
/// formatted bar sub-labels, the EPA variance line, and the compact readout). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record RangeBarDisplay(
    bool IsCompact,
    bool HasData,
    string DistanceUnitLabel,
    double RatedValue,
    double IdealValue,
    double MaxValue,
    string RatedText,
    string IdealText,
    string RatedLabel,
    string IdealLabel,
    string RatedSublabel,
    string IdealSublabel,
    string RatedBrushKey,
    string IdealBrushKey,
    bool ShowEpa,
    string EpaLabel,
    string EpaValueText,
    string CompactValueText,
    string CompactCaption,
    string RatedAutomationName,
    string IdealAutomationName,
    string EpaAutomationName,
    string CompactAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="VehicleRangeState"/> to the display model — the native port of the
/// <c>toDistanceDisplay</c> / <c>maxRange</c> / EPA-variance composition in
/// web/src/features/dashboard/widgets/RangeBarWidget.tsx. Range arrives as SI metres, so this converts to the
/// user's display unit (web <c>convertDistanceFromSI(value, unitPrefs.distance)</c>), formats with the web
/// <c>fmtNumber</c> precision, and computes the EPA delta; every label resolves through the i18n facade.
/// </summary>
public static class RangeBarProjection
{
    /// <summary>Segoe Fluent "Speedometer" glyph for the surface header / empty state (web <c>Gauge</c> icon).</summary>
    public const string HeaderGlyph = "\uEC4A";

    /// <summary>The floor the web applies to the bar denominator (web <c>Math.max(rated, ideal, 1)</c>), in SI metres.</summary>
    public const double MinMaxRangeMeters = 1.0;

    /// <summary>Design-token brush for the rated bar (web accent cyan <c>#22d3ee</c>).</summary>
    public const string RatedBrushKey = "TsColorAccentBrush";

    /// <summary>Design-token brush for the ideal bar (web violet <c>#a78bfa</c> → brand violet <c>#A855F7</c>).</summary>
    public const string IdealBrushKey = "TsChartPowerBrush";

    /// <summary>Project <paramref name="state"/> for <paramref name="size"/> using the user's units and the localizer for every label.</summary>
    public static RangeBarDisplay Project(VehicleRangeState state, RangeBarSize size, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        double ratedMeters = SafeNumber(state.RatedRange);
        double idealMeters = SafeNumber(state.IdealRange);

        // Web parity: hasData = state != null && (rated > 0 || ideal > 0).
        bool hasData = ratedMeters > 0 || idealMeters > 0;

        // Web parity: maxRange = Math.max(rated, ideal, 1) — computed in SI metres before conversion.
        double maxMeters = Math.Max(Math.Max(ratedMeters, idealMeters), MinMaxRangeMeters);

        var distanceUnit = units.Distance;
        string unitLabel = UnitLabels.Label(distanceUnit);

        double ratedValue = UnitConverters.DistanceFromSi(ratedMeters, distanceUnit);
        double idealValue = UnitConverters.DistanceFromSi(idealMeters, distanceUnit);
        double maxValue = UnitConverters.DistanceFromSi(maxMeters, distanceUnit);

        string ratedText = Fmt(ratedValue, 0);
        string idealText = Fmt(idealValue, 0);
        string ratedLabel = localizer.GetString("widget.ratedRange", "Rated Range");
        string idealLabel = localizer.GetString("widget.idealRange", "Ideal Range");
        string ratedWord = localizer.GetString("widget.rated", "rated");
        string epaLabel = localizer.GetString("widget.epaComparison", "EPA variance");

        string ratedSublabel = string.Format(CultureInfo.CurrentCulture, "{0} {1}", ratedText, unitLabel);
        string idealSublabel = string.Format(CultureInfo.CurrentCulture, "{0} {1}", idealText, unitLabel);

        // Web parity: the EPA line renders only when rated > 0 && ideal > 0 (avoids a divide-by-zero).
        bool showEpa = ratedMeters > 0 && idealMeters > 0;
        string epaValueText = showEpa ? FormatEpaVariance(ratedMeters, idealMeters) : string.Empty;

        string compactValueText = ratedText;
        string compactCaption = string.Format(CultureInfo.CurrentCulture, "{0} {1}", unitLabel, ratedWord);

        return new RangeBarDisplay(
            IsCompact: size.IsCompact,
            HasData: hasData,
            DistanceUnitLabel: unitLabel,
            RatedValue: ratedValue,
            IdealValue: idealValue,
            MaxValue: maxValue,
            RatedText: ratedText,
            IdealText: idealText,
            RatedLabel: ratedLabel,
            IdealLabel: idealLabel,
            RatedSublabel: ratedSublabel,
            IdealSublabel: idealSublabel,
            RatedBrushKey: RatedBrushKey,
            IdealBrushKey: IdealBrushKey,
            ShowEpa: showEpa,
            EpaLabel: epaLabel,
            EpaValueText: epaValueText,
            CompactValueText: compactValueText,
            CompactCaption: compactCaption,
            RatedAutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", ratedLabel, ratedText, unitLabel),
            IdealAutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", idealLabel, idealText, unitLabel),
            EpaAutomationName: showEpa ? string.Format(CultureInfo.CurrentCulture, "{0} {1}", epaLabel, epaValueText) : string.Empty,
            CompactAutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", ratedLabel, compactValueText, unitLabel));
    }

    /// <summary>
    /// Format the EPA variance exactly as the web does: <c>((ideal - rated) / rated) * 100</c> at one fraction
    /// digit, prefixed with <c>+</c> when ideal ≥ rated (web <c>{ideal &gt;= rated ? '+' : ''}</c>; a negative
    /// delta already carries its own minus sign). Both inputs are SI metres, but the ratio is unit-invariant.
    /// </summary>
    public static string FormatEpaVariance(double ratedMeters, double idealMeters)
    {
        double rated = SafeNumber(ratedMeters);
        double ideal = SafeNumber(idealMeters);
        if (rated <= 0)
        {
            return string.Empty;
        }

        double percent = (ideal - rated) / rated * 100;
        string sign = ideal >= rated ? "+" : string.Empty;
        return string.Format(CultureInfo.CurrentCulture, "{0}{1}%", sign, Fmt(percent, 1));
    }

    /// <summary>
    /// Format a number exactly as the web <c>fmtNumber</c> does: coerce null / NaN / ±∞ to 0 (web
    /// <c>safeNumber</c>) then render with fixed <paramref name="decimals"/> fraction digits and en-US grouping.
    /// </summary>
    private static string Fmt(double value, int decimals) =>
        ScalarFormatters.FormatNumber(SafeNumber(value), decimals);

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;VehicleRangeState&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline). A successful emission whose body carries no usable state collapses
/// to <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>state</c> being undefined.
/// The additional <c>(rated &gt; 0 || ideal &gt; 0)</c> half of the web <c>hasData</c> gate is applied by the
/// view-model (so a stale zero-range cache still flows through with its freshness intact). Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class RangeBarResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<VehicleRangeState> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        VehicleRangeState? Parse() => raw.HasValue ? VehicleRangeState.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<VehicleRangeState>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<VehicleRangeState>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<VehicleRangeState>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<VehicleRangeState>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<VehicleRangeState>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<VehicleRangeState>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<VehicleRangeState>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<VehicleRangeState>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<VehicleRangeState>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<VehicleRangeState>.Empty(raw.FetchedAt),
            _ => RepositoryResult<VehicleRangeState>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
