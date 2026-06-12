namespace TeslaSync.App.SharedSurfaces.BreadcrumbOverridesContextSurface;

/// <summary>
/// The breadcrumb-override registry seam the surface binds to (P1/S8 state-holder layer) — the native analogue of the
/// React state inside the web <c>BreadcrumbOverridesProvider</c> (the <c>Map&lt;number, BreadcrumbOverrideMap&gt;</c>
/// of registration-id → map plus its merged <c>overrides</c>). Pages push their per-route labels in through
/// <see cref="Register"/> (web <c>register</c>) and drop them with <see cref="Unregister"/> (web <c>unregister</c>); the
/// global breadcrumb reads the merged map from <see cref="MergedOverrides"/> (web <c>useBreadcrumbOverrides()</c>) and
/// re-renders on
/// <see cref="Changed"/>. The canonical implementation is <see cref="BreadcrumbOverridesRegistry"/>;
/// <see cref="NoOpBreadcrumbOverridesRegistry"/> stands in outside a provider (web <c>useContext</c> returning
/// <c>null</c>, where <c>useBreadcrumbOverrides</c> falls back to <c>{}</c> and <c>useSetBreadcrumbOverrides</c> is a
/// no-op). The view never touches the registry directly for reads — it binds through the
/// <see cref="BreadcrumbOverridesState"/> / <see cref="BreadcrumbOverridesPublisher"/> holders.
/// </summary>
public interface IBreadcrumbOverridesRegistry
{
    /// <summary>
    /// The merged override map (web <c>overrides</c>): every registered map shallow-merged in registration order with
    /// a later registration winning for the same route key. A snapshot; it is replaced (and <see cref="Changed"/>
    /// raised) whenever the merged content changes.
    /// </summary>
    IReadOnlyDictionary<string, string> MergedOverrides { get; }

    /// <summary>
    /// Allocate a fresh, monotonically-increasing registration id (web module-level <c>nextId++</c>). Each write-side
    /// consumer takes one id and registers under it; a higher id sorts later in the merge, so it wins for shared keys.
    /// </summary>
    int CreateRegistrationId();

    /// <summary>
    /// Register (or replace) the override map stored under <paramref name="id"/> (web <c>register(id, map)</c>). Raises
    /// <see cref="Changed"/> only when the resulting merged map differs from the previous one.
    /// </summary>
    /// <param name="id">The registration id obtained from <see cref="CreateRegistrationId"/>.</param>
    /// <param name="map">The override map to store for this id.</param>
    void Register(int id, IReadOnlyDictionary<string, string> map);

    /// <summary>
    /// Drop the override map stored under <paramref name="id"/> (web <c>unregister(id)</c>). Raises
    /// <see cref="Changed"/> only when the merged map actually changes; a no-op when the id was never registered.
    /// </summary>
    /// <param name="id">The registration id to remove.</param>
    void Unregister(int id);

    /// <summary>
    /// Raised whenever the merged <see cref="MergedOverrides"/> map changes (web re-render of <c>useBreadcrumbOverrides</c>
    /// consumers when the provider's <c>overrides</c> memo yields new content).
    /// </summary>
    event EventHandler? Changed;
}

/// <summary>
/// The canonical in-process breadcrumb-override registry — the native port of the single global
/// <c>BreadcrumbOverridesProvider</c> the web app mounts once at the layout root. Like that single provider it is
/// process-wide via <see cref="Shared"/>, so every page registers its labels and the one global breadcrumb reads the
/// merged result from the same instance. Registrations are merged in ascending-id order (web Map insertion order;
/// ids are monotonic, so this is registration order) with a later registration winning for a shared route key.
/// <see cref="Changed"/> fires only when the merged map actually changes — re-registering identical content, or
/// removing an unknown id, raises nothing — mirroring React re-rendering consumers only on a new <c>overrides</c>
/// value. Thread-safe because pages register and unregister from effects that may run off the UI thread.
/// </summary>
public sealed class BreadcrumbOverridesRegistry : IBreadcrumbOverridesRegistry
{
    private readonly object _gate = new();
    private readonly Dictionary<int, IReadOnlyDictionary<string, string>> _registrations = new();
    private int _nextId;
    private IReadOnlyDictionary<string, string> _overrides = EmptyOverrides;

