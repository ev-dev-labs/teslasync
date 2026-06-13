using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// A transient purge-result banner (the native port of the web <c>useToast</c> notifications the purge handlers
/// raise): the semantic <see cref="Variant"/>, the localized <see cref="Title"/> and the formatted
/// <see cref="Message"/>. <see cref="Show"/> is false until a purge resolves.
/// </summary>
public sealed record RedisPurgeNotice(bool Show, CalloutVariant Variant, string Title, string Message)
{
    /// <summary>The hidden notice (no purge has resolved yet).</summary>
    public static RedisPurgeNotice Hidden { get; } = new(false, CalloutVariant.Info, string.Empty, string.Empty);
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>RedisSignalViewerPage</c> view — the native port of the web
/// page's data flow (web/src/features/admin/pages/RedisSignalViewerPage.tsx). It owns the URL-equivalent local state
/// (selected vehicle, search, category filter, auto-refresh) plus the destructive-purge state machine, loads the
/// fleet then the per-vehicle cached signals through the injected <see cref="IRedisSignalViewerFeed"/>, and projects
/// the result through <see cref="RedisSignalViewerProjection"/> so the view is a thin renderer. It surfaces the four
/// web data states (loading / empty / error / success) plus an in-flight flag; observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class RedisSignalViewerPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IRedisSignalViewerFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly RedisSignalViewerDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<RedisSignalViewerVehicle> _vehicles = Array.Empty<RedisSignalViewerVehicle>();
    private long? _selectedId;
    private string _search = string.Empty;
    private string _categoryFilter = RedisCategoryFilter.All;
    private bool _autoRefresh;

    private RedisSignalsSnapshot? _snapshot;
    private bool _loading;
    private bool _isFetching;
    private bool _hasError;
    private string? _errorDetail;

    private RedisPurgeMode _purgeMode = RedisPurgeMode.None;
    private long? _purgeTargetId;
    private string _purgeTargetLabel = string.Empty;
    private bool _isPurging;

    private RedisSignalViewerState _state = RedisSignalViewerState.Empty;
    private RedisSignalViewerDisplay _display;
    private RedisPurgeNotice _purgeNotice = RedisPurgeNotice.Hidden;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics.</summary>
    /// <param name="feed">The vehicles / signals / purge data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public RedisSignalViewerPageViewModel(
        IRedisSignalViewerFeed feed,
        ILocalizer localizer,
        RedisSignalViewerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new RedisSignalViewerDiagnostics();
        _display = RedisSignalViewerProjection.Project(BuildModel(), _localizer);
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public RedisSignalViewerState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public RedisSignalViewerDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The transient purge-result banner (web toast), or the hidden notice.</summary>
    public RedisPurgeNotice PurgeNotice
    {
        get => _purgeNotice;
        private set => Set(ref _purgeNotice, value);
    }

    /// <summary>The currently selected vehicle id (web <c>selectedVehicleId</c>), or null when none is picked.</summary>
    public long? SelectedVehicleId => _selectedId;

    /// <summary>Whether auto-refresh is enabled (web <c>autoRefresh</c>).</summary>
    public bool AutoRefresh => _autoRefresh;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Load the fleet that fills the vehicle picker (web <c>useVehicles</c>); no vehicle is auto-selected.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        try
        {
            var vehicles = await _feed.FetchVehiclesAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _vehicles = vehicles ?? Array.Empty<RedisSignalViewerVehicle>();
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            // web: a useVehicles failure leaves the picker empty; it does not raise the page's error banner
            // (only the per-vehicle signals query feeds isError).
            _vehicles = Array.Empty<RedisSignalViewerVehicle>();
        }

        // web: a still-selected vehicle that left the fleet drops back to the no-selection prompt.
        if (_selectedId is { } id && !ContainsVehicle(id))
        {
            _selectedId = null;
            _snapshot = null;
        }

        if (_selectedId is not null)
        {
            await FetchSignalsAsync(cts.Token).ConfigureAwait(false);
        }

