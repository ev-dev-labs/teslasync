using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SecuritySection"/> view — the native port of the web
/// vehicle-detail Security section (web/src/features/vehicles/components/vehicle-detail/SecuritySection.tsx). The
/// web component is a pure child of the Vehicle-Detail page (it takes a pre-resolved <c>securityData</c> +
/// <c>state</c>); the native surface binds its own cache-then-network <see cref="ISecuritySectionSource"/>,
/// projects each merged snapshot through <see cref="SecuritySectionProjection"/>, and exposes the
/// mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin renderer. The
/// four-metric grid renders for the <see cref="SecuritySectionState.Loaded"/>,
/// <see cref="SecuritySectionState.Stale"/> and <see cref="SecuritySectionState.Offline"/> states (with the
/// stale / offline chip for the latter two); a friendly empty state covers
/// <see cref="SecuritySectionState.Empty"/> (no security event — the web <c>securityData ?</c> false branch).
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SecuritySectionViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISecuritySectionSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private SecuritySectionState _state = SecuritySectionState.Loading;
    private SecuritySectionDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source and localizer.</summary>
    /// <param name="source">The cache-then-network security source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public SecuritySectionViewModel(ISecuritySectionSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _display = SecuritySectionDisplay.Empty(_localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public SecuritySectionState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the four metric cards or the empty message).</summary>
    public SecuritySectionDisplay Display
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

    /// <summary>True when a security event backs the shown grid (web <c>securityData ?</c> gate).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized surface title (web "Security").</summary>
    public string Title => SecuritySectionRegistration.Name(_localizer);

    /// <summary>Localized accessible surface name.</summary>
    public string AutomationName => _display.AutomationName;

    /// <summary>Localized empty-state message (web "No security data available").</summary>
    public string EmptyMessage => _display.EmptyMessage;

    /// <summary>Localized loading announcement for the skeleton live region.</summary>
    public string LoadingLabel => _localizer.GetString("translation.common.loading", "Loading...");

    /// <summary>Localized retry-button label.</summary>
    public string RetryLabel => _localizer.GetString("translation.common.retry", "Retry");

    /// <summary>Localized refresh-button Narrator label.</summary>
    public string RefreshLabel => _localizer.GetString("translation.common.refresh", "Refresh");

    /// <summary>Localized error-surface title.</summary>
    public string ErrorTitle =>
        _localizer.GetString("translation.vehicles.detail.section.securityFailed", "Security section failed to load");

    /// <summary>Localized stale freshness-chip label.</summary>
    public string StaleChip => _localizer.GetString("translation.common.stale", "Stale");

    /// <summary>Localized offline freshness-chip label.</summary>
    public string OfflineChip => _localizer.GetString("translation.common.offline", "Offline");

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels (supersedes) this load.</param>
    /// <returns>A task that completes when the emission sequence is drained.</returns>
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
    /// <returns>A task that completes when the retry's emission sequence is drained.</returns>
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
        _state is SecuritySectionState.Loaded
            or SecuritySectionState.Stale
            or SecuritySectionState.Offline
            or SecuritySectionState.Empty;

    private void Apply(RepositoryResult<SecuritySectionSnapshot> result)
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
        SecuritySectionSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = SecuritySectionProjection.Project(snapshot, _localizer);

        // Web parity: with no security event there is nothing to render — show the friendly empty state
        // regardless of freshness (web `securityData ? grid : <EmptyState />`).
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
            ? SecuritySectionState.Offline
            : stale ? SecuritySectionState.Stale : SecuritySectionState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = SecuritySectionState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = SecuritySectionDisplay.Empty(_localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = SecuritySectionState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = SecuritySectionState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        return error?.Kind switch
        {
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => _localizer.GetString(
                "translation.common.offline",
                "Offline"),
            _ => _localizer.GetString(
                "translation.vehicles.detail.section.securityFailed",
                "Security section failed to load"),
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
