using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the native <c>DateGroupedList</c> view — the native port of the web
/// component body (web/src/components/data-display/DateGroupedList.tsx). The web component is a controlled,
/// presentational list: it maps an injected <c>groups</c> array into one labelled section per bucket and an
/// empty container when the array is empty (web spec: an empty <c>groups</c> renders a container with no
/// sections). This holder reproduces that over an injected <see cref="IDateGroupedListSource{T}"/> (the
/// P1/S8 seam): it exposes the <see cref="IsEmpty"/> flag (the web empty-container branch), the
/// <see cref="Groups"/> in render order and their projected <see cref="Headers"/>, re-raising the relevant
/// notifications whenever the source changes.
/// </summary>
/// <remarks>
/// Because the web source is a controlled component with no data fetch of its own, there is no loading /
/// error / stale / offline branch to model (the web source has none); its only states are the empty list
/// (an empty container, <see cref="IsEmpty"/>) and the populated list (<see cref="Groups"/>) — the same
/// rationale as the sibling presentational shared surfaces. The view never performs I/O; it observes this
/// holder and renders. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </remarks>
/// <typeparam name="T">The item type each bucket holds (the web generic parameter).</typeparam>
public sealed class DateGroupedListViewModel<T> : INotifyPropertyChanged, IDisposable
{
    private readonly IDateGroupedListSource<T> _source;
    private readonly DateGroupedListDiagnostics _diagnostics;

    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the holder over the bucket seam and an optional diagnostics sink.</summary>
    /// <param name="source">The grouped-bucket seam (P1/S8) the surface binds to.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public DateGroupedListViewModel(
        IDateGroupedListSource<T> source,
        DateGroupedListDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);

        _source = source;
        _diagnostics = diagnostics ?? new DateGroupedListDiagnostics();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// True when there are no buckets — the web empty-container branch (an empty <c>groups</c> array renders
    /// a container with no sections). The view keeps its container present but childless in this state.
    /// </summary>
    public bool IsEmpty => _source.Groups.Count == 0;

    /// <summary>True when there is at least one bucket to render (the inverse of <see cref="IsEmpty"/>).</summary>
    public bool HasGroups => !IsEmpty;

    /// <summary>The buckets in render order (web <c>groups</c>); empty when <see cref="IsEmpty"/>.</summary>
    public IReadOnlyList<DateGroupedListGroup<T>> Groups => _source.Groups;

    /// <summary>The projected divider headers in render order (web per-section <c>&lt;header&gt;</c>).</summary>
    public IReadOnlyList<DateGroupedListHeader> Headers =>
        [.. _source.Groups.Select(group => DateGroupedListProjection.Header(group))];

    /// <summary>
    /// Record that the surface was opened (web mount) — emits the <c>view.opened</c> diagnostics event
    /// exactly once. Idempotent so a re-entrant load does not double-count.
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
        // The web parent re-renders the controlled list with a new groups array; re-project the derived state.
        Raise(nameof(IsEmpty));
        Raise(nameof(HasGroups));
        Raise(nameof(Groups));
        Raise(nameof(Headers));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
