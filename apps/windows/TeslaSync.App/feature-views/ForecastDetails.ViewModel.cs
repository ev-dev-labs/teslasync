using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ForecastDetails"/> view — the native port of the
/// web component's data composition (web/src/features/charging/components/cost-analysis/ForecastDetails.tsx,
/// which receives a resolved <c>CostForecastData</c> as a prop and reads <c>useTranslation</c> +
/// <c>useFormatting</c>). It consumes the cache-then-network <see cref="IForecastDetailsSource"/>, projects
/// each snapshot through <see cref="ForecastDetailsProjection"/> with the active currency symbol, and exposes
/// the mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin renderer. Drive
/// it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ForecastDetailsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IForecastDetailsSource _source;
    private readonly ILocalizer _localizer;

    private string _currencySymbol;
    private CancellationTokenSource? _cts;
    private RepositoryResult<CostForecastSnapshot>? _last;
    private bool _disposed;

    private ForecastDetailsState _state = ForecastDetailsState.Loading;
    private ForecastDetailsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) currency symbol.</summary>
    public ForecastDetailsViewModel(
        IForecastDetailsSource source,
        ILocalizer localizer,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _currencySymbol = string.IsNullOrEmpty(currencySymbol) ? ForecastDetailsProjection.DefaultCurrencySymbol : currencySymbol;
        _display = ForecastDetailsProjection.Project(CostForecastSnapshot.Empty, _localizer, _currencySymbol);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public ForecastDetailsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (breakdown, savings, insights).</summary>
    public ForecastDetailsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the error surface + freshness chip).</summary>
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

    /// <summary>Localized error message shown in the error / offline surface.</summary>
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

    /// <summary>True when a forecast payload is shown (loaded / stale / offline content states).</summary>
    public bool HasData =>
        _state is ForecastDetailsState.Loaded or ForecastDetailsState.Stale or ForecastDetailsState.Offline;

    /// <summary>Localized surface title (used as the accessible name; the web panels are individually headed).</summary>
    public string Title => _localizer.GetString("costAnalysis.forecast.detailsTitle", "Cost Forecast Details");

    /// <summary>Localized loading announcement.</summary>
    public string LoadingLabel => _localizer.GetString("costAnalysis.forecast.loading", "Loading cost forecast...");

    /// <summary>Localized retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString("common.retry", "Retry");

    /// <summary>Localized error-surface title.</summary>
    public string ErrorTitle => _localizer.GetString("costAnalysis.forecast.errorTitle", "Couldn't load cost forecast");

    /// <summary>The currency symbol used for the monetary figures; reassigning re-projects the current snapshot.</summary>
    public string CurrencySymbol
    {
        get => _currencySymbol;
        set
        {
            string symbol = string.IsNullOrEmpty(value) ? ForecastDetailsProjection.DefaultCurrencySymbol : value;
            if (string.Equals(_currencySymbol, symbol, StringComparison.Ordinal))
            {
                return;
            }

            _currencySymbol = symbol;
            Raise(nameof(CurrencySymbol));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Display"/>. A superseding load cancels the prior one.
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
        _state is ForecastDetailsState.Loaded or ForecastDetailsState.Stale or ForecastDetailsState.Offline;

    private void Apply(RepositoryResult<CostForecastSnapshot> result)
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
        CostForecastSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = ForecastDetailsProjection.Project(snapshot, _localizer, _currencySymbol);

        if (!snapshot.HasData)
        {
            SetEmpty(fetchedAt, keepDisplay: true);
            return;
        }

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? ForecastDetailsState.Offline
            : stale ? ForecastDetailsState.Stale : ForecastDetailsState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = ForecastDetailsProjection.Project(CostForecastSnapshot.Empty, _localizer, _currencySymbol);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = ForecastDetailsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt, bool keepDisplay = false)
    {
        if (!keepDisplay)
        {
            Display = ForecastDetailsProjection.Project(CostForecastSnapshot.Empty, _localizer, _currencySymbol);
        }

        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = ForecastDetailsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = ForecastDetailsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "costAnalysis.forecast.errorAuth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "costAnalysis.forecast.errorOffline",
            _ => "costAnalysis.forecast.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view your cost forecast",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline \u2014 showing your last cached cost forecast",
            _ => "Couldn't load cost forecast",
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
