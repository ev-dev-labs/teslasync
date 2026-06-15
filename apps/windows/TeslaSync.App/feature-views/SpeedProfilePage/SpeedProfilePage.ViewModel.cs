using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SpeedProfilePage</c> view — the native port of the web
/// page's data flow (web/src/features/driving/pages/SpeedProfilePage.tsx). It reads the combined speed-profile
/// rollup + drive list through the injected <see cref="ISpeedProfileFeed"/> (the native <c>useSpeedProfile</c> +
/// <c>useDrives</c> hooks), projects it through <see cref="SpeedProfileProjection"/> with the active units, and
/// surfaces the four web data states (loading / empty / error / success) plus the header freshness flags so the
/// view is a thin renderer. Observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SpeedProfilePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISpeedProfileFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly SpeedProfileDiagnostics _diagnostics;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private SpeedProfileSnapshot _snapshot = SpeedProfileSnapshot.Empty;
    private bool _hasData;
    private bool _loading = true;
    private string? _errorDetail;

    private SpeedProfileState _state = SpeedProfileState.Loading;
    private SpeedProfileDisplay _display;
    private bool _isFetching;
    private DateTimeOffset? _updatedAt;

    /// <summary>Creates the holder over its data feed, localizer, units and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The two-source speed-profile data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit-display preference (defaults to metric).</param>
    /// <param name="clock">Injectable clock for deterministic freshness in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SpeedProfilePageViewModel(
        ISpeedProfileFeed feed,
        ILocalizer localizer,
        UnitPref? units = null,
        Func<DateTimeOffset>? clock = null,
        SpeedProfileDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new SpeedProfileDiagnostics();
        _display = SpeedProfileProjection.Project(BuildModel(), _units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public SpeedProfileState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SpeedProfileDisplay Display
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

    /// <summary>The localized page title (web <c>t('speedProfile.title')</c>).</summary>
    public string Title => SpeedProfileRegistration.Title(_localizer);

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

    /// <summary>Run (or re-run) the speed-profile + drives load and fold the result into the data state.</summary>
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
            var snapshot = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _snapshot = snapshot;
            _hasData = snapshot.HasData;
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

    /// <summary>Refresh the analytics (web query refetch / Retry).</summary>
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
        _snapshot = SpeedProfileSnapshot.Empty;
        _hasData = false;
        _loading = false;
    }

    private SpeedProfileModel BuildModel() => new(_snapshot, _loading, _errorDetail);

    private void Reproject()
    {
        var display = SpeedProfileProjection.Project(BuildModel(), _units, _localizer);
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
