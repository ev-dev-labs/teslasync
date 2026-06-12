using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Vehicles;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>VehicleTwin</c> view — the native port of the web
/// <c>VehicleTwin</c> component's resolved inputs (web/src/components/vehicles/VehicleTwin.tsx). It consumes the
/// cache-then-network <see cref="IVehicleTwinSource"/>, resolves the per-vehicle paint through the
/// <see cref="IVehiclePaintOverrideStore"/> (web <c>useVehiclePaint</c>), projects each reading through
/// <see cref="VehicleTwinProjection"/> at the active <see cref="Size"/>, and exposes the mutually-exclusive
/// <see cref="State"/> plus the freshness flags so the view is a thin renderer. A resolved reading always renders
/// the twin; the source collapses a missing vehicle to <see cref="VehicleTwinViewState.Empty"/> and a total read
/// failure to <see cref="VehicleTwinViewState.Error"/>. It re-projects when the paint override for the shown
/// vehicle changes (the web cross-instance paint sync). Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class VehicleTwinViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IVehicleTwinSource _source;
    private readonly IVehiclePaintOverrideStore _paintStore;
    private readonly ILocalizer _localizer;

    private VehicleTwinSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<VehicleTwinReading>? _last;
    private long _currentVehicleId;
    private bool _disposed;

    private VehicleTwinViewState _state = VehicleTwinViewState.Loading;
    private VehicleTwinDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, paint-override store, localizer and render scale.</summary>
    /// <param name="source">The cache-then-network twin source.</param>
    /// <param name="paintStore">The per-vehicle paint-override store (web <c>useVehiclePaint</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The render scale (web <c>size</c>; default <see cref="VehicleTwinSize.Medium"/>).</param>
    public VehicleTwinViewModel(
        IVehicleTwinSource source,
        IVehiclePaintOverrideStore paintStore,
        ILocalizer localizer,
        VehicleTwinSize size = VehicleTwinSize.Medium)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(paintStore);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _paintStore = paintStore;
        _localizer = localizer;
        _size = size;
        _paintStore.Changed += OnPaintOverrideChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>VehicleTwin</c>).</summary>
    public static string Slug => VehicleTwinRegistration.Slug;

    /// <summary>The per-vehicle paint-override store (exposed for hosting / a picker / tests).</summary>
    public IVehiclePaintOverrideStore PaintStore => _paintStore;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public VehicleTwinViewState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready twin (null until a reading resolves, or on the empty surface).</summary>
    public VehicleTwinDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasTwin));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the primary read failed (drives the error chip + freshness colour).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown twin is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error / offline message shown in the error or offline surface.</summary>
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

    /// <summary>True when a twin reading has resolved and the twin is renderable.</summary>
    public bool HasTwin => _display is not null;

    /// <summary>Localized loading announcement.</summary>
    public string LoadingMessage => _localizer.GetString(VehicleTwinRegistration.LoadingKey, VehicleTwinRegistration.LoadingFallback);

    /// <summary>Localized empty-state heading.</summary>
    public string EmptyTitle => _localizer.GetString(VehicleTwinRegistration.EmptyTitleKey, VehicleTwinRegistration.EmptyTitleFallback);

    /// <summary>Localized empty-state message.</summary>
    public string EmptyMessage => _localizer.GetString(VehicleTwinRegistration.EmptyMessageKey, VehicleTwinRegistration.EmptyMessageFallback);

    /// <summary>Localized retry affordance label.</summary>
    public string RetryText => _localizer.GetString(VehicleTwinRegistration.RetryKey, VehicleTwinRegistration.RetryFallback);

    /// <summary>Localized stale-data chip label.</summary>
    public string StaleLabel => _localizer.GetString(VehicleTwinRegistration.StaleKey, VehicleTwinRegistration.StaleFallback);

    /// <summary>Localized offline chip label.</summary>
    public string OfflineLabel => _localizer.GetString(VehicleTwinRegistration.OfflineKey, VehicleTwinRegistration.OfflineFallback);

    /// <summary>Localized refreshing chip label.</summary>
    public string RefreshingLabel => _localizer.GetString(VehicleTwinRegistration.RefreshingKey, VehicleTwinRegistration.RefreshingFallback);

    /// <summary>The render scale; reassigning re-projects the twin at the new size.</summary>
    public VehicleTwinSize Size
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

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already visible
    /// (otherwise keeps the twin while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels this load.</param>
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

    /// <summary>Retry after a failure (or refresh a stale twin) — re-runs the load from the top.</summary>
    public Task RetryAsync() => LoadAsync();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _paintStore.Changed -= OnPaintOverrideChanged;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private bool HasContent() =>
        _state is VehicleTwinViewState.Loaded or VehicleTwinViewState.Stale or VehicleTwinViewState.Offline;

    private void Apply(RepositoryResult<VehicleTwinReading> result)
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
        VehicleTwinReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        _currentVehicleId = reading.VehicleId ?? 0;
        PaintPaletteId? overrideId = _paintStore.GetOverride(_currentVehicleId);

        Display = VehicleTwinProjection.Project(reading, overrideId, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? VehicleTwinViewState.Offline
            : stale ? VehicleTwinViewState.Stale : VehicleTwinViewState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
    }

    private void OnPaintOverrideChanged(object? sender, VehiclePaintOverrideChange change)
    {
        if (change.VehicleId == _currentVehicleId)
        {
            Reproject();
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = VehicleTwinViewState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        _currentVehicleId = 0;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = VehicleTwinViewState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = VehicleTwinViewState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        (string key, string fallback) = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized =>
                (VehicleTwinRegistration.ErrorAuthKey, VehicleTwinRegistration.ErrorAuthFallback),
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network =>
                (VehicleTwinRegistration.ErrorOfflineKey, VehicleTwinRegistration.ErrorOfflineFallback),
            _ => (VehicleTwinRegistration.ErrorKey, VehicleTwinRegistration.ErrorFallback),
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
