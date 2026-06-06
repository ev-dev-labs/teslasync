namespace TeslaSync.App.Core;

/// <summary>
/// Tri-state multi-selection model for <c>TsDataTable</c> rows (mirrors the web
/// <c>useTableSelection</c> hook): per-row toggle, select-all/none over the
/// current key universe, and an indeterminate header state.
/// </summary>
/// <typeparam name="TKey">Row identity key type.</typeparam>
public sealed class TableSelectionState<TKey>
    where TKey : notnull
{
    private readonly HashSet<TKey> _selected = [];

    public IReadOnlyCollection<TKey> SelectedKeys => _selected;

    public int Count => _selected.Count;

    public bool IsSelected(TKey key) => _selected.Contains(key);

    public void Toggle(TKey key)
    {
        ArgumentNullException.ThrowIfNull(key);
        if (!_selected.Remove(key))
        {
            _selected.Add(key);
        }
    }

    public void Set(TKey key, bool selected)
    {
        ArgumentNullException.ThrowIfNull(key);
        if (selected)
        {
            _selected.Add(key);
        }
        else
        {
            _selected.Remove(key);
        }
    }

    public void Clear() => _selected.Clear();

    /// <summary>Selects every key in <paramref name="universe"/>.</summary>
    public void SelectAll(IEnumerable<TKey> universe)
    {
        ArgumentNullException.ThrowIfNull(universe);
        foreach (var key in universe)
        {
            _selected.Add(key);
        }
    }

    /// <summary>True only when every key in <paramref name="universe"/> is selected
    /// and the universe is non-empty.</summary>
    public bool AllSelected(IReadOnlyCollection<TKey> universe)
    {
        ArgumentNullException.ThrowIfNull(universe);
        return universe.Count > 0 && universe.All(_selected.Contains);
    }

    /// <summary>True when some — but not all — of the universe is selected; drives
    /// the header checkbox's indeterminate visual.</summary>
    public bool IsIndeterminate(IReadOnlyCollection<TKey> universe)
    {
        ArgumentNullException.ThrowIfNull(universe);
        var selectedInUniverse = universe.Count(_selected.Contains);
        return selectedInUniverse > 0 && selectedInUniverse < universe.Count;
    }

    /// <summary>Header-checkbox click: clears when all selected, otherwise selects all.</summary>
    public void ToggleAll(IReadOnlyCollection<TKey> universe)
    {
        ArgumentNullException.ThrowIfNull(universe);
        if (AllSelected(universe))
        {
            foreach (var key in universe)
            {
                _selected.Remove(key);
            }
        }
        else
        {
            SelectAll(universe);
        }
    }
}
