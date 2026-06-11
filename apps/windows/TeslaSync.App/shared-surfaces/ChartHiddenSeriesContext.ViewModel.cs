using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces.ChartHiddenSeriesContextSurface;

/// <summary>
/// URL-persisted hidden-series state for one chart — the native port of the web <c>useHiddenSeries(chartKey)</c>
/// hook and its <c>HiddenSeriesState</c> shape (<c>web/src/hooks/useHiddenSeries.ts</c>). It tracks which series
/// <c>dataKey</c>s are hidden for a named chart, persisting through an <see cref="IHiddenSeriesQueryStore"/> (the
/// <c>useSearchParams</c> seam) under <c>hidden_{chartKey}</c> so a deep-link carries the toggle. Unlike the
/// localStorage-backed legend state (web <c>useChartLegendState</c>, ported as
/// <c>TeslaSync.App.Core.Charts.ChartLegendState</c>), this URL-backed variant is shareable, survives a reload and
/// is what <c>ChartHiddenSeriesContext</c> provides. It is <see cref="INotifyPropertyChanged"/> so the bound view
/// (and any legend) refresh when the set changes — including external changes through the same store (a pasted
/// deep-link), mirroring the web re-render on a <c>useSearchParams</c> update. <see cref="Dispose"/> detaches from
/// the store (the web effect cleanup). The holder performs no I/O of its own; it binds to the store.
/// </summary>
public sealed class HiddenSeriesState : INotifyPropertyChanged, IDisposable
{
    private readonly IHiddenSeriesQueryStore _store;
    private readonly ChartHiddenSeriesDiagnostics? _diagnostics;
    private readonly string _paramName;
    private HashSet<string> _hidden;
    private bool _disposed;

    /// <summary>
    /// Creates the state holder for <paramref name="chartKey"/> over a query store (the web
    /// <c>useHiddenSeries(chartKey)</c> call) and subscribes to store changes (the web URL-change re-render).
    /// </summary>
    /// <param name="store">The query-string seam the hidden list is read from and written to.</param>
    /// <param name="chartKey">The chart identifier; must be non-empty (the provider only creates state for a real key).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for toggle / reset counters.</param>
    public HiddenSeriesState(IHiddenSeriesQueryStore store, string chartKey, ChartHiddenSeriesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentException.ThrowIfNullOrEmpty(chartKey);

        _store = store;
        _diagnostics = diagnostics;
        ChartKey = chartKey;
        _paramName = ChartHiddenSeriesRegistration.ParamName(chartKey);
        _hidden = ReadHidden();
        _store.Changed += OnStoreChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The chart identifier this state tracks (web <c>chartKey</c>).</summary>
    public string ChartKey { get; }

    /// <summary>
    /// The set of <c>dataKey</c>s currently hidden for this chart (web <c>hidden: Set&lt;string&gt;</c>). The
    /// returned collection is a snapshot; it is replaced (and <see cref="PropertyChanged"/> raised) whenever the
    /// underlying parameter changes.
    /// </summary>
    public IReadOnlyCollection<string> Hidden => _hidden;

    /// <summary>Returns true when <paramref name="seriesKey"/> is currently hidden (web <c>isHidden</c>).</summary>
    /// <param name="seriesKey">The series <c>dataKey</c> to test.</param>
    public bool IsHidden(string seriesKey)
    {
        ArgumentException.ThrowIfNullOrEmpty(seriesKey);
        return _hidden.Contains(seriesKey);
    }

    /// <summary>
    /// Toggle the visibility of a series by <c>dataKey</c> (web <c>toggle</c>). Reads the current hidden list from
    /// the store, flips membership, then writes back the canonical ordinal-sorted comma-joined value (an empty
    /// result deletes the parameter). The write raises the store's change event, which refreshes
    /// <see cref="Hidden"/>.
    /// </summary>
    /// <param name="seriesKey">The series <c>dataKey</c> to hide or show.</param>
    public void Toggle(string seriesKey)
    {
        ArgumentException.ThrowIfNullOrEmpty(seriesKey);

        // Read the latest value from the store rather than a cached copy, matching the web functional update that
        // reads `prev` from the current URL so concurrent toggles never clobber each other.
        var next = new HashSet<string>(ReadCurrentList(), StringComparer.Ordinal);
        if (!next.Remove(seriesKey))
        {
            next.Add(seriesKey);
        }

        _store.Write(_paramName, HiddenSeriesSerialization.Serialize(next));
        _diagnostics?.RecordToggled();
    }

    /// <summary>
    /// Clear every hidden flag (web <c>reset</c>): drops <c>hidden_{chartKey}</c> from the query string so the
    /// chart returns to its canonical all-series-visible view.
    /// </summary>
    public void Reset()
    {
        _store.Write(_paramName, null);
        _diagnostics?.RecordReset();
    }

    /// <summary>Detach from the store (the web effect cleanup); idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _store.Changed -= OnStoreChanged;
        GC.SuppressFinalize(this);
    }

    private IReadOnlyList<string> ReadCurrentList() => HiddenSeriesSerialization.Parse(_store.Read(_paramName));

    private HashSet<string> ReadHidden() => new(ReadCurrentList(), StringComparer.Ordinal);

    private void OnStoreChanged(object? sender, EventArgs e)
    {
        HashSet<string> next = ReadHidden();
        if (next.SetEquals(_hidden))
        {
            return;
        }

        _hidden = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Hidden)));
    }
}

/// <summary>
/// The provider's conditional-creation decision — the native, UI-free port of the web
/// <c>ChartHiddenSeriesProvider</c> branch (<c>if (!chartKey) return &lt;&gt;{children(null)}&lt;/&gt;</c>). A
/// falsy chart key means the chart did not opt into legend toggling, so the provider supplies <c>null</c> as the
/// context value (no <c>useHiddenSeries</c> subscription); a real key creates a bound <see cref="HiddenSeriesState"/>.
/// Kept static so the branch is asserted headlessly, exactly mirroring the source's single conditional.
/// </summary>
public static class ChartHiddenSeriesProviderModel
{
    /// <summary>
    /// Resolve the context value for a provider: <c>null</c> when <paramref name="chartKey"/> is null or empty
    /// (the chart did not adopt toggling), otherwise a <see cref="HiddenSeriesState"/> bound to
    /// <paramref name="store"/>.
    /// </summary>
    /// <param name="store">The query-string seam the created state binds to.</param>
    /// <param name="chartKey">The chart identifier, or null/empty when the chart did not opt in.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector passed to the created state.</param>
    public static HiddenSeriesState? Create(IHiddenSeriesQueryStore store, string? chartKey, ChartHiddenSeriesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(store);
        if (string.IsNullOrEmpty(chartKey))
        {
            return null;
        }

        return new HiddenSeriesState(store, chartKey, diagnostics);
    }
}
