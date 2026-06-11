namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The controlled inputs the <c>MetricSwitcherChart</c> surface binds to (P1/S8 state-holder seam) — the native
/// analogue of the props the controlled web component receives (web/src/components/charts/MetricSwitcherChart.tsx
/// L52-L83): the framing strings (<c>title</c>, <c>ariaLabel</c>, <c>emptyMessage</c>, <c>height</c>), the metric
/// definitions (<c>metrics</c>), the per-metric data (<c>series</c>), the selected key (<c>activeMetric</c>) and the
/// selection callback (<c>onMetricChange</c>). The web component owns no state — its parent holds the series and the
/// active key — so the native surface binds to this seam rather than fetching anything: the view never performs
/// HTTP, it reads these members, re-projects on <see cref="Changed"/>, and calls <see cref="SelectMetric"/> when a
/// pill is chosen. A shell adapter (or a test fake) supplies the implementation, so the surface logic is asserted
/// headlessly.
/// </summary>
public interface IMetricSwitcherChartSource
{
    /// <summary>The chart title shown in the header (web <c>title</c>); already localized by the caller.</summary>
    string Title { get; }

    /// <summary>The chart's accessible name (web <c>ariaLabel</c>); already localized by the caller.</summary>
    string AccessibleName { get; }

    /// <summary>The empty-state message shown when the active series has no points (web <c>emptyMessage</c>).</summary>
    string EmptyMessage { get; }

    /// <summary>The chart body height in effective pixels (web <c>height</c>, default 220).</summary>
    double Height { get; }

    /// <summary>The metric definitions in pill order (web <c>metrics</c>).</summary>
    IReadOnlyList<MetricDefinition> Metrics { get; }

    /// <summary>The currently selected metric key (web <c>activeMetric</c>).</summary>
    string ActiveMetric { get; }

    /// <summary>
    /// The data points for a metric key (web <c>series[key] ?? []</c>); an unknown key yields an empty list so the
    /// surface renders the empty state rather than throwing.
    /// </summary>
    /// <param name="key">The metric key whose points are requested.</param>
    IReadOnlyList<MetricPoint> SeriesFor(string key);

    /// <summary>
    /// Select a metric by key (web <c>onMetricChange(key)</c>). A real change updates <see cref="ActiveMetric"/> and
    /// raises <see cref="Changed"/> so the bound surface re-projects; an empty/unchanged key is a no-op.
    /// </summary>
    /// <param name="key">The metric key to activate.</param>
    void SelectMetric(string key);

    /// <summary>Raised whenever the controlled inputs change (web parent re-rendering with new props).</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The canonical in-memory <see cref="IMetricSwitcherChartSource"/> — the native analogue of the web parent that
/// owns the metric series and the active-key state for the controlled <c>MetricSwitcherChart</c>. It is seeded with
/// the framing strings, the metric definitions, the per-metric series and an optional initial active key (defaulting
/// to the first metric's key, mirroring the web <c>metrics[0]</c> fallback); <see cref="SelectMetric"/> commits a new
/// active key and <see cref="ReplaceSeries"/> swaps a metric's data — both raise <see cref="Changed"/> so the bound
/// <see cref="MetricSwitcherChartViewModel"/> re-projects. UI-thread-confined; not internally synchronised.
/// </summary>
public sealed class MetricSwitcherChartStore : IMetricSwitcherChartSource
{
    /// <summary>The web default chart body height (<c>height = 220</c>).</summary>
    public const double DefaultHeight = 220;

    private readonly List<MetricDefinition> _metrics;
    private readonly Dictionary<string, IReadOnlyList<MetricPoint>> _series;
    private string _activeMetric;

    /// <summary>Creates the store over the controlled inputs the web component receives as props.</summary>
    /// <param name="title">The chart title (web <c>title</c>); already localized.</param>
    /// <param name="accessibleName">The chart accessible name (web <c>ariaLabel</c>); already localized.</param>
    /// <param name="emptyMessage">The empty-state message (web <c>emptyMessage</c>); already localized.</param>
    /// <param name="metrics">The metric definitions in pill order (web <c>metrics</c>); copied.</param>
    /// <param name="series">The per-metric data keyed by metric key (web <c>series</c>); copied.</param>
    /// <param name="activeMetric">The initial active key; defaults to the first metric's key (web <c>metrics[0]</c>).</param>
    /// <param name="height">The chart body height (web <c>height</c>); defaults to <see cref="DefaultHeight"/>.</param>
    public MetricSwitcherChartStore(
        string title,
        string accessibleName,
        string emptyMessage,
        IEnumerable<MetricDefinition> metrics,
        IReadOnlyDictionary<string, IReadOnlyList<MetricPoint>>? series = null,
        string? activeMetric = null,
        double height = DefaultHeight)
    {
        ArgumentNullException.ThrowIfNull(title);
        ArgumentNullException.ThrowIfNull(accessibleName);
        ArgumentNullException.ThrowIfNull(emptyMessage);
        ArgumentNullException.ThrowIfNull(metrics);

        Title = title;
        AccessibleName = accessibleName;
        EmptyMessage = emptyMessage;
        Height = height;
        _metrics = [.. metrics];
        _series = new Dictionary<string, IReadOnlyList<MetricPoint>>(StringComparer.Ordinal);
        if (series is not null)
        {
            foreach (var pair in series)
            {
                _series[pair.Key] = pair.Value ?? [];
            }
        }

        _activeMetric = !string.IsNullOrEmpty(activeMetric)
            ? activeMetric
            : _metrics.Count > 0 ? _metrics[0].Key : string.Empty;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public string Title { get; }

    /// <inheritdoc />
    public string AccessibleName { get; }

    /// <inheritdoc />
    public string EmptyMessage { get; }

    /// <inheritdoc />
    public double Height { get; }

    /// <inheritdoc />
    public IReadOnlyList<MetricDefinition> Metrics => _metrics;

    /// <inheritdoc />
    public string ActiveMetric => _activeMetric;

    /// <inheritdoc />
    public IReadOnlyList<MetricPoint> SeriesFor(string key) =>
        !string.IsNullOrEmpty(key) && _series.TryGetValue(key, out var points) ? points : [];

    /// <inheritdoc />
    public void SelectMetric(string key)
    {
        if (string.IsNullOrEmpty(key) || string.Equals(key, _activeMetric, StringComparison.Ordinal))
        {
            return;
        }

        _activeMetric = key;
        Raise();
    }

    /// <summary>
    /// Replace a metric's data points (the native analogue of the web <c>series</c> prop changing) and raise
    /// <see cref="Changed"/> so the bound surface re-projects. An unknown key adds a new series entry.
    /// </summary>
    /// <param name="key">The metric key whose points are replaced.</param>
    /// <param name="points">The new points (copied; null is treated as empty).</param>
    public void ReplaceSeries(string key, IEnumerable<MetricPoint>? points)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        _series[key] = points is null ? [] : [.. points];
        Raise();
    }

    private void Raise() => Changed?.Invoke(this, EventArgs.Empty);
}
