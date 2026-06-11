using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="TripReplayChartsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches a P2 feature surface must render for the web
/// Trip-Replay Speed &amp; Power timeline (web/src/features/trips/components/TripReplayCharts.tsx). The web
/// component is a pure child of the Trip-Replay page that draws an empty "No telemetry data available" state
/// when its <c>data</c> prop is empty; the native feature-view owns its cache-then-network drive-telemetry
/// read and therefore renders the full state matrix. Every branch maps onto a visible surface; none is
/// hidden. <see cref="Empty"/> mirrors the web <c>data.length === 0</c> gate (no vehicle, no drive, or no
/// telemetry) and is distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum TripReplayChartsState
{
    /// <summary>Initial fetch with no cached telemetry — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) drive trace with at least one sample to plot.</summary>
    Loaded,

    /// <summary>No vehicle / drive resolved, or no telemetry — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached trace exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached trace older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached trace remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One drive-telemetry sample projected from the per-drive telemetry response (web
/// <c>DriveTelemetryPoint</c> in <c>@/types/driving</c>). Only the three fields the web Trip-Replay timeline
/// reads are kept: the timestamp (the X axis is minutes-since-trip-start derived from it), the SI
/// <c>speed</c> in m/s (web <c>speed</c>, converted to the user's display unit) and the <c>power</c> in
/// kilowatts (web <c>power</c>, already kW at this presentational boundary — exactly as the web component
/// receives it; cf. PowerOutputChart). Parsing is null-tolerant so a partial row never throws; a missing
/// metric stays null and the web's <c>?? 0</c> coalescing is applied at projection time.
/// </summary>
/// <param name="TimestampUtc">Sample instant, or null (web <c>timestamp</c> with <c>created_at</c> fallback).</param>
/// <param name="SpeedMps">Speed in SI metres-per-second, or null (web <c>speed</c>).</param>
/// <param name="PowerKw">Power in kilowatts, or null (web <c>power</c>).</param>
public sealed record TripReplaySample(
    DateTimeOffset? TimestampUtc,
    double? SpeedMps,
    double? PowerKw)
{
    /// <summary>Parse a drive-telemetry JSON array into a tolerant list of samples, preserving order.</summary>
    public static IReadOnlyList<TripReplaySample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TripReplaySample>();
        }

        var list = new List<TripReplaySample>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single drive-telemetry JSON object into a tolerant sample.</summary>
    public static TripReplaySample FromJson(JsonElement obj) => new(
        // Web parity: the page reads `p.timestamp ?? p.created_at ?? p.createdAt`; the Go telemetry handler
        // emits `created_at`, so try `timestamp` first then `created_at`.
        GetDateTime(obj, "timestamp") ?? GetDateTime(obj, "created_at"),
        GetDouble(obj, "speed"),
        GetDouble(obj, "power"));

    private static double? GetDouble(JsonElement obj, string name)
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

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var ts)
            ? ts
            : null;
    }
}

/// <summary>
/// One projected, render-ready point of the trip-replay timeline — the native analogue of a single web
/// <c>TripReplayChartPoint</c> ({ index, time, speed, power }). Holds the parent-array <see cref="Index"/>
/// (forwarded to the seek callback), the <see cref="Time"/> in minutes-since-trip-start (the chart X axis and
/// the value the persistent cursor-sync store carries), the <see cref="Speed"/> in the user's display unit
/// (left axis) and the <see cref="Power"/> in kilowatts (right axis). Pure data so the projection and the
/// nearest-sample lookup are unit-tested without a UI host.
/// </summary>
/// <param name="Index">Index into the parent telemetry array (web <c>TripReplayChartPoint.index</c>).</param>
/// <param name="Time">Minutes since trip start, to three decimals (web <c>time</c>).</param>
/// <param name="Speed">Speed in the user's display unit (web <c>speed</c>).</param>
/// <param name="Power">Power in kilowatts (web <c>power</c>).</param>
public sealed record TripReplayChartPoint(int Index, double Time, double Speed, double Power);

