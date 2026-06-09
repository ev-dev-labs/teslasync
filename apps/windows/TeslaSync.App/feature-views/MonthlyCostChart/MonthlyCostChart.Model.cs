using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>MonthlyCostChart</c> surface — the native union of the states
/// the web component renders
/// (web/src/features/charging/components/cost-analysis/MonthlyCostChart.tsx). The web source is a pure
/// presentational component: it takes <c>data: MonthlyBucket[]</c> + <c>vehicleId</c> as props and performs no
/// fetching, so it renders exactly two branches — the area chart when there is at least one month
/// (<c>data.length &gt; 0</c>), or a friendly "Not enough data" empty state when there is none. There is
/// deliberately NO loading / error / stale / offline branch to reproduce here: the parent
/// <c>CostAnalysisPage</c> owns the whole query lifecycle (it renders a single page-level
/// <c>LoadingSkeleton</c> while <c>isLoading</c>, and the error / stale / offline chrome is handled once for the
/// page before this component is mounted), exactly as the web source only ever receives already-resolved
/// monthly buckets. Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum MonthlyCostChartState
{
    /// <summary>Resolved with no monthly rows (web <c>data.length === 0</c>) — the friendly empty state.</summary>
    Empty,

    /// <summary>At least one month to chart (web <c>data.length &gt; 0</c>) — the cost area chart.</summary>
    Ready,
}

/// <summary>
/// One month's charging-cost point — the native mirror of a single web <c>MonthlyBucket</c> entry in
/// <c>web/src/features/charging/components/cost-analysis/types.ts</c>, narrowed to the two fields the component
/// actually reads (<c>data.map((d) =&gt; ({ month: d.month, cost: d.cost }))</c>). <see cref="Month"/> is the
/// <c>YYYY-MM</c> bucket label; <see cref="Cost"/> is the user's currency amount for that month (the web parent
/// already sums and currency-prepares it). Pure data — no WinUI types.
/// </summary>
public sealed record MonthlyCostPoint(string Month, double Cost);

/// <summary>
/// One already-resolved chart annotation aligned to a month bucket — the native mirror of a web
/// <c>DataAnnotation</c> rendered by <c>renderAnnotationLines(chartAnnotations, (ts) =&gt; ts)</c>. In the web
/// the annotation rows are fetched by the shared <c>ChartContainer</c> (its internal
/// <c>useChartAnnotationsAsData({ vehicleId, scope })</c> hook) and handed to the chart's function-children;
/// the native counterpart of that fetch lives in the shared chart-container bundle, so this surface simply
/// carries the resolved set the container supplies (empty by default). <see cref="Month"/> is the
/// <c>YYYY-MM</c> bucket the reference line sits on (the web's categorical X identity-maps the annotation onto a
/// month), <see cref="Label"/> is the line caption. Pure data — no WinUI types.
/// </summary>
public sealed record MonthlyCostAnnotation(string Id, string Month, string Label);

/// <summary>
/// The render-time data model the <c>MonthlyCostChart</c> view binds to — the native analogue of the web
/// component's props (<c>data</c> + <c>vehicleId</c>) plus the already-resolved annotation set the shared
/// chart-container supplies. The component is presentational; user-facing labels are resolved from the i18n
/// facade by the projection, not passed in. <see cref="VehicleId"/> is preserved verbatim because it scopes the
/// container's annotation lookup (web <c>annotations={{ vehicleId, scope: 'cost', chartId: 'cost-monthly-trend'
/// }}</c>); the scope and chart id are fixed constants on <see cref="MonthlyCostChartRegistration"/>. Pure data
/// — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record MonthlyCostChartModel(
    IReadOnlyList<MonthlyCostPoint> Data,
    long? VehicleId = null,
    IReadOnlyList<MonthlyCostAnnotation>? Annotations = null)
{
    /// <summary>A resolved model with no monthly rows — the empty state.</summary>
    public static MonthlyCostChartModel Empty { get; } = new(Array.Empty<MonthlyCostPoint>());

    /// <summary>The annotation set, never null (defaults to an empty list).</summary>
    public IReadOnlyList<MonthlyCostAnnotation> AnnotationsOrEmpty =>
        Annotations ?? Array.Empty<MonthlyCostAnnotation>();
}

/// <summary>
/// A declarative accessible-table column descriptor (key + localized header) — the native, WinUI-free analogue
/// of one web <c>dataColumns</c> entry the chart feeds into <c>ChartContainer</c>'s tabular fallback. The view
/// maps each one onto a <c>TsDataColumn</c>; rows address their cells by the same <see cref="Key"/>.
/// </summary>
public sealed record MonthlyCostChartColumn(string Key, string Header);

