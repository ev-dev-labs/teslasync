namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The grouped-bucket collection the list binds to (P1/S8 state-holder seam) — the native analogue of the
/// web <c>groups</c> prop the controlled <c>DateGroupedList</c> receives
/// (web/src/components/data-display/DateGroupedList.tsx L24). The web component owns no state: its parent
/// (e.g. web/src/features/driving/pages/DrivesListPage.tsx) memoizes the grouped buckets and passes them in,
/// re-rendering with a new array when the underlying data changes. The native surface therefore binds to
/// this seam (the owning store) rather than fetching anything itself: the view never performs I/O — it reads
/// <see cref="Groups"/> and re-projects on <see cref="Changed"/>. A shell adapter (or a test fake) supplies
/// the implementation, so the surface logic is asserted headlessly.
/// </summary>
/// <typeparam name="T">The item type each bucket holds (the web generic parameter).</typeparam>
public interface IDateGroupedListSource<T>
{
    /// <summary>The current buckets in render order (web <c>groups</c> prop).</summary>
    IReadOnlyList<DateGroupedListGroup<T>> Groups { get; }

    /// <summary>Raised whenever the bucket set changes (web parent re-rendering with a new <c>groups</c> array).</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The canonical in-memory <see cref="IDateGroupedListSource{T}"/> — the native analogue of the web parent
/// that owns the memoized <c>groups</c> array (the controlled <c>DateGroupedList</c> holds no state of its
/// own). It is seeded with an initial set and exposes <see cref="Replace"/> so a host can swap the buckets
/// (the native analogue of the web <c>groups</c> prop changing), raising <see cref="Changed"/> on every swap
/// so the bound view re-projects. UI-thread-confined; not internally synchronised.
/// </summary>
/// <typeparam name="T">The item type each bucket holds.</typeparam>
public sealed class DateGroupedListStore<T> : IDateGroupedListSource<T>
{
    private readonly List<DateGroupedListGroup<T>> _groups;

    /// <summary>Creates the store over an optional initial bucket set (copied; null is treated as empty).</summary>
    public DateGroupedListStore(IEnumerable<DateGroupedListGroup<T>>? groups = null) =>
        _groups = groups is null ? [] : [.. groups];

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyList<DateGroupedListGroup<T>> Groups => _groups;

    /// <summary>
    /// Replace the whole bucket set (the native analogue of the web <c>groups</c> prop changing) and raise
    /// <see cref="Changed"/> so the bound surface re-projects.
    /// </summary>
    /// <param name="groups">The new bucket set (copied).</param>
    public void Replace(IEnumerable<DateGroupedListGroup<T>> groups)
    {
        ArgumentNullException.ThrowIfNull(groups);
        _groups.Clear();
        _groups.AddRange(groups);
        Raise();
    }

    private void Raise() => Changed?.Invoke(this, EventArgs.Empty);
}
