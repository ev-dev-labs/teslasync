using System.ComponentModel;

namespace TeslaSync.App.Core.Forms;

/// <summary>A selectable option for the combobox / tree controls.</summary>
public sealed record ComboOption(string Value, string Label, bool Disabled = false);

/// <summary>Pure option filtering for the type-ahead controls.</summary>
public static class ComboboxFilter
{
    /// <summary>
    /// Case-insensitive substring filter over option labels. A blank query
    /// returns every option (order preserved).
    /// </summary>
    public static IReadOnlyList<ComboOption> Filter(
        IEnumerable<ComboOption> options,
        string? query)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (string.IsNullOrWhiteSpace(query))
        {
            return options.ToList();
        }

        var trimmed = query.Trim();
        return options
            .Where(o => o.Label.Contains(trimmed, StringComparison.OrdinalIgnoreCase))
            .ToList();
    }
}

/// <summary>
/// UI-thread-free state for the single-select type-ahead (<c>TsCombobox</c>).
/// Owns the query, the filtered view, the keyboard highlight cursor and the
/// committed selection so the WinUI control is a thin view.
/// </summary>
public sealed class ComboboxState : INotifyPropertyChanged
{
    private readonly IReadOnlyList<ComboOption> _all;
    private string _query = string.Empty;
    private int _highlightIndex = -1;
    private string? _selectedValue;

    public ComboboxState(IReadOnlyList<ComboOption> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _all = options;
        Filtered = options;
        _highlightIndex = options.Count > 0 ? 0 : -1;
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Current type-ahead query.</summary>
    public string Query
    {
        get => _query;
        set
        {
            var next = value ?? string.Empty;
            if (_query == next)
            {
                return;
            }

            _query = next;
            Filtered = ComboboxFilter.Filter(_all, _query);
            _highlightIndex = Filtered.Count > 0 ? 0 : -1;
            Raise(nameof(Query));
            Raise(nameof(Filtered));
            Raise(nameof(HighlightIndex));
            Raise(nameof(HighlightedOption));
        }
    }

    /// <summary>The query-filtered options.</summary>
    public IReadOnlyList<ComboOption> Filtered { get; private set; }

    /// <summary>Index of the keyboard-highlighted option within <see cref="Filtered"/> (-1 = none).</summary>
    public int HighlightIndex => _highlightIndex;

    /// <summary>The highlighted option, or null.</summary>
    public ComboOption? HighlightedOption =>
        _highlightIndex >= 0 && _highlightIndex < Filtered.Count ? Filtered[_highlightIndex] : null;

    /// <summary>The committed selected value, or null.</summary>
    public string? SelectedValue
    {
        get => _selectedValue;
        private set
        {
            if (_selectedValue == value)
            {
                return;
            }

            _selectedValue = value;
            Raise(nameof(SelectedValue));
        }
    }

    /// <summary>Move the highlight cursor by <paramref name="delta"/>, clamped to the list.</summary>
    public void MoveHighlight(int delta)
    {
        if (Filtered.Count == 0)
        {
            return;
        }

        var next = Math.Clamp(_highlightIndex + delta, 0, Filtered.Count - 1);
        if (next == _highlightIndex)
        {
            return;
        }

        _highlightIndex = next;
        Raise(nameof(HighlightIndex));
        Raise(nameof(HighlightedOption));
    }

    /// <summary>Commit the highlighted option (ignoring disabled ones). Returns the value, or null.</summary>
    public string? CommitHighlight()
    {
        var option = HighlightedOption;
        if (option is null || option.Disabled)
        {
            return null;
        }

        SelectedValue = option.Value;
        return option.Value;
    }

    /// <summary>Explicitly select a value (must be a known, enabled option).</summary>
    public bool Select(string value)
    {
        var option = _all.FirstOrDefault(o => string.Equals(o.Value, value, StringComparison.Ordinal));
        if (option is null || option.Disabled)
        {
            return false;
        }

        SelectedValue = value;
        return true;
    }

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

/// <summary>
/// UI-thread-free state for the multi-select type-ahead (<c>TsComboboxMulti</c>).
/// Tracks the query, filtered view and the set of selected values.
/// </summary>
public sealed class ComboboxMultiState : INotifyPropertyChanged
{
    private readonly IReadOnlyList<ComboOption> _all;
    private readonly HashSet<string> _selected = new(StringComparer.Ordinal);
    private string _query = string.Empty;

    public ComboboxMultiState(IReadOnlyList<ComboOption> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _all = options;
        Filtered = options;
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Current type-ahead query.</summary>
    public string Query
    {
        get => _query;
        set
        {
            var next = value ?? string.Empty;
            if (_query == next)
            {
                return;
            }

            _query = next;
            Filtered = ComboboxFilter.Filter(_all, _query);
            Raise(nameof(Query));
            Raise(nameof(Filtered));
        }
    }

    /// <summary>The query-filtered options.</summary>
    public IReadOnlyList<ComboOption> Filtered { get; private set; }

    /// <summary>The selected values in stable option order.</summary>
    public IReadOnlyList<string> SelectedValues =>
        _all.Where(o => _selected.Contains(o.Value)).Select(o => o.Value).ToList();

    /// <summary>Number of selected values.</summary>
    public int SelectedCount => _selected.Count;

    /// <summary>Whether a value is selected.</summary>
    public bool IsSelected(string value) => _selected.Contains(value);

    /// <summary>Toggle a value (no-op for unknown/disabled options).</summary>
    public void Toggle(string value)
    {
        var option = _all.FirstOrDefault(o => string.Equals(o.Value, value, StringComparison.Ordinal));
        if (option is null || option.Disabled)
        {
            return;
        }

        if (!_selected.Remove(value))
        {
            _selected.Add(value);
        }

        RaiseSelection();
    }

    /// <summary>Clear all selected values.</summary>
    public void Clear()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        _selected.Clear();
        RaiseSelection();
    }

    private void RaiseSelection()
    {
        Raise(nameof(SelectedValues));
        Raise(nameof(SelectedCount));
    }

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
