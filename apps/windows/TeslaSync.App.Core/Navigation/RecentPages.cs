namespace TeslaSync.App.Core.Navigation;

/// <summary>A recorded page visit: the route path, its display title and when it was seen.</summary>
/// <param name="Path">Normalized route path.</param>
/// <param name="Title">Display title captured at record time.</param>
/// <param name="VisitedAt">Timestamp of the most recent visit.</param>
public readonly record struct RecentPage(string Path, string Title, DateTimeOffset VisitedAt);

/// <summary>
/// Most-recently-visited page recorder (port of the web <c>recordPageView</c> store
/// behind the command palette's "recent pages"). Keeps a bounded, de-duplicated,
/// newest-first list: revisiting a path moves it to the front rather than adding a
/// duplicate. Pure and headless so the LRU semantics are unit-tested.
/// </summary>
public sealed class RecentPages
{
    private readonly List<RecentPage> _items = [];

    /// <summary>Maximum retained entries before the least-recent is evicted.</summary>
    public int Capacity { get; }

    /// <summary>Create a recorder with an optional bounded <paramref name="capacity"/> (default 12).</summary>
    public RecentPages(int capacity = 12)
    {
        if (capacity < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(capacity), capacity, "Capacity must be positive.");
        }

        Capacity = capacity;
    }

    /// <summary>The retained visits, newest first.</summary>
    public IReadOnlyList<RecentPage> Items => _items;

    /// <summary>
    /// Record a visit to <paramref name="path"/>. An existing entry for the same path
    /// is moved to the front and its title/timestamp refreshed; otherwise a new entry
    /// is prepended and the list trimmed to <see cref="Capacity"/>. Blank paths are
    /// ignored.
    /// </summary>
    public void Record(string path, string title, DateTimeOffset? at = null)
    {
        var normalized = RouteRegistry.Normalize(path);
        var when = at ?? DateTimeOffset.UtcNow;

        int existing = _items.FindIndex(p => string.Equals(p.Path, normalized, StringComparison.Ordinal));
        if (existing >= 0)
        {
            _items.RemoveAt(existing);
        }

        _items.Insert(0, new RecentPage(normalized, title ?? string.Empty, when));

        if (_items.Count > Capacity)
        {
            _items.RemoveRange(Capacity, _items.Count - Capacity);
        }
    }

    /// <summary>Clear all recorded visits.</summary>
    public void Clear() => _items.Clear();
}
