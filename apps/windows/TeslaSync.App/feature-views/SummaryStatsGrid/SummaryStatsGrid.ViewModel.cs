using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SummaryStatsGrid"/> view — the native port of the
/// web Summary-stats grid (web/src/features/charging/components/charging-curve/SummaryStatsGrid.tsx). The web
/// component is a pure child of the Charging-Curve page; the native surface binds its own cache-then-network
/// <see cref="ISummaryStatsSource"/>, projects each snapshot through <see cref="SummaryStatsProjection"/> with
/// the active currency and decimal precision, and exposes the mutually-exclusive <see cref="State"/> plus the
/// freshness flags so the view is a thin renderer. The six summary cards always render (the web grid is never
/// hidden): the <see cref="SummaryStatsState.Loaded"/>, <see cref="SummaryStatsState.Stale"/>,
/// <see cref="SummaryStatsState.Offline"/> and <see cref="SummaryStatsState.Empty"/> states all carry a
/// populated <see cref="Display"/> (the cards fall back to zeroed values, the web <c>?? 0</c>). Drive it from
/// one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SummaryStatsGridViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISummaryStatsSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private string _currencySymbol;
    private int _decimalPrecision;
    private CancellationTokenSource? _cts;
    private RepositoryResult<ChargingSummary>? _last;
    private bool _disposed;

    private SummaryStatsState _state = SummaryStatsState.Loading;
    private SummaryStatsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, currency, precision and (optional) clock.</summary>
    public SummaryStatsGridViewModel(
        ISummaryStatsSource source,
        ILocalizer localizer,
        string? currencySymbol = null,
        int decimalPrecision = SummaryStatsProjection.DefaultPrecision,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        _decimalPrecision = decimalPrecision < 0 ? 0 : decimalPrecision;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = SummaryStatsProjection.Project(ChargingSummary.Empty, _currencySymbol, _decimalPrecision, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public SummaryStatsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the six cards + surface label).</summary>
    public SummaryStatsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
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

    /// <summary>True when the last load failed with no cache (drives the error surface + header chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when real charging sessions backed the figures (web <c>stats !== null</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized surface title.</summary>
    public string Title => SummaryStatsRegistration.Name(_localizer);

    /// <summary>The currency symbol used for the total-cost card; reassigning re-projects the current snapshot.</summary>
    public string CurrencySymbol
    {
        get => _currencySymbol;
        set
        {
            string resolved = string.IsNullOrWhiteSpace(value) ? "$" : value;
            if (_currencySymbol == resolved)
            {
                return;
            }

            _currencySymbol = resolved;
            Raise(nameof(CurrencySymbol));
            Reproject();
        }
    }

    /// <summary>The decimal precision used for the energy / rate / cost cards; reassigning re-projects.</summary>
    public int DecimalPrecision
    {
        get => _decimalPrecision;
        set
        {
            int resolved = value < 0 ? 0 : value;
            if (_decimalPrecision == resolved)
            {
                return;
            }

            _decimalPrecision = resolved;
            Raise(nameof(DecimalPrecision));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the card skeletons only when nothing is
    /// already visible (otherwise keeps content while refreshing), and folds every emission into
    /// <see cref="State"/> + <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasContent())
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

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
    public Task RetryAsync() => LoadAsync();

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
        GC.SuppressFinalize(this);
    }

    private bool HasContent() =>
        _state is SummaryStatsState.Loaded
            or SummaryStatsState.Stale
            or SummaryStatsState.Offline
            or SummaryStatsState.Empty;

    private void Apply(RepositoryResult<ChargingSummary> result)
    {
        _last = result;
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent())
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
        ChargingSummary data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = SummaryStatsProjection.Project(data, _currencySymbol, _decimalPrecision, _localizer);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // The six cards always render; freshness wins over emptiness so the stale/offline chip survives an
        // empty snapshot, while a fresh empty snapshot is classified Empty (the cards render zeroed, web parity).
        State = offline
            ? SummaryStatsState.Offline
            : stale
                ? SummaryStatsState.Stale
                : data.HasData
                    ? SummaryStatsState.Loaded
                    : SummaryStatsState.Empty;
    }

    private void Reproject()
    {
        if (_last is { } last && last.HasValue)
        {
            Apply(last);
        }
        else
        {
            Display = SummaryStatsProjection.Project(ChargingSummary.Empty, _currencySymbol, _decimalPrecision, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = SummaryStatsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = SummaryStatsProjection.Project(ChargingSummary.Empty, _currencySymbol, _decimalPrecision, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = SummaryStatsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = SummaryStatsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "charging.curve.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "charging.curve.error.offline",
            _ => "charging.curve.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view charging stats",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached charging stats",
            _ => "Couldn't load charging stats",
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
