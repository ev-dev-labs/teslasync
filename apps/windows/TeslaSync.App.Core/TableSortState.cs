namespace TeslaSync.App.Core;

/// <summary>Sort direction cycle used by <c>TsDataTable</c> column headers.</summary>
public enum SortDirection
{
    None,
    Ascending,
    Descending,
}

/// <summary>
/// Tracks which column is sorted and in which direction, with the
/// three-state header toggle (none → ascending → descending → none) used by
/// the web <c>useSortToggle</c> hook. UI-free and unit-testable.
/// </summary>
public sealed class TableSortState
{
    /// <summary>Key of the currently sorted column, or null when unsorted.</summary>
    public string? Column { get; private set; }

    public SortDirection Direction { get; private set; } = SortDirection.None;

    /// <summary>Advances the sort for <paramref name="column"/>. Selecting a new
    /// column starts at ascending; re-selecting the active column cycles
    /// ascending → descending → none.</summary>
    public void Toggle(string column)
    {
        ArgumentException.ThrowIfNullOrEmpty(column);

        if (Column != column)
        {
            Column = column;
            Direction = SortDirection.Ascending;
            return;
        }

        Direction = Direction switch
        {
            SortDirection.Ascending => SortDirection.Descending,
            SortDirection.Descending => SortDirection.None,
            _ => SortDirection.Ascending,
        };

        if (Direction == SortDirection.None)
        {
            Column = null;
        }
    }

    public void Clear()
    {
        Column = null;
        Direction = SortDirection.None;
    }

    /// <summary>Direction currently applied to <paramref name="column"/>.</summary>
    public SortDirection DirectionFor(string column) =>
        Column == column ? Direction : SortDirection.None;

    /// <summary>Orders <paramref name="source"/> by <paramref name="keySelector"/>
    /// honouring the active direction. Returns the input order when unsorted.</summary>
    public IReadOnlyList<T> Apply<T>(IReadOnlyList<T> source, Func<T, object?> keySelector)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(keySelector);

        if (Direction == SortDirection.None || Column is null)
        {
            return source;
        }

        var comparer = Comparer<object?>.Create(CompareKeys);
        var ordered = Direction == SortDirection.Ascending
            ? source.OrderBy(keySelector, comparer)
            : source.OrderByDescending(keySelector, comparer);
        return ordered.ToList();
    }

    private static int CompareKeys(object? a, object? b)
    {
        if (a is null && b is null)
        {
            return 0;
        }

        if (a is null)
        {
            return -1;
        }

        if (b is null)
        {
            return 1;
        }

        if (a is IComparable comparable && a.GetType() == b.GetType())
        {
            return comparable.CompareTo(b);
        }

        return string.Compare(a.ToString(), b.ToString(), StringComparison.OrdinalIgnoreCase);
    }
}
