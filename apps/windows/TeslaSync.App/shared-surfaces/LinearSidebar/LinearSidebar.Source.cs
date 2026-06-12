using System.Collections.Generic;
using System.Linq;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The active-location seam (P1/S8 state-holder layer) — the native unification of the web
/// <c>useLocation()</c> hook the LinearSidebar reads for its active-path fallback
/// (web/src/components/layout/sidebar/LinearSidebar.tsx <c>const location = useLocation()</c>). The view never
/// touches the router directly; it asks this seam for the current path and re-projects when it changes. The
/// shipped in-process implementation (<see cref="InMemoryNavLocationSource"/>) backs galleries / tests and the
/// default headless construction; production wires it to the shell's current-route observable.
/// </summary>
public interface INavLocationSource
{
    /// <summary>The current route path, normalized to a leading slash (web <c>location.pathname</c>).</summary>
    string CurrentPath { get; }

    /// <summary>Raised when <see cref="CurrentPath"/> changes so the surface can re-project the active row.</summary>
    event EventHandler? PathChanged;
}

/// <summary>
/// An in-process <see cref="INavLocationSource"/> holding the current path in memory — the default backing for
/// galleries, headless construction and tests, and a safe fallback when no router observable is wired.
/// <see cref="Navigate"/> updates the path and notifies subscribers only on a genuine change, mirroring the web
/// router emitting a new <c>location</c> object on navigation.
/// </summary>
public sealed class InMemoryNavLocationSource : INavLocationSource
{
    private string _path;

    /// <summary>Creates the source at <paramref name="initialPath"/> (null / empty normalizes to the root "/").</summary>
    public InMemoryNavLocationSource(string? initialPath = null) => _path = Normalize(initialPath);

    /// <inheritdoc />
    public string CurrentPath => _path;

    /// <inheritdoc />
    public event EventHandler? PathChanged;

    /// <summary>Move to <paramref name="path"/> (normalized); raises <see cref="PathChanged"/> only when it changes.</summary>
    public void Navigate(string? path)
    {
        string next = Normalize(path);
        if (string.Equals(_path, next, StringComparison.Ordinal))
        {
            return;
        }

        _path = next;
        PathChanged?.Invoke(this, EventArgs.Empty);
    }

    private static string Normalize(string? path) => string.IsNullOrEmpty(path) ? "/" : path;
}

/// <summary>
/// The pinned-pages (favorites) seam (P1/S8 state-holder layer) — the native unification of the web pin state
/// the LinearSidebar both reads (its <c>pinnedItems</c> source) and mutates (its <c>onPin</c> / <c>onUnpin</c>
/// callbacks), owned by Layout on the web. The view never persists pins itself; it asks this seam for the
/// ordered pinned route keys and routes pin / unpin intents back through it. The shipped in-process
/// implementation (<see cref="InMemoryPinnedPagesStore"/>) backs galleries / tests; production wires it to the
/// durable per-user favorites store.
/// </summary>
public interface IPinnedPagesStore
{
    /// <summary>The pinned route keys in pin order (web <c>pinnedItems</c> order).</summary>
    IReadOnlyList<string> Pinned { get; }

    /// <summary>Whether <paramref name="route"/> is currently pinned (web <c>pinnedSet.has(to)</c>).</summary>
    bool IsPinned(string route);

    /// <summary>Pin <paramref name="route"/>, appending it in pin order if not already present (web <c>onPin</c>).</summary>
    void Pin(string route);

    /// <summary>Unpin <paramref name="route"/> if present (web <c>onUnpin</c>).</summary>
    void Unpin(string route);

    /// <summary>Raised when the pin set changes so the surface can re-project the favorites group.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An in-process <see cref="IPinnedPagesStore"/> keeping the pinned keys in memory, newest-pin-last — the
/// default backing for galleries, headless construction and tests. Pins are de-duplicated by ordinal key;
/// pinning an already-pinned route and unpinning an absent one are no-ops (no spurious notification), mirroring
/// the web pin state's idempotence.
/// </summary>
public sealed class InMemoryPinnedPagesStore : IPinnedPagesStore
{
    private readonly List<string> _pinned = new();

    /// <summary>Creates the store, seeding it with <paramref name="initial"/> pins in order (blank / duplicate keys are dropped).</summary>
    public InMemoryPinnedPagesStore(IEnumerable<string>? initial = null)
    {
        if (initial is null)
        {
            return;
        }

        foreach (string key in initial)
        {
            if (!string.IsNullOrEmpty(key) && !_pinned.Contains(key, StringComparer.Ordinal))
            {
                _pinned.Add(key);
            }
        }
    }

    /// <inheritdoc />
    public IReadOnlyList<string> Pinned => _pinned;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool IsPinned(string route) =>
        !string.IsNullOrEmpty(route) && _pinned.Contains(route, StringComparer.Ordinal);

    /// <inheritdoc />
    public void Pin(string route)
    {
        if (string.IsNullOrEmpty(route) || _pinned.Contains(route, StringComparer.Ordinal))
        {
            return;
        }

        _pinned.Add(route);
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void Unpin(string route)
    {
        if (string.IsNullOrEmpty(route))
        {
            return;
        }

        int index = _pinned.FindIndex(p => string.Equals(p, route, StringComparison.Ordinal));
        if (index < 0)
        {
            return;
        }

        _pinned.RemoveAt(index);
        Changed?.Invoke(this, EventArgs.Empty);
    }
}
