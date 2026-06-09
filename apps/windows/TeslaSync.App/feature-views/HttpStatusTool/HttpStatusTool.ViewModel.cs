using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="HttpStatusTool"/> view — the native port of the
/// web <c>HttpStatusTool</c> component
/// (web/src/features/admin/components/devtools/tools/HttpStatusTool.tsx). It projects the canonical
/// <see cref="IHttpStatusCodeSource"/> through <see cref="HttpStatusProjection"/> for the current
/// <see cref="SearchText"/> and exposes the resulting <see cref="Display"/> plus the mutually-exclusive
/// <see cref="State"/> so the view is a thin renderer. The surface is presentational — there is no
/// asynchronous load — so projection is synchronous; reassigning <see cref="SearchText"/> re-filters (the
/// web <c>filtered = useMemo(…)</c>). Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class HttpStatusToolViewModel : INotifyPropertyChanged
{
    private readonly IHttpStatusCodeSource _source;
    private readonly ILocalizer _localizer;

    private string _searchText = string.Empty;
    private HttpStatusDisplay _display;
    private HttpStatusToolState _state;

    /// <summary>Creates the holder over its code source and localizer.</summary>
    /// <param name="source">The HTTP status code catalog (the canonical reference table).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public HttpStatusToolViewModel(IHttpStatusCodeSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _display = HttpStatusProjection.Project(source.GetCodes(), _searchText);
        _state = StateFor(_display);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state (table vs no-match empty).</summary>
    public HttpStatusToolState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready code rows for the current search (web <c>filtered</c>).</summary>
    public HttpStatusDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasResults));
            Raise(nameof(MatchCount));
        }
    }

    /// <summary>True when at least one code matched the search (web table renders) — false drives the empty surface.</summary>
    public bool HasResults => _display.Rows.Count > 0;

    /// <summary>The number of codes matching the current search (web <c>filtered.length</c>).</summary>
    public int MatchCount => _display.Rows.Count;

    /// <summary>The total number of codes in the catalog before filtering (web <c>HTTP_CODES.length</c>).</summary>
    public int TotalCount => _display.TotalCount;

    /// <summary>
    /// The current search query (the web <c>search</c> state). Reassigning re-filters the code list and, when
    /// the result set changes shape, flips <see cref="State"/> between table and empty.
    /// </summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_searchText, next, StringComparison.Ordinal))
            {
                return;
            }

            _searchText = next;
            Raise(nameof(SearchText));
            Reproject();
        }
    }

    /// <summary>Localized card title and surface Narrator name (web <c>t('Http Status')</c>).</summary>
    public string Title => HttpStatusToolRegistration.Title(_localizer);

    /// <summary>Localized card description (web <c>t('Http Status Desc')</c>).</summary>
    public string Description => HttpStatusToolRegistration.Description(_localizer);

    /// <summary>Localized search field hint (web <c>t('Search Codes')</c>).</summary>
    public string SearchHint => _localizer.GetString("Search Codes", "Search Codes");

    /// <summary>Localized status-code column header (web <c>t('Status Code')</c>).</summary>
    public string StatusCodeHeader => _localizer.GetString("Status Code", "Status Code");

    /// <summary>Localized status-text column header (web <c>t('Status Text')</c>).</summary>
    public string StatusTextHeader => _localizer.GetString("Status Text", "Status Text");

    /// <summary>Localized status-description column header (web <c>t('Status Desc')</c>).</summary>
    public string StatusDescHeader => _localizer.GetString("Status Desc", "Status Desc");

    /// <summary>Localized empty-state message (web <c>DataTable</c> default <c>emptyMessage="No data"</c>).</summary>
    public string EmptyMessage => _localizer.GetString("No data", "No data");

    private void Reproject()
    {
        Display = HttpStatusProjection.Project(_source.GetCodes(), _searchText);
        State = StateFor(_display);
    }

    private static HttpStatusToolState StateFor(HttpStatusDisplay display) =>
        display.Rows.Count > 0 ? HttpStatusToolState.Ready : HttpStatusToolState.Empty;

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
