using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="DrivingTemperatureStatsViewModel"/> can be in — the native union of
/// the loading / loaded / empty / error / stale / offline branches the surface renders. The web component
/// (web/src/features/analytics/components/analytics/DrivingTemperatureStats.tsx) is purely presentational
/// (it receives the fleet-analytics object as a prop and only switches between the metric grid and the
/// empty state), so the loading / error / stale / offline branches are the native parent's query lifecycle
/// (web <c>useFleetAnalytics</c>) reproduced as visible surfaces — none is ever hidden. <see cref="Empty"/>
/// mirrors the web <c>insideTemp || outsideTemp</c> gate (no inside and no outside temperature object),
/// not an empty HTTP body.
/// </summary>
public enum DrivingTemperatureState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying at least one temperature side.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no inside and no outside temperature — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The min / avg / max temperature for one cabin side (<c>inside</c> or <c>outside</c>) of the fleet's
/// drive analytics, in SI Celsius. Mirrors the web <c>StatsSummary</c> fields the component reads
/// (<c>min</c>, <c>avg</c>, <c>max</c>); the remaining <c>StatsSummary</c> fields are not surfaced. Every
/// value is already coerced through <c>safe()</c> (null / NaN / ∞ → 0) at parse time, exactly like the web
/// <c>safe(insideTemp.min)</c> render-time coercion.
/// </summary>
/// <param name="Min">Minimum temperature in SI Celsius (safe-coerced).</param>
/// <param name="Avg">Average temperature in SI Celsius (safe-coerced).</param>
/// <param name="Max">Maximum temperature in SI Celsius (safe-coerced).</param>
public sealed record DrivingTemperatureSide(double Min, double Avg, double Max);

/// <summary>
/// The temperature rollup from <c>GET /analytics/fleet</c> — specifically the
/// <c>drive_analytics.temperature.{inside,outside}</c> sub-objects the web component reads (web hook
/// <c>useFleetAnalytics</c>, shape <c>FleetAnalytics</c> in web/src/api/types.ts). Field names mirror the
/// Go API's snake_case JSON tags; parsing is null-tolerant so a partial or absent body never throws. A
/// side is <see langword="null"/> when its sub-object is absent (web: <c>da?.temperature?.inside</c> is
/// <c>undefined</c>), which drives the empty state and the per-side em-dash cells. Temperatures stay SI
/// Celsius — converted to the user's display unit only at projection time.
/// </summary>
/// <param name="Inside">Cabin (inside) temperature stats, or null when absent.</param>
/// <param name="Outside">Ambient (outside) temperature stats, or null when absent.</param>
public sealed record DrivingTemperatureSnapshot(DrivingTemperatureSide? Inside, DrivingTemperatureSide? Outside)
{
    /// <summary>A no-data snapshot (both sides absent) — the parse fallback for an absent / non-object body.</summary>
    public static DrivingTemperatureSnapshot Empty { get; } = new(null, null);

    /// <summary>
    /// True when there is at least one temperature side to render (web
    /// <c>insideTemp || outsideTemp</c>). Gates the empty state.
    /// </summary>
    public bool HasData => Inside is not null || Outside is not null;

