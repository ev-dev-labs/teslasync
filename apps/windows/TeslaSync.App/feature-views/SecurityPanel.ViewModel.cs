using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SecurityPanel"/> view — the native port of the web
/// Security panel (web/src/features/vehicles/components/telemetry-panels/SecurityPanel.tsx). The web component is
/// a pure child of the Live-Telemetry grid (it takes pre-resolved <c>securityData</c> + <c>remoteStartEnabled</c>
/// props); the native surface binds its own cache-then-network <see cref="ISecurityPanelSource"/>, projects each
/// merged snapshot through <see cref="SecurityPanelProjection"/>, and exposes the mutually-exclusive
/// <see cref="State"/> plus the freshness flags so the view is a thin renderer. The lock tile + rows render for
/// the <see cref="SecurityPanelState.Loaded"/>, <see cref="SecurityPanelState.Stale"/> and
/// <see cref="SecurityPanelState.Offline"/> states (with the stale / offline chip for the latter two), a friendly
/// empty state covers <see cref="SecurityPanelState.Empty"/> (no security event and no remote-start flag). Drive
/// it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SecurityPanelViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISecurityPanelSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private SecurityPanelState _state = SecurityPanelState.Loading;
    private SecurityPanelDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source and localizer.</summary>
    /// <param name="source">The cache-then-network security source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public SecurityPanelViewModel(ISecurityPanelSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _display = SecurityPanelDisplay.Empty(_localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public SecurityPanelState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (lock tile + rows + remote-start row).</summary>
    public SecurityPanelDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
            Raise(nameof(HasSecurity));
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

    /// <summary>True when the snapshot carries a security event or a remote-start flag (web <c>hasData</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>True when a security event is present (web <c>securityData &amp;&amp;</c> gate).</summary>
    public bool HasSecurity => _display.HasSecurity;

    /// <summary>Localized surface title (web "Security").</summary>
    public string Title => SecurityPanelRegistration.Name(_localizer);

    /// <summary>Localized accessible surface summary.</summary>
    public string AriaLabel => _display.AriaLabel;

    /// <summary>Localized empty-state message (web friendly empty state).</summary>
    public string EmptyMessage => _display.EmptyMessage;

    /// <summary>Localized loading announcement for the skeleton live region.</summary>
    public string LoadingLabel => _localizer.GetString("common.loading", "Loading...");

    /// <summary>Localized retry-button label.</summary>
    public string RetryLabel => _localizer.GetString("common.retry", "Retry");

    /// <summary>Localized error-surface title.</summary>
    public string ErrorTitle =>
        _localizer.GetString("security.panel.errorTitle", "Couldn't load security status");

    /// <summary>Localized refresh-button Narrator label.</summary>
    public string RefreshLabel =>
        _localizer.GetString("security.panel.refresh", "Refresh security status");

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
        _state is SecurityPanelState.Loaded
            or SecurityPanelState.Stale
            or SecurityPanelState.Offline
            or SecurityPanelState.Empty;

    private void Apply(RepositoryResult<SecurityPanelSnapshot> result)
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
        SecurityPanelSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = SecurityPanelProjection.Project(snapshot, _localizer);

        // Web parity: when there is neither a security event nor a remote-start flag there is nothing to render —
        // show the friendly empty state regardless of freshness.
        if (!display.HasData)
        {
            SetEmpty(fetchedAt);
            return;
        }

        Display = display;
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? SecurityPanelState.Offline
            : stale ? SecurityPanelState.Stale : SecurityPanelState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = SecurityPanelState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = SecurityPanelDisplay.Empty(_localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = SecurityPanelState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = SecurityPanelState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        return error?.Kind switch
        {
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => _localizer.GetString(
                "security.panel.offline",
                "You're offline — showing the last cached security status"),
            _ => _localizer.GetString("security.panel.error", "Couldn't load security status"),
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
