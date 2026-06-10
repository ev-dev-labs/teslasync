using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="GForcePanel"/> view — the native port of the web
/// Acceleration-G-Force panel
/// (web/src/features/driving/components/driving-dynamics/GForcePanel.tsx). The web component is a thin reader
/// of the <c>useDriveDynamicsLatest</c> snapshot; the native surface binds its own cache-then-network
/// <see cref="IGForcePanelSource"/>, projects each snapshot through <see cref="GForcePanelProjection"/>, and
/// exposes the mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin renderer.
/// The three G-force tiles always render for the <see cref="GForcePanelState.Loaded"/>,
/// <see cref="GForcePanelState.Stale"/> and <see cref="GForcePanelState.Offline"/> states; a friendly empty
/// state covers <see cref="GForcePanelState.Empty"/> (web parity — no acceleration axis has reported). Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class GForcePanelViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IGForcePanelSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private GForcePanelState _state = GForcePanelState.Loading;
    private GForcePanelDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock.</summary>
    public GForcePanelViewModel(
        IGForcePanelSource source,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = GForcePanelDisplay.Empty(_localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public GForcePanelState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the three G-force tiles + title).</summary>
    public GForcePanelDisplay Display
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

    /// <summary>True when the projection produced at least one acceleration tile (web <c>hasAny</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized surface title.</summary>
    public string Title => GForcePanelRegistration.Name(_localizer);

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
        _state is GForcePanelState.Loaded
            or GForcePanelState.Stale
            or GForcePanelState.Offline
            or GForcePanelState.Empty;

    private void Apply(RepositoryResult<GForcePanelSnapshot> result)
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
        GForcePanelSnapshot data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = GForcePanelProjection.Project(data, _localizer);
        Display = display;

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // Freshness wins over emptiness so the stale/offline chip survives an empty snapshot, while a fresh
        // snapshot with no acceleration axis is classified Empty (web parity — the friendly empty state).
        State = offline
            ? GForcePanelState.Offline
            : stale
                ? GForcePanelState.Stale
                : display.HasData
                    ? GForcePanelState.Loaded
                    : GForcePanelState.Empty;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = GForcePanelState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = GForcePanelDisplay.Empty(_localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = GForcePanelState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = GForcePanelState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        return error?.Kind switch
        {
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => _localizer.GetString(
                "dynamics.gForceOffline",
                "You're offline — showing the last cached G-force reading"),
            _ => _localizer.GetString(
                "dynamics.gForceError", "Couldn't load G-force telemetry"),
        };
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
