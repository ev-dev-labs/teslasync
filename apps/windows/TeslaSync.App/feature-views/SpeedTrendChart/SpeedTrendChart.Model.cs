using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="SpeedTrendChartViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches a P2 feature surface must render for the
/// web Charging-Speed-Trend chart (web/src/features/charging/components/charging-curve/SpeedTrendChart.tsx).
/// The web component is a pure child of the Charging-Curve page that draws an empty chart when its
/// <c>sessions</c> prop is empty; the native feature-view owns its cache-then-network charging-session read
/// and therefore renders the full state matrix. Every branch maps onto a visible surface; none is hidden.
/// <see cref="Empty"/> mirrors the web <c>monthlyTrend.length === 0</c> gate (no sessions to chart) and is
/// distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum SpeedTrendChartState
{
    /// <summary>Initial fetch with no cached sessions — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh list (or non-stale cache) carrying at least one month of charge sessions to chart.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or no sessions — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One charging session projected from the charging-sessions list (web <c>ChargingSession</c> in
/// web/src/api/types.ts). Only the three fields the web <c>SpeedTrendChart</c> reads are kept: the SI peak
/// power in watts (<c>peak_power_w</c>, converted to kW and averaged), the free-text <c>charger_type</c>
/// (used by the web <c>isDcSession</c> DC/AC split), and the raw <c>started_at</c> string (sliced to its
/// <c>YYYY-MM</c> month prefix exactly as the web <c>started_at.slice(0, 7)</c> does — kept as the wire
/// string so the month bucketing matches the web byte-for-byte rather than round-tripping a parsed instant).
/// Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial row never
/// throws.
/// </summary>
/// <param name="PeakPowerW">Peak power in watts (web <c>peak_power_w ?? 0</c>).</param>
/// <param name="ChargerType">Raw charger-type label, or null (web <c>charger_type</c>).</param>
/// <param name="StartedAt">Raw session-start ISO string, or null (web <c>started_at</c>).</param>
public sealed record SpeedTrendSession(double PeakPowerW, string? ChargerType, string? StartedAt)
{
    /// <summary>Parse a charging-sessions JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<SpeedTrendSession> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SpeedTrendSession>();
        }

        var list = new List<SpeedTrendSession>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single charging-session JSON object into a tolerant row.</summary>
    public static SpeedTrendSession FromJson(JsonElement obj) => new(
        GetDouble(obj, "peak_power_w") ?? 0,
        GetString(obj, "charger_type"),
        GetString(obj, "started_at"));

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
/// One month's projected, render-ready DC/AC average charge rate — the native analogue of the web
/// <c>MonthlySpeed</c> ({ month, dcAvgKw, acAvgKw }). Holds the <c>YYYY-MM</c> <see cref="Month"/> label, the
/// two rounded kW averages the chart plots (<see cref="DcAvgKw"/> / <see cref="AcAvgKw"/>, already rounded to
/// one decimal exactly as the web <c>Math.round(avg * 10) / 10</c>), their formatted text for the accessible
/// data table, and a Narrator automation name. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Month">The <c>YYYY-MM</c> month bucket (web <c>started_at.slice(0, 7)</c>).</param>
/// <param name="DcAvgKw">Rounded average DC peak power in kW for the month (0 when no DC sessions).</param>
/// <param name="AcAvgKw">Rounded average AC peak power in kW for the month (0 when no AC sessions).</param>
/// <param name="DcAvgText">Formatted one-decimal <see cref="DcAvgKw"/> for the data table.</param>
/// <param name="AcAvgText">Formatted one-decimal <see cref="AcAvgKw"/> for the data table.</param>
/// <param name="AutomationName">Spoken summary of the row (month + both averages with units).</param>
public sealed record MonthlySpeed(
    string Month,
    double DcAvgKw,
    double AcAvgKw,
    string DcAvgText,
    string AcAvgText,
    string AutomationName);

/// <summary>
/// One legend entry — a swatch and its localized name — for the chart's standalone legend (the web row of
/// two colored chips: "DC Fast" and "AC / Home"). Pure data so the view binds <see cref="ColorBrushKey"/> to
/// a design-token brush.
/// </summary>
/// <param name="Label">Localized legend label (web "DC Fast" / "AC / Home").</param>
/// <param name="ColorBrushKey">Design-token brush key tinting the swatch.</param>
public sealed record SpeedTrendLegendItem(string Label, string ColorBrushKey);

/// <summary>
/// The fully projected, render-ready view of the Charging Speed Trend chart — the native analogue of
/// everything the web component computes via <c>useMemo</c> before returning its <c>ChartContainer</c>. Holds
/// the always-present chrome strings (title / subtitle / chart aria / axis + column / series labels), the
/// monthly rows (already in kW, rounded, chronological), the two-item legend, and the <see cref="HasData"/>
/// gate (web <c>monthlyTrend.length &gt; 0</c>). Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record SpeedTrendChartDisplay(
    bool HasData,
    IReadOnlyList<MonthlySpeed> Months,
    IReadOnlyList<SpeedTrendLegendItem> Legend,
    string Title,
    string Subtitle,
    string ChartAriaLabel,
    string AxisLabel,
    string DcSeriesLabel,
    string AcSeriesLabel,
    string MonthColumnLabel,
    string DcColumnLabel,
    string AcColumnLabel);

