using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>TrueCostPage</c> view — the native port of the web
/// page's data flow (web/src/features/analytics/pages/TrueCostPage.tsx). It consumes the cache-then-network
/// <see cref="ITrueCostBreakdownSource"/> (the native <c>useCostBreakdown</c> hook), projects each snapshot
/// through <see cref="TrueCostProjection"/> with the active units, currency and fuel-volume preference, and
/// exposes the mutually-exclusive <see cref="State"/> plus the header freshness flags so the view is a thin
/// renderer. Unlike the dashboard widget, a populated-but-charging-empty snapshot still renders the success
/// layout (the per-chart empty body covers a missing breakdown); only a genuinely empty response collapses
/// to <see cref="TrueCostState.Empty"/>. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class TrueCostPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITrueCostBreakdownSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly TrueCostDiagnostics _diagnostics;

    private UnitPref _units;
    private string _currencySymbol;
    private int _currencyPrecision;
    private GasUnit _gasUnit;
    private CancellationTokenSource? _cts;
    private RepositoryResult<TrueCostBreakdown>? _last;
    private bool _disposed;

    private TrueCostState _state = TrueCostState.Loading;
    private TrueCostDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;

    /// <summary>Creates the holder over its data source, localizer, units, currency and fuel-volume preference.</summary>
    /// <param name="source">The cache-then-network TCO data port (native <c>useCostBreakdown</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit-display preference (defaults to metric).</param>
    /// <param name="currencySymbol">The account currency symbol (defaults to "$").</param>
    /// <param name="currencyPrecision">Currency fraction digits (defaults to 2).</param>
    /// <param name="gasUnit">The user's fuel-volume preference (defaults to gallon, web default).</param>
    /// <param name="clock">Injectable clock for deterministic freshness in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TrueCostPageViewModel(
        ITrueCostBreakdownSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        string? currencySymbol = null,
        int currencyPrecision = TrueCostProjection.DefaultPrecision,
        GasUnit gasUnit = GasUnit.Gallon,
        Func<DateTimeOffset>? clock = null,
        TrueCostDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        _currencyPrecision = currencyPrecision < 0 ? 0 : currencyPrecision;
        _gasUnit = gasUnit;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new TrueCostDiagnostics();
        _display = BuildDisplay(TrueCostBreakdown.Empty);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / loaded / empty / error / stale / offline).</summary>
    public TrueCostState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public TrueCostDisplay Display
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

    /// <summary>True when the shown snapshot is older than the freshness window (web 6h cagg staleness).</summary>
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

    /// <summary>The localized page title (web <c>tco.title</c>).</summary>
    public string Title => TrueCostRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>tco.subtitle</c>).</summary>
    public string Subtitle => TrueCostRegistration.Subtitle(_localizer);

    /// <summary>True for the states where the hero cards / charts / breakdown are rendered.</summary>
    public bool HasContent =>
        _state is TrueCostState.Loaded or TrueCostState.Stale or TrueCostState.Offline;

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

    /// <summary>The currency symbol; reassigning re-projects the formatted costs.</summary>
    public string CurrencySymbol
    {
        get => _currencySymbol;
        set
        {
            string resolved = string.IsNullOrWhiteSpace(value) ? "$" : value;
            if (string.Equals(_currencySymbol, resolved, StringComparison.Ordinal))
            {
                return;
            }

            _currencySymbol = resolved;
            Reproject();
        }
    }

    /// <summary>The user's fuel-volume preference; reassigning re-projects the gas-price line.</summary>
    public GasUnit GasUnit
    {
        get => _gasUnit;
        set
        {
            if (_gasUnit == value)
            {
                return;
            }

            _gasUnit = value;
            Reproject();
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

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

    private void Apply(RepositoryResult<TrueCostBreakdown> result)
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
        TrueCostBreakdown data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // Web parity: the full layout renders whenever `tco` is present, even with no monthly rows — the
        // per-chart empty body covers a missing breakdown rather than collapsing the whole page.
        Display = BuildDisplay(data);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? TrueCostState.Offline : stale ? TrueCostState.Stale : TrueCostState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last && last.HasValue)
        {
            Apply(last);
        }
        else
        {
            Display = BuildDisplay(TrueCostBreakdown.Empty);
        }
    }

    private TrueCostDisplay BuildDisplay(TrueCostBreakdown data) =>
        TrueCostProjection.Project(data, _units, _currencySymbol, _currencyPrecision, _gasUnit, _localizer);

    private void SetLoading()
    {
        IsFetching = true;
        IsError = false;
        ErrorMessage = null;
        State = TrueCostState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = BuildDisplay(TrueCostBreakdown.Empty);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = TrueCostState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = TrueCostState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "tco.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "tco.error.offline",
            _ => "error.loadFailed",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view your cost analysis",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached cost analysis",
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
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