/// <summary>
/// A single projected, display-ready accessible-table row — the cell values keyed by column key, a stable
/// <see cref="RowKey"/>, and a Narrator automation name. Mirrors one row of the web <c>data</c> array
/// (<c>{ month, cost }</c>) the <c>ChartContainer</c> renders as <c>String(value)</c>. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record MonthlyCostChartRow(
    string RowKey,
    IReadOnlyDictionary<string, string> Cells,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of what the
/// web <c>MonthlyCostChart</c> returns through <c>ChartContainer</c>. Holds the active <see cref="State"/>, the
/// resolved title / aria-label, the empty + table-caption labels, the single cost <see cref="Series"/>, the
/// resolved reference-line <see cref="Annotations"/>, the accessible table <see cref="Columns"/> +
/// <see cref="Rows"/>, a currency-formatted <see cref="ChartSummary"/> of the cost domain (the spoken analogue
/// of the web currency Y-axis), and the surface <see cref="AutomationName"/>. Pure data so every branch is
/// asserted headlessly.
/// </summary>
public sealed record MonthlyCostChartDisplay(
    MonthlyCostChartState State,
    string Title,
    string AriaLabel,
    string EmptyMessage,
    string TableLabel,
    IReadOnlyList<ChartSeries> Series,
    IReadOnlyList<ChartAnnotation> Annotations,
    IReadOnlyList<MonthlyCostChartColumn> Columns,
    IReadOnlyList<MonthlyCostChartRow> Rows,
    string ChartSummary,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="MonthlyCostChartModel"/> to its <see cref="MonthlyCostChartDisplay"/> — the
/// native port of web/src/features/charging/components/cost-analysis/MonthlyCostChart.tsx. The branch selection
/// mirrors the web source exactly (<c>data.length &gt; 0 ? &lt;AreaChart&gt; : "Not enough data"</c>); the
/// single cost series reproduces the web <c>&lt;Area dataKey="cost" stroke={palette[0]}&gt;</c> (brand palette
/// index 0); the accessible-table cells reproduce the web <c>ChartContainer</c>'s raw <c>String(value)</c>
/// rendering (the month string verbatim and the cost with no thousands grouping and no forced trailing
/// decimals, since the web <c>dataColumns</c> declare no per-column formatter); and the currency summary applies
/// the web <c>useFormatting().formatCurrency(v, 0)</c> rule the web feeds into the Y-axis
/// <c>tickFormatter</c>. The X labels reproduce the web tick formatter (<c>YYYY-MM → MM/YY</c>). Every label
/// resolves through the i18n facade using the same keys the web source feeds into <c>t(...)</c>. No WinUI types
/// — unit-tested without a UI host.
/// </summary>
public static class MonthlyCostChartProjection
{
    /// <summary>Accessible-table column key for the month bucket (web <c>key: 'month'</c>).</summary>
    public const string MonthKey = "month";

    /// <summary>Accessible-table column key for the monthly cost (web <c>key: 'cost'</c>).</summary>
    public const string CostKey = "cost";

    /// <summary>Brand-palette index for the cost area (web <c>palette[0]</c> stroke + fill gradient).</summary>
    public const int CostColorIndex = 0;

    /// <summary>Decimals carried on the cost series for the native tooltip (currency cents).</summary>
    public const int CostTooltipDecimals = 2;

    /// <summary>Decimals the web Y-axis <c>tickFormatter</c> uses (<c>formatCurrency(v, 0)</c>).</summary>
    public const int AxisCurrencyDecimals = 0;

    private const string MonthSeparator = "-";
    private const string EnDash = "\u2013";

    /// <summary>Web <c>safeNumber</c>: a finite number passes through, anything else becomes 0.</summary>
    public static double Safe(double value) => double.IsFinite(value) ? value : 0;

    /// <summary>
    /// Renders a cost value the way the web <c>ChartContainer</c> accessible table does — raw
    /// <c>String(value)</c>: the shortest round-trippable decimal with no thousands grouping and no forced
    /// trailing decimals. Matches ECMAScript <c>String(number)</c> for every realistic cost magnitude.
    /// </summary>
    /// <param name="cost">The monthly cost amount.</param>
    public static string FormatCostCell(double cost) => cost.ToString(CultureInfo.InvariantCulture);

    /// <summary>
    /// Reproduces the web X-axis <c>tickFormatter</c>: a <c>YYYY-MM</c> bucket becomes <c>MM/YY</c>
    /// (<c>`${parts[1]}/${parts[0].slice(2)}`</c>); any value that is not exactly two dash-separated parts is
    /// returned verbatim.
    /// </summary>
    /// <param name="month">The raw month bucket label.</param>
    public static string FormatMonthAxis(string month)
    {
        ArgumentNullException.ThrowIfNull(month);
        string[] parts = month.Split(MonthSeparator);
        if (parts.Length != 2)
        {
            return month;
        }

        string year = parts[0].Length >= 2 ? parts[0][2..] : string.Empty;
        return string.Concat(parts[1], "/", year);
    }

    /// <summary>
    /// Format a currency amount as <c>{symbol}{fmtNumber(amount, decimals)}</c> — the web
    /// <c>useFormatting().formatCurrency</c> rule (which leans on <c>safeNumber</c>, so a non-finite amount
    /// renders the symbol + 0).
    /// </summary>
    /// <param name="amount">The currency amount.</param>
    /// <param name="symbol">The currency symbol.</param>
    /// <param name="decimals">Fixed fraction digits.</param>
    public static string FormatCurrency(double amount, string symbol, int decimals) =>
        symbol + NumberFormatting.Format(Safe(amount), null, decimals);

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web <c>data</c> + <c>vehicleId</c> props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public static MonthlyCostChartDisplay Project(
        MonthlyCostChartModel model,
        ILocalizer localizer,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? MonthlyCostChartRegistration.DefaultCurrencySymbol
            : currencySymbol;

        string title = localizer.GetString("costAnalysis.charts.monthlyCost", "Monthly Cost Trend");
        string ariaLabel = localizer.GetString(
            "costAnalysis.charts.monthlyCost.aria",
            "Monthly charging cost trend area chart");
        string emptyMessage = localizer.GetString("costAnalysis.charts.noData", "Not enough data");
        string costSeriesName = localizer.GetString("costAnalysis.charts.cost", "Cost ($)");
        string tableLabel = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("chart.a11y.fallbackTableLabel", "{0} \u2014 data table"),
            title);

        IReadOnlyList<MonthlyCostChartColumn> columns = BuildColumns(localizer);
        MonthlyCostChartState state = model.Data.Count > 0
            ? MonthlyCostChartState.Ready
            : MonthlyCostChartState.Empty;

        IReadOnlyList<ChartSeries> series = state == MonthlyCostChartState.Ready
            ? BuildSeries(model.Data, costSeriesName)
            : Array.Empty<ChartSeries>();

        IReadOnlyList<ChartAnnotation> annotations = BuildAnnotations(model.Data, model.AnnotationsOrEmpty);
        IReadOnlyList<MonthlyCostChartRow> rows = BuildRows(model.Data, localizer);
        string chartSummary = BuildChartSummary(state, model.Data, ariaLabel, symbol);

        return new MonthlyCostChartDisplay(
            State: state,
            Title: title,
            AriaLabel: ariaLabel,
            EmptyMessage: emptyMessage,
            TableLabel: tableLabel,
            Series: series,
            Annotations: annotations,
            Columns: columns,
            Rows: rows,
            ChartSummary: chartSummary,
            AutomationName: BuildAutomationName(state, title, ariaLabel, emptyMessage));
    }

    private static IReadOnlyList<MonthlyCostChartColumn> BuildColumns(ILocalizer localizer) =>
    [
        new MonthlyCostChartColumn(MonthKey, localizer.GetString("costAnalysis.charts.col.month", "Month")),
        new MonthlyCostChartColumn(CostKey, localizer.GetString("costAnalysis.charts.col.cost", "Cost ($)")),
    ];

    private static IReadOnlyList<ChartSeries> BuildSeries(
        IReadOnlyList<MonthlyCostPoint> data,
        string costSeriesName)
    {
        var points = new List<ChartPoint>(data.Count);
        for (int i = 0; i < data.Count; i++)
        {
            MonthlyCostPoint point = data[i];

            // Categorical X (web dataKey="month"): each area vertex is positioned by ordinal index and carries
            // the MM/YY tick label the web X-axis tickFormatter renders.
            points.Add(new ChartPoint(i, Safe(point.Cost), FormatMonthAxis(point.Month)));
        }

        return
        [
            new ChartSeries(costSeriesName, points)
            {
                Kind = ChartSeriesKind.Area,
                ColorIndex = CostColorIndex,
                Decimals = CostTooltipDecimals,
            },
        ];
    }

    private static IReadOnlyList<ChartAnnotation> BuildAnnotations(
        IReadOnlyList<MonthlyCostPoint> data,
        IReadOnlyList<MonthlyCostAnnotation> annotations)
    {
        if (data.Count == 0 || annotations.Count == 0)
        {
            return Array.Empty<ChartAnnotation>();
        }

        var monthIndex = new Dictionary<string, int>(data.Count, StringComparer.Ordinal);
        for (int i = 0; i < data.Count; i++)
        {
            monthIndex.TryAdd(data[i].Month, i);
        }

        var lines = new List<ChartAnnotation>(annotations.Count);
        foreach (MonthlyCostAnnotation annotation in annotations)
        {
            // Web parity: the categorical axis identity-maps a timestamp onto a month bucket, so only
            // annotations that fall on a charted month draw a reference line.
            if (monthIndex.TryGetValue(annotation.Month, out int index))
            {
                lines.Add(new ChartAnnotation(annotation.Id, ChartAnnotationKind.VerticalLine, index)
                {
                    Label = annotation.Label,
                });
            }
        }

        return lines;
    }

    private static IReadOnlyList<MonthlyCostChartRow> BuildRows(
        IReadOnlyList<MonthlyCostPoint> data,
        ILocalizer localizer)
    {
        if (data.Count == 0)
        {
            return Array.Empty<MonthlyCostChartRow>();
        }

        string monthHeader = localizer.GetString("costAnalysis.charts.col.month", "Month");
        string costHeader = localizer.GetString("costAnalysis.charts.col.cost", "Cost ($)");

        var rows = new List<MonthlyCostChartRow>(data.Count);
        for (int i = 0; i < data.Count; i++)
        {
            MonthlyCostPoint point = data[i];
            string costText = FormatCostCell(point.Cost);

            var cells = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [MonthKey] = point.Month,
                [CostKey] = costText,
            };

            rows.Add(new MonthlyCostChartRow(
                RowKey: string.Create(CultureInfo.InvariantCulture, $"row-{i}"),
                Cells: cells,
                AutomationName: string.Create(
                    CultureInfo.CurrentCulture,
                    $"{monthHeader} {point.Month}, {costHeader} {costText}")));
        }

        return rows;
    }

    // The spoken analogue of the web currency Y-axis: the cost domain rendered through the same
    // formatCurrency(v, 0) rule the web feeds into the axis tickFormatter, so a non-visual user hears the range
    // the visual ticks communicate. Empty when there are no months to summarize.
    private static string BuildChartSummary(
        MonthlyCostChartState state,
        IReadOnlyList<MonthlyCostPoint> data,
        string ariaLabel,
        string symbol)
    {
        if (state != MonthlyCostChartState.Ready || data.Count == 0)
        {
            return ariaLabel;
        }

        double min = double.PositiveInfinity;
        double max = double.NegativeInfinity;
        foreach (MonthlyCostPoint point in data)
        {
            double cost = Safe(point.Cost);
            if (cost < min)
            {
                min = cost;
            }

            if (cost > max)
            {
                max = cost;
            }
        }

        string low = FormatCurrency(min, symbol, AxisCurrencyDecimals);
        string high = FormatCurrency(max, symbol, AxisCurrencyDecimals);
        return string.Create(CultureInfo.CurrentCulture, $"{ariaLabel}. {low}{EnDash}{high}");
    }

    private static string BuildAutomationName(
        MonthlyCostChartState state,
        string title,
        string ariaLabel,
        string emptyMessage) => state switch
        {
            MonthlyCostChartState.Empty => string.Create(CultureInfo.CurrentCulture, $"{title}. {emptyMessage}"),
            _ => string.Create(CultureInfo.CurrentCulture, $"{title}. {ariaLabel}"),
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>MonthlyCostChart</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a month or a cost — so a diagnostics line
/// can never leak a user's charging spend. Thread-safe.
/// </summary>
public sealed class MonthlyCostChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Receives the formatted <c>view.opened</c> line; <see langword="null"/> to only count.</param>
    public MonthlyCostChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MonthlyCostChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MonthlyCostChartRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>MonthlyCostChart</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/charging/components/cost-analysis/MonthlyCostChart.tsx</c>.
/// </summary>
public static class MonthlyCostChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "MonthlyCostChart";

    /// <summary>The annotation scope the shared chart-container fetches under (web <c>scope: 'cost'</c>).</summary>
    public const string AnnotationScope = "cost";

    /// <summary>The stable chart id the shared chart-container keys annotations by (web <c>chartId</c>).</summary>
    public const string ChartId = "cost-monthly-trend";

    /// <summary>The default currency symbol (web parity for an unset <c>settings.currency_symbol</c>).</summary>
    public const string DefaultCurrencySymbol = "$";
}
