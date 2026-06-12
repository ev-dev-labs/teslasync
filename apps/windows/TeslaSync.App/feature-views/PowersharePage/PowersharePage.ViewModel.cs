using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>PowersharePage</c> view — the native port of the web
/// page's data flow (web/src/features/charging/pages/PowersharePage.tsx). It reads the five Powershare cold
/// signals through the injected <see cref="IPowershareFeed"/> (the web's five <c>useSignalObservations</c>
/// hooks), projects each reading through <see cref="PowershareProjection"/> so the view is a thin renderer,
/// and exposes the four data states (loading / empty / error / success) plus an in-flight flag; observable so
/// the view re-renders on <see cref="PropertyChanged"/>. With no vehicle selected the reads are disabled and
/// the surface resolves straight to the empty state (web parity: the queries are disabled and <c>data</c> is
/// undefined). Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class PowersharePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IPowershareFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly string? _vehicleId;
    private readonly PowershareDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private bool _loading;
    private bool _hasError;
    private string? _errorDetail;
    private PowershareReading _reading = PowershareReading.Empty;

    private PowershareState _state;
    private PowershareDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer, the selected vehicle and diagnostics sink.</summary>
    /// <param name="feed">The Powershare data port (web's five observation reads).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The selected vehicle id (web <c>useSelectedVehicle</c>); null renders the empty state.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PowersharePageViewModel(
        IPowershareFeed feed,
        ILocalizer localizer,
        string? vehicleId = null,
        PowershareDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _vehicleId = string.IsNullOrWhiteSpace(vehicleId) ? null : vehicleId;
        _diagnostics = diagnostics ?? new PowershareDiagnostics();

        // No vehicle selected → the reads are disabled and resolve to the empty state (not a spinner).
        _loading = _vehicleId is not null;
        _display = PowershareProjection.Project(BuildModel(), _localizer);
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public PowershareState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public PowershareDisplay Display
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

    /// <summary>The localized page title (web <c>t('powershare.title')</c>).</summary>
    public string Title => PowershareRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run (or re-run) the five Powershare reads and fold the resulting reading into <see cref="State"/> +
    /// <see cref="Display"/>. With no vehicle the surface resolves to the empty state without fetching. A
    /// superseding load cancels the prior one; an outright failure surfaces the retryable error state.
    /// </summary>
    /// <param name="cancellationToken">Cancels this load.</param>
    /// <returns>A task that completes when the load finishes (or is superseded).</returns>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        if (_vehicleId is null)
        {
            // Web: with no vehicle the queries are disabled — show the empty state, never a spinner.
            _loading = false;
            _hasError = false;
            _reading = PowershareReading.Empty;
            Reproject();
            return;
        }

        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_reading.HasData)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var reading = await _feed.FetchAsync(_vehicleId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _reading = reading;
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
            _hasError = true;
            _reading = PowershareReading.Empty;
            _errorDetail = ex.Message;
            _loading = false;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the Powershare reads (web query refetch / Retry).</summary>
    /// <param name="cancellationToken">Cancels the reload.</param>
    /// <returns>A task that completes when the reload finishes.</returns>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

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

    private PowershareModel BuildModel() => new(
        VehicleSelected: _vehicleId is not null,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        Reading: _reading);

    private void Reproject()
    {
        var display = PowershareProjection.Project(BuildModel(), _localizer);
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
