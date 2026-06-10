using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state an <see cref="ElevationChartViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches a P2 feature surface must render for the web
/// Elevation Profile chart (web/src/features/driving/components/drive-detail/ElevationChart.tsx). The web
/// component is a pure child of the Drive-Detail page that draws an empty "No telemetry data available"
/// empty state when its <c>chartData</c> prop holds one sample or fewer; the native feature-view owns its
/// cache-then-network drive-telemetry read and therefore renders the full state matrix. Every branch maps
/// onto a visible surface; none is hidden. <see cref="Empty"/> mirrors the web <c>chartData.length &gt; 1</c>
/// gate (no vehicle, no drive, or a curve too short to plot) and is distinct from a transport failure
/// (<see cref="Error"/>).
/// </summary>
public enum ElevationChartState
{
    /// <summary>Initial fetch with no cached telemetry — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) drive trace with at least two samples to plot.</summary>
    Loaded,

    /// <summary>No vehicle / drive resolved, or a curve too short to plot — render the friendly empty state.</summary>
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
/// <c>DriveTelemetryPoint</c> in <c>@/types/driving</c>). Only the fields the web Elevation Profile chart
/// reads are kept: the timestamp (X axis), the SI <c>elevation</c> in metres (web <c>elevation</c>, displayed
/// in metres without conversion) and the SI <c>speed</c> in m/s (web <c>speed</c>, converted to the user's
/// display unit). Parsing is null-tolerant so a partial row never throws; a missing metric stays null and the
/// web's <c>?? 0</c> coalescing is applied at projection time.
/// </summary>
/// <param name="TimestampUtc">Sample instant, or null (web <c>timestamp</c> with <c>created_at</c> fallback).</param>
/// <param name="ElevationM">Elevation in SI metres, or null (web <c>elevation</c>).</param>
/// <param name="SpeedMps">Speed in SI metres-per-second, or null (web <c>speed</c>).</param>
public sealed record ElevationSample(
    DateTimeOffset? TimestampUtc,
    double? ElevationM,
    double? SpeedMps)
{
    /// <summary>Parse a drive-telemetry JSON array into a tolerant list of samples, preserving order.</summary>
    public static IReadOnlyList<ElevationSample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ElevationSample>();
        }

        var list = new List<ElevationSample>(element.GetArrayLength());
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
    public static ElevationSample FromJson(JsonElement obj) => new(
        // Web parity: the hook reads `tp.createdAt ?? tp.created_at ?? tp.timestamp`; the Go telemetry
        // handler emits `created_at`, so try `timestamp` first then `created_at`.
        GetDateTime(obj, "timestamp") ?? GetDateTime(obj, "created_at"),
        GetDouble(obj, "elevation"),
        GetDouble(obj, "speed"));

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
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.String when DateTimeOffset.TryParse(
                v.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var ts) => ts,
            _ => null,
        };
    }
}

/// <summary>
/// One projected, render-ready point of the elevation trace — the native analogue of a single web
/// <c>ChartDataPoint</c> as consumed by the Elevation Profile chart. Holds the X-axis <see cref="TimeLabel"/>
/// (24-hour local <c>HH:mm</c>), the display-unit metrics (<see cref="ElevationM"/> in metres for the tooltip
/// / automation summary, <see cref="SpeedDisplay"/> in the user's speed unit) and the two pre-normalized
/// ratios the view scales into pixels: <see cref="ElevationRatio"/> on the left "elev" axis (the web
/// <c>Area</c>) and <see cref="SpeedRatio"/> on the right "speed" axis (the web <c>Line</c>). Pure data so the
/// geometry is unit-tested without a UI host.
/// </summary>
/// <param name="TimeLabel">24-hour local <c>HH:mm</c> X-axis label (web <c>time</c>).</param>
/// <param name="ElevationM">Elevation in SI metres (web <c>elevation</c>, rendered as metres).</param>
/// <param name="SpeedDisplay">Speed in the user's display unit (web <c>speed</c>).</param>
/// <param name="ElevationRatio">Elevation normalized 0..1 across the trace min..max (left "elev" axis).</param>
/// <param name="SpeedRatio">Speed normalized 0..1 across 0..max (right "speed" axis).</param>
public sealed record ElevationChartPoint(
    string TimeLabel,
    double ElevationM,
    double SpeedDisplay,
    double ElevationRatio,
    double SpeedRatio);

