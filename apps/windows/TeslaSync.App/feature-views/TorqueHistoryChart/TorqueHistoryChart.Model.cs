using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="TorqueHistoryChartViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches a P2 feature surface must render for the web
/// Motor-Torque history chart
/// (web/src/features/driving/components/drivetrain-health/TorqueHistoryChart.tsx). The web component is a pure
/// child of the Drivetrain-Health page that returns <c>null</c> when it has one or fewer motor samples or no
/// non-null torque reading; the native feature-view owns its cache-then-network motor-history read and therefore
/// renders the full state matrix — none is hidden. <see cref="Empty"/> mirrors the web
/// <c>data.length &lt;= 1 || !data.some(d =&gt; d.torque !== null)</c> gate and is distinct from a transport
/// failure (<see cref="Error"/>).
/// </summary>
public enum TorqueHistoryChartState
{
    /// <summary>Initial fetch with no cached samples — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh history (or non-stale cache) carrying at least two samples and one torque reading.</summary>
    Loaded,

    /// <summary>No vehicle resolved, too few samples, or no torque reading — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached history exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached history older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached history remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One motor sample projected from the <c>GET /motor</c> history list (web <c>MotorSnapshot</c> in
/// web/src/api/types.ts). Only the two fields the web <c>TorqueHistoryChart</c> consumes are kept: the raw
/// <c>ts</c> timestamp string (formatted to a clock label exactly as the web
/// <c>s.ts ? formatTime(s.ts) : ''</c> does) and the drive-inverter torque in newton-metres
/// (web <c>s.torque_nm_front ?? s.torque_nm_rear ?? null</c> — already SI, so it is plotted without any unit
/// conversion). Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial row
/// never throws and a missing torque stays null (a chart gap, not a misleading zero).
/// </summary>
/// <param name="Ts">Raw ISO sample timestamp, or null (web <c>ts</c>).</param>
/// <param name="TorqueNm">Front-or-rear axle torque in newton-metres, or null (web <c>torque_nm_front ?? torque_nm_rear</c>).</param>
public sealed record MotorTorqueSample(string? Ts, double? TorqueNm)
{
    /// <summary>Parse a motor-history JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<MotorTorqueSample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<MotorTorqueSample>();
        }

