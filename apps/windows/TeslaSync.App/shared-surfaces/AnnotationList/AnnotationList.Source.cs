namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The annotation collection the list binds to (P1/S8 state-holder seam) — the native analogue of the two web
/// props the controlled <c>AnnotationList</c> receives: the <c>annotations</c> array and the <c>onRemove(id)</c>
/// callback (web/src/components/charts/AnnotationList.tsx L7-L10). The web component owns no state — its parent
/// holds the array and the remove handler — so the native surface binds to this seam (the owning store) rather
/// than performing any HTTP itself: the view never fetches, it reads <see cref="Annotations"/>, re-projects on
/// <see cref="Changed"/>, and calls <see cref="Remove"/> for a row's remove action. A shell adapter (or a test
/// fake) supplies the implementation, so the surface logic is asserted headlessly.
/// </summary>
public interface IAnnotationListSource
{
    /// <summary>The current annotations in render order (web <c>annotations</c> prop).</summary>
    IReadOnlyList<DataAnnotation> Annotations { get; }

    /// <summary>Raised whenever the annotation set changes (web parent re-rendering with a new array).</summary>
    event EventHandler? Changed;

    /// <summary>
    /// Remove the annotation with the given id (web <c>onRemove(ann.id)</c>). An empty/unknown id is a no-op; a
    /// real removal raises <see cref="Changed"/> so the bound surface re-projects.
    /// </summary>
    /// <param name="id">The id of the annotation to remove.</param>
    void Remove(string id);
}

/// <summary>
/// The canonical in-memory <see cref="IAnnotationListSource"/> — the native analogue of the web parent that owns
/// the annotation array and the remove handler (the controlled <c>AnnotationList</c> holds no state of its own).
/// It is seeded with an initial set, removes by id and raises <see cref="Changed"/> on every mutation so the bound
/// <see cref="AnnotationListViewModel"/> re-projects, and exposes <see cref="Replace"/> so a host can swap the set
/// (the native analogue of the web <c>annotations</c> prop changing). UI-thread-confined; not internally
/// synchronised.
/// </summary>
public sealed class AnnotationListStore : IAnnotationListSource
{
    private readonly List<DataAnnotation> _annotations;

    /// <summary>Creates the store over an optional initial annotation set (copied; null is treated as empty).</summary>
    public AnnotationListStore(IEnumerable<DataAnnotation>? annotations = null) =>
        _annotations = annotations is null ? [] : [.. annotations];

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyList<DataAnnotation> Annotations => _annotations;

    /// <inheritdoc />
    public void Remove(string id)
    {
        if (string.IsNullOrEmpty(id))
        {
            return;
        }

        int removed = _annotations.RemoveAll(annotation => string.Equals(annotation.Id, id, StringComparison.Ordinal));
        if (removed > 0)
        {
            Raise();
        }
    }

    /// <summary>
    /// Replace the whole annotation set (the native analogue of the web <c>annotations</c> prop changing) and
    /// raise <see cref="Changed"/> so the bound surface re-projects.
    /// </summary>
    /// <param name="annotations">The new annotation set (copied).</param>
    public void Replace(IEnumerable<DataAnnotation> annotations)
    {
        ArgumentNullException.ThrowIfNull(annotations);
        _annotations.Clear();
        _annotations.AddRange(annotations);
        Raise();
    }

    private void Raise() => Changed?.Invoke(this, EventArgs.Empty);
}
