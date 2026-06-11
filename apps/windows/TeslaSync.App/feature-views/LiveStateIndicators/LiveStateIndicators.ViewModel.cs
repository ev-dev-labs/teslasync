using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="LiveStateIndicators"/> view — the native port of the
/// web <c>LiveStateIndicators</c> child plus its parent's <c>useVehicleState</c> query lifecycle
/// (web/src/features/vehicles/components/vehicle-detail/LiveStateIndicators.tsx +
/// web/src/features/vehicles/pages/VehicleDetailPage.tsx). It consumes the cache-then-network
/// <see cref="ILiveStateIndicatorsSource"/>, projects each vehicle-state reading through
/// <see cref="LiveStateIndicatorsProjection"/> in the user's units into five render-ready chips, and exposes the
/// mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin renderer. A reading
/// always renders the five chips (the web component always emits all five badges). Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class LiveStateIndicatorsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILiveStateIndicatorsSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private UnitPref _units;
    private LiveStateIndicatorsReading? _lastReading;
    private LiveStateIndicatorsState _state = LiveStateIndicatorsState.Loading;
    private LiveStateIndicatorsDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and unit preference.</summary>
    /// <param name="source">The cache-then-network vehicle-state source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public LiveStateIndicatorsViewModel(ILiveStateIndicatorsSource source, ILocalizer localizer, UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The user's unit preference; reassigning re-projects the chips in the new units.</summary>
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
            if (_lastReading is { } reading)
            {
                Display = LiveStateIndicatorsProjection.Project(reading, _units, _localizer);
            }
        }
    }

    /// <summary>The current mutually-exclusive surface state.</summary>
    public LiveStateIndicatorsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready model (null until a reading resolves, or on the empty surface).</summary>
    public LiveStateIndicatorsDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
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

    /// <summary>True when the last load failed (drives the error / offline surface + freshness chip).</summary>
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

    /// <summary>True when a reading has resolved and the chips are renderable.</summary>
    public bool HasData => _display is not null;

    /// <summary>Localized accessible group name (web has no title; native uses it for the chip-row group name).</summary>
    public string Title => LiveStateIndicatorsRegistration.Name(_localizer);

    /// <summary>Localized empty-state message.</summary>
    public string EmptyMessage => LiveStateIndicatorsRegistration.EmptyMessage(_localizer);

    /// <summary>Localized loading affordance label.</summary>
    public string LoadingMessage => LiveStateIndicatorsRegistration.LoadingMessage(_localizer);

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps the chips while refreshing), and folds every emission into <see cref="State"/>
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
        _state is LiveStateIndicatorsState.Loaded or LiveStateIndicatorsState.Stale or LiveStateIndicatorsState.Offline;

    private void Apply(RepositoryResult<LiveStateIndicatorsReading> result)
    {
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
                ApplyReading(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyReading(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyReading(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyReading(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyReading(
        LiveStateIndicatorsReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        _lastReading = reading;
        Display = LiveStateIndicatorsProjection.Project(reading, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? OfflineText() : null;
        State = offline
            ? LiveStateIndicatorsState.Offline
            : stale ? LiveStateIndicatorsState.Stale : LiveStateIndicatorsState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = LiveStateIndicatorsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _lastReading = null;
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = LiveStateIndicatorsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        _lastReading = null;
        Display = null;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = LiveStateIndicatorsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error) => error?.Kind switch
    {
        RepositoryErrorKind.Offline or RepositoryErrorKind.Network => OfflineText(),
        _ => LiveStateIndicatorsRegistration.ErrorMessage(_localizer),
    };

    private string OfflineText() => _localizer.GetString("common.offline", "Offline");

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
