using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>FleetAPIPage</c> view — the native port of the web page's data flow
/// (web/src/features/admin/pages/FleetAPIPage.tsx). It reads the four query payloads through the injected
/// <see cref="IFleetApiFeed"/> (web <c>useSettings</c> / <c>usePollingConfig</c> / <c>useCaptureStats</c> /
/// <c>useVersionInfo</c>), runs the suspend toggle (web <c>useToggleAPISuspend</c>) and the polling-config writes
/// (web <c>useUpdatePollingConfig</c> — per-endpoint flips and the retention change), surfaces the resulting toast as a
/// <see cref="FleetApiNoticeKind"/>, and re-reads the affected queries afterwards (web <c>invalidateQueries</c> →
/// refetch). It projects everything through <see cref="FleetApiProjection"/> so the view is a thin renderer. The first
/// read gates the loading spinner; once it resolves the static surface always renders. Observable so the view
/// re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class FleetAPIPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFleetApiFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly FleetApiDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private bool _loading = true;
    private bool _hasLoaded;
    private bool _isFetching;

    private FleetSettingsSnapshot _settings = FleetSettingsSnapshot.Empty;
    private PollingConfigSnapshot _pollingConfig = PollingConfigSnapshot.Empty;
    private CaptureStatsSnapshot _captureStats = CaptureStatsSnapshot.Empty;
    private FleetVersionSnapshot _version = FleetVersionSnapshot.Empty;
    private FleetApiNoticeKind _notice = FleetApiNoticeKind.None;

    private FleetApiState _state = FleetApiState.Loading;
    private FleetApiDisplay _display;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics.</summary>
    /// <param name="feed">The Fleet API data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FleetAPIPageViewModel(IFleetApiFeed feed, ILocalizer localizer, FleetApiDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new FleetApiDiagnostics();
        _display = FleetApiProjection.Project(FleetApiModel.Initial, localizer);
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / success).</summary>
    public FleetApiState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public FleetApiDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)read of any query payload is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) all four reads (web initial queries).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasLoaded)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            await ReadAllAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _loading = false;
            _hasLoaded = true;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh every read (web query refetch).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Toggle Tesla API suspension (web <c>useToggleAPISuspend</c>). <paramref name="desiredSuspended"/> is the new
    /// suspended state the user is requesting (web <c>!settings?.api_suspended</c>). On resolution the matching toast
    /// is surfaced and the settings read is re-run so the toggle reflects the authoritative state.
    /// </summary>
    public async Task ToggleSuspendAsync(bool desiredSuspended, CancellationToken cancellationToken = default)
    {
        IsFetching = true;

        FleetMutationOutcome outcome;
        try
        {
            outcome = await _feed.ToggleSuspendAsync(desiredSuspended, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsFetching = false;
            return;
        }
        catch (Exception)
        {
            outcome = FleetMutationOutcome.Fail;
        }

        _notice = outcome.Success
            ? (desiredSuspended ? FleetApiNoticeKind.ApiSuspended : FleetApiNoticeKind.ApiResumed)
            : FleetApiNoticeKind.SuspendFailed;

        if (outcome.Success)
        {
            await SafeReadAsync(async ct => _settings = await _feed.FetchSettingsAsync(ct).ConfigureAwait(false), cancellationToken)
                .ConfigureAwait(false);
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>
    /// Flip one endpoint toggle (web <c>toggleEndpoint</c> → <c>useUpdatePollingConfig</c>). Sends the full config with
    /// the single flag flipped, surfaces the success / failure toast, then re-reads the polling config + capture stats
    /// (web invalidates both query keys).
    /// </summary>
    public Task ToggleEndpointAsync(string key, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        if (!_pollingConfig.HasData)
        {
            return Task.CompletedTask;
        }

        bool next = !_pollingConfig.IsEnabled(key);
        return WritePollingConfigAsync(_pollingConfig.WithToggle(key, next), cancellationToken);
    }

    /// <summary>
    /// Change the telemetry-capture retention window (web retention <c>Select</c> → <c>useUpdatePollingConfig</c>).
    /// A no-op when the value is unchanged; otherwise sends the full config with the new retention and re-reads.
    /// </summary>
    public Task SetRetentionAsync(int days, CancellationToken cancellationToken = default)
    {
        if (!_pollingConfig.HasData || days == _pollingConfig.RetentionDays)
        {
            return Task.CompletedTask;
        }

        return WritePollingConfigAsync(_pollingConfig.WithRetention(days), cancellationToken);
    }

    /// <summary>Dismiss the active mutation notice (web toast auto-dismiss / close).</summary>
    public void ClearNotice()
    {
        if (_notice == FleetApiNoticeKind.None)
        {
            return;
        }

        _notice = FleetApiNoticeKind.None;
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

    private async Task WritePollingConfigAsync(
        IReadOnlyDictionary<string, object> payload,
        CancellationToken cancellationToken)
    {
        IsFetching = true;

        FleetMutationOutcome outcome;
        try
        {
            outcome = await _feed.UpdatePollingConfigAsync(payload, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsFetching = false;
            return;
        }
        catch (Exception)
        {
            outcome = FleetMutationOutcome.Fail;
        }

        _notice = outcome.Success ? FleetApiNoticeKind.PollingUpdated : FleetApiNoticeKind.PollingFailed;

        if (outcome.Success)
        {
            await SafeReadAsync(async ct => _pollingConfig = await _feed.FetchPollingConfigAsync(ct).ConfigureAwait(false), cancellationToken)
                .ConfigureAwait(false);
            await SafeReadAsync(async ct => _captureStats = await _feed.FetchCaptureStatsAsync(ct).ConfigureAwait(false), cancellationToken)
                .ConfigureAwait(false);
        }

        IsFetching = false;
        Reproject();
    }

    private async Task ReadAllAsync(CancellationToken cancellationToken)
    {
        // Each query is independent (web parity): one read failing must not blank the others, so failures keep the
        // prior snapshot. Cancellation propagates so a superseding load drops this one.
        await Task.WhenAll(
            SafeReadAsync(async ct => _settings = await _feed.FetchSettingsAsync(ct).ConfigureAwait(false), cancellationToken),
            SafeReadAsync(async ct => _pollingConfig = await _feed.FetchPollingConfigAsync(ct).ConfigureAwait(false), cancellationToken),
            SafeReadAsync(async ct => _captureStats = await _feed.FetchCaptureStatsAsync(ct).ConfigureAwait(false), cancellationToken),
            SafeReadAsync(async ct => _version = await _feed.FetchVersionAsync(ct).ConfigureAwait(false), cancellationToken))
            .ConfigureAwait(false);
    }

    private static async Task SafeReadAsync(Func<CancellationToken, Task> read, CancellationToken cancellationToken)
    {
        try
        {
            await read(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // web: a failed query leaves its prior data in place; the rest of the surface still renders.
        }
    }

    private void Reproject()
    {
        var model = new FleetApiModel(
            Loading: _loading,
            Settings: _settings,
            PollingConfig: _pollingConfig,
            CaptureStats: _captureStats,
            Version: _version,
            Notice: _notice);

        var display = FleetApiProjection.Project(model, _localizer);
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
