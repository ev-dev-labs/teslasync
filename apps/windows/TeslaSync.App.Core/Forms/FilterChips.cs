using System.Collections.ObjectModel;
using System.ComponentModel;

namespace TeslaSync.App.Core.Forms;

/// <summary>
/// One active-filter chip — typically derived from a single URL/search param.
/// <see cref="Key"/> uniquely identifies the chip, <see cref="Label"/> is the
/// localized field name and <see cref="Value"/> is the user-facing value.
/// </summary>
public sealed record FilterChip(string Key, string Label, string Value);

/// <summary>
/// UI-thread-free model for the active-filter summary row (<c>TsActiveFilterChips</c>,
/// <c>TsFilterBar</c>). The page owns the URL state; this model is the
/// presentation surface and raises events so the page rewrites the URL.
/// </summary>
public sealed class ActiveFilterModel : INotifyPropertyChanged
{
    private readonly ObservableCollection<FilterChip> _chips = [];

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when a single chip's remove affordance is invoked.</summary>
    public event EventHandler<string>? FilterRemoved;

    /// <summary>Raised when "Clear all" is invoked.</summary>
    public event EventHandler? Cleared;

    /// <summary>The current chips, in insertion order.</summary>
    public IReadOnlyList<FilterChip> Chips => _chips;

    /// <summary>True when at least one chip is active.</summary>
    public bool HasChips => _chips.Count > 0;

    /// <summary>True when no chips are active.</summary>
    public bool IsEmpty => _chips.Count == 0;

    /// <summary>Replace the chip set (deduplicated by key, first occurrence wins).</summary>
    public void Set(IEnumerable<FilterChip> chips)
    {
        ArgumentNullException.ThrowIfNull(chips);
        _chips.Clear();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var chip in chips)
        {
            if (chip is not null && seen.Add(chip.Key))
            {
                _chips.Add(chip);
            }
        }

        RaiseCounts();
    }

    /// <summary>
    /// Remove a chip by key and raise <see cref="FilterRemoved"/>. Returns true
    /// when a chip was actually removed.
    /// </summary>
    public bool Remove(string key)
    {
        var index = IndexOf(key);
        if (index < 0)
        {
            return false;
        }

        _chips.RemoveAt(index);
        RaiseCounts();
        FilterRemoved?.Invoke(this, key);
        return true;
    }

    /// <summary>Remove every chip and raise <see cref="Cleared"/> (when non-empty).</summary>
    public void ClearAll()
    {
        if (_chips.Count == 0)
        {
            return;
        }

        _chips.Clear();
        RaiseCounts();
        Cleared?.Invoke(this, EventArgs.Empty);
    }

    private int IndexOf(string key)
    {
        for (var i = 0; i < _chips.Count; i++)
        {
            if (string.Equals(_chips[i].Key, key, StringComparison.Ordinal))
            {
                return i;
            }
        }

        return -1;
    }

    private void RaiseCounts()
    {
        Raise(nameof(HasChips));
        Raise(nameof(IsEmpty));
    }

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