/// <summary>
/// The fully projected timeline — the native analogue of the web recharts <c>AreaChart</c> (a speed
/// <c>Area</c> on the left axis plus a power <c>Area</c> on the right axis, in kW). Holds the chronological
/// <see cref="Points"/>, the localized series names (web "Speed" / "Power"), the per-axis bounds the view
/// scales into pixels (<see cref="SpeedAxisMax"/> anchored at zero; power across
/// <see cref="PowerAxisMin"/>..<see cref="PowerAxisMax"/> to keep regen visible), the two axis unit labels
/// (web left <c>speedUnit</c> / right literal <c>kW</c>) and a spoken automation summary. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="Points">The chronological timeline points.</param>
/// <param name="SpeedAxisMax">Left-axis upper bound (highest display-unit speed; 0 ⇒ a unit fallback).</param>
/// <param name="PowerAxisMin">Right-axis lower bound (lowest kW; negative when regen is present).</param>
/// <param name="PowerAxisMax">Right-axis upper bound (highest kW).</param>
/// <param name="SpeedSeriesName">Localized speed series name (web "Speed").</param>
/// <param name="PowerSeriesName">Localized power series name (web "Power").</param>
/// <param name="SpeedUnitLabel">Left-axis unit label (web <c>speedUnit</c>, e.g. "mph").</param>
/// <param name="PowerUnitLabel">Right-axis unit label (web literal "kW").</param>
/// <param name="AutomationName">Spoken summary of the chart (series + sample count).</param>
public sealed record TripReplayTimelineModel(
    IReadOnlyList<TripReplayChartPoint> Points,
    double SpeedAxisMax,
    double PowerAxisMin,
    double PowerAxisMax,
    string SpeedSeriesName,
    string PowerSeriesName,
    string SpeedUnitLabel,
    string PowerUnitLabel,
    string AutomationName)
{
    /// <summary>True when there is at least one sample to plot (web <c>data.length &gt; 0</c>).</summary>
    public bool HasPoints => Points.Count > 0;
}

/// <summary>
/// The fully projected, render-ready view of the Trip-Replay timeline surface — the native analogue of
/// everything the web component computes before returning its <c>ChartContainer</c>. Carries the
/// always-present chrome strings (title / subtitle / chart aria / empty message), the <see cref="HasData"/>
/// gate (web <c>data.length &gt; 0</c>) and the projected <see cref="Timeline"/>. Pure data so the projection
/// is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when the trace is plottable (web <c>data.length &gt; 0</c>).</param>
/// <param name="Title">Localized surface title (web "Speed &amp; Power Timeline").</param>
/// <param name="Subtitle">Localized supporting sub-heading (web "Click to seek replay position").</param>
/// <param name="ChartAriaLabel">Localized accessible chart summary (web aria label).</param>
/// <param name="EmptyMessage">Localized empty-state message (web "No telemetry data available").</param>
/// <param name="Timeline">The projected speed + power timeline.</param>
public sealed record TripReplayChartsDisplay(
    bool HasData,
    string Title,
    string Subtitle,
    string ChartAriaLabel,
    string EmptyMessage,
    TripReplayTimelineModel Timeline);

/// <summary>
/// Pure projection from the raw drive-telemetry samples to the display model — the native port of the web
/// <c>timelineData</c> <c>useMemo</c> (<c>time: (ts - t0) / 60_000</c>, <c>speed: convertSpeedFromSI(...)</c>,
/// <c>power: p.power ?? 0</c>) in web/src/features/trips/pages/TripReplayPage.tsx, consumed by
/// web/src/features/trips/components/TripReplayCharts.tsx. The X axis is minutes since the first sample;
/// speed is converted from SI m/s to the user's display unit; power stays in kilowatts (already kW at this
/// boundary). The web's two recharts Y axes are reproduced by exposing the per-axis bounds the view
/// normalizes into pixels. Every label resolves through the i18n facade.
/// </summary>
public static class TripReplayChartsProjection
{
    /// <summary>The right-axis unit the power series is expressed in (web literal <c>'kW'</c>).</summary>
    public const string PowerUnit = "kW";

    /// <summary>Decimals the X-axis minute value is rounded to (web <c>elapsedMin.toFixed(3)</c>).</summary>
    public const int TimeDecimals = 3;

    private const int AxisLabelDecimals = 0;

    /// <summary>Project <paramref name="samples"/> into the display model for <paramref name="units"/>.</summary>
    /// <param name="samples">The drive-telemetry samples (chronological; the projection preserves order).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); only the speed unit is read.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static TripReplayChartsDisplay Project(
        IReadOnlyList<TripReplaySample> samples,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var timeline = BuildTimeline(samples, units, localizer);

