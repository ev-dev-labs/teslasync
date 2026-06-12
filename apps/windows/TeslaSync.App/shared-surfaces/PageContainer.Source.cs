using System.Collections.ObjectModel;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The breadcrumb-override state-holder seam the <c>PageContainer</c> binds through (P1/S8) — the native analogue of
/// the web <c>BreadcrumbOverridesContext</c> (web/src/components/layout/BreadcrumbOverridesContext.tsx). A page
/// pushes per-route label overrides (keyed by route pattern, e.g. <c>{ "/drives/:id": "Trip to office" }</c>) up to
/// the global navigation chrome via <see cref="Register"/> so the single top-of-shell breadcrumb can show rich,
/// friendly labels without each page rendering its own duplicate breadcrumb row — the web
/// <c>useSetBreadcrumbOverrides</c> contract. Multiple pages can register simultaneously; the seam merges them and
/// exposes the merged map through <see cref="Overrides"/>, raising <see cref="Changed"/> whenever a registration is
/// added or removed. The composition root adapts this to the shell's breadcrumb builder; the view never reads or
/// mutates the navigation chrome directly.
/// </summary>
public interface IBreadcrumbOverrideSink
{
    /// <summary>The merged override map across every active registration (web <c>useBreadcrumbOverrides()</c>).</summary>
    IReadOnlyDictionary<string, string> MergedOverrides { get; }

    /// <summary>Raised whenever a registration is added or removed; may be raised from a background thread.</summary>
    event EventHandler? Changed;

    /// <summary>
    /// Register an override map for the current page and return an unregister token — the web
    /// <c>register(id, map)</c> whose returned cleanup is the effect's teardown. Disposing the token removes the
    /// registration (idempotent). A later registration wins over an earlier one for the same route key (web
    /// shallow-merge, latest-effect-wins).
    /// </summary>
    /// <param name="labels">The route-pattern → label overrides to publish.</param>
    IDisposable Register(IReadOnlyDictionary<string, string> labels);
}

/// <summary>
/// The inert <see cref="IBreadcrumbOverrideSink"/> — the headless / designer default for a surface mounted without
/// the navigation chrome wired, mirroring the web <c>useSetBreadcrumbOverrides</c> short-circuit when no
/// <c>BreadcrumbOverridesContext</c> provider is in the tree (<c>if (!ctx) return;</c>). <see cref="Overrides"/> is
/// always empty and <see cref="Register"/> returns a no-op token, so a page's override push is silently dropped
/// rather than throwing.
/// </summary>
public sealed class NullBreadcrumbOverrideSink : IBreadcrumbOverrideSink
{
    /// <summary>The shared singleton instance.</summary>
    public static NullBreadcrumbOverrideSink Instance { get; } = new();

    private NullBreadcrumbOverrideSink()
    {
    }

    /// <inheritdoc />
    public IReadOnlyDictionary<string, string> MergedOverrides { get; } =
        ReadOnlyDictionary<string, string>.Empty;

    /// <inheritdoc />
    public event EventHandler? Changed
    {
        add
        {
            // No registrations ever change, so the subscription is intentionally inert.
        }

        remove
        {
            // No registrations ever change, so the subscription is intentionally inert.
        }
    }

    /// <inheritdoc />
    public IDisposable Register(IReadOnlyDictionary<string, string> labels)
    {
        ArgumentNullException.ThrowIfNull(labels);
        return NoOpRegistration.Instance;
    }

    private sealed class NoOpRegistration : IDisposable
    {
        public static NoOpRegistration Instance { get; } = new();

        private NoOpRegistration()
        {
        }

        public void Dispose()
        {
            // Nothing is registered, so there is nothing to unregister.
        }
    }
}

/// <summary>
/// The production <see cref="IBreadcrumbOverrideSink"/> — the native port of the web
/// <c>BreadcrumbOverridesProvider</c> (web/src/components/layout/BreadcrumbOverridesContext.tsx L32-77). It keeps a
/// monotonic-id map of active registrations and merges them shallow, lowest-id-first, so a later registration wins
/// for the same route key (the web <c>for (const map of registrations.values())</c> latest-wins merge). Adding or
/// removing a registration recomputes the merged map and raises <see cref="Changed"/> only when the merged result
/// actually moves, so an idempotent re-register is a no-op. Thread-safe; WinUI-free so the merge is unit-tested
/// without a UI host.
/// </summary>
public sealed class BreadcrumbOverrideSink : IBreadcrumbOverrideSink
{
    private readonly object _gate = new();
    private readonly SortedDictionary<int, IReadOnlyDictionary<string, string>> _registrations = new();
    private IReadOnlyDictionary<string, string> _merged = ReadOnlyDictionary<string, string>.Empty;
    private int _nextId;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyDictionary<string, string> MergedOverrides
    {
        get
        {
            lock (_gate)
            {
                return _merged;
            }
        }
    }

