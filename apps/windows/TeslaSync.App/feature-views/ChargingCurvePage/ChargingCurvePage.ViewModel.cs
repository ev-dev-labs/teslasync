using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>ChargingCurvePage</c> view — the native port of the web
/// page's data flow (web/src/features/charging/pages/ChargingCurvePage.tsx). It reads the charging-sessions
/// snapshot through the injected <see cref="IChargingCurveFeed"/> (the native
/// <c>useChargingSessionsPaginated</c> hook), tracks the user's session selection, projects the result through
/// <see cref="ChargingCurveProjection"/>, and surfaces the mutually-exclusive <see cref="State"/>
/// (loading / empty / success / error) plus the header freshness flags so the view is a thin renderer.
/// Observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class ChargingCurvePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IChargingCurveFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly ChargingCurveDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private ChargingCurveSnapshot _snapshot = ChargingCurveSnapshot.Empty;
    private long? _selectedSessionId;
    private bool _loading = true;
    private string? _errorDetail;

    private ChargingCurveState _state = ChargingCurveState.Loading;
    private ChargingCurveDisplay _display;
    private bool _isFetching;
    private DateTimeOffset? _updatedAt;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The charging-sessions data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic date formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ChargingCurvePageViewModel(
        IChargingCurveFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        ChargingCurveDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new ChargingCurveDiagnostics();
        _display = ChargingCurveProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / success / error).</summary>
    public ChargingCurveState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public ChargingCurveDisplay Display
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

    /// <summary>The localized page title (web <c>t('charging.curve.title')</c>).</summary>
    public string Title => ChargingCurveRegistration.Title(_localizer);

    /// <summary>The id of the session currently inspected, or null when none is selected.</summary>
    public long? SelectedSessionId => _selectedSessionId;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Select (or clear) the session to inspect — the native analogue of the web
    /// <c>setSelectedSessionId</c> state setter. Re-projects so the curve + detail panel and the
    /// select-a-session hint swap immediately.
    /// </summary>
    public void SelectSession(long? sessionId)
    {
        if (_selectedSessionId == sessionId)
        {
            return;
        }

        _selectedSessionId = sessionId;
        Reproject();
    }

    /// <summary>Run (or re-run) the charging-sessions load and fold the result into the data state.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_snapshot.HasData)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _snapshot = snapshot;
            _errorDetail = null;
            _loading = false;
            _updatedAt = _clock();

            // Drop a stale selection that the refreshed list no longer contains (web range-change reset).
            if (_selectedSessionId is { } id && !ContainsSession(snapshot, id))
            {
                _selectedSessionId = null;
            }
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

    /// <summary>Refresh the charging-sessions list (web query refetch / Retry).</summary>
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

    private static bool ContainsSession(ChargingCurveSnapshot snapshot, long id)
    {
        foreach (var session in snapshot.Sessions)
        {
            if (session.Id == id)
            {
                return true;
            }
        }

        return false;
    }

    private void SetError(string? detail)
    {
        _errorDetail = string.IsNullOrWhiteSpace(detail) ? "unknown error" : detail;
        _snapshot = ChargingCurveSnapshot.Empty;
        _selectedSessionId = null;
        _loading = false;
    }

    private ChargingCurveModel BuildModel() =>
        new(_snapshot, _selectedSessionId, _loading, _errorDetail);

    private void Reproject()
    {
        var display = ChargingCurveProjection.Project(BuildModel(), _localizer, _clock());
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