/// <summary>
/// The fully projected elevation chart — the native analogue of the web recharts <c>ComposedChart</c> (an
/// elevation <c>Area</c> on the left "elev" axis plus a speed <c>Line</c> on the right "speed" axis). Holds
/// the normalized <see cref="Points"/>, the localized series names (the speed name carries the active unit),
/// the per-axis bound labels and a spoken automation summary. Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Points">The normalized, chronological trace points.</param>
/// <param name="ElevationSeriesName">Localized elevation series name (web "Elevation (m)").</param>
/// <param name="SpeedSeriesName">Localized speed series name carrying the active unit (web "Speed (km/h)").</param>
/// <param name="ElevAxisMaxLabel">Left-axis upper bound label (highest elevation, integer metres).</param>
/// <param name="ElevAxisMinLabel">Left-axis lower bound label (lowest elevation, integer metres).</param>
/// <param name="SpeedAxisMaxLabel">Right-axis upper bound label (highest speed, integer display units).</param>
/// <param name="AutomationName">Spoken summary of the chart (series + sample count).</param>
public sealed record ElevationChartModel(
    IReadOnlyList<ElevationChartPoint> Points,
    string ElevationSeriesName,
    string SpeedSeriesName,
    string ElevAxisMaxLabel,
    string ElevAxisMinLabel,
    string SpeedAxisMaxLabel,
    string AutomationName)
{
    /// <summary>True when there are at least two samples to plot (web <c>chartData.length &gt; 1</c>).</summary>
    public bool HasPoints => Points.Count > 1;
}

/// <summary>
/// The elevation gain / loss / net readouts shown above the chart — the native analogue of the web stat row
/// (<c>{fmtNumber(stats.elevGain)} m gain</c> / <c>{fmtNumber(stats.elevLoss)} m loss</c> /
/// <c>Net: {fmtNumber(stats.elevGain - stats.elevLoss)} m</c>). Carries both the raw SI metres (for tests /
/// automation) and the formatted, unit-suffixed display strings. Net is gain minus loss and may be negative.
/// </summary>
/// <param name="GainM">Total elevation gained over the trace, in SI metres.</param>
/// <param name="LossM">Total elevation lost over the trace, in SI metres.</param>
/// <param name="NetM">Net elevation change (<see cref="GainM"/> − <see cref="LossM"/>), in SI metres.</param>
/// <param name="GainText">Formatted gain with the metre unit (web "120 m").</param>
/// <param name="LossText">Formatted loss with the metre unit (web "85 m").</param>
/// <param name="NetText">Formatted net change with the metre unit (web "35 m").</param>
public sealed record ElevationStats(
    double GainM,
    double LossM,
    double NetM,
    string GainText,
    string LossText,
    string NetText);

/// <summary>
/// The fully projected, render-ready view of the Elevation Profile surface — the native analogue of
/// everything the web component computes before returning its <c>ChartContainer</c>. Carries the
/// always-present chrome strings (title / chart aria / empty message), the <see cref="HasData"/> gate
/// (web <c>chartData.length &gt; 1</c>), the gain/loss/net <see cref="Stats"/> with their localized labels and
/// the normalized chart. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when the trace is plottable (web <c>chartData.length &gt; 1</c>).</param>
/// <param name="Title">Localized surface title (web "Elevation Profile").</param>
/// <param name="ChartAriaLabel">Localized accessible chart summary (web aria label).</param>
/// <param name="EmptyMessage">Localized empty-state message (web "No telemetry data available").</param>
/// <param name="GainLabel">Localized gain label (web "gain").</param>
/// <param name="LossLabel">Localized loss label (web "loss").</param>
/// <param name="NetLabel">Localized net label (web "Net").</param>
/// <param name="Stats">The gain / loss / net readouts.</param>
/// <param name="Chart">The normalized elevation + speed chart.</param>
public sealed record ElevationChartDisplay(
    bool HasData,
    string Title,
    string ChartAriaLabel,
    string EmptyMessage,
    string GainLabel,
    string LossLabel,
    string NetLabel,
    ElevationStats Stats,
    ElevationChartModel Chart);

