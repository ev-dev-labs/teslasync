using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="CostBreakdownWidget"/> view — the native
/// port of the web <c>CostBreakdownWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/CostBreakdownWidget.tsx). It consumes the cache-then-network
/// <see cref="ICostBreakdownSource"/>, projects each snapshot through <see cref="CostBreakdownProjection"/>
/// with the active units and currency, and exposes the mutually-exclusive <see cref="State"/> plus the
/// header freshness flags so the view is a thin renderer. A snapshot with no monthly breakdown renders
/// the empty state (web <c>hasData</c> gate). Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class CostBreakdownViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ICostBreakdownSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CostBreakdownSize _size;
    private UnitPref _units;
    private string _currencySymbol;
    private int _currencyPrecision;
    private CancellationTokenSource? _cts;
    private RepositoryResult<CostBreakdown>? _last;
    private bool _disposed;

    private CostBreakdownState _state = CostBreakdownState.Loading;
    private CostBreakdownDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint, units, currency and clock.</summary>
    public CostBreakdownViewModel(
        ICostBreakdownSource source,
        ILocalizer localizer,
        CostBreakdownSize size,
        UnitPref? units = null,
        string? currencySymbol = null,
        int currencyPrecision = CostBreakdownProjection.DefaultPrecision,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _units = units ?? UnitPref.Metric;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        _currencyPrecision = currencyPrecision < 0 ? 0 : currencyPrecision;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = BuildDisplay(CostBreakdown.Empty);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public CostBreakdownState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (compact number, donut, ranked list, stats).</summary>
    public CostBreakdownDisplay Display
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

    /// <summary>True when the last load failed (drives the error surface + header chip).</summary>
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

    /// <summary>Localized error message shown in the error surface.</summary>
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

    /// <summary>True when the snapshot has monthly breakdown rows to render (web <c>hasData</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized widget title (web <c>widget.costBreakdown.title</c>).</summary>
    public string Title => CostBreakdownRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.costBreakdown.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.costBreakdown.noData", "No cost data");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public CostBreakdownSize Size
    {
        get => _size;
        set
        {
            if (_size == value)
            {
                return;
            }

            _size = value;
            Raise(nameof(Size));
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
            Raise(nameof(CurrencySymbol));
            Reproject();
        }
    }

    /// <summary>The currency fraction digits; reassigning re-projects the formatted costs.</summary>
    public int CurrencyPrecision
    {
        get => _currencyPrecision;
        set
        {
            int resolved = value < 0 ? 0 : value;
            if (_currencyPrecision == resolved)
            {
                return;
            }

            _currencyPrecision = resolved;
            Raise(nameof(CurrencyPrecision));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into
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
        _state is CostBreakdownState.Loaded or CostBreakdownState.Stale or CostBreakdownState.Offline;

    private void Apply(RepositoryResult<CostBreakdown> result)
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
        CostBreakdown data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = BuildDisplay(data);
        Display = display;

        if (!display.HasData)
        {
            SetEmpty(fetchedAt, keepDisplay: true);
            return;
        }

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? CostBreakdownState.Offline : stale ? CostBreakdownState.Stale : CostBreakdownState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = BuildDisplay(CostBreakdown.Empty);
        }
    }

    private CostBreakdownDisplay BuildDisplay(CostBreakdown data) =>
        CostBreakdownProjection.Project(data, _size, _units, _currencySymbol, _currencyPrecision, _localizer);

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = CostBreakdownState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt, bool keepDisplay = false)
    {
        if (!keepDisplay)
        {
            Display = BuildDisplay(CostBreakdown.Empty);
        }

        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = CostBreakdownState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = CostBreakdownState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.costBreakdown.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.costBreakdown.error.offline",
            _ => "widget.costBreakdown.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view cost breakdown",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached cost breakdown",
            _ => "Couldn't load cost breakdown",
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
