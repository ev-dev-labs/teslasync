using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The visualisation a single switchable metric draws with — the native union of the web
/// <c>MetricSwitcherMetric.chart</c> field (<c>'bar' | 'area' | 'line'</c>) in
/// web/src/components/charts/MetricSwitcherChart.tsx. <see cref="Bar"/> is the web default (the safest choice for
/// count-like metrics with many zero days); <see cref="Area"/> and <see cref="Line"/> suit continuous series.
/// </summary>
public enum MetricChartKind
{
    /// <summary>Grouped bars (web <c>chart: 'bar'</c>; the default when the metric omits a kind).</summary>
    Bar,

    /// <summary>A soft filled area (web <c>chart: 'area'</c>).</summary>
    Area,

    /// <summary>A line (web <c>chart: 'line'</c>).</summary>
    Line,
}

/// <summary>
/// One <c>{ date, value }</c> datum — the native analogue of the canonical web point shape the
/// <c>MetricSwitcherChart</c> defaults to (web <c>P extends { date: string }</c> with the zero-config
/// <c>getValue = (p) =&gt; p.value</c>). The <see cref="Date"/> is the category label drawn on the x-axis (a
/// <c>YYYY-MM-DD</c> string for the canonical drives shape) and <see cref="Value"/> is the numeric y value. SI on
/// disk — callers convert to display units before handing points to the surface. UI-free so the projection is
/// unit-tested without a XAML host.
/// </summary>
/// <param name="Date">The category position drawn on the x-axis (web <c>p.date</c>).</param>
/// <param name="Value">The numeric y value (web <c>getValue(p)</c>, default <c>p.value</c>).</param>
public sealed record MetricPoint(string Date, double Value);

/// <summary>
/// Definition of one switchable metric inside <see cref="MetricSwitcherChart"/> — the native mirror of the web
/// <c>MetricSwitcherMetric</c> (web/src/components/charts/MetricSwitcherChart.tsx L16-L50). <see cref="Key"/> is the
/// stable identity used for the active pill; <see cref="Label"/> is the visible pill text and series name;
/// <see cref="Kind"/> selects the chart type (web <c>chart</c>, default <see cref="MetricChartKind.Bar"/>).
/// The web per-metric <c>color</c> hex maps onto a platform <see cref="ColorIndex"/> into the shared brand chart
/// palette (the Windows-idiomatic substitute for a raw Tailwind/hex colour — design tokens, not web colours), with
/// an optional semantic <see cref="ChartRole"/> override. <see cref="Unit"/> mirrors the web y-axis unit suffix and
/// <see cref="Decimals"/> the formatting precision the web closures (<c>formatValue</c> / <c>formatTick</c>) encode.
/// UI-free so it is asserted without a XAML host.
/// </summary>
public sealed record MetricDefinition
{
    /// <summary>Stable key — selects the active metric and the pill (web <c>key</c>).</summary>
    public required string Key { get; init; }

    /// <summary>Visible pill label and chart series name (web <c>label</c>).</summary>
    public required string Label { get; init; }

    /// <summary>Visualisation type (web <c>chart</c>); defaults to <see cref="MetricChartKind.Bar"/>.</summary>
    public MetricChartKind Kind { get; init; } = MetricChartKind.Bar;

    /// <summary>
    /// Zero-based brand palette index the series is drawn with — the platform token analogue of the web per-metric
    /// <c>color</c> hex. Distinct indices give distinct metric colours (web <c>color ?? '#00f0ff'</c>).
    /// </summary>
    public int ColorIndex { get; init; }

    /// <summary>Optional semantic role; when set it overrides <see cref="ColorIndex"/> for a meaning-based brush.</summary>
    public ChartRole Role { get; init; } = ChartRole.None;

    /// <summary>Optional y-axis unit suffix shown in tooltips / the data table (web <c>unit</c>).</summary>
    public string? Unit { get; init; }

    /// <summary>Fixed decimal places for value formatting (web <c>formatValue</c> precision); null = auto.</summary>
    public int? Decimals { get; init; }
}

