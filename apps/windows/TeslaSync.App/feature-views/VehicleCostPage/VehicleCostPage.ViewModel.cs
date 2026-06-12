using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>VehicleCostPage</c> view — the native port of the web page's data
/// flow (web/src/features/admin/pages/VehicleCostPage.tsx). It derives the look-back <c>since</c> from the selected
/// window (web <c>since = now - windowDays·24h</c>), reads the cost report through the injected
/// <see cref="IVehicleCostFeed"/> (web <c>useVehicleCost(since, 100)</c>) and projects the result through
/// <see cref="VehicleCostProjection"/> so the view is a thin renderer. It surfaces the four web data states
/// (loading / empty / error / success) — with the HTTP 503 failure mapped to the distinct subsystem-unavailable
/// banner (web <c>subsystemMissing</c>) — plus an in-flight flag and the window selector (web <c>setWindowDays</c>);
/// observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class VehicleCostPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IVehicleCostFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly VehicleCostDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private bool _hasData;
    private IReadOnlyList<VehicleCostRow> _vehicles = Array.Empty<VehicleCostRow>();
    private VehicleCostTotals _totals = VehicleCostTotals.Empty;
    private int _windowDays = VehicleCostProjection.DefaultWindowDays;
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private bool _subsystemMissing;

    private VehicleCostState _state = VehicleCostState.Loading;
    private VehicleCostDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The vehicle-cost data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic <c>since</c> derivation and timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleCostPageViewModel(
        IVehicleCostFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        VehicleCostDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new VehicleCostDiagnostics();
        _display = VehicleCostProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public VehicleCostState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public VehicleCostDisplay Display
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

    /// <summary>The selected look-back window in days (web <c>windowDays</c>).</summary>
    public int WindowDays => _windowDays;

    /// <summary>The localized page title (web <c>admin.vehicleCost.pageTitle</c>).</summary>
    public string Title => VehicleCostRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the vehicle-cost load for the selected window.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasData)
        {
            _loading = true;
            Reproject();
        }

        DateTimeOffset since = _clock() - TimeSpan.FromDays(_windowDays);

        try
        {
            var snapshot = await _feed.FetchAsync(since, VehicleCostProjection.RowLimit, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _hasData = snapshot.HasData;
            _vehicles = snapshot.Vehicles;
            _totals = snapshot.Totals;
            _hasError = false;
            _subsystemMissing = false;
            _errorDetail = null;
            _loading = false;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (ApiException ex) when (ex.StatusCode == 503)
        {
            // web subsystemMissing: the ingest-x-ray subsystem is not configured (HTTP 503) — show the banner.
            _subsystemMissing = true;
            _hasError = false;
            _hasData = false;
            _vehicles = Array.Empty<VehicleCostRow>();
            _totals = VehicleCostTotals.Empty;
            _errorDetail = ex.Message;
            _loading = false;
        }
        catch (Exception ex)
        {
            // Any other failure: surface the generic InfoBar + Retry surface.
            _hasError = true;
            _subsystemMissing = false;
            _hasData = false;
            _vehicles = Array.Empty<VehicleCostRow>();
            _totals = VehicleCostTotals.Empty;
            _errorDetail = ex.Message;
            _loading = false;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the report (web query refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Change the look-back window (web <c>setWindowDays</c>) and reload. A no-op when the value is unchanged or not
    /// one of the offered choices; the selected option + the "Window: Nd" sublabel re-project immediately so the
    /// selector reflects the new value before the fetch resolves.
    /// </summary>
    public Task SetWindowAsync(int days, CancellationToken cancellationToken = default)
    {
        if (days == _windowDays || !VehicleCostProjection.WindowChoices.Contains(days))
        {
            return Task.CompletedTask;
        }

        _windowDays = days;
        Reproject();
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

    private VehicleCostModel BuildModel() => new(
        HasData: _hasData,
        Vehicles: _vehicles,
        Totals: _totals,
        WindowDays: _windowDays,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        SubsystemMissing: _subsystemMissing);

    private void Reproject()
    {
        var display = VehicleCostProjection.Project(BuildModel(), _localizer, _clock());
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
