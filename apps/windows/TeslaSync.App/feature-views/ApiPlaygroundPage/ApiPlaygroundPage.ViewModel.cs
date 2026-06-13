using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>ApiPlaygroundPage</c> view — the native port of the web page's
/// data flow (web/src/features/admin/pages/ApiPlaygroundPage.tsx). It owns the URL-equivalent local state (the
/// sidebar search <c>query</c>, the selected endpoint and the in-flight / error flags), reads the endpoint catalog
/// through the injected <see cref="IApiPlaygroundFeed"/> (the default <see cref="CatalogApiPlaygroundFeed"/> resolves
/// the static documented catalog) and projects the result through <see cref="ApiPlaygroundProjection"/> so the view
/// is a thin renderer. It surfaces the four web data states (loading / empty / error / success) plus an in-flight
/// flag; observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class ApiPlaygroundPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IApiPlaygroundFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly ApiPlaygroundDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<ApiEndpoint> _endpoints = Array.Empty<ApiEndpoint>();
    private string _query = string.Empty;
    private string? _selectedId;
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;

    private ApiPlaygroundState _state = ApiPlaygroundState.Loading;
    private ApiPlaygroundDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics sink.</summary>
    /// <param name="feed">The endpoint-catalog data port (defaults to <see cref="CatalogApiPlaygroundFeed.Instance"/>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ApiPlaygroundPageViewModel(
        IApiPlaygroundFeed? feed,
        ILocalizer localizer,
        ApiPlaygroundDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed ?? CatalogApiPlaygroundFeed.Instance;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new ApiPlaygroundDiagnostics();
        _display = ApiPlaygroundProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public ApiPlaygroundState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public ApiPlaygroundDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch of the endpoint catalog is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>playground.title</c>).</summary>
    public string Title => _display.Title;

    /// <summary>The localized page subtitle (web <c>playground.subtitle</c>).</summary>
    public string Subtitle => _display.Subtitle;

    /// <summary>The current sidebar search text (web <c>EndpointSidebar</c> search).</summary>
    public string Query => _query;

    /// <summary>The selected endpoint id (web <c>selected</c>), or null when none is selected.</summary>
    public string? SelectedId => _selectedId;

    /// <summary>True when an endpoint is selected (the main panel shows its detail rather than the prompt).</summary>
    public bool HasSelection => _selectedId is not null;

    /// <summary>The total endpoint count in the catalog (backs the "{n} endpoints available" caption).</summary>
    public int TotalCount => _display.TotalCount;

    /// <summary>The localized sidebar empty / no-match message (web <c>playground.noResults</c>).</summary>
    public string EmptyMessage => ApiPlaygroundRegistration.EmptyMessage(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the endpoint-catalog load (web the OpenAPI-spec <c>useQuery</c>).</summary>
    /// <param name="cancellationToken">Cancels (and supersedes) the load.</param>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (_endpoints.Count == 0)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _endpoints = snapshot?.Endpoints ?? Array.Empty<ApiEndpoint>();
            _hasError = false;
            _errorDetail = null;
            _loading = false;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception ex)
        {
            // web specError: surface the error branch; the sidebar falls back to its error surface with retry.
            _hasError = true;
            _errorDetail = ex.Message;
            _loading = false;
            _endpoints = Array.Empty<ApiEndpoint>();
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the endpoint catalog (web auto-refetch / the error-surface retry).</summary>
    /// <param name="cancellationToken">Cancels (and supersedes) the load.</param>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Set the sidebar search text (web <c>EndpointSidebar</c> search); re-projects without a reload.</summary>
    /// <param name="query">The new search text (null is treated as empty).</param>
    public void SetQuery(string? query)
    {
        var next = query ?? string.Empty;
        if (string.Equals(_query, next, StringComparison.Ordinal))
        {
            return;
        }

        _query = next;
        Reproject();
    }

    /// <summary>Select an endpoint by id (web <c>setSelected</c>); re-projects the main panel to its detail.</summary>
    /// <param name="id">The endpoint id to select (null clears the selection).</param>
    public void SelectEndpoint(string? id)
    {
        if (string.Equals(_selectedId, id, StringComparison.Ordinal))
        {
            return;
        }

        _selectedId = string.IsNullOrEmpty(id) ? null : id;
        Reproject();
    }

    /// <summary>Clear the current selection (web returning to the select-an-endpoint prompt).</summary>
    public void ClearSelection() => SelectEndpoint(null);

    /// <summary>
    /// Re-resolve every label from the localizer and re-derive the state — the native analogue of react-i18next
    /// re-rendering the copy after the active language changes. Raises change notifications so the view re-renders
    /// without being reconstructed.
    /// </summary>
    public void Reload() => Reproject();

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

    private ApiPlaygroundModel BuildModel() => new(
        Endpoints: _endpoints,
        Query: _query,
        SelectedId: _selectedId,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail);

    private void Reproject()
    {
        var display = ApiPlaygroundProjection.Project(BuildModel(), _localizer);
        Display = display;
        State = display.State;
        Raise(nameof(Title));
        Raise(nameof(Subtitle));
        Raise(nameof(Query));
        Raise(nameof(SelectedId));
        Raise(nameof(HasSelection));
        Raise(nameof(TotalCount));
    }

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
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