/// <summary>
/// Pure projection from the raw charging-session list to the display model — the native port of the
/// <c>monthlyTrend</c> <c>useMemo</c>, the <c>isDcSession</c> DC/AC split and the <c>convertPowerFromSI(_, 'kW')</c>
/// conversion in web/src/features/charging/components/charging-curve/SpeedTrendChart.tsx (+ helpers.ts).
/// Sessions are bucketed by their <c>started_at</c> month, each session's peak power converted from SI watts
/// to kW (a fixed <c>w / 1000</c>, never the user's unit preference), the per-bucket DC and AC means rounded
/// to one decimal, and the buckets sorted ascending by month. Every label resolves through the i18n facade;
/// the DC and AC line colors map onto the shared categorical palette while the legend swatches map onto the
/// semantic info/success design-token brushes (the web "DC Fast" cyan / "AC / Home" emerald).
/// </summary>
public static class SpeedTrendChartProjection
{
    /// <summary>Watts per kilowatt (web <c>convertPowerFromSI(_, 'kW')</c> divides by this).</summary>
    public const double WattsPerKilowatt = 1000.0;

    /// <summary>Peak-power threshold (W) above which an untyped session counts as DC (web <c>&gt; 20_000</c>).</summary>
    public const double DcPowerThresholdW = 20_000.0;

    /// <summary>The display unit the chart and table express averages in (web literal <c>'kW'</c>).</summary>
    public const string PowerUnit = "kW";

    /// <summary>Categorical palette index for the DC line (web <c>stroke={palette[0]}</c>).</summary>
    public const int DcSeriesColorIndex = 0;

    /// <summary>Categorical palette index for the AC line (web <c>stroke={palette[1]}</c>).</summary>
    public const int AcSeriesColorIndex = 1;

    /// <summary>Semantic brush for the "DC Fast" legend swatch (web <c>#00f0ff</c> cyan = dark <c>info</c> token).</summary>
    public const string DcLegendBrushKey = "TsColorInfoBrush";

    /// <summary>Semantic brush for the "AC / Home" legend swatch (web <c>emerald-500</c> = dark <c>success</c> token).</summary>
    public const string AcLegendBrushKey = "TsColorSuccessBrush";

    private const int MonthPrefixLength = 7; // web started_at.slice(0, 7) → "YYYY-MM"
    private const int KwDecimals = 1;

    /// <summary>
    /// Classify a session as DC fast charging — the native port of <c>isDcSession</c>: a session is DC when
    /// it carries any non-empty <c>charger_type</c>, or its peak power exceeds <see cref="DcPowerThresholdW"/>.
    /// </summary>
    public static bool IsDcSession(SpeedTrendSession session)
    {
        ArgumentNullException.ThrowIfNull(session);
        return !string.IsNullOrEmpty(session.ChargerType) || session.PeakPowerW > DcPowerThresholdW;
    }

    /// <summary>Project <paramref name="sessions"/> into the display model, resolving every label via <paramref name="localizer"/>.</summary>
    /// <param name="sessions">The charging sessions (any order; the projection buckets and sorts by month).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static SpeedTrendChartDisplay Project(IReadOnlyList<SpeedTrendSession> sessions, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(localizer);

        string dcSeries = localizer.GetString("charging.curve.dcAvg", "DC Avg");
        string acSeries = localizer.GetString("charging.curve.acAvg", "AC Avg");

        var months = BuildMonths(sessions, dcSeries, acSeries);

