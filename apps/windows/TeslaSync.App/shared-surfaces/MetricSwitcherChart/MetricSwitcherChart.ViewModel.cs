using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="MetricSwitcherChart"/> view — the native port of the web
/// component body (web/src/components/charts/MetricSwitcherChart.tsx). The web component is a controlled,
/// presentational chart with a pill row above it for switching the displayed metric: it resolves the active metric
/// (<c>metrics.find(m =&gt; m.key === activeMetric) ?? metrics[0]</c>), projects that metric's points
/// (<c>projected</c>), and renders either an <c>EmptyState</c> when there are no points
/// (<c>projected.length === 0</c>) or a bar / area / line chart. This holder reproduces that exactly over an injected
/// <see cref="IMetricSwitcherChartSource"/> (the P1/S8 seam): it exposes the framing strings, the pill
/// <see cref="Items"/>, the resolved <see cref="ActiveMetric"/> / <see cref="ActiveDefinition"/>, the projected
/// <see cref="ActiveSeries"/> + <see cref="ActiveChartKind"/>, the <see cref="IsEmpty"/> flag (the web
/// <c>EmptyState</c> branch) and the <see cref="Select"/> command (web <c>onMetricChange</c>), re-raising the relevant
/// notifications whenever the source changes.
/// </summary>
/// <remarks>
/// Because the web source is a controlled component with no data fetch of its own, there is no loading / error /
/// stale / offline branch to model (the web source has none); its only states are the empty active series (render
/// the empty state, <see cref="IsEmpty"/>) and the populated active series (<see cref="ActiveSeries"/>) — the same
/// rationale as the sibling presentational charts surfaces. The view never performs HTTP; it observes this holder and
/// renders. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </remarks>
public sealed class MetricSwitcherChartViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IMetricSwitcherChartSource _source;
    private readonly ILocalizer _localizer;
    private readonly MetricSwitcherChartDiagnostics _diagnostics;

    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the holder over the chart seam, the i18n facade and an optional diagnostics sink.</summary>
    /// <param name="source">The controlled-input seam (P1/S8) the surface binds to.</param>
    /// <param name="localizer">The i18n facade the pill-row accessible name resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public MetricSwitcherChartViewModel(
        IMetricSwitcherChartSource source,
        ILocalizer localizer,
        MetricSwitcherChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new MetricSwitcherChartDiagnostics();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>MetricSwitcherChart</c>).</summary>
    public static string Slug => MetricSwitcherChartRegistration.Slug;

    /// <summary>The chart title shown in the header (web <c>title</c>).</summary>
    public string Title => _source.Title;

    /// <summary>The chart's accessible name published to UI Automation (web <c>ariaLabel</c>).</summary>
    public string AccessibleName => _source.AccessibleName;

    /// <summary>The empty-state message shown when the active series has no points (web <c>emptyMessage</c>).</summary>
    public string EmptyMessage => _source.EmptyMessage;

    /// <summary>The chart body height in effective pixels (web <c>height</c>).</summary>
    public double Height => _source.Height;

    /// <summary>The pill-row accessible name (web <c>ariaLabel={`${title} metric`}</c>), via the localizer.</summary>
    public string SwitcherLabel => MetricSwitcherChartRegistration.SwitcherLabel(_localizer, _source.Title);

    /// <summary>The pills in display order (web <c>items = metrics.map(...)</c>).</summary>
    public IReadOnlyList<MetricSwitcherPill> Items => MetricSwitcherChartProjection.ProjectPills(_source.Metrics);

    /// <summary>True when there is at least one metric to switch between.</summary>
    public bool HasMetrics => _source.Metrics.Count > 0;

    /// <summary>
    /// The resolved active metric (web <c>metrics.find(...) ?? metrics[0]</c>); null when there are no metrics.
    /// </summary>
    public MetricDefinition? ActiveDefinition =>
        MetricSwitcherChartProjection.ResolveActive(_source.Metrics, _source.ActiveMetric);

    /// <summary>
    /// The resolved active metric key — the key of <see cref="ActiveDefinition"/>, which may differ from the source's
    /// raw <see cref="IMetricSwitcherChartSource.ActiveMetric"/> when that key is unknown and the web
    /// <c>?? metrics[0]</c> fallback applies. Empty when there are no metrics.
    /// </summary>
    public string ActiveMetric => ActiveDefinition?.Key ?? string.Empty;

    /// <summary>The visualisation kind of the active metric (web <c>active.chart ?? 'bar'</c>).</summary>
    public MetricChartKind ActiveChartKind => ActiveDefinition?.Kind ?? MetricChartKind.Bar;

    /// <summary>
    /// True when the active metric has no points to chart — the web <c>projected.length === 0</c> gate that renders
    /// the empty state instead of a chart. Also true when there is no active metric at all.
    /// </summary>
    public bool IsEmpty => ActiveDefinition is not { } active || _source.SeriesFor(active.Key).Count == 0;

    /// <summary>
    /// The projected drawable series for the active metric — a single-element list (the one active series) when there
    /// are points, otherwise empty (the empty-state branch draws nothing). Bind a chart's <c>Series</c> to this.
    /// </summary>
    public IReadOnlyList<ChartSeries> ActiveSeries
    {
        get
        {
            if (ActiveDefinition is not { } active)
            {
                return [];
            }

            var points = _source.SeriesFor(active.Key);
            return points.Count == 0 ? [] : [MetricSwitcherChartProjection.ProjectSeries(active, points)];
        }
    }

    /// <summary>
    /// Select a metric by key (web <c>onMetricChange(key)</c>) by forwarding to the source; the resulting
    /// <see cref="IMetricSwitcherChartSource.Changed"/> re-projects the active state. A call after disposal is a no-op.
    /// </summary>
    /// <param name="key">The metric key to activate.</param>
    public void Select(string key)
    {
        if (_disposed)
        {
            return;
        }

        _source.SelectMetric(key);
    }

    /// <summary>
    /// Record that the surface was opened (web mount) — emits the <c>view.opened</c> diagnostics event exactly once.
    /// Idempotent so a re-entrant load does not double-count.
    /// </summary>
    public void NotifyOpened()
    {
        if (_opened || _disposed)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    /// <summary>Detach from the source seam and stop projecting (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    private void OnSourceChanged(object? sender, EventArgs e)
    {
        // The web parent re-renders the controlled chart with new props; re-project the derived state.
        Raise(nameof(Title));
        Raise(nameof(AccessibleName));
        Raise(nameof(EmptyMessage));
        Raise(nameof(Height));
        Raise(nameof(SwitcherLabel));
        Raise(nameof(Items));
        Raise(nameof(HasMetrics));
        Raise(nameof(ActiveDefinition));
        Raise(nameof(ActiveMetric));
        Raise(nameof(ActiveChartKind));
        Raise(nameof(IsEmpty));
        Raise(nameof(ActiveSeries));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
