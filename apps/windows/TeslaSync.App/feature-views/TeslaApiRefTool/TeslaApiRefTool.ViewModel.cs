using System.ComponentModel;
using System.Globalization;
using System.Linq;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TeslaApiRefTool"/> view — the native port
/// of the web component's <c>useState(search)</c> + <c>useMemo(filtered)</c> composition
/// (<c>web/src/features/admin/components/devtools/tools/TeslaApiRefTool.tsx</c>). Setting
/// <see cref="Search"/> re-runs the pure <see cref="TeslaApiRefFilter"/>, resets to the first page
/// (the web <c>DataTable</c> resets the page when the data length changes) and folds the result into
/// <see cref="PageItems"/> + <see cref="State"/> so the view is a thin renderer. Every user-facing
/// string and Narrator name is resolved through the injected <see cref="ILocalizer"/>. Drive it from
/// one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class TeslaApiRefToolViewModel : INotifyPropertyChanged
{
    /// <summary>Rows per page — mirrors the web <c>DataTable</c> default page size (25).</summary>
    public const int PageSize = 25;

    private readonly ILocalizer _localizer;

    private string _search = string.Empty;
    private IReadOnlyList<TeslaApiEndpoint> _filtered;
    private int _page = 1;

    /// <summary>Creates the holder over its localizer and computes the initial (unfiltered) projection.</summary>
    public TeslaApiRefToolViewModel(ILocalizer localizer)
    {
        _localizer = localizer ?? throw new ArgumentNullException(nameof(localizer));
        _filtered = TeslaApiRefFilter.Apply(_search);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The raw search text; reassigning re-runs the filter and returns to page one.</summary>
    public string Search
    {
        get => _search;
        set
        {
            var next = value ?? string.Empty;
            if (string.Equals(_search, next, StringComparison.Ordinal))
            {
                return;
            }

            _search = next;
            _filtered = TeslaApiRefFilter.Apply(_search);
            _page = 1;

            Raise(nameof(Search));
            Raise(nameof(Filtered));
            Raise(nameof(TotalItems));
            Raise(nameof(PageCount));
            Raise(nameof(Page));
            Raise(nameof(PageItems));
            Raise(nameof(State));
            Raise(nameof(IsEmpty));
            Raise(nameof(ShowPagination));
        }
    }

    /// <summary>The current 1-based page; reassigning clamps to <c>[1, <see cref="PageCount"/>]</c>.</summary>
    public int Page
    {
        get => _page;
        set
        {
            var clamped = Math.Clamp(value, 1, PageCount);
            if (clamped == _page)
            {
                return;
            }

            _page = clamped;
            Raise(nameof(Page));
            Raise(nameof(PageItems));
        }
    }

    /// <summary>All endpoints matching the current search, across every page (web <c>filtered</c>).</summary>
    public IReadOnlyList<TeslaApiEndpoint> Filtered => _filtered;

    /// <summary>The slice of <see cref="Filtered"/> shown on the current page (what the view renders).</summary>
    public IReadOnlyList<TeslaApiEndpoint> PageItems =>
        _filtered.Skip((_page - 1) * PageSize).Take(PageSize).ToList();

    /// <summary>Total matching rows across all pages (drives the pager summary + visibility).</summary>
    public int TotalItems => _filtered.Count;

    /// <summary>Number of pages for the current match set (at least one).</summary>
    public int PageCount => Math.Max(1, (TotalItems + PageSize - 1) / PageSize);

    /// <summary>The current mutually-exclusive surface state (populated / empty).</summary>
    public TeslaApiRefState State => TotalItems == 0 ? TeslaApiRefState.Empty : TeslaApiRefState.Populated;

    /// <summary>True when the filter matched nothing and the empty state should render.</summary>
    public bool IsEmpty => State == TeslaApiRefState.Empty;

    /// <summary>True when the pager should be shown (there is at least one matching row).</summary>
    public bool ShowPagination => !IsEmpty;

    /// <summary>Localized card title (web <c>t('Tesla Api Ref')</c>).</summary>
    public string Title => TeslaApiRefToolRegistration.Name(_localizer);

    /// <summary>Localized card description (web <c>t('Tesla Api Ref Desc')</c>).</summary>
    public string Description => TeslaApiRefToolRegistration.Description(_localizer);

    /// <summary>Localized search field hint shown when empty (web <c>t('Search Endpoints')</c>).</summary>
    public string SearchHint => _localizer.GetString("Search Endpoints", "Search Endpoints");

    /// <summary>Localized "Method" column header (web <c>t('Method')</c>).</summary>
    public string MethodHeader => _localizer.GetString("Method", "Method");

    /// <summary>Localized "Path" column header (web <c>t('Path')</c>).</summary>
    public string PathHeader => _localizer.GetString("Path", "Path");

    /// <summary>Localized "Endpoint Desc" column header (web <c>t('Endpoint Desc')</c>).</summary>
    public string DescriptionHeader => _localizer.GetString("Endpoint Desc", "Endpoint Desc");

    /// <summary>Localized copy-button idle label (web <c>common.copyButton.copy</c>).</summary>
    public string CopyLabel => _localizer.GetString("common.copyButton.copy", "Copy");

    /// <summary>Localized copy-button confirmation label (web <c>common.copyButton.copied</c>).</summary>
    public string CopiedLabel => _localizer.GetString("common.copyButton.copied", "Copied");

    /// <summary>Localized empty-state title shown when the filter matches nothing.</summary>
    public string EmptyTitle => _localizer.GetString("devtools.teslaApiRef.emptyTitle", "No matching endpoints");

    /// <summary>Localized empty-state body shown when the filter matches nothing.</summary>
    public string EmptyMessage => _localizer.GetString("devtools.teslaApiRef.emptyMessage", "Try a different search term.");

    /// <summary>Localized first-page pager affordance label (web <c>pagination.first</c>).</summary>
    public string FirstPageLabel => _localizer.GetString("pagination.first", "First page");

    /// <summary>Localized previous-page pager affordance label (web <c>pagination.previous</c>).</summary>
    public string PreviousPageLabel => _localizer.GetString("pagination.previous", "Previous page");

    /// <summary>Localized next-page pager affordance label (web <c>pagination.next</c>).</summary>
    public string NextPageLabel => _localizer.GetString("pagination.next", "Next page");

    /// <summary>Localized last-page pager affordance label (web <c>pagination.last</c>).</summary>
    public string LastPageLabel => _localizer.GetString("pagination.last", "Last page");

    /// <summary>Narrator name for the pager region (web <c>a11y.pagination</c>).</summary>
    public string PaginationAccessibleName => _localizer.GetString("a11y.pagination", "Pagination");

    /// <summary>Narrator name for the search field (its hint copy).</summary>
    public string SearchAccessibleName => SearchHint;

    /// <summary>Narrator name for the endpoint table region (the card title).</summary>
    public string TableAccessibleName => Title;

    /// <summary>Narrator name for a row's copy button — the copy verb plus the path it copies.</summary>
    public string CopyAccessibleName(string path) =>
        string.Format(CultureInfo.CurrentCulture, "{0} {1}", CopyLabel, path ?? string.Empty);

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