    /// <inheritdoc />
    public IDisposable Register(IReadOnlyDictionary<string, string> labels)
    {
        ArgumentNullException.ThrowIfNull(labels);

        // Snapshot the caller's map so a later mutation of their instance cannot reach back into the merge.
        var snapshot = Snapshot(labels);

        int id;
        bool changed;
        lock (_gate)
        {
            id = _nextId++;
            _registrations[id] = snapshot;
            changed = Recompute();
        }

        if (changed)
        {
            Changed?.Invoke(this, EventArgs.Empty);
        }

        return new Registration(this, id);
    }

    private void Unregister(int id)
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

    private bool Recompute()
    {
        var merged = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var registration in _registrations.Values)
        {
            foreach (var pair in registration)
            {
                merged[pair.Key] = pair.Value;
            }
        }

        if (DictionariesEqual(_merged, merged))
        {
            return false;
        }

        _merged = new ReadOnlyDictionary<string, string>(merged);
        return true;
    }

    private static Dictionary<string, string> Snapshot(IReadOnlyDictionary<string, string> source)
    {
        var copy = new Dictionary<string, string>(source.Count, StringComparer.Ordinal);
        foreach (var pair in source)
        {
            // Mirror the web merge, which drops falsy values (`if (v) merged[k] = v`).
            if (!string.IsNullOrEmpty(pair.Value))
            {
                copy[pair.Key] = pair.Value;
            }
        }

        return copy;
    }

    private static bool DictionariesEqual(
        IReadOnlyDictionary<string, string> left,
        Dictionary<string, string> right)
    {
        if (left.Count != right.Count)
        {
            return false;
        }

        foreach (var pair in left)
        {
            if (!right.TryGetValue(pair.Key, out var value) || !string.Equals(value, pair.Value, StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }

    private sealed class Registration : IDisposable
    {
        private readonly BreadcrumbOverrideSink _sink;
        private readonly int _id;
        private bool _disposed;

        public Registration(BreadcrumbOverrideSink sink, int id)
        {
            _sink = sink;
            _id = id;
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _sink.Unregister(_id);
        }
    }
}

/// <summary>
/// An <see cref="IDataFreshnessSource"/> that folds several freshness seams into one most-degraded representative —
/// the native port of the web <c>PageContainer</c> passing <c>pickWorstQuery(query)</c> into a single
/// <c>&lt;DataFreshnessAuto&gt;</c> (web/src/components/layout/PageContainer.tsx L84-104). It subscribes to each
/// child seam, recomputes the worst snapshot via <see cref="PageContainerFreshness.PickWorst"/> whenever any child
/// moves, and re-raises <see cref="IDataFreshnessSource.Changed"/> only when the representative actually changes.
/// <see cref="CanRefresh"/> is true when any child can refresh, and <see cref="Refresh"/> fans out to every child.
/// WinUI-free so the page-tier freshness fold is unit-tested without a UI host.
/// </summary>
public sealed class WorstOfDataFreshnessSource : IDataFreshnessSource, IDisposable
{
    private readonly object _gate = new();
    private readonly IReadOnlyList<IDataFreshnessSource> _sources;
    private DataFreshnessSnapshot _current;
    private bool _disposed;

    /// <summary>Creates the composite over the page's freshness seams.</summary>
    /// <param name="sources">The child seams to fold; must contain at least one element.</param>
    /// <exception cref="ArgumentException"><paramref name="sources"/> is empty.</exception>
    public WorstOfDataFreshnessSource(IReadOnlyList<IDataFreshnessSource> sources)
    {
        ArgumentNullException.ThrowIfNull(sources);
        if (sources.Count == 0)
        {
            throw new ArgumentException("At least one freshness source is required.", nameof(sources));
        }

        _sources = sources;
        _current = ComputeWorst();

        foreach (var source in _sources)
        {
            source.Changed += OnChildChanged;
        }
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public DataFreshnessSnapshot Current
    {
        get
        {
            lock (_gate)
            {
                return _current;
            }
        }
    }

    /// <inheritdoc />
    public bool CanRefresh
    {
        get
        {
            foreach (var source in _sources)
            {
                if (source.CanRefresh)
                {
                    return true;
                }
            }

            return false;
        }
    }

    /// <inheritdoc />
    public void Refresh()
    {
        foreach (var source in _sources)
        {
            source.Refresh();
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        foreach (var source in _sources)
        {
            source.Changed -= OnChildChanged;
        }

        GC.SuppressFinalize(this);
    }

    private void OnChildChanged(object? sender, EventArgs e)
    {
        DataFreshnessSnapshot next = ComputeWorst();

        lock (_gate)
        {
            if (_current == next)
            {
                return;
            }

            _current = next;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

    private DataFreshnessSnapshot ComputeWorst()
    {
        var snapshots = new DataFreshnessSnapshot[_sources.Count];
        for (var i = 0; i < _sources.Count; i++)
        {
            snapshots[i] = _sources[i].Current;
        }

        return PageContainerFreshness.PickWorst(snapshots);
    }
}