        var list = new List<MotorTorqueSample>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single motor-history JSON object into a tolerant row (web torque fallback chain).</summary>
    public static MotorTorqueSample FromJson(JsonElement obj) => new(
        GetString(obj, "ts"),
        GetDouble(obj, "torque_nm_front") ?? GetDouble(obj, "torque_nm_rear"));

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

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// One render-ready torque point — the native analogue of a web <c>MotorChartDataPoint</c>'s
/// { time, torque } slice. Holds the formatted clock <see cref="TimeLabel"/> (empty when the sample had no
/// timestamp, exactly like the web <c>''</c> fallback), the raw <see cref="TorqueNm"/> the area plots
/// (null = a chart gap), its formatted text for the accessible data table, and a Narrator automation name.
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="TimeLabel">Formatted clock label, or the empty string for a sample with no timestamp.</param>
/// <param name="TorqueNm">Raw torque in newton-metres the area plots, or null (a gap).</param>
/// <param name="TorqueText">Formatted <see cref="TorqueNm"/> (integer Nm) for the data table, or the em dash.</param>
/// <param name="AutomationName">Spoken summary of the point (time + torque with unit).</param>
public sealed record TorquePoint(string TimeLabel, double? TorqueNm, string TorqueText, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Motor-Torque history chart — the native analogue of
/// everything the web component reads before returning its <c>ChartContainer</c>. Holds the always-present
/// chrome strings (title / subtitle / chart aria / series + axis + column labels), the ordered torque points,
/// and the <see cref="HasData"/> gate (web <c>data.length &gt; 1 &amp;&amp; data.some(d =&gt; d.torque !== null)</c>).
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record TorqueHistoryChartDisplay(
    bool HasData,
    IReadOnlyList<TorquePoint> Points,
    string Title,
    string Subtitle,
    string ChartAriaLabel,
    string SeriesLabel,
    string AxisLabel,
    string TimeColumnLabel,
    string TorqueColumnLabel);

/// <summary>
/// Pure projection from the raw motor-history list to the display model — the native port of the
/// <c>motorChartData</c> <c>useMemo</c> (the <c>time</c> / <c>torque</c> reads) and the empty-chart gate in
/// web/src/features/driving/pages/DrivetrainHealthPage.tsx + components/drivetrain-health/TorqueHistoryChart.tsx.
/// Each sample's timestamp is formatted to a clock label, its torque kept as the raw SI newton-metre value
/// (torque carries no user unit preference, so it is never converted), and the web render gate is reproduced:
/// at least two samples and at least one non-null torque. Every label resolves through the i18n facade; the
/// area's line color maps onto the shared categorical palette (the web cyan <c>#00f0ff</c>).
/// </summary>
public static class TorqueHistoryChartProjection
{
    /// <summary>The display unit torque is expressed in (web literal <c>Nm</c>); torque is already SI.</summary>
    public const string TorqueUnit = "Nm";

    /// <summary>Categorical palette index for the torque area (web <c>stroke="#00f0ff"</c> cyan = info token).</summary>
    public const int SeriesColorIndex = 0;

    /// <summary>The horizontal reference-line value drawn across the plot (web <c>ReferenceLine y={0}</c>).</summary>
    public const double ReferenceLineValue = 0;

    /// <summary>Em dash shown when a point has no value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    private const int TorqueDecimals = 0; // web fmtInt — torque is shown as a whole newton-metre figure

    /// <summary>Project <paramref name="samples"/> into the display model, resolving every label via <paramref name="localizer"/>.</summary>
    /// <param name="samples">The motor-history samples (order preserved; the chart plots them as received).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static TorqueHistoryChartDisplay Project(IReadOnlyList<MotorTorqueSample> samples, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(localizer);

        string seriesLabel = string.Create(
            CultureInfo.CurrentCulture,
            $"{localizer.GetString("drivetrain.torque", "Torque")} ({TorqueUnit})");

        var points = BuildPoints(samples, seriesLabel);

        // Web parity: data.length <= 1 || !data.some(d => d.torque !== null) → render nothing (the native empty state).
        bool hasData = points.Count > 1 && points.Any(static p => p.TorqueNm.HasValue);

        return new TorqueHistoryChartDisplay(
            HasData: hasData,
            Points: points,
            Title: localizer.GetString("drivetrain.torqueHistory", "Motor Torque"),
            Subtitle: localizer.GetString("drivetrain.torqueHistorySub", "Drive inverter torque output over time"),
            ChartAriaLabel: localizer.GetString(
                "drivetrain.torqueHistory.aria",
                "Motor inverter torque output history area chart"),
            SeriesLabel: seriesLabel,
            AxisLabel: localizer.GetString("drivetrain.col.torque", "Torque (Nm)"),
            TimeColumnLabel: localizer.GetString("drivetrain.col.time", "Time"),
            TorqueColumnLabel: localizer.GetString("drivetrain.col.torque", "Torque (Nm)"));
    }

    private static List<TorquePoint> BuildPoints(IReadOnlyList<MotorTorqueSample> samples, string seriesLabel)
    {
        var points = new List<TorquePoint>(samples.Count);
        foreach (var sample in samples)
        {
            string time = FormatTime(sample.Ts);
            string torqueText = ScalarFormatters.FormatNumber(sample.TorqueNm, TorqueDecimals, EmDash);
            points.Add(new TorquePoint(
                TimeLabel: time,
                TorqueNm: sample.TorqueNm,
                TorqueText: torqueText,
                AutomationName: RowAutomationName(time, torqueText, sample.TorqueNm.HasValue)));
        }

        return points;
    }

    // Web parity: time = s.ts ? formatTime(s.ts) : ''. A missing / unparseable timestamp yields the empty string.
    private static string FormatTime(string? ts)
    {
        if (string.IsNullOrEmpty(ts) ||
            !DateTimeOffset.TryParse(ts, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dt))
        {
            return string.Empty;
        }

        return DateTimeFormatting.Format(dt, DateTimeVariant.Time, dt);
    }

    private static string RowAutomationName(string time, string torqueText, bool hasTorque)
    {
        string timeText = string.IsNullOrEmpty(time) ? EmDash : time;
        return hasTorque
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", timeText, torqueText, TorqueUnit)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1}", timeText, torqueText);
    }
}

/// <summary>
/// Canonical registry metadata for the Motor-Torque history surface — the native mirror of the web
/// drivetrain-health feature component
/// (web/src/features/driving/components/drivetrain-health/TorqueHistoryChart.tsx). Hosting binds this surface
/// with the stable <see cref="Id"/>; diagnostics tag it with <see cref="Slug"/>.
/// </summary>
public static class TorqueHistoryChartRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "torque-history-chart";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TorqueHistoryChart";

    /// <summary>Localized surface title (web "Motor Torque").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("drivetrain.torqueHistory", "Motor Torque");
    }
}

/// <summary>
/// PII-safe diagnostics for the Motor-Torque history surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a torque figure, timestamp, sample count,
/// VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class TorqueHistoryChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TorqueHistoryChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TorqueHistoryChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TorqueHistoryChartRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;MotorTorqueSample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// <c>hasData</c> gate (web's null-render branch) is applied by the view-model, not here, so an empty list still
/// flows through with its freshness intact. Kept pure so the parse-and-preserve contract is unit-tested without
/// a network or cache.
/// </summary>
public static class TorqueHistoryChartResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<MotorTorqueSample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<MotorTorqueSample> Parse() =>
            raw.HasValue ? MotorTorqueSample.ParseList(raw.Value) : Array.Empty<MotorTorqueSample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<MotorTorqueSample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
