using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AnnotationList"/> view — the native port of the web
/// component body (web/src/components/charts/AnnotationList.tsx). The web component is a controlled, presentational
/// list: it takes an <c>annotations</c> array and an <c>onRemove</c> callback, renders nothing when the array is
/// empty (<c>if (annotations.length === 0) return null;</c>), and otherwise renders a title plus one row per
/// annotation with a remove action. This holder reproduces that exactly over an injected
/// <see cref="IAnnotationListSource"/> (the P1/S8 seam): it exposes the localized <see cref="Title"/> and remove
/// accessible name, the <see cref="IsEmpty"/> flag (the web null-render branch), the projected <see cref="Rows"/>,
/// and the <see cref="Remove"/> command (web <c>onRemove</c>), re-raising the relevant notifications whenever the
/// source changes.
/// </summary>
/// <remarks>
/// Because the web source is a controlled component with no data fetch of its own, there is no loading / error /
/// stale / offline branch to model (the web source has none); its only states are the empty list (render nothing,
/// <see cref="IsEmpty"/>) and the populated list (<see cref="Rows"/>) — the same rationale as the sibling
/// presentational surfaces. The view never performs HTTP; it observes this holder and renders. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </remarks>
public sealed class AnnotationListViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAnnotationListSource _source;
    private readonly ILocalizer _localizer;
    private readonly AnnotationListDiagnostics _diagnostics;

    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the holder over the annotation seam, the i18n facade and an optional diagnostics sink.</summary>
    /// <param name="source">The annotation collection seam (P1/S8) the surface binds to.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public AnnotationListViewModel(
        IAnnotationListSource source,
        ILocalizer localizer,
        AnnotationListDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new AnnotationListDiagnostics();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AnnotationList</c>).</summary>
    public static string Slug => AnnotationListRegistration.Slug;

    /// <summary>The localized list title (web <c>t('annotation.listTitle', 'Annotations')</c>).</summary>
    public string Title => AnnotationListRegistration.ListTitle(_localizer);

    /// <summary>The localized remove-action accessible name (web <c>t('annotation.remove', 'Remove annotation')</c>).</summary>
    public string RemoveLabel => AnnotationListRegistration.RemoveLabel(_localizer);

    /// <summary>
    /// True when there are no annotations — the web null-render branch
    /// (<c>if (annotations.length === 0) return null;</c>). The view contributes nothing visible in this state.
    /// </summary>
    public bool IsEmpty => _source.Annotations.Count == 0;

    /// <summary>True when there is at least one annotation to render (the inverse of <see cref="IsEmpty"/>).</summary>
    public bool HasAnnotations => !IsEmpty;

    /// <summary>The projected rows in render order (web <c>annotations.map</c>); empty when <see cref="IsEmpty"/>.</summary>
    public IReadOnlyList<AnnotationRow> Rows => AnnotationListProjection.Project(_source.Annotations);

    /// <summary>
    /// Remove the annotation with the given id (web <c>onRemove(ann.id)</c>) by forwarding to the source; the
    /// resulting <see cref="IAnnotationListSource.Changed"/> re-projects <see cref="Rows"/> / <see cref="IsEmpty"/>.
    /// A call after disposal is a no-op.
    /// </summary>
    /// <param name="id">The id of the annotation to remove.</param>
    public void Remove(string id)
    {
        if (_disposed)
        {
            return;
        }

        _source.Remove(id);
    }

    /// <summary>
    /// Record that the surface was opened (web mount) — emits the <c>view.opened</c> diagnostics event exactly
    /// once. Idempotent so a re-entrant load does not double-count.
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
        // The web parent re-renders the controlled list with a new array; re-project the derived state.
        Raise(nameof(IsEmpty));
        Raise(nameof(HasAnnotations));
        Raise(nameof(Rows));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
