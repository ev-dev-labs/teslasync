using System.ComponentModel;

namespace TeslaSync.App.Core.Forms;

/// <summary>
/// UI-thread-free model for the chip/token input (<c>TsTagInput</c>). Owns the
/// tag list, optional de-duplication, an optional cap and separator-splitting so
/// the WinUI control just renders chips and forwards key events.
/// </summary>
public sealed class TagInputModel : INotifyPropertyChanged
{
    private static readonly char[] DefaultSeparators = [',', ';', '\n', '\t'];

    private readonly List<string> _tags = [];
    private readonly bool _allowDuplicates;
    private readonly int? _maxTags;
    private readonly StringComparer _comparer;

    public TagInputModel(
        bool allowDuplicates = false,
        int? maxTags = null,
        bool caseInsensitive = true)
    {
        _allowDuplicates = allowDuplicates;
        _maxTags = maxTags;
        _comparer = caseInsensitive ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current tags, in insertion order.</summary>
    public IReadOnlyList<string> Tags => _tags;

    /// <summary>Number of tags.</summary>
    public int Count => _tags.Count;

    /// <summary>Whether another tag can be added (respects <c>maxTags</c>).</summary>
    public bool CanAddMore => _maxTags is null || _tags.Count < _maxTags;

    /// <summary>
    /// Add a single trimmed tag. Returns true when added (false when blank,
    /// duplicate, or at capacity).
    /// </summary>
    public bool Add(string? raw)
    {
        var value = raw?.Trim();
        if (string.IsNullOrEmpty(value) || !CanAddMore)
        {
            return false;
        }

        if (!_allowDuplicates && _tags.Contains(value, _comparer))
        {
            return false;
        }

        _tags.Add(value);
        RaiseChanged();
        return true;
    }

    /// <summary>
    /// Split <paramref name="raw"/> on the given separators (or the default set)
    /// and add each piece. Returns the tags actually added.
    /// </summary>
    public IReadOnlyList<string> AddMany(string? raw, char[]? separators = null)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return [];
        }

        var parts = raw.Split(separators ?? DefaultSeparators, StringSplitOptions.RemoveEmptyEntries);
        var added = new List<string>();
        foreach (var part in parts)
        {
            var trimmed = part.Trim();
            if (trimmed.Length == 0 || !CanAddMore)
            {
                continue;
            }

            if (!_allowDuplicates && _tags.Contains(trimmed, _comparer))
            {
                continue;
            }

            _tags.Add(trimmed);
            added.Add(trimmed);
        }

        if (added.Count > 0)
        {
            RaiseChanged();
        }

        return added;
    }

    /// <summary>Remove a tag by value. Returns true when removed.</summary>
    public bool Remove(string tag)
    {
        var index = _tags.FindIndex(t => _comparer.Equals(t, tag));
        if (index < 0)
        {
            return false;
        }

        _tags.RemoveAt(index);
        RaiseChanged();
        return true;
    }

    /// <summary>Remove the last tag (used by Backspace on an empty buffer). Returns true when removed.</summary>
    public bool RemoveLast()
    {
        if (_tags.Count == 0)
        {
            return false;
        }

        _tags.RemoveAt(_tags.Count - 1);
        RaiseChanged();
        return true;
    }

    /// <summary>Replace all tags.</summary>
    public void Set(IEnumerable<string> tags)
    {
        ArgumentNullException.ThrowIfNull(tags);
        _tags.Clear();
        foreach (var tag in tags)
        {
            var trimmed = tag?.Trim();
            if (string.IsNullOrEmpty(trimmed) || !CanAddMore)
            {
                continue;
            }

            if (!_allowDuplicates && _tags.Contains(trimmed, _comparer))
            {
                continue;
            }

            _tags.Add(trimmed);
        }

        RaiseChanged();
    }

    private void RaiseChanged()
    {
        Raise(nameof(Tags));
        Raise(nameof(Count));
        Raise(nameof(CanAddMore));
    }

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
