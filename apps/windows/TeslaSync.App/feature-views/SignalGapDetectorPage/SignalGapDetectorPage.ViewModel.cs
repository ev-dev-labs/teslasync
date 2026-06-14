using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SignalGapDetectorPage</c> view — the native port of the web
/// page's data flow (web/src/features/telemetry/pages/SignalGapDetectorPage.tsx and the <c>SignalCatalogPanel</c> it
/// wraps). It owns the local UI state (selected vehicle, the catalog search / filter / sort), reads the fleet then the
/// per-vehicle live-signal snapshot through the injected <see cref="ISignalGapDetectorFeed"/>, and projects the result
/// through <see cref="SignalGapDetectorProjection"/> so the view is a thin renderer. It surfaces the page's
/// loading / no-vehicle / error states plus the catalog's loading / empty / error / success states; observable so the
/// view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class SignalGapDetectorPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISignalGapDetectorFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly SignalGapDetectorDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<SignalGapDetectorVehicle> _vehicles = Array.Empty<SignalGapDetectorVehicle>();
    private long? _selectedId;
    private SignalGapCatalogState _catalogState = SignalGapCatalogState.Loading;
    private IReadOnlyList<SignalGapLiveEntry> _signals = Array.Empty<SignalGapLiveEntry>();
    private string _search = string.Empty;
    private SignalGapFilterMode _filterMode = SignalGapFilterMode.All;
    private SignalGapSortMode _sortMode = SignalGapSortMode.Staleness;
    private DateTimeOffset? _lastRefreshed;

    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;

    private SignalGapDetectorDisplay _display;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The vehicles / live-signals data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic staleness / timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SignalGapDetectorPageViewModel(
        ISignalGapDetectorFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        SignalGapDetectorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new SignalGapDetectorDiagnostics();

        _display = SignalGapDetectorProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SignalGapDetectorDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The current top-level page state (loading / empty / error / catalog).</summary>
    public SignalGapDetectorState State => _display.State;

    /// <summary>The current catalog state (loading / empty / error / success).</summary>
    public SignalGapCatalogState CatalogState => _catalogState;

    /// <summary>The selected vehicle id (web <c>useSelectedVehicle</c>); null = none.</summary>
    public long? SelectedVehicleId => _selectedId;

    /// <summary>The current catalog search text (web <c>search</c>).</summary>
    public string Search => _search;

    /// <summary>The current filter mode (web <c>filterMode</c>).</summary>
    public SignalGapFilterMode FilterMode => _filterMode;

    /// <summary>The current sort mode (web <c>sortMode</c>).</summary>
    public SignalGapSortMode SortMode => _sortMode;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the fleet load then the live-signal read (web mount + <c>useSignalGaps</c>).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        await LoadInternalAsync(cts.Token).ConfigureAwait(false);
    }

    /// <summary>Point the catalog at a different vehicle (web vehicle-picker change) and reload its signals.</summary>
    public async Task SelectVehicleAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        if (_selectedId == vehicleId)
        {
            return;
        }

        _selectedId = vehicleId;
        _signals = Array.Empty<SignalGapLiveEntry>();
        _catalogState = SignalGapCatalogState.Loading;
        _hasError = false;
        Reproject();

        var cts = Supersede(ref _cts, cancellationToken);
        await LoadLiveInternalAsync(cts.Token).ConfigureAwait(false);
    }

    /// <summary>Refresh the live-signal catalog for the selected vehicle (web auto-refetch / Retry).</summary>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        await LoadLiveInternalAsync(cts.Token).ConfigureAwait(false);
    }

    /// <summary>Set the catalog name filter (web <c>setSearch</c>); filtering is client-side, no refetch.</summary>
    public void SetSearch(string? search)
    {
        _search = search ?? string.Empty;
        Reproject();
    }

    /// <summary>Set the catalog filter mode (web <c>setFilterMode</c>); client-side, no refetch.</summary>
    public void SetFilterMode(SignalGapFilterMode mode)
    {
        _filterMode = mode;
        Reproject();
    }

    /// <summary>Set the catalog sort mode (web <c>setSortMode</c>); client-side, no refetch.</summary>
    public void SetSortMode(SignalGapSortMode mode)
    {
        _sortMode = mode;
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

    private async Task LoadInternalAsync(CancellationToken token)
    {
        _loading = true;
        _hasError = false;
        _errorDetail = null;
        Reproject();

        try
        {
            var vehicles = await _feed.FetchVehiclesAsync(token).ConfigureAwait(false);
            token.ThrowIfCancellationRequested();
            _vehicles = vehicles ?? Array.Empty<SignalGapDetectorVehicle>();
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            // web: surface the load-failed banner; never render a blank picker with no explanation.
            _loading = false;
            _hasError = true;
            _errorDetail = Describe(ex);
            Reproject();
            return;
        }

        _loading = false;

        if (_vehicles.Count == 0)
        {
            // web: no vehicle selected → the "select a vehicle" empty state; nothing is fetched.
            _selectedId = null;
            _signals = Array.Empty<SignalGapLiveEntry>();
            _catalogState = SignalGapCatalogState.Empty;
            Reproject();
            return;
        }

        if (_selectedId is not { } current || current <= 0 || !_vehicles.Any(v => v.Id == current))
        {
            _selectedId = _vehicles[0].Id;
        }

        _catalogState = SignalGapCatalogState.Loading;
        Reproject();

        await LoadLiveInternalAsync(token).ConfigureAwait(false);
    }

    private async Task LoadLiveInternalAsync(CancellationToken token)
    {
        if (_selectedId is not { } vehicleId || vehicleId <= 0)
        {
            _catalogState = SignalGapCatalogState.Empty;
            _signals = Array.Empty<SignalGapLiveEntry>();
            Reproject();
            return;
        }

        _catalogState = SignalGapCatalogState.Loading;
        Reproject();

        try
        {
            var signals = await _feed.FetchLiveSignalsAsync(vehicleId, token).ConfigureAwait(false);
            token.ThrowIfCancellationRequested();

            _signals = signals ?? Array.Empty<SignalGapLiveEntry>();
            _catalogState = _signals.Count > 0 ? SignalGapCatalogState.Success : SignalGapCatalogState.Empty;
            _lastRefreshed = _clock();
            _errorDetail = null;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            // web: a failed useSignalGaps query leaves the catalog with no rows; surface the failure inline.
            _catalogState = SignalGapCatalogState.Error;
            _signals = Array.Empty<SignalGapLiveEntry>();
            _errorDetail = Describe(ex);
        }

        Reproject();
    }

    private SignalGapDetectorModel BuildModel() => new(
        Vehicles: _vehicles,
        SelectedVehicleId: _selectedId,
        CatalogState: _catalogState,
        Signals: _signals,
        Search: _search,
        FilterMode: _filterMode,
        SortMode: _sortMode,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        LastRefreshed: _lastRefreshed);

    private void Reproject() => Display = SignalGapDetectorProjection.Project(BuildModel(), _localizer, _clock());

    private static string Describe(Exception ex) =>
        string.IsNullOrWhiteSpace(ex.Message)
            ? ex.GetType().Name
            : ex.Message;

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
