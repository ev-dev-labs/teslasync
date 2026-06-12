using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>ProjectedRangePage</c> view — the native port of the web
/// page's data flow (web/src/features/battery/pages/ProjectedRangePage.tsx). It consumes the cache-then-network
/// <see cref="IRangeProjectionSource"/>, projects each snapshot through <see cref="RangeProjectionProjection"/>
/// with the active what-if slider conditions and unit preference, and exposes the mutually-exclusive
/// <see cref="State"/> plus the header freshness flags so the view is a thin renderer. The interactive
/// <see cref="WhatIfSpeedKmh"/> / <see cref="WhatIfTempC"/> sliders re-project the current snapshot in place
/// (the web <c>useMemo</c> over the two slider <c>useState</c>s), and the full layout renders for any present
/// snapshot — only a genuinely empty response (no vehicle / empty body) collapses to
/// <see cref="RangeProjectionState.Empty"/>. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class ProjectedRangePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IRangeProjectionSource _source;
    private readonly ILocalizer _localizer;

    private UnitPref _units;
    private double _whatIfSpeedKmh = RangeProjectionProjection.DefaultWhatIfSpeedKmh;
    private double _whatIfTempC = RangeProjectionProjection.DefaultWhatIfTempC;
    private CancellationTokenSource? _cts;
    private RepositoryResult<RangeProjection>? _last;
    private bool _disposed;

    private RangeProjectionState _state = RangeProjectionState.Loading;
    private RangeProjectionDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;

    /// <summary>Creates the holder over its data source, localizer and unit preference.</summary>
    /// <param name="source">The cache-then-network range-projection source.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit-display preference (defaults to metric).</param>
    public ProjectedRangePageViewModel(
        IRangeProjectionSource source,
        ILocalizer localizer,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _display = BuildDisplay(RangeProjection.Empty);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / loaded / empty / error / stale / offline).</summary>
    public RangeProjectionState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public RangeProjectionDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (header chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed with no cached snapshot (drives the error banner).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the error banner.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>The localized page title (web <c>range.title</c>).</summary>
    public string Title => ProjectedRangePageRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>range.subtitle</c>).</summary>
    public string Subtitle => ProjectedRangePageRegistration.Subtitle(_localizer);

    /// <summary>True for the states where the hero cards / gauge / charts / sections are rendered.</summary>
    public bool HasContent =>
        _state is RangeProjectionState.Loaded or RangeProjectionState.Stale or RangeProjectionState.Offline;

    /// <summary>The what-if speed slider value in km/h (web <c>whatIfSpeed</c>); reassigning re-projects.</summary>
    public double WhatIfSpeedKmh
    {
        get => _whatIfSpeedKmh;
        set
        {
            if (_whatIfSpeedKmh.Equals(value))
            {
                return;
            }

            _whatIfSpeedKmh = value;
            Raise(nameof(WhatIfSpeedKmh));
            Reproject();
        }
    }

    /// <summary>The what-if temperature slider value in °C (web <c>whatIfTemp</c>); reassigning re-projects.</summary>
    public double WhatIfTempC
    {
        get => _whatIfTempC;
        set
        {
            if (_whatIfTempC.Equals(value))
            {
                return;
            }

            _whatIfTempC = value;
            Raise(nameof(WhatIfTempC));
            Reproject();
        }
    }

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
            Raise(nameof(Units));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: shows the skeleton only when nothing is already visible (otherwise
    /// keeps content while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        if (!HasContent)
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _source.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Refresh the current snapshot (web auto-refetch / manual refresh).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private void Apply(RepositoryResult<RangeProjection> result)
    {
        _last = result;
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent)
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        RangeProjection data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // Web parity: the full layout renders whenever `data` is present, even when individual sections are
        // sparse — each section's own empty body (no scenarios / no matrix / no what-if) covers a gap rather
        // than collapsing the whole page.
        Display = BuildDisplay(data);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? RangeProjectionState.Offline : stale ? RangeProjectionState.Stale : RangeProjectionState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last && last.HasValue)
        {
            Apply(last);
        }
        else
        {
            Display = BuildDisplay(RangeProjection.Empty);
        }
    }

    private RangeProjectionDisplay BuildDisplay(RangeProjection data) =>
        RangeProjectionProjection.Project(data, _whatIfSpeedKmh, _whatIfTempC, _units, _localizer);

    private void SetLoading()
    {
        IsFetching = true;
        IsError = false;
        ErrorMessage = null;
        State = RangeProjectionState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = BuildDisplay(RangeProjection.Empty);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = RangeProjectionState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = RangeProjectionState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "range.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "range.error.offline",
            _ => "error.loadFailed",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view your projected range",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached projection",
            _ => "Failed to load data",
        };

        return _localizer.GetString(key, fallback);
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