/// <summary>
/// One pill in the metric switcher — the native analogue of one web <c>PillItem</c> the
/// <c>MetricSwitcherChart</c> builds from its metrics (web <c>items = metrics.map(m =&gt; ({ key, label, accent }))</c>,
/// L123-L131). Only the <see cref="Key"/> and <see cref="Label"/> are carried; the platform pill bar styles the
/// active pill itself, so the web cosmetic <c>accent</c> is not part of the projected shape. UI-free.
/// </summary>
/// <param name="Key">The metric key the pill selects (web <c>m.key</c>).</param>
/// <param name="Label">The visible pill label (web <c>m.label</c>).</param>
public sealed record MetricSwitcherPill(string Key, string Label);

/// <summary>
/// Pure projection from the metric definitions + their points to the chart layer's render shapes — the native port
/// of the web component body's <c>useMemo</c> projections (web/src/components/charts/MetricSwitcherChart.tsx
/// L119-L162): resolving the active metric (<c>metrics.find(m =&gt; m.key === activeMetric) ?? metrics[0]</c>),
/// mapping each metric to a pill (<c>items</c>), and projecting the active metric's points into a drawable series
/// (<c>projected = data.map(p =&gt; ({ ...p, __value: get(p) }))</c>). Every output is a WinUI-free
/// <see cref="ChartSeries"/> / <see cref="ChartPoint"/> from the shared chart core, so the adapter is unit-tested
/// headlessly. The category x-axis (web <c>dataKey="date"</c>) is carried as an ordinal index whose
/// <see cref="ChartPoint.Label"/> is the original date string.
/// </summary>
public static class MetricSwitcherChartProjection
{
    /// <summary>The web default series colour (<c>color ?? '#00f0ff'</c>), kept for documentation of the web default.</summary>
    public const string DefaultColorHex = "#00f0ff";

    /// <summary>Map a metric's <see cref="MetricChartKind"/> onto the core <see cref="ChartSeriesKind"/>.</summary>
    public static ChartSeriesKind ToSeriesKind(MetricChartKind kind) => kind switch
    {
        MetricChartKind.Area => ChartSeriesKind.Area,
        MetricChartKind.Line => ChartSeriesKind.Line,
        _ => ChartSeriesKind.Bar,
    };

    /// <summary>
    /// Resolve the active metric — the native port of <c>metrics.find(m =&gt; m.key === activeMetric) ?? metrics[0]</c>
    /// (web L119): the metric whose key matches <paramref name="activeKey"/>, else the first metric, else null when
    /// there are no metrics.
    /// </summary>
    /// <param name="metrics">The metric definitions in display / pill order.</param>
    /// <param name="activeKey">The currently selected key (web <c>activeMetric</c>).</param>
    public static MetricDefinition? ResolveActive(IReadOnlyList<MetricDefinition> metrics, string? activeKey)
    {
        ArgumentNullException.ThrowIfNull(metrics);
        if (metrics.Count == 0)
        {
            return null;
        }

        if (!string.IsNullOrEmpty(activeKey))
        {
            foreach (var metric in metrics)
            {
                if (string.Equals(metric.Key, activeKey, StringComparison.Ordinal))
                {
                    return metric;
                }
            }
        }

        return metrics[0];
    }

    /// <summary>Project the metric definitions into pills, preserving order (web <c>metrics.map</c>).</summary>
    public static IReadOnlyList<MetricSwitcherPill> ProjectPills(IReadOnlyList<MetricDefinition> metrics)
    {
        ArgumentNullException.ThrowIfNull(metrics);
        var pills = new List<MetricSwitcherPill>(metrics.Count);
        foreach (var metric in metrics)
        {
            pills.Add(new MetricSwitcherPill(metric.Key, metric.Label));
        }

        return pills;
    }

    /// <summary>
    /// Project the active metric's points into drawable <see cref="ChartPoint"/>s — the native port of
    /// <c>data.map((p, i) =&gt; ({ ...p, __value: get(p) }))</c> (web L135-L139). The category date (web
    /// <c>dataKey="date"</c>) becomes the ordinal x position with the date carried as the point label.
    /// </summary>
    public static IReadOnlyList<ChartPoint> ProjectPoints(IReadOnlyList<MetricPoint> points)
    {
        ArgumentNullException.ThrowIfNull(points);
        var projected = new List<ChartPoint>(points.Count);
        for (int i = 0; i < points.Count; i++)
        {
            var point = points[i];
            projected.Add(new ChartPoint(i, point.Value, point.Date));
        }

        return projected;
    }

