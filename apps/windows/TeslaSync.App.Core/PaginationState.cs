using System.ComponentModel;

namespace TeslaSync.App.Core;

/// <summary>
/// UI-thread-free pagination model backing <c>TsDataTable</c>/<c>TsPagination</c>.
/// Owns the page/page-size/total invariants (clamping, page-count, the visible
/// "showing X–Y of Z" window) so the WinUI control is a thin view over it.
/// </summary>
public sealed class PaginationState : INotifyPropertyChanged
{
    private int _page = 1;
    private int _pageSize = 25;
    private int _total;

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Current 1-based page. Always clamped to [1, <see cref="PageCount"/>].</summary>
    public int Page
    {
        get => _page;
        set => SetPage(value);
    }

    /// <summary>Rows per page. Minimum 1; re-clamps the current page.</summary>
    public int PageSize
    {
        get => _pageSize;
        set
        {
            var next = Math.Max(1, value);
            if (next == _pageSize)
            {
                return;
            }

            _pageSize = next;
            Raise(nameof(PageSize));
            RaiseDerived();
            SetPage(_page);
        }
    }

    /// <summary>Total item count across all pages. Minimum 0.</summary>
    public int Total
    {
        get => _total;
        set
        {
            var next = Math.Max(0, value);
            if (next == _total)
            {
                return;
            }

            _total = next;
            Raise(nameof(Total));
            RaiseDerived();
            SetPage(_page);
        }
    }

    /// <summary>Number of pages; at least 1 even when empty.</summary>
    public int PageCount => Math.Max(1, (int)Math.Ceiling(_total / (double)_pageSize));

    /// <summary>1-based index of the first visible row (0 when empty).</summary>
    public int RangeStart => _total == 0 ? 0 : ((_page - 1) * _pageSize) + 1;

    /// <summary>1-based index of the last visible row (0 when empty).</summary>
    public int RangeEnd => _total == 0 ? 0 : Math.Min(_page * _pageSize, _total);

    public bool CanGoPrevious => _page > 1;

    public bool CanGoNext => _page < PageCount;

    /// <summary>Zero-based offset of the current page's first item.</summary>
    public int Offset => (_page - 1) * _pageSize;

    public void First() => SetPage(1);

    public void Previous() => SetPage(_page - 1);

    public void Next() => SetPage(_page + 1);

    public void Last() => SetPage(PageCount);

    /// <summary>Returns the slice of <paramref name="source"/> for the current page.</summary>
    public IReadOnlyList<T> Slice<T>(IReadOnlyList<T> source)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (source.Count == 0)
        {
            return [];
        }

        var start = Math.Min(Offset, source.Count);
        var count = Math.Min(_pageSize, source.Count - start);
        var result = new List<T>(count);
        for (var i = 0; i < count; i++)
        {
            result.Add(source[start + i]);
        }

        return result;
    }

    private void SetPage(int value)
    {
        var clamped = Math.Clamp(value, 1, PageCount);
        if (clamped == _page)
        {
            return;
        }

        _page = clamped;
        Raise(nameof(Page));
        RaiseDerived();
    }

    private void RaiseDerived()
    {
        Raise(nameof(PageCount));
        Raise(nameof(RangeStart));
        Raise(nameof(RangeEnd));
        Raise(nameof(CanGoPrevious));
        Raise(nameof(CanGoNext));
        Raise(nameof(Offset));
    }

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
