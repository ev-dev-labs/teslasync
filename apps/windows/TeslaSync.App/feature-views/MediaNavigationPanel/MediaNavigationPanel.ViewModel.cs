using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="MediaNavigationPanel"/> view — the native port of the
/// web Media &amp; Navigation panel
/// (web/src/features/vehicles/components/telemetry-panels/MediaNavigationPanel.tsx). The web component is a pure
/// child of the live-telemetry grid (it takes pre-resolved <c>mediaData</c> + <c>locationData</c> props); the
/// native surface binds its own cache-then-network <see cref="IMediaNavigationPanelSource"/>, projects each merged
/// snapshot through <see cref="MediaNavigationPanelProjection"/> in the user's units, and exposes the
/// mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin renderer. The Now-Playing
/// and Navigation sections always render for the <see cref="MediaNavigationPanelState.Loaded"/>,
/// <see cref="MediaNavigationPanelState.Stale"/> and <see cref="MediaNavigationPanelState.Offline"/> states (each
/// section showing its own "No … data" caption when its reading is null, web parity); a friendly empty surface
/// covers <see cref="MediaNavigationPanelState.Empty"/> (no media object and no location object). Drive it from
/// one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class MediaNavigationPanelViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IMediaNavigationPanelSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private MediaNavigationSnapshot? _lastSnapshot;
    private bool _disposed;

    private UnitPref _units;
    private MediaNavigationPanelState _state = MediaNavigationPanelState.Loading;
    private MediaNavigationPanelDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) unit preference.</summary>
    /// <param name="source">The cache-then-network media-and-navigation source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public MediaNavigationPanelViewModel(
        IMediaNavigationPanelSource source,
        ILocalizer localizer,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _display = MediaNavigationPanelDisplay.Empty(_localizer, _units);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public MediaNavigationPanelState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the Now-Playing card + the Navigation section).</summary>
    public MediaNavigationPanelDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects the distance in the new units.</summary>
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
            if (_lastSnapshot is { } snapshot)
            {
                Display = MediaNavigationPanelProjection.Project(snapshot, _units, _localizer);
            }
            else
            {
                Display = MediaNavigationPanelDisplay.Empty(_localizer, _units);
            }
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

    /// <summary>True when the snapshot has a media object or a location object (web parity).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized surface title (web "Media &amp; Navigation").</summary>
    public string Title => MediaNavigationPanelRegistration.Name(_localizer);

    /// <summary>Localized accessible surface summary (web <c>ariaLabel</c>).</summary>
    public string AriaLabel => _display.AriaLabel;

    /// <summary>Localized empty-surface message (web friendly empty state).</summary>
    public string EmptyMessage => _display.EmptyMessage;

    /// <summary>Localized loading announcement for the skeleton live region.</summary>
    public string LoadingLabel => _localizer.GetString("common.loading", "Loading...");

    /// <summary>Localized retry-button label.</summary>
    public string RetryLabel => _localizer.GetString("common.retry", "Retry");

    /// <summary>Localized error-surface title.</summary>
    public string ErrorTitle =>
        _localizer.GetString("telemetry.mediaNav.errorTitle", "Couldn't load media & navigation");

    /// <summary>Localized refresh-button Narrator label.</summary>
    public string RefreshLabel =>
        _localizer.GetString("telemetry.mediaNav.refresh", "Refresh media and navigation");

    /// <summary>Localized stale freshness-chip label.</summary>
    public string StaleChip => _localizer.GetString("common.stale", "Stale");

    /// <summary>Localized offline freshness-chip label.</summary>
    public string OfflineChip => _localizer.GetString("common.offline", "Offline");

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
        _state is MediaNavigationPanelState.Loaded
            or MediaNavigationPanelState.Stale
            or MediaNavigationPanelState.Offline
            or MediaNavigationPanelState.Empty;

    private void Apply(RepositoryResult<MediaNavigationSnapshot> result)
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
        MediaNavigationSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = MediaNavigationPanelProjection.Project(snapshot, _units, _localizer);

        // Web parity: when there is neither a media object nor a location object there is nothing to render —
        // show the friendly empty surface regardless of freshness.
        if (!display.HasData)
        {
            SetEmpty(fetchedAt);
            return;
        }

        _lastSnapshot = snapshot;
        Display = display;
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? MediaNavigationPanelState.Offline
            : stale ? MediaNavigationPanelState.Stale : MediaNavigationPanelState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = MediaNavigationPanelState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _lastSnapshot = null;
        Display = MediaNavigationPanelDisplay.Empty(_localizer, _units);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = MediaNavigationPanelState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = MediaNavigationPanelState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        return error?.Kind switch
        {
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => _localizer.GetString(
                "telemetry.mediaNav.offline",
                "You're offline — showing the last cached media & navigation"),
            _ => _localizer.GetString("telemetry.mediaNav.error", "Couldn't load media & navigation"),
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