    private static readonly IReadOnlyDictionary<string, string> EmptyOverrides =
        new Dictionary<string, string>(StringComparer.Ordinal);

    /// <summary>
    /// The process-wide registry — the native analogue of the single layout-root <c>BreadcrumbOverridesProvider</c>,
    /// so per-page label overrides and the global breadcrumb read coordinate through one instance.
    /// </summary>
    public static BreadcrumbOverridesRegistry Shared { get; } = new();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyDictionary<string, string> MergedOverrides
    {
        get
        {
            lock (_gate)
            {
                return _overrides;
            }
        }
    }

    /// <inheritdoc />
    public int CreateRegistrationId() => Interlocked.Increment(ref _nextId);

    /// <inheritdoc />
    public void Register(int id, IReadOnlyDictionary<string, string> map)
    {
        ArgumentNullException.ThrowIfNull(map);

        bool changed;
        lock (_gate)
        {
            _registrations[id] = Snapshot(map);
            changed = Recompute();
        }

        if (changed)
        {
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    /// <inheritdoc />
    public void Unregister(int id)
    {
        bool changed;
        lock (_gate)
        {
            if (!_registrations.Remove(id))
            {
                return;
            }

            changed = Recompute();
        }

        if (changed)
        {
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    private static Dictionary<string, string> Snapshot(IReadOnlyDictionary<string, string> map)
    {
        // Defensive immutable copy so a caller that mutates its map after registering cannot reach into the registry.
        var copy = new Dictionary<string, string>(map.Count, StringComparer.Ordinal);
        foreach (KeyValuePair<string, string> entry in map)
        {
            copy[entry.Key] = entry.Value;
        }

        return copy;
    }

    private bool Recompute()
    {
        // Ordered by id ascending = registration order; the merge lets a later (higher-id) registration win.
        IEnumerable<IReadOnlyDictionary<string, string>?> ordered = _registrations
            .OrderBy(static entry => entry.Key)
            .Select(static entry => (IReadOnlyDictionary<string, string>?)entry.Value);

        IReadOnlyDictionary<string, string> merged = BreadcrumbOverrideMerge.Merge(ordered);
        if (BreadcrumbOverrideMerge.AreEqual(_overrides, merged))
        {
            return false;
        }

        _overrides = merged;
        return true;
    }
}

/// <summary>
/// The inert registry used outside a provider — the native analogue of the web hooks resolving a <c>null</c> context
/// (<c>useBreadcrumbOverrides()</c> → <c>{}</c>, <c>useSetBreadcrumbOverrides()</c> → no-op). <see cref="MergedOverrides"/>
/// is always empty, <see cref="CreateRegistrationId"/> returns <c>0</c>, <see cref="Register"/> / <see cref="Unregister"/> do
/// nothing and <see cref="Changed"/> never fires, so a page that binds the seam with no breadcrumb provider in scope
/// degrades gracefully instead of throwing.
/// </summary>
public sealed class NoOpBreadcrumbOverridesRegistry : IBreadcrumbOverridesRegistry
{
    private static readonly IReadOnlyDictionary<string, string> EmptyOverrides =
        new Dictionary<string, string>(StringComparer.Ordinal);

    /// <summary>The shared inert instance.</summary>
    public static NoOpBreadcrumbOverridesRegistry Instance { get; } = new();

    private NoOpBreadcrumbOverridesRegistry()
    {
    }

    /// <inheritdoc />
    public event EventHandler? Changed
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public IReadOnlyDictionary<string, string> MergedOverrides => EmptyOverrides;

    /// <inheritdoc />
    public int CreateRegistrationId() => 0;

    /// <inheritdoc />
    public void Register(int id, IReadOnlyDictionary<string, string> map) => ArgumentNullException.ThrowIfNull(map);

    /// <inheritdoc />
    public void Unregister(int id)
    {
    }
}