/// <summary>
/// Pure projection from the raw drive-telemetry samples to the display model — the native port of the web
/// <c>chartData</c> mapping (<c>elevation: tp.elevation ?? 0</c>, <c>speed: convertSpeedFromSI(...)</c>), the
/// <c>elevGain</c> / <c>elevLoss</c> reductions and the composed Area+Line chart in
/// web/src/features/driving/components/drive-detail/ElevationChart.tsx (+ useDriveDetailData.ts). Elevation
/// stays in SI metres (the web renders it as metres); speed is converted from SI m/s to the user's display
/// unit. The web's two recharts Y axes are reproduced by pre-normalizing elevation to a 0..1 ratio across the
/// trace min..max (left "elev" axis) and speed across 0..max (right "speed" axis). Every label resolves
/// through the i18n facade; series colours map onto the shared design-token brushes.
/// </summary>
public static class ElevationChartProjection
{
    /// <summary>Design-token brush key for the elevation area (web <c>#10b981</c> = exact <c>TsColorSuccessBrush</c>).</summary>
    public const string ElevationBrushKey = "TsColorSuccessBrush";

    /// <summary>Design-token brush key for the speed line (web <c>#a855f7</c> = exact <c>TsChartPowerBrush</c>).</summary>
    public const string SpeedBrushKey = "TsChartPowerBrush";

    /// <summary>The elevation metre unit suffix (web <c>{value} m</c>).</summary>
    public const string ElevationUnit = "m";

    /// <summary>Web global formatter default <c>maximumFractionDigits</c> (<c>_globalPrecision = 2</c>).</summary>
    public const int DefaultPrecision = 2;

    private const int IntegerPrecision = 0;
    private const double FlatRatio = 0.5;

    /// <summary>Project <paramref name="samples"/> into the display model for <paramref name="units"/>.</summary>
    /// <param name="samples">The drive-telemetry samples (chronological; the projection preserves order).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static ElevationChartDisplay Project(
        IReadOnlyList<ElevationSample> samples,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var chart = BuildChart(samples, units, localizer);
        var stats = BuildStats(samples, units, localizer);