        return new TripReplayChartsDisplay(
            HasData: timeline.HasPoints,
            Title: localizer.GetString("replay.timeline.title", "Speed & Power Timeline"),
            Subtitle: localizer.GetString("replay.timeline.subtitle", "Click to seek replay position"),
            ChartAriaLabel: localizer.GetString(
                "replay.timeline.aria",
                "Trip replay speed and power timeline area chart"),
            EmptyMessage: localizer.GetString("replay.timeline.noData", "No telemetry data available"),
            Timeline: timeline);
    }

    /// <summary>Project the empty (no drive / no telemetry) display using the localizer.</summary>
    public static TripReplayChartsDisplay Empty(UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        return Project(Array.Empty<TripReplaySample>(), units, localizer);
    }

    /// <summary>
    /// Binary-search the timeline for the point whose <see cref="TripReplayChartPoint.Time"/> is closest to
    /// <paramref name="target"/> — the native port of the web <c>nearestIndexByTime</c> that the cursor-sync
    /// bridge uses to translate a hovered / clicked X value into a seek index. The list is chronological, so
    /// the search is O(log n); on a tie the later sample (the first at or after <paramref name="target"/>)
    /// wins, matching the web's strict <c>&lt;</c> comparison.
    /// </summary>
    public static int NearestIndexByTime(IReadOnlyList<TripReplayChartPoint> data, double target)
    {
        ArgumentNullException.ThrowIfNull(data);
        if (data.Count == 0)
        {
            return 0;
        }

        int lo = 0;
        int hi = data.Count - 1;
        while (lo < hi)
        {
            int mid = (lo + hi) / 2;
            if (data[mid].Time < target)
            {
                lo = mid + 1;
            }
            else
            {
                hi = mid;
            }
        }

        if (lo > 0 && target - data[lo - 1].Time < data[lo].Time - target)
        {
            return lo - 1;
        }

        return lo;
    }

    private static TripReplayTimelineModel BuildTimeline(
        IReadOnlyList<TripReplaySample> samples,
        UnitPref units,
        ILocalizer localizer)
    {
        // Web parity: t0 = positions[0].timestamp. A missing first timestamp leaves every elapsed minute at
        // zero rather than producing NaN (the web assumes a dated first sample).
        DateTimeOffset? t0 = samples.Count > 0 ? samples[0].TimestampUtc : null;

        var points = new List<TripReplayChartPoint>(samples.Count);
        double speedMax = 0;
        double powerMin = double.PositiveInfinity;
        double powerMax = double.NegativeInfinity;

        for (int i = 0; i < samples.Count; i++)
        {
            var s = samples[i];
            double time = t0 is { } start && s.TimestampUtc is { } ts
                ? Math.Round((ts - start).TotalMinutes, TimeDecimals, MidpointRounding.AwayFromZero)
                : 0;
            double speed = UnitConverters.SpeedFromSi(s.SpeedMps ?? 0, units.Speed);
            double power = s.PowerKw ?? 0;

            points.Add(new TripReplayChartPoint(i, time, speed, power));

            speedMax = Math.Max(speedMax, speed);
            powerMin = Math.Min(powerMin, power);
            powerMax = Math.Max(powerMax, power);
        }

        if (samples.Count == 0)
        {
            powerMin = 0;
            powerMax = 0;
        }

        string speedUnit = UnitLabels.Label(units.Speed);

        return new TripReplayTimelineModel(
            Points: points,
            SpeedAxisMax: speedMax > 0 ? speedMax : 1,
            PowerAxisMin: powerMin,
            PowerAxisMax: powerMax,
            SpeedSeriesName: localizer.GetString("replay.timeline.speed", "Speed"),
            PowerSeriesName: localizer.GetString("replay.timeline.power", "Power"),
            SpeedUnitLabel: speedUnit,
            PowerUnitLabel: PowerUnit,
            AutomationName: ChartAutomationName(points.Count, localizer));
    }

    private static string ChartAutomationName(int sampleCount, ILocalizer localizer)
    {
        string template = localizer.GetString(
            "replay.timeline.summary",
            "Speed and power over {0} samples");
        return string.Format(CultureInfo.CurrentCulture, template, sampleCount.ToString(CultureInfo.CurrentCulture));
    }

    /// <summary>Format an axis bound to integer display units (web auto-domain tick).</summary>
    public static string FormatAxisLabel(double value)
    {
        double safe = !double.IsNaN(value) && !double.IsInfinity(value) ? value : 0.0;
        return ScalarFormatters.FormatNumber(safe, AxisLabelDecimals);
    }
}

/// <summary>
/// Canonical registry metadata for the Trip-Replay timeline surface — the native mirror of the web trips
/// feature component (web/src/features/trips/components/TripReplayCharts.tsx). Hosting binds this surface
/// with the stable <see cref="Id"/>; diagnostics tag it with <see cref="Slug"/>.
/// </summary>
public static class TripReplayChartsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "trip-replay-charts";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TripReplayCharts";

    /// <summary>Localized surface title (web "Speed &amp; Power Timeline").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("replay.timeline.title", "Speed & Power Timeline");
    }
}

/// <summary>
/// PII-safe diagnostics for the Trip-Replay timeline surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a speed, power figure, sample count,
/// timestamp, VIN, vehicle id or drive id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class TripReplayChartsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TripReplayChartsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TripReplayCharts</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TripReplayChartsRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw drive-telemetry <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;TripReplaySample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// <c>data.length &gt; 0</c> gate (the web empty-state branch) is applied by the view-model, not here, so an
/// empty trace still flows through with its freshness intact. Kept pure so the parse-and-preserve contract
/// is unit-tested without a network or cache.
/// </summary>
public static class TripReplayChartsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s telemetry payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<TripReplaySample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<TripReplaySample> Parse() =>
            raw.HasValue ? TripReplaySample.ParseList(raw.Value) : Array.Empty<TripReplaySample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<TripReplaySample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<TripReplaySample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<TripReplaySample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<TripReplaySample>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<TripReplaySample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<TripReplaySample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<TripReplaySample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
