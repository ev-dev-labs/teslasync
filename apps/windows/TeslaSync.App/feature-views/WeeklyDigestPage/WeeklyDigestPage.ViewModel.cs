using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>WeeklyDigestPage</c> view — the native port of the web page's
/// data flow (web/src/features/analytics/components/weekly-digest/useWeeklyDigest.ts). It reads the digest through
/// the injected <see cref="IWeeklyDigestFeed"/> (vehicles + the selected vehicle's drives / charging / alerts) and
/// projects the result through <see cref="WeeklyDigestProjection"/> so the view is a thin renderer. It owns the two
/// pieces of client state the web hook holds — the selected vehicle (<see cref="SelectVehicle"/>) and the viewed
/// week offset (<see cref="PreviousWeek"/> / <see cref="NextWeek"/>) — re-projecting the cached snapshot when the
/// week changes (the week is filtered client-side, so paging never refetches) and refetching when the vehicle
/// changes. It surfaces the four web data states (loading / empty / error / ready); observable so the view
/// re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread).
/// </summary>
public sealed class WeeklyDigestPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IWeeklyDigestFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly string _currencySymbol;
    private readonly WeeklyDigestDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private WeeklyDigestSnapshot _snapshot = WeeklyDigestSnapshot.Empty;
    private string _requestedVehicleId = string.Empty;
    private int _weekOffset;
    private bool _hasData;
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;

    private WeeklyDigestState _state = WeeklyDigestState.Loading;
    private WeeklyDigestDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / currency / diagnostics.</summary>
    /// <param name="feed">The weekly-digest data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock used to resolve the active week (deterministic in tests).</param>
    /// <param name="currencySymbol">The active currency symbol for the cost figures (defaults to <c>$</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public WeeklyDigestPageViewModel(
        IWeeklyDigestFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        string? currencySymbol = null,
        WeeklyDigestDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        _diagnostics = diagnostics ?? new WeeklyDigestDiagnostics();
        _display = WeeklyDigestProjection.Project(BuildModel(), _localizer, _clock(), _currencySymbol);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / ready).</summary>
    public WeeklyDigestState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public WeeklyDigestDisplay Display
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

    /// <summary>The localized page title (web <c>analytics.weeklyDigest.title</c>).</summary>
    public string Title => WeeklyDigestRegistration.Title(_localizer);

    /// <summary>The week being viewed relative to the current week (0 = current; negative = past).</summary>
    public int WeekOffset => _weekOffset;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the digest load for the selected vehicle.</summary>
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
            var snapshot = await _feed.FetchAsync(_requestedVehicleId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _snapshot = snapshot;
            _requestedVehicleId = snapshot.SelectedVehicleId;
            _hasError = false;
            _errorDetail = null;
            _loading = false;
            _hasData = snapshot.Drives.Count > 0 || snapshot.Charging.Count > 0;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (ApiException ex)
        {
            _hasError = true;
            _hasData = false;
            _errorDetail = ex.Message;
            _loading = false;
        }
        catch (Exception ex)
        {
            _hasError = true;
            _hasData = false;
            _errorDetail = ex.Message;
            _loading = false;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the digest (web query refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Select a vehicle (web <c>setVehicleId</c>) and refetch its digest when the choice changes.</summary>
    /// <param name="vehicleId">The chosen vehicle id (the web option value).</param>
    public Task SelectVehicleAsync(string vehicleId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(vehicleId) || string.Equals(vehicleId, _requestedVehicleId, StringComparison.Ordinal))
        {
            return Task.CompletedTask;
        }

        _requestedVehicleId = vehicleId;
        return LoadAsync(cancellationToken);
    }

    /// <summary>Page to the previous week (web <c>goToPrevWeek</c>) — re-projects the cached snapshot, no refetch.</summary>
    public void PreviousWeek()
    {
        _weekOffset--;
        Reproject();
    }

    /// <summary>Page to the next week (web <c>goToNextWeek</c>) — capped at the current week, no refetch.</summary>
    public void NextWeek()
    {
        if (_weekOffset >= 0)
        {
            return;
        }

        _weekOffset++;
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

    private WeeklyDigestModel BuildModel() => new(
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        Vehicles: _snapshot.Vehicles,
        SelectedVehicleId: _snapshot.SelectedVehicleId,
        WeekOffset: _weekOffset,
        Drives: _snapshot.Drives,
        Charging: _snapshot.Charging,
        Alerts: _snapshot.Alerts);

    private void Reproject()
    {
        var display = WeeklyDigestProjection.Project(BuildModel(), _localizer, _clock(), _currencySymbol);
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
