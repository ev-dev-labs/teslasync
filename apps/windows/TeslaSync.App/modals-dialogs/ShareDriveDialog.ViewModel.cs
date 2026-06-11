using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>A localized transient message for the toast surface (web <c>useSharing</c> success / error toasts).</summary>
public sealed record ShareDriveToast(string Message, bool IsError);

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ShareDriveDialog"/> view — the native port of the web
/// <c>ShareDriveDialog</c>'s hook composition + local state
/// (web/src/features/driving/components/ShareDriveDialog.tsx). It owns the create-form fields (title / include-speed
/// / include-telemetry / expiry — the web <c>useState</c> values), the created-link result that swaps the body from
/// the form to the success view (web <c>shareUrl</c>), the create + revoke mutations (web <c>useCreateShareLink</c> /
/// <c>useRevokeShareLink</c>), and the active-links read driven through the cache-then-network layer
/// (web <c>useShareLinks</c>) folded into the full <see cref="ShareDriveState"/> matrix. Content stays visible during
/// a background refresh; a hard failure shows the retry surface. Drive it from one confinement (the UI thread); it
/// is not internally synchronised.
/// </summary>
public sealed class ShareDriveDialogViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly IReadOnlyList<ShareLink> NoLinks = Array.Empty<ShareLink>();

    private readonly IShareLinksSource _source;
    private readonly IShareLinksCommands _commands;
    private readonly long _driveId;
    private readonly string _originBase;
    private readonly ILocalizer _localizer;
    private readonly ShareDriveDialogDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;
    private readonly CancellationTokenSource _cts = new();

    private string _title = string.Empty;
    private bool _includeSpeed = true;
    private bool _includeTelemetry;
    private string _expiryDays = ShareDriveDialogRegistration.DefaultExpiryDays;
    private string? _shareUrl;
    private bool _createPending;
    private string? _revokingToken;

    private ShareDriveState _state = ShareDriveState.Loading;
    private ShareLinksDisplay _display = ShareLinksDisplay.Empty;
    private IReadOnlyList<ShareLink> _lastLinks = NoLinks;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    private CancellationTokenSource? _loadCts;
    private bool _disposed;

    /// <summary>Creates the holder over its read source, command port, identity, origin, localizer and clock.</summary>
    /// <param name="source">The cache-then-network active-links read source.</param>
    /// <param name="commands">The create / revoke command port.</param>
    /// <param name="driveId">The drive being shared (web <c>driveId</c>).</param>
    /// <param name="originBase">The public origin the share URL is built from (web <c>window.location.origin</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    /// <param name="clock">Injectable clock so expiry comparisons are deterministic in tests.</param>
    public ShareDriveDialogViewModel(
        IShareLinksSource source,
        IShareLinksCommands commands,
        long driveId,
        string originBase,
        ILocalizer localizer,
        ShareDriveDialogDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(commands);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _commands = commands;
        _driveId = driveId;
        _originBase = originBase ?? string.Empty;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new ShareDriveDialogDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);

        ExpiryOptions = ShareDriveDialogRegistration.ExpiryOptions(localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with a localized message for the toast surface (web <c>useSharing</c> success / error).</summary>
    public event EventHandler<ShareDriveToast>? ToastRequested;

    // ── Static content + chrome labels (the Narrator-label source) ───────────────────────────────────────

    /// <summary>The expiry-select options in web render order (7 / 30 / 90 days, then Never).</summary>
    public IReadOnlyList<ShareExpiryOption> ExpiryOptions { get; }

    /// <summary>Modal title (web <c>Share Drive</c>).</summary>
    public string ModalTitle => ShareDriveDialogRegistration.Title(_localizer);

    /// <summary>Intro description shown above the create form.</summary>
    public string Description => ShareDriveDialogRegistration.Description(_localizer);

    /// <summary>Optional-title field hint.</summary>
    public string TitleHint => ShareDriveDialogRegistration.TitleHint(_localizer);

    /// <summary>Include-speed toggle label.</summary>
    public string IncludeSpeedLabel => ShareDriveDialogRegistration.IncludeSpeed(_localizer);

    /// <summary>Include-telemetry toggle label.</summary>
    public string IncludeTelemetryLabel => ShareDriveDialogRegistration.IncludeTelemetry(_localizer);

    /// <summary>Expiry-select label.</summary>
    public string ExpiryHeading => ShareDriveDialogRegistration.ExpiryHeading(_localizer);

    /// <summary>Generate-link button label.</summary>
    public string GenerateLabel => ShareDriveDialogRegistration.Generate(_localizer);

    /// <summary>Success heading shown above the created link.</summary>
    public string CreatedLabel => ShareDriveDialogRegistration.Created(_localizer);

    /// <summary>Copy-link button idle label.</summary>
    public string CopyLabel => ShareDriveDialogRegistration.Copy(_localizer);

    /// <summary>Copy-link button confirmation label.</summary>
    public string CopiedLabel => ShareDriveDialogRegistration.Copied(_localizer);

    /// <summary>"Create another link" reset action label.</summary>
    public string CreateAnotherLabel => ShareDriveDialogRegistration.CreateAnother(_localizer);

    /// <summary>Active-links section header.</summary>
    public string ExistingLabel => ShareDriveDialogRegistration.Existing(_localizer);

    /// <summary>Modal close affordance label.</summary>
    public string CloseLabel => ShareDriveDialogRegistration.Close(_localizer);

    /// <summary>Open-in-browser affordance label for the created link.</summary>
    public string OpenLinkLabel => ShareDriveDialogRegistration.OpenLink(_localizer);

    /// <summary>Empty-state message when no active links exist.</summary>
    public string EmptyMessage => ShareDriveDialogRegistration.EmptyMessage(_localizer);

    /// <summary>Loading caption for the active-links read.</summary>
    public string LoadingLabel => ShareDriveDialogRegistration.Loading(_localizer);

    /// <summary>Retry affordance label for the error surface.</summary>
    public string RetryLabel => ShareDriveDialogRegistration.Retry(_localizer);

    /// <summary>Stale chip label.</summary>
    public string StaleLabel => ShareDriveDialogRegistration.Stale(_localizer);

    /// <summary>Offline chip label.</summary>
    public string OfflineLabel => ShareDriveDialogRegistration.Offline(_localizer);

    /// <summary>Hard-failure heading for the error surface (web <c>QueryError</c> equivalent).</summary>
    public string ErrorTitle => ShareDriveDialogRegistration.ErrorText(_localizer);

    /// <summary>Per-row revoke affordance label.</summary>
    public string RevokeLabel => ShareDriveDialogRegistration.Revoke(_localizer);

    // ── Editable form fields (web useState) ──────────────────────────────────────────────────────────────

    /// <summary>The optional share title (web <c>title</c>; default empty).</summary>
    public string Title
    {
        get => _title;
        set => Set(ref _title, value ?? string.Empty);
    }

    /// <summary>Whether to include speed data (web <c>includeSpeed</c>; default on).</summary>
    public bool IncludeSpeed
    {
        get => _includeSpeed;
        set => Set(ref _includeSpeed, value);
    }

    /// <summary>Whether to include detailed telemetry (web <c>includeTelemetry</c>; default off).</summary>
    public bool IncludeTelemetry
    {
        get => _includeTelemetry;
        set => Set(ref _includeTelemetry, value);
    }

    /// <summary>The chosen expiry option value (web <c>expiryDays</c>; default "30").</summary>
    public string ExpiryDays
    {
        get => _expiryDays;
        set => Set(ref _expiryDays, value ?? ShareDriveDialogRegistration.DefaultExpiryDays);
    }

    // ── Create / result state ────────────────────────────────────────────────────────────────────────────

    /// <summary>The freshly-created share URL (web <c>shareUrl</c>); null while the create form is shown.</summary>
    public string? ShareUrl
    {
        get => _shareUrl;
        private set
        {
            if (Set(ref _shareUrl, value))
            {
                Raise(nameof(HasShareUrl));
                Raise(nameof(IsCreateMode));
            }
        }
    }

    /// <summary>True once a link has been created — the body shows the success view rather than the form.</summary>
    public bool HasShareUrl => _shareUrl is not null;

    /// <summary>True while the create form is shown (web <c>!shareUrl</c>).</summary>
    public bool IsCreateMode => _shareUrl is null;

    /// <summary>True while the create mutation is in flight (web <c>createShare.isPending</c>): Generate shows a ring.</summary>
    public bool CreatePending
    {
        get => _createPending;
        private set
        {
            if (Set(ref _createPending, value))
            {
                Raise(nameof(CanGenerate));
            }
        }
    }

    /// <summary>True when the Generate action is enabled (not while a create is in flight).</summary>
    public bool CanGenerate => !_createPending;

    /// <summary>The token currently being revoked, or null — the matching row disables its revoke action.</summary>
    public string? RevokingToken
    {
        get => _revokingToken;
        private set
        {
            if (Set(ref _revokingToken, value))
            {
                Raise(nameof(RevokePending));
            }
        }
    }

    /// <summary>True while a revoke mutation is in flight.</summary>
    public bool RevokePending => _revokingToken is not null;

    // ── Active-links read state matrix ───────────────────────────────────────────────────────────────────

    /// <summary>The current mutually-exclusive active-links state.</summary>
    public ShareDriveState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready active-share rows.</summary>
    public ShareLinksDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasLinks));
        }
    }

    /// <summary>True when there is at least one active share link to render.</summary>
    public bool HasLinks => _display.HasRows;

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

    /// <summary>True when the active-links load failed and no cache is shown (drives the error surface).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown links are older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the error / offline surfaces.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of active-links load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Emit the <c>view.opened</c> diagnostics event (web mount). Idempotent counting is fine.</summary>
    public void NotifyOpened()
    {
        if (!_disposed)
        {
            _diagnostics.RecordViewOpened();
        }
    }

    /// <summary>
    /// Run a cache-then-network active-links load (web <c>useShareLinks</c>): counts the attempt, shows the loading
    /// affordance only when nothing is already visible (otherwise keeps content while refreshing), and folds every
    /// emission into the state matrix. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancellation linked to the surface lifetime.</param>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed)
        {
            return;
        }

        // Owned by _loadCts: the next load (previous?.Dispose) or Dispose() releases it — never a using local.
        var linked = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token, cancellationToken);
        CancellationTokenSource? previous = Interlocked.Exchange(ref _loadCts, linked);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasLinks)
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (RepositoryResult<IReadOnlyList<ShareLink>> result in
                _source.StreamAsync(_driveId, linked.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Retry after a failure — re-runs the active-links load from the top.</summary>
    /// <param name="cancellationToken">Cancellation linked to the surface lifetime.</param>
    public Task RetryAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Create a share link (web <c>handleCreate</c>): runs the create mutation behind the in-flight gate, and on
    /// success swaps the body to the success view with the public link, records the diagnostic, raises the success
    /// toast and reloads the active links (web invalidation cascade). A failure raises the error toast and keeps the
    /// form. Returns true only when a link was created.
    /// </summary>
    /// <param name="cancellationToken">Cancellation linked to the surface lifetime.</param>
    public async Task<bool> GenerateAsync(CancellationToken cancellationToken = default)
    {
        if (_createPending || _disposed)
        {
            return false;
        }

        CreatePending = true;
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token, cancellationToken);
        try
        {
            CreateShareBody body = ShareDriveDialogRegistration.BuildCreateBody(
                _title, _includeSpeed, _includeTelemetry, _expiryDays);
            ShareCreateOutcome outcome = await _commands.CreateAsync(_driveId, body, linked.Token).ConfigureAwait(false);
            if (outcome is { Success: true, Result: { } result })
            {
                ShareUrl = ShareDriveDialogProjection.BuildShareUrl(_originBase, result.Token);
                _diagnostics.RecordLinkCreated();
                RaiseToast(ShareDriveDialogRegistration.CreatedToast(_localizer), isError: false);
                await LoadAsync(linked.Token).ConfigureAwait(false);
                return true;
            }

            RaiseToast(ComposeError(ShareDriveDialogRegistration.CreateErrorToast(_localizer), outcome.Error), isError: true);
            return false;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        finally
        {
            CreatePending = false;
        }
    }

    /// <summary>
    /// Revoke a share link (web <c>handleRevoke</c>): runs the revoke mutation behind the per-surface in-flight gate,
    /// and on success records the diagnostic, raises the success toast and reloads the active links (web invalidation
    /// cascade). A failure raises the error toast and leaves the list intact.
    /// </summary>
    /// <param name="token">The share token to revoke.</param>
    /// <param name="cancellationToken">Cancellation linked to the surface lifetime.</param>
    public async Task RevokeAsync(string token, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(token) || _revokingToken is not null || _disposed)
        {
            return;
        }

        RevokingToken = token;
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token, cancellationToken);
        try
        {
            ShareRevokeOutcome outcome = await _commands.RevokeAsync(token, linked.Token).ConfigureAwait(false);
            if (outcome.Success)
            {
                _diagnostics.RecordLinkRevoked();
                RaiseToast(ShareDriveDialogRegistration.RevokedToast(_localizer), isError: false);
                await LoadAsync(linked.Token).ConfigureAwait(false);
            }
            else
            {
                RaiseToast(ComposeError(ShareDriveDialogRegistration.RevokeErrorToast(_localizer), outcome.Error), isError: true);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded / disposed — leave the list as-is.
        }
        finally
        {
            RevokingToken = null;
        }
    }

    /// <summary>Return to the create form from the success view (web <c>setShareUrl(null)</c>).</summary>
    public void CreateAnother() => ShareUrl = null;

    /// <summary>Reset the transient form + result state on close (web <c>handleClose</c>: clears url + title).</summary>
    public void Reset()
    {
        ShareUrl = null;
        Title = string.Empty;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        CancellationTokenSource? load = Interlocked.Exchange(ref _loadCts, null);
        load?.Cancel();
        load?.Dispose();
        _cts.Cancel();
        _cts.Dispose();
    }

    private void Apply(RepositoryResult<IReadOnlyList<ShareLink>> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasLinks)
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplyLinks(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null, offline: false);
                break;

            case LoadStatus.Refreshing:
                ApplyLinks(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null, offline: false);
                break;

            case LoadStatus.Loaded:
                ApplyLinks(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null, offline: false);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyLinks(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyLinks(
        IReadOnlyList<ShareLink> links,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline)
    {
        _lastLinks = links ?? NoLinks;
        ShareLinksDisplay display = ShareDriveDialogProjection.Project(_lastLinks, _originBase, _clock(), _localizer);
        if (!display.HasRows)
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
        State = offline ? ShareDriveState.Offline : stale ? ShareDriveState.Stale : ShareDriveState.Loaded;
    }

    private void SetLoading()
    {
        _lastLinks = NoLinks;
        Display = ShareLinksDisplay.Empty;
        IsError = false;
        ErrorMessage = null;
        State = ShareDriveState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _lastLinks = NoLinks;
        Display = ShareLinksDisplay.Empty;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = ShareDriveState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        _lastLinks = NoLinks;
        Display = ShareLinksDisplay.Empty;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = ShareDriveState.Error;
    }

    private string ErrorTextFor(RepositoryError? error) =>
        string.IsNullOrEmpty(error?.Message)
            ? ShareDriveDialogRegistration.ErrorText(_localizer)
            : error!.Message;

    private static string ComposeError(string prefix, RepositoryError? error) =>
        string.IsNullOrEmpty(error?.Message)
            ? prefix
            : string.Create(CultureInfo.CurrentCulture, $"{prefix}: {error!.Message}");

    private void RaiseToast(string message, bool isError) =>
        ToastRequested?.Invoke(this, new ShareDriveToast(message, isError));

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
