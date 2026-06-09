using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.ChargingCurve;

/// <summary>
/// The mutually-exclusive render branch of the <c>YearlyTrendChart</c> surface — the native union of the
/// states the web component renders
/// (web/src/features/charging/components/charging-curve/YearlyTrendChart.tsx). The web source is a pure
/// presentational component: it takes a single <c>yearlyTrend</c> array prop and performs no fetching, so it
/// renders exactly two branches — the composed bar+line chart when there is at least one yearly row, or a
/// friendly empty state when there is none. There is deliberately NO loading / error / stale / offline branch
/// to reproduce here: the parent <c>TimeToChargeSection</c> (and the charging-curve page above it) own the
/// query lifecycle and gate this surface's mounting, exactly as the web <c>TimeToChargeSection</c> derives
/// <c>yearlyTrend</c> from already-resolved sessions and the page shows its own <c>LoadingSkeleton</c> while
/// the charge-curve query is in flight. Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum YearlyTrendChartState
{
    /// <summary>Resolved with no yearly rows (web <c>yearlyTrend.length === 0</c>) — the friendly empty state.</summary>
    Empty,

    /// <summary>At least one year to chart (web <c>yearlyTrend.length &gt; 0</c>) — the composed bar+line chart.</summary>
    Ready,
}

/// <summary>
/// One year's charging-speed-trend point — the native mirror of a single web <c>yearlyTrend</c> entry
/// (<c>{ year: string; avg10to80: number; avg20to80: number; count: number }</c>). <see cref="Year"/> is the
/// calendar-year label; <see cref="Avg10To80"/> / <see cref="Avg20To80"/> are the average minutes a DC
/// session takes to go 10→80% and 20→80% (the web parent already rounds them to one decimal with
/// <c>Math.round(avg * 10) / 10</c>, so they are carried as-is); <see cref="Count"/> is the number of DC
/// sessions that year. Pure data — no WinUI types.
/// </summary>
public sealed record YearlyTrendPoint(string Year, double Avg10To80, double Avg20To80, long Count);

/// <summary>
/// The render-time data model the <c>YearlyTrendChart</c> view binds to — the native analogue of the web
/// component's only prop (<c>yearlyTrend</c>). The component is presentational, so this model carries only the
/// yearly series the parent supplies; user-facing labels are resolved from the i18n facade by the projection,
/// not passed in. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record YearlyTrendChartModel(IReadOnlyList<YearlyTrendPoint> YearlyTrend)
{
    /// <summary>A resolved model with no yearly rows — the empty state.</summary>
    public static YearlyTrendChartModel Empty { get; } = new(Array.Empty<YearlyTrendPoint>());
}

/// <summary>
/// A declarative accessible-table column descriptor (key + localized header) — the native, WinUI-free analogue
/// of one web <c>dataColumns</c> entry the chart feeds into <c>ChartContainer</c>'s tabular fallback. The view
/// maps each one onto a <c>TsDataColumn</c>; rows address their cells by the same <see cref="Key"/>.
/// </summary>
public sealed record YearlyTrendChartColumn(string Key, string Header);

/// <summary>
/// A single projected, display-ready accessible-table row — the cell values keyed by column key, a stable
/// <see cref="RowKey"/>, and a Narrator automation name. Mirrors one row of the web <c>data</c> array
/// (<c>{ year, avg10to80, avg20to80, count }</c>). Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record YearlyTrendChartRow(
    string RowKey,
    IReadOnlyDictionary<string, string> Cells,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of what the
/// web <c>YearlyTrendChart</c> returns through <c>ChartContainer</c>. Holds the active <see cref="State"/>, the
/// resolved title / subtitle / aria-label, the two dual-axis labels (web <c>Minutes</c> left axis +
/// <c>Sessions</c> right axis), the empty + table-caption labels, the three composed <see cref="Series"/> (the
/// DC-session bar plus the two charge-time lines), and the accessible table <see cref="Columns"/> +
/// <see cref="Rows"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record YearlyTrendChartDisplay(
    YearlyTrendChartState State,
    string Title,
    string Subtitle,
    string AriaLabel,
    string MinutesAxisLabel,
    string SessionsAxisLabel,
    string EmptyMessage,
    string TableLabel,
    IReadOnlyList<ChartSeries> Series,
    IReadOnlyList<YearlyTrendChartColumn> Columns,
    IReadOnlyList<YearlyTrendChartRow> Rows,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="YearlyTrendChartModel"/> to its <see cref="YearlyTrendChartDisplay"/> —
