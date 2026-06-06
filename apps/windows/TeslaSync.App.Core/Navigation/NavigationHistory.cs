namespace TeslaSync.App.Core.Navigation;

/// <summary>
/// A back/forward navigation stack for the shell's content frame (port of the
/// browser-history semantics React Router gives the web app). Pushing a new entry
/// truncates any forward history, exactly like a real browser. Pure and headless so
/// the stack behavior is unit-tested without a <c>Frame</c>.
/// </summary>
public sealed class NavigationHistory
{
    private readonly List<string> _entries = [];
    private int _index = -1;

    /// <summary>The maximum number of retained entries before the oldest is dropped.</summary>
    public int Capacity { get; }

    /// <summary>Create a history with an optional bounded <paramref name="capacity"/> (default 100).</summary>
    public NavigationHistory(int capacity = 100)
    {
        if (capacity < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(capacity), capacity, "Capacity must be positive.");
        }

        Capacity = capacity;
    }

    /// <summary>The path of the current entry, or null when the history is empty.</summary>
    public string? Current => _index >= 0 && _index < _entries.Count ? _entries[_index] : null;

    /// <summary>Number of entries currently retained.</summary>
    public int Count => _entries.Count;

    /// <summary>True when <see cref="Back"/> would move to an earlier entry.</summary>
    public bool CanGoBack => _index > 0;

    /// <summary>True when <see cref="Forward"/> would move to a later entry.</summary>
    public bool CanGoForward => _index >= 0 && _index < _entries.Count - 1;

    /// <summary>The retained entries from oldest to newest.</summary>
    public IReadOnlyList<string> Entries => _entries;

    /// <summary>
    /// Push a new path as the current entry, truncating forward history. A push that
    /// repeats <see cref="Current"/> is ignored (no duplicate adjacent entries).
    /// </summary>
    public void Push(string path)
    {
        var normalized = RouteRegistry.Normalize(path);
        if (string.Equals(Current, normalized, StringComparison.Ordinal))
        {
            return;
        }

        // Drop any forward history beyond the current entry.
        if (_index < _entries.Count - 1)
        {
            _entries.RemoveRange(_index + 1, _entries.Count - _index - 1);
        }

        _entries.Add(normalized);
        _index = _entries.Count - 1;

        // Enforce the capacity bound from the front.
        if (_entries.Count > Capacity)
        {
            int overflow = _entries.Count - Capacity;
            _entries.RemoveRange(0, overflow);
            _index -= overflow;
        }
    }

    /// <summary>Move to the previous entry and return it, or null when at the start.</summary>
    public string? Back()
    {
        if (!CanGoBack)
        {
            return null;
        }

        _index--;
        return Current;
    }

    /// <summary>Move to the next entry and return it, or null when at the end.</summary>
    public string? Forward()
    {
        if (!CanGoForward)
        {
            return null;
        }

        _index++;
        return Current;
    }

    /// <summary>Clear all history.</summary>
    public void Clear()
    {
        _entries.Clear();
        _index = -1;
    }
}