        return new SpeedTrendChartDisplay(
            HasData: months.Count > 0,
            Months: months,
            Legend: BuildLegend(localizer),
            Title: localizer.GetString("charging.curve.speedTrend", "Charging Speed Trend"),
            Subtitle: localizer.GetString("charging.curve.speedTrendDesc", "Monthly average DC vs AC charge rate"),
            ChartAriaLabel: localizer.GetString(
                "charging.curve.speedTrend.aria",
                "Monthly average DC and AC charging speed line chart"),
            AxisLabel: localizer.GetString("charging.curve.avgKw", "Avg kW"),
            DcSeriesLabel: dcSeries,
            AcSeriesLabel: acSeries,
            MonthColumnLabel: localizer.GetString("charging.curve.col.month", "Month"),
            DcColumnLabel: localizer.GetString("charging.curve.col.dcAvgKw", "DC Avg kW"),
            AcColumnLabel: localizer.GetString("charging.curve.col.acAvgKw", "AC Avg kW"));
    }

    private static List<MonthlySpeed> BuildMonths(
        IReadOnlyList<SpeedTrendSession> sessions, string dcSeries, string acSeries)
    {
        // Web parity: byMonth = Map<month, { dc: number[]; ac: number[] }>. Insertion order is irrelevant —
        // the entries are sorted ascending by month before mapping.
        var buckets = new Dictionary<string, Bucket>(StringComparer.Ordinal);
        foreach (var session in sessions)
        {
            string month = MonthKey(session.StartedAt);
            if (!buckets.TryGetValue(month, out var bucket))
            {
                bucket = new Bucket();
                buckets[month] = bucket;
            }

            double powerKw = session.PeakPowerW / WattsPerKilowatt;
            if (IsDcSession(session))
            {
                bucket.AddDc(powerKw);
            }
            else
            {
                bucket.AddAc(powerKw);
            }
        }

        var ordered = new List<string>(buckets.Keys);
        ordered.Sort(StringComparer.Ordinal);

        var months = new List<MonthlySpeed>(ordered.Count);
        foreach (string month in ordered)
        {
            var bucket = buckets[month];
            double dc = RoundOneDecimal(bucket.DcAverage);
            double ac = RoundOneDecimal(bucket.AcAverage);
            string dcText = Format(dc);
            string acText = Format(ac);
            months.Add(new MonthlySpeed(
                Month: month,
                DcAvgKw: dc,
                AcAvgKw: ac,
                DcAvgText: dcText,
                AcAvgText: acText,
                AutomationName: RowAutomationName(month, dcSeries, dcText, acSeries, acText)));
        }

        return months;
    }

    private static List<SpeedTrendLegendItem> BuildLegend(ILocalizer localizer) => new(2)
    {
        new(localizer.GetString("charging.curve.dcFast", "DC Fast"), DcLegendBrushKey),
        new(localizer.GetString("charging.curve.acHome", "AC / Home"), AcLegendBrushKey),
    };

    // Web parity: month = (started_at ?? '').slice(0, 7) — a missing/short value yields '' / the whole string.
    private static string MonthKey(string? startedAt)
    {
        if (string.IsNullOrEmpty(startedAt))
        {
            return string.Empty;
        }

        return startedAt.Length <= MonthPrefixLength ? startedAt : startedAt[..MonthPrefixLength];
    }

    // Web parity: Math.round(value * 10) / 10. Power averages are non-negative, so floor(x + 0.5) reproduces
    // JS Math.round's round-half-up exactly (C# banker's rounding would diverge on .5 midpoints).
    private static double RoundOneDecimal(double value) => Math.Floor((value * 10.0) + 0.5) / 10.0;

    private static string Format(double value) => ScalarFormatters.FormatNumber(value, KwDecimals);

    private static string RowAutomationName(string month, string dcLabel, string dcText, string acLabel, string acText) =>
        string.Format(
            CultureInfo.CurrentCulture,
            "{0}: {1} {2} {3}, {4} {5} {6}",
            string.IsNullOrEmpty(month) ? "\u2014" : month,
            dcLabel,
            dcText,
            PowerUnit,
            acLabel,
            acText,
            PowerUnit);

    /// <summary>Accumulates a month's DC and AC kW samples so the means are computed once at projection time.</summary>
    private sealed class Bucket
    {
        private double _dcSum;
        private int _dcCount;
        private double _acSum;
        private int _acCount;

        public double DcAverage => _dcCount > 0 ? _dcSum / _dcCount : 0.0;

        public double AcAverage => _acCount > 0 ? _acSum / _acCount : 0.0;

        public void AddDc(double value)
        {
            _dcSum += value;
            _dcCount++;
        }

        public void AddAc(double value)
        {
            _acSum += value;
            _acCount++;
        }
    }
}

/// <summary>
/// Canonical registry metadata for the Charging Speed Trend surface — the native mirror of the web
/// charging-curve feature component
/// (web/src/features/charging/components/charging-curve/SpeedTrendChart.tsx). Hosting binds this surface with
/// the stable <see cref="Id"/>; diagnostics tag it with <see cref="Slug"/>.
/// </summary>
public static class SpeedTrendChartRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "speed-trend-chart";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SpeedTrendChart";

    /// <summary>Localized surface title (web "Charging Speed Trend").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("charging.curve.speedTrend", "Charging Speed Trend");
    }
}

/// <summary>
/// PII-safe diagnostics for the Charging Speed Trend surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a kW figure, month, session count,
/// charger type, VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class SpeedTrendChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SpeedTrendChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SpeedTrendChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SpeedTrendChartRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;SpeedTrendSession&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// <c>hasData</c> gate (web's empty-chart branch) is applied by the view-model, not here, so an empty list
/// still flows through with its freshness intact. Kept pure so the parse-and-preserve contract is unit-tested
/// without a network or cache.
/// </summary>
public static class SpeedTrendChartResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<SpeedTrendSession>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<SpeedTrendSession> Parse() =>
            raw.HasValue ? SpeedTrendSession.ParseList(raw.Value) : Array.Empty<SpeedTrendSession>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<SpeedTrendSession>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
