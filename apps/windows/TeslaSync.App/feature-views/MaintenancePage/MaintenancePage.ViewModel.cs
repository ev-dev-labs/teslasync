using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>MaintenancePage</c> view — the native port of the web page's data
/// flow (web/src/features/vehicle-systems/pages/MaintenancePage.tsx). It reads the maintenance items + service records
/// through the injected <see cref="IMaintenanceFeed"/> (web <c>useQuery('/maintenance')</c> +
/// <c>useQuery('/maintenance/records')</c>) and projects the result through <see cref="MaintenanceProjection"/> so the
/// view is a thin renderer. It surfaces the four web data states (loading / empty / error / success), tracks the
/// client-side category filter and sort selection (web <c>categoryFilter</c> / <c>sortBy</c>, which re-project without
/// re-fetching), and exposes a refresh path; observable so the view re-renders on <see cref="PropertyChanged"/>.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class MaintenancePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IMaintenanceFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly MaintenanceDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private bool _hasData;
    private IReadOnlyList<MaintenanceItem> _items = Array.Empty<MaintenanceItem>();
    private IReadOnlyList<MaintenanceServiceRecord> _records = Array.Empty<MaintenanceServiceRecord>();
    private string _categoryFilter = MaintenanceProjection.AllCategories;
    private string _sortBy = MaintenanceProjection.DefaultSort;
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;

    private MaintenanceState _state = MaintenanceState.Loading;
    private MaintenanceDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The maintenance data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic progress / date formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public MaintenancePageViewModel(
        IMaintenanceFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        MaintenanceDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new MaintenanceDiagnostics();
        _display = MaintenanceProjection.Project(BuildModel(), _localizer, _clock());
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public MaintenanceState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public MaintenanceDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The selected category filter (web <c>categoryFilter</c>).</summary>
    public string CategoryFilter => _categoryFilter;

    /// <summary>The selected sort key (web <c>sortBy</c>).</summary>
    public string SortBy => _sortBy;

    /// <summary>The localized page title (web <c>t('Maintenance')</c>).</summary>
    public string Title => MaintenanceRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the maintenance load (web's two queries).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasData)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _hasData = snapshot.HasData;
            _items = snapshot.Items;
            _records = snapshot.Records;
            _hasError = false;
            _errorDetail = null;
            _loading = false;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (ApiException ex)
        {
            ApplyFailure(ex.Message);
        }
        catch (Exception ex)
        {
            ApplyFailure(ex.Message);
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the report (web query refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Change the category filter (web <c>setCategoryFilter</c>) and re-project. Filtering is client-side over the
    /// already-loaded items, so no fetch is issued; a no-op when the value is unchanged.
    /// </summary>
    public void SetCategoryFilter(string category)
    {
        ArgumentNullException.ThrowIfNull(category);
        if (string.Equals(category, _categoryFilter, StringComparison.Ordinal))
        {
            return;
        }

        _categoryFilter = category;
        Reproject();
    }

    /// <summary>
    /// Change the sort key (web <c>setSortBy</c>) and re-project. Sorting is client-side over the already-loaded
    /// items, so no fetch is issued; a no-op when the value is unchanged or not one of the offered choices.
    /// </summary>
    public void SetSort(string sortBy)
    {
        ArgumentNullException.ThrowIfNull(sortBy);
        if (string.Equals(sortBy, _sortBy, StringComparison.Ordinal) || !MaintenanceProjection.SortChoices.Contains(sortBy))
        {
            return;
        }

        _sortBy = sortBy;
        Reproject();
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

    private void ApplyFailure(string detail)
    {
        _hasError = true;
        _hasData = false;
        _items = Array.Empty<MaintenanceItem>();
        _records = Array.Empty<MaintenanceServiceRecord>();
        _errorDetail = detail;
        _loading = false;
    }

    private MaintenanceModel BuildModel() => new(
        HasData: _hasData,
        Items: _items,
        Records: _records,
        CategoryFilter: _categoryFilter,
        SortBy: _sortBy,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail);

    private void Reproject()
    {
        var display = MaintenanceProjection.Project(BuildModel(), _localizer, _clock());
        Display = display;
        State = display.State;
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
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