    /// <summary>Project a <c>GET /analytics/fleet</c> JSON object into a tolerant temperature snapshot.</summary>
    /// <param name="element">The raw fleet-analytics JSON object (or any value — non-objects yield <see cref="Empty"/>).</param>
    /// <returns>The parsed snapshot.</returns>
    public static DrivingTemperatureSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        if (!element.TryGetProperty("drive_analytics", out var driveAnalytics) ||
            driveAnalytics.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        if (!driveAnalytics.TryGetProperty("temperature", out var temperature) ||
            temperature.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new DrivingTemperatureSnapshot(ReadSide(temperature, "inside"), ReadSide(temperature, "outside"));
    }

    // web: insideTemp = da?.temperature?.inside. A present (even empty) object is truthy → the cells render
    // with safe()-coerced values; an absent object stays null → that side's cells render the em-dash.
    private static DrivingTemperatureSide? ReadSide(JsonElement temperature, string name)
    {
        if (!temperature.TryGetProperty(name, out var side) || side.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new DrivingTemperatureSide(
            Safe(GetDouble(side, "min")),
            Safe(GetDouble(side, "avg")),
            Safe(GetDouble(side, "max")));
    }

    // web safe(): typeof v === 'number' && isFinite(v) ? v : 0.
    private static double Safe(double? value) =>
        value is { } v && !double.IsNaN(v) && !double.IsInfinity(v) ? v : 0;

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
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
}

/// <summary>
/// One projected, display-ready temperature cell consumed by the WinUI view — the native analogue of a web
/// <c>MetricCard</c>. Holds the localized label, the already-formatted value (the temperature number, or an
/// em-dash when its side is absent), the unit suffix shown beneath the value (web <c>subtitle</c>), the
/// accent token brush key (web <c>color</c>), and the Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">Localized cell label (e.g. "Inside Min").</param>
/// <param name="Value">Formatted temperature number, or an em-dash when the side is absent.</param>
/// <param name="Unit">Temperature unit suffix shown beneath the value (e.g. "°C").</param>
/// <param name="AccentBrushKey">Token brush key for the accent rail (cyan / green / amber).</param>
/// <param name="AutomationName">Narrator name combining the label, value and unit.</param>
public sealed record DrivingTemperatureTile(
    string Label,
    string Value,
    string Unit,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the temperature stats — the native analogue of everything the
/// web component computes before returning JSX. Holds the six cells (inside min/avg/max, outside
/// min/avg/max) and whether there is any temperature data to show. Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when at least one temperature side is present (web gate).</param>
/// <param name="Tiles">The six display cells, in inside-then-outside, min/avg/max order.</param>
public sealed record DrivingTemperatureDisplay(bool HasData, IReadOnlyList<DrivingTemperatureTile> Tiles)
{
    /// <summary>An empty display with no cells — the projection fallback for a no-data snapshot.</summary>
    public static DrivingTemperatureDisplay Empty { get; } = new(false, Array.Empty<DrivingTemperatureTile>());
}

/// <summary>
/// Pure projection from a raw <see cref="DrivingTemperatureSnapshot"/> to the display model — the native
/// port of the inline cell construction in
/// web/src/features/analytics/components/analytics/DrivingTemperatureStats.tsx. SI Celsius is converted to
/// the user's display unit here (and only here, via <see cref="UnitConverters.TemperatureFromSi"/>); every
/// label resolves through the i18n facade and the per-cell accent mirrors the web <c>color</c> prop
/// (cyan → info, green → success, amber → warning).
/// </summary>
public static class DrivingTemperatureStatsProjection
{
    /// <summary>Segoe Fluent thermometer glyph (web <c>Thermometer</c>) for the empty state.</summary>
    public const string ThermometerGlyph = "\uE9CA";

    /// <summary>Display fallback when a temperature side is absent (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    private const int TemperaturePrecision = 1;

    /// <summary>Project <paramref name="snapshot"/> into the six display cells using the user's units.</summary>
    /// <param name="snapshot">The parsed temperature snapshot.</param>
    /// <param name="units">The user's unit preference (only <see cref="UnitPref.Temperature"/> is read).</param>
    /// <param name="localizer">The i18n facade every label flows through.</param>
    /// <returns>The render-ready display model.</returns>
    public static DrivingTemperatureDisplay Project(
        DrivingTemperatureSnapshot snapshot,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var temperatureUnit = units.Temperature;
        string unitLabel = UnitLabels.Label(temperatureUnit);

        var tiles = new List<DrivingTemperatureTile>(6)
        {
            BuildTile("analytics.driving.insideMin", "Inside Min", snapshot.Inside, static s => s.Min, StatusKind.Info, temperatureUnit, unitLabel, localizer),
            BuildTile("analytics.driving.insideAvg", "Inside Avg", snapshot.Inside, static s => s.Avg, StatusKind.Success, temperatureUnit, unitLabel, localizer),
            BuildTile("analytics.driving.insideMax", "Inside Max", snapshot.Inside, static s => s.Max, StatusKind.Warning, temperatureUnit, unitLabel, localizer),
            BuildTile("analytics.driving.outsideMin", "Outside Min", snapshot.Outside, static s => s.Min, StatusKind.Info, temperatureUnit, unitLabel, localizer),
            BuildTile("analytics.driving.outsideAvg", "Outside Avg", snapshot.Outside, static s => s.Avg, StatusKind.Success, temperatureUnit, unitLabel, localizer),
            BuildTile("analytics.driving.outsideMax", "Outside Max", snapshot.Outside, static s => s.Max, StatusKind.Warning, temperatureUnit, unitLabel, localizer),
        };

        return new DrivingTemperatureDisplay(snapshot.HasData, tiles);
    }

    private static DrivingTemperatureTile BuildTile(
        string labelKey,
        string labelFallback,
        DrivingTemperatureSide? side,
        Func<DrivingTemperatureSide, double> selector,
        StatusKind accent,
        TemperatureUnit temperatureUnit,
        string unitLabel,
        ILocalizer localizer)
    {
        string label = localizer.GetString(labelKey, labelFallback);
        string accentBrushKey = StatusResources.AccentBrushKey(accent);

        string value = side is null
            ? EmDash
            : ScalarFormatters.FormatNumber(
                UnitConverters.TemperatureFromSi(selector(side), temperatureUnit),
                TemperaturePrecision);

        // web subtitle ('°C'/'°F') is always passed, even for an em-dash cell; the Narrator name only
        // appends the unit when there is a real value to read.
        string automationName = string.Equals(value, EmDash, StringComparison.Ordinal)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unitLabel);

        return new DrivingTemperatureTile(label, value, unitLabel, accentBrushKey, automationName);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;DrivingTemperatureSnapshot&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class DrivingTemperatureStatsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The typed emission with the same status / freshness.</returns>
    public static RepositoryResult<DrivingTemperatureSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        DrivingTemperatureSnapshot Parse() =>
            raw.HasValue ? DrivingTemperatureSnapshot.FromJson(raw.Value) : DrivingTemperatureSnapshot.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<DrivingTemperatureSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<DrivingTemperatureSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<DrivingTemperatureSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<DrivingTemperatureSnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<DrivingTemperatureSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<DrivingTemperatureSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<DrivingTemperatureSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Driving Temperature Stats surface — the native mirror of the web
/// component (web/src/features/analytics/components/analytics/DrivingTemperatureStats.tsx). Centralises the
/// stable id, the diagnostics slug and the localized panel title so the view and view-model stay free of
/// literal copy.
/// </summary>
public static class DrivingTemperatureStatsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "driving-temperature-stats";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "DrivingTemperatureStats";

    /// <summary>Localized panel title (web <c>analytics.driving.tempStats</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized "Temperature Stats" title.</returns>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.driving.tempStats", "Temperature Stats");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the Driving Temperature Stats surface (P1/S11 diagnostics contract). Records
/// only the operational <c>view.opened</c> event with the surface slug — never a temperature value, VIN or
/// fleet metric — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DrivingTemperatureStatsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each diagnostics line.</param>
    public DrivingTemperatureStatsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DrivingTemperatureStats</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DrivingTemperatureStatsRegistration.Slug}");
    }
}
