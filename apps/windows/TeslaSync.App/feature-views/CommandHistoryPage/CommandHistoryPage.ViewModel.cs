using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>CommandHistoryPage</c> view — the native port of the web
/// page's data flow (web/src/features/system/pages/CommandHistoryPage.tsx). It owns the URL-equivalent state
/// (selected vehicle, status filter, search query, page), reads the fleet then the per-vehicle command log through
/// the injected <see cref="ICommandHistoryFeed"/>, and projects the result through
/// <see cref="CommandHistoryProjection"/> so the view is a thin renderer. The stats and the filtered / paginated
/// timeline are recomputed by the projection, so the status-filter, search and pagination changes re-project
/// without a network round-trip (web client-side <c>useMemo</c> filtering). It surfaces the four web data states
/// (loading / empty / error / success) plus an in-flight flag; observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class CommandHistoryPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ICommandHistoryFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly CommandHistoryDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;
    private bool _loadedOnce;

    private IReadOnlyList<CommandHistoryVehicle> _vehicles = Array.Empty<CommandHistoryVehicle>();
    private long? _selectedId;
    private IReadOnlyList<CommandLogEntry> _commands = Array.Empty<CommandLogEntry>();
    private bool _loading = true;
    private string? _error;

    private CommandStatusFilter _statusFilter = CommandStatusFilter.All;
    private string _searchQuery = string.Empty;
    private int _page = 1;

    private CommandHistoryState _state = CommandHistoryState.Loading;
    private CommandHistoryDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The vehicles / command-history data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic 24h-window / timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CommandHistoryPageViewModel(
        ICommandHistoryFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        CommandHistoryDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new CommandHistoryDiagnostics();
        _display = CommandHistoryProjection.Project(BuildModel(), _localizer, _clock());
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public CommandHistoryState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public CommandHistoryDisplay Display
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

    /// <summary>The currently selected vehicle id (web <c>vehicleId</c>), or null when the fleet is empty.</summary>
    public long? SelectedVehicleId => _selectedId;

    /// <summary>The active status filter (web <c>statusFilter</c>).</summary>
    public CommandStatusFilter StatusFilter => _statusFilter;

    /// <summary>The current search query (web <c>searchQuery</c>).</summary>
    public string SearchQuery => _searchQuery;

    /// <summary>The current page (1-based; web <c>page</c>).</summary>
    public int Page => _page;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the fleet + per-vehicle command-history load for the current selection.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_loadedOnce)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var vehicles = await _feed.FetchVehiclesAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _vehicles = vehicles ?? Array.Empty<CommandHistoryVehicle>();
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            // web: a vehicles failure folds into the page error; the fleet falls back to empty.
            _error = ex.Message;
            _vehicles = Array.Empty<CommandHistoryVehicle>();
        }

        // web useSelectedVehicle: keep the current pick when still present, else fall back to the first vehicle.
        if (_selectedId is null || !ContainsVehicle(_selectedId.Value))
        {
            _selectedId = _vehicles.Count > 0 ? _vehicles[0].Id : null;
        }

        if (_selectedId is { } id)
        {
            try
            {
                var commands = await _feed.FetchHistoryAsync(id, cts.Token).ConfigureAwait(false);
                cts.Token.ThrowIfCancellationRequested();
                _commands = commands ?? Array.Empty<CommandLogEntry>();
                _error = null;
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                _error = ex.Message;
                _commands = Array.Empty<CommandLogEntry>();
            }
        }
        else
        {
            // web: with no vehicle the useCommandHistory query is disabled and the log is empty.
            _commands = Array.Empty<CommandLogEntry>();
        }

        _loading = false;
        _loadedOnce = true;
        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the current selection (web manual refresh + auto-refetch).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Select a vehicle from the picker (web <c>handleVehicleChange</c>); resets the page and reloads its log.</summary>
    public Task SelectVehicleAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        if (vehicleId <= 0)
        {
            return Task.CompletedTask;
        }

        _selectedId = vehicleId;
        _page = 1;
        return LoadAsync(cancellationToken);
    }

    /// <summary>Set the status filter (web <c>handleStatusChange</c>); resets the page and re-projects client-side.</summary>
    public void SetStatusFilter(CommandStatusFilter statusFilter)
    {
        if (_statusFilter == statusFilter && _page == 1)
        {
            return;
        }

        _statusFilter = statusFilter;
        _page = 1;
        Reproject();
    }

    /// <summary>Set the command search query (web <c>handleSearchChange</c>); resets the page and re-projects client-side.</summary>
    public void SetSearchQuery(string query)
    {
        string next = query ?? string.Empty;
        if (string.Equals(_searchQuery, next, StringComparison.Ordinal) && _page == 1)
        {
            return;
        }

        _searchQuery = next;
        _page = 1;
        Reproject();
    }

    /// <summary>Go to a specific 1-based page (web <c>setPage</c>); re-projects the client-side slice (no reload).</summary>
    public void SetPage(int page)
    {
        int next = Math.Max(1, page);
        if (_page == next)
        {
            return;
        }

        _page = next;
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

    private bool ContainsVehicle(long id)
    {
        foreach (var vehicle in _vehicles)
        {
            if (vehicle.Id == id)
            {
                return true;
            }
        }

        return false;
    }

    private CommandHistoryModel BuildModel() => new(
        Vehicles: _vehicles,
        SelectedVehicleId: _selectedId,
        Commands: _commands,
        Loading: _loading,
        HasError: _error is not null,
        ErrorDetail: _error,
        StatusFilter: _statusFilter,
        SearchQuery: _searchQuery,
        IsSearchPending: false,
        Page: _page,
        PageSize: CommandHistoryRegistration.PageSize);

    private void Reproject()
    {
        var display = CommandHistoryProjection.Project(BuildModel(), _localizer, _clock());
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
