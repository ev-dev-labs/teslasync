using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Trips;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>TripDetailPage</c> view — the native port of the web page's
/// data flow (web/src/features/trips/pages/TripDetailPage.tsx). It reads the single-source trip snapshot for one
/// trip id through the injected <see cref="ITripDetailPageFeed"/> (the native <c>useTrip</c> hook), projects it
/// through <see cref="TripDetailProjection"/> with the active units, currency and clock, and surfaces the four web
/// data states (loading / empty / error / success) plus the header freshness flags so the view is a thin
/// renderer. Observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class TripDetailPageViewModel : INotifyPropertyChanged, IDisposable
{
    private const string DefaultCurrencySymbol = "$";

    private readonly ITripDetailPageFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly TripDetailPageDiagnostics _diagnostics;
    private readonly long _tripId;
    private readonly string _currencySymbol;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private TripDetailSnapshot _snapshot = TripDetailSnapshot.Empty;
    private bool _hasData;
    private bool _loading = true;
    private string? _errorDetail;

    private TripDetailState _state = TripDetailState.Loading;
    private TripDetailDisplay _display;
    private bool _isFetching;
    private DateTimeOffset? _updatedAt;

    /// <summary>Creates the holder over its data feed, localizer, trip id, units, currency and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The single-source trip data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="tripId">The trip id from the route (web <c>:id</c> param).</param>
    /// <param name="units">The user's unit-display preference (defaults to metric).</param>
    /// <param name="clock">Injectable clock for deterministic freshness / date formatting in tests.</param>
    /// <param name="currencySymbol">The settings currency symbol (web <c>useFormatting().currencySymbol</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TripDetailPageViewModel(
        ITripDetailPageFeed feed,
        ILocalizer localizer,
        long tripId,
        UnitPref? units = null,
        Func<DateTimeOffset>? clock = null,
        string? currencySymbol = null,
        TripDetailPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _tripId = tripId;
        _units = units ?? UnitPref.Metric;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _currencySymbol = string.IsNullOrEmpty(currencySymbol) ? DefaultCurrencySymbol : currencySymbol;
        _diagnostics = diagnostics ?? new TripDetailPageDiagnostics();
        _display = TripDetailProjection.Project(BuildModel(), _units, _localizer, _clock(), _currencySymbol);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public TripDetailState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public TripDetailDisplay Display
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

    /// <summary>The trip id this holder is bound to.</summary>
    public long TripId => _tripId;

    /// <summary>The user's unit preference; reassigning re-projects the current snapshot in the new units.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_units == value)
            {
                return;
            }

            _units = value;
            Reproject();
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the trip-detail load and fold the result into the data state.</summary>
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
            var snapshot = await _feed.FetchAsync(_tripId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _snapshot = snapshot;
            _hasData = snapshot.HasTrip;
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

    /// <summary>Refresh the trip detail (web query refetch / Retry).</summary>
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

    private void SetError(string? detail)
    {
        _errorDetail = string.IsNullOrWhiteSpace(detail) ? "unknown error" : detail;
        _snapshot = TripDetailSnapshot.Empty;
        _hasData = false;
        _loading = false;
    }

    private TripDetailModel BuildModel() => new(_snapshot, _loading, _errorDetail);

    private void Reproject()
    {
        var display = TripDetailProjection.Project(BuildModel(), _units, _localizer, _clock(), _currencySymbol);
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
