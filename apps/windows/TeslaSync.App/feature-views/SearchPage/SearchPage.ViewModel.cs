using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SearchPage</c> view — the native port of the web page's
/// data flow (web/src/features/system/pages/SearchPage.tsx). It owns the two view controls the web page owns:
/// the <see cref="Query"/> text (web <c>?q=</c>) and the <see cref="ActiveTypes"/> facet filter (web
/// <c>?types=</c>), reads the unified search through the injected <see cref="ISearchFeed"/> (the native
/// <c>useGlobalSearch</c> hook), and projects the result through <see cref="SearchProjection"/> so the view is
/// a thin renderer. The search is gated exactly like the web query: it only fetches when the trimmed query is
/// at least <see cref="SearchProjection.MinQueryLength"/> characters; below that the page shows the too-short /
/// prompt surfaces without a request. A query or facet change supersedes the in-flight search. Observable so
/// the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class SearchPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISearchFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly SearchDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private SearchSnapshot _snapshot = SearchSnapshot.Empty;
    private bool _hasData;
    private bool _loading;
    private string? _errorDetail;
    private string _query = string.Empty;
    private readonly List<SearchHitType> _types = [];

    private SearchState _state = SearchState.Empty;
    private SearchDisplay _display;
    private bool _isFetching;
    private DateTimeOffset? _updatedAt;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The unified-search data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic relative-time formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SearchPageViewModel(
        ISearchFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        SearchDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new SearchDiagnostics();
        _display = SearchProjection.Project(BuildModel(), _localizer, _clock());
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (too-short / empty / error / loading / no-results / results).</summary>
    public SearchState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SearchDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a search is in flight (the header freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last search failed (drives the freshness chip's error state).</summary>
    public bool IsError => _errorDetail is not null;

    /// <summary>Last successful search timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>The localized page title (web <c>t('search.title')</c>).</summary>
    public string Title => SearchRegistration.Title(_localizer);

    /// <summary>The active query text (web <c>?q=</c>).</summary>
    public string Query => _query;

    /// <summary>The active facet filter, newest-appended (web <c>?types=</c>).</summary>
    public IReadOnlyList<SearchHitType> ActiveTypes => _types.ToArray();

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run (or re-run) the search for the current query + facet filter and fold the result into state. When the
    /// trimmed query is below the minimum length the feed is never called (web disables the query); the surface
    /// reprojects to its too-short / prompt state instead.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        string trimmed = _query.Trim();
        if (trimmed.Length < SearchProjection.MinQueryLength)
        {
            // Not searchable (web `enabled: trimmed.length >= 2` is false): drop any in-flight search and
            // surface the prompt / too-short state with no request.
            Cancel(ref _cts);
            _snapshot = SearchSnapshot.Empty;
            _hasData = false;
            _loading = false;
            _errorDetail = null;
            IsFetching = false;
            Reproject();
            return;
        }

        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasData)
        {
            // Web keeps the previous results (React Query's prior-data cache) while refetching; only show the
            // skeleton when there is nothing to keep (`isFetching && groupedHits.length === 0`).
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed
                .FetchAsync(trimmed, _types.ToArray(), SearchRegistration.DefaultLimit, cts.Token)
                .ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _snapshot = snapshot;
            _hasData = snapshot.HasData;
            _errorDetail = null;
            _loading = false;
            _updatedAt = _clock();
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer search (or disposed) — drop this result silently.
            return;
        }
        catch (ApiException ex)
        {
            SetError(ex.Message);
        }
        catch (Exception ex)
        {
            SetError(ex.Message);
        }

        IsFetching = false;
        UpdatedAt = _updatedAt;
        Reproject();
    }

    /// <summary>Re-run the current search (web query refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Set the active query (web <c>setQuery</c> writing <c>?q=</c>); re-runs or clears the search.</summary>
    /// <param name="query">The new query text.</param>
    /// <param name="cancellationToken">Cancels the resulting search.</param>
    public Task SetQueryAsync(string? query, CancellationToken cancellationToken = default)
    {
        string next = query ?? string.Empty;
        if (string.Equals(next, _query, StringComparison.Ordinal))
        {
            return Task.CompletedTask;
        }

        _query = next;
        return LoadAsync(cancellationToken);
    }

    /// <summary>Toggle a facet (web <c>toggleType</c> writing <c>?types=</c>); re-runs the search when searchable.</summary>
    /// <param name="type">The facet to toggle.</param>
    /// <param name="cancellationToken">Cancels the resulting search.</param>
    public Task ToggleTypeAsync(SearchHitType type, CancellationToken cancellationToken = default)
    {
        if (!_types.Remove(type))
        {
            _types.Add(type);
        }

        SortCanonical(_types);
        _hasData = false;
        return LoadAsync(cancellationToken);
    }

    /// <summary>Clear all facets (web empty-state "Clear filters"); re-runs the search when searchable.</summary>
    /// <param name="cancellationToken">Cancels the resulting search.</param>
    public Task ClearFiltersAsync(CancellationToken cancellationToken = default)
    {
        if (_types.Count == 0)
        {
            return Task.CompletedTask;
        }

        _types.Clear();
        _hasData = false;
        return LoadAsync(cancellationToken);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
    }

    private void SetError(string? detail)
    {
        _errorDetail = string.IsNullOrWhiteSpace(detail) ? "unknown error" : detail;
        _snapshot = SearchSnapshot.Empty;
        _hasData = false;
        _loading = false;
    }

    private SearchModel BuildModel() =>
        new(_snapshot, _loading, _errorDetail, _query, _types.ToArray());

    private void Reproject()
    {
        var display = SearchProjection.Project(BuildModel(), _localizer, _clock());
        Display = display;
        State = display.State;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsError)));
    }

    private static void SortCanonical(List<SearchHitType> types) =>
        types.Sort(static (a, b) => ((int)a).CompareTo((int)b));

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private static void Cancel(ref CancellationTokenSource? slot)
    {
        var cts = Interlocked.Exchange(ref slot, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
