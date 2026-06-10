using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="LiveMotorStatus"/> view — the native port of the web
/// <c>LiveMotorStatus</c> child plus its parent's query lifecycle
/// (web/src/features/driving/components/drivetrain-health/LiveMotorStatus.tsx +
/// web/src/features/driving/pages/DrivetrainHealthPage.tsx). It consumes the cache-then-network
/// <see cref="ILiveMotorStatusSource"/>, projects each motor reading through <see cref="LiveMotorStatusProjection"/>
/// with the active units and the live HV-isolation scalar, and exposes the mutually-exclusive <see cref="State"/>
/// plus the freshness flags so the view is a thin renderer. A reading always renders the chips / metrics (web
/// <c>hasData</c>); the source collapses a motor-less response to <see cref="LiveMotorStatusState.Empty"/>. The
/// HV-isolation value is a settable input (web optional <c>isolationResistance</c> prop, fed by the page's live
/// SSE state); reassigning it re-projects the HV-Isolation metric. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class LiveMotorStatusViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILiveMotorStatusSource _source;
    private readonly ILocalizer _localizer;

    private UnitPref _units;
    private double? _isolationResistanceKohm;
    private CancellationTokenSource? _cts;
    private RepositoryResult<MotorLiveReading>? _last;
    private bool _disposed;

    private LiveMotorStatusState _state = LiveMotorStatusState.Loading;
    private LiveMotorStatusDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, unit preference and initial HV isolation.</summary>
    /// <param name="source">The cache-then-network motor source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="isolationResistanceKohm">Initial HV-isolation resistance (kΩ) from the live state; null when unknown.</param>
    public LiveMotorStatusViewModel(
        ILiveMotorStatusSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        double? isolationResistanceKohm = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _isolationResistanceKohm = isolationResistanceKohm;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public LiveMotorStatusState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready model (null until a reading resolves, or on the empty surface).</summary>
    public LiveMotorStatusDisplay? Display
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

    /// <summary>True when a motor reading has resolved and the chips / metrics are renderable (web <c>hasData</c>).</summary>
    public bool HasData => _display is not null;

    /// <summary>Localized surface title (web <c>drivetrain.liveMotor</c> "Live Motor Status").</summary>
    public string Title => LiveMotorStatusRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>drivetrain.noLiveMotor</c> "No live motor telemetry yet").</summary>
    public string EmptyMessage => LiveMotorStatusRegistration.EmptyMessage(_localizer);

    /// <summary>The user's unit preference; reassigning re-projects the temperatures in the new unit.</summary>
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
    /// The live HV-isolation resistance in kΩ (web optional <c>isolationResistance</c> prop, fed by the page's
    /// live SSE state). Reassigning re-projects the HV-Isolation metric (value + threshold colour).
    /// </summary>
    public double? IsolationResistanceKohm
    {
        get => _isolationResistanceKohm;
        set
        {
            if (Nullable.Equals(_isolationResistanceKohm, value))
            {
                return;
            }

            _isolationResistanceKohm = value;
            Raise(nameof(IsolationResistanceKohm));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps the readouts while refreshing), and folds every emission into <see cref="State"/>
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
        _state is LiveMotorStatusState.Loaded or LiveMotorStatusState.Stale or LiveMotorStatusState.Offline;

    private void Apply(RepositoryResult<MotorLiveReading> result)
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
        MotorLiveReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = LiveMotorStatusProjection.Project(reading, _isolationResistanceKohm, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? LiveMotorStatusState.Offline
            : stale ? LiveMotorStatusState.Stale : LiveMotorStatusState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = LiveMotorStatusState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = LiveMotorStatusState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Display = null;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = LiveMotorStatusState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "drivetrain.liveMotor.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "drivetrain.liveMotor.error.offline",
            _ => "drivetrain.liveMotor.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view motor telemetry",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached motor telemetry",
            _ => "Couldn't load motor telemetry",
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
