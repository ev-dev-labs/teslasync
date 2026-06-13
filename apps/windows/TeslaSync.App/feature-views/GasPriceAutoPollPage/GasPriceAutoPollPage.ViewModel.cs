using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>GasPriceAutoPollPage</c> view — the native port of the web
/// page's data flow (the wrapper web/src/features/admin/pages/GasPriceAutoPollPage.tsx and the embedded
/// web/src/features/settings/components/GasPriceSettings.tsx). It owns the gas-price status, reads it through the
/// injected <see cref="IGasPriceFeed"/> and persists the auto-poll toggle, the poll interval and a manual poll
/// the same way (web <c>useToggleGasPrice</c> / <c>useUpdateGasPriceConfig</c> / <c>usePollGasPrice</c>): the
/// edit is applied optimistically for instant feedback, the feed is asked to persist it, and the authoritative
/// status (when the feed returns one) reconciles the local copy. Every mutation projects through
/// <see cref="GasPriceProjection"/> so the view is a thin renderer. It surfaces the four web data states
/// (loading / empty / error / success) plus the in-flight poll flag; observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class GasPriceAutoPollPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IGasPriceFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly GasPriceDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private GasPriceStatus? _status;
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private string? _notice;
    private bool _polling;

    private GasPriceState _state = GasPriceState.Loading;
    private GasPriceDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The gas-price status data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic last-poll formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public GasPriceAutoPollPageViewModel(
        IGasPriceFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        GasPriceDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new GasPriceDiagnostics();
        _display = GasPriceProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public GasPriceState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public GasPriceDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while the initial status (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>gas.title</c>).</summary>
    public string Title => GasPriceAutoPollRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>gas.subtitle</c>).</summary>
    public string Subtitle => GasPriceAutoPollRegistration.Subtitle(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the status load (web <c>useGasPriceStatus</c>).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        _notice = null;
        if (_status is null)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var status = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _status = status;
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
            // web onError: surface the failure banner; the panel falls back to its defaults.
            _hasError = true;
            _errorDetail = ex.Message;
            _loading = false;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the status (web query refetch).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Toggle the auto-poll on/off (web <c>useToggleGasPrice</c> on the ghost button).</summary>
    public Task ToggleAsync(CancellationToken cancellationToken = default)
    {
        bool target = !(_status?.Enabled ?? false);
        var optimistic = (_status ?? GasPriceStatus.Default) with { Enabled = target };
        return PersistAsync(
            optimistic,
            GasPriceProjection.ToggleNotice(_localizer, target),
            token => _feed.SetEnabledAsync(target, token),
            cancellationToken);
    }

    /// <summary>Set the poll interval (web <c>useUpdateGasPriceConfig</c> on the select change).</summary>
    public Task SetIntervalAsync(string interval, CancellationToken cancellationToken = default)
    {
        string next = string.IsNullOrEmpty(interval) ? GasPriceStatus.DefaultInterval : interval;
        var optimistic = (_status ?? GasPriceStatus.Default) with { PollInterval = next };
        return PersistAsync(
            optimistic,
            GasPriceProjection.IntervalNotice(_localizer),
            token => _feed.SetIntervalAsync(next, token),
            cancellationToken);
    }

    /// <summary>Trigger an immediate poll (web <c>usePollGasPrice</c> on the Poll Now button).</summary>
    public async Task PollNowAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed)
        {
            return;
        }

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        _polling = true;
        _notice = GasPriceProjection.PollNotice(_localizer);
        Reproject();

        try
        {
            var status = await _feed.PollNowAsync(cts.Token).ConfigureAwait(false);
            if (status is not null)
            {
                _status = status;
            }

            _hasError = false;
            _errorDetail = null;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _hasError = true;
            _errorDetail = ex.Message;
        }
        finally
        {
            _polling = false;
        }

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

    private async Task PersistAsync(
        GasPriceStatus optimistic,
        string notice,
        Func<CancellationToken, Task<GasPriceStatus?>> persist,
        CancellationToken cancellationToken)
    {
        if (_disposed)
        {
            return;
        }

        var previous = _status;
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        // Optimistic edit (web mutate): the panel reflects the change immediately.
        _status = optimistic;
        _notice = notice;
        _loading = false;
        Reproject();

        try
        {
            var persisted = await persist(cts.Token).ConfigureAwait(false);
            if (persisted is not null)
            {
                // Authoritative status from the feed reconciles the optimistic copy (web invalidate -> refetch).
                _status = persisted;
            }

            _hasError = false;
            _errorDetail = null;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            // Persistence failed: revert the optimistic edit and surface the failure (web onError).
            _status = previous;
            _notice = null;
            _hasError = true;
            _errorDetail = ex.Message;
        }

        Reproject();
    }

    private GasPriceModel BuildModel() => new(
        Status: _status,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        Notice: _notice,
        Polling: _polling);

    private void Reproject()
    {
        var display = GasPriceProjection.Project(BuildModel(), _localizer, _clock());
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