/// the native port of web/src/features/charging/components/charging-curve/YearlyTrendChart.tsx. The branch
/// selection mirrors the web source exactly (<c>yearlyTrend.length &gt; 0 ? chart : empty</c>); the three
/// composed series reproduce the web's <c>ComposedChart</c> (a DC-session <c>Bar</c> on
/// <c>CHART_COLORS[5]</c> drawn first, then the <c>10→80%</c> line on <c>CHART_COLORS[0]</c> and the
/// <c>20→80%</c> line on <c>CHART_COLORS[2]</c>, both carrying the web's <c>" min"</c> unit); and the
/// accessible-table cells reproduce the web <c>ChartContainer</c>'s raw <c>String(value)</c> rendering (no
/// thousands grouping and no forced trailing decimals, since the web <c>dataColumns</c> declare no per-column
/// formatter). Every label resolves through the i18n facade using the same keys the web source feeds into
/// <c>t(...)</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class YearlyTrendChartProjection
{
    /// <summary>Accessible-table column key for the calendar year (web <c>key: 'year'</c>).</summary>
    public const string YearKey = "year";

    /// <summary>Accessible-table column key for the 10→80% average minutes (web <c>key: 'avg10to80'</c>).</summary>
    public const string Avg10To80Key = "avg10to80";

    /// <summary>Accessible-table column key for the 20→80% average minutes (web <c>key: 'avg20to80'</c>).</summary>
    public const string Avg20To80Key = "avg20to80";

    /// <summary>Accessible-table column key for the DC-session count (web <c>key: 'count'</c>).</summary>
    public const string CountKey = "count";

    /// <summary>Brand-palette index for the DC-session bar (web <c>CHART_COLORS[5]</c>).</summary>
    public const int CountColorIndex = 5;

    /// <summary>Brand-palette index for the 10→80% line (web <c>CHART_COLORS[0]</c>).</summary>
    public const int Avg10To80ColorIndex = 0;

    /// <summary>Brand-palette index for the 20→80% line (web <c>CHART_COLORS[2]</c>).</summary>
    public const int Avg20To80ColorIndex = 2;

    /// <summary>Fixed decimals for the average-minutes lines (web rounds to one decimal).</summary>
    public const int MinutesDecimals = 1;

    private const string Arrow = "\u2192";
    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web <c>yearlyTrend</c> prop).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static YearlyTrendChartDisplay Project(YearlyTrendChartModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("charging.curve.yearlyTrend", "Yearly Charging Speed Trend");
        string subtitle = localizer.GetString(
            "charging.curve.yearlyTrendDesc",
            "Average time-to-charge and session count by year");
        string ariaLabel = localizer.GetString(
            "charging.curve.yearlyTrend.aria",
            "Yearly average charge-time and session-count composed chart");
        string minutesAxis = localizer.GetString("charging.curve.minutes", "Minutes");
        string sessionsAxis = localizer.GetString("charging.curve.sessionCount", "Sessions");
        string emptyMessage = localizer.GetString("common.noData", "No data available");
        string tableLabel = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("chart.a11y.fallbackTableLabel", "{0} \u2014 data table"),
            title);

        string countName = localizer.GetString("charging.curve.dcSessions", "DC Sessions");
        string avg10Name = localizer.GetString("charging.curve.avg10to80Line", $"10{Arrow}80% avg");
        string avg20Name = localizer.GetString("charging.curve.avg20to80Line", $"20{Arrow}80% avg");
        string minutesUnit = localizer.GetString("charging.curve.minutesUnit", "min");

        IReadOnlyList<YearlyTrendChartColumn> columns = BuildColumns(localizer);
        YearlyTrendChartState state = model.YearlyTrend.Count > 0
            ? YearlyTrendChartState.Ready
            : YearlyTrendChartState.Empty;

        IReadOnlyList<ChartSeries> series = state == YearlyTrendChartState.Ready
            ? BuildSeries(model.YearlyTrend, countName, avg10Name, avg20Name, minutesUnit)
            : Array.Empty<ChartSeries>();

        IReadOnlyList<YearlyTrendChartRow> rows = BuildRows(model.YearlyTrend, avg10Name, avg20Name, countName);

        return new YearlyTrendChartDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            AriaLabel: ariaLabel,
            MinutesAxisLabel: minutesAxis,
            SessionsAxisLabel: sessionsAxis,
            EmptyMessage: emptyMessage,
            TableLabel: tableLabel,
            Series: series,
            Columns: columns,
            Rows: rows,
            AutomationName: BuildAutomationName(state, title, ariaLabel, emptyMessage));
    }

    /// <summary>Renders a year's average-minutes value the way the web <c>ChartContainer</c> does — raw
    /// <c>String(value)</c>: rounded to one decimal (the web parent's precision), with no trailing
    /// <c>.0</c> and no thousands grouping.</summary>
    /// <param name="minutes">The average minutes (already one-decimal rounded upstream).</param>
    public static string FormatMinutes(double minutes)
    {
        if (double.IsNaN(minutes) || double.IsInfinity(minutes))
        {
            return EmDash;
        }

        double rounded = Math.Round(minutes, MinutesDecimals, MidpointRounding.AwayFromZero);
        return rounded.ToString("0.#", CultureInfo.InvariantCulture);
    }

    /// <summary>Renders a DC-session count the way the web <c>ChartContainer</c> does — raw
    /// <c>String(value)</c>: the plain integer with no thousands grouping.</summary>
    /// <param name="count">The DC-session count.</param>
    public static string FormatCount(long count) => count.ToString(CultureInfo.InvariantCulture);

    private static IReadOnlyList<YearlyTrendChartColumn> BuildColumns(ILocalizer localizer) =>
    [
        new YearlyTrendChartColumn(YearKey, localizer.GetString("charging.curve.col.year", "Year")),
        new YearlyTrendChartColumn(
            Avg10To80Key,
            localizer.GetString("charging.curve.col.avg10to80", $"10{Arrow}80% avg min")),
        new YearlyTrendChartColumn(
            Avg20To80Key,
            localizer.GetString("charging.curve.col.avg20to80", $"20{Arrow}80% avg min")),
        new YearlyTrendChartColumn(CountKey, localizer.GetString("charging.curve.col.dcSessions", "DC Sessions")),
    ];

    private static IReadOnlyList<ChartSeries> BuildSeries(
        IReadOnlyList<YearlyTrendPoint> trend,
        string countName,
        string avg10Name,
        string avg20Name,
        string minutesUnit)
    {
        var countPoints = new List<ChartPoint>(trend.Count);
        var avg10Points = new List<ChartPoint>(trend.Count);
        var avg20Points = new List<ChartPoint>(trend.Count);

        for (int i = 0; i < trend.Count; i++)
        {
            var point = trend[i];

            // Categorical X (web dataKey="year"): the bars/lines are positioned by ordinal index and carry the
            // year as their point label, which the tooltip and the accessible table surface in full.
            countPoints.Add(new ChartPoint(i, point.Count, point.Year));
            avg10Points.Add(new ChartPoint(i, point.Avg10To80, point.Year));
            avg20Points.Add(new ChartPoint(i, point.Avg20To80, point.Year));
        }

        // Order matters: the bar is added first so it draws behind the two lines, exactly as the web renders
        // <Bar> before the two <Line>s.
        return
        [
            new ChartSeries(countName, countPoints)
            {
                Kind = ChartSeriesKind.Bar,
                ColorIndex = CountColorIndex,
                Decimals = 0,
            },
            new ChartSeries(avg10Name, avg10Points)
            {
                Kind = ChartSeriesKind.Line,
                ColorIndex = Avg10To80ColorIndex,
                Unit = minutesUnit,
                Decimals = MinutesDecimals,
            },
            new ChartSeries(avg20Name, avg20Points)
            {
                Kind = ChartSeriesKind.Line,
                ColorIndex = Avg20To80ColorIndex,
                Unit = minutesUnit,
                Decimals = MinutesDecimals,
            },
        ];
    }

    private static IReadOnlyList<YearlyTrendChartRow> BuildRows(
        IReadOnlyList<YearlyTrendPoint> trend,
        string avg10Name,
        string avg20Name,
        string countName)
    {
        if (trend.Count == 0)
        {
            return Array.Empty<YearlyTrendChartRow>();
        }

        var rows = new List<YearlyTrendChartRow>(trend.Count);
        for (int i = 0; i < trend.Count; i++)
        {
            var point = trend[i];
            string avg10Text = FormatMinutes(point.Avg10To80);
            string avg20Text = FormatMinutes(point.Avg20To80);
            string countText = FormatCount(point.Count);

            var cells = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [YearKey] = point.Year,
                [Avg10To80Key] = avg10Text,
                [Avg20To80Key] = avg20Text,
                [CountKey] = countText,
            };

            rows.Add(new YearlyTrendChartRow(
                RowKey: string.Create(CultureInfo.InvariantCulture, $"row-{i}"),
                Cells: cells,
                AutomationName: string.Create(
                    CultureInfo.CurrentCulture,
                    $"{point.Year}. {avg10Name} {avg10Text}, {avg20Name} {avg20Text}, {countName} {countText}")));
        }

        return rows;
    }

    private static string BuildAutomationName(
        YearlyTrendChartState state,
        string title,
        string ariaLabel,
        string emptyMessage) => state switch
        {
            YearlyTrendChartState.Empty => $"{title}. {emptyMessage}",
            _ => $"{title}. {ariaLabel}",
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>YearlyTrendChart</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a year, charge-time, or session count —
/// so a diagnostics line can never leak a user's charging behaviour. Thread-safe.
/// </summary>
public sealed class YearlyTrendChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Receives the formatted <c>view.opened</c> line; <see langword="null"/> to only count.</param>
    public YearlyTrendChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=YearlyTrendChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={YearlyTrendChartRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>YearlyTrendChart</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/charging/components/charging-curve/YearlyTrendChart.tsx</c>.
/// </summary>
public static class YearlyTrendChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "YearlyTrendChart";
}
