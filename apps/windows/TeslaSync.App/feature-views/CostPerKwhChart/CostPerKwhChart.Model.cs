using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>CostPerKwhChart</c> surface — the native union of the
/// states the web component renders
/// (web/src/features/charging/components/cost-analysis/CostPerKwhChart.tsx). The web source is a pure
/// presentational component (it takes a single <c>data: { date; costPerKwh }[]</c> prop and performs no
/// fetching), so the branches are a direct function of the input <see cref="CostPerKwhChartModel"/> — there
/// is no fetch-driven error / stale / offline branch to reproduce here. The parent cost-analysis page owns
/// the query lifecycle (loading / error / stale / offline are handled once for the page before any chart is
/// shown), exactly as the web page only renders this chart once the monthly cost series has resolved. Every
/// branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum CostPerKwhChartState
{
    /// <summary>Initial fetch in flight (the parent is still loading the series) — title + skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no points to plot (web <c>data.length === 0</c>) — a friendly empty state.</summary>
    Empty,

    /// <summary>At least one point is present (web <c>data.length &gt; 0</c>) — the trend line chart.</summary>
    Ready,
}

/// <summary>
/// One blended cost-per-kWh sample — the native mirror of the web datum shape
/// (<c>{ date: string; costPerKwh: number }</c>) the web <c>CostPerKwhChart</c> receives in its
/// <c>data</c> prop. <see cref="Date"/> is the period label the web plots on the <c>XAxis dataKey="date"</c>;
/// <see cref="CostPerKwh"/> is the blended rate in dollars per kWh (the scalar value the web feeds the
/// <c>costPerKwh</c> line, formatted as currency at the display boundary). Pure data — no WinUI types.
/// </summary>
public sealed record CostPerKwhPoint(string Date, double CostPerKwh);

/// <summary>
/// The render-time data model the <c>CostPerKwhChart</c> view binds to — the native analogue of the web
/// <c>CostPerKwhChartProps</c> (<c>data: { date; costPerKwh }[]</c>), plus the fetch flag the parent supplies
/// so the surface can render its own loading branch (the web parent gates the whole chart behind its query
/// state). The component is presentational: this model carries only the sample series and the loading flag.
/// User-facing labels are resolved from the i18n facade by the projection, not passed in. Pure data — no
/// WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record CostPerKwhChartModel(bool Loading, IReadOnlyList<CostPerKwhPoint> Points)
{
    /// <summary>The initial model: the first fetch is in flight and no points have arrived yet.</summary>
    public static CostPerKwhChartModel Pending { get; } =
        new(true, Array.Empty<CostPerKwhPoint>());

    /// <summary>A resolved model with no points — the empty state.</summary>
    public static CostPerKwhChartModel Empty { get; } =
        new(false, Array.Empty<CostPerKwhPoint>());
}

