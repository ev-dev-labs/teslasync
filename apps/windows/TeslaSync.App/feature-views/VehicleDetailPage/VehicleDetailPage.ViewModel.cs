using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>VehicleDetailPage</c> view — the native port of the web
/// page's data flow (web/src/features/vehicles/pages/VehicleDetailPage.tsx). It reads the per-vehicle settings
/// snapshot for one vehicle id through the injected <see cref="IVehicleDetailPageFeed"/> (the native
/// <c>useVehicleSettings</c> hook), projects it through <see cref="VehicleDetailProjection"/> with the active
/// localizer, and surfaces the four web data states (loading / empty / error / success) plus the header freshness
/// flags and the wake-command result so the view is a thin renderer. Observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class VehicleDetailPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IVehicleDetailPageFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly VehicleDetailPageDiagnostics _diagnostics;
    private readonly long _vehicleId;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private VehicleDetailSnapshot _snapshot = VehicleDetailSnapshot.Empty;
    private bool _hasData;
    private bool _loading = true;
    private string? _errorDetail;

    private VehicleDetailState _state = VehicleDetailState.Loading;
    private VehicleDetailDisplay _display;
    private bool _isFetching;
    private DateTimeOffset? _updatedAt;

    private bool _wakeInProgress;
    private string? _wakeStatus;
    private bool _wakeIsError;

    /// <summary>Creates the holder over its data feed, localizer, vehicle id and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The settings + wake data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The vehicle id from the route (web <c>:id</c> param).</param>
    /// <param name="clock">Injectable clock for deterministic freshness in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleDetailPageViewModel(
        IVehicleDetailPageFeed feed,
        ILocalizer localizer,
        long vehicleId,
        Func<DateTimeOffset>? clock = null,
        VehicleDetailPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _vehicleId = vehicleId;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new VehicleDetailPageDiagnostics();
        _display = VehicleDetailProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public VehicleDetailState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public VehicleDetailDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight (the header freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the header freshness chip's error state).</summary>
    public bool IsError => _errorDetail is not null;

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while the wake command is in flight (the wake button shows its busy state).</summary>
    public bool WakeInProgress
    {
        get => _wakeInProgress;
        private set => Set(ref _wakeInProgress, value);
    }

    /// <summary>The latest wake-command result message (web toast), or null when no wake has run.</summary>
    public string? WakeStatus
    {
        get => _wakeStatus;
        private set => Set(ref _wakeStatus, value);
    }

    /// <summary>True when the latest wake-command result was a failure (drives the banner tone).</summary>
    public bool WakeIsError
    {
        get => _wakeIsError;
        private set => Set(ref _wakeIsError, value);
    }

    /// <summary>The vehicle id this holder is bound to.</summary>
    public long VehicleId => _vehicleId;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the per-vehicle settings load and fold the result into the data state.</summary>
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
            var snapshot = await _feed.FetchAsync(_vehicleId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _snapshot = snapshot;
            _hasData = snapshot.HasSettings;
            _errorDetail = null;
            _loading = false;
            _updatedAt = _clock();
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
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

    /// <summary>Refresh the vehicle detail (web query refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Send the wake command (web header wake button) and fold the result into <see cref="WakeStatus"/> — the
    /// success toast on success, the API message (or the localized failure toast) on failure — exactly as the web
    /// mutation's <c>onSuccess</c> / <c>onError</c> handlers do. Concurrent invocations are ignored while one is
    /// in flight.
    /// </summary>
    public async Task WakeAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed || _wakeInProgress)
        {
            return;
        }

        WakeInProgress = true;
        try
        {
            await _feed.WakeAsync(_vehicleId, cancellationToken).ConfigureAwait(false);
            WakeIsError = false;
            WakeStatus = _display.WakeSuccess;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (ApiException ex)
        {
            WakeIsError = true;
            WakeStatus = string.IsNullOrWhiteSpace(ex.Message) ? _display.WakeFailed : ex.Message;
        }
        catch (Exception ex)
        {
            WakeIsError = true;
            WakeStatus = string.IsNullOrWhiteSpace(ex.Message) ? _display.WakeFailed : ex.Message;
        }
        finally
        {
            WakeInProgress = false;
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

    private void SetError(string? detail)
    {
        _errorDetail = string.IsNullOrWhiteSpace(detail) ? "unknown error" : detail;
        _snapshot = VehicleDetailSnapshot.Empty;
        _hasData = false;
        _loading = false;
    }

    private VehicleDetailModel BuildModel() => new(_snapshot, _loading, _errorDetail);

    private void Reproject()
    {
        var display = VehicleDetailProjection.Project(BuildModel(), _localizer);
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