        return new ElevationChartDisplay(
            HasData: chart.HasPoints,
            Title: localizer.GetString("driveDetail.elevProfile", "Elevation Profile"),
            ChartAriaLabel: localizer.GetString(
                "driveDetail.elevProfile.aria",
                "Elevation and speed area+line chart over the drive timeline"),
            EmptyMessage: localizer.GetString("driveDetail.noChartData", "No telemetry data available"),
            GainLabel: localizer.GetString("driveDetail.gain", "gain"),
            LossLabel: localizer.GetString("driveDetail.loss", "loss"),
            NetLabel: localizer.GetString("driveDetail.net", "Net"),
            Stats: stats,
            Chart: chart);
    }

    /// <summary>Project the empty (no drive / too-short curve) display using the localizer.</summary>
    public static ElevationChartDisplay Empty(UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        return Project(Array.Empty<ElevationSample>(), units, localizer);
    }

    private static ElevationChartModel BuildChart(
        IReadOnlyList<ElevationSample> samples,
        UnitPref units,
        ILocalizer localizer)
    {
        // First pass: coalesce to display values (web `elevation ?? 0`, `convertSpeedFromSI(speed ?? 0)`) and
        // find the elevation min/max (left "elev" axis, auto-domain) and the speed max (right "speed" axis,
        // anchored at zero).
        var elevation = new double[samples.Count];
        var speedDisplay = new double[samples.Count];

        double elevMin = double.PositiveInfinity;
        double elevMax = double.NegativeInfinity;
        double speedMax = 0;

        for (int i = 0; i < samples.Count; i++)
        {
            var s = samples[i];
            double elev = s.ElevationM ?? 0;
            double speed = UnitConverters.SpeedFromSi(s.SpeedMps ?? 0, units.Speed);
            elevation[i] = elev;
            speedDisplay[i] = speed;
            elevMin = Math.Min(elevMin, elev);
            elevMax = Math.Max(elevMax, elev);
            speedMax = Math.Max(speedMax, speed);
        }

        if (samples.Count == 0)
        {
            elevMin = 0;
            elevMax = 0;
        }

        double elevRange = elevMax - elevMin;
        double speedAxisMax = speedMax > 0 ? speedMax : 1;

        var points = new List<ElevationChartPoint>(samples.Count);
        for (int i = 0; i < samples.Count; i++)
        {
            var s = samples[i];
            string label = s.TimestampUtc is { } ts
                ? ts.LocalDateTime.ToString("HH:mm", CultureInfo.InvariantCulture)
                : string.Empty;

            points.Add(new ElevationChartPoint(
                TimeLabel: label,
                ElevationM: elevation[i],
                SpeedDisplay: speedDisplay[i],
                ElevationRatio: elevRange > 0 ? Math.Clamp((elevation[i] - elevMin) / elevRange, 0.0, 1.0) : FlatRatio,
                SpeedRatio: Math.Clamp(speedDisplay[i] / speedAxisMax, 0.0, 1.0)));
        }

        string speedUnit = UnitLabels.Label(units.Speed);

        return new ElevationChartModel(
            Points: points,
            ElevationSeriesName: $"{localizer.GetString("driveDetail.elevation", "Elevation")} ({ElevationUnit})",
            SpeedSeriesName: $"{localizer.GetString("driveDetail.speed", "Speed")} ({speedUnit})",
            ElevAxisMaxLabel: Fmt(elevMax, IntegerPrecision),
            ElevAxisMinLabel: Fmt(elevMin, IntegerPrecision),
            SpeedAxisMaxLabel: Fmt(speedAxisMax, IntegerPrecision),
            AutomationName: ChartAutomationName(points.Count, localizer));
    }

    private static ElevationStats BuildStats(
        IReadOnlyList<ElevationSample> samples,
        UnitPref units,
        ILocalizer localizer)
    {
        // Web parity (useDriveDetailData): elevGain/elevLoss reduce consecutive elevation deltas; the first
        // sample contributes nothing. elevation defaults to 0 when missing (web `tp.elevation ?? 0`).
        double gain = 0;
        double loss = 0;
        for (int i = 1; i < samples.Count; i++)
        {
            double diff = (samples[i].ElevationM ?? 0) - (samples[i - 1].ElevationM ?? 0);
            if (diff > 0)
            {
                gain += diff;
            }
            else if (diff < 0)
            {
                loss += -diff;
            }
        }

        double net = gain - loss;
        int precision = units.Precision ?? DefaultPrecision;
        _ = localizer;

        return new ElevationStats(
            GainM: gain,
            LossM: loss,
            NetM: net,
            GainText: $"{Fmt(gain, precision)} {ElevationUnit}",
            LossText: $"{Fmt(loss, precision)} {ElevationUnit}",
            NetText: $"{Fmt(net, precision)} {ElevationUnit}");
    }

    private static string ChartAutomationName(int sampleCount, ILocalizer localizer)
    {
        string template = localizer.GetString(
            "driveDetail.elevChart.summary",
            "Elevation and speed over {0} samples");
        return string.Format(CultureInfo.CurrentCulture, template, sampleCount.ToString(CultureInfo.CurrentCulture));
    }

    // Web parity: fmtNumber coerces NaN / ±∞ to 0 (safeNumber) then renders with fixed fraction digits.
    private static string Fmt(double value, int precision)
    {
        double safe = !double.IsNaN(value) && !double.IsInfinity(value) ? value : 0.0;
        return ScalarFormatters.FormatNumber(safe, precision);
    }
}

/// <summary>
/// Canonical registry metadata for the Elevation Profile surface — the native mirror of the web drive-detail
/// feature component (web/src/features/driving/components/drive-detail/ElevationChart.tsx). Hosting binds this
/// surface with the stable <see cref="Id"/>; diagnostics tag it with <see cref="Slug"/>.
/// </summary>
public static class ElevationChartRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "elevation-chart";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ElevationChart";

    /// <summary>Localized surface title (web "Elevation Profile").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("driveDetail.elevProfile", "Elevation Profile");
    }
}

/// <summary>
/// PII-safe diagnostics for the Elevation Profile surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an elevation, speed, gain/loss figure,
/// sample count, VIN, vehicle id or drive id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class ElevationChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ElevationChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ElevationChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ElevationChartRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw drive-telemetry <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;ElevationSample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// <c>chartData.length &gt; 1</c> gate (the web empty-state branch) is applied by the view-model, not
/// here, so a short / empty trace still flows through with its freshness intact. Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ElevationChartResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s telemetry payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<ElevationSample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<ElevationSample> Parse() =>
            raw.HasValue ? ElevationSample.ParseList(raw.Value) : Array.Empty<ElevationSample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<ElevationSample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<ElevationSample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<ElevationSample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<ElevationSample>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<ElevationSample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<ElevationSample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<ElevationSample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