        Reproject();
    }

    /// <summary>Select a vehicle from the picker (web <c>setSelectedVehicleId</c>); loads its cached signals.</summary>
    public async Task SelectVehicleAsync(long? vehicleId, CancellationToken cancellationToken = default)
    {
        long? next = vehicleId is { } id && id > 0 && ContainsVehicle(id) ? id : null;
        if (next == _selectedId)
        {
            return;
        }

        var cts = Supersede(ref _cts, cancellationToken);
        _selectedId = next;
        _snapshot = null;
        _hasError = false;
        _errorDetail = null;
        Reproject();

        if (_selectedId is not null)
        {
            await FetchSignalsAsync(cts.Token).ConfigureAwait(false);
            Reproject();
        }
    }

    /// <summary>Set the signal-name search query (web <c>setSearch</c>); no fetch, re-projects.</summary>
    public void SetSearch(string? search)
    {
        string next = search ?? string.Empty;
        if (string.Equals(_search, next, StringComparison.Ordinal))
        {
            return;
        }

        _search = next;
        Reproject();
    }

    /// <summary>Set the category filter (web <c>setCategoryFilter</c>); no fetch, re-projects.</summary>
    public void SetCategoryFilter(string? category)
    {
        string next = string.IsNullOrEmpty(category) ? RedisCategoryFilter.All : category;
        if (string.Equals(_categoryFilter, next, StringComparison.Ordinal))
        {
            return;
        }

        _categoryFilter = next;
        Reproject();
    }

    /// <summary>Toggle auto-refresh (web <c>setAutoRefresh</c>); the view owns the timer that calls <see cref="RefreshAsync"/>.</summary>
    public void SetAutoRefresh(bool enabled)
    {
        if (_autoRefresh == enabled)
        {
            return;
        }

        _autoRefresh = enabled;
        Reproject();
    }

    /// <summary>Re-fetch the selected vehicle's cached signals (web manual refresh / auto-refetch). No-op without a selection.</summary>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_selectedId is null)
        {
            return;
        }

        var cts = Supersede(ref _cts, cancellationToken);
        await FetchSignalsAsync(cts.Token).ConfigureAwait(false);
        Reproject();
    }

    /// <summary>Open the per-vehicle purge confirmation (web <c>openPurgeOne</c>). No-op without a selection.</summary>
    public void OpenPurgeOne()
    {
        if (_selectedId is null)
        {
            return;
        }

        _purgeTargetId = _selectedId;
        _purgeTargetLabel = SelectedVehicleLabel();
        _purgeMode = RedisPurgeMode.One;
        Reproject();
    }

    /// <summary>Open the cluster-wide purge confirmation (web <c>openPurgeAll</c>).</summary>
    public void OpenPurgeAll()
    {
        _purgeTargetId = null;
        _purgeTargetLabel = string.Empty;
        _purgeMode = RedisPurgeMode.All;
        Reproject();
    }

    /// <summary>Dismiss the purge confirmation without acting (web <c>onCancel</c>). Ignored while a purge is in flight.</summary>
    public void CancelPurge()
    {
        if (_isPurging)
        {
            return;
        }

        _purgeMode = RedisPurgeMode.None;
        _purgeTargetId = null;
        _purgeTargetLabel = string.Empty;
        Reproject();
    }

    /// <summary>Execute the pending purge (web <c>handlePurgeConfirm</c>), surface the result banner and refresh.</summary>
    public async Task ConfirmPurgeAsync(CancellationToken cancellationToken = default)
    {
        var mode = _purgeMode;
        if (mode == RedisPurgeMode.None)
        {
            return;
        }

        long? targetId = _purgeTargetId;
        string label = _purgeTargetLabel;
        _isPurging = true;
        Reproject();

        try
        {
            if (mode == RedisPurgeMode.One && targetId is { } id)
            {
                var result = await _feed.PurgeAsync(id, cancellationToken).ConfigureAwait(false);
                PurgeNotice = result.Purged
                    ? new RedisPurgeNotice(true, CalloutVariant.Success, _display.PurgeSuccessTitle, Format(_display.PurgeSuccessDetailTemplate, label))
                    : new RedisPurgeNotice(true, CalloutVariant.Info, _display.PurgeNoOpTitle, Format(_display.PurgeNoOpDetailTemplate, label));
            }
            else if (mode == RedisPurgeMode.All)
            {
                var result = await _feed.PurgeAllAsync(cancellationToken).ConfigureAwait(false);
                PurgeNotice = result.HasMore
                    ? new RedisPurgeNotice(true, CalloutVariant.Warning, _display.PurgeAllPartialTitle, Format(_display.PurgeAllPartialDetailTemplate, result.Purged, result.Limit))
                    : new RedisPurgeNotice(true, CalloutVariant.Success, _display.PurgeAllSuccessTitle, Format(_display.PurgeAllSuccessDetailTemplate, result.Purged));
            }

            _purgeMode = RedisPurgeMode.None;
            _purgeTargetId = null;
            _purgeTargetLabel = string.Empty;

            // web: invalidate the signals query for the purged scope so the table reflects the now-empty cache.
            if (_selectedId is not null)
            {
                await FetchSignalsAsync(cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            PurgeNotice = new RedisPurgeNotice(true, CalloutVariant.Danger, _display.PurgeErrorTitle, ex.Message);
        }
        finally
        {
            _isPurging = false;
            Reproject();
        }
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

    private async Task FetchSignalsAsync(CancellationToken cancellationToken)
    {
        if (_selectedId is not { } vehicleId)
        {
            return;
        }

        if (_snapshot is null)
        {
            _loading = true;
        }

        _isFetching = true;
        Reproject();

        try
        {
            var snapshot = await _feed.FetchSignalsAsync(vehicleId, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _snapshot = snapshot;
            _hasError = false;
            _errorDetail = null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            // web isError: surface the failure banner; the table falls back to its diagnostic empty branch.
            _hasError = true;
            _errorDetail = ex.Message;
            _snapshot = null;
        }
        finally
        {
            _loading = false;
            _isFetching = false;
        }
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

    private string SelectedVehicleLabel()
    {
        foreach (var vehicle in _vehicles)
        {
            if (vehicle.Id == _selectedId)
            {
                return vehicle.Label;
            }
        }

        return _selectedId is { } id ? string.Create(CultureInfo.CurrentCulture, $"Vehicle {id}") : string.Empty;
    }

    private RedisSignalViewerModel BuildModel() => new(
        Vehicles: _vehicles,
        SelectedVehicleId: _selectedId,
        Search: _search,
        CategoryFilter: _categoryFilter,
        AutoRefresh: _autoRefresh,
        Snapshot: _snapshot,
        Loading: _loading,
        IsFetching: _isFetching,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        PurgeMode: _purgeMode,
        PurgeTargetLabel: _purgeTargetLabel,
        IsPurging: _isPurging);

    private void Reproject()
    {
        var display = RedisSignalViewerProjection.Project(BuildModel(), _localizer);
        Display = display;
        State = display.State;
    }

    private static string Format(string template, params object[] args) =>
        string.Format(CultureInfo.CurrentCulture, template, args);

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