/// <summary>
/// One projected, render-ready point on the trend line — the native analogue of a single recharts
/// <c>Line</c> datum. <see cref="Index"/> is the ordinal x-position (the native cartesian surface plots on a
/// numeric domain and surfaces <see cref="DateLabel"/> in the cursor tooltip, the way the web
/// <c>XAxis dataKey="date"</c> labels each tick); <see cref="DateLabel"/> is the period label; and
/// <see cref="CostPerKwh"/> is the blended rate in dollars per kWh plotted on the value axis. Pure data.
/// </summary>
public sealed record CostPerKwhTrendPoint(int Index, string DateLabel, double CostPerKwh);

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of what the
/// web <c>CostPerKwhChart</c> renders inside its <c>GlassPanel</c>. Holds the resolved title (the web
/// <c>t('costAnalysis.charts.costPerKwh')</c> heading), the rate-series label (the web <c>Line name</c>
/// <c>t('costAnalysis.charts.rateLabel')</c>), the empty + loading copy, the active <see cref="State"/>, the
/// projected <see cref="Points"/>, a currency-formatted <see cref="RangeSummary"/> (the spoken analogue of
/// the web's <c>formatCurrency</c> value axis), and the surface <see cref="AutomationName"/>. Pure data so
/// every branch is asserted headlessly.
/// </summary>
public sealed record CostPerKwhChartDisplay(
    CostPerKwhChartState State,
    string Title,
    string RateLabel,
    string EmptyMessage,
    string LoadingLabel,
    IReadOnlyList<CostPerKwhTrendPoint> Points,
    string RangeSummary,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="CostPerKwhChartModel"/> to its <see cref="CostPerKwhChartDisplay"/> —
/// the native port of web/src/features/charging/components/cost-analysis/CostPerKwhChart.tsx. The web source
/// is a bare titled line chart of the blended cost-per-kWh trend; this projection reproduces its two
/// <c>t(...)</c> labels (<c>costAnalysis.charts.costPerKwh</c> / <c>costAnalysis.charts.rateLabel</c>), its
/// empty copy (<c>costAnalysis.charts.noData</c>), and the web's <c>data.length &gt; 0</c> gate. The web
/// formats every value-axis tick through <c>useFormatting().formatCurrency(v, 2)</c>; because the native
/// cartesian surface draws a numeric value axis, that currency formatting is reproduced for assistive
/// technology in <see cref="CostPerKwhChartDisplay.RangeSummary"/> via <see cref="ScalarFormatters"/> (the
/// shared SI-scalar currency formatter, the native <c>formatCurrency</c>). Every label resolves through the
/// i18n facade using the same keys the web source feeds into <c>t(...)</c>. No WinUI types — unit-tested
/// without a UI host.
/// </summary>
public static class CostPerKwhChartProjection
{
    private const string EmDash = "\u2014";
    private const string EnDash = "\u2013";
    private const string CurrencySymbol = "$";
    private const int CurrencyDecimals = 2;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web <c>data</c> prop + the parent's fetch flag).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static CostPerKwhChartDisplay Project(CostPerKwhChartModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("costAnalysis.charts.costPerKwh", "Cost per kWh Trend");
        string rateLabel = localizer.GetString("costAnalysis.charts.rateLabel", "$/kWh");
        string emptyMessage = localizer.GetString("costAnalysis.charts.noData", "Not enough data");
        string loadingLabel = localizer.GetString("common.loading", "Loading");

        IReadOnlyList<CostPerKwhTrendPoint> points = BuildPoints(model.Points);
        CostPerKwhChartState state = SelectState(model.Loading, points);
        string rangeSummary = BuildRangeSummary(points);

        return new CostPerKwhChartDisplay(
            State: state,
            Title: title,
            RateLabel: rateLabel,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            Points: points,
            RangeSummary: rangeSummary,
            AutomationName: BuildAutomationName(state, title, rateLabel, emptyMessage, loadingLabel, rangeSummary));
    }

    /// <summary>Branch precedence from the web source's data lifecycle: loading → empty → ready.</summary>
    private static CostPerKwhChartState SelectState(bool loading, IReadOnlyList<CostPerKwhTrendPoint> points)
    {
        if (loading)
        {
            return CostPerKwhChartState.Loading;
        }

        // Web gate: `data.length > 0 ? <chart/> : <empty/>`. A single sample is enough to draw the line.
        return points.Count > 0 ? CostPerKwhChartState.Ready : CostPerKwhChartState.Empty;
    }

    private static IReadOnlyList<CostPerKwhTrendPoint> BuildPoints(IReadOnlyList<CostPerKwhPoint> source)
    {
        if (source.Count == 0)
        {
            return Array.Empty<CostPerKwhTrendPoint>();
        }

        var points = new List<CostPerKwhTrendPoint>(source.Count);
        for (int i = 0; i < source.Count; i++)
        {
            var point = source[i];
            string dateLabel = string.IsNullOrWhiteSpace(point.Date) ? EmDash : point.Date;
            double cost = double.IsNaN(point.CostPerKwh) || double.IsInfinity(point.CostPerKwh)
                ? 0.0
                : point.CostPerKwh;
            points.Add(new CostPerKwhTrendPoint(i, dateLabel, cost));
        }

        return points;
    }

    /// <summary>
    /// The spoken, currency-formatted span of the plotted rates — the assistive-technology analogue of the
    /// web's <c>formatCurrency</c> value axis. Empty when there is nothing to plot; a single formatted value
    /// when every sample rounds the same; otherwise "min–max" through the shared SI currency formatter.
    /// </summary>
    private static string BuildRangeSummary(IReadOnlyList<CostPerKwhTrendPoint> points)
    {
        if (points.Count == 0)
        {
            return string.Empty;
        }

        double min = double.PositiveInfinity;
        double max = double.NegativeInfinity;
        foreach (var point in points)
        {
            min = Math.Min(min, point.CostPerKwh);
            max = Math.Max(max, point.CostPerKwh);
        }

        string minText = ScalarFormatters.FormatCurrency(min, CurrencySymbol, CurrencyDecimals);
        string maxText = ScalarFormatters.FormatCurrency(max, CurrencySymbol, CurrencyDecimals);
        return string.Equals(minText, maxText, StringComparison.Ordinal) ? minText : $"{minText}{EnDash}{maxText}";
    }

    private static string BuildAutomationName(
        CostPerKwhChartState state,
        string title,
        string rateLabel,
        string emptyMessage,
        string loadingLabel,
        string rangeSummary) => state switch
        {
            CostPerKwhChartState.Loading => $"{title}. {loadingLabel}",
            CostPerKwhChartState.Empty => $"{title}. {emptyMessage}",
            _ => $"{title}. {rateLabel} {rangeSummary}",
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>CostPerKwhChart</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a date label or rate value — so a
/// diagnostics line can never leak a user's charging cost. Thread-safe.
/// </summary>
public sealed class CostPerKwhChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public CostPerKwhChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CostPerKwhChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CostPerKwhChartRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>CostPerKwhChart</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/charging/components/cost-analysis/CostPerKwhChart.tsx</c>.
/// </summary>
public static class CostPerKwhChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "CostPerKwhChart";
}