    /// <summary>
    /// Project a metric and its points into a single drawable series — the native analogue of the web
    /// <c>&lt;Bar/&gt;</c> / <c>&lt;Area/&gt;</c> / <c>&lt;Line/&gt;</c> the active metric renders, carrying the
    /// metric's kind, palette colour, unit and decimals. The series name falls back to the key when the label is
    /// empty so the core <see cref="ChartSeries"/> contract (a non-empty name) always holds.
    /// </summary>
    public static ChartSeries ProjectSeries(MetricDefinition metric, IReadOnlyList<MetricPoint> points)
    {
        ArgumentNullException.ThrowIfNull(metric);
        ArgumentNullException.ThrowIfNull(points);

        var name = string.IsNullOrEmpty(metric.Label) ? metric.Key : metric.Label;
        return new ChartSeries(name, ProjectPoints(points))
        {
            Kind = ToSeriesKind(metric.Kind),
            ColorIndex = metric.ColorIndex,
            Role = metric.Role,
            Unit = metric.Unit,
            Decimals = metric.Decimals,
        };
    }
}

/// <summary>
/// Canonical metadata + i18n keys for the <c>MetricSwitcherChart</c> shared surface — the native mirror of the web
/// component at <c>web/src/components/charts/MetricSwitcherChart.tsx</c>. The web surface is anonymous: every visible
/// string (title, chart aria-label, empty message, metric labels, units) is supplied by the caller, so none is keyed
/// here. The single string the component itself authors is the pill row's accessible name, built as
/// <c>`${title} metric`</c> (web L169); it is keyed as <see cref="SwitcherLabelKey"/> with a <c>{0}</c>-positional
/// English fallback so the native surface resolves it through the i18n facade with no inline English. UI-free so the
/// keys are asserted without a resource host.
/// </summary>
public static class MetricSwitcherChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "MetricSwitcherChart";

    /// <summary>Root automation id set on the surface so a UI-automation test can find it.</summary>
    public const string RootAutomationId = "metric-switcher-chart-root";

    /// <summary>i18n key for the pill row's accessible name (web <c>`${title} metric`</c>).</summary>
    public const string SwitcherLabelKey = "metricSwitcher.switcherLabel";

    /// <summary>Positional English fallback for <see cref="SwitcherLabelKey"/> (web <c>`${title} metric`</c>).</summary>
    public const string SwitcherLabelFallback = "{0} metric";

    /// <summary>
    /// The localized accessible name for the metric pill row — the native port of the web
    /// <c>ariaLabel={`${title} metric`}</c> (L169). Resolves <see cref="SwitcherLabelKey"/> through the localizer and
    /// substitutes <paramref name="title"/> for the <c>{0}</c> position; a fallback without <c>{0}</c> is appended
    /// after the title so the result is always a non-empty, title-prefixed label.
    /// </summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    /// <param name="title">The chart title woven into the accessible name (web <c>title</c> prop).</param>
    public static string SwitcherLabel(ILocalizer localizer, string? title)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var format = localizer.GetString(SwitcherLabelKey, SwitcherLabelFallback);
        var safeTitle = title ?? string.Empty;
        return format.Contains("{0}", StringComparison.Ordinal)
            ? format.Replace("{0}", safeTitle, StringComparison.Ordinal)
            : string.Concat(safeTitle, " ", format).Trim();
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>MetricSwitcherChart</c> surface (P1/S11 diagnostics contract). Metric labels and
/// chart values are caller-supplied fleet content, so the collector records ONLY the operational
/// <see cref="RecordViewOpened"/> signal with the surface slug — never a title, metric key/label, unit, date or
/// value. Thread-safe; mirrors the sibling presentational surfaces' collectors.
/// </summary>
public sealed class MetricSwitcherChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public MetricSwitcherChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MetricSwitcherChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={MetricSwitcherChartRegistration.Slug}"));
    }
}
